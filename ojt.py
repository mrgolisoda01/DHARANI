"""
============================================================
 Mr. Golisoda LMS — OJT MODULE (Phase 1)
============================================================
 Kept in its own file so the main app.py stays untouched except
 for 2 lines that connect it (see the bottom of app.py).

 PHASE 1 covers:
   - Day-wise task templates for BDE / BDM / State Head
     (Day 1–30, any number of task rows per day)
   - Add / edit tasks in the admin screen, OR upload an Excel/CSV
     (download sample -> fill -> upload)
   - Instructor changes go to the admin for approval
     (old tasks stay live until approved)
   - "Audit passed" by trainer -> OJT Day 1 starts on that date
   - 30 calendar days, Sundays = fixed week off, leave = holiday
   - Trainer signs off each task (trainer only)
   - Learner sees "My OJT" in their portal (read-only)

 NEW TABLES (existing tables are not touched):
   ojt_tasks, ojt_enrollments, ojt_signoffs, ojt_holidays
 Instructor change requests reuse the existing pending_actions table
 with action_type = 'ojt_tasks' (so they never mix with other approvals).
============================================================
"""

import io
import csv
import json
from datetime import datetime, timedelta, date
from functools import wraps

from flask import Blueprint, request, jsonify, Response

ojt_bp = Blueprint("ojt", __name__)

OJT_ROLES = ["BDE", "BDM", "State Head"]
OJT_DAYS = 30
REVIEW_DAYS = (29, 30)          # final review / evaluation days
MAX_TASKS_PER_DAY = 25

# These are filled in by init_ojt() from app.py
_get_db = None
_current_user = None


# ---------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------
def _today_ist():
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()


def _now():
    return datetime.utcnow().isoformat()


def _role_from_designation(desg):
    """Map an employee's designation to one of the three OJT roles."""
    d = (desg or "").strip().lower()
    if "state head" in d or d == "sh":
        return "State Head"
    if "bdm" in d:
        return "BDM"
    if "bde" in d:
        return "BDE"
    return None


def _clean_role(r):
    r = (r or "").strip()
    for x in OJT_ROLES:
        if x.lower() == r.lower():
            return x
    return None


def _staff_required(view):
    """Admin or instructor (trainer)."""
    @wraps(view)
    def wrapped(*a, **k):
        u = _current_user()
        if u is None or u["role"] not in ("admin", "instructor"):
            return jsonify(ok=False, msg="Not authorised."), 403
        return view(*a, **k)
    return wrapped


def _admin_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        u = _current_user()
        if u is None or u["role"] != "admin":
            return jsonify(ok=False, msg="Only an admin can do this."), 403
        return view(*a, **k)
    return wrapped


def _login_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        if _current_user() is None:
            return jsonify(ok=False, msg="Please sign in again."), 401
        return view(*a, **k)
    return wrapped


# ---------------------------------------------------------------
#  Tables (created once, safely, on first request)
# ---------------------------------------------------------------
_ready = False


def _ensure_tables():
    global _ready
    if _ready:
        return
    db = _get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_tasks (
            id          SERIAL PRIMARY KEY,
            role        TEXT NOT NULL,
            day_no      INTEGER NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            title       TEXT NOT NULL,
            description TEXT,
            updated_by  TEXT,
            updated_at  TEXT
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_enrollments (
            id           SERIAL PRIMARY KEY,
            emp_id       TEXT NOT NULL,
            role         TEXT NOT NULL,
            start_date   TEXT NOT NULL,          -- audit passed date = OJT Day 1 (YYYY-MM-DD)
            trainer_id   TEXT,
            status       TEXT NOT NULL DEFAULT 'active',   -- active | completed | failed
            final_note   TEXT,
            created_by   TEXT,
            created_at   TEXT,
            closed_at    TEXT
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_signoffs (
            id            SERIAL PRIMARY KEY,
            enrollment_id INTEGER NOT NULL,
            task_id       INTEGER NOT NULL,
            task_title    TEXT,
            day_no        INTEGER,
            signed_by     TEXT,
            signed_at     TEXT,
            UNIQUE (enrollment_id, task_id)
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_holidays (
            id            SERIAL PRIMARY KEY,
            enrollment_id INTEGER NOT NULL,
            on_date       TEXT NOT NULL,
            kind          TEXT NOT NULL DEFAULT 'leave',  -- 'leave' | 'weekoff' | 'worked'
            marked_by     TEXT,
            marked_at     TEXT,
            UNIQUE (enrollment_id, on_date)
        )
    """)
    # Older databases may have ojt_holidays without the 'kind' column — add it.
    try:
        db.execute("ALTER TABLE ojt_holidays ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'leave'")
    except Exception:
        pass
    # Trainee's own task claims ("I've done this"). Separate from the trainer's
    # official sign-off in ojt_signoffs — the trainer still confirms.
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_selfmarks (
            id            SERIAL PRIMARY KEY,
            enrollment_id INTEGER NOT NULL,
            task_id       INTEGER NOT NULL,
            day_no        INTEGER,
            marked_at     TEXT,
            UNIQUE (enrollment_id, task_id)
        )
    """)
    # Trainee's daily notes — problems faced and work done, one row per day.
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_daynotes (
            id            SERIAL PRIMARY KEY,
            enrollment_id INTEGER NOT NULL,
            day_no        INTEGER NOT NULL,
            problems      TEXT,
            work_done     TEXT,
            updated_at    TEXT,
            UNIQUE (enrollment_id, day_no)
        )
    """)
    # Reusable tags the trainer taps (admin-managed). type: 'problem' | 'positive'
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_tags (
            id         SERIAL PRIMARY KEY,
            label      TEXT NOT NULL,
            kind       TEXT NOT NULL DEFAULT 'problem',  -- 'problem' | 'positive'
            active     INTEGER NOT NULL DEFAULT 1,
            sort_no    INTEGER DEFAULT 0,
            created_at TEXT,
            UNIQUE (label)
        )
    """)
    # Trainer's remark + tags on a single TASK for a trainee.
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_task_remarks (
            id            SERIAL PRIMARY KEY,
            enrollment_id INTEGER NOT NULL,
            task_id       INTEGER NOT NULL,
            day_no        INTEGER,
            remark        TEXT,
            not_done_reason TEXT,
            tag_ids       TEXT,            -- comma-separated ojt_tags ids
            marked_by     TEXT,
            updated_at    TEXT,
            UNIQUE (enrollment_id, task_id)
        )
    """)
    # Trainer's overall remark + tags for a whole DAY for a trainee.
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_day_remarks (
            id            SERIAL PRIMARY KEY,
            enrollment_id INTEGER NOT NULL,
            day_no        INTEGER NOT NULL,
            remark        TEXT,
            tag_ids       TEXT,
            marked_by     TEXT,
            updated_at    TEXT,
            UNIQUE (enrollment_id, day_no)
        )
    """)
    # Call attempts the trainer logs for a trainee on a given day.
    db.execute("""
        CREATE TABLE IF NOT EXISTS ojt_calls (
            id            SERIAL PRIMARY KEY,
            enrollment_id INTEGER NOT NULL,
            day_no        INTEGER,
            outcome       TEXT NOT NULL,   -- 'no_answer' | 'busy' | 'spoke_done' | 'spoke_not_done'
            note          TEXT,
            called_by     TEXT,
            called_at     TEXT
        )
    """)
    # Seed a starter set of tags the first time (admin can edit/add/remove later).
    if not db.execute("SELECT 1 FROM ojt_tags LIMIT 1").fetchone():
        seed = [
            # problems (red)
            ("Vehicle not taken on time", "problem"),
            ("Reached outlet late", "problem"),
            ("Not picking calls", "problem"),
            ("Daily update not filled", "problem"),
            ("Report not submitted", "problem"),
            ("Low outlet coverage", "problem"),
            ("No orders booked", "problem"),
            ("Attitude / discipline issue", "problem"),
            ("Left field early", "problem"),
            ("Not following route plan", "problem"),
            # positives (green)
            ("Good outlet coverage", "positive"),
            ("Proactive & responsive", "positive"),
            ("Booked good orders", "positive"),
            ("Punctual", "positive"),
            ("Followed route plan", "positive"),
            ("Handled objections well", "positive"),
        ]
        i = 0
        for lab, kind in seed:
            i += 1
            db.execute("INSERT INTO ojt_tags (label, kind, active, sort_no, created_at) VALUES (?,?,?,?,?)",
                       (lab, kind, 1, i, _now()))
    db.commit()
    _ready = True


