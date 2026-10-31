# ===============================================================
#  analytics.py  —  Admin "Learning Analytics" (Phase A)
# ---------------------------------------------------------------
#  End-to-end visibility for the admin/L&D team, built entirely
#  from data the portal ALREADY collects (no new tables):
#
#    - Per-employee journey: induction % , modules viewed, videos,
#      every assessment score, certificates, which trainer
#      delivered each module, OJT snapshot.
#    - Activity feed: what happened today / this week (completions,
#      videos, assessments) across everyone.
#    - Trainer roll-up: per trainer, how many learners & modules
#      delivered, and those learners' average score & pass rate
#      (the foundation for the trainer KPI/KRA scorecard; learner
#      ratings get added in Phase B).
#
#  All endpoints are READ-ONLY and admin/instructor only.
#  Wired from app.py:  init_analytics(app, get_db, current_user)
# ===============================================================
import io
from datetime import datetime, timedelta
from functools import wraps
from flask import Blueprint, jsonify, request, send_file

analytics_bp = Blueprint("analytics", __name__)
_get_db = None
_current_user = None


# ---------- helpers --------------------------------------------
def _rowget(r, key, default=None):
    try:
        if r is None:
            return default
        return r[key] if key in r.keys() else default
    except Exception:
        return default


def _staff_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        u = _current_user()
        if u is None or u["role"] not in ("admin", "instructor"):
            return jsonify(ok=False, msg="Not authorised."), 403
        return view(*a, **k)
    return wrapped


def _ist(iso):
    """Return just the date part (YYYY-MM-DD) from an ISO timestamp, IST-shifted."""
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", ""))
        dt = dt + timedelta(hours=5, minutes=30)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return str(iso)[:10]


def _today_ist():
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()


def _name_map(db):
    return {r["emp_id"]: r["name"]
            for r in db.execute("SELECT emp_id, name FROM users").fetchall()}


def _desg_map(db):
    """emp_id -> designation (lowercased), for separating trainers from the L&D
    Manager in the KPI competition."""
    return {r["emp_id"]: (r["designation"] or "").strip().lower()
            for r in db.execute("SELECT emp_id, designation FROM users").fetchall()}


def _is_trainer_designation(desg):
    """A 'competing trainer' is anyone whose designation is an L&D Executive
    (covers 'Learning & Development Executive' and 'Sr. Learning & Development
    Executive'). The L&D Manager and generic admins are NOT in the competition."""
    d = (desg or "").strip().lower()
    return "learning & development executive" in d or "learning and development executive" in d


# ===============================================================
#  1) PER-EMPLOYEE JOURNEY
# ===============================================================
@analytics_bp.route("/api/analytics/employee")
@_staff_only
def api_analytics_employee():
    """Full learning record for one employee."""
    emp_id = (request.args.get("emp_id") or "").strip()
    if not emp_id:
        return jsonify(ok=False, msg="Missing employee ID."), 400
    db = get_db = _get_db()
    u = db.execute("SELECT * FROM users WHERE emp_id=?", (emp_id,)).fetchone()
    if not u:
        return jsonify(ok=False, msg="Employee not found."), 404
    desg = (u["designation"] or "")
    names = _name_map(db)

    # ---- induction + training modules (live) and completion ----
    def _roles_match(roles_field):
        roles = (roles_field or "all").strip().lower()
        if roles in ("", "all"):
            return True
        d = desg.strip().lower()
        return any(a.strip() and a.strip() in d for a in roles.split(","))

    mods = db.execute(
        "SELECT id, kind, title, roles FROM content_modules "
        "WHERE status='live' ORDER BY kind, sort_order, id"
    ).fetchall()
    done_rows = {r["module_id"]: r["completed_at"] for r in db.execute(
        "SELECT module_id, completed_at FROM module_completions WHERE emp_id=?", (emp_id,)
    ).fetchall()}
    # who delivered each module to this learner (approved deliveries)
    deliv = {}
    for r in db.execute(
        "SELECT module_id, trainer_id FROM training_delivery "
        "WHERE learner_id=? AND status='approved'", (emp_id,)
    ).fetchall():
        deliv.setdefault(r["module_id"], set()).add(r["trainer_id"])

    induction, training = [], []
    for m in mods:
        if not _roles_match(m["roles"]):
            continue
        trainers = sorted({names.get(t, t) for t in deliv.get(m["id"], set())})
        row = {
            "id": m["id"], "title": m["title"],
            "completed": m["id"] in done_rows,
            "completed_on": _ist(done_rows.get(m["id"])),
            "trainers": trainers,
        }
        (induction if m["kind"] == "induction" else training).append(row)

    ind_done = sum(1 for x in induction if x["completed"])
    trn_done = sum(1 for x in training if x["completed"])

    # ---- videos ----
    vids = db.execute("SELECT id, title FROM videos WHERE status='live' ORDER BY id").fetchall() \
        if _table_exists(db, "videos") else []
    vdone = {r["video_id"] for r in db.execute(
        "SELECT video_id FROM video_completions WHERE emp_id=?", (emp_id,)
    ).fetchall()}
    videos = [{"title": v["title"], "completed": v["id"] in vdone} for v in vids]

    # ---- assessments (best attempt per assessment) ----
    assess = []
    arows = db.execute(
        "SELECT r.assessment_id, a.title, a.pass_percent, "
        "       MAX(r.percent) AS best, COUNT(*) AS attempts, "
        "       MAX(CASE WHEN r.passed=1 THEN 1 ELSE 0 END) AS passed, "
        "       MAX(r.taken_at) AS last_taken "
        "FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id "
        "WHERE r.emp_id=? GROUP BY r.assessment_id, a.title, a.pass_percent "
        "ORDER BY a.title", (emp_id,)
    ).fetchall()
    for r in arows:
        assess.append({
            "title": r["title"], "best": r["best"], "attempts": r["attempts"],
            "passed": bool(r["passed"]), "pass_percent": r["pass_percent"],
            "last_taken": _ist(r["last_taken"]),
        })

    # ---- certificates ----
    certs = [{"name": r["cert_name"], "issued_on": _ist(r["issued_at"])}
             for r in db.execute(
                 "SELECT cert_name, issued_at FROM issued_certificates "
                 "WHERE emp_id=? ORDER BY issued_at", (emp_id,)).fetchall()]

    # ---- OJT snapshot ----
    ojt = None
    enr = db.execute(
        "SELECT id, role, status FROM ojt_enrollments WHERE emp_id=? ORDER BY id DESC LIMIT 1",
        (emp_id,)
    ).fetchone()
    if enr:
        total_tasks = db.execute(
            "SELECT COUNT(*) c FROM ojt_tasks WHERE role=?", (enr["role"],)
        ).fetchone()["c"]
        done_tasks = db.execute(
            "SELECT COUNT(*) c FROM ojt_signoffs WHERE enrollment_id=?", (enr["id"],)
        ).fetchone()["c"]
        ojt = {
            "role": enr["role"], "status": enr["status"],
            "done": done_tasks, "total": total_tasks,
            "pct": round(done_tasks * 100 / total_tasks) if total_tasks else 0,
        }

    return jsonify(
        ok=True,
        employee={
            "emp_id": u["emp_id"], "name": u["name"],
            "designation": desg, "status": u["status"],
            "activated": bool(_rowget(u, "activated", 0)),
            "last_login": _ist(_rowget(u, "last_login")),
        },
        induction={"done": ind_done, "total": len(induction),
                   "pct": round(ind_done * 100 / len(induction)) if induction else 0,
                   "items": induction},
        training={"done": trn_done, "total": len(training),
                  "pct": round(trn_done * 100 / len(training)) if training else 0,
                  "items": training},
        videos=videos,
        assessments=assess,
        certificates=certs,
        ojt=ojt,
    )


def _table_exists(db, name):
    try:
        db.execute("SELECT 1 FROM " + name + " LIMIT 1")
        return True
    except Exception:
        return False


