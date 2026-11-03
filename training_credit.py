# ===============================================================
#  Training credit / trainer productivity module (training_credit.py)
#  - A trainer marks which learner they delivered an induction/training
#    module to -> status 'pending' -> admin approves -> 'approved'.
#  - Admin can also create or fix a delivery directly (status 'approved').
#  - Productivity view: per trainer, how many delivered, their learners'
#    average assessment scores, and pass-attempt efficiency.
# ===============================================================
import json
from datetime import datetime, timedelta
from functools import wraps
from flask import Blueprint, request, jsonify

tc_bp = Blueprint("training_credit", __name__)
_get_db = None
_current_user = None
_ready = False

# A learner-named (auto-credit) delivery is 'provisional' for this many hours.
# If nobody disputes it in that window, it auto-promotes to 'approved' and then
# counts toward KPI. (D: learner's word counts, but only after a cooling window.)
WINDOW_HOURS = 48


def _now():
    return datetime.utcnow().isoformat()


def _login_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        if _current_user() is None:
            return jsonify(ok=False, msg="Please sign in again."), 401
        return view(*a, **k)
    return wrapped


def _staff(view):
    @wraps(view)
    def wrapped(*a, **k):
        u = _current_user()
        if u is None or u["role"] not in ("admin", "instructor"):
            return jsonify(ok=False, msg="Not authorised."), 403
        return view(*a, **k)
    return wrapped


def _admin(view):
    @wraps(view)
    def wrapped(*a, **k):
        u = _current_user()
        if u is None or u["role"] != "admin":
            return jsonify(ok=False, msg="Only an admin can do this."), 403
        return view(*a, **k)
    return wrapped