@ojt_bp.before_app_request
def _ojt_before():
    if request.path.startswith("/api/ojt/"):
        _ensure_tables()


# ---------------------------------------------------------------
#  Task template helpers
# ---------------------------------------------------------------
def _tasks_by_day(role):
    db = _get_db()
    rows = db.execute(
        "SELECT id, day_no, sort_order, title, description FROM ojt_tasks "
        "WHERE role=? ORDER BY day_no, sort_order, id", (role,)
    ).fetchall()
    days = {d: [] for d in range(1, OJT_DAYS + 1)}
    for r in rows:
        if r["day_no"] in days:
            days[r["day_no"]].append({"id": r["id"], "title": r["title"],
                                      "description": r["description"] or ""})
    return days


def _validate_tasks(tasks):
    """Clean a list of {title, description}; drop empty rows."""
    out = []
    for t in tasks or []:
        title = (t.get("title") or "").strip()
        desc = (t.get("description") or "").strip()
        if not title and not desc:
            continue
        if not title:
            return None, "Every task needs a title."
        out.append({"title": title[:300], "description": desc[:2000]})
    if len(out) > MAX_TASKS_PER_DAY:
        return None, f"Maximum {MAX_TASKS_PER_DAY} tasks per day."
    return out, None


def _apply_days(role, days_map, user_id):
    """Replace the live tasks for the given days. days_map = {day_no: [tasks]}.
    Tasks whose title is unchanged keep their id, so trainer sign-offs are kept."""
    db = _get_db()
    for day_no, tasks in days_map.items():
        day_no = int(day_no)
        existing = db.execute(
            "SELECT id, title FROM ojt_tasks WHERE role=? AND day_no=? ORDER BY sort_order, id",
            (role, day_no)
        ).fetchall()
        pool = {}
        for e in existing:
            pool.setdefault(e["title"].strip().lower(), []).append(e["id"])
        kept = set()
        for i, t in enumerate(tasks):
            key = t["title"].strip().lower()
            if pool.get(key):
                tid = pool[key].pop(0)
                kept.add(tid)
                db.execute(
                    "UPDATE ojt_tasks SET sort_order=?, title=?, description=?, updated_by=?, updated_at=? WHERE id=?",
                    (i, t["title"], t["description"], user_id, _now(), tid))
            else:
                db.execute(
                    "INSERT INTO ojt_tasks (role, day_no, sort_order, title, description, updated_by, updated_at) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (role, day_no, i, t["title"], t["description"], user_id, _now()))
        for e in existing:
            if e["id"] not in kept:
                db.execute("DELETE FROM ojt_tasks WHERE id=?", (e["id"],))
    db.commit()


def _queue_change(role, days_map, label, u):
    """Instructor change -> pending admin approval (live tasks stay unchanged)."""
    db = _get_db()
    db.execute(
        "INSERT INTO pending_actions (action_type, target_type, target_id, target_label, payload, "
        "requested_by, requested_by_name, status, created_at) "
        "VALUES ('ojt_tasks', 'ojt', ?, ?, ?, ?, ?, 'pending', ?)",
        (role, label, json.dumps({"role": role, "days": days_map}),
         u["emp_id"], u["name"], _now()))
    db.commit()


def _save_or_queue(role, days_map, label):
    u = _current_user()
    if u["role"] == "admin":
        _apply_days(role, days_map, u["emp_id"])
        return "Saved and live."
    _queue_change(role, days_map, label, u)
    return "Sent to admin for approval. The current tasks stay live until approved."


# ---------------------------------------------------------------
#  API — Task templates (admin / instructor)
# ---------------------------------------------------------------
@ojt_bp.route("/api/ojt/tasks")
@_staff_required
def api_tasks():
    role = _clean_role(request.args.get("role"))
    if not role:
        return jsonify(ok=False, msg="Unknown role."), 400
    days = _tasks_by_day(role)
    out = [{"day": d, "review": d in REVIEW_DAYS, "tasks": days[d]} for d in range(1, OJT_DAYS + 1)]
    return jsonify(ok=True, role=role, days=out,
                   total=sum(len(x["tasks"]) for x in out))


@ojt_bp.route("/api/ojt/save-day", methods=["POST"])
@_staff_required
def api_save_day():
    d = request.get_json(force=True)
    role = _clean_role(d.get("role"))
    try:
        day_no = int(d.get("day"))
    except (TypeError, ValueError):
        day_no = 0
    if not role or not (1 <= day_no <= OJT_DAYS):
        return jsonify(ok=False, msg="Pick a valid role and day."), 400
    tasks, err = _validate_tasks(d.get("tasks"))
    if err:
        return jsonify(ok=False, msg=err), 400
    msg = _save_or_queue(role, {day_no: tasks}, f"{role} · Day {day_no} ({len(tasks)} tasks)")
    return jsonify(ok=True, msg=msg)


def _parse_upload(file_storage):
    """Read an uploaded .xlsx or .csv into rows of (day, title, description).
    Returns (rows, errors)."""
    name = (file_storage.filename or "").lower()
    raw_rows = []
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(file_storage.read()), read_only=True, data_only=True)
        ws = wb.active
        for r in ws.iter_rows(values_only=True):
            raw_rows.append(["" if c is None else str(c).strip() for c in r])
    elif name.endswith(".csv"):
        text = file_storage.read().decode("utf-8-sig", errors="replace")
        raw_rows = [[(c or "").strip() for c in r] for r in csv.reader(io.StringIO(text))]
    else:
        return None, ["Please upload an Excel (.xlsx) or CSV file."]

    # find the header row (the one that has "day" in the first column)
    start = None
    for i, r in enumerate(raw_rows):
        if len(r) >= 2 and r[0].strip().lower() in ("day", "day no", "day_no") and "task" in r[1].strip().lower():
            start = i + 1
            break
    if start is None:
        return None, ["Header row not found. Use the sample file (columns: Day, Task title, Task description)."]

    rows, errors = [], []
    for i, r in enumerate(raw_rows[start:], start=start + 1):
        r = (r + ["", "", ""])[:3]
        day_s, title, desc = r
        if not day_s and not title and not desc:
            continue
        try:
            day_no = int(float(day_s))
        except ValueError:
            errors.append(f"Row {i}: Day '{day_s}' is not a number.")
            continue
        if not (1 <= day_no <= OJT_DAYS):
            errors.append(f"Row {i}: Day must be between 1 and {OJT_DAYS}.")
            continue
        if not title:
            errors.append(f"Row {i}: Task title is empty.")
            continue
        rows.append((day_no, title[:300], desc[:2000]))
    return rows, errors