# ===============================================================
#  2) ACTIVITY FEED  (today / this week / any range)
# ===============================================================
@analytics_bp.route("/api/analytics/activity")
@_staff_only
def api_analytics_activity():
    """What happened in a date window: module completions, video
    completions, and assessment attempts, newest first."""
    rng = (request.args.get("range") or "today").strip()
    today = _today_ist()
    if rng == "today":
        since = today
    elif rng == "week":
        since = today - timedelta(days=7)
    elif rng == "month":
        since = today - timedelta(days=30)
    else:
        since = today
    since_iso = since.isoformat()
    db = _get_db()
    names = _name_map(db)

    events = []
    totals = {"induction": 0, "training": 0, "assess_pass": 0, "assess_fail": 0,
              "videos": 0, "certs": 0, "ojt_calls": 0}

    # module completions (split induction vs training)
    for r in db.execute(
        "SELECT mc.emp_id, mc.completed_at, cm.title, cm.kind "
        "FROM module_completions mc LEFT JOIN content_modules cm ON cm.id=mc.module_id "
        "WHERE mc.completed_at >= ? ORDER BY mc.completed_at DESC", (since_iso,)
    ).fetchall():
        kind = (r["kind"] or "module").lower()
        group = "induction" if kind == "induction" else "training"
        totals[group] = totals.get(group, 0) + 1
        events.append({
            "when": _ist(r["completed_at"]), "ts": str(r["completed_at"]),
            "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
            "type": group, "detail": (r["title"] or "module"),
            "result": "Completed",
        })

    # video completions
    if _table_exists(db, "video_completions"):
        for r in db.execute(
            "SELECT vc.emp_id, vc.completed_at, v.title "
            "FROM video_completions vc LEFT JOIN videos v ON v.id=vc.video_id "
            "WHERE vc.completed_at >= ? ORDER BY vc.completed_at DESC", (since_iso,)
        ).fetchall():
            totals["videos"] += 1
            events.append({
                "when": _ist(r["completed_at"]), "ts": str(r["completed_at"]),
                "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
                "type": "video", "detail": (r["title"] or "video"),
                "result": "Watched",
            })

    # assessment attempts
    for r in db.execute(
        "SELECT r.emp_id, r.taken_at, r.percent, r.passed, a.title "
        "FROM assessment_results r LEFT JOIN assessments a ON a.id=r.assessment_id "
        "WHERE r.taken_at >= ? ORDER BY r.taken_at DESC", (since_iso,)
    ).fetchall():
        if r["passed"]:
            totals["assess_pass"] += 1
        else:
            totals["assess_fail"] += 1
        events.append({
            "when": _ist(r["taken_at"]), "ts": str(r["taken_at"]),
            "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
            "type": "assessment", "detail": (r["title"] or "assessment"),
            "result": ("PASS " if r["passed"] else "FAIL ") + str(r["percent"]) + "%",
            "passed": bool(r["passed"]),
        })

    # certificates issued
    for r in db.execute(
        "SELECT emp_id, cert_name, issued_at FROM issued_certificates "
        "WHERE issued_at >= ? ORDER BY issued_at DESC", (since_iso,)
    ).fetchall():
        totals["certs"] += 1
        events.append({
            "when": _ist(r["issued_at"]), "ts": str(r["issued_at"]),
            "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
            "type": "cert", "detail": (r["cert_name"] or "Certificate"),
            "result": "Issued",
        })

    # OJT calls (trainer -> learner), via enrollment
    if _table_exists(db, "ojt_calls"):
        try:
            for r in db.execute(
                "SELECT oc.called_by, oc.called_at, oc.outcome, oc.day_no, "
                "       e.emp_id AS learner_id "
                "FROM ojt_calls oc LEFT JOIN ojt_enrollments e ON e.id=oc.enrollment_id "
                "WHERE oc.called_at >= ? ORDER BY oc.called_at DESC", (since_iso,)
            ).fetchall():
                totals["ojt_calls"] += 1
                caller = names.get(r["called_by"], r["called_by"] or "")
                learner = names.get(r["learner_id"], r["learner_id"] or "")
                events.append({
                    "when": _ist(r["called_at"]), "ts": str(r["called_at"]),
                    "emp_id": r["learner_id"], "name": learner,
                    "type": "ojt_call",
                    "detail": "Day " + str(r["day_no"] or "") + " call" + (" · " + caller if caller else ""),
                    "result": (r["outcome"] or "Called"),
                })
        except Exception:
            pass

    events.sort(key=lambda e: e["ts"], reverse=True)
    return jsonify(ok=True, range=rng, count=len(events),
                   totals=totals, events=events[:800])


# ===============================================================
#  3) TRAINER ROLL-UP  (KPI foundation)
# ===============================================================
def _build_trainer_kpis(db, only_trainers=True, keep_ids=None):
    """Compute the KPI scorecard list for trainers (sorted best-first).
    only_trainers=True keeps just the competing trainers (L&D Executives),
    excluding the L&D Manager and generic admins from the ranked competition.
    keep_ids, if given, restricts to those emp_ids (used for the manager's own
    numbers). Shared by the admin Trainers view and the per-trainer view."""
    names = _name_map(db)
    desgs = _desg_map(db)

    # trainer -> set(learner), count(deliveries), set(module)
    stats = {}
    for r in db.execute(
        "SELECT trainer_id, learner_id, module_id FROM training_delivery "
        "WHERE status='approved'"
    ).fetchall():
        t = r["trainer_id"]
        s = stats.setdefault(t, {"learners": set(), "deliveries": 0, "modules": set()})
        s["learners"].add(r["learner_id"])
        s["deliveries"] += 1
        s["modules"].add(r["module_id"])

    # keep only the people we want ranked
    if keep_ids is not None:
        stats = {t: s for t, s in stats.items() if t in set(keep_ids)}
    elif only_trainers:
        stats = {t: s for t, s in stats.items() if _is_trainer_designation(desgs.get(t, ""))}

    # average score + pass rate of each trainer's learners (best attempt per learner-assessment)
    out = []
    # trainer ratings (avg of trainer_rating across all ratings for that trainer)
    rate_map = {}
    if _table_exists(db, "training_ratings"):
        for r in db.execute(
            "SELECT trainer_id, "
            "AVG(trainer_rating*1.0) avg_tr, COUNT(trainer_rating) n_tr, "
            "AVG(content_rating*1.0) avg_ct, COUNT(content_rating) n_ct "
            "FROM training_ratings WHERE trainer_id IS NOT NULL AND trainer_id<>'' "
            "GROUP BY trainer_id"
        ).fetchall():
            rate_map[r["trainer_id"]] = r

    # OJT calls logged per trainer
    calls_map = {}
    if _table_exists(db, "ojt_calls"):
        try:
            for r in db.execute(
                "SELECT called_by, COUNT(*) c FROM ojt_calls GROUP BY called_by"
            ).fetchall():
                calls_map[r["called_by"]] = r["c"]
        except Exception:
            calls_map = {}
    # normalize engagement only against the people being ranked (in `stats`)
    max_calls = max((calls_map.get(t, 0) for t in stats.keys()), default=0)
    max_deliveries = max((s["deliveries"] for s in stats.values()), default=0)

    # ---- per-learner assessment aggregates, computed ONCE for everyone ----
    # (was 2 queries per trainer; now 2 queries total, rolled up in Python).
    # Only need learners that appear in some delivery.
    all_learners = set()
    for s in stats.values():
        all_learners |= s["learners"]

    best_rows = []     # (emp_id, assessment_id) -> {"best","passed"} (best attempt)
    first_pass = {}    # (emp_id, assessment_id) -> 1/0 (earliest attempt passed?)
    if all_learners:
        lids = list(all_learners)
        ph = ",".join("?" * len(lids))
        for r in db.execute(
            "SELECT emp_id, assessment_id, MAX(percent) best, "
            "MAX(CASE WHEN passed=1 THEN 1 ELSE 0 END) passed "
            "FROM assessment_results WHERE emp_id IN (" + ph + ") "
            "GROUP BY emp_id, assessment_id", lids
        ).fetchall():
            best_rows.append((r["emp_id"], r["assessment_id"], r["best"], r["passed"]))
        for r in db.execute(
            "SELECT emp_id, assessment_id, passed FROM assessment_results r1 "
            "WHERE emp_id IN (" + ph + ") AND id = ("
            "  SELECT MIN(id) FROM assessment_results r2 "
            "  WHERE r2.emp_id=r1.emp_id AND r2.assessment_id=r1.assessment_id)",
            lids
        ).fetchall():
            first_pass[(r["emp_id"], r["assessment_id"])] = (1 if r["passed"] else 0)

    for t, s in stats.items():
        lset = s["learners"]
        avg_score = None
        pass_rate = None
        first_attempt_rate = None
        if lset:
            rows = [br for br in best_rows if br[0] in lset]
            if rows:
                avg_score = round(sum(br[2] for br in rows) / len(rows))
                pass_rate = round(sum(br[3] for br in rows) * 100 / len(rows))
            fa = [v for (emp, _aid), v in first_pass.items() if emp in lset]
            if fa:
                first_attempt_rate = round(sum(fa) * 100 / len(fa))

        rr = rate_map.get(t)
        # AVG() comes back as Decimal from psycopg2 — coerce to float before any
        # arithmetic, or Decimal*float in the KPI blend raises TypeError (500).
        trainer_rating = (round(float(rr["avg_tr"]), 1)
                          if rr and rr["avg_tr"] is not None else None)
        ojt_calls = calls_map.get(t, 0)
        n_learners = len(s["learners"])
        low_data = n_learners < 3

        # ---- KPI score (0-100): weights 30/20/20/20/10 ----
        # pass 30, avg score 20, first-attempt 20, rating 20 (stars*20), engagement 10
        w_pass, w_score, w_first, w_rate, w_eng = 30, 20, 20, 20, 10
        pass_c = (pass_rate if pass_rate is not None else 0)
        score_c = (avg_score if avg_score is not None else 0)
        first_c = (first_attempt_rate if first_attempt_rate is not None else 0)
        rate_c = ((trainer_rating or 0) * 20)  # 5★ -> 100
        # engagement = blend of delivery volume + OJT calls, relative to top trainer
        eng_deliv = (s["deliveries"] / max_deliveries * 100) if max_deliveries else 0
        eng_calls = (ojt_calls / max_calls * 100) if max_calls else 0
        eng_c = (eng_deliv * 0.5 + eng_calls * 0.5)
        kpi = (pass_c * w_pass + score_c * w_score + first_c * w_first
               + rate_c * w_rate + eng_c * w_eng) / 100.0
        kpi_score = round(kpi)

        out.append({
            "trainer_id": t, "trainer": names.get(t, t),
            "learners": n_learners,
            "deliveries": s["deliveries"],
            "modules": len(s["modules"]),
            "avg_score": avg_score,
            "pass_rate": pass_rate,
            "first_attempt_rate": first_attempt_rate,
            "ojt_calls": ojt_calls,
            "trainer_rating": trainer_rating,
            "trainer_rating_n": (rr["n_tr"] if rr else 0),
            "content_rating": (round(float(rr["avg_ct"]), 1) if rr and rr["avg_ct"] is not None else None),
            "kpi_score": kpi_score,
            "low_data": low_data,
        })
    out.sort(key=lambda x: (-(x["kpi_score"]), -(x["learners"]), x["trainer"]))
    return out


