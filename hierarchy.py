# ===============================================================
#  hierarchy.py  —  Reporting hierarchy + "My Team" visibility
# ---------------------------------------------------------------
#  Each manager sees everyone BELOW them in the reports_to chain:
#    - NSM / admin        -> everyone
#    - RSM                -> their region (East/West/North/South)
#    - State Head         -> their state's BDMs + BDEs (their sub-tree)
#    - BDM                -> their ~8 BDEs (their sub-tree)
#    - plain staff        -> only themselves
#
#  Visibility is driven by the users.reports_to column (manager's
#  emp_id), with users.region used for the RSM level. A person's
#  "team" = the whole sub-tree whose reports_to chain leads up to
#  them (any depth), plus (for an RSM) everyone in their region.
#
#  Endpoints (all view-only):
#    GET  /api/team                 -> my team with progress + summary
#    GET  /api/team/member?emp_id=  -> one member's full record (drill-in)
#    GET  /api/team/export.xlsx     -> Excel of my team's progress
#    GET  /api/team/managers        -> (admin/instructor) list of people
#                                       who can be picked as a manager
#    POST /api/team/assign          -> set reports_to + region for a person
#                                       (admin: live; instructor: needs approval)
#
#  Wired from app.py:  init_hierarchy(app, get_db, current_user)
# ===============================================================
import io
import json as _json
from datetime import datetime
from functools import wraps
from flask import Blueprint, jsonify, request, send_file

hierarchy_bp = Blueprint("hierarchy", __name__)
_get_db = None
_current_user = None

# designations that never report to anyone / never manage (pure support);
# they can still be given a manager, this list only affects defaults.
VIEW_ALL_DESIGNATIONS = ("nsm",)           # see everyone
REGION_DESIGNATIONS = ("rsm",)             # see their region


# ---------- small helpers -------------------------------------
def _rowget(r, key, default=None):
    try:
        if r is None:
            return default
        return r[key] if key in r.keys() else default
    except Exception:
        return default


def _login_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        if _current_user() is None:
            return jsonify(ok=False, msg="Please sign in again."), 401
        return view(*a, **k)
    return wrapped


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


def _desg(u):
    return (_rowget(u, "designation", "") or "").strip().lower()


# ---------- the core: who can this user see? ------------------
def _all_people(db):
    """All approved non-admin users as dicts (the people who can appear
    in a team view). Admins are excluded from being 'reportees'."""
    rows = db.execute(
        "SELECT emp_id, name, designation, role, status, "
        "       COALESCE(reports_to,'') reports_to, COALESCE(region,'') region "
        "FROM users WHERE status='approved'"
    ).fetchall()
    return [dict(r) for r in rows]


def _subtree_emp_ids(manager_emp_id, people):
    """Everyone whose reports_to chain leads up to manager_emp_id (any depth)."""
    # build manager -> [direct reports]
    children = {}
    for p in people:
        mgr = (p.get("reports_to") or "").strip()
        if mgr:
            children.setdefault(mgr, []).append(p["emp_id"])
    seen = set()
    stack = list(children.get(manager_emp_id, []))
    while stack:
        eid = stack.pop()
        if eid in seen:
            continue           # guard against accidental loops
        seen.add(eid)
        stack.extend(children.get(eid, []))
    return seen


def visible_emp_ids(viewer, db):
    """The set of emp_ids this viewer may see (NOT including themselves),
    following the agreed rules. Returns (set_of_emp_ids, scope_label)."""
    role = viewer["role"]
    desg = _desg(viewer)
    people = _all_people(db)

    # admin + NSM: everyone (except admins themselves)
    if role == "admin" or desg in VIEW_ALL_DESIGNATIONS:
        ids = {p["emp_id"] for p in people
               if p["role"] != "admin" and p["emp_id"] != viewer["emp_id"]}
        return ids, ("Everyone" if role == "admin" else "All (NSM)")

    # RSM: everyone in their region (any designation), minus self
    if desg in REGION_DESIGNATIONS:
        myreg = (_rowget(viewer, "region", "") or "").strip().lower()
        ids = set()
        if myreg:
            ids = {p["emp_id"] for p in people
                   if (p.get("region") or "").strip().lower() == myreg
                   and p["role"] != "admin" and p["emp_id"] != viewer["emp_id"]}
        # also include their explicit sub-tree, in case region isn't filled in
        ids |= _subtree_emp_ids(viewer["emp_id"], people)
        return ids, ("Region: " + (_rowget(viewer, "region", "") or "—"))

    # everyone else (State Head, BDM, Franchise Manager, …): their sub-tree
    ids = _subtree_emp_ids(viewer["emp_id"], people)
    return ids, "My team"