@ojt_bp.route("/api/ojt/upload", methods=["POST"])
@_staff_required
def api_upload():
    role = _clean_role(request.form.get("role"))
    if not role:
        return jsonify(ok=False, msg="Pick a role first."), 400
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(ok=False, msg="Choose a file to upload."), 400
    rows, errors = _parse_upload(f)
    if rows is None:
        return jsonify(ok=False, msg=errors[0], errors=errors), 400
    if errors:
        # nothing is saved if the file has mistakes — fix and upload again
        return jsonify(ok=False, msg=f"{len(errors)} problem(s) found. Nothing was saved — please fix and upload again.",
                       errors=errors), 400
    if not rows:
        return jsonify(ok=False, msg="The file has no tasks."), 400
    days_map = {}
    for day_no, title, desc in rows:
        days_map.setdefault(day_no, []).append({"title": title, "description": desc})
    for dn, tl in days_map.items():
        if len(tl) > MAX_TASKS_PER_DAY:
            return jsonify(ok=False, msg=f"Day {dn} has more than {MAX_TASKS_PER_DAY} tasks."), 400
    # days NOT in the file are left as they are
    msg = _save_or_queue(role, days_map,
                         f"{role} · file upload ({len(rows)} tasks, {len(days_map)} days)")
    return jsonify(ok=True, msg=msg, tasks=len(rows), days=len(days_map))


