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

    # module completions
    for r in db.execute(
        "SELECT mc.emp_id, mc.completed_at, cm.title, cm.kind "
        "FROM module_completions mc LEFT JOIN content_modules cm ON cm.id=mc.module_id "
        "WHERE mc.completed_at >= ? ORDER BY mc.completed_at DESC", (since_iso,)
    ).fetchall():
        events.append({
            "when": _ist(r["completed_at"]), "ts": str(r["completed_at"]),
            "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
            "type": "module", "detail": (r["kind"] or "module").title() + ": " + (r["title"] or ""),
            "result": "Completed",
        })

    # video completions
    if _table_exists(db, "video_completions"):
        for r in db.execute(
            "SELECT vc.emp_id, vc.completed_at, v.title "
            "FROM video_completions vc LEFT JOIN videos v ON v.id=vc.video_id "
            "WHERE vc.completed_at >= ? ORDER BY vc.completed_at DESC", (since_iso,)
        ).fetchall():
            events.append({
                "when": _ist(r["completed_at"]), "ts": str(r["completed_at"]),
                "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
                "type": "video", "detail": "Video: " + (r["title"] or ""),
                "result": "Watched",
            })

    # assessment attempts
    for r in db.execute(
        "SELECT r.emp_id, r.taken_at, r.percent, r.passed, a.title "
        "FROM assessment_results r LEFT JOIN assessments a ON a.id=r.assessment_id "
        "WHERE r.taken_at >= ? ORDER BY r.taken_at DESC", (since_iso,)
    ).fetchall():
        events.append({
            "when": _ist(r["taken_at"]), "ts": str(r["taken_at"]),
            "emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
            "type": "assessment", "detail": "Assessment: " + (r["title"] or ""),
            "result": ("PASS " if r["passed"] else "FAIL ") + str(r["percent"]) + "%",
        })

    events.sort(key=lambda e: e["ts"], reverse=True)
    return jsonify(ok=True, range=rng, count=len(events), events=events[:500])


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
    for t, s in stats.items():
        learner_ids = list(s["learners"])
        avg_score = None
        pass_rate = None
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
        out.append({
            "trainer_id": t, "trainer": names.get(t, t),
            "learners": len(s["learners"]),
            "deliveries": s["deliveries"],
            "modules": len(s["modules"]),
            "avg_score": avg_score,
            "pass_rate": pass_rate,
        })
    out.sort(key=lambda x: (-(x["learners"]), x["trainer"]))
    return jsonify(ok=True, trainers=out)


# ===============================================================
#  4) OVERVIEW SUMMARY  (top cards)
# ===============================================================
@analytics_bp.route("/api/analytics/overview")
@_staff_only
def api_analytics_overview():
    db = _get_db()
    today_iso = _today_ist().isoformat()

    def _count(sql, args=()):
        try:
            return db.execute(sql, args).fetchone()["c"]
        except Exception:
            return 0

    total_staff = _count("SELECT COUNT(*) c FROM users WHERE status='approved' AND role='staff'")
    completions_today = _count(
        "SELECT COUNT(*) c FROM module_completions WHERE completed_at >= ?", (today_iso,))
    assess_today = _count(
        "SELECT COUNT(*) c FROM assessment_results WHERE taken_at >= ?", (today_iso,))
    passed_today = _count(
        "SELECT COUNT(*) c FROM assessment_results WHERE taken_at >= ? AND passed=1", (today_iso,))
    certs_today = _count(
        "SELECT COUNT(*) c FROM issued_certificates WHERE issued_at >= ?", (today_iso,))

    return jsonify(
        ok=True,
        overview={
            "total_staff": total_staff,
            "completions_today": completions_today,
            "assessments_today": assess_today,
            "passed_today": passed_today,
            "certs_today": certs_today,
        },
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


def init_analytics(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(analytics_bp)