# ---------- progress numbers (reuse dashboard-style logic) -----
def _live_catalog(db):
    """Live induction modules, training modules and assessments (role-targeted)."""
    def q(sql):
        try:
            return [dict(r) for r in db.execute(sql).fetchall()]
        except Exception:
            return []
    ind = q("SELECT id, title, roles FROM content_modules WHERE kind='induction' AND status='live' ORDER BY sort_order, id")
    trn = q("SELECT id, title, roles FROM content_modules WHERE kind='training' AND status='live' ORDER BY sort_order, id")
    ass = q("SELECT id, title, roles, pass_percent FROM assessments WHERE active=1 AND status='live' ORDER BY id")
    return ind, trn, ass


def _completion_maps(db):
    """module_completions set per emp, and assessment attempts per (emp,aid)."""
    mod_done = {}
    try:
        for r in db.execute("SELECT emp_id, module_id FROM module_completions").fetchall():
            mod_done.setdefault(r["emp_id"], set()).add(r["module_id"])
    except Exception:
        pass
    attempts = {}
    try:
        for r in db.execute(
            "SELECT emp_id, assessment_id, passed, taken_at FROM assessment_results ORDER BY taken_at, id"
        ).fetchall():
            attempts.setdefault((r["emp_id"], r["assessment_id"]), []).append(r["passed"])
    except Exception:
        pass
    return mod_done, attempts


def _avg_scores(db):
    """emp_id -> average percent across their assessment attempts."""
    out = {}
    try:
        for r in db.execute(
            "SELECT emp_id, AVG(percent) a FROM assessment_results GROUP BY emp_id"
        ).fetchall():
            v = _rowget(r, "a", None)
            if v is not None:
                out[r["emp_id"]] = round(v)
    except Exception:
        pass
    return out


def _ojt_summary(db):
    """emp_id -> {status, done, total, pct} for their latest OJT enrollment.
    done = tasks the trainer signed off; total = tasks in that role's template."""
    out = {}
    # total tasks per role (template size)
    role_total = {}
    try:
        for r in db.execute("SELECT role, COUNT(*) c FROM ojt_tasks GROUP BY role").fetchall():
            role_total[(r["role"] or "").strip()] = _rowget(r, "c", 0)
    except Exception:
        pass
    # latest enrollment per emp
    enr = {}   # emp_id -> (enrollment_id, role, status)
    try:
        for r in db.execute(
            "SELECT id, emp_id, role, status FROM ojt_enrollments ORDER BY id"
        ).fetchall():
            enr[r["emp_id"]] = (r["id"], (r["role"] or "").strip(), (r["status"] or "").strip())
    except Exception:
        return out
    # signed-off count per enrollment
    signed = {}
    try:
        for r in db.execute(
            "SELECT enrollment_id, COUNT(*) c FROM ojt_signoffs GROUP BY enrollment_id"
        ).fetchall():
            signed[r["enrollment_id"]] = _rowget(r, "c", 0)
    except Exception:
        pass
    for eid, (enr_id, role, status) in enr.items():
        total = role_total.get(role, 0)
        done = signed.get(enr_id, 0)
        pct = round(done * 100 / total) if total else 0
        out[eid] = {"status": status or "—", "done": done, "total": total, "pct": pct}
    return out