@ojt_bp.route("/api/ojt/template.xlsx")
@_staff_required
def api_template_xlsx():
    """Download the current tasks for a role (or a sample if empty) as Excel.
    Edit it and upload the same file back."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    role = _clean_role(request.args.get("role")) or "BDE"
    days = _tasks_by_day(role)
    wb = Workbook()
    ws = wb.active
    ws.title = f"{role} OJT"[:30]
    ws.append([f"Mr. Golisoda — {role} OJT task template (one row per task; add as many rows per day as needed)"])
    ws["A1"].font = Font(bold=True, size=12)
    ws.append(["Days 29–30 are Final review. Sundays are shown automatically as week off. Do not change the header row below."])
    ws.append(["Day", "Task title", "Task description"])
    for c in ws[3]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="00AEEF")
    has_any = any(days[d] for d in days)
    if has_any:
        for d in range(1, OJT_DAYS + 1):
            for t in days[d]:
                ws.append([d, t["title"], t["description"]])
    else:
        ws.append([1, "Example: Outlet visit with buddy", "Visit 10 existing outlets with your buddy and observe billing"])
        ws.append([1, "Example: Learn the order app", "Enter 3 practice orders in the app"])
        ws.append([2, "Example: Independent outlet visits", "Visit 5 outlets on your own, buddy checks"])
    ws.column_dimensions["A"].width = 8
    ws.column_dimensions["B"].width = 42
    ws.column_dimensions["C"].width = 80
    for row in ws.iter_rows(min_row=4):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    bio = io.BytesIO()
    wb.save(bio)
    fname = f"OJT_{role.replace(' ', '_')}_Tasks.xlsx"
    return Response(bio.getvalue(),
                    mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------------------------------------------------------
#  API — Approvals for instructor task changes
# ---------------------------------------------------------------
@ojt_bp.route("/api/ojt/pending")
@_staff_required
def api_pending():
    u = _current_user()
    db = _get_db()
    if u["role"] == "admin":
        rows = db.execute(
            "SELECT id, target_id, target_label, payload, requested_by_name, created_at FROM pending_actions "
            "WHERE action_type='ojt_tasks' AND status='pending' ORDER BY created_at").fetchall()
    else:
        rows = db.execute(
            "SELECT id, target_id, target_label, payload, requested_by_name, created_at, status FROM pending_actions "
            "WHERE action_type='ojt_tasks' AND requested_by=? ORDER BY created_at DESC LIMIT 30",
            (u["emp_id"],)).fetchall()
    items = []
    for r in rows:
        try:
            p = json.loads(r["payload"] or "{}")
        except Exception:
            p = {}
        items.append({"id": r["id"], "role": r["target_id"], "label": r["target_label"],
                      "by": r["requested_by_name"], "created_at": r["created_at"],
                      "status": r["status"] if "status" in r.keys() else "pending",
                      "days": p.get("days", {})})
    return jsonify(ok=True, items=items, is_admin=(u["role"] == "admin"))


@ojt_bp.route("/api/ojt/resolve", methods=["POST"])
@_admin_only
def api_resolve():
    d = request.get_json(force=True)
    db = _get_db()
    act = db.execute("SELECT * FROM pending_actions WHERE id=? AND action_type='ojt_tasks' AND status='pending'",
                     (d.get("id"),)).fetchone()
    if not act:
        return jsonify(ok=False, msg="Request not found or already handled."), 404
    if d.get("decision") == "approve":
        p = json.loads(act["payload"] or "{}")
        role = _clean_role(p.get("role"))
        if role:
            _apply_days(role, {int(k): v for k, v in (p.get("days") or {}).items()},
                        _current_user()["emp_id"])
        db.execute("UPDATE pending_actions SET status='approved' WHERE id=?", (act["id"],))
        db.commit()
        return jsonify(ok=True, msg="Approved — the new tasks are live.")
    db.execute("UPDATE pending_actions SET status='rejected' WHERE id=?", (act["id"],))
    db.commit()
    return jsonify(ok=True, msg="Rejected — the current tasks stay live.")


# ---------------------------------------------------------------
#  Trainee timeline (30 calendar days)
# ---------------------------------------------------------------
def _parse_date(s):
    try:
        return datetime.strptime((s or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _timeline(enr, light=False):
    """Build the OJT view for one enrollment.

    OJT is 30 WORKING days. We walk real calendar dates from the start and
    place the 30 task-sets in order onto working days only. Sundays are a fixed
    week-off (no task, don't count) unless a trainer/admin marked that Sunday
    as 'worked'. Any working day marked 'leave' or 'weekoff' is skipped and
    doesn't count — so the finish date extends. A worked Sunday counts and
    pulls the finish date earlier. Task-set N always lands on the Nth working
    day, whatever calendar date that turns out to be.

    light=True is for the trainees LIST: it loads only what's needed for the
    progress summary (holidays, signoff count, task count) and skips the six
    detail queries (selfmarks, daynotes, remarks, calls) — far fewer database
    round-trips when listing many trainees.
    """
    db = _get_db()
    start = _parse_date(enr["start_date"])
    today = _today_ist()

    # per-date overrides set by trainer/admin: date -> kind ('leave'|'weekoff'|'worked')
    overrides = {}
    for h in db.execute(
        "SELECT on_date, kind FROM ojt_holidays WHERE enrollment_id=?", (enr["id"],)
    ).fetchall():
        overrides[h["on_date"]] = (h["kind"] if ("kind" in h.keys() and h["kind"]) else "leave")

    signed = {s["task_id"]: s for s in db.execute(
        "SELECT task_id, signed_by, signed_at FROM ojt_signoffs WHERE enrollment_id=?", (enr["id"],)).fetchall()}
    if light:
        selfmarks = set(); daynotes = {}; task_remarks = {}; day_remarks = {}; calls_by_day = {}
    else:
        selfmarks = {s["task_id"] for s in db.execute(
            "SELECT task_id FROM ojt_selfmarks WHERE enrollment_id=?", (enr["id"],)).fetchall()}
        daynotes = {}
        for r in db.execute(
            "SELECT day_no, problems, work_done FROM ojt_daynotes WHERE enrollment_id=?", (enr["id"],)).fetchall():
            daynotes[r["day_no"]] = {"problems": r["problems"] or "", "work_done": r["work_done"] or ""}
        # trainer task-level remarks + tags
        task_remarks = {}
        for r in db.execute(
            "SELECT task_id, remark, not_done_reason, tag_ids FROM ojt_task_remarks WHERE enrollment_id=?",
            (enr["id"],)).fetchall():
            task_remarks[r["task_id"]] = {
                "remark": r["remark"] or "", "not_done_reason": r["not_done_reason"] or "",
                "tag_ids": [int(x) for x in (r["tag_ids"] or "").split(",") if x.strip().isdigit()]}
        # trainer day-level remarks + tags
        day_remarks = {}
        for r in db.execute(
            "SELECT day_no, remark, tag_ids FROM ojt_day_remarks WHERE enrollment_id=?", (enr["id"],)).fetchall():
            day_remarks[r["day_no"]] = {
                "remark": r["remark"] or "",
                "tag_ids": [int(x) for x in (r["tag_ids"] or "").split(",") if x.strip().isdigit()]}
        # call attempts grouped by day
        calls_by_day = {}
        for r in db.execute(
            "SELECT id, day_no, outcome, note, called_at FROM ojt_calls WHERE enrollment_id=? ORDER BY id", (enr["id"],)).fetchall():
            calls_by_day.setdefault(r["day_no"], []).append(
                {"id": r["id"], "outcome": r["outcome"], "note": r["note"] or "", "called_at": r["called_at"] or ""})
    tasks = _tasks_by_day(enr["role"])

    days, total, done, due, due_done = [], 0, 0, 0, 0
    work_no = 0          # how many working days placed so far (1..30)
    cur = start
    guard = 0            # safety stop (never loop forever)
    end_date = start

    # keep walking calendar days until all 30 working days are placed
    while work_no < OJT_DAYS and guard < 400:
        guard += 1
        ds = cur.isoformat()
        ov = overrides.get(ds)
        is_sunday = (cur.weekday() == 6)

        # decide what this calendar day is
        if ov == "worked":
            kind = "work"
        elif ov in ("leave", "weekoff"):
            kind = ov
        elif is_sunday:
            kind = "sunday"          # fixed week off
        else:
            kind = "work"

        if kind == "work":
            work_no += 1
            n = work_no
            is_review = n in REVIEW_DAYS
            tl = []
            for t in tasks.get(n, []):
                s = signed.get(t["id"])
                tr = task_remarks.get(t["id"], {"remark": "", "not_done_reason": "", "tag_ids": []})
                tl.append({"id": t["id"], "title": t["title"], "description": t["description"],
                           "done": bool(s), "signed_at": s["signed_at"] if s else None,
                           "self_done": t["id"] in selfmarks,
                           "remark": tr["remark"], "not_done_reason": tr["not_done_reason"],
                           "tag_ids": tr["tag_ids"]})
                total += 1
                if s:
                    done += 1
                if cur <= today:
                    due += 1
                    if s:
                        due_done += 1
            nt = daynotes.get(n, {"problems": "", "work_done": ""})
            dr = day_remarks.get(n, {"remark": "", "tag_ids": []})
            days.append({"day": n, "date": ds, "weekday": cur.strftime("%a"),
                         "kind": ("review" if is_review else "work"),
                         "is_today": cur == today, "past": cur < today,
                         "can_edit": True, "override": ov, "tasks": tl,
                         "problems": nt["problems"], "work_done": nt["work_done"],
                         "day_remark": dr["remark"], "day_tag_ids": dr["tag_ids"],
                         "calls": calls_by_day.get(n, [])})
            end_date = cur
        else:
            # non-working calendar day (sunday / leave / weekoff) — shown, no task, no count
            days.append({"day": None, "date": ds, "weekday": cur.strftime("%a"),
                         "kind": kind, "is_today": cur == today, "past": cur < today,
                         "can_edit": True, "override": ov, "tasks": []})
        cur = cur + timedelta(days=1)

    # which working-day number is "today"?
    day_no = 0
    for d in days:
        if d["day"] is not None and d["date"] <= today.isoformat():
            day_no = d["day"]
    if day_no == 0 and today >= start:
        day_no = 1   # started, first working day pending

    return {
        "days": days,
        "day_no": day_no,
        "total": total, "done": done,
        "overdue": due - due_done,
        "end_date": end_date.isoformat(),
        "sundays": sum(1 for d in days if d["kind"] == "sunday"),
        "holidays": sum(1 for d in days if d["kind"] in ("leave", "weekoff")),
        "worked_sundays": sum(1 for d in days if d["kind"] == "work" and d["weekday"] == "Sun"),
    }


def _enrollment_visible(enr, u):
    return u["role"] == "admin" or enr["trainer_id"] == u["emp_id"]


def _day_label(day_no, status):
    if status != "active":
        return status.title()
    if day_no < 1:
        return "Starts soon"
    if day_no > OJT_DAYS:
        return "30 days over — awaiting final sign-off"
    return f"Day {day_no} of {OJT_DAYS}"


# ---------------------------------------------------------------
#  API — Trainees (admin / instructor)
# ---------------------------------------------------------------
@ojt_bp.route("/api/ojt/trainees")
@_staff_required
def api_trainees():
    u = _current_user()
    db = _get_db()
    role = _clean_role(request.args.get("role"))
    show = request.args.get("show", "active")
    sql = ("SELECT e.*, us.name, us.designation, tr.name AS trainer_name FROM ojt_enrollments e "
           "LEFT JOIN users us ON us.emp_id=e.emp_id LEFT JOIN users tr ON tr.emp_id=e.trainer_id WHERE 1=1")
    params = []
    if role:
        sql += " AND e.role=?"
        params.append(role)
    if show == "active":
        sql += " AND e.status='active'"
    elif show == "closed":
        sql += " AND e.status<>'active'"
    if u["role"] != "admin":
        sql += " AND e.trainer_id=?"
        params.append(u["emp_id"])
    sql += " ORDER BY e.start_date DESC, us.name"
    rows = [] if show == "none" else db.execute(sql, tuple(params)).fetchall()

    out = []
    for e in rows:
        tl = _timeline(e, light=True)
        out.append({
            "id": e["id"], "emp_id": e["emp_id"], "name": e["name"] or e["emp_id"],
            "designation": e["designation"] or "", "role": e["role"],
            "start_date": e["start_date"], "end_date": tl["end_date"],
            "trainer": e["trainer_name"] or "—", "status": e["status"],
            "day_no": tl["day_no"], "day_label": _day_label(tl["day_no"], e["status"]),
            "done": tl["done"], "total": tl["total"], "overdue": tl["overdue"],
        })

    # per-role active counts for the tab badges
    csql = "SELECT role, COUNT(*) c FROM ojt_enrollments WHERE status='active'"
    cparams = []
    if u["role"] != "admin":
        csql += " AND trainer_id=?"
        cparams.append(u["emp_id"])
    csql += " GROUP BY role"
    counts = {r: 0 for r in OJT_ROLES}
    for r in db.execute(csql, tuple(cparams)).fetchall():
        counts[r["role"]] = r["c"]
    return jsonify(ok=True, trainees=out, counts=counts, is_admin=(u["role"] == "admin"))


@ojt_bp.route("/api/ojt/eligible")
@_staff_required
def api_eligible():
    """Approved learners of this role who are not already on an active OJT,
    plus the trainer list (instructors) for the admin to assign."""
    role = _clean_role(request.args.get("role"))
    db = _get_db()
    active = {r["emp_id"] for r in db.execute(
        "SELECT emp_id FROM ojt_enrollments WHERE status='active'").fetchall()}
    people = []
    for r in db.execute("SELECT emp_id, name, designation FROM users "
                        "WHERE status='approved' AND role='staff' ORDER BY name").fetchall():
        if r["emp_id"] in active:
            continue
        if role and _role_from_designation(r["designation"]) != role:
            continue
        people.append({"emp_id": r["emp_id"], "name": r["name"], "designation": r["designation"] or ""})
    trainers = [dict(r) for r in db.execute(
        "SELECT emp_id, name FROM users WHERE role IN ('instructor','admin') AND status='approved' ORDER BY name"
    ).fetchall()]
    return jsonify(ok=True, people=people, trainers=trainers, today=_today_ist().isoformat())


@ojt_bp.route("/api/ojt/start", methods=["POST"])
@_staff_required
def api_start():
    """Trainer marks 'Audit passed' -> OJT Day 1 = the audit date."""
    u = _current_user()
    d = request.get_json(force=True)
    emp_id = (d.get("emp_id") or "").strip()
    start = _parse_date(d.get("audit_date"))
    if not emp_id or not start:
        return jsonify(ok=False, msg="Pick the employee and the audit passed date."), 400
    if start > _today_ist() + timedelta(days=7):
        return jsonify(ok=False, msg="Audit date cannot be more than a week in the future."), 400
    db = _get_db()
    emp = db.execute("SELECT emp_id, name, designation, status FROM users WHERE emp_id=?", (emp_id,)).fetchone()
    if not emp or emp["status"] != "approved":
        return jsonify(ok=False, msg="Employee not found or not active."), 404
    role = _clean_role(d.get("role")) or _role_from_designation(emp["designation"])
    if not role:
        return jsonify(ok=False, msg="This employee's designation is not BDE, BDM or State Head."), 400
    if db.execute("SELECT 1 FROM ojt_enrollments WHERE emp_id=? AND status='active'", (emp_id,)).fetchone():
        return jsonify(ok=False, msg=f"{emp['name']} is already on an active OJT."), 400
    # instructors are always the trainer of the people they start; admin can pick
    trainer = u["emp_id"] if u["role"] == "instructor" else ((d.get("trainer_id") or "").strip() or None)
    db.execute(
        "INSERT INTO ojt_enrollments (emp_id, role, start_date, trainer_id, status, created_by, created_at) "
        "VALUES (?,?,?,?, 'active', ?, ?)",
        (emp_id, role, start.isoformat(), trainer, u["emp_id"], _now()))
    db.commit()
    return jsonify(ok=True, msg=f"OJT started for {emp['name']} — Day 1 is {start.strftime('%d %b %Y')}.")


@ojt_bp.route("/api/ojt/trainee")
@_staff_required
def api_trainee():
    u = _current_user()
    db = _get_db()
    e = db.execute("SELECT e.*, us.name, tr.name AS trainer_name FROM ojt_enrollments e "
                   "LEFT JOIN users us ON us.emp_id=e.emp_id LEFT JOIN users tr ON tr.emp_id=e.trainer_id "
                   "WHERE e.id=?", (request.args.get("id"),)).fetchone()
    if not e or not _enrollment_visible(e, u):
        return jsonify(ok=False, msg="Not found."), 404
    tl = _timeline(e)
    return jsonify(ok=True, enrollment={
        "id": e["id"], "name": e["name"] or e["emp_id"], "emp_id": e["emp_id"], "role": e["role"],
        "start_date": e["start_date"], "trainer": e["trainer_name"] or "—", "status": e["status"],
        "final_note": e["final_note"] or "", "day_label": _day_label(tl["day_no"], e["status"]),
    }, timeline=tl)


def _get_enr_for_edit(enr_id):
    u = _current_user()
    e = _get_db().execute("SELECT * FROM ojt_enrollments WHERE id=?", (enr_id,)).fetchone()
    if not e or not _enrollment_visible(e, u):
        return None, (jsonify(ok=False, msg="Not found."), 404)
    if e["status"] != "active":
        return None, (jsonify(ok=False, msg="This OJT is already closed."), 400)
    return e, None


@ojt_bp.route("/api/ojt/signoff", methods=["POST"])
@_staff_required
def api_signoff():
    """Trainer ticks / unticks a task for a trainee."""
    d = request.get_json(force=True)
    e, err = _get_enr_for_edit(d.get("enrollment_id"))
    if err:
        return err
    db = _get_db()
    t = db.execute("SELECT id, title, day_no, role FROM ojt_tasks WHERE id=?", (d.get("task_id"),)).fetchone()
    if not t or t["role"] != e["role"]:
        return jsonify(ok=False, msg="Task not found."), 404
    if d.get("done"):
        if not db.execute("SELECT 1 FROM ojt_signoffs WHERE enrollment_id=? AND task_id=?",
                          (e["id"], t["id"])).fetchone():
            db.execute("INSERT INTO ojt_signoffs (enrollment_id, task_id, task_title, day_no, signed_by, signed_at) "
                       "VALUES (?,?,?,?,?,?)",
                       (e["id"], t["id"], t["title"], t["day_no"], _current_user()["emp_id"], _now()))
    else:
        db.execute("DELETE FROM ojt_signoffs WHERE enrollment_id=? AND task_id=?", (e["id"], t["id"]))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/holiday", methods=["POST"])
@_staff_required
def api_holiday():
    """Set a per-day override for one enrollment date.
    kind: 'leave' | 'weekoff' | 'worked' | 'clear'
      - leave/weekoff : a normal working day becomes non-working (extends the OJT)
      - worked        : a Sunday becomes a working day (pulls the finish earlier)
      - clear         : remove any override (back to default: Sunday=weekoff, else work)
    Trainer or admin only.
    """
    d = request.get_json(force=True)
    e, err = _get_enr_for_edit(d.get("enrollment_id"))
    if err:
        return err
    on = _parse_date(d.get("date"))
    start = _parse_date(e["start_date"])
    # allow any date from the start through a generous window (OJT can extend well
    # past 30 calendar days once week-offs/leave are counted out)
    if not on or on < start or on > start + timedelta(days=120):
        return jsonify(ok=False, msg="Date is outside this OJT."), 400

    # accept either the new 'kind' or the old on/off shape (back-compat)
    kind = (d.get("kind") or "").strip().lower()
    if not kind:
        kind = "leave" if d.get("on") else "clear"

    is_sunday = (on.weekday() == 6)
    if kind == "worked" and not is_sunday:
        return jsonify(ok=False, msg="Only a Sunday can be marked as worked."), 400
    if kind in ("leave", "weekoff") and is_sunday:
        return jsonify(ok=False, msg="Sunday is already a week off. To make a trainee work a Sunday, mark it 'Worked'."), 400
    if kind not in ("leave", "weekoff", "worked", "clear"):
        return jsonify(ok=False, msg="Unknown day status."), 400

    db = _get_db()
    ds = on.isoformat()
    if kind == "clear":
        db.execute("DELETE FROM ojt_holidays WHERE enrollment_id=? AND on_date=?", (e["id"], ds))
    else:
        row = db.execute("SELECT 1 FROM ojt_holidays WHERE enrollment_id=? AND on_date=?",
                         (e["id"], ds)).fetchone()
        if row:
            db.execute("UPDATE ojt_holidays SET kind=?, marked_by=?, marked_at=? WHERE enrollment_id=? AND on_date=?",
                       (kind, _current_user()["emp_id"], _now(), e["id"], ds))
        else:
            db.execute("INSERT INTO ojt_holidays (enrollment_id, on_date, kind, marked_by, marked_at) VALUES (?,?,?,?,?)",
                       (e["id"], ds, kind, _current_user()["emp_id"], _now()))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/close", methods=["POST"])
@_staff_required
def api_close():
    """Trainer's final decision after the 30 days: completed or failed."""
    d = request.get_json(force=True)
    e, err = _get_enr_for_edit(d.get("enrollment_id"))
    if err:
        return err
    outcome = (d.get("outcome") or "").strip()
    if outcome not in ("completed", "failed"):
        return jsonify(ok=False, msg="Choose Completed or Failed."), 400
    db = _get_db()
    db.execute("UPDATE ojt_enrollments SET status=?, final_note=?, closed_at=? WHERE id=?",
               (outcome, (d.get("note") or "").strip()[:1000], _now(), e["id"]))
    db.commit()
    return jsonify(ok=True, msg="OJT marked " + outcome + ".")


@ojt_bp.route("/api/ojt/remove", methods=["POST"])
@_admin_only
def api_remove():
    """Admin only: remove an OJT started by mistake (and its sign-offs)."""
    d = request.get_json(force=True)
    db = _get_db()
    eid = d.get("enrollment_id")
    db.execute("DELETE FROM ojt_signoffs WHERE enrollment_id=?", (eid,))
    db.execute("DELETE FROM ojt_holidays WHERE enrollment_id=?", (eid,))
    db.execute("DELETE FROM ojt_enrollments WHERE id=?", (eid,))
    db.commit()
    return jsonify(ok=True, msg="OJT removed.")


# ---------------------------------------------------------------
#  API — Learner ("My OJT")
# ---------------------------------------------------------------
@ojt_bp.route("/api/ojt/my")
@_login_only
def api_my():
    u = _current_user()
    db = _get_db()
    e = db.execute("SELECT e.*, tr.name AS trainer_name FROM ojt_enrollments e "
                   "LEFT JOIN users tr ON tr.emp_id=e.trainer_id "
                   "WHERE e.emp_id=? ORDER BY (e.status='active') DESC, e.start_date DESC LIMIT 1",
                   (u["emp_id"],)).fetchone()
    if not e:
        return jsonify(ok=True, enrolled=False)
    tl = _timeline(e)
    return jsonify(ok=True, enrolled=True, enrollment={
        "role": e["role"], "start_date": e["start_date"], "status": e["status"],
        "trainer": e["trainer_name"] or "—", "day_label": _day_label(tl["day_no"], e["status"]),
    }, timeline=tl)


def _my_active_enrollment():
    """The logged-in trainee's own active enrollment, or (None, error)."""
    u = _current_user()
    db = _get_db()
    e = db.execute("SELECT * FROM ojt_enrollments WHERE emp_id=? ORDER BY (status='active') DESC, start_date DESC LIMIT 1",
                   (u["emp_id"],)).fetchone()
    if not e:
        return None, (jsonify(ok=False, msg="You have no OJT."), 404)
    if e["status"] != "active":
        return None, (jsonify(ok=False, msg="Your OJT isn't active."), 400)
    return e, None


@ojt_bp.route("/api/ojt/my-selfmark", methods=["POST"])
@_login_only
def api_my_selfmark():
    """Trainee marks their OWN task as done / not done. This is the trainee's
    claim — the trainer still gives the official sign-off separately."""
    e, err = _my_active_enrollment()
    if err:
        return err
    d = request.get_json(force=True)
    task_id = d.get("task_id")
    on = bool(d.get("on"))
    if not task_id:
        return jsonify(ok=False, msg="Missing task."), 400
    # confirm the task belongs to this trainee's role
    db = _get_db()
    t = db.execute("SELECT day_no FROM ojt_tasks WHERE id=? AND role=?", (task_id, e["role"])).fetchone()
    if not t:
        return jsonify(ok=False, msg="Task not found for your role."), 404
    if on:
        if not db.execute("SELECT 1 FROM ojt_selfmarks WHERE enrollment_id=? AND task_id=?",
                          (e["id"], task_id)).fetchone():
            db.execute("INSERT INTO ojt_selfmarks (enrollment_id, task_id, day_no, marked_at) VALUES (?,?,?,?)",
                       (e["id"], task_id, t["day_no"], _now()))
    else:
        db.execute("DELETE FROM ojt_selfmarks WHERE enrollment_id=? AND task_id=?", (e["id"], task_id))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/my-daynote", methods=["POST"])
@_login_only
def api_my_daynote():
    """Trainee saves their daily notes — problems faced and work done."""
    e, err = _my_active_enrollment()
    if err:
        return err
    d = request.get_json(force=True)
    try:
        day_no = int(d.get("day_no"))
    except Exception:
        return jsonify(ok=False, msg="Missing day."), 400
    problems = (d.get("problems") or "").strip()[:2000]
    work_done = (d.get("work_done") or "").strip()[:2000]
    db = _get_db()
    if db.execute("SELECT 1 FROM ojt_daynotes WHERE enrollment_id=? AND day_no=?", (e["id"], day_no)).fetchone():
        db.execute("UPDATE ojt_daynotes SET problems=?, work_done=?, updated_at=? WHERE enrollment_id=? AND day_no=?",
                   (problems, work_done, _now(), e["id"], day_no))
    else:
        db.execute("INSERT INTO ojt_daynotes (enrollment_id, day_no, problems, work_done, updated_at) VALUES (?,?,?,?,?)",
                   (e["id"], day_no, problems, work_done, _now()))
    db.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------
#  Tags (admin-managed) + trainer remarks + call log
# ---------------------------------------------------------------
def _tags_payload(include_inactive=False):
    db = _get_db()
    q = "SELECT id, label, kind, active FROM ojt_tags"
    if not include_inactive:
        q += " WHERE active=1"
    q += " ORDER BY kind DESC, sort_no, label"
    return [dict(r) for r in db.execute(q).fetchall()]


@ojt_bp.route("/api/ojt/tags")
@_login_only
def api_ojt_tags():
    """List tags. Admin/instructor/trainer all need these to render the pickers.
    Admins can request inactive ones too (for the manager screen)."""
    u = _current_user()
    inc = bool(request.args.get("all")) and u and u["role"] == "admin"
    return jsonify(ok=True, tags=_tags_payload(include_inactive=inc))


@ojt_bp.route("/api/ojt/tag-save", methods=["POST"])
@_staff_required
def api_ojt_tag_save():
    """Admin only: add or edit a tag."""
    u = _current_user()
    if u["role"] != "admin":
        return jsonify(ok=False, msg="Only an admin can manage tags."), 403
    d = request.get_json(force=True)
    label = (d.get("label") or "").strip()[:80]
    kind = (d.get("kind") or "problem").strip().lower()
    if kind not in ("problem", "positive"):
        kind = "problem"
    if not label:
        return jsonify(ok=False, msg="Tag name is required."), 400
    db = _get_db()
    tid = d.get("id")
    if tid:
        db.execute("UPDATE ojt_tags SET label=?, kind=? WHERE id=?", (label, kind, tid))
    else:
        if db.execute("SELECT 1 FROM ojt_tags WHERE lower(label)=lower(?)", (label,)).fetchone():
            return jsonify(ok=False, msg="A tag with that name already exists."), 400
        n = db.execute("SELECT COALESCE(MAX(sort_no),0)+1 AS s FROM ojt_tags").fetchone()["s"]
        db.execute("INSERT INTO ojt_tags (label, kind, active, sort_no, created_at) VALUES (?,?,1,?,?)",
                   (label, kind, n, _now()))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/tag-delete", methods=["POST"])
@_staff_required
def api_ojt_tag_delete():
    """Admin only: deactivate a tag (kept for old records, hidden from pickers)."""
    u = _current_user()
    if u["role"] != "admin":
        return jsonify(ok=False, msg="Only an admin can manage tags."), 403
    d = request.get_json(force=True)
    db = _get_db()
    db.execute("UPDATE ojt_tags SET active=0 WHERE id=?", (d.get("id"),))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/task-remark", methods=["POST"])
@_staff_required
def api_ojt_task_remark():
    """Trainer/admin: save a remark, tags and (if not done) a reason on one task."""
    d = request.get_json(force=True)
    e, err = _get_enr_for_edit(d.get("enrollment_id"))
    if err:
        return err
    db = _get_db()
    t = db.execute("SELECT id, day_no, role FROM ojt_tasks WHERE id=?", (d.get("task_id"),)).fetchone()
    if not t or t["role"] != e["role"]:
        return jsonify(ok=False, msg="Task not found."), 404
    remark = (d.get("remark") or "").strip()[:2000]
    reason = (d.get("not_done_reason") or "").strip()[:2000]
    tag_ids = ",".join(str(int(x)) for x in (d.get("tag_ids") or []) if str(x).isdigit())
    # required reason when the task is NOT signed off
    is_signed = db.execute("SELECT 1 FROM ojt_signoffs WHERE enrollment_id=? AND task_id=?",
                           (e["id"], t["id"])).fetchone()
    if not is_signed and not reason and not remark:
        return jsonify(ok=False, msg="Add a reason why this task isn't done."), 400
    if db.execute("SELECT 1 FROM ojt_task_remarks WHERE enrollment_id=? AND task_id=?",
                  (e["id"], t["id"])).fetchone():
        db.execute("UPDATE ojt_task_remarks SET remark=?, not_done_reason=?, tag_ids=?, marked_by=?, updated_at=? "
                   "WHERE enrollment_id=? AND task_id=?",
                   (remark, reason, tag_ids, _current_user()["emp_id"], _now(), e["id"], t["id"]))
    else:
        db.execute("INSERT INTO ojt_task_remarks (enrollment_id, task_id, day_no, remark, not_done_reason, tag_ids, marked_by, updated_at) "
                   "VALUES (?,?,?,?,?,?,?,?)",
                   (e["id"], t["id"], t["day_no"], remark, reason, tag_ids, _current_user()["emp_id"], _now()))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/day-remark", methods=["POST"])
@_staff_required
def api_ojt_day_remark():
    """Trainer/admin: save an overall remark + tags for a whole day."""
    d = request.get_json(force=True)
    e, err = _get_enr_for_edit(d.get("enrollment_id"))
    if err:
        return err
    try:
        day_no = int(d.get("day_no"))
    except Exception:
        return jsonify(ok=False, msg="Missing day."), 400
    remark = (d.get("remark") or "").strip()[:2000]
    tag_ids = ",".join(str(int(x)) for x in (d.get("tag_ids") or []) if str(x).isdigit())
    db = _get_db()
    if db.execute("SELECT 1 FROM ojt_day_remarks WHERE enrollment_id=? AND day_no=?", (e["id"], day_no)).fetchone():
        db.execute("UPDATE ojt_day_remarks SET remark=?, tag_ids=?, marked_by=?, updated_at=? WHERE enrollment_id=? AND day_no=?",
                   (remark, tag_ids, _current_user()["emp_id"], _now(), e["id"], day_no))
    else:
        db.execute("INSERT INTO ojt_day_remarks (enrollment_id, day_no, remark, tag_ids, marked_by, updated_at) VALUES (?,?,?,?,?,?)",
                   (e["id"], day_no, remark, tag_ids, _current_user()["emp_id"], _now()))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/log-call", methods=["POST"])
@_staff_required
def api_ojt_log_call():
    """Trainer/admin: log one call attempt for a trainee on a day."""
    d = request.get_json(force=True)
    e, err = _get_enr_for_edit(d.get("enrollment_id"))
    if err:
        return err
    outcome = (d.get("outcome") or "").strip().lower()
    if outcome not in ("no_answer", "busy", "spoke_done", "spoke_not_done"):
        return jsonify(ok=False, msg="Pick a call outcome."), 400
    try:
        day_no = int(d.get("day_no"))
    except Exception:
        day_no = None
    note_txt = (d.get("note") or "").strip()[:500]
    db = _get_db()
    db.execute("INSERT INTO ojt_calls (enrollment_id, day_no, outcome, note, called_by, called_at) VALUES (?,?,?,?,?,?)",
               (e["id"], day_no, outcome, note_txt, _current_user()["emp_id"], _now()))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/delete-call", methods=["POST"])
@_staff_required
def api_ojt_delete_call():
    """Trainer/admin: remove a mistaken call-log entry."""
    d = request.get_json(force=True)
    e, err = _get_enr_for_edit(d.get("enrollment_id"))
    if err:
        return err
    try:
        call_id = int(d.get("id"))
    except (TypeError, ValueError):
        return jsonify(ok=False, msg="Invalid call id."), 400
    db = _get_db()
    db.execute("DELETE FROM ojt_calls WHERE id=? AND enrollment_id=?", (call_id, e["id"]))
    db.commit()
    return jsonify(ok=True)


@ojt_bp.route("/api/ojt/edit-call", methods=["POST"])
@_staff_required
def api_ojt_edit_call():
    """Trainer/admin: change a logged call's outcome (e.g. mistakenly logged
    'no answer' but they picked up)."""
    d = request.get_json(force=True)
    e, err = _get_enr_for_edit(d.get("enrollment_id"))
    if err:
        return err
    outcome = (d.get("outcome") or "").strip().lower()
    if outcome not in ("no_answer", "busy", "spoke_done", "spoke_not_done"):
        return jsonify(ok=False, msg="Pick a call outcome."), 400
    try:
        call_id = int(d.get("id"))
    except (TypeError, ValueError):
        return jsonify(ok=False, msg="Invalid call id."), 400
    db = _get_db()
    db.execute("UPDATE ojt_calls SET outcome=? WHERE id=? AND enrollment_id=?", (outcome, call_id, e["id"]))
    db.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------
#  Excel export — per trainee and all trainees
# ---------------------------------------------------------------
_CALL_LABEL = {"no_answer": "No answer", "busy": "Busy",
               "spoke_done": "Spoke – done", "spoke_not_done": "Spoke – not done"}


def _emp_name(emp_id):
    r = _get_db().execute("SELECT name FROM users WHERE emp_id=?", (emp_id,)).fetchone()
    return (r["name"] if r else emp_id)


def _export_rows_for(enr):
    """Flatten one trainee's OJT into day-wise rows for Excel."""
    tl = _timeline(enr)
    db = _get_db()
    tagmap = {t["id"]: t["label"] for t in db.execute("SELECT id, label FROM ojt_tags").fetchall()}
    name = _emp_name(enr["emp_id"])
    rows = []
    for day in tl["days"]:
        if day["day"] is None:
            continue  # skip week-off / leave rows
        tasks_done = sum(1 for t in day["tasks"] if t["done"])
        tasks_total = len(day["tasks"])
        # task remarks / reasons rolled into one cell
        tremarks = []
        for t in day["tasks"]:
            bits = []
            if t["remark"]:
                bits.append("📝 " + t["remark"])
            if (not t["done"]) and t["not_done_reason"]:
                bits.append("⚠ " + t["not_done_reason"])
            if bits:
                tremarks.append(t["title"] + ": " + " | ".join(bits))
        calls = day.get("calls", [])
        call_summary = "; ".join(
            (_CALL_LABEL.get(c["outcome"], c["outcome"])) for c in calls)
        day_tags = ", ".join(tagmap.get(i, "") for i in day.get("day_tag_ids", []) if tagmap.get(i))
        rows.append({
            "name": name, "emp_id": enr["emp_id"], "role": enr["role"],
            "day": day["day"], "date": day["date"], "weekday": day["weekday"],
            "tasks": f"{tasks_done}/{tasks_total}",
            "trainee_work": day.get("work_done", ""), "trainee_problems": day.get("problems", ""),
            "task_remarks": "\n".join(tremarks),
            "calls_count": len(calls), "call_outcomes": call_summary,
            "day_remark": day.get("day_remark", ""), "day_tags": day_tags,
        })
    return rows


def _build_ojt_workbook(enrollments, title):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "OJT Report"
    ws.append([title])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([f"Generated {datetime.utcnow().strftime('%d %b %Y')}"])
    ws.append([])
    header = ["Name", "Emp ID", "Role", "Day", "Date", "Weekday", "Tasks done",
              "Trainee — work done", "Trainee — problems", "Task remarks / reasons",
              "Calls", "Call outcomes", "Day remark", "Day tags"]
    ws.append(header)
    blue = PatternFill("solid", fgColor="12284B")
    boldw = Font(bold=True, color="FFFFFF")
    for c in ws[4]:
        c.font = boldw
        c.fill = blue
        c.alignment = Alignment(vertical="center", wrap_text=True)
    for enr in enrollments:
        for r in _export_rows_for(enr):
            ws.append([r["name"], r["emp_id"], r["role"], r["day"], r["date"], r["weekday"],
                       r["tasks"], r["trainee_work"], r["trainee_problems"], r["task_remarks"],
                       r["calls_count"], r["call_outcomes"], r["day_remark"], r["day_tags"]])
    widths = [20, 12, 14, 6, 12, 9, 10, 26, 26, 34, 7, 26, 30, 22]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + i) if i <= 26 else "A"].width = w
    for row in ws.iter_rows(min_row=5):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)
    import io as _io
    bio = _io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    return bio.getvalue()


