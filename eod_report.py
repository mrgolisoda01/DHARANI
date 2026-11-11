# ===============================================================
#  eod_report.py  —  Daily "EOD Report" for the L&D team
# ---------------------------------------------------------------
#  Builds the end-of-day WhatsApp report for the HR managers group.
#
#  Two parts:
#   1) AUTO (from LMS data, read-only) for any IST date:
#        numbers, trainer-wise induction & assessment (module-wise
#        and every trainee's score / pass-fail), feedback, re-tests
#        needed, weak topics, feedback pending, OJT calls,
#        certificates, new joiners.
#   2) MANUAL (saved per person per date in eod_entries):
#        work done, in progress, support needed, tomorrow's plan.
#        Admin's own entry = "Work completed today"; every other
#        trainer's entry = "Team updates".
#
#  Admin sees everything. A trainer (instructor) sees only their
#  own trainer block and their own entry.
#  Wired from app.py:  init_eod_report(app, get_db, current_user)
# ===============================================================
import re
from datetime import datetime, timedelta, date as _date
from functools import wraps
from flask import Blueprint, jsonify, request

eod_bp = Blueprint("eod_report", __name__)
_get_db = None
_current_user = None
_ready = False

FIELDS = ("work_done", "in_progress", "support_needed", "tomorrow_plan")
MAX_LEN = 4000
TRAINER_BACKDATE_DAYS = 2      # trainers may fill/edit today + last 2 days
OUTCOME_LABEL = {
    "spoke_done": "Spoke – done",
    "spoke_not_done": "Spoke – not done",
    "no_answer": "No answer",
    "busy": "Busy",
}


# ---------- helpers --------------------------------------------
def _staff_only(view):
    @wraps(view)
    def wrapped(*a, **k):
        u = _current_user()
        if u is None or u["role"] not in ("admin", "instructor"):
            return jsonify(ok=False, msg="Not authorised."), 403
        return view(*a, **k)
    return wrapped


def _today_ist():
    return (datetime.utcnow() + timedelta(hours=5, minutes=30)).date()


