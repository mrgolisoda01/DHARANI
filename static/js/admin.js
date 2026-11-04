/* ============================================================
   admin.js — Admin dashboard logic (Delivery 1)
   Talks to the new /api/admin/* routes in app.py
   ============================================================ */

let EMPLOYEES = [];
let CURRENT_EDIT = null;   // emp_id being edited
let CURRENT_RESET = null;  // emp_id being reset

const $ = (id) => document.getElementById(id);

function roleLabel(r){
  if(r === "admin") return ["Admin","p-admin"];
  if(r === "instructor") return ["Instructor","p-instructor"];
  return ["Learner","p-learner"];
}

function clock(){
  const now = new Date();
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  $("todayDate").textContent = days[now.getDay()] + ", " + now.getDate() + " " + months[now.getMonth()] + " " + now.getFullYear();
  let h = now.getHours(), m = now.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if(h === 0) h = 12;
  $("todayTime").textContent = (h<10?"0":"")+h + ":" + (m<10?"0":"")+m + " " + ap;
}

function fmtWhen(iso){
  if(!iso) return "";
  try{
    const d = new Date(iso + (iso.endsWith("Z")?"":"Z"));
    return d.toLocaleString();
  }catch(e){ return ""; }
}

// Date only (no time) — for the "Enrolled" column, e.g. "25 Aug 2026"
function fmtDate(iso){
  if(!iso) return "—";
  try{
    const d = new Date(iso + (iso.endsWith("Z")?"":"Z"));
    return d.toLocaleDateString(undefined, { day:"numeric", month:"short", year:"numeric" });
  }catch(e){ return "—"; }
}

function toast(msg){
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 2600);
}

async function api(url, body){
  const opt = { method: body ? "POST" : "GET", headers:{ "Content-Type":"application/json" } };
  if(body) opt.body = JSON.stringify(body);
  const res = await fetch(url, opt);
  return res.json();
}

async function loadDashboard(){
  const data = await api("/api/admin/dashboard");
  if(!data.ok){ toast("Could not load dashboard."); return; }

  loadPendingRequests();
  loadCommandCenter();

  $("cTotal").textContent = data.stats.total;
  $("cPending").textContent = data.stats.pending;
  $("cCompletion").textContent = data.stats.completion + "%";
  $("cAvg").textContent = data.stats.avg + "%";

  if(data.me){
    $("whoName").textContent = data.me.name || "Administrator";
    $("whoId").textContent = data.me.emp_id || "ADMIN";
    const init = (data.me.name || "AD").trim().slice(0,2).toUpperCase();
    $("whoPic").textContent = init;
    if(data.me.last_login){
      $("whoLast").textContent = " · last login " + fmtWhen(data.me.last_login);
    }
  }

  EMPLOYEES = data.employees || [];
  // Always clear any leftover/auto-filled search text on reload, so the full
  // employee list is shown (a stray value here would hide most rows).
  var _sb = $("searchBox");
  if(_sb && _sb.value){ _sb.value = ""; }
  renderTable();
}