_KPI_WEIGHTS = {"pass": 30, "score": 20, "first_attempt": 20, "rating": 20, "engagement": 10}


@analytics_bp.route("/api/analytics/trainers")
@_staff_only
def api_analytics_trainers():
    """Full trainer KPI list + leaderboard. ADMIN ONLY — a trainer must not
    see other trainers' scores. Instructors use /api/analytics/my-trainer."""
    u = _current_user()
    if u["role"] != "admin":
        return jsonify(ok=False, admin_only=True,
                       msg="Trainer KPIs are visible to the admin only."), 403
    db = _get_db()
    out = _build_trainer_kpis(db)
    return jsonify(ok=True, trainers=out, kpi_weights=_KPI_WEIGHTS)


@analytics_bp.route("/api/analytics/my-trainer")
@_staff_only
def api_analytics_my_trainer():
    """The caller's OWN KPI scorecard (instructor sees only themselves; admin
    can use it too). Rank is computed but only returned to admins."""
    u = _current_user()
    me = u["emp_id"]
    db = _get_db()
    out = _build_trainer_kpis(db)
    mine = None
    rank = None
    for i, row in enumerate(out):
        if row["trainer_id"] == me:
            mine = row
            rank = i + 1  # 1-based position in the best-first list
            break
    if mine is None:
        # a trainer with no approved deliveries yet — return an empty shell
        mine = {
            "trainer_id": me, "trainer": u["name"],
            "learners": 0, "deliveries": 0, "modules": 0,
            "avg_score": None, "pass_rate": None, "first_attempt_rate": None,
            "ojt_calls": 0, "trainer_rating": None, "trainer_rating_n": 0,
            "content_rating": None, "kpi_score": 0, "low_data": True,
        }
    # instructors don't get told their rank-of-N (no competitive framing)
    show_rank = (u["role"] == "admin")
    return jsonify(ok=True, me=mine, kpi_weights=_KPI_WEIGHTS,
                   rank=(rank if show_rank else None),
                   total_trainers=(len(out) if show_rank else None))


@analytics_bp.route("/api/analytics/ld-manager")
@_staff_only
def api_analytics_ld_manager():
    """The L&D Manager's own view (admin only): the manager's OWN delivery
    activity (not scored against trainers) + a roll-up of the competing
    trainers' progress, with best / needs-support flags."""
    u = _current_user()
    if u["role"] != "admin":
        return jsonify(ok=False, admin_only=True, msg="Admin only."), 403
    db = _get_db()
    me = u["emp_id"]

    # the competing trainers (L&D Executives), ranked
    trainers = _build_trainer_kpis(db, only_trainers=True)

    # the manager's OWN numbers, computed the same way but just for themselves
    my_rows = _build_trainer_kpis(db, keep_ids=[me])
    my = (my_rows[0] if my_rows else {
        "trainer_id": me, "trainer": u["name"],
        "learners": 0, "deliveries": 0, "modules": 0,
        "avg_score": None, "pass_rate": None, "first_attempt_rate": None,
        "ojt_calls": 0, "trainer_rating": None, "trainer_rating_n": 0,
        "content_rating": None, "kpi_score": 0, "low_data": True,
    })

    # team roll-up
    n = len(trainers)
    def _avg(vals):
        v = [x for x in vals if x is not None]
        return round(sum(v) / len(v)) if v else None
    team = {
        "trainers": n,
        "avg_kpi": _avg([t["kpi_score"] for t in trainers]),
        "avg_pass": _avg([t["pass_rate"] for t in trainers]),
        "avg_score": _avg([t["avg_score"] for t in trainers]),
        "total_deliveries": sum(t["deliveries"] for t in trainers),
        "total_ojt_calls": sum(t["ojt_calls"] for t in trainers),
    }
    # distinct learners across the team (not a simple sum — avoid double counting)
    try:
        team_ids = [t["trainer_id"] for t in trainers]
        if team_ids:
            ph = ",".join("?" * len(team_ids))
            row = db.execute(
                "SELECT COUNT(DISTINCT learner_id) c FROM training_delivery "
                "WHERE status='approved' AND trainer_id IN (" + ph + ")", team_ids
            ).fetchone()
            team["distinct_learners"] = (row["c"] if row else 0)
        else:
            team["distinct_learners"] = 0
    except Exception:
        team["distinct_learners"] = 0

    # best / needs-support flags (only meaningful with enough data)
    best = trainers[0] if trainers else None
    ranked = [t for t in trainers if not t["low_data"]]
    needs = (ranked[-1] if len(ranked) >= 2 else None)

    return jsonify(ok=True,
                   manager={"emp_id": me, "name": u["name"],
                            "designation": u["designation"] or "L&D Manager"},
                   my=my, team=team, trainers=trainers,
                   best=({"trainer": best["trainer"], "kpi_score": best["kpi_score"]} if best else None),
                   needs_support=({"trainer": needs["trainer"], "kpi_score": needs["kpi_score"]} if needs else None),
                   kpi_weights=_KPI_WEIGHTS)