def _trainer_names(db):
    """emp_id -> who trained them (induction + training), from training_delivery
    if present. Best-effort: missing table just yields no names."""
    ind_by, trn_by = {}, {}
    try:
        rows = db.execute(
            "SELECT td.learner_id, td.kind, u.name trainer_name "
            "FROM training_delivery td LEFT JOIN users u ON u.emp_id=td.trainer_id "
            "WHERE td.status='approved'"
        ).fetchall()
        for r in rows:
            lid = r["learner_id"]
            nm = _rowget(r, "trainer_name", None) or ""
            if not nm:
                continue
            if (r["kind"] or "") == "induction":
                ind_by.setdefault(lid, set()).add(nm)
            else:
                trn_by.setdefault(lid, set()).add(nm)
    except Exception:
        pass
    return ind_by, trn_by


def _person_progress(p, ind, trn, ass, mod_done, attempts):
    """Compute one person's completion + assessment summary (role-targeted)."""
    desg = p.get("designation") or ""
    my_ind = [m for m in ind if _roles_match(m["roles"], desg)]
    my_trn = [m for m in trn if _roles_match(m["roles"], desg)]
    my_ass = [a for a in ass if _roles_match(a["roles"], desg)]
    done = mod_done.get(p["emp_id"], set())
    ind_done = sum(1 for m in my_ind if m["id"] in done)
    trn_done = sum(1 for m in my_trn if m["id"] in done)
    a_list, a_passed = [], 0
    for a in my_ass:
        tries = attempts.get((p["emp_id"], a["id"]), [])
        pass_attempt = None
        for i, pv in enumerate(tries, 1):
            if pv:
                pass_attempt = i
                break
        if pass_attempt:
            a_passed += 1
        a_list.append({"title": a["title"], "attempts": len(tries), "pass_attempt": pass_attempt})
    return {
        "ind_done": ind_done, "ind_total": len(my_ind),
        "trn_done": trn_done, "trn_total": len(my_trn),
        "ass_passed": a_passed, "ass_total": len(my_ass),
        "assessments": a_list,
    }


# ===============================================================
#  ENDPOINTS
# ===============================================================
@hierarchy_bp.route("/api/team")
@_login_only
def api_team():
    """My team with per-person progress + a small summary. View-only."""
    u = _current_user()
    db = _get_db()
    ids, scope = visible_emp_ids(u, db)

    people = {p["emp_id"]: p for p in _all_people(db)}
    ind, trn, ass = _live_catalog(db)
    mod_done, attempts = _completion_maps(db)
    avg = _avg_scores(db)
    ind_by, trn_by = _trainer_names(db)
    ojt = _ojt_summary(db)

    rows = []
    for eid in ids:
        p = people.get(eid)
        if not p:
            continue
        prog = _person_progress(p, ind, trn, ass, mod_done, attempts)
        o = ojt.get(eid)
        rows.append({
            "emp_id": eid,
            "name": p.get("name") or eid,
            "designation": p.get("designation") or "",
            "region": p.get("region") or "",
            "manager": p.get("reports_to") or "",
            "manager_name": (people.get(p.get("reports_to") or "", {}) or {}).get("name", ""),
            "ind_done": prog["ind_done"], "ind_total": prog["ind_total"],
            "trn_done": prog["trn_done"], "trn_total": prog["trn_total"],
            "ass_passed": prog["ass_passed"], "ass_total": prog["ass_total"],
            "avg_score": avg.get(eid),
            "trained_by": sorted((ind_by.get(eid, set()) | trn_by.get(eid, set()))),
            "ojt_status": (o["status"] if o else None),
            "ojt_done": (o["done"] if o else 0),
            "ojt_total": (o["total"] if o else 0),
            "ojt_pct": (o["pct"] if o else None),
        })
    rows.sort(key=lambda r: (r["designation"], r["name"]))

    # summary cards
    n = len(rows)
    def pct(a, b):
        return round(a * 100 / b) if b else 0
    ind_rate = pct(sum(r["ind_done"] for r in rows), sum(r["ind_total"] for r in rows))
    trn_rate = pct(sum(r["trn_done"] for r in rows), sum(r["trn_total"] for r in rows))
    ass_rate = pct(sum(r["ass_passed"] for r in rows), sum(r["ass_total"] for r in rows))
    scored = [r["avg_score"] for r in rows if r["avg_score"] is not None]
    team_avg = round(sum(scored) / len(scored)) if scored else None

    return jsonify(
        ok=True, scope=scope, is_admin=(u["role"] == "admin"),
        me={"name": u["name"], "emp_id": u["emp_id"],
            "designation": _rowget(u, "designation", "") or ""},
        summary={"people": n, "induction_rate": ind_rate, "training_rate": trn_rate,
                 "assessment_rate": ass_rate, "team_avg": team_avg},
        rows=rows,
    )


