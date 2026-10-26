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
    } else {
      headline = "<b>Delete " + (typeLabel[a.target_type]||a.target_type) + ":</b> " + escH(a.target_label||a.target_id);
      approveLabel = "Approve delete";
    }
    const previewBtn = (a.action_type === "question_replace")
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
  const head = d.mode==="clear"
    ? ("Clear all questions in " + escapeHtml(d.assessment||""))
    : ("Preview " + d.count + " questions for " + escapeHtml(d.assessment||"") + (d.mode==="replace"?" (replaces all existing)":" (added to existing)"));
  let rows = "";
  if(d.mode==="clear"){
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