@analytics_bp.route("/api/analytics/trainer")
@_staff_only
def api_analytics_trainer_detail():
    """Drill-in for one trainer: their learners (with scores), modules they
    delivered, rating breakdown, and recent feedback comments."""
    tid = (request.args.get("id") or "").strip()
    if not tid:
        return jsonify(ok=False, msg="Missing trainer id."), 400
    # a trainer (instructor) may only drill into their OWN record; the admin
    # can drill into anyone.
    u = _current_user()
    if u["role"] != "admin" and tid != u["emp_id"]:
        return jsonify(ok=False, admin_only=True,
                       msg="You can only view your own performance."), 403
    db = _get_db()
    names = _name_map(db)

    # learners this trainer delivered to, + each learner's best score & pass
    learner_ids = [r["learner_id"] for r in db.execute(
        "SELECT DISTINCT learner_id FROM training_delivery WHERE trainer_id=? AND status='approved'",
        (tid,)
    ).fetchall()]
    learners = []
    for lid in learner_ids:
        row = db.execute(
            "SELECT MAX(percent) best, MAX(CASE WHEN passed=1 THEN 1 ELSE 0 END) passed, COUNT(*) attempts "
            "FROM assessment_results WHERE emp_id=?", (lid,)
        ).fetchone()
        learners.append({
            "emp_id": lid, "name": names.get(lid, lid),
            "best": (row["best"] if row else None),
            "passed": bool(row["passed"]) if row else False,
            "attempts": (row["attempts"] if row else 0),
        })
    learners.sort(key=lambda x: x["name"])

    # modules delivered (titles + count of learners per module)
    modules = []
    for r in db.execute(
        "SELECT td.module_id, cm.title, COUNT(DISTINCT td.learner_id) n "
        "FROM training_delivery td LEFT JOIN content_modules cm ON cm.id=td.module_id "
        "WHERE td.trainer_id=? AND td.status='approved' GROUP BY td.module_id, cm.title "
        "ORDER BY n DESC", (tid,)
    ).fetchall():
        modules.append({"title": r["title"] or ("Module " + str(r["module_id"])), "learners": r["n"]})

    # rating breakdown + comments
    ratings = {"trainer_avg": None, "content_avg": None, "n": 0}
    comments = []
    if _table_exists(db, "training_ratings"):
        rb = db.execute(
            "SELECT AVG(trainer_rating*1.0) ta, AVG(content_rating*1.0) ca, COUNT(*) n "
            "FROM training_ratings WHERE trainer_id=?", (tid,)
        ).fetchone()
        if rb:
            ratings = {
                "trainer_avg": (round(float(rb["ta"]), 1) if rb["ta"] is not None else None),
                "content_avg": (round(float(rb["ca"]), 1) if rb["ca"] is not None else None),
                "n": rb["n"] or 0,
            }
        for r in db.execute(
            "SELECT r.emp_id, r.trainer_rating, r.content_rating, r.comment, r.created_at, "
            "COALESCE(cm.title,'') mtitle "
            "FROM training_ratings r LEFT JOIN content_modules cm ON cm.id=r.module_id "
            "WHERE r.trainer_id=? AND r.comment IS NOT NULL AND r.comment<>'' "
            "ORDER BY r.created_at DESC LIMIT 50", (tid,)
        ).fetchall():
            comments.append({
                "learner": names.get(r["emp_id"], r["emp_id"]),
                "trainer_rating": r["trainer_rating"],
                "module": r["mtitle"],
                "comment": r["comment"],
                "when": _ist(r["created_at"]),
            })

    return jsonify(ok=True, trainer=names.get(tid, tid),
                   learners=learners, modules=modules,
                   ratings=ratings, comments=comments)


