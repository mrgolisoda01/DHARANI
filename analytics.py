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
@analytics_bp.route("/api/analytics/trainers")
@_staff_only
def api_analytics_trainers():
    """Per trainer: modules delivered, distinct learners trained, and
    those learners' average assessment score & pass rate."""
    db = _get_db()
    names = _name_map(db)

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
    max_calls = max(calls_map.values()) if calls_map else 0
    max_deliveries = max((s["deliveries"] for s in stats.values()), default=0)

    for t, s in stats.items():
        learner_ids = list(s["learners"])
        avg_score = None
        pass_rate = None
        first_attempt_rate = None
        if learner_ids:
            ph = ",".join("?" * len(learner_ids))
            rows = db.execute(
                "SELECT emp_id, assessment_id, MAX(percent) best, "
                "MAX(CASE WHEN passed=1 THEN 1 ELSE 0 END) passed "
                "FROM assessment_results WHERE emp_id IN (" + ph + ") "
                "GROUP BY emp_id, assessment_id", learner_ids
            ).fetchall()
            if rows:
                avg_score = round(sum(x["best"] for x in rows) / len(rows))
                pass_rate = round(sum(x["passed"] for x in rows) * 100 / len(rows))

            # first-attempt pass: for each learner+assessment, did the EARLIEST
            # attempt pass? (id ascending = chronological)
            fa = db.execute(
                "SELECT emp_id, assessment_id, passed FROM assessment_results r1 "
                "WHERE emp_id IN (" + ph + ") AND id = ("
                "  SELECT MIN(id) FROM assessment_results r2 "
                "  WHERE r2.emp_id=r1.emp_id AND r2.assessment_id=r1.assessment_id)",
                learner_ids
            ).fetchall()
            if fa:
                first_attempt_rate = round(sum(1 for x in fa if x["passed"]) * 100 / len(fa))

        rr = rate_map.get(t)
        trainer_rating = (round(rr["avg_tr"], 1) if rr and rr["avg_tr"] is not None else None)
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
            "content_rating": (round(rr["avg_ct"], 1) if rr and rr["avg_ct"] is not None else None),
            "kpi_score": kpi_score,
            "low_data": low_data,
        })
    out.sort(key=lambda x: (-(x["kpi_score"]), -(x["learners"]), x["trainer"]))
    return jsonify(ok=True, trainers=out,
                   kpi_weights={"pass": 30, "score": 20, "first_attempt": 20, "rating": 20, "engagement": 10})