@hierarchy_bp.route("/api/team/member")
@_login_only
def api_team_member():
    """Drill into one team member's full record. Only if they're in my sub-tree
    (or I'm admin). View-only."""
    u = _current_user()
    db = _get_db()
    emp_id = (request.args.get("emp_id") or "").strip()
    if not emp_id:
        return jsonify(ok=False, msg="Missing emp_id."), 400

    ids, _ = visible_emp_ids(u, db)
    if u["role"] != "admin" and emp_id not in ids:
        return jsonify(ok=False, msg="Not in your team."), 403

    people = {p["emp_id"]: p for p in _all_people(db)}
    p = people.get(emp_id)
    if not p:
        return jsonify(ok=False, msg="Person not found."), 404

    ind, trn, ass = _live_catalog(db)
    mod_done, attempts = _completion_maps(db)
    avg = _avg_scores(db)
    ind_by, trn_by = _trainer_names(db)
    prog = _person_progress(p, ind, trn, ass, mod_done, attempts)
    o = _ojt_summary(db).get(emp_id)

    return jsonify(
        ok=True,
        person={"emp_id": emp_id, "name": p.get("name") or emp_id,
                "designation": p.get("designation") or "",
                "region": p.get("region") or "",
                "manager_name": (people.get(p.get("reports_to") or "", {}) or {}).get("name", "")},
        avg_score=avg.get(emp_id),
        induction_by=sorted(ind_by.get(emp_id, set())),
        training_by=sorted(trn_by.get(emp_id, set())),
        ojt_status=(o["status"] if o else None),
        ojt_done=(o["done"] if o else 0),
        ojt_total=(o["total"] if o else 0),
        ojt_pct=(o["pct"] if o else None),
        **prog,
    )