# ===============================================================
#  4) OVERVIEW SUMMARY  (top cards)
# ===============================================================
@analytics_bp.route("/api/analytics/overview")
@_staff_only
def api_analytics_overview():
    import time as _time
    _dbg = request.args.get("debug")
    _marks = []
    _t0 = _time.perf_counter()

    def _mark(label):
        if _dbg:
            _marks.append({"step": label, "ms": round((_time.perf_counter() - _t0) * 1000)})

    db = _get_db()
    _mark("get_db")
    today = _today_ist()
    today_iso = today.isoformat()
    week_iso = (today - timedelta(days=7)).isoformat()

    def _count(sql, args=()):
        try:
            return db.execute(sql, args).fetchone()["c"]
        except Exception:
            return 0

    # ---- all users-table counts in ONE query (was 4 separate round-trips) ----
    # conditional aggregation: total approved staff, enrolled today, ever
    # logged in, logged in today — computed together.
    _ur = {}
    try:
        _ur = db.execute(
            "SELECT "
            " COUNT(*) FILTER (WHERE status='approved' AND role='staff') total_staff, "
            " COUNT(*) FILTER (WHERE role='staff' AND created_at >= ?) enrolled_today, "
            " COUNT(*) FILTER (WHERE role='staff' AND status='approved' "
            "                  AND last_login IS NOT NULL AND last_login<>'') logged_in, "
            " COUNT(*) FILTER (WHERE role='staff' AND last_login >= ?) logged_in_today "
            "FROM users", (today_iso, today_iso)
        ).fetchone()
    except Exception:
        _ur = {}
    total_staff = _rowget(_ur, "total_staff", 0) or 0

    # active this week = did any module / assessment / video in last 7 days.
    # ONE union query (was 3 queries + a table-exists probe = 4 round-trips).
    active_ids = set()
    _union = (
        "SELECT DISTINCT emp_id FROM module_completions WHERE completed_at >= ? "
        "UNION SELECT DISTINCT emp_id FROM assessment_results WHERE taken_at >= ? "
        "UNION SELECT DISTINCT emp_id FROM video_completions WHERE completed_at >= ?"
    )
    try:
        for r in db.execute(_union, (week_iso, week_iso, week_iso)).fetchall():
            active_ids.add(r["emp_id"])
    except Exception:
        # if video_completions is absent, retry without it (two tables only)
        try:
            for r in db.execute(
                "SELECT DISTINCT emp_id FROM module_completions WHERE completed_at >= ? "
                "UNION SELECT DISTINCT emp_id FROM assessment_results WHERE taken_at >= ?",
                (week_iso, week_iso)
            ).fetchall():
                active_ids.add(r["emp_id"])
        except Exception:
            pass
    active_week = len(active_ids)
    _mark("active_week")

    # induction & training completion rate (completed vs expected, staff only).
    # All four numbers (live-count + done-count, per kind) in ONE query each —
    # 2 queries total instead of 4.
    live_ind = live_trn = done_ind = done_trn = 0
    try:
        _lv = db.execute(
            "SELECT "
            " COUNT(*) FILTER (WHERE kind='induction') ind, "
            " COUNT(*) FILTER (WHERE kind='training') trn "
            "FROM content_modules WHERE status='live'"
        ).fetchone()
        live_ind = _rowget(_lv, "ind", 0) or 0
        live_trn = _rowget(_lv, "trn", 0) or 0
    except Exception:
        pass
    try:
        _dn = db.execute(
            "SELECT "
            " COUNT(*) FILTER (WHERE cm.kind='induction') ind, "
            " COUNT(*) FILTER (WHERE cm.kind='training') trn "
            "FROM module_completions mc "
            "JOIN content_modules cm ON cm.id=mc.module_id "
            "JOIN users u ON u.emp_id=mc.emp_id "
            "WHERE cm.status='live' AND u.role='staff' AND u.status='approved'"
        ).fetchone()
        done_ind = _rowget(_dn, "ind", 0) or 0
        done_trn = _rowget(_dn, "trn", 0) or 0
    except Exception:
        pass

    def _rate(live, done):
        denom = live * total_staff
        return min(100, round(done * 100 / denom)) if denom else 0

    induction_rate = _rate(live_ind, done_ind)
    training_rate = _rate(live_trn, done_trn)
    _mark("completion_rates")

    # average assessment score (best attempt per learner-assessment, staff)
    avg_score = 0
    try:
        rows = db.execute(
            "SELECT MAX(percent) best FROM assessment_results r "
            "JOIN users u ON u.emp_id=r.emp_id "
            "WHERE u.role='staff' GROUP BY r.emp_id, r.assessment_id"
        ).fetchall()
        if rows:
            avg_score = round(sum(x["best"] for x in rows) / len(rows))
    except Exception:
        avg_score = 0
    _mark("avg_score")

    # total_certs is folded into the funnel block below (one fewer round-trip)

    # ---- onboarding pulse (today) — reuse the combined users query above ----
    enrolled_today = _rowget(_ur, "enrolled_today", 0) or 0
    approved_total = total_staff
    logged_in = _rowget(_ur, "logged_in", 0) or 0
    never_logged = max(0, total_staff - logged_in)
    logged_in_today = _rowget(_ur, "logged_in_today", 0) or 0
    _mark("pulse")

    # ---- completion funnel (staff) ----
    # both module-completion funnels in ONE query (conditional distinct count);
    # was 2 separate round-trips.
    funnel_enrolled = total_staff
    funnel_induction = 0
    funnel_training = 0
    try:
        _fr = db.execute(
            "SELECT "
            " COUNT(DISTINCT mc.emp_id) FILTER (WHERE cm.kind='induction') ind, "
            " COUNT(DISTINCT mc.emp_id) FILTER (WHERE cm.kind<>'induction') trn "
            "FROM module_completions mc "
            "JOIN content_modules cm ON cm.id=mc.module_id "
            "JOIN users u ON u.emp_id=mc.emp_id "
            "WHERE cm.status='live' AND u.role='staff'"
        ).fetchone()
        funnel_induction = _rowget(_fr, "ind", 0) or 0
        funnel_training = _rowget(_fr, "trn", 0) or 0
    except Exception:
        pass
    # both certificate counts in one query: total issued + distinct staff certified
    total_certs = 0
    funnel_certified = 0
    try:
        _cc = db.execute(
            "SELECT "
            " (SELECT COUNT(*) FROM issued_certificates) total, "
            " (SELECT COUNT(DISTINCT ic.emp_id) FROM issued_certificates ic "
            "  JOIN users u ON u.emp_id=ic.emp_id WHERE u.role='staff') certified"
        ).fetchone()
        total_certs = _rowget(_cc, "total", 0) or 0
        funnel_certified = _rowget(_cc, "certified", 0) or 0
    except Exception:
        pass
    _mark("funnel")

    # ---- 30-day trend (completions + assessments per day) ----
    # BOTH series in ONE query (UNION ALL, tagged by source), grouped by the
    # UTC date prefix — down from 60 per-day queries, then 2, now 1.
    start_iso = (today - timedelta(days=29)).isoformat()
    comp_by_day, ass_by_day = {}, {}
    try:
        for r in db.execute(
            "SELECT 'c' src, substr(completed_at,1,10) d, COUNT(*) n FROM module_completions "
            "WHERE completed_at >= ? GROUP BY substr(completed_at,1,10) "
            "UNION ALL "
            "SELECT 'a' src, substr(taken_at,1,10) d, COUNT(*) n FROM assessment_results "
            "WHERE taken_at >= ? GROUP BY substr(taken_at,1,10)",
            (start_iso, start_iso)
        ).fetchall():
            d = r["d"]
            if not d:
                continue
            if r["src"] == "c":
                comp_by_day[d] = r["n"]
            else:
                ass_by_day[d] = r["n"]
    except Exception:
        pass

    trend = []
    for i in range(29, -1, -1):
        day = today - timedelta(days=i)
        key = day.isoformat()
        trend.append({"date": day.strftime("%d %b"),
                      "completions": comp_by_day.get(key, 0),
                      "assessments": ass_by_day.get(key, 0)})
    _mark("trend")

    # ---- needs attention ----
    names = _name_map(db)
    _mark("name_map")
    attention = []
    # inactive 7+ days (approved staff who did nothing in last 7 days, but have logged in before)
    try:
        for u in db.execute(
            "SELECT emp_id, name, last_login FROM users WHERE role='staff' AND status='approved'"
        ).fetchall():
            if u["emp_id"] in active_ids:
                continue
            attention.append({"emp_id": u["emp_id"], "name": u["name"],
                              "reason": "No activity in 7+ days"})
    except Exception:
        pass
    attention = attention[:12]
    _mark("attention")
    # repeat failers: >=3 failed attempts on the same assessment, none passed.
    # Single query: the "never passed" check is a NOT EXISTS, so no per-row
    # round-trip (was 1 extra query per failing group).
    repeat_failers = []
    try:
        for r in db.execute(
            "SELECT r.emp_id, r.assessment_id, a.title, COUNT(*) fails "
            "FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id "
            "WHERE r.passed=0 AND NOT EXISTS ("
            "  SELECT 1 FROM assessment_results p "
            "  WHERE p.emp_id=r.emp_id AND p.assessment_id=r.assessment_id AND p.passed=1) "
            "GROUP BY r.emp_id, r.assessment_id, a.title HAVING COUNT(*) >= 3 "
            "ORDER BY COUNT(*) DESC LIMIT 12"
        ).fetchall():
            repeat_failers.append({
                "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
                "assessment": r["title"], "fails": r["fails"]})
    except Exception:
        pass
    _mark("repeat_failers")

    # all four "today" cards in ONE query via scalar subqueries (was 3 round-trips)
    completions_today = assessments_today = passed_today = certs_today = 0
    try:
        _td = db.execute(
            "SELECT "
            " (SELECT COUNT(*) FROM module_completions WHERE completed_at >= ?) comp, "
            " (SELECT COUNT(*) FROM assessment_results WHERE taken_at >= ?) ass, "
            " (SELECT COUNT(*) FROM assessment_results WHERE taken_at >= ? AND passed=1) passed, "
            " (SELECT COUNT(*) FROM issued_certificates WHERE issued_at >= ?) certs",
            (today_iso, today_iso, today_iso, today_iso)
        ).fetchone()
        completions_today = _rowget(_td, "comp", 0) or 0
        assessments_today = _rowget(_td, "ass", 0) or 0
        passed_today = _rowget(_td, "passed", 0) or 0
        certs_today = _rowget(_td, "certs", 0) or 0
    except Exception:
        pass
    _mark("today_cards")

    return jsonify(
        ok=True,
        overview={
            "total_staff": total_staff,
            "active_week": active_week,
            "induction_rate": induction_rate,
            "training_rate": training_rate,
            "avg_score": avg_score,
            "total_certs": total_certs,
            # today cards
            "completions_today": completions_today,
            "assessments_today": assessments_today,
            "passed_today": passed_today,
            "certs_today": certs_today,
        },
        pulse={
            "enrolled_today": enrolled_today,
            "approved_total": approved_total,
            "logged_in": logged_in,
            "never_logged": never_logged,
            "logged_in_today": logged_in_today,
        },
        funnel={
            "enrolled": funnel_enrolled,
            "induction": funnel_induction,
            "training": funnel_training,
            "certified": funnel_certified,
        },
        trend=trend,
        attention=attention,
        repeat_failers=repeat_failers,
        _debug=({"total_ms": round((_time.perf_counter() - _t0) * 1000),
                 "steps": _marks} if _dbg else None),
    )


# ===============================================================
#  5) EMPLOYEE LIST  (for the picker — light)
# ===============================================================
@analytics_bp.route("/api/analytics/people")
@_staff_only
def api_analytics_people():
    db = _get_db()
    rows = db.execute(
        "SELECT emp_id, name, designation, status, COALESCE(activated,0) activated "
        "FROM users WHERE role='staff' ORDER BY name"
    ).fetchall()
    return jsonify(ok=True, people=[dict(r) for r in rows])


# ===============================================================
#  RATINGS  (Phase B)  — learner feedback
# ===============================================================
def _login_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        if _current_user() is None:
            return jsonify(ok=False, msg="Please sign in again."), 401
        return view(*a, **k)
    return wrapped


@analytics_bp.route("/api/rating/trainer-for-module")
@_login_only
def api_rating_trainer_for_module():
    """Which approved trainer delivered this module to the current learner
    (used to label the trainer being rated). Returns the most recent one."""
    u = _current_user()
    mid = request.args.get("module_id")
    db = _get_db()
    names = _name_map(db)
    row = db.execute(
        "SELECT trainer_id FROM training_delivery "
        "WHERE learner_id=? AND module_id=? AND status='approved' "
        "ORDER BY approved_at DESC, created_at DESC LIMIT 1",
        (u["emp_id"], mid)
    ).fetchone()
    tid = row["trainer_id"] if row else None
    return jsonify(ok=True, trainer_id=tid, trainer_name=(names.get(tid, "") if tid else ""))


@analytics_bp.route("/api/rating/trainers")
@_login_only
def api_rating_trainers():
    """All trainers (instructors + admins) a learner can pick when rating a
    module, plus the likely one for this module (shown pre-selected)."""
    u = _current_user()
    db = _get_db()
    rows = db.execute(
        "SELECT emp_id, name, designation FROM users "
        "WHERE role IN ('instructor','admin') AND status='approved' ORDER BY name"
    ).fetchall()
    trainers = [{"emp_id": r["emp_id"], "name": r["name"],
                 "designation": r["designation"] or ""} for r in rows]
    # suggest the recorded trainer for this module, if any
    suggested = None
    mid = request.args.get("module_id")
    if mid:
        row = db.execute(
            "SELECT trainer_id FROM training_delivery "
            "WHERE learner_id=? AND module_id=? AND status='approved' "
            "ORDER BY approved_at DESC, created_at DESC LIMIT 1",
            (u["emp_id"], mid)
        ).fetchone()
        if row:
            suggested = row["trainer_id"]
    return jsonify(ok=True, trainers=trainers, suggested=suggested)