def _parse_date(s):
    s = (s or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _utc_window(d):
    """IST calendar day d -> [start, end) as UTC ISO strings (the format
    every timestamp in this app is stored in)."""
    start = datetime(d.year, d.month, d.day) - timedelta(hours=5, minutes=30)
    end = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


def _table_exists(db, name):
    # to_regclass never raises, so it can't abort the request transaction
    r = db.execute("SELECT to_regclass(?) AS t", ("public." + name,)).fetchone()
    return bool(r and r["t"])


def _ensure():
    global _ready
    if _ready:
        return
    db = _get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS eod_entries (
            id             SERIAL PRIMARY KEY,
            report_date    TEXT NOT NULL,     -- IST date YYYY-MM-DD
            emp_id         TEXT NOT NULL,     -- who wrote it (admin / trainer)
            work_done      TEXT,
            in_progress    TEXT,
            support_needed TEXT,
            tomorrow_plan  TEXT,
            updated_at     TEXT,
            UNIQUE (report_date, emp_id)
        )
    """)
    db.commit()
    _ready = True


def _short(s, n=140):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _avg(vals):
    vals = [v for v in vals if v is not None]
    return (sum(vals) / len(vals)) if vals else None


# ===============================================================
#  AUTO PART — everything the LMS recorded on that IST date
# ===============================================================
def _build_auto(db, d, only_trainer=None):
    since, until = _utc_window(d)
    users = {r["emp_id"]: r for r in db.execute(
        "SELECT emp_id, name, designation, role, status, added_by, last_login, created_at FROM users"
    ).fetchall()}
    staff = {e for e, r in users.items() if r["role"] in ("admin", "instructor")}

    def nm(e):
        r = users.get(e)
        return (r["name"] if r else e) or e

    def desg(e):
        r = users.get(e)
        return ((r["designation"] if r else "") or "").strip()

    def in_win(col):
        return col + " >= ? AND " + col + " < ?"

    win = (since, until)

    # ---- assessments --------------------------------------------
    assess = {r["id"]: r for r in db.execute(
        "SELECT id, title, pass_percent, linked_module_id FROM assessments").fetchall()}
    results = [r for r in db.execute(
        "SELECT emp_id, assessment_id, percent, passed, taken_at FROM assessment_results "
        "WHERE " + in_win("taken_at") + " ORDER BY taken_at", win).fetchall()
        if r["emp_id"] not in staff]

    # best attempt per (trainee, assessment) for the day + attempt count
    per_ta = {}
    for r in results:
        k = (r["emp_id"], r["assessment_id"])
        cur = per_ta.get(k)
        if cur is None:
            per_ta[k] = {"best": r["percent"], "passed": bool(r["passed"]), "attempts": 1}
        else:
            cur["attempts"] += 1
            cur["best"] = max(cur["best"], r["percent"])
            cur["passed"] = cur["passed"] or bool(r["passed"])

    # ---- module completions --------------------------------------
    mods = {r["id"]: r for r in db.execute(
        "SELECT id, title, kind FROM content_modules").fetchall()}
    comps = [r for r in db.execute(
        "SELECT emp_id, module_id, completed_at FROM module_completions "
        "WHERE " + in_win("completed_at"), win).fetchall()
        if r["emp_id"] not in staff]
    comps_by_emp = {}
    for r in comps:
        comps_by_emp.setdefault(r["emp_id"], []).append(r["module_id"])

    # ---- ratings (feedback) --------------------------------------
    has_ratings = _table_exists(db, "training_ratings")
    day_ratings = []
    rated_lm = set()            # (learner, module) ever rated
    rating_trainer = {}         # (learner, module) -> trainer_id
    if has_ratings:
        for r in db.execute(
            "SELECT emp_id, module_id, trainer_id FROM training_ratings "
            "WHERE target_type='module' AND module_id IS NOT NULL"
        ).fetchall():
            rated_lm.add((r["emp_id"], r["module_id"]))
            if r["trainer_id"]:
                rating_trainer[(r["emp_id"], r["module_id"])] = r["trainer_id"]
        day_ratings = db.execute(
            "SELECT emp_id, target_type, module_id, trainer_id, content_rating, "
            "trainer_rating, course_rating, comment FROM training_ratings "
            "WHERE " + in_win("created_at") + " ORDER BY created_at", win).fetchall()

    # ---- trainer of each trainee -------------------------------
    deliv = {}
    if _table_exists(db, "training_delivery"):
        for r in db.execute(
            "SELECT learner_id, trainer_id FROM training_delivery "
            "WHERE status IN ('approved','provisional','pending') ORDER BY created_at"
        ).fetchall():
            deliv[r["learner_id"]] = r["trainer_id"]          # latest wins
    ojt_tr = {}
    if _table_exists(db, "ojt_enrollments"):
        for r in db.execute(
            "SELECT emp_id, trainer_id FROM ojt_enrollments ORDER BY created_at"
        ).fetchall():
            if r["trainer_id"]:
                ojt_tr[r["emp_id"]] = r["trainer_id"]

    def trainer_of(e):
        votes = {}
        for r in day_ratings:                                  # named today
            if r["emp_id"] == e and r["trainer_id"]:
                votes[r["trainer_id"]] = votes.get(r["trainer_id"], 0) + 2
        for mid in comps_by_emp.get(e, []):                    # modules done today
            t = rating_trainer.get((e, mid))
            if t:
                votes[t] = votes.get(t, 0) + 1
        for (le, aid) in per_ta:                               # linked module of assessment
            if le == e:
                a = assess.get(aid)
                lm = a["linked_module_id"] if a else None
                t = rating_trainer.get((e, lm)) if lm else None
                if t:
                    votes[t] = votes.get(t, 0) + 1
        if votes:
            return max(votes.items(), key=lambda kv: kv[1])[0]
        if e in deliv:
            return deliv[e]
        if e in ojt_tr:
            return ojt_tr[e]
        ab = users.get(e)["added_by"] if users.get(e) else None
        if ab and ab in staff:
            return ab
        return None

    trainees = sorted({r["emp_id"] for r in results} | set(comps_by_emp.keys()),
                      key=lambda e: nm(e).lower())
    t_of = {e: trainer_of(e) for e in trainees}

    # ---- build trainer blocks -----------------------------------
    blocks = {}

    def blk(tid):
        key = tid or "__none__"
        if key not in blocks:
            blocks[key] = {"trainer_id": tid,
                           "trainer": nm(tid) if tid else "Trainer not tagged",
                           "trainees": [], "modules": {}, "ratings": []}
        return blocks[key]

    for e in trainees:
        b = blk(t_of[e])
        rows = []
        for (le, aid), v in per_ta.items():
            if le != e:
                continue
            a = assess.get(aid)
            title = (a["title"] if a else "Assessment #" + str(aid))
            pm = (a["pass_percent"] if a else None)
            rows.append({"assessment": title, "score": v["best"], "passed": v["passed"],
                         "attempts": v["attempts"], "pass_mark": pm})
            m = b["modules"].setdefault(title, {"scores": [], "pass": 0, "fail": 0, "pass_mark": pm})
            m["scores"].append(v["best"])
            if v["passed"]:
                m["pass"] += 1
            else:
                m["fail"] += 1
        rows.sort(key=lambda x: x["assessment"].lower())
        done = comps_by_emp.get(e, [])
        b["trainees"].append({
            "emp_id": e, "name": nm(e), "designation": desg(e),
            "assessments": rows,
            "modules_done": [ (mods[m]["title"] if m in mods else "Module #" + str(m)) for m in done ],
        })

    course_ratings = []
    for r in day_ratings:
        if r["emp_id"] in staff:
            continue
        if r["target_type"] == "module" and r["trainer_id"]:
            blk(r["trainer_id"])["ratings"].append(r)
        elif r["target_type"] == "course":
            course_ratings.append(r)
        else:
            blk(None)["ratings"].append(r)

    block_list = []
    for b in blocks.values():
        rs = b["ratings"]
        mod_rows = []
        for title, m in sorted(b["modules"].items(), key=lambda kv: kv[0].lower()):
            mod_rows.append({"module": title, "avg": round(_avg(m["scores"]) or 0),
                             "pass": m["pass"], "fail": m["fail"], "pass_mark": m["pass_mark"]})
        tr_avg = _avg([r["trainer_rating"] for r in rs])
        ct_avg = _avg([r["content_rating"] for r in rs])
        comments = []
        seen = {}
        for r in rs:
            if (r["comment"] or "").strip():
                txt = _short(r["comment"])
                key = (r["emp_id"], txt.lower())
                if key in seen:                     # same learner, same words on several modules
                    seen[key]["times"] += 1
                    continue
                mt = mods.get(r["module_id"])
                c = {"by": nm(r["emp_id"]), "module": (mt["title"] if mt else ""),
                     "text": txt, "times": 1,
                     "low": (r["trainer_rating"] or 5) <= 2 or (r["content_rating"] or 5) <= 2}
                seen[key] = c
                comments.append(c)
        low = [ {"by": nm(r["emp_id"]), "trainer": r["trainer_rating"], "content": r["content_rating"]}
                for r in rs if (r["trainer_rating"] or 5) <= 2 or (r["content_rating"] or 5) <= 2 ]
        block_list.append({
            "trainer_id": b["trainer_id"], "trainer": b["trainer"],
            "trainees": b["trainees"], "modules": mod_rows,
            "feedback": {"n": len(rs),
                         "trainer_avg": round(tr_avg, 1) if tr_avg is not None else None,
                         "content_avg": round(ct_avg, 1) if ct_avg is not None else None,
                         "comments": comments, "low": low},
        })
    block_list.sort(key=lambda b: (b["trainer_id"] is None, b["trainer"].lower()))

    # ---- re-tests needed (failed and not passed later that day) ----
    retests = []
    for (e, aid), v in per_ta.items():
        if not v["passed"]:
            a = assess.get(aid)
            retests.append({"emp_id": e, "name": nm(e), "trainer_id": t_of.get(e),
                            "assessment": (a["title"] if a else "Assessment #" + str(aid)),
                            "score": v["best"], "pass_mark": (a["pass_percent"] if a else None),
                            "attempts": v["attempts"]})
    retests.sort(key=lambda x: x["name"].lower())

    # ---- weak topics (answer accuracy) -------------------------
    weak = []
    if _table_exists(db, "answer_details"):
        cat = {}
        qs = {}
        for r in db.execute(
            "SELECT emp_id, category, question_text, is_correct FROM answer_details "
            "WHERE " + in_win("taken_at"), win).fetchall():
            if r["emp_id"] in staff:
                continue
            c = (r["category"] or "").strip()
            if c:
                x = cat.setdefault(c, [0, 0]); x[0] += 1; x[1] += 1 if r["is_correct"] else 0
            q = _short(r["question_text"], 80)
            if q:
                x = qs.setdefault(q, [0, 0, set()]); x[0] += 1; x[1] += 1 if r["is_correct"] else 0
                x[2].add(r["emp_id"])
        for c, (n, ok) in cat.items():
            if n >= 3 and ok * 100.0 / n < 70:
                weak.append({"topic": c, "pct": round(ok * 100.0 / n), "n": n, "kind": "topic"})
        weak.sort(key=lambda w: w["pct"])
        weak = weak[:3]
        if not weak:   # no categories — fall back to most-missed questions
            for q, (n, ok, who) in qs.items():
                if len(who) >= 2 and ok * 100.0 / n < 50:      # missed by 2+ different trainees
                    weak.append({"topic": q, "pct": round(ok * 100.0 / n), "n": n, "kind": "question"})
            weak.sort(key=lambda w: (w["pct"], -w["n"]))
            weak = weak[:3]

    # ---- feedback pending (modules done today, not yet rated) -----
    fb_pending = []
    if has_ratings:
        for e in trainees:
            miss = [m for m in comps_by_emp.get(e, []) if (e, m) not in rated_lm]
            if miss:
                fb_pending.append({"emp_id": e, "name": nm(e), "trainer_id": t_of.get(e), "count": len(miss)})

    # ---- OJT calls ------------------------------------------------
    calls = {"total": 0, "by_outcome": {}, "by_caller": {}, "follow_up": []}
    if _table_exists(db, "ojt_calls"):
        last = {}
        for r in db.execute(
            "SELECT oc.called_by, oc.outcome, oc.day_no, oc.called_at, e.emp_id AS learner "
            "FROM ojt_calls oc LEFT JOIN ojt_enrollments e ON e.id=oc.enrollment_id "
            "WHERE " + in_win("oc.called_at") + " ORDER BY oc.called_at", win
        ).fetchall():
            if only_trainer and r["called_by"] != only_trainer:
                continue
            calls["total"] += 1
            o = r["outcome"] or "other"
            calls["by_outcome"][o] = calls["by_outcome"].get(o, 0) + 1
            cb = nm(r["called_by"]) if r["called_by"] else "—"
            calls["by_caller"][cb] = calls["by_caller"].get(cb, 0) + 1
            last[r["learner"]] = (o, r["day_no"])
        for le, (o, dn) in last.items():
            if o in ("no_answer", "busy"):
                calls["follow_up"].append({"name": nm(le), "outcome": OUTCOME_LABEL.get(o, o), "day": dn})

    # ---- certificates ---------------------------------------------
    certs = [{"name": nm(r["emp_id"]), "cert": r["cert_name"], "trainer_id": t_of.get(r["emp_id"])}
             for r in db.execute(
                 "SELECT emp_id, cert_name FROM issued_certificates WHERE " + in_win("issued_at")
                 + " ORDER BY issued_at", win).fetchall()]

    # ---- new joiners / logins ---------------------------------------
    joiners = [{"name": r["name"], "designation": (r["designation"] or "").strip(),
                "status": r["status"], "added_by": (nm(r["added_by"]) if r["added_by"] else "self sign-up")}
               for e, r in users.items()
               if r["created_at"] and since <= str(r["created_at"]) < until and e not in staff]
    joiners.sort(key=lambda x: x["name"].lower())
    is_today = (d == _today_ist())
    logins = None
    if is_today:   # last_login only keeps the latest login, so it is exact only for today
        logins = sum(1 for e, r in users.items()
                     if e not in staff and r["last_login"] and since <= str(r["last_login"]) < until)
    active = set(trainees) | {r["emp_id"] for r in day_ratings if r["emp_id"] not in staff}

    # ---- trainer-only view ------------------------------------------
    if only_trainer:
        block_list = [b for b in block_list if b["trainer_id"] == only_trainer]
        mine = {t["emp_id"] for b in block_list for t in b["trainees"]}
        retests = [x for x in retests if x["trainer_id"] == only_trainer]
        fb_pending = [x for x in fb_pending if x["trainer_id"] == only_trainer]
        certs = [x for x in certs if x["trainer_id"] == only_trainer]
        results = [r for r in results if r["emp_id"] in mine]
        comps = [r for r in comps if r["emp_id"] in mine]
        per_ta = {k: v for k, v in per_ta.items() if k[0] in mine}
        active = mine
        joiners = []
        logins = None
        weak = []
        course_ratings = []

    n_pass = sum(1 for v in per_ta.values() if v["passed"])
    n_fail = sum(1 for v in per_ta.values() if not v["passed"])
    numbers = {
        "joiners": len(joiners),
        "active": len(active),
        "logins": logins,
        "modules_completed": len(comps),
        "induction_completed": sum(1 for r in comps if r["module_id"] in mods and mods[r["module_id"]]["kind"] == "induction"),
        "attempts": len(results),
        "assessed_trainees": len({k[0] for k in per_ta}),
        "passed": n_pass, "failed": n_fail,
        "avg_score": round(_avg([v["best"] for v in per_ta.values()])) if per_ta else None,
        "feedback": sum(b["feedback"]["n"] for b in block_list) + len(course_ratings),
        "ojt_calls": calls["total"],
        "certs": len(certs),
    }
    course = None
    if course_ratings:
        course = {"n": len(course_ratings),
                  "avg": round(_avg([r["course_rating"] for r in course_ratings]) or 0, 1)}

    return {"numbers": numbers, "blocks": block_list, "retests": retests, "weak": weak,
            "feedback_pending": fb_pending, "calls": calls, "certs": certs,
            "joiners": joiners, "course": course, "is_today": is_today}


# ===============================================================
#  WhatsApp text for the AUTO part
# ===============================================================
def _auto_text(a):
    n = a["numbers"]
    L = []
    L.append("*📊 Today in numbers*")
    if n["joiners"]:
        L.append("New joiners added: %d" % n["joiners"])
    L.append("Learners active: %d" % n["active"])
    if n["logins"] is not None:
        L.append("Logged in today: %d" % n["logins"])
    L.append("Modules completed: %d" % n["modules_completed"]
             + (" (induction %d)" % n["induction_completed"] if n["induction_completed"] else ""))
    n_as = n["passed"] + n["failed"]
    L.append("Assessments: %d by %d trainee%s (%d attempts)"
             % (n_as, n["assessed_trainees"], "" if n["assessed_trainees"] == 1 else "s", n["attempts"]))
    L.append("✅ Passed: %d | ❌ Failed: %d" % (n["passed"], n["failed"]))
    if n["avg_score"] is not None:
        L.append("Average score: %d%%" % n["avg_score"])
    L.append("Feedback received: %d" % n["feedback"])
    L.append("OJT calls: %d" % n["ojt_calls"])
    L.append("Certificates issued: %d" % n["certs"])

    if a["blocks"]:
        L.append("")
        L.append("*🎓 Induction & Assessment*")
        for b in a["blocks"]:
            L.append("")
            L.append("*Trainer: %s*" % b["trainer"])
            if b["trainees"]:
                L.append("Trainees: %d" % len(b["trainees"]))
            if b["modules"]:
                L.append("_Module-wise_")
                for i, m in enumerate(b["modules"], 1):
                    pm = (" (pass %d%%)" % m["pass_mark"]) if m["pass_mark"] else ""
                    L.append("%d. %s – Avg %d%% | ✅ %d | ❌ %d%s"
                             % (i, m["module"], m["avg"], m["pass"], m["fail"], pm))
            if b["trainees"]:
                L.append("_Trainee-wise_")
                for t in b["trainees"]:
                    head = t["name"] + (" (%s)" % t["designation"] if t["designation"] else "")
                    if t["assessments"]:
                        parts = []
                        for x in t["assessments"]:
                            s = "%s %d%% %s" % (x["assessment"], x["score"], "✅" if x["passed"] else "❌")
                            if x["attempts"] > 1:
                                s += " (%d attempts)" % x["attempts"]
                            parts.append(s)
                        L.append("• %s – %s" % (head, " | ".join(parts)))
                    else:
                        L.append("• %s – no assessment today" % head)
                    if t["modules_done"]:
                        L.append("   📘 Modules done: %d" % len(t["modules_done"]))
            fb = b["feedback"]
            if fb["n"]:
                L.append("_Feedback (%d)_" % fb["n"])
                L.append("Trainer ⭐ %s | Content ⭐ %s"
                         % (fb["trainer_avg"] if fb["trainer_avg"] is not None else "–",
                            fb["content_avg"] if fb["content_avg"] is not None else "–"))
                for c in fb["comments"][:5]:
                    L.append("💬 \"%s\" – %s%s%s" % (c["text"], c["by"],
                             (" (x%d)" % c["times"]) if c["times"] > 1 else "", " ⚠️" if c["low"] else ""))
                if len(fb["comments"]) > 5:
                    L.append("   +%d more comments" % (len(fb["comments"]) - 5))
    if a.get("course"):
        L.append("")
        L.append("Overall course rating: ⭐ %s (%d)" % (a["course"]["avg"], a["course"]["n"]))

    if a["retests"]:
        L.append("")
        L.append("*❗ Re-test / re-training needed*")
        for x in a["retests"]:
            pm = (", pass %d%%" % x["pass_mark"]) if x["pass_mark"] else ""
            L.append("• %s – %s (%d%%%s)" % (x["name"], x["assessment"], x["score"], pm))
    if a["weak"]:
        L.append("")
        L.append("*📉 Weak areas today*")
        for w in a["weak"]:
            L.append("• %s – %d%% correct (%d answers)" % (w["topic"], w["pct"], w["n"]))
    if a["feedback_pending"]:
        L.append("")
        L.append("*⏳ Feedback pending*")
        for x in a["feedback_pending"]:
            L.append("• %s – %d module%s not rated" % (x["name"], x["count"], "" if x["count"] == 1 else "s"))
    c = a["calls"]
    if c["total"]:
        L.append("")
        L.append("*🧭 OJT calls*")
        L.append(" | ".join("%s: %d" % (OUTCOME_LABEL.get(k, k), v) for k, v in c["by_outcome"].items()))
        if len(c["by_caller"]) > 1:
            L.append("By: " + ", ".join("%s %d" % (k, v) for k, v in c["by_caller"].items()))
        if c["follow_up"]:
            L.append("Follow-up: " + ", ".join(
                "%s (Day %s, %s)" % (f["name"], f["day"] or "-", f["outcome"]) for f in c["follow_up"]))
    if a["certs"]:
        L.append("")
        L.append("*📜 Certificates issued*")
        for x in a["certs"]:
            L.append("• %s – %s" % (x["name"], x["cert"]))
    if a["joiners"]:
        L.append("")
        L.append("*👋 New joiners*")
        for j in a["joiners"]:
            st = "" if j["status"] == "approved" else " – %s" % j["status"]
            L.append("• %s%s%s" % (j["name"], (" (%s)" % j["designation"]) if j["designation"] else "", st))
    return "\n".join(L)


# ===============================================================
#  ENDPOINTS
# ===============================================================
@eod_bp.route("/api/eod/report")
@_staff_only
def api_eod_report():
    _ensure()
    u = _current_user()
    is_admin = (u["role"] == "admin")
    today = _today_ist()
    d = _parse_date(request.args.get("date")) or today
    if d > today:
        return jsonify(ok=False, msg="Can't make a report for a future date."), 400
    db = _get_db()

    auto = _build_auto(db, d, only_trainer=None if is_admin else u["emp_id"])

    names = {r["emp_id"]: r["name"] for r in db.execute("SELECT emp_id, name FROM users").fetchall()}
    rows = db.execute(
        "SELECT emp_id, work_done, in_progress, support_needed, tomorrow_plan, updated_at "
        "FROM eod_entries WHERE report_date=?", (d.isoformat(),)).fetchall()
    entries = []
    mine = None
    for r in rows:
        e = {"emp_id": r["emp_id"], "name": names.get(r["emp_id"], r["emp_id"]),
             "updated_at": r["updated_at"]}
        for f in FIELDS:
            e[f] = r[f] or ""
        if r["emp_id"] == u["emp_id"]:
            mine = e
        if is_admin or r["emp_id"] == u["emp_id"]:
            entries.append(e)

    # yesterday's "tomorrow plan" (mine) — shown as a reminder
    prev = db.execute(
        "SELECT tomorrow_plan, report_date FROM eod_entries WHERE emp_id=? AND report_date<? "
        "ORDER BY report_date DESC LIMIT 1", (u["emp_id"], d.isoformat())).fetchone()

    # who has / hasn't filled (admin only): all approved trainers
    team_status = []
    if is_admin:
        filled = {e["emp_id"] for e in entries}
        for r in db.execute(
            "SELECT emp_id, name FROM users WHERE role IN ('instructor','admin') "
            "AND status='approved' AND emp_id<>'ADMIN' ORDER BY name").fetchall():
            team_status.append({"emp_id": r["emp_id"], "name": r["name"],
                                "filled": r["emp_id"] in filled})

    if d == today:
        can_edit = True
    elif is_admin:
        can_edit = True
    else:
        can_edit = (today - d).days <= TRAINER_BACKDATE_DAYS

    return jsonify(ok=True, date=d.isoformat(), today=today.isoformat(),
                   is_admin=is_admin, me=u["emp_id"], my_name=u["name"],
                   auto=auto, auto_text=_auto_text(auto),
                   entries=entries, mine=mine, can_edit=can_edit,
                   prev_plan=({"date": prev["report_date"], "text": prev["tomorrow_plan"] or ""}
                              if prev and (prev["tomorrow_plan"] or "").strip() else None),
                   team_status=team_status)


@eod_bp.route("/api/eod/save", methods=["POST"])
@_staff_only
def api_eod_save():
    _ensure()
    u = _current_user()
    data = request.get_json(force=True, silent=True) or {}
    today = _today_ist()
    d = _parse_date(data.get("date")) or today
    if d > today:
        return jsonify(ok=False, msg="Can't save a report for a future date."), 400
    if u["role"] != "admin" and (today - d).days > TRAINER_BACKDATE_DAYS:
        return jsonify(ok=False, msg="You can only fill today's or the last %d days' report."
                       % TRAINER_BACKDATE_DAYS), 403
    vals = [str(data.get(f) or "").strip()[:MAX_LEN] for f in FIELDS]
    now = datetime.utcnow().isoformat()
    db = _get_db()
    db.execute(
        "INSERT INTO eod_entries (report_date, emp_id, work_done, in_progress, support_needed, "
        "tomorrow_plan, updated_at) VALUES (?,?,?,?,?,?,?) "
        "ON CONFLICT (report_date, emp_id) DO UPDATE SET work_done=EXCLUDED.work_done, "
        "in_progress=EXCLUDED.in_progress, support_needed=EXCLUDED.support_needed, "
        "tomorrow_plan=EXCLUDED.tomorrow_plan, updated_at=EXCLUDED.updated_at",
        (d.isoformat(), u["emp_id"], vals[0], vals[1], vals[2], vals[3], now))
    db.commit()
    return jsonify(ok=True, msg="Saved your EOD update for " + d.strftime("%d %b %Y") + ".")


def init_eod_report(app, get_db, current_user):
    global _get_db, _current_user
    _get_db = get_db
    _current_user = current_user
    app.register_blueprint(eod_bp)
