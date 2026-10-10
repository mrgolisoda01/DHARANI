# ===============================================================
#  Home dashboard module (dashboard.py)
#  One role-aware endpoint: /api/dashboard/home
#   - admin      : whole-company numbers, attention strip, charts
#   - instructor : their own trainees + their pending submissions
#   - learner    : their own progress (assessments, certs, OJT)
#
#  PERFORMANCE (Oct 2026):
#   - _admin_home combines what used to be ~18 separate COUNT queries
#     into a handful of grouped queries, cutting database round-trips
#     (each round-trip to Supabase costs ~300-400ms, so this is the
#     main speed win).
#   - /api/dashboard/home results are cached per-user for 45 seconds,
#     so repeated opens return instantly instead of re-querying.
# ===============================================================
import time
from datetime import datetime, timedelta
from functools import wraps
from flask import Blueprint, jsonify, request

dashboard_bp = Blueprint("dashboard", __name__)
_get_db = None
_current_user = None

# ---- tiny in-memory cache for the home dashboard -----------------
# key -> (expires_at_epoch, payload_dict).  Per-process; resets on
# redeploy.  TTL kept short so numbers are never more than ~45s old.
_HOME_CACHE = {}
_HOME_TTL = 45  # seconds


def _cache_get(key):
    hit = _HOME_CACHE.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    if hit:
        _HOME_CACHE.pop(key, None)  # expired
    return None


def _cache_put(key, payload):
    _HOME_CACHE[key] = (time.time() + _HOME_TTL, payload)
    # opportunistic cleanup so the dict can't grow forever
    if len(_HOME_CACHE) > 200:
        now = time.time()
        for k in [k for k, v in _HOME_CACHE.items() if v[0] <= now]:
            _HOME_CACHE.pop(k, None)


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


def _row_get(r, key, default=0):
    """Safe column read from a DB row that may be a dict-like Row."""
    try:
        if r is None:
            return default
        v = r[key] if key in r.keys() else default
        return default if v is None else v
    except Exception:
        return default


def _c(db, sql, params=()):
    r = _one(db, sql, params)
    return _row_get(r, "c", 0)


def _safe(db, sql, params=()):
    try:
        return _c(db, sql, params)
    except Exception:
        return 0


def _safe_row(db, sql, params=()):
    try:
        return _one(db, sql, params)
    except Exception:
        return None