/* ============ COMMAND CENTER (admin home overview) ============ */
async function loadCommandCenter(){
  var root = $("dashRoot");
  if(!root) return;
  var r = await api("/api/admin/command-center");
  if(!r || !r.ok){ root.innerHTML = '<div class="empty" style="padding:16px">Could not load the overview.</div>'; return; }
  var d = r.data || {};
  function col(v){ v=Number(v); return (v>=70?'#1d9e75':(v>=40?'#c9a227':'#e24b4a')); }
  // a big stat tile
  function tile(icon, val, label, sub, valcol){
    return '<div style="flex:1;min-width:150px;background:#fff;border:1px solid var(--mg-line);border-radius:12px;padding:14px 16px">'+
      '<div style="font-size:12px;color:#8a97a1;font-weight:600;text-transform:uppercase;letter-spacing:.3px">'+icon+' '+label+'</div>'+
      '<div style="font-size:30px;font-weight:800;line-height:1.1;margin-top:4px;color:'+(valcol||'#12284B')+'">'+val+'</div>'+
      (sub?('<div style="font-size:12px;color:#62707a;margin-top:2px">'+sub+'</div>'):'')+'</div>';
  }
  function group(title, tiles){
    return '<div style="margin-bottom:14px"><div style="font-size:13px;font-weight:700;color:#12284B;margin:0 0 8px">'+title+'</div>'+
      '<div style="display:flex;gap:10px;flex-wrap:wrap">'+tiles+'</div></div>';
  }

  var html = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">'+
    '<h2 style="margin:0;font-size:20px;color:#12284B">🧭 Command Center</h2>'+
    '<span style="font-size:12.5px;color:#8a97a1">· the whole L&amp;D picture at a glance</span>'+
    '<button onclick="loadCommandCenter()" style="margin-left:auto;background:#fff;border:1px solid var(--mg-line);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer">↻ Refresh</button>'+
    '</div>';

  html += group('👥 People & Training',
    tile('👥', d.learners||0, 'Learners', (d.learners_started||0)+' started training') +
    tile('📚', (d.module_completion_pct||0)+'%', 'Module completion', (d.total_completions||0)+' modules done', col(d.module_completion_pct)) +
    tile('🎓', d.live_modules||0, 'Live modules', 'in the catalogue') +
    tile('👤', (d.active_trainers||0)+'/'+(d.trainers_total||0), 'Active trainers', 'delivered training')
  );

  html += group('📝 Assessments',
    tile('✅', (d.pass_rate||0)+'%', 'Pass rate', (d.assess_passes||0)+' of '+(d.assess_attempts||0)+' attempts', col(d.pass_rate)) +
    tile('📊', (d.avg_assessment||0)+'%', 'Average score', 'across all attempts', col(d.avg_assessment)) +
    tile('🏅', d.passed_learners||0, 'Learners passed', 'at least one assessment') +
    tile('⭐', (d.avg_trainer_rating!=null?d.avg_trainer_rating:'—'), 'Avg trainer rating', 'from learners')
  );

  html += group('🧭 OJT (on-the-job)',
    tile('🏃', d.ojt_active||0, 'In OJT now', 'active trainees') +
    tile('📈', (d.ojt_avg!=null?d.ojt_avg+'%':'—'), 'Avg OJT score', 'active trainees', col(d.ojt_avg)) +
    tile('🏁', d.ojt_completed||0, 'OJT completed', 'finished the 30 days')
  );

  html += group('🎓 Trainer Credit & Certificates',
    tile('📒', d.confirmed_deliveries||0, 'Confirmed credits', 'all time') +
    tile('⏳', (d.pending_approvals||0)+(d.provisional?(' + '+d.provisional):''), 'Pending / provisional', (d.open_disputes?(d.open_disputes+' disputes open'):'approvals + auto-confirming'), (d.pending_approvals||d.open_disputes)?'#c9a227':'#1d9e75') +
    tile('📜', d.cert_total||0, 'Certificates issued', (d.cert_valid||0)+' valid') +
    tile('⚠', (d.cert_expiring||0)+(d.cert_expired?(' / '+d.cert_expired):''), 'Expiring / expired', 'need re-certification', (d.cert_expiring||d.cert_expired)?'#e24b4a':'#1d9e75')
  );

  // placeholder for the "needs attention" nudges panel (filled async below)
  html += '<div id="ccNudges"></div>';

  // quick jump + report buttons
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">'+
    '<button onclick="window.location.href=\'/api/admin/leadership-summary.xlsx\'" style="background:#1d9e75;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:600;cursor:pointer">📥 Leadership summary (Excel)</button>'+
    '<button onclick="switchTab(\'appr\')" style="background:#12284B;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;cursor:pointer">Review approvals →</button>'+
    '<button onclick="switchTab(\'tc\')" style="background:#fff;border:1px solid var(--mg-line);border-radius:8px;padding:8px 14px;font-size:12.5px;cursor:pointer">Trainer Credit →</button>'+
    '<button onclick="switchTab(\'ojt\')" style="background:#fff;border:1px solid var(--mg-line);border-radius:8px;padding:8px 14px;font-size:12.5px;cursor:pointer">OJT →</button>'+
    '<button onclick="switchTab(\'crt\')" style="background:#fff;border:1px solid var(--mg-line);border-radius:8px;padding:8px 14px;font-size:12.5px;cursor:pointer">Certificates →</button>'+
    '</div>';

  root.innerHTML = html;
  if(typeof refreshHealthBadge === 'function') refreshHealthBadge();
  loadCcNudges();
}

// "Needs attention" nudges panel on the Command Center
async function loadCcNudges(){
  var box = document.getElementById("ccNudges");
  if(!box) return;
  var r = await api("/api/admin/nudges");
  if(!r || !r.ok){ box.innerHTML = ""; return; }
  var unc = r.unconfirmed_learners || [], idle = r.idle_trainers || [];
  if(!unc.length && !idle.length){
    box.innerHTML = '<div style="background:#eafaf2;border:1px solid #c4e8d5;border-radius:12px;padding:12px 14px;margin:4px 0 12px;font-size:13px;color:#0f6b45">✅ Nothing needs a nudge right now — trainers active and learners up to date.</div>';
    return;
  }
  var html = '<div style="background:#fff7e6;border:1px solid #e9cf8f;border-radius:12px;padding:14px 16px;margin:4px 0 12px">'+
    '<div style="font-size:14px;font-weight:700;color:#8a6d1a;margin-bottom:8px">🔔 Needs attention</div>'+
    '<div style="display:flex;gap:16px;flex-wrap:wrap">';
  if(unc.length){
    html += '<div style="flex:1;min-width:240px">'+
      '<div style="font-size:12.5px;font-weight:600;color:#8a6d1a;margin-bottom:4px">Learners who haven\'t confirmed their trainer ('+ (r.unconfirmed_total||unc.length) +' modules)</div>'+
      unc.slice(0,8).map(function(x){ return '<div style="font-size:12.5px;padding:3px 0;border-bottom:1px solid #f0e6cf">'+escapeHtml(x.name)+' <span style="color:#9aa6ae">· '+x.count+' module'+(x.count===1?'':'s')+'</span></div>'; }).join("")+
      (unc.length>8?('<div style="font-size:11.5px;color:#9aa6ae;margin-top:4px">+ '+(unc.length-8)+' more…</div>'):'')+'</div>';
  }
  if(idle.length){
    html += '<div style="flex:1;min-width:220px">'+
      '<div style="font-size:12.5px;font-weight:600;color:#8a6d1a;margin-bottom:4px">Trainers with no activity this week ('+idle.length+')</div>'+
      idle.slice(0,8).map(function(x){ return '<div style="font-size:12.5px;padding:3px 0;border-bottom:1px solid #f0e6cf">'+escapeHtml(x.name)+'</div>'; }).join("")+
      (idle.length>8?('<div style="font-size:11.5px;color:#9aa6ae;margin-top:4px">+ '+(idle.length-8)+' more…</div>'):'')+'</div>';
  }
  html += '</div><div style="font-size:11.5px;color:#8a97a1;margin-top:8px">Learners can confirm their trainer from their Home page ("Who trained you?"). Idle trainers may just not have logged yet.</div></div>';
  box.innerHTML = html;
}