@analytics_bp.route("/api/rating/my-rated")
@_login_only
def api_rating_my_rated():
    """IDs of modules (and course-assessments) the current learner has already
    rated — used to show 'Rate' vs '✓ Rated' on the module cards."""
    u = _current_user()
    db = _get_db()
    mods, courses = [], []
    if _table_exists(db, "training_ratings"):
        mods = [r["module_id"] for r in db.execute(
            "SELECT DISTINCT module_id FROM training_ratings WHERE emp_id=? AND module_id IS NOT NULL",
            (u["emp_id"],)).fetchall()]
        courses = [r["assessment_id"] for r in db.execute(
            "SELECT DISTINCT assessment_id FROM training_ratings WHERE emp_id=? AND assessment_id IS NOT NULL",
            (u["emp_id"],)).fetchall()]
    return jsonify(ok=True, modules=mods, courses=courses)


@analytics_bp.route("/api/rating/pending")
@_login_only
def api_rating_pending():
    """For the current learner: completed modules and passed courses that
    have NOT been rated yet. Returns a capped list (for the login catch-up)
    plus the full remaining count. Only meaningful for staff learners."""
    u = _current_user()
    db = _get_db()
    try:
        limit = int(request.args.get("limit") or 3)
    except (ValueError, TypeError):
        limit = 3
    if limit < 1:
        limit = 3

    emp = u["emp_id"]
    desg = (u["designation"] or "").strip().lower()

    def _roles_match(roles_field):
        roles = (roles_field or "all").strip().lower()
        if roles in ("", "all"):
            return True
        return any(a.strip() and a.strip() in desg for a in roles.split(","))

    pending = []

    # ----- completed modules without a rating -----
    rated_modules = set()
    if _table_exists(db, "training_ratings"):
        rated_modules = {r["module_id"] for r in db.execute(
            "SELECT module_id FROM training_ratings WHERE emp_id=? AND module_id IS NOT NULL", (emp,)
        ).fetchall()}
    done_modules = {r["module_id"] for r in db.execute(
        "SELECT module_id FROM module_completions WHERE emp_id=?", (emp,)
    ).fetchall()}
    if done_modules:
        ph = ",".join("?" * len(done_modules))
        for m in db.execute(
            "SELECT id, title, kind, roles FROM content_modules "
            "WHERE id IN (" + ph + ") AND status='live' ORDER BY kind, sort_order, id",
            list(done_modules)
        ).fetchall():
            if m["id"] in rated_modules:
                continue
            if not _roles_match(m["roles"]):
                continue
            pending.append({"type": "module", "id": m["id"], "title": m["title"]})

    # ----- passed assessments (courses) without a course rating -----
    rated_courses = set()
    if _table_exists(db, "training_ratings"):
        rated_courses = {r["assessment_id"] for r in db.execute(
            "SELECT assessment_id FROM training_ratings WHERE emp_id=? AND assessment_id IS NOT NULL", (emp,)
        ).fetchall()}
    for r in db.execute(
        "SELECT DISTINCT r.assessment_id, a.title FROM assessment_results r "
        "JOIN assessments a ON a.id=r.assessment_id "
        "WHERE r.emp_id=? AND r.passed=1", (emp,)
    ).fetchall():
        if r["assessment_id"] in rated_courses:
            continue
        pending.append({"type": "course", "id": r["assessment_id"], "title": r["title"]})

    total = len(pending)
    return jsonify(ok=True, total=total, items=pending[:limit],
                   is_staff=(u["role"] == "staff"))


@analytics_bp.route("/api/rating/submit", methods=["POST"])
@_login_only
def api_rating_submit():
    """Save a learner's rating. target_type 'module' => content+trainer;
    'course' => course rating. Required fields are validated."""
    u = _current_user()
    d = request.get_json(force=True)
    ttype = (d.get("target_type") or "").strip()
    comment = (d.get("comment") or "").strip()[:1000]
    db = _get_db()

    def _stars(v):
        try:
            n = int(v)
            return n if 1 <= n <= 5 else None
        except (ValueError, TypeError):
            return None

    now = datetime.utcnow().isoformat()

    if ttype == "module":
        mid = d.get("module_id")
        if not mid:
            return jsonify(ok=False, msg="Missing module."), 400
        content = _stars(d.get("content_rating"))
        trainer = _stars(d.get("trainer_rating"))
        if content is None or trainer is None:
            return jsonify(ok=False, msg="Please rate both content and trainer (1-5)."), 400
        tid = (d.get("trainer_id") or "").strip() or None
        # trainer must be chosen from the dropdown (required) and must be real
        if not tid:
            return jsonify(ok=False, msg="Please select the trainer who took this module."), 400
        valid = db.execute(
            "SELECT 1 FROM users WHERE emp_id=? AND role IN ('instructor','admin')", (tid,)
        ).fetchone()
        if not valid:
            return jsonify(ok=False, msg="Please select a valid trainer."), 400
        # upsert: one rating per learner per module
        existing = db.execute(
            "SELECT id FROM training_ratings WHERE emp_id=? AND module_id=?",
            (u["emp_id"], mid)
        ).fetchone()
        if existing:
            db.execute(
                "UPDATE training_ratings SET content_rating=?, trainer_rating=?, "
                "trainer_id=?, comment=?, created_at=? WHERE id=?",
                (content, trainer, tid, comment, now, existing["id"])
            )
        else:
            db.execute(
                "INSERT INTO training_ratings (emp_id,target_type,module_id,trainer_id,"
                "content_rating,trainer_rating,comment,created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (u["emp_id"], "module", mid, tid, content, trainer, comment, now)
            )
        db.commit()
        return jsonify(ok=True, msg="Thanks for your feedback!")

    elif ttype == "course":
        aid = d.get("assessment_id")
        if not aid:
            return jsonify(ok=False, msg="Missing course."), 400
        course = _stars(d.get("course_rating"))
        if course is None:
            return jsonify(ok=False, msg="Please rate the course (1-5)."), 400
        existing = db.execute(
            "SELECT id FROM training_ratings WHERE emp_id=? AND assessment_id=?",
            (u["emp_id"], aid)
        ).fetchone()
        if existing:
            db.execute(
                "UPDATE training_ratings SET course_rating=?, comment=?, created_at=? WHERE id=?",
                (course, comment, now, existing["id"])
            )
        else:
            db.execute(
                "INSERT INTO training_ratings (emp_id,target_type,assessment_id,"
                "course_rating,comment,created_at) VALUES (?,?,?,?,?,?)",
                (u["emp_id"], "course", aid, course, comment, now)
            )
        db.commit()
        return jsonify(ok=True, msg="Thanks for your feedback!")

    return jsonify(ok=False, msg="Unknown rating type."), 400


@analytics_bp.route("/api/analytics/feedback")
@_staff_only
def api_analytics_feedback():
    """Admin (all) or trainer (own only): rating comments + stars.
    Optional ?trainer_id= to filter."""
    u = _current_user()
    db = _get_db()
    names = _name_map(db)
    if not _table_exists(db, "training_ratings"):
        return jsonify(ok=True, feedback=[])

    want_trainer = (request.args.get("trainer_id") or "").strip()
    # a trainer (instructor) may only see their OWN feedback
    if u["role"] == "instructor":
        want_trainer = u["emp_id"]

    sql = ("SELECT r.*, COALESCE(cm.title,'') module_title, COALESCE(a.title,'') course_title "
           "FROM training_ratings r "
           "LEFT JOIN content_modules cm ON cm.id=r.module_id "
           "LEFT JOIN assessments a ON a.id=r.assessment_id ")
    args = []
    if want_trainer:
        sql += "WHERE r.trainer_id=? "
        args.append(want_trainer)
    sql += "ORDER BY r.created_at DESC LIMIT 400"

    out = []
    for r in db.execute(sql, args).fetchall():
        out.append({
            "id": r["id"],
            "when": _ist(r["created_at"]),
            "learner": names.get(r["emp_id"], r["emp_id"]),
            "type": r["target_type"],
            "about": (r["module_title"] if r["target_type"] == "module" else r["course_title"]),
            "trainer_id": r["trainer_id"] or "",
            "trainer": (names.get(r["trainer_id"], "") if r["trainer_id"] else ""),
            "content_rating": r["content_rating"],
            "trainer_rating": r["trainer_rating"],
            "course_rating": r["course_rating"],
            "comment": r["comment"] or "",
        })
    return jsonify(ok=True, feedback=out, is_admin=(u["role"] == "admin"))


