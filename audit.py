# ===============================================================
#  Daily Route Audit module (lives in audit.py)
#  A phone-friendly version of MrGolisoda_Daily_Route_Audit.xlsx
#  - trained BDE/BDM/State Head (and others) fill it in the field
#  - live auto-math (targets, totals, P&L), auto WhatsApp summary
#  - multiple audits per person, trainer verifies each
#  - Excel export (per-audit and all-audits) in the same layout
#  - prices & flavours are admin-editable
# ===============================================================
import io
import json
from datetime import datetime, timedelta
from functools import wraps

from flask import Blueprint, request, jsonify, Response

audit_bp = Blueprint("audit", __name__)

# filled in by init_audit() from app.py
_get_db = None
_current_user = None
_ready = False

# defaults (admin can change prices & flavours later)
DEFAULT_FLAVOURS = ["Lemon", "Blueberry", "Orange", "Pineapple", "Greenapple", "Panner", "Jeera"]
DEFAULT_SETTINGS = {
    "glass_sell": 15.0, "glass_cost": 4.54,
    "pet_sell": 20.0, "pet_cost": 12.91,
    "trays_divisor": 13.6,     # Factory Trays ÷ 13.6 = max cases/day
    "routes": 6,               # weekly max ÷ routes
    "outlet_buffer": 1.5,      # daily target × 1.5
    "flavours": DEFAULT_FLAVOURS,
}

# 12 store/route checks (Yes/No/NA)
CHECK_ITEMS = [
    "Mr. Golisoda stock present in the shop",
    "Cooler / fridge working and visible",
    "Mr. Golisoda placed in FRONT of cooler",
    "Branding board / poster present",
    "Selling price correct (as per company)",
    "Stock fresh — no old / broken bottles",
    "Competitor soft-drink presence noted",
    "Route BDE took CHECK-IN photo",
    "Route BDE created ORDER in app",
    "Route BDE generated INVOICE / bill",
    "Route BDE collected PAYMENT",
    "Outlet matches PJP walking order",
]

# daily-numbers rows
NUMBER_ITEMS = [
    ("stores_visited", "Stores visited today"),
    ("orders_taken", "Orders taken"),
    ("new_outlets", "New outlets opened"),
    ("payment_collected", "Payment collected (₹)"),
    ("issues_found", "Issues found (count)"),
]


def _now():
    return datetime.utcnow().isoformat()


def _today_ist():
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()


def _staff_required(view):
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