/* ============ SYSTEM HEALTH (errors + sanity checks) ============ */
async function loadSystemHealth(){
  var root = $("healthRoot");
  if(!root) return;
  var r = await api("/api/admin/system-health");
  if(!r || !r.ok){ root.innerHTML = '<div class="empty" style="padding:16px">Could not load system health.</div>'; return; }
  var errs = r.errors || [], checks = r.checks || [];

  var checkRows = checks.map(function(c){
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f2f4">'+
      '<span style="font-size:18px">'+(c.ok?'✅':'⚠️')+'</span>'+
      '<div><b style="font-size:13px;color:'+(c.ok?'#0f6b45':'#9e2b2b')+'">'+escapeHtml(c.label)+'</b>'+
      '<div style="font-size:12px;color:#62707a">'+escapeHtml(c.detail||'')+'</div></div></div>';
  }).join("");
  var checksCard = '<div style="background:#fff;border:1px solid var(--mg-line);border-radius:12px;padding:14px 16px;margin-bottom:14px">'+
    '<div style="font-size:14px;font-weight:700;color:#12284B;margin-bottom:4px">🩺 System checks</div>'+
    (checkRows || '<div class="empty">No checks.</div>')+'</div>';

  var errHead = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">'+
    '<div style="font-size:14px;font-weight:700;color:#12284B">🐞 Recent backend errors ('+errs.length+')</div>'+
    '<div style="margin-left:auto;display:flex;gap:8px">'+
      '<button onclick="clearSystemErrors(\'seen\')" style="background:#fff;border:1px solid var(--mg-line);border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer">Mark all seen</button>'+
      '<button onclick="clearSystemErrors(\'clear\')" style="background:#fff;border:1px solid #f0c0c0;color:#9e2b2b;border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer">Clear all</button>'+
    '</div></div>';
  var errBody;
  if(!errs.length){
    errBody = '<div class="empty" style="padding:16px;color:#0f6b45">No backend errors recorded. 👍 (Errors are logged here automatically as they happen.)</div>';
  } else {
    errBody = errs.map(function(e){
      var when = e.created_at ? fmtWhen(e.created_at) : '';
      return '<div style="background:#fff;border:1px solid var(--mg-line);border-left:3px solid #e24b4a;border-radius:10px;padding:10px 12px;margin-bottom:8px'+((e.seen?'':';box-shadow:0 0 0 2px #fdecec'))+'">'+
        '<div style="font-size:13px;color:#9e2b2b;font-weight:600;word-break:break-word">'+escapeHtml(e.error||'')+'</div>'+
        '<div style="font-size:12px;color:#62707a;margin-top:3px">'+escapeHtml(e.method||'')+' <b>'+escapeHtml(e.path||'')+'</b>'+(e.where_at?(' · '+escapeHtml(e.where_at)):'')+'</div>'+
        '<div style="font-size:11px;color:#9aa6ae;margin-top:2px">'+(e.emp_id?('user '+escapeHtml(e.emp_id)+' · '):'')+escapeHtml(when)+(e.seen?'':' · <span style="color:#e24b4a;font-weight:600">NEW</span>')+'</div>'+
        '</div>';
    }).join("");
  }

  root.innerHTML = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">'+
    '<h2 style="margin:0;font-size:20px;color:#12284B">🩺 System Health</h2>'+
    '<span style="font-size:12.5px;color:#8a97a1">· backend errors &amp; data sanity checks</span>'+
    '<button onclick="loadSystemHealth()" style="margin-left:auto;background:#fff;border:1px solid var(--mg-line);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer">↻ Refresh</button>'+
    '</div>'+checksCard+errHead+errBody;
  refreshHealthBadge();
}
async function clearSystemErrors(action){
  if(action==='clear' && !confirm('Delete all recorded errors? (They will start logging again from new errors.)')) return;
  await api("/api/admin/system-errors-clear", {method:"POST", body:JSON.stringify({action:action})});
  loadSystemHealth();
}
async function refreshHealthBadge(){
  try{
    var r = await api("/api/admin/system-health");
    var b = document.getElementById("healthBadge");
    if(!b) return;
    var n = (r && r.ok) ? (r.unseen||0) : 0;
    if(n>0){ b.textContent = n; b.style.display=""; } else { b.style.display="none"; }
  }catch(e){}
}