# -----------------------------------------------------------------
#  ADMIN HOME — combined queries (few round-trips instead of ~18)
# -----------------------------------------------------------------
def _admin_home(db):
    # ---- 1) all user counts in ONE grouped query -----------------
    # rows of (status, role, count) -> we fold them into the numbers
    # we need, so we hit the users table once instead of 5 times.
    total = approved = pending = instructors = 0
    try:
        for r in db.execute(
            "SELECT status, role, COUNT(*) c FROM users GROUP BY status, role"
        ).fetchall():
            st = (_row_get(r, "status", "") or "")
            role = (_row_get(r, "role", "") or "")
            cnt = _row_get(r, "c", 0)
            if role != "admin":
                total += cnt
                if st == "approved":
                    approved += cnt
                    if role == "instructor":
                        instructors += cnt
            if st == "pending":
                pending += cnt
    except Exception:
        pass

    # ---- 2) assessment stats in ONE query ------------------------
    # distinct passed learners, pass rows, fail rows, avg percent —
    # all from a single join over active learners.
    passed_any = pass_cnt = fail_cnt = 0
    avg_score = 0
    try:
        r = _one(db,
            "SELECT "
            " COUNT(DISTINCT CASE WHEN r.passed=1 THEN r.emp_id END) distinct_passed, "
            " SUM(CASE WHEN r.passed=1 THEN 1 ELSE 0 END) pass_rows, "
            " SUM(CASE WHEN r.passed=0 THEN 1 ELSE 0 END) fail_rows, "
            " AVG(r.percent) avg_pct "
            "FROM assessment_results r JOIN users u ON u.emp_id=r.emp_id "
            "WHERE u.status='approved' AND u.role!='admin'")
        if r is not None:
            passed_any = _row_get(r, "distinct_passed", 0)
            pass_cnt = _row_get(r, "pass_rows", 0)
            fail_cnt = _row_get(r, "fail_rows", 0)
            avg_raw = _row_get(r, "avg_pct", None)
            avg_score = round(avg_raw) if avg_raw is not None else 0
    except Exception:
        pass

    completion = min(100, round(passed_any * 100 / approved)) if approved else 0

    # ---- 3) content + ojt approvals in combined queries ----------
    appr_emp = pending
    appr_content = _safe(db, "SELECT COUNT(*) c FROM content_modules WHERE status='pending'")
    appr_ojt = _safe(db,
        "SELECT COUNT(*) c FROM pending_actions "
        "WHERE action_type IN ('ojt_tasks','ojt_tag','ojt_topic') AND status='pending'")
    appr_total = appr_emp + appr_content + appr_ojt

    # ---- 4) OJT active/completed in ONE grouped query ------------
    ojt_active = ojt_done = 0
    try:
        for r in db.execute(
            "SELECT status, COUNT(*) c FROM ojt_enrollments GROUP BY status").fetchall():
            st = (_row_get(r, "status", "") or "")
            cnt = _row_get(r, "c", 0)
            if st == "active":
                ojt_active = cnt
            elif st == "completed":
                ojt_done = cnt
    except Exception:
        pass

    # ---- 5) audits submitted/verified in ONE grouped query -------
    aud_submitted = aud_verified = 0
    try:
        for r in db.execute(
            "SELECT status, COUNT(*) c FROM audit_reports GROUP BY status").fetchall():
            st = (_row_get(r, "status", "") or "")
            cnt = _row_get(r, "c", 0)
            if st == "submitted":
                aud_submitted = cnt
            elif st == "verified":
                aud_verified = cnt
    except Exception:
        pass

    # ---- 6) chart: learners by designation (top 8) ---------------
    desig = []
    try:
        for r in db.execute(
            "SELECT COALESCE(NULLIF(designation,''),'(none)') d, COUNT(*) c FROM users "
            "WHERE status='approved' AND role!='admin' GROUP BY designation ORDER BY c DESC LIMIT 8").fetchall():
            desig.append({"label": _row_get(r, "d", "(none)"), "value": _row_get(r, "c", 0)})
    except Exception:
        desig = []

    # ---- 7) recent activity (best-effort) ------------------------
    recent = []
    try:
        for r in db.execute(
            "SELECT created_at, actor_name, action, target_label FROM activity_log ORDER BY id DESC LIMIT 6").fetchall():
            recent.append({
                "when": _row_get(r, "created_at", ""),
                "who": _row_get(r, "actor_name", ""),
                "action": _row_get(r, "action", ""),
                "what": _row_get(r, "target_label", ""),
            })
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
    # OJT active/completed for this trainer in ONE grouped query
    ojt_mine = ojt_done = 0
    try:
        for r in db.execute(
            "SELECT status, COUNT(*) c FROM ojt_enrollments WHERE trainer_id=? GROUP BY status",
            (mine,)).fetchall():
            st = (_row_get(r, "status", "") or "")
            cnt = _row_get(r, "c", 0)
            if st == "active":
                ojt_mine = cnt
            elif st == "completed":
                ojt_done = cnt
    except Exception:
        pass
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
    # assessments taken/passed/avg in ONE query
    taken = passed = 0
    my_avg = 0
    try:
        r = _one(db,
            "SELECT "
            " COUNT(DISTINCT assessment_id) taken, "
            " COUNT(DISTINCT CASE WHEN passed=1 THEN assessment_id END) passed, "
            " AVG(percent) avg_pct "
            "FROM assessment_results WHERE emp_id=?", (mine,))
        if r is not None:
            taken = _row_get(r, "taken", 0)
            passed = _row_get(r, "passed", 0)
            avg_raw = _row_get(r, "avg_pct", None)
            my_avg = round(avg_raw) if avg_raw is not None else 0
    except Exception:
        pass
    certs = _safe(db, "SELECT COUNT(*) c FROM issued_certificates WHERE emp_id=?", (mine,))
    ojt = _safe_row(db, "SELECT status FROM ojt_enrollments WHERE emp_id=? ORDER BY id DESC LIMIT 1", (mine,))
    ojt_status = (_row_get(ojt, "status", "—") if ojt else "—") or "—"
    return {
        "role": "learner",
        "cards": [
            {"label": "Assessments passed", "value": str(passed) + " / " + str(taken)},
            {"label": "My average score", "value": str(my_avg) + "%"},
            {"label": "Certificates earned", "value": certs},
            {"label": "My OJT", "value": str(ojt_status).title()},
        ],
        "attention": [], "charts": {},
    }


@dashboard_bp.route("/api/dashboard/home")
@_login_only
def api_dashboard_home():
    u = _current_user()
    role = u["role"]
    # cache key is per-user so admin/instructor/learner never mix,
    # and so one person's numbers aren't shown to another.
    ck = "home:" + str(u["emp_id"]) + ":" + str(role)

    # allow a manual bypass with ?fresh=1 (used after an approval, etc.)
    if (request.args.get("fresh") or "") not in ("1", "true", "yes"):
        cached = _cache_get(ck)
        if cached is not None:
            return jsonify(ok=True, cached=True, **cached)

    db = _get_db()
    try:
        if role == "admin":
            data = _admin_home(db)
        elif role == "instructor":
            data = _instructor_home(db, u)
        else:
            data = _learner_home(db, u)
    except Exception:
        return jsonify(ok=False, msg="Could not load dashboard."), 200

    data["me"] = {"name": u["name"], "emp_id": u["emp_id"]}
    _cache_put(ck, data)
    return jsonify(ok=True, **data)