@ojt_bp.route("/api/ojt/export-trainee.xlsx")
@_staff_required
def api_ojt_export_trainee():
    """Download one trainee's full OJT (tasks, remarks, calls, tags) as Excel."""
    e, err = _get_enr_for_edit(request.args.get("id"))
    if err:
        return err
    data = _build_ojt_workbook([e], f"OJT Report — {_emp_name(e['emp_id'])} ({e['role']})")
    fname = f"OJT_{_emp_name(e['emp_id']).replace(' ', '_')}_{datetime.utcnow().strftime('%Y%m%d')}.xlsx"
    return Response(data, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@ojt_bp.route("/api/ojt/export-all.xlsx")
@_staff_required
def api_ojt_export_all():
    """Download all trainees' OJT data as one Excel. Optional ?role= and ?show=."""
    db = _get_db()
    role = request.args.get("role")
    show = request.args.get("show", "all")   # all | active | closed
    q = "SELECT * FROM ojt_enrollments"
    conds, params = [], []
    if role:
        conds.append("role=?")
        params.append(role)
    if show == "active":
        conds.append("status='active'")
    elif show == "closed":
        conds.append("status IN ('completed','failed')")
    if conds:
        q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY role, start_date"
    enrs = db.execute(q, tuple(params)).fetchall()
    title = "OJT Report — All trainees" + (f" ({role})" if role else "")
    data = _build_ojt_workbook(enrs, title)
    fname = f"OJT_All_Trainees_{datetime.utcnow().strftime('%Y%m%d')}.xlsx"
    return Response(data, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------------------------------------------------------
#  Hook-up (called from app.py)
# ---------------------------------------------------------------
def init_ojt(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(ojt_bp)