// name lookup for showing a manager's name from their emp_id
function nameOf(empId){
  if(!empId) return "";
  const m = EMPLOYEES.find(x=>x.emp_id===empId);
  return m ? (m.name || empId) : empId;
}

// keep the "manager" filter dropdown in sync with who is actually a manager
function buildManagerFilter(){
  const sel = $("empManagerFilter");
  if(!sel) return;
  const prev = sel.value;
  // managers = anyone who is listed as someone's reports_to
  const mgrIds = {};
  EMPLOYEES.forEach(e=>{ if(e.reports_to) mgrIds[e.reports_to] = true; });
  const mgrs = Object.keys(mgrIds)
    .map(id=>({ id, name: nameOf(id) }))
    .sort((a,b)=> (a.name||"").localeCompare(b.name||""));
  let html = '<option value="">All managers</option><option value="__none__">⚠ No manager set</option>';
  mgrs.forEach(m=>{ html += `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`; });
  sel.innerHTML = html;
  // restore previous choice if still valid
  if(prev && (prev === "__none__" || mgrIds[prev])) sel.value = prev;
}

function renderTable(){
  const q = ($("searchBox").value || "").toLowerCase().trim();
  const statusFilter = ($("empStatusFilter") && $("empStatusFilter").value) || "active";
  const mgrFilter = ($("empManagerFilter") && $("empManagerFilter").value) || "";
  const body = $("empBody");
  buildManagerFilter();
  const list = EMPLOYEES.filter(e=>{
    // status filter:
    //   active    = everyone except resigned & removed
    //   resigned  = only resigned
    //   removed   = only soft-deleted
    //   untrained = active staff who are NOT activated (training pending)
    //   all       = everyone
    const eActivated = String(e.activated) === "1" || e.activated === 1 || e.activated === true;
    if(statusFilter === "active" && (e.status === "resigned" || e.status === "deleted")) return false;
    if(statusFilter === "resigned" && e.status !== "resigned") return false;
    if(statusFilter === "removed" && e.status !== "deleted") return false;
    if(statusFilter === "untrained" && !(e.status === "approved" && e.role !== "admin" && !eActivated)) return false;
    // manager filter
    if(mgrFilter === "__none__" && (e.reports_to || "")) return false;
    if(mgrFilter && mgrFilter !== "__none__" && (e.reports_to || "") !== mgrFilter) return false;
    if(!q) return true;
    return (e.name||"").toLowerCase().includes(q)
        || (e.emp_id||"").toLowerCase().includes(q)
        || (e.designation||"").toLowerCase().includes(q);
  });

  if(list.length === 0){
    body.innerHTML = '<tr><td colspan="9" class="empty">No employees found.</td></tr>';
    return;
  }

  body.innerHTML = list.map(e=>{
    const [rl, rc] = roleLabel(e.role);
    const isAdmin = e.role === "admin";
    let statusPill = e.status === "approved"
      ? '<span class="pill p-approved">Approved</span>'
      : (e.status === "resigned"
          ? '<span class="pill" style="background:#f3e0e0;color:#a33">Resigned</span>'
          : (e.status === "deleted"
              ? '<span class="pill" style="background:#e9edf1;color:#687079">Removed</span>'
              : '<span class="pill p-pending">Pending</span>'));
    // activation tag — only for active, non-admin staff
    const isActivated = String(e.activated) === "1" || e.activated === 1 || e.activated === true;
    if(!isAdmin && e.status === "approved"){
      statusPill += isActivated
        ? ' <span class="pill" style="background:#e1f5ee;color:#0a7d4f" title="Training complete — full access">✓ Trained</span>'
        : ' <span class="pill" style="background:#fdecea;color:#b4231d" title="Training not complete — field tabs locked">⏳ Not trained</span>';
    }

    // "Reports to" cell: manager name + region tag, or a subtle flag if unset.
    // Admins/resigned people don't need a manager, so no flag for them.
    const regionTag = e.region
      ? ` <span style="display:inline-block;background:#eef5fc;color:#0c447c;border:1px solid #cddff0;border-radius:10px;padding:0 6px;font-size:10.5px;margin-left:3px">${escapeHtml(e.region)}</span>`
      : "";
    let reportsCell;
    if(e.reports_to){
      reportsCell = `<span style="font-size:12.5px">${escapeHtml(nameOf(e.reports_to))}</span>${regionTag}`;
    } else if(isAdmin || e.status === "resigned"){
      reportsCell = `<span style="color:#c3c8ce;font-size:12px">—</span>${regionTag}`;
    } else {
      reportsCell = `<span style="color:#c98a00;font-size:11.5px;font-weight:600">⚠ not set</span>${regionTag}`;
    }

    // small labelled action button; variant = "" | "ok" | "warn" | "del" | "muted"
    const nm = escapeHtml((e.name||'').replace(/'/g,"\\'"));
    const ab = (variant, icon, label, onclick, title) =>
      `<button class="abtn${variant?' b-'+variant:''}" title="${title||label}" onclick="${onclick}"><span aria-hidden="true">${icon}</span><span class="lbl">${label}</span></button>`;
    const muted = (txt) => `<span class="abtn b-muted"><span class="lbl">${txt}</span></span>`;

    let actions = "";
    if(window.IS_ADMIN === false){
      // instructors: can REQUEST a delete or a resignation (both go for admin approval)
      if(e.status === "pending" || e.role === "admin"){
        actions = muted("View only");
      } else if(e.status === "resigned"){
        actions = muted("Resigned");
      } else if(e.status === "deleted"){
        actions = muted("Removed");
      } else {
        actions =
          (isActivated ? "" : ab("ok", "✅", "Activate", `activateEmp('${e.emp_id}','${nm}',1)`, "Request activation (needs admin approval)"))+
          ab("", "✎", "Edit", `openEdit('${e.emp_id}')`, "Edit (needs admin approval)")+
          ab("warn", "🚪", "Resign", `resignEmp('${e.emp_id}','${nm}')`, "Request resignation (needs admin approval)")+
          ab("del", "🗑", "Remove", `del('${e.emp_id}')`, "Request remove (needs admin approval)");
      }
    } else if(e.status === "pending"){
      actions =
        ab("ok", "✔", "Approve", `approve('${e.emp_id}')`)+
        ab("del", "✖", "Reject", `reject('${e.emp_id}')`);
    } else if(e.status === "deleted"){
      // REMOVED (soft-deleted): restore, convert to resigned, edit, permanent delete
      actions =
        ab("ok", "↩", "Restore", `restoreEmp('${e.emp_id}')`, "Restore to active")+
        ab("warn", "🚪", "Resign", `resignNow('${e.emp_id}','${nm}')`, "Mark as resigned instead")+
        ab("", "✎", "Edit", `openEdit('${e.emp_id}')`)+
        ab("del", "🗑", "Delete", `purgeEmp('${e.emp_id}','${nm}')`, "Delete permanently (cannot be undone)");
    } else if(e.status === "resigned"){
      actions =
        ab("ok", "♻", "Reactivate", `reactivateEmp('${e.emp_id}')`, "Reactivate (allow login again)")+
        ab("", "✎", "Edit", `openEdit('${e.emp_id}')`)+
        (isAdmin ? "" : ab("del", "🗑", "Remove", `del('${e.emp_id}')`));
    } else {
      // activate/deactivate button (admin only, non-admin staff)
      let actBtn = "";
      if(!isAdmin){
        actBtn = isActivated
          ? ab("warn", "⏻", "Deactivate", `activateEmp('${e.emp_id}','${nm}',0)`, "Lock field tabs again (training not complete)")
          : ab("ok", "✅", "Activate", `activateEmp('${e.emp_id}','${nm}',1)`, "Mark training complete — unlock field tabs");
      }
      actions =
        actBtn +
        ab("", "✎", "Edit", `openEdit('${e.emp_id}')`)+
        ab("", "⟳", "Reset", `openReset('${e.emp_id}')`, "Reset password")+
        (isAdmin ? "" : ab("warn", "🚪", "Resign", `resignEmp('${e.emp_id}','${nm}')`, "Mark as resigned (block login, keep history)"))+
        (isAdmin ? "" : ab("del", "🗑", "Remove", `del('${e.emp_id}')`));
    }
    actions = `<div class="act-row">${actions}</div>`;

    return `<tr>
      <td>${escapeHtml(e.name||"")}</td>
      <td>${escapeHtml(e.emp_id||"")}</td>
      <td>${escapeHtml(e.designation||"")}</td>
      <td>${reportsCell}</td>
      <td>${escapeHtml(e.phone||"")}</td>
      <td><span class="pill ${rc}">${rl}</span></td>
      <td>${statusPill}</td>
      <td style="white-space:nowrap;color:var(--mg-muted);font-size:12px">${fmtDate(e.created_at)}</td>
      <td class="actions-cell">${actions}</td>
    </tr>`;
  }).join("");
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ---- approve / reject ---- */
async function approve(emp_id){
  const r = await api("/api/approve", { emp_id });
  if(r.ok){ toast("Approved."); loadDashboard(); } else toast(r.msg||"Failed.");
}
async function reject(emp_id){
  if(!confirm("Reject and remove this signup request?")) return;
  const r = await api("/api/reject", { emp_id });
  if(r.ok){ toast("Removed."); loadDashboard(); } else toast(r.msg||"Failed.");
}

async function resignEmp(emp_id, name){
  const isReq = (window.IS_ADMIN === false);
  const msg = isReq
    ? "Send a request to mark " + (name||"this employee") + " as resigned?\n\nAn admin will need to approve it. Their training history and certificates are kept."
    : "Mark " + (name||"this employee") + " as resigned?\n\nThey will no longer be able to log in, but all their training history and certificates are kept. You can reactivate them later if they rejoin.";
  if(!confirm(msg)) return;
  const r = await api("/api/admin/set-employment-status", { emp_id, action: "resign" });
  if(r.ok){ toast(r.msg||"Done."); loadDashboard(); } else toast(r.msg||"Failed.");
}
async function reactivateEmp(emp_id){
  if(!confirm("Reactivate this employee so they can log in again?")) return;
  const r = await api("/api/admin/set-employment-status", { emp_id, action: "reactivate" });
  if(r.ok){ toast(r.msg||"Reactivated."); loadDashboard(); } else toast(r.msg||"Failed.");
}

/* ---- edit ---- */
let MANAGERS = [];   // cached list of possible managers for the "Reports to" dropdown

async function loadManagers(){
  try{
    const d = await api("/api/team/managers");
    MANAGERS = (d && d.ok && d.managers) ? d.managers : [];
  }catch(e){ MANAGERS = []; }
}

function fillManagerDropdown(selfEmpId, selectedEmpId){
  const sel = $("eReportsTo");
  if(!sel) return;
  // "None" + every approved person except the person being edited (can't report to self)
  let html = '<option value="">— None —</option>';
  MANAGERS.filter(m => m.emp_id !== selfEmpId).forEach(m=>{
    const label = (m.name || m.emp_id) + (m.designation ? " · " + m.designation : "");
    const selAttr = (m.emp_id === selectedEmpId) ? " selected" : "";
    html += `<option value="${escapeHtml(m.emp_id)}"${selAttr}>${escapeHtml(label)}</option>`;
  });
  sel.innerHTML = html;
}

// Fill the "Reports to" dropdown on the Add-user form (Settings tab).
async function fillAddUserManagers(){
  const sel = $("quReportsTo");
  if(!sel) return;
  if(!MANAGERS.length) await loadManagers();
  let html = '<option value="">— None —</option>';
  MANAGERS.forEach(m=>{
    const label = (m.name || m.emp_id) + (m.designation ? " · " + m.designation : "");
    html += `<option value="${escapeHtml(m.emp_id)}">${escapeHtml(label)}</option>`;
  });
  sel.innerHTML = html;
}

async function openEdit(emp_id){
  const e = EMPLOYEES.find(x=>x.emp_id===emp_id);
  if(!e) return;
  CURRENT_EDIT = emp_id;
  $("editSub").textContent = e.name + " · " + e.emp_id;
  $("eName").value = e.name || "";
  $("ePhone").value = e.phone || "";
  $("eDesg").value = e.designation || "";
  $("eRole").value = e.role || "staff";
  // reporting fields
  if(!MANAGERS.length) await loadManagers();
  fillManagerDropdown(emp_id, e.reports_to || "");
  if($("eRegion")) $("eRegion").value = e.region || "";
  // instructors: show a note that changes go for admin approval
  var note = $("editApprovalNote");
  if(note) note.style.display = (window.IS_ADMIN === false) ? "block" : "none";
  openModal("editOv");
}
async function saveEdit(){
  if(!CURRENT_EDIT) return;
  const r = await api("/api/admin/update-user", {
    emp_id: CURRENT_EDIT,
    name: $("eName").value.trim(),
    phone: $("ePhone").value.trim(),
    designation: $("eDesg").value.trim(),
    role: $("eRole").value,
    reports_to: ($("eReportsTo") ? $("eReportsTo").value : ""),
    region: ($("eRegion") ? $("eRegion").value : "")
  });
  if(r.ok){
    closeModal("editOv");
    toast(r.applied === false ? "Sent to admin for approval." : "Saved.");
    loadDashboard();
  } else toast(r.msg || "Could not save.");
}

/* ---- reset password ---- */
function openReset(emp_id){
  const e = EMPLOYEES.find(x=>x.emp_id===emp_id);
  if(!e) return;
  CURRENT_RESET = emp_id;
  $("resetSub").textContent = e.name + " · " + e.emp_id;
  $("rPw").value = "Golisoda@123";
  openModal("resetOv");
}
async function saveReset(){
  if(!CURRENT_RESET) return;
  const pw = $("rPw").value;
  const r = await api("/api/admin/reset-password", { emp_id: CURRENT_RESET, new_password: pw });
  if(r.ok){ closeModal("resetOv"); toast("Password reset. Share: " + pw); }
  else toast(r.msg || "Could not reset.");
}

/* ---- delete ---- */
// ---- Pending action requests (instructor delete requests) — admin only ----
async function loadPendingRequests(){
  if(window.IS_ADMIN === false) return;  // only admins see these
  const panel = document.getElementById("pendingReqPanel");
  const list = document.getElementById("pendingReqList");
  if(!panel || !list) return;
  let d;
  try { d = await api("/api/admin/pending-actions"); } catch(e){ return; }
  if(!d || !d.ok || !d.actions || d.actions.length === 0){
    panel.style.display = "none";
    return;
  }
  const typeLabel = { user:"Employee", assessment:"Assessment", module:"Module", video:"Video" };
  list.innerHTML = d.actions.map(a=>{
    // headline + approve-button label depend on the kind of request
    let headline, approveLabel;
    if(a.action_type === "user_edit"){
      headline = "<b>Employee edit:</b> " + escH(a.target_label||a.target_id);
      approveLabel = "Approve edit";
    } else if(a.action_type === "assign_manager"){
      headline = "<b>Reporting change:</b> " + escH(a.target_label||a.target_id);
      approveLabel = "Approve change";
    } else if(a.action_type === "resign"){
      headline = "<b>Resignation:</b> " + escH(a.target_label||a.target_id);
      approveLabel = "Approve resignation";
    } else if(a.action_type === "activate"){
      headline = "<b>Activation:</b> " + escH(a.target_label||a.target_id);
      approveLabel = "Approve activation";
    } else if(a.action_type === "question_replace"){
      let mode = "add", cnt = "";
      try{ const p = JSON.parse(a.payload||"{}"); mode = p.mode||"add"; cnt = p.count||""; }catch(e){}
      const verb = mode==="clear" ? ("Clear all "+cnt+" questions in")
                 : mode==="replace" ? ("Replace ALL questions ("+cnt+" new) in")
                 : ("Add "+cnt+" questions to");
      headline = "<b>Question change:</b> " + verb + " " + escH(a.target_label||a.target_id);
      approveLabel = "Approve change";
    } else if(a.action_type === "question_edit"){
      let op = "change", qp = "";
      try{ const p = JSON.parse(a.payload||"{}"); op = p.op||"change"; qp = p.question||""; }catch(e){}
      const verb = op==="delete" ? "Delete a question in"
                 : op==="update" ? "Edit a question in"
                 : "Add a question to";
      headline = "<b>Question edit:</b> " + verb + " " + escH(a.target_label||a.target_id) +
                 (qp ? '<div style="font-size:11.5px;color:#64707a;margin-top:2px">“'+escH(qp.slice(0,90))+(qp.length>90?'…':'')+'”</div>' : '');
      approveLabel = "Approve edit";
    } else {
      headline = "<b>Delete " + (typeLabel[a.target_type]||a.target_type) + ":</b> " + escH(a.target_label||a.target_id);
      approveLabel = "Approve delete";
    }
    const previewBtn = (a.action_type === "question_replace" || a.action_type === "question_edit")
      ? `<button class="btn" style="padding:4px 12px;font-size:12px" onclick="previewQuestions(${a.id})">Preview</button>`
      : "";
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #e7dcc0;flex-wrap:wrap">
      <div style="font-size:13px">
        ${headline}
        <div style="font-size:11.5px;color:#8a6d1a">requested by ${escH(a.requested_by_name||a.requested_by||"")}</div>
      </div>
      <div style="display:flex;gap:6px">
        ${previewBtn}
        <button class="btn" style="padding:4px 12px;font-size:12px;color:#1d9e75" onclick="resolveAction(${a.id},'approve')">${approveLabel}</button>
        <button class="btn" style="padding:4px 12px;font-size:12px;color:#8a97a1" onclick="resolveAction(${a.id},'reject')">Reject</button>
      </div>
    </div>`;
  }).join("");
  panel.style.display = "block";
}

async function resolveAction(id, decision){
  if(decision === "approve" && !confirm("Approve this request?")) return;
  const r = await api("/api/admin/resolve-action", { id, decision });
  if(r.ok){ toast(r.msg || "Done."); loadDashboard(); }
  else toast(r.msg || "Failed.");
}

// Preview the questions in a pending question-replace request
async function previewQuestions(id){
  let d;
  try{ d = await (await fetch("/api/admin/pending-questions-preview?id="+id,{cache:"no-store"})).json(); }
  catch(e){ toast("Could not load preview."); return; }
  if(!d || !d.ok){ toast((d&&d.msg)||"Could not load."); return; }
  let ov = document.getElementById("qPrevOv");
  if(!ov){
    ov = document.createElement("div");
    ov.id = "qPrevOv";
    ov.style = "position:fixed;inset:0;background:rgba(8,30,40,.5);display:flex;align-items:flex-start;justify-content:center;padding:20px;z-index:90;overflow-y:auto";
    document.body.appendChild(ov);
  }
  const isEdit = (d.mode||"").indexOf("edit_")===0;
  let head;
  if(isEdit){
    const opTxt = d.op==="delete" ? "Delete a question from"
               : d.op==="update" ? "Edit a question in"
               : "Add a question to";
    head = opTxt + " " + escapeHtml(d.assessment||"");
  } else {
    head = d.mode==="clear"
      ? ("Clear all questions in " + escapeHtml(d.assessment||""))
      : ("Preview " + d.count + " questions for " + escapeHtml(d.assessment||"") + (d.mode==="replace"?" (replaces all existing)":" (added to existing)"));
  }
  let rows = "";
  if(isEdit && d.op==="delete"){
    rows = '<div style="border:1px solid #f0c9c9;border-radius:8px;padding:12px;background:#fffafa">'+
      '<div style="font-size:12px;color:#b4231d;font-weight:600;margin-bottom:4px">This question will be removed:</div>'+
      '<div style="font-size:13px">'+escapeHtml(d.delete_question||"(question text unavailable)")+'</div></div>';
  } else if(d.mode==="clear"){
    rows = '<div style="padding:16px;color:var(--mg-muted)">This request only clears the existing questions — no new questions. The assessment and all pass records are kept.</div>';
  } else if(!d.items.length){
    rows = '<div style="padding:16px;color:var(--mg-muted)">No valid questions found in the request.</div>';
  } else {
    rows = d.items.map(function(q,i){
      return '<div style="border:1px solid var(--mg-line);border-radius:8px;padding:10px;margin-bottom:8px;background:#fafdff">'+
        '<div style="font-size:13px"><b>Q'+(i+1)+'.</b> '+escapeHtml(q.question)+'</div>'+
        '<div style="font-size:12px;color:var(--mg-muted);margin-top:4px">A) '+escapeHtml(q.a)+' &nbsp; B) '+escapeHtml(q.b)+
        (q.c?' &nbsp; C) '+escapeHtml(q.c):'')+(q.d?' &nbsp; D) '+escapeHtml(q.d):'')+
        ' &nbsp; · <b style="color:#1d9e75">Ans: '+escapeHtml(q.correct)+'</b></div></div>';
    }).join("");
  }
  ov.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:680px;width:100%;padding:20px;max-height:88vh;overflow-y:auto;box-shadow:0 18px 50px rgba(0,0,0,.25)">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0;font-size:15px">'+head+'</h3>'+
    '<button class="btn" onclick="document.getElementById(\'qPrevOv\').remove()">Close</button></div>'+
    rows + '</div>';
}

function escH(s){ return String(s==null?"":s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function del(emp_id){
  const e = EMPLOYEES.find(x=>x.emp_id===emp_id);
  const who = e?e.name:emp_id;
  const msg = window.IS_ADMIN
    ? "Remove " + who + "?\n\nThey will be hidden and blocked from login, but ALL their history is kept. You can restore them anytime from the 'Removed' list."
    : "Send a request to remove " + who + "? An admin must approve before they are removed.";
  if(!confirm(msg)) return;
  const r = await api("/api/admin/delete-user", { emp_id });
  if(r.ok){ toast(r.msg || (window.IS_ADMIN?"Removed.":"Request sent.")); loadDashboard(); } else toast(r.msg||"Failed.");
}

// Activate (training complete) or deactivate an employee
async function activateEmp(emp_id, name, want){
  const who = name || emp_id;
  const on = (want === 1 || want === true || want === undefined);
  let msg;
  if(window.IS_ADMIN === false){
    msg = "Send a request to activate " + who + "?\n\nAn admin will approve it. Once activated, their field tabs (OJT, Route Audit, Certificates) unlock.";
  } else if(on){
    msg = "Activate " + who + "?\n\nThis marks their training complete and unlocks their field tabs (OJT, Route Audit, Certificates).";
  } else {
    msg = "Deactivate " + who + "?\n\nTheir field tabs will be locked again until re-activated. (Login and online training stay available.)";
  }
  if(!confirm(msg)) return;
  const r = await api("/api/admin/activate-user", { emp_id, activated: on });
  if(r.ok){ toast(r.msg || (r.applied === false ? "Request sent." : "Done.")); loadDashboard(); }
  else toast(r.msg || "Failed.");
}

// Restore a removed/resigned employee back to active
async function restoreEmp(emp_id){
  const e = EMPLOYEES.find(x=>x.emp_id===emp_id);
  const who = e?e.name:emp_id;
  if(!confirm("Restore " + who + " to active?\n\nThey will be able to log in again and will reappear in the active list.")) return;
  const r = await api("/api/admin/restore-user", { emp_id });
  if(r.ok){ toast(r.msg||"Restored."); loadDashboard(); } else toast(r.msg||"Failed.");
}

// Convert a removed employee into a proper resignation
async function resignNow(emp_id, name){
  if(!confirm("Mark " + (name||"this employee") + " as resigned?\n\nTheir history is kept; they stay blocked from login. This is the right choice if they actually left the company.")) return;
  const r = await api("/api/admin/resign-user", { emp_id });
  if(r.ok){ toast(r.msg||"Marked as resigned."); loadDashboard(); } else toast(r.msg||"Failed.");
}

// Permanently delete — admin only, last resort, double confirm
async function purgeEmp(emp_id, name){
  const who = name||emp_id;
  if(!confirm("⚠ PERMANENTLY delete " + who + "?\n\nThis CANNOT be undone. Their account and scores will be erased for good.\n\nUse 'Restore' or 'Mark resigned' instead if you might need them later.")) return;
  const typed = prompt("To confirm permanent deletion, type the Employee ID exactly:\n\n" + emp_id);
  if(typed !== emp_id){ toast("Confirmation did not match — nothing deleted."); return; }
  const r = await api("/api/admin/purge-user", { emp_id, confirm: emp_id });
  if(r.ok){ toast(r.msg||"Permanently deleted."); loadDashboard(); } else toast(r.msg||"Failed.");
}

/* ---- bulk add ---- */
function openBulk(){ openModal("bulkOv"); }
async function saveBulk(){
  const csv = $("bulkText").value;
  const auto = $("bulkApprove").checked;
  if(!csv.trim()){ toast("Paste some CSV rows first."); return; }
  const r = await api("/api/admin/bulk-add", { csv, auto_approve: auto });
  if(r.ok){
    closeModal("bulkOv");
    let m = r.msg;
    if(r.errors && r.errors.length) m += " (" + r.errors.length + " row error(s))";
    toast(m);
    loadDashboard();
  } else toast(r.msg || "Could not add.");
}

/* ---- modal + signout helpers ---- */
function openModal(id){ $(id).classList.add("show"); }
function closeModal(id){ $(id).classList.remove("show"); }
async function signOut(){
  await api("/api/logout", {});
  window.location.href = "/";
}

/* close modal on backdrop click */
document.addEventListener("click", (ev)=>{
  if(ev.target.classList && ev.target.classList.contains("ov")){
    ev.target.classList.remove("show");
  }
});

/* boot */
clock();
setInterval(clock, 30000);
loadDashboard();