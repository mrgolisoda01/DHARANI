/* ============================================================
   Mr. Golisoda LMS — OJT module (admin / instructor screens)
   Phase 1: task templates, trainees, trainer sign-off, approvals.
   Buttons use data-act (no inline onclick) so the page's global
   "Please wait…" guard doesn't lock navigation buttons.
   ============================================================ */
(function(){
  "use strict";

  var ROLES = ["BDE", "BDM", "State Head"];
  var S = { role: "BDE", view: "trainees", show: "active", openDay: null,
            days: [], counts: {}, pendingCount: 0, isAdmin: !!window.IS_ADMIN, current: null };

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function note(msg){ if(typeof toast === "function") toast(msg); else alert(msg); }
  function fmtD(iso){
    if(!iso) return "";
    var d = new Date(iso.slice(0,10) + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
  }
  async function getJ(url){
    var r = await fetch(url, { credentials:"same-origin" });
    return r.json();
  }
  async function postJ(url, body){
    var r = await fetch(url, { method:"POST", credentials:"same-origin",
      headers:{ "Content-Type":"application/json" }, body: JSON.stringify(body) });
    return r.json();
  }
  // simple own busy state for save buttons
  function busy(btn, on){
    if(!btn) return;
    if(on){ btn.dataset.t = btn.innerHTML; btn.innerHTML = "Please wait…"; btn.disabled = true; }
    else { btn.innerHTML = btn.dataset.t || btn.innerHTML; btn.disabled = false; }
  }

  /* ---------------- style (scoped to #tabOjt) ---------------- */
  var css = document.createElement("style");
  css.textContent = [
    "#tabOjt .ojt-roles{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px}",
    "#tabOjt .ojt-role{border:1px solid var(--mg-line);background:#fff;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:14px;color:var(--mg-ink)}",
    "#tabOjt .ojt-role.on{background:var(--mg-blue);border-color:var(--mg-blue);color:#fff}",
    "#tabOjt .ojt-role .n{display:inline-block;margin-left:6px;background:rgba(0,0,0,.08);border-radius:9px;padding:0 7px;font-size:12px}",
    "#tabOjt .ojt-views{display:flex;gap:4px;border-bottom:1px solid var(--mg-line);margin-bottom:14px;flex-wrap:wrap}",
    "#tabOjt .ojt-view{border:none;background:none;padding:10px 14px;font-weight:600;color:var(--mg-muted);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-1px;font-size:13px}",
    "#tabOjt .ojt-view.on{color:var(--mg-blue);border-bottom-color:var(--mg-blue)}",
    "#tabOjt .badge{background:#e24b4a;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px}",
    "#tabOjt .day{background:#fff;border:1px solid var(--mg-line);border-radius:10px;margin-bottom:8px}",
    "#tabOjt .day-h{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;cursor:pointer;gap:8px}",
    "#tabOjt .day-h b{font-size:14px}",
    "#tabOjt .day-b{padding:0 14px 14px}",
    "#tabOjt .trow{display:grid;grid-template-columns:28px 1fr 1.6fr 34px;gap:8px;align-items:start;margin-bottom:6px}",
    "#tabOjt .trow input,#tabOjt .trow textarea{width:100%;box-sizing:border-box;border:1px solid var(--mg-line);border-radius:7px;padding:7px 9px;font:inherit;font-size:13px}",
    "#tabOjt .trow textarea{min-height:36px;resize:vertical}",
    "#tabOjt .trow .no{padding-top:8px;color:var(--mg-muted);font-size:12px;text-align:center}",
    "#tabOjt .muted{color:var(--mg-muted);font-size:12px}",
    "#tabOjt .bar{height:7px;background:#eef2f5;border-radius:6px;overflow:hidden;min-width:80px}",
    "#tabOjt .bar i{display:block;height:100%;background:var(--mg-green)}",
    ".ojt-tl-day{border:1px solid var(--mg-line);border-radius:9px;padding:9px 11px;margin-bottom:7px}",
    ".ojt-tl-day.today{border-color:var(--mg-blue);box-shadow:0 0 0 2px #cdeefc}",
    ".ojt-tl-day.off{background:#f7f9fa}",
    ".ojt-tl-h{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px}",
    ".ojt-task{display:flex;gap:9px;align-items:flex-start;padding:5px 0;font-size:13px}",
    ".ojt-task input{margin-top:3px;width:17px;height:17px}",
    ".ojt-k{padding:2px 8px;border-radius:7px;font-size:11px;font-weight:600}",
    ".k-sunday{background:#eeedfe;color:#26215c}.k-holiday{background:#faeeda;color:#854f0b}",
    ".k-review{background:#e6f1fb;color:#0c447c}.k-today{background:var(--mg-blue);color:#fff}",
    ".ojt-link{border:none;background:none;color:var(--mg-blue);cursor:pointer;font-size:12px;padding:0}",
    "#tabOjt input[type=file]{width:auto !important;max-width:260px;padding:5px !important}",
    "#tabOjt .sec-head .btns{align-items:center}"
  ].join("\n");
  document.head.appendChild(css);

  /* ---------------- hook into the existing admin tabs ---------------- */
  try { TABS.ojt = "tabOjt"; TAB_BTNS.ojt = "tabOjtBtn"; } catch(e){}
  var _origSwitch = window.switchTab;
  window.switchTab = function(which){
    _origSwitch(which);
    if(which === "ojt") load();
  };

  /* ---------------- main render ---------------- */
  function shell(){
    var root = $("ojtRoot");
    var roles = ROLES.map(function(r){
      return '<button class="ojt-role' + (S.role === r ? " on" : "") + '" data-act="role" data-v="' + esc(r) + '">' +
        esc(r) + '<span class="n">' + (S.counts[r] || 0) + '</span></button>';
    }).join("");
    var views = [
      ["trainees", "👥 Trainees"], ["tasks", "📋 Day-wise tasks"],
      ["appr", "✅ " + (S.isAdmin ? "Approvals" : "My requests") +
        (S.isAdmin && S.pendingCount ? '<span class="badge">' + S.pendingCount + "</span>" : "")]
    ].map(function(v){
      return '<button class="ojt-view' + (S.view === v[0] ? " on" : "") + '" data-act="view" data-v="' + v[0] + '">' + v[1] + "</button>";
    }).join("");
    root.innerHTML =
      '<div class="sec-head"><h2>🧭 OJT — On-the-Job Training</h2></div>' +
      '<div class="note">30 <b>working</b> days from the audit-passed date. Sundays are the fixed week off and don\'t count — the finish date extends past them. Leave also extends the OJT by a day. If a trainee works a Sunday, mark it <b>Worked</b> so it counts (finish comes earlier). Days 29–30 are the final review. Only the trainer signs off tasks.</div>' +
      '<div class="ojt-roles">' + roles + "</div>" +
      '<div class="ojt-views">' + views + "</div>" +
      '<div id="ojtBody"><div class="empty">Loading…</div></div>';
  }

  async function load(){
    shell();
    // counts + pending badge in the background
    try{
      var c = await getJ("/api/ojt/trainees?show=none");
      if(c.ok){ S.counts = c.counts; S.isAdmin = c.is_admin; }
      if(S.isAdmin){
        var p = await getJ("/api/ojt/pending");
        if(p.ok) S.pendingCount = p.items.length;
      }
    }catch(e){}
    shell();
    if(S.view === "trainees") loadTrainees();
    else if(S.view === "tasks") loadTasks();
    else loadApprovals();
  }

  /* ================= TRAINEES ================= */
  async function loadTrainees(){
    var body = $("ojtBody");
    body.innerHTML = '<div class="empty">Loading…</div>';
    var d;
    try{ d = await getJ("/api/ojt/trainees?role=" + encodeURIComponent(S.role) + "&show=" + S.show); }
    catch(e){ body.innerHTML = '<div class="empty">Could not load.</div>'; return; }
    if(!d.ok){ body.innerHTML = '<div class="empty">' + esc(d.msg || "Could not load.") + "</div>"; return; }
    S.counts = d.counts;
    var head =
      '<div class="sec-head"><div class="btns">' +
        '<button class="btn primary" data-act="start-open">＋ Audit passed — start OJT</button>' +
      '</div><div class="btns">' +
        '<select class="search" data-act="show" style="min-width:140px">' +
          '<option value="active"' + (S.show === "active" ? " selected" : "") + '>Active OJT</option>' +
          '<option value="closed"' + (S.show === "closed" ? " selected" : "") + '>Completed / failed</option>' +
          '<option value="all"' + (S.show === "all" ? " selected" : "") + '>All</option>' +
        "</select></div></div>";
    if(!d.trainees.length){
      body.innerHTML = head + '<div class="empty">No ' + esc(S.role) + ' trainees here yet. When a trainee passes the audit, click <b>“Audit passed — start OJT”</b>.</div>';
      return;
    }
    var rows = d.trainees.map(function(t){
      var pct = t.total ? Math.round(t.done * 100 / t.total) : 0;
      return "<tr>" +
        "<td><b>" + esc(t.name) + '</b><div class="muted">' + esc(t.emp_id) + "</div></td>" +
        "<td>" + esc(t.day_label) + "</td>" +
        "<td>" + fmtD(t.start_date) + " → " + fmtD(t.end_date) + "</td>" +
        "<td>" + esc(t.trainer) + "</td>" +
        '<td><div class="bar"><i style="width:' + pct + '%"></i></div><div class="muted">' + t.done + " / " + t.total + " tasks</div></td>" +
        "<td>" + (t.overdue ? '<span class="pill p-pending">' + t.overdue + " pending</span>" : '<span class="pill p-approved">On track</span>') + "</td>" +
        '<td><button class="btn" data-act="open" data-id="' + t.id + '">Open</button></td>' +
      "</tr>";
    }).join("");
    body.innerHTML = head +
      '<div class="tbl-wrap"><table><thead><tr><th>Trainee</th><th>OJT day</th><th>Dates</th><th>Trainer</th><th>Progress</th><th>Due tasks</th><th></th></tr></thead><tbody>' +
      rows + "</tbody></table></div>";
    // refresh role counts
    document.querySelectorAll("#tabOjt .ojt-role").forEach(function(b){
      var n = b.querySelector(".n"); if(n) n.textContent = S.counts[b.dataset.v] || 0;
    });
  }

  async function openStart(){
    var d = await getJ("/api/ojt/eligible?role=" + encodeURIComponent(S.role));
    if(!d.ok){ note(d.msg || "Could not load."); return; }
    var opts = d.people.map(function(p){
      return '<option value="' + esc(p.emp_id) + '">' + esc(p.name) + " (" + esc(p.emp_id) + ") — " + esc(p.designation) + "</option>";
    }).join("");
    var trainerSel = S.isAdmin
      ? '<label class="muted">Trainer</label><select id="ojtTrainer" class="search" style="width:100%;margin:4px 0 12px"><option value="">— Not assigned —</option>' +
        d.trainers.map(function(t){ return '<option value="' + esc(t.emp_id) + '">' + esc(t.name) + "</option>"; }).join("") + "</select>"
      : '<div class="note">You will be the trainer for this person.</div>';
    modal(
      "<h3>Audit passed — start OJT</h3>" +
      '<p class="sub">' + esc(S.role) + " · Day 1 of OJT will be the audit passed date.</p>" +
      (d.people.length ? "" : '<div class="note">No active ' + esc(S.role) + ' learners without an OJT. Check the employee\'s designation in the Employees tab.</div>') +
      '<label class="muted">Employee</label><select id="ojtEmp" class="search" style="width:100%;margin:4px 0 12px">' + opts + "</select>" +
      '<label class="muted">Audit passed date (= OJT Day 1)</label><input id="ojtDate" type="date" class="search" style="width:100%;box-sizing:border-box;margin:4px 0 12px" value="' + d.today + '">' +
      trainerSel +
      '<div class="modal-foot"><button class="btn primary" data-act="start-save"' + (d.people.length ? "" : " disabled") + ">Start OJT</button></div>"
    );
  }

  async function saveStart(btn){
    busy(btn, true);
    var r = await postJ("/api/ojt/start", {
      emp_id: $("ojtEmp").value, audit_date: $("ojtDate").value, role: S.role,
      trainer_id: $("ojtTrainer") ? $("ojtTrainer").value : ""
    });
    busy(btn, false);
    note(r.msg || (r.ok ? "Done." : "Could not start."));
    if(r.ok){ closeOjtModal(); load(); }
  }

  async function openTrainee(id){
    var d = await getJ("/api/ojt/trainee?id=" + id);
    if(!d.ok){ note(d.msg || "Could not load."); return; }
    S.current = d;
    var e = d.enrollment, tl = d.timeline, active = e.status === "active";
    var daysHtml = tl.days.map(function(day){
      var isWork = (day.kind === "work" || day.kind === "review");
      var badge = day.kind === "sunday" ? '<span class="ojt-k k-sunday">Week off (Sun)</span>'
        : day.kind === "weekoff" ? '<span class="ojt-k k-sunday">Week off</span>'
        : day.kind === "leave" ? '<span class="ojt-k k-holiday">Leave</span>'
        : day.kind === "review" ? '<span class="ojt-k k-review">Final review</span>' : "";
      if(day.is_today) badge += ' <span class="ojt-k k-today">Today</span>';

      // per-day edit controls (trainer/admin), only while active
      var editBtns = "";
      if(active){
        var b = [];
        if(day.weekday === "Sun" && day.override !== "worked"){
          b.push('<button class="ojt-link" data-act="dayset" data-date="' + day.date + '" data-kind="worked">Mark worked</button>');
        }
        if(day.override === "worked"){
          b.push('<button class="ojt-link" data-act="dayset" data-date="' + day.date + '" data-kind="clear">Back to week off</button>');
        }
        if(isWork && day.weekday !== "Sun"){
          b.push('<button class="ojt-link" data-act="dayset" data-date="' + day.date + '" data-kind="leave">Mark leave</button>');
          b.push('<button class="ojt-link" data-act="dayset" data-date="' + day.date + '" data-kind="weekoff">Mark week off</button>');
        }
        if(day.kind === "leave" || day.kind === "weekoff"){
          if(day.override){ b.push('<button class="ojt-link" data-act="dayset" data-date="' + day.date + '" data-kind="clear">Undo</button>'); }
        }
        editBtns = b.join(' ');
      }

      var tasks = day.tasks.length ? day.tasks.map(function(t){
        var claim = t.self_done
          ? ' <span class="ojt-claim" style="font-size:11px;color:#c98a00;font-weight:600;white-space:nowrap">🟡 Trainee marked done</span>'
          : '';
        return '<label class="ojt-task"><input type="checkbox" data-act="sign" data-task="' + t.id + '"' +
          (t.done ? " checked" : "") + (active ? "" : " disabled") + "><span><b>" + esc(t.title) + "</b>" + claim +
          (t.description ? '<br><span class="muted">' + esc(t.description) + "</span>" : "") + "</span></label>";
      }).join("") : '<div class="muted">No tasks set for this day.</div>';

      // trainee's daily notes (read-only for trainer/admin)
      var noteBlock = "";
      if((day.work_done && day.work_done.trim()) || (day.problems && day.problems.trim())){
        noteBlock = '<div class="ojt-daynote" style="margin-top:6px;padding:8px 10px;background:#f7f9fa;border-radius:8px;font-size:12.5px">' +
          (day.work_done ? '<div><b>Work done:</b> ' + esc(day.work_done) + '</div>' : '') +
          (day.problems ? '<div style="margin-top:3px"><b>Problems faced:</b> ' + esc(day.problems) + '</div>' : '') +
          '</div>';
      }

      var dayLabel = (day.day !== null && day.day !== undefined)
        ? ("<b>Day " + day.day + "</b> · ")
        : '<b class="muted">—</b> · ';
      return '<div class="ojt-tl-day' + (day.is_today ? " today" : "") + (isWork ? "" : " off") + '">' +
        '<div class="ojt-tl-h"><span>' + dayLabel + day.weekday + ", " + fmtD(day.date) + " " + badge + "</span>" + editBtns + "</div>" +
        (isWork ? (tasks + noteBlock) : "") + "</div>";
    }).join("");

    var closeBox = active
      ? '<div class="note" style="margin-top:10px"><b>Final decision</b> (after the review days)<br>' +
        '<textarea id="ojtFinalNote" placeholder="Trainer remarks" style="width:100%;box-sizing:border-box;margin:6px 0;border:1px solid var(--mg-line);border-radius:7px;padding:7px;font:inherit"></textarea>' +
        '<div class="btns"><button class="btn primary" data-act="close" data-v="completed">✅ Mark OJT completed</button>' +
        '<button class="btn" data-act="close" data-v="failed">❌ Mark failed</button>' +
        (S.isAdmin ? '<button class="btn" data-act="remove" style="margin-left:auto;color:var(--mg-red)">Remove (started by mistake)</button>' : "") +
        "</div></div>"
      : '<div class="note"><b>Status:</b> ' + esc(e.status) + (e.final_note ? " — " + esc(e.final_note) : "") + "</div>";

    modal(
      "<h3>" + esc(e.name) + ' <span class="muted">(' + esc(e.emp_id) + ")</span></h3>" +
      '<p class="sub">' + esc(e.role) + " · " + esc(e.day_label) + " · Trainer: " + esc(e.trainer) +
      "<br>" + fmtD(e.start_date) + " → " + fmtD(tl.end_date) + " · " + tl.done + "/" + tl.total + " tasks signed off · " +
      tl.sundays + " week-offs · " + tl.holidays + " leave days</p>" +
      daysHtml + closeBox, 760
    );
  }

  /* ================= DAY-WISE TASKS ================= */
  async function loadTasks(){
    var body = $("ojtBody");
    body.innerHTML = '<div class="empty">Loading…</div>';
    var d = await getJ("/api/ojt/tasks?role=" + encodeURIComponent(S.role));
    if(!d.ok){ body.innerHTML = '<div class="empty">' + esc(d.msg || "Could not load.") + "</div>"; return; }
    S.days = d.days;
    var info = S.isAdmin ? "Changes you save go live immediately."
      : "Your changes go to the admin for approval. The current tasks stay live until approved.";
    var head =
      '<div class="note"><b>' + esc(S.role) + " task template</b> — " + d.total + " tasks across 30 days. " + info +
      "<br>Add tasks day by day below, <b>or</b> download the Excel, fill one row per task (Day, Task title, Task description) and upload it back. Days not in the file are left unchanged.</div>" +
      '<div class="sec-head"><div class="btns">' +
        '<a class="btn" href="/api/ojt/template.xlsx?role=' + encodeURIComponent(S.role) + '">⬇ Download Excel (' + (d.total ? "current tasks" : "sample") + ")</a>" +
        '<input type="file" id="ojtFile" accept=".xlsx,.csv" style="font-size:12px">' +
        '<button class="btn primary" data-act="upload">⬆ Upload file</button>' +
      '</div></div><div id="ojtUpMsg"></div>';
    body.innerHTML = head + '<div id="ojtDays"></div>';
    renderDays();
  }

  function renderDays(){
    var box = $("ojtDays");
    if(!box) return;
    box.innerHTML = S.days.map(function(day){
      var open = S.openDay === day.day;
      var label = "<b>Day " + day.day + "</b>" + (day.review ? ' <span class="ojt-k k-review">Final review</span>' : "") +
        ' <span class="muted">· ' + day.tasks.length + " task" + (day.tasks.length === 1 ? "" : "s") + "</span>";
      var preview = !open && day.tasks.length
        ? '<span class="muted" style="flex:1;text-align:right;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:55%">' +
          esc(day.tasks.map(function(t){ return t.title; }).join(" · ")) + "</span>" : "";
      var bodyHtml = "";
      if(open){
        var rows = (day._edit || []).map(function(t, i){ return taskRow(i, t); }).join("");
        bodyHtml = '<div class="day-b">' +
          '<div class="trow muted" style="margin-bottom:2px"><span></span><span>Task title</span><span>Task description</span><span></span></div>' +
          '<div id="ojtRows">' + rows + "</div>" +
          '<div class="btns" style="margin-top:8px"><button class="btn" data-act="addrow">＋ Add task</button>' +
          '<span style="flex:1"></span><button class="btn" data-act="cancel-day">Cancel</button>' +
          '<button class="btn primary" data-act="save-day">' + (S.isAdmin ? "Save Day " : "Submit Day ") + day.day + "</button></div></div>";
      }
      return '<div class="day"><div class="day-h" data-act="toggle-day" data-day="' + day.day + '">' +
        "<span>" + (open ? "▾ " : "▸ ") + label + "</span>" + preview + "</div>" + bodyHtml + "</div>";
    }).join("");
  }

  function taskRow(i, t){
    return '<div class="trow"><span class="no">' + (i + 1) + "</span>" +
      '<input data-f="title" placeholder="e.g. Outlet visit with buddy" value="' + esc(t.title) + '">' +
      '<textarea data-f="description" placeholder="What exactly should they do?">' + esc(t.description) + "</textarea>" +
      '<button class="act del" data-act="delrow" title="Remove this task">✕</button></div>';
  }

  function readRows(){
    var out = [];
    document.querySelectorAll("#ojtRows .trow").forEach(function(r){
      out.push({ title: r.querySelector('[data-f="title"]').value, description: r.querySelector('[data-f="description"]').value });
    });
    return out;
  }

  function currentDay(){ return S.days.find(function(d){ return d.day === S.openDay; }); }

  function toggleDay(n){
    if(S.openDay === n){ S.openDay = null; renderDays(); return; }
    S.openDay = n;
    var day = currentDay();
    day._edit = day.tasks.length ? day.tasks.map(function(t){ return { title: t.title, description: t.description }; })
                                 : [{ title:"", description:"" }];
    renderDays();
  }

  async function saveDay(btn){
    var day = currentDay();
    var tasks = readRows().filter(function(t){ return t.title.trim() || t.description.trim(); });
    if(tasks.some(function(t){ return !t.title.trim(); })){ note("Every task needs a title."); return; }
    busy(btn, true);
    var r = await postJ("/api/ojt/save-day", { role: S.role, day: day.day, tasks: tasks });
    busy(btn, false);
    note(r.msg || (r.ok ? "Saved." : "Could not save."));
    if(r.ok){ S.openDay = null; if(S.isAdmin) loadTasks(); else { renderDays(); } }
  }

  async function upload(btn){
    var f = $("ojtFile");
    var msg = $("ojtUpMsg");
    if(!f.files.length){ note("Choose the Excel/CSV file first."); return; }
    var fd = new FormData();
    fd.append("file", f.files[0]);
    fd.append("role", S.role);
    busy(btn, true);
    var d;
    try{ d = await (await fetch("/api/ojt/upload", { method:"POST", body: fd, credentials:"same-origin" })).json(); }
    catch(e){ d = { ok:false, msg:"Upload error. Check your connection." }; }
    busy(btn, false);
    if(d.ok){
      note(d.msg);
      if(S.isAdmin) loadTasks(); else msg.innerHTML = '<div class="note" style="color:var(--mg-green)">✅ ' + esc(d.msg) + "</div>";
    } else {
      msg.innerHTML = '<div class="note" style="color:var(--mg-red)"><b>' + esc(d.msg) + "</b>" +
        (d.errors && d.errors.length ? "<br>" + d.errors.slice(0, 20).map(esc).join("<br>") + (d.errors.length > 20 ? "<br>…" : "") : "") + "</div>";
    }
  }

  /* ================= APPROVALS ================= */
  async function loadApprovals(){
    var body = $("ojtBody");
    body.innerHTML = '<div class="empty">Loading…</div>';
    var d = await getJ("/api/ojt/pending");
    if(!d.ok){ body.innerHTML = '<div class="empty">Could not load.</div>'; return; }
    if(!d.items.length){
      body.innerHTML = '<div class="empty">' + (d.is_admin ? "No OJT task changes waiting for approval." : "You haven't submitted any OJT task changes yet.") + "</div>";
      return;
    }
    body.innerHTML = d.items.map(function(it){
      var days = Object.keys(it.days).sort(function(a, b){ return a - b; }).map(function(k){
        var ts = it.days[k];
        return '<div style="margin-top:6px"><b>Day ' + esc(k) + "</b> — " + (ts.length ? ts.map(function(t){
          return esc(t.title) + (t.description ? ' <span class="muted">(' + esc(t.description) + ")</span>" : "");
        }).join("; ") : '<span class="muted">all tasks removed</span>') + "</div>";
      }).join("");
      var status = it.status === "pending" ? '<span class="pill p-pending">Pending</span>'
        : it.status === "approved" ? '<span class="pill p-approved">Approved</span>' : '<span class="pill">Rejected</span>';
      var actions = d.is_admin
        ? '<div class="btns" style="margin-top:10px"><button class="btn primary" data-act="resolve" data-id="' + it.id + '" data-v="approve">Approve</button>' +
          '<button class="btn" data-act="resolve" data-id="' + it.id + '" data-v="reject">Reject</button></div>'
        : "";
      return '<div class="card" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
        "<b>" + esc(it.label) + "</b>" + status + "</div>" +
        '<div class="muted">Requested by ' + esc(it.by) + " · " + fmtD(it.created_at) + "</div>" +
        '<div style="font-size:13px;margin-top:6px;max-height:260px;overflow:auto">' + days + "</div>" + actions + "</div>";
    }).join("");
  }

  /* ================= modal ================= */
  function modal(html, width){
    var ov = $("ojtOv");
    var box = ov.querySelector(".modal");
    box.style.maxWidth = (width || 460) + "px";
    $("ojtModalBody").innerHTML = html;
    ov.classList.add("show");
  }
  function closeOjtModal(){ $("ojtOv").classList.remove("show"); }

  /* ================= events (delegated) ================= */
  document.addEventListener("click", async function(e){
    var el = e.target.closest("[data-act]");
    if(!el || !(el.closest("#tabOjt") || el.closest("#ojtOv"))) return;
    var act = el.dataset.act;
    if(el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "checkbox")) return;
    try{
      if(act === "role"){ S.role = el.dataset.v; S.openDay = null; load(); }
      else if(act === "view"){ S.view = el.dataset.v; S.openDay = null; load(); }
      else if(act === "start-open") openStart();
      else if(act === "start-save") saveStart(el);
      else if(act === "open") openTrainee(el.dataset.id);
      else if(act === "toggle-day") toggleDay(parseInt(el.dataset.day, 10));
      else if(act === "addrow"){
        var day = currentDay(); day._edit = readRows(); day._edit.push({ title:"", description:"" }); renderDays();
        var ins = document.querySelectorAll('#ojtRows [data-f="title"]'); if(ins.length) ins[ins.length - 1].focus();
      }
      else if(act === "delrow"){
        var d2 = currentDay(); var rowsEls = Array.prototype.slice.call(document.querySelectorAll("#ojtRows .trow"));
        var idx = rowsEls.indexOf(el.closest(".trow")); d2._edit = readRows(); d2._edit.splice(idx, 1);
        if(!d2._edit.length) d2._edit.push({ title:"", description:"" }); renderDays();
      }
      else if(act === "cancel-day"){ S.openDay = null; renderDays(); }
      else if(act === "save-day") saveDay(el);
      else if(act === "upload") upload(el);
      else if(act === "resolve"){
        var r = await postJ("/api/ojt/resolve", { id: el.dataset.id, decision: el.dataset.v });
        note(r.msg || "Done."); load();
      }
      else if(act === "sign"){
        var cur = S.current.enrollment;
        var rs = await postJ("/api/ojt/signoff", { enrollment_id: cur.id, task_id: el.dataset.task, done: el.checked });
        if(!rs.ok){ note(rs.msg || "Could not save."); el.checked = !el.checked; }
      }
      else if(act === "dayset"){
        var rh = await postJ("/api/ojt/holiday", { enrollment_id: S.current.enrollment.id, date: el.dataset.date, kind: el.dataset.kind });
        if(!rh.ok) note(rh.msg || "Could not save."); else openTrainee(S.current.enrollment.id);
      }
      else if(act === "close"){
        var label = el.dataset.v === "completed" ? "COMPLETED" : "FAILED";
        if(!confirm("Mark this OJT as " + label + "? This closes the OJT.")) return;
        var rc = await postJ("/api/ojt/close", { enrollment_id: S.current.enrollment.id, outcome: el.dataset.v, note: ($("ojtFinalNote") || {}).value || "" });
        note(rc.msg || "Done."); if(rc.ok){ closeOjtModal(); load(); }
      }
      else if(act === "remove"){
        if(!confirm("Remove this OJT completely? Use only if it was started by mistake.")) return;
        var rr = await postJ("/api/ojt/remove", { enrollment_id: S.current.enrollment.id });
        note(rr.msg || "Done."); if(rr.ok){ closeOjtModal(); load(); }
      }
    }catch(err){ note("Something went wrong. Please try again."); }
  });

  document.addEventListener("change", function(e){
    var el = e.target;
    if(el.dataset && el.dataset.act === "show" && el.closest("#tabOjt")){ S.show = el.value; loadTrainees(); }
  });
})();