@analytics_bp.route("/api/analytics/rating/update", methods=["POST"])
@_staff_only
def api_analytics_rating_update():
    """Admin only: correct a submitted rating — change the trainer it's
    attributed to and/or adjust the star values."""
    u = _current_user()
    if u["role"] != "admin":
        return jsonify(ok=False, msg="Only an admin can edit feedback."), 403
    d = request.get_json(force=True)
    rid = d.get("id")
    if not rid:
        return jsonify(ok=False, msg="Missing rating id."), 400
    db = _get_db()
    row = db.execute("SELECT * FROM training_ratings WHERE id=?", (rid,)).fetchone()
    if not row:
        return jsonify(ok=False, msg="Rating not found."), 404

    sets, vals = [], []
    # trainer change (validate it's a real trainer)
    if "trainer_id" in d:
        tid = (d.get("trainer_id") or "").strip() or None
        if tid:
            ok = db.execute("SELECT 1 FROM users WHERE emp_id=? AND role IN ('instructor','admin')", (tid,)).fetchone()
            if not ok:
                return jsonify(ok=False, msg="Please choose a valid trainer."), 400
        sets.append("trainer_id=?"); vals.append(tid)

    def _stars(v):
        try:
            n = int(v); return n if 1 <= n <= 5 else None
        except (ValueError, TypeError):
            return None

    for field in ("trainer_rating", "content_rating", "course_rating"):
        if field in d and d.get(field) is not None:
            s = _stars(d.get(field))
            if s is not None:
                sets.append(field + "=?"); vals.append(s)
    if "comment" in d:
        sets.append("comment=?"); vals.append((d.get("comment") or "").strip()[:1000])

    if not sets:
        return jsonify(ok=False, msg="Nothing to update."), 400
    vals.append(rid)
    db.execute("UPDATE training_ratings SET " + ", ".join(sets) + " WHERE id=?", vals)
    db.commit()
    return jsonify(ok=True, msg="Feedback updated.")


@analytics_bp.route("/api/analytics/rating/delete", methods=["POST"])
@_staff_only
def api_analytics_rating_delete():
    """Admin only: delete a rating (e.g. duplicate / junk)."""
    u = _current_user()
    if u["role"] != "admin":
        return jsonify(ok=False, msg="Only an admin can delete feedback."), 403
    d = request.get_json(force=True)
    rid = d.get("id")
    if not rid:
        return jsonify(ok=False, msg="Missing rating id."), 400
    db = _get_db()
    db.execute("DELETE FROM training_ratings WHERE id=?", (rid,))
    db.commit()
    return jsonify(ok=True, msg="Feedback removed.")


@analytics_bp.route("/api/analytics/rating/trainers-list")
@_staff_only
def api_analytics_rating_trainers_list():
    """Trainer list for the admin edit dropdown."""
    db = _get_db()
    rows = db.execute(
        "SELECT emp_id, name, designation FROM users "
        "WHERE role IN ('instructor','admin') AND status='approved' ORDER BY name"
    ).fetchall()
    return jsonify(ok=True, trainers=[{"emp_id": r["emp_id"], "name": r["name"],
                                       "designation": r["designation"] or ""} for r in rows])


# ===============================================================
#  REPORTS / EXPORT  (C5) — admin-only Excel downloads
# ===============================================================
def _admin_only_or_403():
    u = _current_user()
    if u is None or u["role"] != "admin":
        return None
    return u


def _date_window():
    """Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD. Returns (from_iso, to_excl_iso,
    label). Missing => no bound on that side. 'to' is made exclusive of the
    next day so the whole 'to' date is included. Values are compared against
    ISO-UTC text timestamps (same convention as the rest of this module)."""
    f = (request.args.get("from") or "").strip()
    t = (request.args.get("to") or "").strip()
    from_iso = f if f else None
    to_excl = None
    if t:
        try:
            d = datetime.fromisoformat(t).date() + timedelta(days=1)
            to_excl = d.isoformat()
        except Exception:
            to_excl = None
    if f and t:
        label = f + " to " + t
    elif f:
        label = "from " + f
    elif t:
        label = "up to " + t
    else:
        label = "All dates"
    return from_iso, to_excl, label


