# ===============================================================
#  Home dashboard module (dashboard.py)
#  One role-aware endpoint: /api/dashboard/home
#   - admin      : whole-company numbers, attention strip, charts
#   - instructor : their own trainees + their pending submissions
#   - learner    : their own progress (assessments, certs, OJT)
# ===============================================================
from datetime import datetime, timedelta
from functools import wraps
from flask import Blueprint, jsonify

dashboard_bp = Blueprint("dashboard", __name__)
_get_db = None
_current_user = None


def _login_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        if _current_user() is None:
            return jsonify(ok=False, msg="Please sign in again."), 401
        return view(*a, **k)
    return wrapped


def _one(db, sql, params=()):
    r = db.execute(sql, params).fetchone()
    return r


def _c(db, sql, params=()):
    r = _one(db, sql, params)
    return (r["c"] if r and "c" in r.keys() else 0) or 0


def _admin_home(db):
    total = _c(db, "SELECT COUNT(*) c FROM users WHERE role != 'admin'")
    approved = _c(db, "SELECT COUNT(*) c FROM users WHERE status='approved' AND role != 'admin'")
    pending = _c(db, "SELECT COUNT(*) c FROM users WHERE status='pending'")
    instructors = _c(db, "SELECT COUNT(*) c FROM users WHERE role='instructor' AND status='approved'")
    passed_any = _c(db,
        "SELECT COUNT(DISTINCT r.emp_id) c FROM assessment_results r "
        "JOIN users u ON u.emp_id=r.emp_id WHERE r.passed=1 AND u.status='approved' AND u.role!='admin'")
    completion = min(100, round(passed_any * 100 / approved)) if approved else 0
    avg_row = _one(db,
        "SELECT AVG(r.percent) a FROM assessment_results r JOIN users u ON u.emp_id=r.emp_id "
        "WHERE u.status='approved' AND u.role!='admin'")
    avg_score = round(avg_row["a"]) if avg_row and avg_row["a"] is not None else 0

    # approvals waiting (employees + content + ojt change requests)
    appr_emp = pending
    appr_content = _safe(db, "SELECT COUNT(*) c FROM content_items WHERE status='pending'")
    appr_ojt = _safe(db, "SELECT COUNT(*) c FROM pending_actions WHERE action_type IN ('ojt_tasks','ojt_tag','ojt_topic') AND status='pending'")
    appr_total = appr_emp + appr_content + appr_ojt

    # OJT
    ojt_active = _safe(db, "SELECT COUNT(*) c FROM ojt_enrollments WHERE status='active'")
    ojt_done = _safe(db, "SELECT COUNT(*) c FROM ojt_enrollments WHERE status='completed'")
    # audits
    aud_submitted = _safe(db, "SELECT COUNT(*) c FROM audit_reports WHERE status='submitted'")
    aud_verified = _safe(db, "SELECT COUNT(*) c FROM audit_reports WHERE status='verified'")

    # chart: learners by designation (top 8)
    desig = []
    for r in db.execute(
        "SELECT COALESCE(NULLIF(designation,''),'(none)') d, COUNT(*) c FROM users "
        "WHERE status='approved' AND role!='admin' GROUP BY designation ORDER BY c DESC LIMIT 8").fetchall():
        desig.append({"label": r["d"], "value": r["c"]})

    # chart: assessment pass vs fail (active learners)
    pass_cnt = _c(db,
        "SELECT COUNT(*) c FROM assessment_results r JOIN users u ON u.emp_id=r.emp_id "
        "WHERE r.passed=1 AND u.status='approved' AND u.role!='admin'")
    fail_cnt = _c(db,
        "SELECT COUNT(*) c FROM assessment_results r JOIN users u ON u.emp_id=r.emp_id "
        "WHERE r.passed=0 AND u.status='approved' AND u.role!='admin'")

    # recent activity (best-effort)
    recent = []
    try:
        for r in db.execute(
            "SELECT when_ts, actor_name, action, affected FROM activity_log ORDER BY id DESC LIMIT 6").fetchall():
            recent.append({"when": r["when_ts"], "who": r["actor_name"], "action": r["action"], "what": r["affected"]})
    except Exception:
        pass

    return {
        "role": "admin",
        "cards": [
            {"label": "Employees", "value": total, "tab": "emp"},
            {"label": "Active learners", "value": approved, "tab": "emp"},
            {"label": "Instructors", "value": instructors, "tab": "set"},
            {"label": "Pending approvals", "value": appr_total, "tab": "appr", "alert": appr_total > 0},
            {"label": "Completion rate", "value": str(completion) + "%", "tab": "prog"},
            {"label": "Average score", "value": str(avg_score) + "%", "tab": "prog"},
            {"label": "OJT in training", "value": ojt_active, "tab": "ojt"},
            {"label": "Audits to verify", "value": aud_submitted, "tab": "audit", "alert": aud_submitted > 0},
        ],
        "attention": _attention(appr_emp, appr_content, appr_ojt, aud_submitted),
        "charts": {
            "designation": desig,
            "assessments": [{"label": "Passed", "value": pass_cnt}, {"label": "Failed", "value": fail_cnt}],
        },
        "ojt": {"active": ojt_active, "completed": ojt_done},
        "audits": {"submitted": aud_submitted, "verified": aud_verified},
        "recent": recent,
    }