@analytics_bp.route("/api/analytics/trainer")
@_staff_only
def api_analytics_trainer_detail():
    """Drill-in for one trainer: their learners (with scores), modules they
    delivered, rating breakdown, and recent feedback comments."""
    tid = (request.args.get("id") or "").strip()
    if not tid:
        return jsonify(ok=False, msg="Missing trainer id."), 400
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
                "trainer_avg": (round(rb["ta"], 1) if rb["ta"] is not None else None),
                "content_avg": (round(rb["ca"], 1) if rb["ca"] is not None else None),
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
    db = _get_db()
    today = _today_ist()
    today_iso = today.isoformat()
    week_iso = (today - timedelta(days=7)).isoformat()

    def _count(sql, args=()):
        try:
            return db.execute(sql, args).fetchone()["c"]
        except Exception:
            return 0

    # ---- top KPI cards ----
    total_staff = _count("SELECT COUNT(*) c FROM users WHERE status='approved' AND role='staff'")

    # active this week = did any module/assessment/video in last 7 days
    active_ids = set()
    for sql in (
        "SELECT DISTINCT emp_id FROM module_completions WHERE completed_at >= ?",
        "SELECT DISTINCT emp_id FROM assessment_results WHERE taken_at >= ?",
    ):
        try:
            for r in db.execute(sql, (week_iso,)).fetchall():
                active_ids.add(r["emp_id"])
        except Exception:
            pass
    if _table_exists(db, "video_completions"):
        try:
            for r in db.execute("SELECT DISTINCT emp_id FROM video_completions WHERE completed_at >= ?", (week_iso,)).fetchall():
                active_ids.add(r["emp_id"])
        except Exception:
            pass
    active_week = len(active_ids)

    # induction & training completion rate (completed vs expected, staff only)
    def _completion_rate(kind):
        # total live modules of this kind, matched to each staff by role, is heavy;
        # use a simpler proxy: completions / (staff * live-modules-of-kind) across "all" modules.
        live = _count("SELECT COUNT(*) c FROM content_modules WHERE status='live' AND kind=?", (kind,))
        if not live or not total_staff:
            return 0
        done = _count(
            "SELECT COUNT(*) c FROM module_completions mc "
            "JOIN content_modules cm ON cm.id=mc.module_id "
            "JOIN users u ON u.emp_id=mc.emp_id "
            "WHERE cm.status='live' AND cm.kind=? AND u.role='staff' AND u.status='approved'", (kind,))
        denom = live * total_staff
        return min(100, round(done * 100 / denom)) if denom else 0

    induction_rate = _completion_rate("induction")
    training_rate = _completion_rate("training")

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

    total_certs = _count("SELECT COUNT(*) c FROM issued_certificates")

    # ---- onboarding pulse (today) ----
    enrolled_today = _count(
        "SELECT COUNT(*) c FROM users WHERE role='staff' AND created_at >= ?", (today_iso,))
    approved_total = total_staff
    # logged in at least once vs never (approved staff)
    logged_in = _count(
        "SELECT COUNT(*) c FROM users WHERE role='staff' AND status='approved' AND last_login IS NOT NULL AND last_login<>''")
    never_logged = max(0, total_staff - logged_in)
    # logged in today
    logged_in_today = _count(
        "SELECT COUNT(*) c FROM users WHERE role='staff' AND last_login >= ?", (today_iso,))

    # ---- completion funnel (staff) ----
    funnel_enrolled = total_staff
    # did >=1 induction module
    funnel_induction = _count(
        "SELECT COUNT(DISTINCT mc.emp_id) c FROM module_completions mc "
        "JOIN content_modules cm ON cm.id=mc.module_id "
        "JOIN users u ON u.emp_id=mc.emp_id "
        "WHERE cm.kind='induction' AND cm.status='live' AND u.role='staff'")
    # did >=1 training module
    funnel_training = _count(
        "SELECT COUNT(DISTINCT mc.emp_id) c FROM module_completions mc "
        "JOIN content_modules cm ON cm.id=mc.module_id "
        "JOIN users u ON u.emp_id=mc.emp_id "
        "WHERE cm.kind<>'induction' AND cm.status='live' AND u.role='staff'")
    # earned >=1 certificate
    funnel_certified = _count(
        "SELECT COUNT(DISTINCT ic.emp_id) c FROM issued_certificates ic "
        "JOIN users u ON u.emp_id=ic.emp_id WHERE u.role='staff'")

    # ---- 30-day trend (completions + assessments per day) ----
    trend = []
    for i in range(29, -1, -1):
        day = today - timedelta(days=i)
        d0 = day.isoformat()
        d1 = (day + timedelta(days=1)).isoformat()
        comp = _count("SELECT COUNT(*) c FROM module_completions WHERE completed_at >= ? AND completed_at < ?", (d0, d1))
        ass = _count("SELECT COUNT(*) c FROM assessment_results WHERE taken_at >= ? AND taken_at < ?", (d0, d1))
        trend.append({"date": day.strftime("%d %b"), "completions": comp, "assessments": ass})

    # ---- needs attention ----
    names = _name_map(db)
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
    # repeat failers: >=3 failed attempts on the same assessment, none passed
    repeat_failers = []
    try:
        for r in db.execute(
            "SELECT r.emp_id, r.assessment_id, a.title, COUNT(*) fails "
            "FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id "
            "WHERE r.passed=0 GROUP BY r.emp_id, r.assessment_id, a.title HAVING COUNT(*) >= 3"
        ).fetchall():
            # skip if they eventually passed it
            passed = db.execute(
                "SELECT 1 FROM assessment_results WHERE emp_id=? AND assessment_id=? AND passed=1 LIMIT 1",
                (r["emp_id"], r["assessment_id"])).fetchone()
            if passed:
                continue
            repeat_failers.append({
                "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
                "assessment": r["title"], "fails": r["fails"]})
    except Exception:
        pass
    repeat_failers = repeat_failers[:12]

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
            "completions_today": _count("SELECT COUNT(*) c FROM module_completions WHERE completed_at >= ?", (today_iso,)),
            "assessments_today": _count("SELECT COUNT(*) c FROM assessment_results WHERE taken_at >= ?", (today_iso,)),
            "passed_today": _count("SELECT COUNT(*) c FROM assessment_results WHERE taken_at >= ? AND passed=1", (today_iso,)),
            "certs_today": _count("SELECT COUNT(*) c FROM issued_certificates WHERE issued_at >= ?", (today_iso,)),
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


def init_analytics(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(analytics_bp)