def _ensure():
    global _ready
    if _ready:
        return
    db = _get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS training_delivery (
            id           SERIAL PRIMARY KEY,
            trainer_id   TEXT NOT NULL,      -- emp_id of the trainer who delivered
            learner_id   TEXT NOT NULL,      -- emp_id of the learner trained
            module_id    INTEGER,           -- content_modules.id (NULL = whole kind)
            kind         TEXT,              -- 'induction' | 'training'
            status       TEXT NOT NULL DEFAULT 'pending',  -- pending|provisional|approved|disputed
            created_by   TEXT,
            created_at   TEXT,
            approved_by  TEXT,
            approved_at  TEXT,
            UNIQUE (trainer_id, learner_id, module_id)
        )
    """)
    # A trainer (or admin) can dispute a credit assigned to them ("I didn't train
    # this learner"). The dispute goes to the admin, who approves (credit removed)
    # or rejects (credit stands). One open dispute per delivery.
    db.execute("""
        CREATE TABLE IF NOT EXISTS training_disputes (
            id            SERIAL PRIMARY KEY,
            delivery_id   INTEGER,
            trainer_id    TEXT,
            learner_id    TEXT,
            module_id     INTEGER,
            reason        TEXT,
            status        TEXT NOT NULL DEFAULT 'open',   -- open | approved | rejected
            raised_by     TEXT,
            raised_at     TEXT,
            resolved_by   TEXT,
            resolved_at   TEXT
        )
    """)
    db.commit()
    _ready = True


def _promote_due_provisionals(db):
    """Auto-confirm learner-named deliveries once their 48h window has passed with
    no open dispute: status 'provisional' -> 'approved' (approved_by='auto').
    Called lazily by the read endpoints so it works without a scheduler. Returns
    how many were promoted."""
    try:
        cutoff = (datetime.utcnow() - timedelta(hours=WINDOW_HOURS)).isoformat()
        rows = db.execute(
            "SELECT id FROM training_delivery WHERE status='provisional' AND COALESCE(created_at,'') <> '' AND created_at <= ?",
            (cutoff,)).fetchall()
        n = 0
        for r in rows:
            # skip if an open dispute exists for this delivery
            dsp = db.execute("SELECT 1 FROM training_disputes WHERE delivery_id=? AND status='open'", (r["id"],)).fetchone()
            if dsp:
                continue
            db.execute("UPDATE training_delivery SET status='approved', approved_by='auto', approved_at=? WHERE id=?",
                       (_now(), r["id"]))
            n += 1
        if n:
            db.commit()
        return n
    except Exception:
        return 0


def _modules(db, kind):
    try:
        return [dict(r) for r in db.execute(
            "SELECT id, title, kind, COALESCE(roles,'all') roles FROM content_modules WHERE kind=? AND status='live' ORDER BY sort_order, id", (kind,)).fetchall()]
    except Exception:
        return []


# ---------------------------------------------------------------
#  Trainer marks a delivery -> pending (admin approves)
#  Admin marks/fixes -> approved directly
# ---------------------------------------------------------------
@tc_bp.route("/api/training/options")
@_staff
def api_training_options():
    """Lists for the marking form: trainers, learners, and modules."""
    _ensure()
    db = _get_db()
    trainers = [dict(r) for r in db.execute(
        "SELECT emp_id, name FROM users WHERE role IN ('instructor','admin') AND status='approved' ORDER BY name").fetchall()]
    learners = [dict(r) for r in db.execute(
        "SELECT emp_id, name, designation FROM users WHERE status='approved' AND role!='admin' ORDER BY name").fetchall()]
    ind = _modules(db, "induction")
    trn = _modules(db, "training")
    u = _current_user()
    return jsonify(ok=True, trainers=trainers, learners=learners, induction=ind, training=trn,
                   is_admin=(u["role"] == "admin"), me={"emp_id": u["emp_id"], "name": u["name"]})


@tc_bp.route("/api/training/mark", methods=["POST"])
@_staff
def api_training_mark():
    """Record a delivery. Instructor -> pending; admin -> approved.
    Accepts multiple module_ids at once for one trainer+learner."""
    _ensure()
    u = _current_user()
    d = request.get_json(force=True)
    trainer_id = (d.get("trainer_id") or "").strip()
    learner_id = (d.get("learner_id") or "").strip()
    kind = (d.get("kind") or "").strip().lower()
    module_ids = d.get("module_ids") or []
    if u["role"] == "instructor":
        trainer_id = trainer_id or u["emp_id"]   # instructor marks themselves by default
    if not trainer_id or not learner_id:
        return jsonify(ok=False, msg="Pick a trainer and a learner."), 400
    if not module_ids:
        return jsonify(ok=False, msg="Pick at least one module."), 400
    status = "approved" if u["role"] == "admin" else "pending"
    db = _get_db()
    n = 0
    for mid in module_ids:
        try:
            mid = int(mid)
        except (TypeError, ValueError):
            continue
        row = db.execute("SELECT id FROM training_delivery WHERE trainer_id=? AND learner_id=? AND module_id=?",
                         (trainer_id, learner_id, mid)).fetchone()
        if row:
            db.execute("UPDATE training_delivery SET kind=?, status=?, created_by=?, created_at=?, approved_by=?, approved_at=? WHERE id=?",
                       (kind, status, u["emp_id"], _now(),
                        (u["emp_id"] if status == "approved" else None),
                        (_now() if status == "approved" else None), row["id"]))
        else:
            db.execute("INSERT INTO training_delivery (trainer_id, learner_id, module_id, kind, status, created_by, created_at, approved_by, approved_at) "
                       "VALUES (?,?,?,?,?,?,?,?,?)",
                       (trainer_id, learner_id, mid, kind, status, u["emp_id"], _now(),
                        (u["emp_id"] if status == "approved" else None),
                        (_now() if status == "approved" else None)))
        n += 1
    db.commit()
    msg = ("Recorded." if status == "approved" else "Sent for admin approval.") + f" ({n} module(s))"
    return jsonify(ok=True, msg=msg)


@tc_bp.route("/api/training/pending")
@_staff
def api_training_pending():
    """Admin: deliveries waiting for approval. Instructor: their own submissions."""
    _ensure()
    u = _current_user()
    db = _get_db()
    base = ("SELECT d.id, d.trainer_id, d.learner_id, d.module_id, d.kind, d.status, d.created_at, "
            "tr.name AS trainer_name, lr.name AS learner_name, m.title AS module_title "
            "FROM training_delivery d "
            "LEFT JOIN users tr ON tr.emp_id=d.trainer_id "
            "LEFT JOIN users lr ON lr.emp_id=d.learner_id "
            "LEFT JOIN content_modules m ON m.id=d.module_id ")
    if u["role"] == "admin":
        rows = db.execute(base + "WHERE d.status='pending' ORDER BY d.created_at DESC LIMIT 300").fetchall()
    else:
        rows = db.execute(base + "WHERE d.created_by=? ORDER BY d.created_at DESC LIMIT 100", (u["emp_id"],)).fetchall()

    # ----- D2 nudge: items a learner says THIS trainer trained them on, but
    #        this trainer has no approved delivery for yet. Only for instructors
    #        viewing themselves (and admins see all learner-claims with no match).
    awaiting = []
    try:
        me = u["emp_id"]
        names = {r["emp_id"]: r["name"] for r in db.execute("SELECT emp_id, name FROM users").fetchall()}
        mtitle = {r["id"]: r["title"] for r in db.execute("SELECT id, title FROM content_modules").fetchall()}
        # learner picks pointing at this trainer (or any, for admin)
        if u["role"] == "admin":
            picks = db.execute(
                "SELECT emp_id, module_id, trainer_id FROM training_ratings "
                "WHERE target_type='module' AND module_id IS NOT NULL AND trainer_id IS NOT NULL AND trainer_id<>''"
            ).fetchall()
        else:
            picks = db.execute(
                "SELECT emp_id, module_id, trainer_id FROM training_ratings "
                "WHERE target_type='module' AND module_id IS NOT NULL AND trainer_id=?", (me,)
            ).fetchall()
        for r in picks:
            # already have an approved delivery for this exact trainer+learner+module?
            has = db.execute(
                "SELECT 1 FROM training_delivery WHERE trainer_id=? AND learner_id=? AND module_id=? AND status='approved'",
                (r["trainer_id"], r["emp_id"], r["module_id"])
            ).fetchone()
            if has:
                continue
            awaiting.append({
                "learner_id": r["emp_id"], "learner_name": names.get(r["emp_id"], r["emp_id"]),
                "module_id": r["module_id"], "module_title": mtitle.get(r["module_id"], "Module " + str(r["module_id"])),
                "trainer_id": r["trainer_id"], "trainer_name": names.get(r["trainer_id"], r["trainer_id"]),
            })
    except Exception:
        awaiting = []

    return jsonify(ok=True, items=[dict(r) for r in rows],
                   awaiting_confirmation=awaiting,
                   is_admin=(u["role"] == "admin"))


@tc_bp.route("/api/training/resolve", methods=["POST"])
@_admin
def api_training_resolve():
    """Admin approves or rejects a pending delivery."""
    _ensure()
    d = request.get_json(force=True)
    db = _get_db()
    u = _current_user()
    row = db.execute("SELECT id FROM training_delivery WHERE id=? AND status='pending'", (d.get("id"),)).fetchone()
    if not row:
        return jsonify(ok=False, msg="Not found or already handled."), 404
    if d.get("decision") == "approve":
        db.execute("UPDATE training_delivery SET status='approved', approved_by=?, approved_at=? WHERE id=?",
                   (u["emp_id"], _now(), d.get("id")))
        msg = "Approved."
    else:
        db.execute("DELETE FROM training_delivery WHERE id=?", (d.get("id"),))
        msg = "Rejected."
    db.commit()
    return jsonify(ok=True, msg=msg)


@tc_bp.route("/api/training/resolve-bulk", methods=["POST"])
@_admin
def api_training_resolve_bulk():
    """Admin APPROVES many pending deliveries in ONE request (fast, atomic).
    Approve-only by design — no bulk delete. Accepts either an explicit list of
    `ids`, or a filter {trainer_id?, kind?} which is re-derived server-side so
    only genuinely-pending rows are touched. Returns how many were approved."""
    _ensure()
    u = _current_user()
    d = request.get_json(force=True)
    db = _get_db()
    ids = d.get("ids")
    if ids:
        # keep only the ones still pending
        clean = [int(x) for x in ids if str(x).lstrip("-").isdigit()]
        if not clean:
            return jsonify(ok=True, approved=0, msg="Nothing to approve.")
        ph = ",".join(["?"] * len(clean))
        rows = db.execute("SELECT id FROM training_delivery WHERE status='pending' AND id IN (" + ph + ")", clean).fetchall()
        target = [r["id"] for r in rows]
    else:
        # filter mode: trainer and/or kind
        q = "SELECT id FROM training_delivery WHERE status='pending'"
        params = []
        tid = (d.get("trainer_id") or "").strip()
        kind = (d.get("kind") or "").strip().lower()
        if tid:
            q += " AND trainer_id=?"; params.append(tid)
        if kind in ("induction", "training"):
            q += " AND kind=?"; params.append(kind)
        target = [r["id"] for r in db.execute(q, tuple(params)).fetchall()]

    if not target:
        return jsonify(ok=True, approved=0, msg="Nothing to approve.")
    ph2 = ",".join(["?"] * len(target))
    db.execute("UPDATE training_delivery SET status='approved', approved_by=?, approved_at=? "
               "WHERE id IN (" + ph2 + ")", tuple([u["emp_id"], _now()] + target))
    db.commit()
    return jsonify(ok=True, approved=len(target), msg="Approved " + str(len(target)) + " delivery(ies).")


@tc_bp.route("/api/training/delete", methods=["POST"])
@_admin
def api_training_delete():
    """Admin removes/fixes a delivery record."""
    _ensure()
    d = request.get_json(force=True)
    db = _get_db()
    db.execute("DELETE FROM training_delivery WHERE id=?", (d.get("id"),))
    db.commit()
    return jsonify(ok=True, msg="Removed.")


# ---------------------------------------------------------------
#  Productivity view — per trainer
# ---------------------------------------------------------------
@tc_bp.route("/api/training/productivity")
@_staff
def api_training_productivity():
    """For each trainer: how many learners trained (induction/training),
    their learners' average assessment score, and pass-attempt efficiency
    (first-try / 2nd / 3rd+ pass counts, and first-attempt pass rate)."""
    _ensure()
    db = _get_db()
    _promote_due_provisionals(db)   # settle any 48h-matured learner credits first

    # approved deliveries -> trainer -> set(learner), counts by kind.
    # Exclude resigned learners so they don't affect a trainer's productivity.
    deliveries = []
    try:
        deliveries = db.execute(
            "SELECT d.trainer_id, d.learner_id, d.kind FROM training_delivery d "
            "LEFT JOIN users lr ON lr.emp_id=d.learner_id "
            "WHERE d.status='approved' AND COALESCE(lr.status,'') <> 'resigned'").fetchall()
    except Exception:
        deliveries = []

    trainers = {}
    for r in deliveries:
        t = trainers.setdefault(r["trainer_id"], {"learners": set(), "ind": set(), "trn": set()})
        t["learners"].add(r["learner_id"])
        if r["kind"] == "induction":
            t["ind"].add(r["learner_id"])
        elif r["kind"] == "training":
            t["trn"].add(r["learner_id"])

    # names + designations
    names, desgs = {}, {}
    for r in db.execute("SELECT emp_id, name, designation FROM users").fetchall():
        names[r["emp_id"]] = r["name"]
        desgs[r["emp_id"]] = (r["designation"] or "")

    # assessment attempts per learner: list of (passed) in time order, grouped by assessment
    # we compute per learner: avg percent of best attempts, and the pass-attempt (min attempt# that passed) across assessments
    learner_scores = {}   # emp_id -> list of best percent per assessment
    learner_passattempt = {}  # emp_id -> list of pass-attempt numbers (one per passed assessment)
    try:
        # attempts in order
        attempts = {}  # (emp, aid) -> list of (passed, percent)
        for r in db.execute("SELECT emp_id, assessment_id, passed, percent FROM assessment_results ORDER BY taken_at, id").fetchall():
            attempts.setdefault((r["emp_id"], r["assessment_id"]), []).append((r["passed"], r["percent"]))
        for (emp, aid), lst in attempts.items():
            best = max(p for _, p in lst) if lst else 0
            learner_scores.setdefault(emp, []).append(best)
            pa = None
            for i, (pv, _) in enumerate(lst, 1):
                if pv:
                    pa = i
                    break
            if pa:
                learner_passattempt.setdefault(emp, []).append(pa)
    except Exception:
        pass

    out = []
    for tid, info in trainers.items():
        learners = info["learners"]
        # avg score of this trainer's learners
        all_scores = []
        first_try = second = third_plus = 0
        total_pass_events = 0
        for emp in learners:
            all_scores.extend(learner_scores.get(emp, []))
            for pa in learner_passattempt.get(emp, []):
                total_pass_events += 1
                if pa == 1:
                    first_try += 1
                elif pa == 2:
                    second += 1
                else:
                    third_plus += 1
        avg_score = round(sum(all_scores) / len(all_scores)) if all_scores else None
        first_rate = round(first_try * 100 / total_pass_events) if total_pass_events else None
        out.append({
            "trainer_id": tid, "trainer": names.get(tid, tid),
            "is_trainer": _is_trainer_desg(desgs.get(tid, "")),
            "learners": len(learners), "ind": len(info["ind"]), "trn": len(info["trn"]),
            "avg_score": avg_score,
            "first_try": first_try, "second": second, "third_plus": third_plus,
            "pass_events": total_pass_events, "first_rate": first_rate,
        })
    # sort by learners trained desc, then first-rate desc
    out.sort(key=lambda x: (-(x["learners"] or 0), -(x["first_rate"] or 0)))
    # rank
    for i, r in enumerate(out, 1):
        r["rank"] = i
    # overall summary
    all_learners = set()
    for info in trainers.values():
        all_learners |= info["learners"]
    tot_scores = [s for e in all_learners for s in learner_scores.get(e, [])]
    tot_ft = sum(1 for e in all_learners for pa in learner_passattempt.get(e, []) if pa == 1)
    tot_pe = sum(len(learner_passattempt.get(e, [])) for e in all_learners)
    summary = {
        "trainers": len(out),
        "trained": len(all_learners),
        "avg_score": round(sum(tot_scores) / len(tot_scores)) if tot_scores else None,
        "first_rate": round(tot_ft * 100 / tot_pe) if tot_pe else None,
    }
    u = _current_user()
    return jsonify(ok=True, trainers=out, summary=summary,
                   me_id=u["emp_id"], is_admin=(u["role"] == "admin"))


def _is_trainer_desg(desg):
    """Competing trainer = L&D Executive (covers Sr. too). Manager/admin excluded."""
    d = (desg or "").strip().lower()
    return "learning & development executive" in d or "learning and development executive" in d


@tc_bp.route("/api/training/activity-by-trainer")
@_staff
def api_training_activity_by_trainer():
    """Per-trainer activity within a period (today/week/month/all), attributed
    to the trainer who delivered each learner's module. Shows WHO did what and
    when. Separates the competing trainers (L&D Executives) from the L&D
    Manager, and flags trainers inactive in the period."""
    _ensure()
    from datetime import timedelta
    db = _get_db()
    rng = (request.args.get("range") or "today").strip()
    today = (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()
    if rng == "week":
        since = (today - timedelta(days=7)).isoformat()
    elif rng == "month":
        since = (today - timedelta(days=30)).isoformat()
    elif rng == "all":
        since = "0000-00-00"
    else:
        rng = "today"
        since = today.isoformat()

    names, desgs = {}, {}
    for r in db.execute("SELECT emp_id, name, designation FROM users").fetchall():
        names[r["emp_id"]] = r["name"]
        desgs[r["emp_id"]] = (r["designation"] or "")

    # attribution: (learner, module) -> set(trainer) from approved deliveries
    attr = {}
    for r in db.execute(
        "SELECT learner_id, module_id, trainer_id FROM training_delivery WHERE status='approved'"
    ).fetchall():
        attr.setdefault((r["learner_id"], r["module_id"]), set()).add(r["trainer_id"])

    # init a per-trainer bucket for everyone who has ever delivered
    T = {}
    def _bucket(tid):
        return T.setdefault(tid, {
            "trainer_id": tid, "trainer": names.get(tid, tid),
            "designation": desgs.get(tid, ""),
            "deliveries": 0, "completions": 0,
            "assess_taken": 0, "assess_passed": 0, "ojt_calls": 0,
            "learners": set(),
        })
    for (lid, mid), trs in attr.items():
        for t in trs:
            _bucket(t)

    # 1) deliveries logged in the period (by created_at)
    for r in db.execute(
        "SELECT trainer_id, learner_id FROM training_delivery "
        "WHERE status='approved' AND COALESCE(created_at,'') >= ?", (since,)
    ).fetchall():
        b = _bucket(r["trainer_id"]); b["deliveries"] += 1; b["learners"].add(r["learner_id"])

    # 2) module completions in the period -> attributed to the delivering trainer
    for r in db.execute(
        "SELECT emp_id, module_id FROM module_completions WHERE COALESCE(completed_at,'') >= ?", (since,)
    ).fetchall():
        for t in attr.get((r["emp_id"], r["module_id"]), set()):
            b = _bucket(t); b["completions"] += 1; b["learners"].add(r["emp_id"])

    # 3) assessments in the period -> attributed via ANY module that trainer
    #    delivered to that learner (a learner's trainer gets credit for their
    #    assessment activity)
    learner_trainers = {}   # learner -> set(trainer)
    for (lid, mid), trs in attr.items():
        learner_trainers.setdefault(lid, set()).update(trs)
    for r in db.execute(
        "SELECT emp_id, passed FROM assessment_results WHERE COALESCE(taken_at,'') >= ?", (since,)
    ).fetchall():
        for t in learner_trainers.get(r["emp_id"], set()):
            b = _bucket(t); b["assess_taken"] += 1
            if r["passed"]:
                b["assess_passed"] += 1

    # 4) OJT calls the trainer made in the period
    if _table_exists_tc(db, "ojt_calls"):
        try:
            for r in db.execute(
                "SELECT called_by, COUNT(*) c FROM ojt_calls WHERE COALESCE(called_at,'') >= ? GROUP BY called_by", (since,)
            ).fetchall():
                _bucket(r["called_by"])["ojt_calls"] = r["c"]
        except Exception:
            pass

    # finalise + split
    def _fin(b):
        return {
            "trainer_id": b["trainer_id"], "trainer": b["trainer"],
            "deliveries": b["deliveries"], "completions": b["completions"],
            "assess_taken": b["assess_taken"], "assess_passed": b["assess_passed"],
            "ojt_calls": b["ojt_calls"], "learners": len(b["learners"]),
            "active": (b["deliveries"] + b["completions"] + b["assess_taken"] + b["ojt_calls"]) > 0,
        }
    trainers, manager_rows = [], []
    for tid, b in T.items():
        row = _fin(b)
        if _is_trainer_desg(desgs.get(tid, "")):
            trainers.append(row)
        else:
            manager_rows.append(row)
    # sort by period output
    _score = lambda x: (x["deliveries"] + x["completions"] + x["assess_passed"] + x["ojt_calls"])
    trainers.sort(key=lambda x: -_score(x))
    manager_rows.sort(key=lambda x: -_score(x))

    team_summary = {
        "deliveries": sum(x["deliveries"] for x in trainers),
        "completions": sum(x["completions"] for x in trainers),
        "assess_taken": sum(x["assess_taken"] for x in trainers),
        "assess_passed": sum(x["assess_passed"] for x in trainers),
        "ojt_calls": sum(x["ojt_calls"] for x in trainers),
        "active_trainers": sum(1 for x in trainers if x["active"]),
        "total_trainers": len(trainers),
    }
    u = _current_user()
    # the manager viewing (Dharani) — their own period row, if present
    me_row = next((x for x in manager_rows if x["trainer_id"] == u["emp_id"]), None)
    return jsonify(ok=True, range=rng, trainers=trainers,
                   team_summary=team_summary, manager=manager_rows, me=me_row,
                   is_admin=(u["role"] == "admin"))


def _table_exists_tc(db, name):
    try:
        db.execute("SELECT 1 FROM " + name + " LIMIT 1")
        return True
    except Exception:
        return False


@tc_bp.route("/api/training/my-record")
@_login_only
def api_training_my_record():
    """A learner's own training record: who trained them (induction/training),
    their module completion, assessment scores and pass attempts."""
    _ensure()
    db = _get_db()
    u = _current_user()
    mine = u["emp_id"]

    # who trained me
    ind_by, trn_by = set(), set()
    try:
        for r in db.execute(
            "SELECT d.kind, tr.name AS trainer FROM training_delivery d "
            "LEFT JOIN users tr ON tr.emp_id=d.trainer_id "
            "WHERE d.learner_id=? AND d.status='approved'", (mine,)).fetchall():
            if r["kind"] == "induction" and r["trainer"]:
                ind_by.add(r["trainer"])
            elif r["kind"] == "training" and r["trainer"]:
                trn_by.add(r["trainer"])
    except Exception:
        pass

    # my module completion counts (induction / training) against my designation
    desg = (u["designation"] or "")

    def _roles_ok(roles):
        roles = (roles or "all").strip().lower()
        if roles in ("", "all"):
            return True
        allowed = [x.strip().lower() for x in roles.split(",")]
        d = desg.strip().lower()
        return any(a and a in d for a in allowed)

    def _mods(kind):
        try:
            return [dict(r) for r in db.execute(
                "SELECT id, title, roles FROM content_modules WHERE kind=? AND status='live'", (kind,)).fetchall()]
        except Exception:
            return []

    done = set()
    try:
        for r in db.execute("SELECT module_id FROM module_completions WHERE emp_id=?", (mine,)).fetchall():
            done.add(r["module_id"])
    except Exception:
        pass
    my_ind = [m for m in _mods("induction") if _roles_ok(m["roles"])]
    my_trn = [m for m in _mods("training") if _roles_ok(m["roles"])]
    ind_done = sum(1 for m in my_ind if m["id"] in done)
    trn_done = sum(1 for m in my_trn if m["id"] in done)

    # my assessments: attempts + pass-attempt + best score
    assessments = []
    try:
        ass = {dict(r)["id"]: dict(r) for r in db.execute(
            "SELECT id, title, roles FROM assessments WHERE active=1 AND status='live'").fetchall()}
        attempts = {}
        for r in db.execute("SELECT assessment_id, passed, percent FROM assessment_results WHERE emp_id=? ORDER BY taken_at, id", (mine,)).fetchall():
            attempts.setdefault(r["assessment_id"], []).append((r["passed"], r["percent"]))
        for aid, a in ass.items():
            if not _roles_ok(a.get("roles")):
                continue
            lst = attempts.get(aid, [])
            best = max((p for _, p in lst), default=None)
            pa = None
            for i, (pv, _) in enumerate(lst, 1):
                if pv:
                    pa = i
                    break
            assessments.append({"title": a["title"], "attempts": len(lst),
                                "best": best, "pass_attempt": pa})
    except Exception:
        pass

    return jsonify(ok=True,
                   me={"name": u["name"], "emp_id": mine, "designation": desg},
                   induction_by=sorted(ind_by), training_by=sorted(trn_by),
                   ind_done=ind_done, ind_total=len(my_ind),
                   trn_done=trn_done, trn_total=len(my_trn),
                   assessments=assessments)


@tc_bp.route("/api/training/confirmations")
@_staff
def api_training_confirmations():
    """Two-sided confirmation view. For every (learner, module) that has a mark
    from either side, classify it:
      confirmed        - learner's picked trainer == an approved trainer delivery
      conflict         - both marked, but different trainer  -> admin resolves
      awaiting_trainer - learner picked a trainer, no matching approved delivery
      awaiting_learner - trainer delivered, learner hasn't rated/picked yet
    Returns summary counts + the conflict list + the awaiting-trainer list.
    KPI is NOT affected — this is a trust/confirmation layer only."""
    _ensure()
    db = _get_db()
    _promote_due_provisionals(db)   # settle any 48h-matured learner credits first
    names = {}
    for r in db.execute("SELECT emp_id, name FROM users").fetchall():
        names[r["emp_id"]] = r["name"]
    mtitle = {}
    try:
        for r in db.execute("SELECT id, title, kind FROM content_modules").fetchall():
            mtitle[r["id"]] = {"title": r["title"], "kind": r["kind"]}
    except Exception:
        pass

    def _d10(s):
        return (s or "")[:10]

    def _hours_left(created_at):
        try:
            c = datetime.fromisoformat((created_at or "")[:26])
            due = c + timedelta(hours=WINDOW_HOURS)
            left = (due - datetime.utcnow()).total_seconds() / 3600.0
            return max(0, round(left, 1))
        except Exception:
            return None

    # learner's mark: trainer picked when rating a MODULE (keep the rating date)
    learner_pick = {}   # (learner_id, module_id) -> trainer_id
    learner_date = {}   # (learner_id, module_id) -> YYYY-MM-DD the learner rated
    try:
        for r in db.execute(
            "SELECT emp_id, module_id, trainer_id, created_at FROM training_ratings "
            "WHERE target_type='module' AND module_id IS NOT NULL "
            "AND trainer_id IS NOT NULL AND trainer_id<>''"
        ).fetchall():
            learner_pick[(r["emp_id"], r["module_id"])] = r["trainer_id"]
            learner_date[(r["emp_id"], r["module_id"])] = _d10(r["created_at"])
    except Exception:
        pass

    # trainer's mark: approved deliveries (a module could have >1 trainer record)
    trainer_recs = {}   # (learner_id, module_id) -> set(trainer_id)
    trainer_date = {}   # (learner_id, module_id) -> YYYY-MM-DD the trainer logged
    for r in db.execute(
        "SELECT learner_id, module_id, trainer_id, created_at FROM training_delivery "
        "WHERE status='approved' AND module_id IS NOT NULL"
    ).fetchall():
        trainer_recs.setdefault((r["learner_id"], r["module_id"]), set()).add(r["trainer_id"])
        k2 = (r["learner_id"], r["module_id"])
        if k2 not in trainer_date or _d10(r["created_at"]) > trainer_date[k2]:
            trainer_date[k2] = _d10(r["created_at"])

    # provisional deliveries (learner-named, inside the 48h window, not yet KPI)
    provisional_list = []
    prov_keys = set()
    for r in db.execute(
        "SELECT id, learner_id, module_id, trainer_id, created_at FROM training_delivery "
        "WHERE status='provisional' AND module_id IS NOT NULL"
    ).fetchall():
        prov_keys.add((r["learner_id"], r["module_id"]))
        mi = mtitle.get(r["module_id"], {})
        provisional_list.append({
            "delivery_id": r["id"],
            "learner_id": r["learner_id"], "learner": names.get(r["learner_id"], r["learner_id"]),
            "module_id": r["module_id"], "module": mi.get("title") or ("Module " + str(r["module_id"])),
            "kind": mi.get("kind") or "",
            "trainer_id": r["trainer_id"], "trainer": names.get(r["trainer_id"], r["trainer_id"]),
            "date": _d10(r["created_at"]), "hours_left": _hours_left(r["created_at"]),
        })

    # disputed deliveries -> their open dispute (admin decides)
    disputed_list = []
    for r in db.execute(
        "SELECT d.id AS delivery_id, d.learner_id, d.module_id, d.trainer_id, "
        "       x.reason, x.raised_by, x.raised_at "
        "FROM training_delivery d "
        "JOIN training_disputes x ON x.delivery_id=d.id AND x.status='open' "
        "WHERE d.status='disputed' AND d.module_id IS NOT NULL"
    ).fetchall():
        mi = mtitle.get(r["module_id"], {})
        disputed_list.append({
            "delivery_id": r["delivery_id"],
            "learner_id": r["learner_id"], "learner": names.get(r["learner_id"], r["learner_id"]),
            "module_id": r["module_id"], "module": mi.get("title") or ("Module " + str(r["module_id"])),
            "kind": mi.get("kind") or "",
            "trainer_id": r["trainer_id"], "trainer": names.get(r["trainer_id"], r["trainer_id"]),
            "reason": r["reason"] or "", "raised_by": names.get(r["raised_by"], r["raised_by"] or ""),
            "date": _d10(r["raised_at"]),
        })

    keys = set(learner_pick.keys()) | set(trainer_recs.keys())
    confirmed = conflict = awaiting_trainer = awaiting_learner = 0
    conflicts, awaiting_tr, awaiting_lr = [], [], []

    for (lid, mid) in keys:
        lp = learner_pick.get((lid, mid))
        trs = trainer_recs.get((lid, mid), set())
        mi = mtitle.get(mid, {})
        base = {
            "learner_id": lid, "learner": names.get(lid, lid),
            "module_id": mid, "module": mi.get("title") or ("Module " + str(mid)),
            "kind": mi.get("kind") or "",
        }
        if lp and lp in trs:
            confirmed += 1
        elif lp and trs and lp not in trs:
            conflict += 1
            row = dict(base)
            row["learner_says_id"] = lp
            row["learner_says"] = names.get(lp, lp)
            row["record_says_ids"] = sorted(trs)
            row["record_says"] = ", ".join(names.get(t, t) for t in sorted(trs))
            row["date"] = learner_date.get((lid, mid)) or trainer_date.get((lid, mid)) or ""
            conflicts.append(row)
        elif lp and not trs:
            # a provisional delivery already covers this pair -> it's not "awaiting",
            # it's counting down in the provisional bucket; skip it here.
            if (lid, mid) in prov_keys:
                pass
            else:
                awaiting_trainer += 1
                row = dict(base)
                row["learner_says_id"] = lp
                row["learner_says"] = names.get(lp, lp)
                row["date"] = learner_date.get((lid, mid)) or ""
                awaiting_tr.append(row)
        elif not lp and trs:
            awaiting_learner += 1
            row = dict(base)
            row["record_says_ids"] = sorted(trs)
            row["record_says"] = ", ".join(names.get(t, t) for t in sorted(trs))
            row["date"] = trainer_date.get((lid, mid)) or ""
            awaiting_lr.append(row)

    conflicts.sort(key=lambda x: (x["learner"] or "", x["module"] or ""))
    awaiting_tr.sort(key=lambda x: (x["learner_says"] or "", x["learner"] or ""))
    awaiting_lr.sort(key=lambda x: (x["learner"] or "", x["module"] or ""))
    provisional_list.sort(key=lambda x: (x["hours_left"] if x["hours_left"] is not None else 999))
    disputed_list.sort(key=lambda x: (x["date"] or ""))
    return jsonify(ok=True,
                   summary={"confirmed": confirmed, "conflict": conflict,
                            "awaiting_trainer": awaiting_trainer,
                            "awaiting_learner": awaiting_learner,
                            "provisional": len(provisional_list),
                            "disputed": len(disputed_list)},
                   conflicts=conflicts, awaiting_trainer_list=awaiting_tr,
                   awaiting_learner_list=awaiting_lr,
                   provisional_list=provisional_list,
                   disputed_list=disputed_list)


@tc_bp.route("/api/training/confirm-resolve", methods=["POST"])
@_admin
def api_training_confirm_resolve():
    """Admin resolves a conflict for one (learner, module): set the correct
    trainer. We make the chosen trainer the single approved delivery for that
    learner+module and update the learner's rating to match, so the pair
    becomes 'confirmed'. decision='dismiss' leaves everything untouched."""
    _ensure()
    d = request.get_json(force=True)
    u = _current_user()
    lid = (d.get("learner_id") or "").strip()
    try:
        mid = int(d.get("module_id"))
    except (TypeError, ValueError):
        return jsonify(ok=False, msg="Bad module."), 400
    decision = (d.get("decision") or "").strip()
    if not lid:
        return jsonify(ok=False, msg="Missing learner."), 400
    db = _get_db()

    if decision == "dismiss":
        return jsonify(ok=True, msg="Left as-is.")

    tid = (d.get("trainer_id") or "").strip()
    if not tid:
        return jsonify(ok=False, msg="Pick the correct trainer."), 400
    valid = db.execute(
        "SELECT kind FROM content_modules WHERE id=?", (mid,)).fetchone()
    kind = (valid["kind"] if valid else None)
    # is the chosen trainer a real trainer?
    ok = db.execute("SELECT 1 FROM users WHERE emp_id=? AND role IN ('instructor','admin')", (tid,)).fetchone()
    if not ok:
        return jsonify(ok=False, msg="Choose a valid trainer."), 400

    # 1) make the chosen trainer the approved delivery; remove other trainers'
    #    approved deliveries for this exact learner+module (they were the conflict)
    db.execute("DELETE FROM training_delivery WHERE learner_id=? AND module_id=? AND trainer_id<>?",
               (lid, mid, tid))
    row = db.execute("SELECT id FROM training_delivery WHERE trainer_id=? AND learner_id=? AND module_id=?",
                     (tid, lid, mid)).fetchone()
    if row:
        db.execute("UPDATE training_delivery SET status='approved', kind=?, approved_by=?, approved_at=? WHERE id=?",
                   (kind, u["emp_id"], _now(), row["id"]))
    else:
        db.execute("INSERT INTO training_delivery (trainer_id, learner_id, module_id, kind, status, created_by, created_at, approved_by, approved_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?)",
                   (tid, lid, mid, kind, "approved", u["emp_id"], _now(), u["emp_id"], _now()))

    # 2) align the learner's rating to the chosen trainer (so it reads 'confirmed')
    try:
        rr = db.execute("SELECT id FROM training_ratings WHERE emp_id=? AND module_id=?", (lid, mid)).fetchone()
        if rr:
            db.execute("UPDATE training_ratings SET trainer_id=? WHERE id=?", (tid, rr["id"]))
    except Exception:
        pass

    db.commit()
    return jsonify(ok=True, msg="Resolved — delivery confirmed to " +
                   (db.execute("SELECT name FROM users WHERE emp_id=?", (tid,)).fetchone() or {"name": tid})["name"] + ".")


@tc_bp.route("/api/training/confirm-claim", methods=["POST"])
@_staff
def api_training_confirm_claim():
    """A trainer (or admin) confirms a learner's claim that they trained them on
    a module -> creates/updates an APPROVED delivery, making it 'confirmed'.
    An instructor may only confirm claims that name themselves."""
    _ensure()
    u = _current_user()
    d = request.get_json(force=True)
    lid = (d.get("learner_id") or "").strip()
    tid = (d.get("trainer_id") or "").strip()
    try:
        mid = int(d.get("module_id"))
    except (TypeError, ValueError):
        return jsonify(ok=False, msg="Bad module."), 400
    if not lid or not tid:
        return jsonify(ok=False, msg="Missing learner or trainer."), 400
    # instructor can only confirm claims about themselves
    if u["role"] != "admin" and tid != u["emp_id"]:
        return jsonify(ok=False, msg="You can only confirm your own trainings."), 403
    db = _get_db()
    kr = db.execute("SELECT kind FROM content_modules WHERE id=?", (mid,)).fetchone()
    kind = (kr["kind"] if kr else None)
    row = db.execute("SELECT id FROM training_delivery WHERE trainer_id=? AND learner_id=? AND module_id=?",
                     (tid, lid, mid)).fetchone()
    if row:
        db.execute("UPDATE training_delivery SET status='approved', kind=?, approved_by=?, approved_at=? WHERE id=?",
                   (kind, u["emp_id"], _now(), row["id"]))
    else:
        db.execute("INSERT INTO training_delivery (trainer_id, learner_id, module_id, kind, status, created_by, created_at, approved_by, approved_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?)",
                   (tid, lid, mid, kind, "approved", u["emp_id"], _now(), u["emp_id"], _now()))
    db.commit()
    return jsonify(ok=True, msg="Confirmed.")


@tc_bp.route("/api/training/confirm-claim-bulk", methods=["POST"])
@_admin
def api_training_confirm_claim_bulk():
    """Admin confirms MANY awaiting-trainer items at once. Re-derives the current
    awaiting-trainer set server-side (so we never confirm stale rows), optionally
    narrowed to one trainer, and approves each learner-claimed delivery.
    Returns how many were confirmed and the keys (for an undo)."""
    _ensure()
    u = _current_user()
    d = request.get_json(force=True)
    only_trainer = (d.get("trainer_id") or "").strip()   # blank = all trainers

    db = _get_db()
    # learner picks (module ratings)
    learner_pick = {}
    for r in db.execute(
        "SELECT emp_id, module_id, trainer_id FROM training_ratings "
        "WHERE target_type='module' AND module_id IS NOT NULL AND trainer_id IS NOT NULL AND trainer_id<>''"
    ).fetchall():
        learner_pick[(r["emp_id"], r["module_id"])] = r["trainer_id"]
    # approved deliveries
    has_delivery = set()
    for r in db.execute(
        "SELECT learner_id, module_id FROM training_delivery WHERE status='approved' AND module_id IS NOT NULL"
    ).fetchall():
        has_delivery.add((r["learner_id"], r["module_id"]))

    # awaiting-trainer = learner picked a trainer, no approved delivery yet
    todo = []
    for (lid, mid), tid in learner_pick.items():
        if (lid, mid) in has_delivery:
            continue
        if only_trainer and tid != only_trainer:
            continue
        todo.append((lid, mid, tid))

    done = []
    for (lid, mid, tid) in todo:
        kr = db.execute("SELECT kind FROM content_modules WHERE id=?", (mid,)).fetchone()
        kind = (kr["kind"] if kr else None)
        row = db.execute("SELECT id FROM training_delivery WHERE trainer_id=? AND learner_id=? AND module_id=?",
                         (tid, lid, mid)).fetchone()
        if row:
            db.execute("UPDATE training_delivery SET status='approved', kind=?, approved_by=?, approved_at=? WHERE id=?",
                       (kind, u["emp_id"], _now(), row["id"]))
        else:
            db.execute("INSERT INTO training_delivery (trainer_id, learner_id, module_id, kind, status, created_by, created_at, approved_by, approved_at) "
                       "VALUES (?,?,?,?,?,?,?,?,?)",
                       (tid, lid, mid, kind, "approved", u["emp_id"], _now(), u["emp_id"], _now()))
        done.append({"learner_id": lid, "module_id": mid, "trainer_id": tid})
    db.commit()
    if not done:
        return jsonify(ok=True, confirmed=0, done=[], msg="Nothing left to confirm.")
    who = ""
    if only_trainer:
        nm = db.execute("SELECT name FROM users WHERE emp_id=?", (only_trainer,)).fetchone()
        who = " for " + (nm["name"] if nm else only_trainer)
    return jsonify(ok=True, confirmed=len(done), done=done,
                   msg="Confirmed " + str(len(done)) + " delivery(ies)" + who + ".")


@tc_bp.route("/api/training/confirm-undo", methods=["POST"])
@_admin
def api_training_confirm_undo():
    """Undo one or more just-confirmed deliveries (delete the approved delivery
    row(s) so the pair goes back to awaiting-trainer). Accepts a single
    {learner_id, module_id, trainer_id} or a list in `items`."""
    _ensure()
    d = request.get_json(force=True)
    items = d.get("items")
    if not items:
        items = [{"learner_id": d.get("learner_id"), "module_id": d.get("module_id"),
                  "trainer_id": d.get("trainer_id")}]
    db = _get_db()
    n = 0
    for it in items:
        lid = (it.get("learner_id") or "").strip()
        tid = (it.get("trainer_id") or "").strip()
        try:
            mid = int(it.get("module_id"))
        except (TypeError, ValueError):
            continue
        if not lid or not tid:
            continue
        cur = db.execute("DELETE FROM training_delivery WHERE learner_id=? AND module_id=? AND trainer_id=? AND status IN ('approved','provisional')",
                         (lid, mid, tid))
        try:
            n += cur.rowcount if cur and cur.rowcount and cur.rowcount > 0 else 0
        except Exception:
            n += 1
    db.commit()
    return jsonify(ok=True, undone=n, msg=("Undone." if n else "Nothing to undo."))


@tc_bp.route("/api/training/my-credits")
@_staff
def api_training_my_credits():
    """Credits assigned to the signed-in trainer (admin: any trainer via ?trainer_id),
    so they can review and dispute a credit they didn't earn. Shows provisional
    (counting down) and approved deliveries, with any open dispute flagged."""
    _ensure()
    db = _get_db()
    _promote_due_provisionals(db)
    u = _current_user()
    tid = u["emp_id"]
    if u["role"] == "admin" and (request.args.get("trainer_id") or "").strip():
        tid = request.args.get("trainer_id").strip()
    names = {r["emp_id"]: r["name"] for r in db.execute("SELECT emp_id, name FROM users").fetchall()}
    mt = {}
    try:
        for r in db.execute("SELECT id, title, kind FROM content_modules").fetchall():
            mt[r["id"]] = {"title": r["title"], "kind": r["kind"]}
    except Exception:
        pass
    open_disp = {r["delivery_id"] for r in db.execute(
        "SELECT delivery_id FROM training_disputes WHERE status='open'").fetchall()}
    out = []
    for r in db.execute(
        "SELECT id, learner_id, module_id, status, created_at FROM training_delivery "
        "WHERE trainer_id=? AND status IN ('provisional','approved') AND module_id IS NOT NULL "
        "ORDER BY created_at DESC", (tid,)).fetchall():
        mi = mt.get(r["module_id"], {})
        def _hl(ca):
            try:
                left = (datetime.fromisoformat((ca or "")[:26]) + timedelta(hours=WINDOW_HOURS) - datetime.utcnow()).total_seconds()/3600.0
                return max(0, round(left, 1))
            except Exception:
                return None
        out.append({
            "delivery_id": r["id"],
            "learner_id": r["learner_id"], "learner": names.get(r["learner_id"], r["learner_id"]),
            "module_id": r["module_id"], "module": mi.get("title") or ("Module " + str(r["module_id"])),
            "kind": mi.get("kind") or "", "status": r["status"],
            "hours_left": (_hl(r["created_at"]) if r["status"] == "provisional" else None),
            "disputed": (r["id"] in open_disp),
            "date": (r["created_at"] or "")[:10],
        })
    return jsonify(ok=True, trainer_id=tid, trainer=names.get(tid, tid), credits=out)


@tc_bp.route("/api/training/dispute", methods=["POST"])
@_staff
def api_training_dispute():
    """A trainer (or admin) disputes a credit assigned to them: 'I didn't train
    this learner on this module.' Marks the delivery 'disputed' and opens a
    dispute for the admin to approve (remove credit) or reject (keep it).
    An instructor may only dispute credits assigned to themselves."""
    _ensure()
    u = _current_user()
    d = request.get_json(force=True)
    try:
        did = int(d.get("delivery_id"))
    except (TypeError, ValueError):
        return jsonify(ok=False, msg="Bad delivery."), 400
    reason = (d.get("reason") or "").strip()[:500]
    db = _get_db()
    dv = db.execute("SELECT id, trainer_id, learner_id, module_id, status FROM training_delivery WHERE id=?", (did,)).fetchone()
    if not dv:
        return jsonify(ok=False, msg="Credit not found."), 404
    if u["role"] != "admin" and dv["trainer_id"] != u["emp_id"]:
        return jsonify(ok=False, msg="You can only dispute your own credits."), 403
    if dv["status"] not in ("provisional", "approved"):
        return jsonify(ok=False, msg="This credit can't be disputed."), 400
    # one open dispute per delivery
    if db.execute("SELECT 1 FROM training_disputes WHERE delivery_id=? AND status='open'", (did,)).fetchone():
        return jsonify(ok=False, msg="A dispute is already open on this credit."), 400
    db.execute("INSERT INTO training_disputes (delivery_id, trainer_id, learner_id, module_id, reason, status, raised_by, raised_at) "
               "VALUES (?,?,?,?,?,?,?,?)",
               (did, dv["trainer_id"], dv["learner_id"], dv["module_id"], reason, "open", u["emp_id"], _now()))
    db.execute("UPDATE training_delivery SET status='disputed' WHERE id=?", (did,))
    db.commit()
    return jsonify(ok=True, msg="Dispute raised — sent to admin. This credit won't count until it's reviewed.")


@tc_bp.route("/api/training/dispute-resolve", methods=["POST"])
@_admin
def api_training_dispute_resolve():
    """Admin resolves a dispute. decision='approve' -> the trainer didn't train
    them: delete the delivery (credit removed). decision='reject' -> credit stands:
    delivery goes back to 'approved'."""
    _ensure()
    u = _current_user()
    d = request.get_json(force=True)
    decision = (d.get("decision") or "").strip()
    db = _get_db()
    # locate the open dispute (by dispute_id or delivery_id)
    disp = None
    if d.get("dispute_id"):
        disp = db.execute("SELECT * FROM training_disputes WHERE id=? AND status='open'", (d.get("dispute_id"),)).fetchone()
    elif d.get("delivery_id"):
        disp = db.execute("SELECT * FROM training_disputes WHERE delivery_id=? AND status='open'", (d.get("delivery_id"),)).fetchone()
    if not disp:
        return jsonify(ok=False, msg="Open dispute not found."), 404
    did = disp["delivery_id"]
    if decision == "approve":
        db.execute("DELETE FROM training_delivery WHERE id=?", (did,))
        db.execute("UPDATE training_disputes SET status='approved', resolved_by=?, resolved_at=? WHERE id=?",
                   (u["emp_id"], _now(), disp["id"]))
        db.commit()
        return jsonify(ok=True, msg="Dispute approved — credit removed.")
    elif decision == "reject":
        db.execute("UPDATE training_delivery SET status='approved', approved_by=?, approved_at=? WHERE id=?",
                   (u["emp_id"], _now(), did))
        db.execute("UPDATE training_disputes SET status='rejected', resolved_by=?, resolved_at=? WHERE id=?",
                   (u["emp_id"], _now(), disp["id"]))
        db.commit()
        return jsonify(ok=True, msg="Dispute rejected — credit stands.")
    return jsonify(ok=False, msg="Pick approve or reject."), 400


@tc_bp.route("/api/training/by-learner")
@_staff
def api_training_by_learner():
    """Per-learner: who delivered their induction and training (approved)."""
    _ensure()
    db = _get_db()
    rows = db.execute(
        "SELECT d.learner_id, lr.name AS learner_name, d.kind, tr.name AS trainer_name "
        "FROM training_delivery d "
        "LEFT JOIN users lr ON lr.emp_id=d.learner_id "
        "LEFT JOIN users tr ON tr.emp_id=d.trainer_id "
        "WHERE d.status='approved' ORDER BY lr.name").fetchall()
    by = {}
    for r in rows:
        e = by.setdefault(r["learner_id"], {"name": r["learner_name"], "induction": set(), "training": set()})
        if r["kind"] == "induction" and r["trainer_name"]:
            e["induction"].add(r["trainer_name"])
        elif r["kind"] == "training" and r["trainer_name"]:
            e["training"].add(r["trainer_name"])
    out = [{"learner_id": k, "name": v["name"],
            "induction_by": sorted(v["induction"]), "training_by": sorted(v["training"])}
           for k, v in by.items()]
    out.sort(key=lambda x: x["name"] or "")
    return jsonify(ok=True, learners=out)


def init_training_credit(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(tc_bp)