def _xlsx_response(wb, fname):
    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    from flask import Response
    return Response(
        bio.getvalue(),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="' + fname + '"'})


def _xlsx_styles():
    from openpyxl.styles import Font, PatternFill, Alignment
    return {
        "title": Font(bold=True, size=14, color="12284B"),
        "sub": Font(italic=True, size=10, color="64707A"),
        "hdrfont": Font(bold=True, color="FFFFFF"),
        "hdrfill": PatternFill("solid", fgColor="1F5FA9"),
        "center": Alignment(horizontal="center"),
        "wrap": Alignment(wrap_text=True, vertical="top"),
    }


def _ws_header(ws, st, title, sub, columns, start_row=4):
    ws["A1"] = title
    ws["A1"].font = st["title"]
    ws["A2"] = sub
    ws["A2"].font = st["sub"]
    ws["A3"] = "Generated " + _today_ist().strftime("%d %b %Y")
    ws["A3"].font = st["sub"]
    for i, (name, width) in enumerate(columns, start=1):
        c = ws.cell(row=start_row, column=i, value=name)
        c.font = st["hdrfont"]
        c.fill = st["hdrfill"]
        c.alignment = st["center"]
        ws.column_dimensions[chr(64 + i)].width = width
    return start_row + 1


@analytics_bp.route("/api/analytics/export/trainers")
@_staff_only
def api_export_trainers():
    if not _admin_only_or_403():
        return jsonify(ok=False, msg="Admin only."), 403
    from openpyxl import Workbook
    db = _get_db()
    rows = _build_trainer_kpis(db)
    st = _xlsx_styles()
    wb = Workbook(); ws = wb.active; ws.title = "Trainer KPIs"
    cols = [("Rank", 7), ("Trainer", 26), ("KPI score", 11), ("Learners", 10),
            ("Pass rate %", 12), ("Avg score %", 12), ("1st-attempt %", 14),
            ("Trainer rating", 14), ("Content rating", 14), ("OJT calls", 10),
            ("Deliveries", 11), ("Low data", 10)]
    r = _ws_header(ws, st, "Mr. Golisoda — Trainer KPI Scorecards",
                   "Cumulative (as of generation date)", cols)
    for i, t in enumerate(rows, 1):
        ws.append([i, t["trainer"], t["kpi_score"], t["learners"],
                   t["pass_rate"], t["avg_score"], t["first_attempt_rate"],
                   t["trainer_rating"], t["content_rating"], t["ojt_calls"],
                   t["deliveries"], ("yes" if t["low_data"] else "")])
    return _xlsx_response(wb, "trainer_kpis.xlsx")


@analytics_bp.route("/api/analytics/export/employees")
@_staff_only
def api_export_employees():
    if not _admin_only_or_403():
        return jsonify(ok=False, msg="Admin only."), 403
    from openpyxl import Workbook
    db = _get_db()
    names = _name_map(db)

    # live modules + active assessments, and per-emp done/passed sets
    ind = db.execute("SELECT id, roles FROM content_modules WHERE kind='induction' AND status='live'").fetchall()
    trn = db.execute("SELECT id, roles FROM content_modules WHERE kind='training' AND status='live'").fetchall()
    ass = db.execute("SELECT id, roles FROM assessments WHERE active=1").fetchall()
    done = {}
    for c in db.execute("SELECT emp_id, module_id FROM module_completions").fetchall():
        done.setdefault(c["emp_id"], set()).add(c["module_id"])
    passed = {}
    best = {}
    for r0 in db.execute("SELECT emp_id, assessment_id, MAX(percent) b, MAX(CASE WHEN passed=1 THEN 1 ELSE 0 END) p FROM assessment_results GROUP BY emp_id, assessment_id").fetchall():
        if r0["p"]:
            passed.setdefault(r0["emp_id"], set()).add(r0["assessment_id"])
        best.setdefault(r0["emp_id"], []).append(r0["b"])
    certs = {}
    for c in db.execute("SELECT emp_id, COUNT(*) n FROM issued_certificates GROUP BY emp_id").fetchall():
        certs[c["emp_id"]] = c["n"]
    # who trained each learner (approved)
    trained_by = {}
    for r0 in db.execute("SELECT learner_id, trainer_id FROM training_delivery WHERE status='approved'").fetchall():
        trained_by.setdefault(r0["learner_id"], set()).add(names.get(r0["trainer_id"], r0["trainer_id"]))

    def _match(roles, desg):
        roles = (roles or "all").strip().lower()
        if roles in ("", "all"):
            return True
        d = (desg or "").strip().lower()
        return any(a.strip() and a.strip() in d for a in roles.split(","))

    learners = db.execute(
        "SELECT emp_id, name, designation, status, COALESCE(activated,0) activated "
        "FROM users WHERE role='staff' ORDER BY designation, name").fetchall()

    st = _xlsx_styles()
    wb = Workbook(); ws = wb.active; ws.title = "Employee records"
    cols = [("Name", 24), ("Emp ID", 12), ("Designation", 24), ("Status", 11),
            ("Activated", 10), ("Induction done", 14), ("Training done", 14),
            ("Assessments passed", 18), ("Avg score %", 12), ("Certificates", 12),
            ("Trained by", 30)]
    r = _ws_header(ws, st, "Mr. Golisoda — Employee Training Records",
                   "Cumulative (as of generation date)", cols)
    for u in learners:
        desg = u["designation"]
        mi = [m for m in ind if _match(m["roles"], desg)]
        mt = [m for m in trn if _match(m["roles"], desg)]
        ma = [a for a in ass if _match(a["roles"], desg)]
        dn = done.get(u["emp_id"], set())
        pa = passed.get(u["emp_id"], set())
        scores = best.get(u["emp_id"], [])
        avg = round(sum(scores) / len(scores)) if scores else None
        ws.append([
            u["name"], u["emp_id"], desg, u["status"],
            ("yes" if u["activated"] else "no"),
            str(sum(1 for m in mi if m["id"] in dn)) + " / " + str(len(mi)),
            str(sum(1 for m in mt if m["id"] in dn)) + " / " + str(len(mt)),
            str(sum(1 for a in ma if a["id"] in pa)) + " / " + str(len(ma)),
            (avg if avg is not None else ""),
            certs.get(u["emp_id"], 0),
            ", ".join(sorted(trained_by.get(u["emp_id"], set()))),
        ])
    return _xlsx_response(wb, "employee_training_records.xlsx")


@analytics_bp.route("/api/analytics/export/activity")
@_staff_only
def api_export_activity():
    if not _admin_only_or_403():
        return jsonify(ok=False, msg="Admin only."), 403
    from openpyxl import Workbook
    db = _get_db()
    names = _name_map(db)
    from_iso, to_excl, label = _date_window()

    def _rng(col):
        w, a = [], []
        if from_iso:
            w.append(col + " >= ?"); a.append(from_iso)
        if to_excl:
            w.append(col + " < ?"); a.append(to_excl)
        return ((" WHERE " + " AND ".join(w)) if w else ""), a

    events = []
    w, a = _rng("mc.completed_at")
    for r0 in db.execute(
        "SELECT mc.emp_id, mc.completed_at ts, cm.title, cm.kind FROM module_completions mc "
        "LEFT JOIN content_modules cm ON cm.id=mc.module_id" + w, a).fetchall():
        events.append((_ist(r0["ts"]), names.get(r0["emp_id"], r0["emp_id"]),
                       ("Induction" if (r0["kind"] or "")=="induction" else "Training"),
                       r0["title"] or "module", "Completed"))
    w, a = _rng("r.taken_at")
    for r0 in db.execute(
        "SELECT r.emp_id, r.taken_at ts, r.percent, r.passed, a.title FROM assessment_results r "
        "LEFT JOIN assessments a ON a.id=r.assessment_id" + w, a).fetchall():
        events.append((_ist(r0["ts"]), names.get(r0["emp_id"], r0["emp_id"]), "Assessment",
                       r0["title"] or "assessment",
                       ("PASS " if r0["passed"] else "FAIL ") + str(r0["percent"]) + "%"))
    w, a = _rng("issued_at")
    for r0 in db.execute(
        "SELECT emp_id, cert_name, issued_at ts FROM issued_certificates" + w, a).fetchall():
        events.append((_ist(r0["ts"]), names.get(r0["emp_id"], r0["emp_id"]), "Certificate",
                       r0["cert_name"] or "Certificate", "Issued"))
    if _table_exists(db, "ojt_calls"):
        try:
            w, a = _rng("oc.called_at")
            for r0 in db.execute(
                "SELECT oc.called_by, oc.called_at ts, oc.outcome, oc.day_no, e.emp_id learner_id "
                "FROM ojt_calls oc LEFT JOIN ojt_enrollments e ON e.id=oc.enrollment_id" + w, a).fetchall():
                events.append((_ist(r0["ts"]), names.get(r0["learner_id"], r0["learner_id"] or ""),
                               "OJT call", "Day " + str(r0["day_no"] or "") + " · " + names.get(r0["called_by"], r0["called_by"] or ""),
                               r0["outcome"] or "Called"))
        except Exception:
            pass
    events.sort(key=lambda e: e[0], reverse=True)

    st = _xlsx_styles()
    wb = Workbook(); ws = wb.active; ws.title = "Activity"
    cols = [("Date", 13), ("Person", 24), ("Type", 14), ("Detail", 36), ("Result", 16)]
    _ws_header(ws, st, "Mr. Golisoda — Activity Log", "Period: " + label, cols)
    for e in events:
        ws.append(list(e))
    return _xlsx_response(wb, "activity_log.xlsx")


@analytics_bp.route("/api/analytics/export/feedback")
@_staff_only
def api_export_feedback():
    if not _admin_only_or_403():
        return jsonify(ok=False, msg="Admin only."), 403
    from openpyxl import Workbook
    db = _get_db()
    names = _name_map(db)
    from_iso, to_excl, label = _date_window()
    if not _table_exists(db, "training_ratings"):
        wb = Workbook(); ws = wb.active; ws.title = "Feedback"
        ws["A1"] = "No feedback table."
        return _xlsx_response(wb, "feedback_report.xlsx")

    w, a = [], []
    if from_iso:
        w.append("r.created_at >= ?"); a.append(from_iso)
    if to_excl:
        w.append("r.created_at < ?"); a.append(to_excl)
    where = (" WHERE " + " AND ".join(w)) if w else ""
    rows = db.execute(
        "SELECT r.created_at, r.emp_id, r.target_type, r.trainer_id, "
        "r.content_rating, r.trainer_rating, r.course_rating, r.comment, "
        "COALESCE(cm.title,'') mtitle, COALESCE(a.title,'') ctitle "
        "FROM training_ratings r "
        "LEFT JOIN content_modules cm ON cm.id=r.module_id "
        "LEFT JOIN assessments a ON a.id=r.assessment_id" + where +
        " ORDER BY r.created_at DESC", a).fetchall()

    st = _xlsx_styles()
    wb = Workbook(); ws = wb.active; ws.title = "Feedback"
    cols = [("Date", 13), ("Learner", 22), ("About", 30), ("Trainer", 22),
            ("Trainer ★", 10), ("Content ★", 10), ("Course ★", 10), ("Comment", 50)]
    _ws_header(ws, st, "Mr. Golisoda — Learner Feedback Report", "Period: " + label, cols)
    for r0 in rows:
        about = r0["mtitle"] if r0["target_type"] == "module" else r0["ctitle"]
        cell_row = [
            _ist(r0["created_at"]), names.get(r0["emp_id"], r0["emp_id"]), about,
            (names.get(r0["trainer_id"], "") if r0["trainer_id"] else ""),
            r0["trainer_rating"], r0["content_rating"], r0["course_rating"],
            r0["comment"] or "",
        ]
        ws.append(cell_row)
        ws.cell(row=ws.max_row, column=8).alignment = st["wrap"]
    return _xlsx_response(wb, "feedback_report.xlsx")


def init_analytics(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(analytics_bp)