def _safe(db, sql, params=()):
    try:
        return _c(db, sql, params)
    except Exception:
        return 0


def _attention(appr_emp, appr_content, appr_ojt, aud_submitted):
    items = []
    if appr_emp:
        items.append({"text": str(appr_emp) + " employee(s) awaiting approval", "tab": "appr"})
    if appr_content:
        items.append({"text": str(appr_content) + " content item(s) to review", "tab": "appr"})
    if appr_ojt:
        items.append({"text": str(appr_ojt) + " OJT change request(s)", "tab": "ojt"})
    if aud_submitted:
        items.append({"text": str(aud_submitted) + " audit(s) to verify", "tab": "audit"})
    return items


def _instructor_home(db, u):
    mine = u["emp_id"]
    ojt_mine = _safe(db, "SELECT COUNT(*) c FROM ojt_enrollments WHERE trainer_id=? AND status='active'", (mine,))
    ojt_done = _safe(db, "SELECT COUNT(*) c FROM ojt_enrollments WHERE trainer_id=? AND status='completed'", (mine,))
    my_pending = _safe(db,
        "SELECT COUNT(*) c FROM pending_actions WHERE requested_by=? AND action_type IN ('ojt_tasks','ojt_tag','ojt_topic') AND status='pending'",
        (mine,))
    aud_submitted = _safe(db, "SELECT COUNT(*) c FROM audit_reports WHERE status='submitted'")
    return {
        "role": "instructor",
        "cards": [
            {"label": "My trainees (active)", "value": ojt_mine, "tab": "ojt"},
            {"label": "My trainees (completed)", "value": ojt_done, "tab": "ojt"},
            {"label": "My pending requests", "value": my_pending, "tab": "ojt"},
            {"label": "Audits to verify", "value": aud_submitted, "tab": "audit"},
        ],
        "attention": ([{"text": str(ojt_mine) + " trainee(s) in OJT with you", "tab": "ojt"}] if ojt_mine else []),
        "charts": {}, "ojt": {"active": ojt_mine, "completed": ojt_done},
    }


def _learner_home(db, u):
    mine = u["emp_id"]
    taken = _safe(db, "SELECT COUNT(DISTINCT assessment_id) c FROM assessment_results WHERE emp_id=?", (mine,))
    passed = _safe(db, "SELECT COUNT(DISTINCT assessment_id) c FROM assessment_results WHERE emp_id=? AND passed=1", (mine,))
    certs = _safe(db, "SELECT COUNT(*) c FROM certificates WHERE emp_id=?", (mine,))
    avg_row = None
    try:
        avg_row = _one(db, "SELECT AVG(percent) a FROM assessment_results WHERE emp_id=?", (mine,))
    except Exception:
        pass
    my_avg = round(avg_row["a"]) if avg_row and avg_row["a"] is not None else 0
    ojt = _one(db, "SELECT status FROM ojt_enrollments WHERE emp_id=? ORDER BY id DESC LIMIT 1", (mine,)) if _has_ojt(db) else None
    ojt_status = (ojt["status"] if ojt else "—")
    return {
        "role": "learner",
        "cards": [
            {"label": "Assessments passed", "value": str(passed) + " / " + str(taken)},
            {"label": "My average score", "value": str(my_avg) + "%"},
            {"label": "Certificates earned", "value": certs},
            {"label": "My OJT", "value": ojt_status.title()},
        ],
        "attention": [], "charts": {},
    }


def _has_ojt(db):
    try:
        db.execute("SELECT 1 FROM ojt_enrollments LIMIT 1")
        return True
    except Exception:
        return False


@dashboard_bp.route("/api/dashboard/home")
@_login_only
def api_dashboard_home():
    db = _get_db()
    u = _current_user()
    try:
        if u["role"] == "admin":
            data = _admin_home(db)
        elif u["role"] == "instructor":
            data = _instructor_home(db, u)
        else:
            data = _learner_home(db, u)
    except Exception as e:
        return jsonify(ok=False, msg="Could not load dashboard."), 200
    data["me"] = {"name": u["name"], "emp_id": u["emp_id"]}
    return jsonify(ok=True, **data)


def init_dashboard(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(dashboard_bp)