# ===============================================================
#  Completion tracker — per-employee induction / training / assessments
#  (who completed what, and which attempt they passed an assessment on)
# ===============================================================
def _staff_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        u = _current_user()
        if u is None or u["role"] not in ("admin", "instructor"):
            return jsonify(ok=False, msg="Not authorised."), 403
        return view(*a, **k)
    return wrapped


def _roles_match(roles_field, designation):
    roles = (roles_field or "all").strip().lower()
    if roles in ("", "all"):
        return True
    desg = (designation or "").strip().lower()
    allowed = [r.strip().lower() for r in roles.split(",")]
    return any(a and a in desg for a in allowed)


@dashboard_bp.route("/api/dashboard/completion")
@_staff_only
def api_dashboard_completion():
    """Per-employee completion across Induction modules, Training modules and
    Assessments. For each assessment shows total attempts and which attempt the
    person first passed on. Optional ?designation= to filter."""
    db = _get_db()
    filt = (request.args.get("designation") or "").strip().lower()

    # live modules & assessments (role-targeted lists)
    try:
        ind = [dict(r) for r in db.execute(
            "SELECT id, title, roles FROM content_modules WHERE kind='induction' AND status='live' ORDER BY sort_order, id").fetchall()]
    except Exception:
        ind = []
    try:
        trn = [dict(r) for r in db.execute(
            "SELECT id, title, roles FROM content_modules WHERE kind='training' AND status='live' ORDER BY sort_order, id").fetchall()]
    except Exception:
        trn = []
    try:
        ass = [dict(r) for r in db.execute(
            "SELECT id, title, roles, pass_percent FROM assessments WHERE active=1 AND status='live' ORDER BY id").fetchall()]
    except Exception:
        ass = []

    # people (approved learners)
    people = [dict(r) for r in db.execute(
        "SELECT emp_id, name, designation FROM users WHERE status='approved' AND role!='admin' ORDER BY name").fetchall()]
    if filt:
        people = [p for p in people if (p.get("designation") or "").strip().lower() == filt]

    # completions sets
    mod_done = {}   # emp_id -> set(module_id)
    try:
        for r in db.execute("SELECT emp_id, module_id FROM module_completions").fetchall():
            mod_done.setdefault(r["emp_id"], set()).add(r["module_id"])
    except Exception:
        pass

    # assessment attempts per (emp_id, assessment_id), ordered by time
    attempts = {}   # (emp, aid) -> list of passed flags in time order
    try:
        for r in db.execute(
            "SELECT emp_id, assessment_id, passed, taken_at FROM assessment_results ORDER BY taken_at, id").fetchall():
            attempts.setdefault((r["emp_id"], r["assessment_id"]), []).append(r["passed"])
    except Exception:
        pass

    rows = []
    for p in people:
        desg = p.get("designation") or ""
        my_ind = [m for m in ind if _roles_match(m["roles"], desg)]
        my_trn = [m for m in trn if _roles_match(m["roles"], desg)]
        my_ass = [a for a in ass if _roles_match(a["roles"], desg)]
        done = mod_done.get(p["emp_id"], set())
        ind_done = sum(1 for m in my_ind if m["id"] in done)
        trn_done = sum(1 for m in my_trn if m["id"] in done)
        # assessments: attempts + pass-attempt
        a_list = []
        a_passed = 0
        for a in my_ass:
            tries = attempts.get((p["emp_id"], a["id"]), [])
            n_try = len(tries)
            pass_attempt = None
            for i, pv in enumerate(tries, 1):
                if pv:
                    pass_attempt = i
                    break
            if pass_attempt:
                a_passed += 1
            a_list.append({"title": a["title"], "attempts": n_try, "pass_attempt": pass_attempt})
        rows.append({
            "emp_id": p["emp_id"], "name": p["name"], "designation": desg,
            "ind_done": ind_done, "ind_total": len(my_ind),
            "trn_done": trn_done, "trn_total": len(my_trn),
            "ass_passed": a_passed, "ass_total": len(my_ass),
            "assessments": a_list,
        })

    # designation options for the filter
    desigs = sorted({(p.get("designation") or "").strip() for p in
                     [dict(r) for r in db.execute("SELECT designation FROM users WHERE status='approved' AND role!='admin'").fetchall()]
                     if (p.get("designation") or "").strip()})
    return jsonify(ok=True, rows=rows, designations=desigs)


def init_dashboard(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(dashboard_bp)