def _ensure_tables():
    global _ready
    if _ready:
        return
    db = _get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS audit_settings (
            id         INTEGER PRIMARY KEY,
            data       TEXT,
            updated_at TEXT
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS audit_reports (
            id            SERIAL PRIMARY KEY,
            emp_id        TEXT NOT NULL,
            emp_name      TEXT,
            role          TEXT,
            route         TEXT,
            franchise     TEXT,
            went_with     TEXT,
            audit_date    TEXT,
            payload       TEXT,           -- full JSON of the form
            status        TEXT NOT NULL DEFAULT 'submitted',  -- submitted | verified
            verified_by   TEXT,
            verified_at   TEXT,
            created_at    TEXT
        )
    """)
    db.commit()
    _ready = True


def _get_settings():
    _ensure_tables()
    db = _get_db()
    row = db.execute("SELECT data FROM audit_settings WHERE id=1").fetchone()
    if row and row["data"]:
        try:
            s = json.loads(row["data"])
            # backfill any missing keys from defaults
            out = dict(DEFAULT_SETTINGS)
            out.update(s)
            if not out.get("flavours"):
                out["flavours"] = list(DEFAULT_FLAVOURS)
            return out
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)


def _num(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _compute(payload, s):
    """Server-side recompute of the totals & P&L (never trust the client math)."""
    fl = payload.get("flavours", {})   # {name: {gp,pp,gs,ps}}
    tot_gp = tot_pp = tot_gs = tot_ps = 0.0
    for name, row in fl.items():
        tot_gp += _num(row.get("gp"))
        tot_pp += _num(row.get("pp"))
        tot_gs += _num(row.get("gs"))
        tot_ps += _num(row.get("ps"))
    total_produced = tot_gp + tot_pp
    total_sold = tot_gs + tot_ps
    revenue = tot_gs * s["glass_sell"] + tot_ps * s["pet_sell"]
    prod_cost = tot_gp * s["glass_cost"] + tot_pp * s["pet_cost"]
    gross = revenue - prod_cost
    fixed = _num(payload.get("fixed_expenses"))
    variable = _num(payload.get("variable_expenses"))
    net = gross - fixed - variable
    # targets
    trays = _num(payload.get("factory_trays"))
    max_cases = int(trays // s["trays_divisor"]) if s["trays_divisor"] else 0
    weekly_max = max_cases * s["routes"]
    daily_target = int(weekly_max // s["routes"]) if s["routes"] else 0
    import math
    outlet_need = int(math.ceil(daily_target * s["outlet_buffer"]))
    return {
        "tot_gp": tot_gp, "tot_pp": tot_pp, "tot_gs": tot_gs, "tot_ps": tot_ps,
        "total_produced": total_produced, "total_sold": total_sold,
        "revenue": revenue, "prod_cost": prod_cost, "gross": gross,
        "fixed": fixed, "variable": variable, "net": net,
        "max_cases": max_cases, "weekly_max": weekly_max,
        "daily_target": daily_target, "outlet_need": outlet_need,
    }


# ---------------------------------------------------------------
#  Config for the form (settings + fixed lists)
# ---------------------------------------------------------------
@audit_bp.route("/api/audit/config")
@_login_only
def api_audit_config():
    s = _get_settings()
    u = _current_user()
    return jsonify(ok=True, settings=s, checks=CHECK_ITEMS, numbers=NUMBER_ITEMS,
                   is_staff=(u["role"] in ("admin", "instructor")),
                   is_admin=(u["role"] == "admin"),
                   me={"name": u["name"], "emp_id": u["emp_id"], "designation": u["designation"] or ""})


@audit_bp.route("/api/audit/save-settings", methods=["POST"])
@_admin_only
def api_audit_save_settings():
    d = request.get_json(force=True)
    s = _get_settings()
    for k in ("glass_sell", "glass_cost", "pet_sell", "pet_cost", "trays_divisor", "routes", "outlet_buffer"):
        if k in d:
            s[k] = _num(d.get(k), s[k])
    if "flavours" in d and isinstance(d["flavours"], list):
        fl = [str(x).strip() for x in d["flavours"] if str(x).strip()]
        if fl:
            s["flavours"] = fl
    db = _get_db()
    if db.execute("SELECT 1 FROM audit_settings WHERE id=1").fetchone():
        db.execute("UPDATE audit_settings SET data=?, updated_at=? WHERE id=1", (json.dumps(s), _now()))
    else:
        db.execute("INSERT INTO audit_settings (id, data, updated_at) VALUES (1,?,?)", (json.dumps(s), _now()))
    db.commit()
    return jsonify(ok=True, settings=s)


# ---------------------------------------------------------------
#  Submit / list / open / verify
# ---------------------------------------------------------------
@audit_bp.route("/api/audit/submit", methods=["POST"])
@_login_only
def api_audit_submit():
    _ensure_tables()
    u = _current_user()
    d = request.get_json(force=True)
    payload = d.get("payload") or {}
    route = (payload.get("route") or "").strip()[:120]
    franchise = (payload.get("franchise") or "").strip()[:120]
    went_with = (payload.get("went_with") or "").strip()[:120]
    audit_date = (payload.get("audit_date") or _today_ist().isoformat())[:20]
    role = (u["designation"] or "").strip() or (payload.get("role") or "")
    db = _get_db()
    rid = d.get("id")   # editing an existing draft/submission
    if rid:
        # only the owner can edit their own, and only while still 'submitted'
        row = db.execute("SELECT emp_id, status FROM audit_reports WHERE id=?", (rid,)).fetchone()
        if not row or row["emp_id"] != u["emp_id"]:
            return jsonify(ok=False, msg="Not found."), 404
        if row["status"] == "verified":
            return jsonify(ok=False, msg="This audit is already verified and can't be edited."), 400
        db.execute("UPDATE audit_reports SET route=?, franchise=?, went_with=?, audit_date=?, payload=? WHERE id=?",
                   (route, franchise, went_with, audit_date, json.dumps(payload), rid))
        db.commit()
        return jsonify(ok=True, id=rid, msg="Audit updated.")
    cur = db.execute(
        "INSERT INTO audit_reports (emp_id, emp_name, role, route, franchise, went_with, audit_date, payload, status, created_at) "
        "VALUES (?,?,?,?,?,?,?,?, 'submitted', ?) RETURNING id",
        (u["emp_id"], u["name"], role, route, franchise, went_with, audit_date, json.dumps(payload), _now()))
    nid = cur.fetchone()["id"]
    db.commit()
    return jsonify(ok=True, id=nid, msg="Audit submitted.")


@audit_bp.route("/api/audit/my")
@_login_only
def api_audit_my():
    """The logged-in person's own submitted audits (list)."""
    _ensure_tables()
    u = _current_user()
    db = _get_db()
    rows = db.execute(
        "SELECT id, route, franchise, audit_date, status, created_at FROM audit_reports "
        "WHERE emp_id=? ORDER BY id DESC", (u["emp_id"],)).fetchall()
    return jsonify(ok=True, audits=[dict(r) for r in rows])


@audit_bp.route("/api/audit/list")
@_staff_required
def api_audit_list():
    """Admin/trainer: all submitted audits, newest first. Optional ?status= & ?emp_id=."""
    _ensure_tables()
    db = _get_db()
    q = ("SELECT id, emp_id, emp_name, role, route, franchise, audit_date, status, "
         "verified_by, verified_at, created_at FROM audit_reports")
    conds, params = [], []
    st = request.args.get("status")
    if st in ("submitted", "verified"):
        conds.append("status=?"); params.append(st)
    emp = request.args.get("emp_id")
    if emp:
        conds.append("emp_id=?"); params.append(emp)
    if conds:
        q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY id DESC LIMIT 500"
    rows = db.execute(q, tuple(params)).fetchall()
    pending = db.execute("SELECT COUNT(*) c FROM audit_reports WHERE status='submitted'").fetchone()["c"]
    return jsonify(ok=True, audits=[dict(r) for r in rows], pending=pending)


@audit_bp.route("/api/audit/get")
@_login_only
def api_audit_get():
    _ensure_tables()
    u = _current_user()
    db = _get_db()
    row = db.execute("SELECT * FROM audit_reports WHERE id=?", (request.args.get("id"),)).fetchone()
    if not row:
        return jsonify(ok=False, msg="Not found."), 404
    is_staff = u["role"] in ("admin", "instructor")
    if not is_staff and row["emp_id"] != u["emp_id"]:
        return jsonify(ok=False, msg="Not authorised."), 403
    payload = {}
    try:
        payload = json.loads(row["payload"] or "{}")
    except Exception:
        pass
    s = _get_settings()
    return jsonify(ok=True, audit={
        "id": row["id"], "emp_id": row["emp_id"], "emp_name": row["emp_name"], "role": row["role"],
        "route": row["route"], "franchise": row["franchise"], "went_with": row["went_with"],
        "audit_date": row["audit_date"], "status": row["status"],
        "verified_by": row["verified_by"], "verified_at": row["verified_at"],
        "payload": payload, "computed": _compute(payload, s),
    }, settings=s, checks=CHECK_ITEMS, numbers=NUMBER_ITEMS, can_verify=is_staff)


@audit_bp.route("/api/audit/verify", methods=["POST"])
@_staff_required
def api_audit_verify():
    _ensure_tables()
    d = request.get_json(force=True)
    db = _get_db()
    row = db.execute("SELECT status FROM audit_reports WHERE id=?", (d.get("id"),)).fetchone()
    if not row:
        return jsonify(ok=False, msg="Not found."), 404
    u = _current_user()
    db.execute("UPDATE audit_reports SET status='verified', verified_by=?, verified_at=? WHERE id=?",
               (u["name"], _now(), d.get("id")))
    db.commit()
    return jsonify(ok=True, msg="Audit verified.")


@audit_bp.route("/api/audit/delete", methods=["POST"])
@_login_only
def api_audit_delete():
    """Owner can delete their own un-verified audit; admin can delete any."""
    _ensure_tables()
    u = _current_user()
    d = request.get_json(force=True)
    db = _get_db()
    row = db.execute("SELECT emp_id, status FROM audit_reports WHERE id=?", (d.get("id"),)).fetchone()
    if not row:
        return jsonify(ok=False, msg="Not found."), 404
    if u["role"] != "admin":
        if row["emp_id"] != u["emp_id"] or row["status"] == "verified":
            return jsonify(ok=False, msg="You can't delete this."), 403
    db.execute("DELETE FROM audit_reports WHERE id=?", (d.get("id"),))
    db.commit()
    return jsonify(ok=True, msg="Audit deleted.")


# ---------------------------------------------------------------
#  WhatsApp summary (server builds the exact text)
# ---------------------------------------------------------------
def _whatsapp(row_or_payload, s, meta):
    p = row_or_payload
    c = _compute(p, s)
    fl = p.get("flavours", {})
    lines = []
    lines.append("*MR. GOLISODA — DAILY SUMMARY*")
    lines.append("==============")
    lines.append(f"BDE: {meta.get('emp_name','')}   ID: {meta.get('emp_id','')}")
    lines.append(f"Route: {p.get('route','')}  ({p.get('went_with','')})")
    lines.append(f"Date: {p.get('audit_date','')}")
    lines.append("==============")
    lines.append("*PRODUCTION (made / sold):*")
    for name in s.get("flavours", DEFAULT_FLAVOURS):
        r = fl.get(name, {})
        made = _num(r.get("gp")) + _num(r.get("pp"))
        sold = _num(r.get("gs")) + _num(r.get("ps"))
        lines.append(f"• {name}: {int(made)} made / {int(sold)} sold")
    lines.append(f"Total Produced: {int(c['total_produced'])} bottles")
    lines.append(f"Total Sold: {int(c['total_sold'])} bottles")
    lines.append(f"(Glass sold {int(c['tot_gs'])} / PET sold {int(c['tot_ps'])})")
    lines.append(f"Empties collected: {int(_num(p.get('empties')))}")
    lines.append("==============")
    lines.append("*ROUTE NUMBERS:*")
    nums = p.get("numbers", {})
    lines.append(f"• Stores visited: {int(_num(nums.get('stores_visited')))}")
    lines.append(f"• Orders: {int(_num(nums.get('orders_taken')))}   New outlets: {int(_num(nums.get('new_outlets')))}")
    lines.append(f"• Payment: ₹{int(_num(nums.get('payment_collected')))}   Issues: {int(_num(nums.get('issues_found')))}")
    lines.append("==============")
    lines.append("*P&L (today):*")
    lines.append(f"• Revenue: ₹{int(c['revenue'])}")
    lines.append(f"• Prod. Cost: ₹{int(c['prod_cost'])}")
    lines.append(f"• Gross Profit: ₹{int(c['gross'])}")
    lines.append(f"• Net Profit: ₹{int(c['net'])}")
    lines.append("==============")
    lines.append(f"Submitted by: {meta.get('emp_name','')}")
    return "\n".join(lines)


@audit_bp.route("/api/audit/whatsapp")
@_login_only
def api_audit_whatsapp():
    _ensure_tables()
    u = _current_user()
    db = _get_db()
    row = db.execute("SELECT * FROM audit_reports WHERE id=?", (request.args.get("id"),)).fetchone()
    if not row:
        return jsonify(ok=False, msg="Not found."), 404
    if u["role"] not in ("admin", "instructor") and row["emp_id"] != u["emp_id"]:
        return jsonify(ok=False, msg="Not authorised."), 403
    p = {}
    try:
        p = json.loads(row["payload"] or "{}")
    except Exception:
        pass
    txt = _whatsapp(p, _get_settings(), {"emp_name": row["emp_name"], "emp_id": row["emp_id"]})
    return jsonify(ok=True, text=txt)


# ---------------------------------------------------------------
#  Excel export — per audit and all audits (same layout as the file)
# ---------------------------------------------------------------
def _write_audit_sheet(ws, row, s):
    from openpyxl.styles import Font, PatternFill, Alignment
    try:
        p = json.loads(row["payload"] or "{}")
    except Exception:
        p = {}
    c = _compute(p, s)
    navy = PatternFill("solid", fgColor="12284B")
    boldw = Font(bold=True, color="FFFFFF")
    boldd = Font(bold=True)

    def hdr(txt):
        ws.append([txt]); ws.cell(ws.max_row, 1).font = boldd

    ws.append(["MR. GOLISODA — DAILY ROUTE AUDIT & PRODUCTION SUMMARY"])
    ws.cell(ws.max_row, 1).font = Font(bold=True, size=14)
    ws.append([])
    hdr("AUDIT DETAILS")
    ws.append(["BDE Name", row["emp_name"], "", "Employee ID", row["emp_id"]])
    ws.append(["Route Audited", row["route"], "", "Franchise / City", row["franchise"]])
    ws.append(["Went With", row["went_with"], "", "Audit Date", row["audit_date"]])
    ws.append(["Status", row["status"], "", "Verified by", row["verified_by"] or ""])
    ws.append([])

    hdr("TARGET CALCULATION CHECK")
    ws.append(["Factory Trays available", _num(p.get("factory_trays"))])
    ws.append(["Max Cases Per Day", c["max_cases"]])
    ws.append(["Weekly Maximum Sales", c["weekly_max"]])
    ws.append(["Daily Target Per Route", c["daily_target"]])
    ws.append(["Outlet Potential Needed / Route", c["outlet_need"]])
    ws.append([])

    hdr("PRODUCTION & SALES BY FLAVOUR")
    ws.append(["Flavour", "Glass Prod.", "PET Prod.", "Total Prod.", "Glass Sold", "PET Sold", "Total Sold"])
    for cc in ws[ws.max_row]:
        cc.font = boldw; cc.fill = navy
    fl = p.get("flavours", {})
    for name in s.get("flavours", DEFAULT_FLAVOURS):
        r = fl.get(name, {})
        gp, pp, gs, ps = _num(r.get("gp")), _num(r.get("pp")), _num(r.get("gs")), _num(r.get("ps"))
        ws.append([name, gp, pp, gp + pp, gs, ps, gs + ps])
    ws.append(["TOTAL", c["tot_gp"], c["tot_pp"], c["total_produced"], c["tot_gs"], c["tot_ps"], c["total_sold"]])
    for cc in ws[ws.max_row]:
        cc.font = boldd
    ws.append([])

    ws.append(["Empty bottles collected today", _num(p.get("empties"))])
    ws.cell(ws.max_row, 1).font = boldd
    ws.append([])

    hdr("STORE / ROUTE CHECKS")
    ws.append(["Check Item", "Result", "Remarks"])
    for cc in ws[ws.max_row]:
        cc.font = boldw; cc.fill = navy
    checks = p.get("checks", {})
    remarks = p.get("check_remarks", {})
    for i, item in enumerate(CHECK_ITEMS):
        ws.append([item, checks.get(str(i), checks.get(i, "")), remarks.get(str(i), remarks.get(i, ""))])
    ws.append([])

    hdr("DAILY NUMBERS")
    nums = p.get("numbers", {})
    for key, label in NUMBER_ITEMS:
        ws.append([label, _num(nums.get(key))])
    ws.append([])

    hdr("FULL P&L (₹)")
    ws.append(["Revenue (from Sold)", c["revenue"]])
    ws.append(["Production Cost (from Produced)", c["prod_cost"]])
    ws.append(["Gross Profit", c["gross"]])
    ws.append(["Fixed Expenses", c["fixed"]])
    ws.append(["Variable Expenses", c["variable"]])
    ws.append(["NET PROFIT", c["net"]])
    ws.cell(ws.max_row, 1).font = boldd
    ws.append([])

    hdr("NOTES / ISSUES")
    ws.append([p.get("notes", "")])
    for i in range(1, 9):
        ws.column_dimensions[chr(64 + i)].width = [30, 14, 14, 14, 14, 14, 14, 14][i - 1]


@audit_bp.route("/api/audit/export.xlsx")
@_staff_required
def api_audit_export_one():
    _ensure_tables()
    from openpyxl import Workbook
    db = _get_db()
    row = db.execute("SELECT * FROM audit_reports WHERE id=?", (request.args.get("id"),)).fetchone()
    if not row:
        return jsonify(ok=False, msg="Not found."), 404
    s = _get_settings()
    wb = Workbook()
    ws = wb.active
    ws.title = "Daily Route Audit"
    _write_audit_sheet(ws, row, s)
    bio = io.BytesIO(); wb.save(bio); bio.seek(0)
    fname = f"Audit_{(row['emp_name'] or row['emp_id']).replace(' ', '_')}_{row['audit_date']}.xlsx"
    return Response(bio.getvalue(),
                    mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@audit_bp.route("/api/audit/export-all.xlsx")
@_staff_required
def api_audit_export_all():
    """One summary sheet across all audits (one row each) + optional filters."""
    _ensure_tables()
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    db = _get_db()
    q = "SELECT * FROM audit_reports"
    conds, params = [], []
    st = request.args.get("status")
    if st in ("submitted", "verified"):
        conds.append("status=?"); params.append(st)
    if conds:
        q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY id DESC"
    rows = db.execute(q, tuple(params)).fetchall()
    s = _get_settings()
    wb = Workbook()
    ws = wb.active
    ws.title = "All Audits"
    ws.append(["MR. GOLISODA — Route Audits (all)"])
    ws.cell(1, 1).font = Font(bold=True, size=14)
    ws.append([f"Generated {datetime.utcnow().strftime('%d %b %Y')} · {len(rows)} audits"])
    ws.append([])
    header = ["Date", "BDE Name", "Emp ID", "Role", "Route", "Franchise", "Went with",
              "Total Produced", "Total Sold", "Revenue ₹", "Net Profit ₹",
              "Stores visited", "Orders", "New outlets", "Payment ₹", "Issues",
              "Status", "Verified by"]
    ws.append(header)
    navy = PatternFill("solid", fgColor="12284B"); boldw = Font(bold=True, color="FFFFFF")
    for cc in ws[4]:
        cc.font = boldw; cc.fill = navy; cc.alignment = Alignment(wrap_text=True, vertical="center")
    for row in rows:
        try:
            p = json.loads(row["payload"] or "{}")
        except Exception:
            p = {}
        c = _compute(p, s)
        n = p.get("numbers", {})
        ws.append([row["audit_date"], row["emp_name"], row["emp_id"], row["role"], row["route"],
                   row["franchise"], row["went_with"],
                   int(c["total_produced"]), int(c["total_sold"]), int(c["revenue"]), int(c["net"]),
                   int(_num(n.get("stores_visited"))), int(_num(n.get("orders_taken"))),
                   int(_num(n.get("new_outlets"))), int(_num(n.get("payment_collected"))),
                   int(_num(n.get("issues_found"))),
                   row["status"], row["verified_by"] or ""])
    widths = [12, 20, 12, 12, 20, 18, 14, 12, 10, 11, 11, 12, 8, 11, 11, 8, 11, 16]
    for i, w in enumerate(widths, start=1):
        col = chr(64 + i) if i <= 26 else "A" + chr(64 + i - 26)
        ws.column_dimensions[col].width = w
    bio = io.BytesIO(); wb.save(bio); bio.seek(0)
    fname = f"All_Route_Audits_{datetime.utcnow().strftime('%Y%m%d')}.xlsx"
    return Response(bio.getvalue(),
                    mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ---------------------------------------------------------------
#  Hook-up (called from app.py)
# ---------------------------------------------------------------
def init_audit(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(audit_bp)
