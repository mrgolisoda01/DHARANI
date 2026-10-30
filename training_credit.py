# ===============================================================
#  Training credit / trainer productivity module (training_credit.py)
#  - A trainer marks which learner they delivered an induction/training
#    module to -> status 'pending' -> admin approves -> 'approved'.
#  - Admin can also create or fix a delivery directly (status 'approved').
#  - Productivity view: per trainer, how many delivered, their learners'
#    average assessment scores, and pass-attempt efficiency.
# ===============================================================
import json
from datetime import datetime
from functools import wraps
from flask import Blueprint, request, jsonify

tc_bp = Blueprint("training_credit", __name__)
_get_db = None
_current_user = None
_ready = False


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
            status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved
            created_by   TEXT,
            created_at   TEXT,
            approved_by  TEXT,
            approved_at  TEXT,
            UNIQUE (trainer_id, learner_id, module_id)
        )
    """)
    db.commit()
    _ready = True


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

    # names
    names = {}
    for r in db.execute("SELECT emp_id, name FROM users").fetchall():
        names[r["emp_id"]] = r["name"]

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
    names = {}
    for r in db.execute("SELECT emp_id, name FROM users").fetchall():
        names[r["emp_id"]] = r["name"]
    mtitle = {}
    try:
        for r in db.execute("SELECT id, title, kind FROM content_modules").fetchall():
            mtitle[r["id"]] = {"title": r["title"], "kind": r["kind"]}
    except Exception:
        pass

    # learner's mark: trainer picked when rating a MODULE
    learner_pick = {}   # (learner_id, module_id) -> trainer_id
    try:
        for r in db.execute(
            "SELECT emp_id, module_id, trainer_id FROM training_ratings "
            "WHERE target_type='module' AND module_id IS NOT NULL "
            "AND trainer_id IS NOT NULL AND trainer_id<>''"
        ).fetchall():
            learner_pick[(r["emp_id"], r["module_id"])] = r["trainer_id"]
    except Exception:
        pass

    # trainer's mark: approved deliveries (a module could have >1 trainer record)
    trainer_recs = {}   # (learner_id, module_id) -> set(trainer_id)
    for r in db.execute(
        "SELECT learner_id, module_id, trainer_id FROM training_delivery "
        "WHERE status='approved' AND module_id IS NOT NULL"
    ).fetchall():
        trainer_recs.setdefault((r["learner_id"], r["module_id"]), set()).add(r["trainer_id"])

    keys = set(learner_pick.keys()) | set(trainer_recs.keys())
    confirmed = conflict = awaiting_trainer = awaiting_learner = 0
    conflicts, awaiting_tr = [], []

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
            conflicts.append(row)
        elif lp and not trs:
            awaiting_trainer += 1
            row = dict(base)
            row["learner_says_id"] = lp
            row["learner_says"] = names.get(lp, lp)
            awaiting_tr.append(row)
        elif not lp and trs:
            awaiting_learner += 1

    conflicts.sort(key=lambda x: (x["learner"] or "", x["module"] or ""))
    awaiting_tr.sort(key=lambda x: (x["learner_says"] or "", x["learner"] or ""))
    return jsonify(ok=True,
                   summary={"confirmed": confirmed, "conflict": conflict,
                            "awaiting_trainer": awaiting_trainer,
                            "awaiting_learner": awaiting_learner},
                   conflicts=conflicts, awaiting_trainer_list=awaiting_tr)


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