@hierarchy_bp.route("/api/team/export.xlsx")
@_login_only
def api_team_export():
    """Excel of my team's progress. View-only."""
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
    except Exception:
        return jsonify(ok=False, msg="Excel export not available on the server."), 500

    u = _current_user()
    db = _get_db()
    ids, scope = visible_emp_ids(u, db)
    people = {p["emp_id"]: p for p in _all_people(db)}
    ind, trn, ass = _live_catalog(db)
    mod_done, attempts = _completion_maps(db)
    avg = _avg_scores(db)
    ojt = _ojt_summary(db)

    wb = Workbook()
    ws = wb.active
    ws.title = "My Team"
    headers = ["Emp ID", "Name", "Designation", "Region", "Manager",
               "Induction done", "Induction total", "Training done", "Training total",
               "Assessments passed", "Assessments total", "Avg score %",
               "OJT status", "OJT tasks done", "OJT tasks total", "OJT %"]
    ws.append(headers)
    navy = PatternFill("solid", fgColor="12284B")
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = navy
        c.alignment = Alignment(horizontal="center")

    rows = []
    for eid in ids:
        p = people.get(eid)
        if not p:
            continue
        prog = _person_progress(p, ind, trn, ass, mod_done, attempts)
        rows.append((p, prog))
    rows.sort(key=lambda t: ((t[0].get("designation") or ""), (t[0].get("name") or "")))

    for p, prog in rows:
        o = ojt.get(p["emp_id"])
        ws.append([
            p["emp_id"], p.get("name") or "", p.get("designation") or "",
            p.get("region") or "",
            (people.get(p.get("reports_to") or "", {}) or {}).get("name", ""),
            prog["ind_done"], prog["ind_total"],
            prog["trn_done"], prog["trn_total"],
            prog["ass_passed"], prog["ass_total"],
            avg.get(p["emp_id"], ""),
            (o["status"] if o else ""), (o["done"] if o else ""),
            (o["total"] if o else ""), (o["pct"] if o else ""),
        ])
    widths = [12, 22, 20, 10, 20, 13, 14, 12, 13, 17, 17, 11, 12, 13, 14, 8]
    for i, w in enumerate(widths, 1):
        col = chr(64 + i) if i <= 26 else ("A" + chr(64 + i - 26))
        ws.column_dimensions[col].width = w

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    fname = "My_Team_Progress_" + datetime.utcnow().strftime("%Y%m%d") + ".xlsx"
    return send_file(bio, as_attachment=True, download_name=fname,
                     mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ---------- assign manager (admin live / instructor -> approval) ----
@hierarchy_bp.route("/api/team/managers")
@_staff_only
def api_team_managers():
    """People who can be picked as a manager (approved, non-admin or admin ok),
    for the 'Reports to' dropdown. Returns emp_id, name, designation."""
    db = _get_db()
    rows = db.execute(
        "SELECT emp_id, name, designation, role FROM users "
        "WHERE status='approved' ORDER BY designation, name"
    ).fetchall()
    out = [{"emp_id": r["emp_id"], "name": r["name"],
            "designation": r["designation"] or "", "role": r["role"]}
           for r in rows]
    return jsonify(ok=True, managers=out)


@hierarchy_bp.route("/api/team/assign", methods=["POST"])
@_staff_only
def api_team_assign():
    """Set reports_to + region for an employee.
       - admin: applies live.
       - instructor: creates a pending_action (type 'assign_manager') for admin."""
    u = _current_user()
    db = _get_db()
    d = request.get_json(force=True)
    emp_id = (d.get("emp_id") or "").strip()
    reports_to = (d.get("reports_to") or "").strip()
    region = (d.get("region") or "").strip()
    if not emp_id:
        return jsonify(ok=False, msg="Missing employee."), 400

    target = db.execute("SELECT * FROM users WHERE emp_id=?", (emp_id,)).fetchone()
    if target is None:
        return jsonify(ok=False, msg="Employee not found."), 404

    # guard: a person cannot report to themselves
    if reports_to and reports_to == emp_id:
        return jsonify(ok=False, msg="A person cannot report to themselves."), 400
    # guard: manager must exist (if one is given)
    if reports_to:
        mgr = db.execute("SELECT 1 FROM users WHERE emp_id=?", (reports_to,)).fetchone()
        if mgr is None:
            return jsonify(ok=False, msg="Chosen manager not found."), 400
    # guard: no simple cycle (manager's manager chain shouldn't loop back)
    if reports_to:
        seen = {emp_id}
        cur = reports_to
        while cur:
            if cur in seen:
                return jsonify(ok=False, msg="That would create a reporting loop."), 400
            seen.add(cur)
            row = db.execute("SELECT COALESCE(reports_to,'') r FROM users WHERE emp_id=?", (cur,)).fetchone()
            cur = (_rowget(row, "r", "") or "").strip()

    if u["role"] == "admin":
        db.execute("UPDATE users SET reports_to=?, region=? WHERE emp_id=?",
                   (reports_to or None, region or None, emp_id))
        db.commit()
        return jsonify(ok=True, msg="Reporting updated.", applied=True)

    # instructor -> queue for admin approval
    payload = _json.dumps({"emp_id": emp_id, "reports_to": reports_to, "region": region})
    label = (target["name"] or emp_id)
    try:
        db.execute(
            "INSERT INTO pending_actions (action_type, target_type, target_id, target_label, "
            "payload, requested_by, requested_by_name, status, created_at) "
            "VALUES ('assign_manager','user',?,?,?,?,?, 'pending', ?)",
            (emp_id, label, payload, u["emp_id"], u["name"], datetime.utcnow().isoformat())
        )
        db.commit()
    except Exception as e:
        return jsonify(ok=False, msg="Could not submit for approval."), 500
    return jsonify(ok=True, msg="Sent to admin for approval.", applied=False)


def init_hierarchy(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(hierarchy_bp)
