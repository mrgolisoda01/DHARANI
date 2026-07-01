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
  renderTable();
}

function renderTable(){
  const q = ($("searchBox").value || "").toLowerCase().trim();
  const body = $("empBody");
  const list = EMPLOYEES.filter(e=>{
    if(!q) return true;
    return (e.name||"").toLowerCase().includes(q)
        || (e.emp_id||"").toLowerCase().includes(q)
        || (e.designation||"").toLowerCase().includes(q);
  });

  if(list.length === 0){
    body.innerHTML = '<tr><td colspan="7" class="empty">No employees found.</td></tr>';
    return;
  }

  body.innerHTML = list.map(e=>{
    const [rl, rc] = roleLabel(e.role);
    const isAdmin = e.role === "admin";
    const statusPill = e.status === "approved"
      ? '<span class="pill p-approved">Approved</span>'
      : '<span class="pill p-pending">Pending</span>';

    let actions = "";
    if(e.status === "pending"){
      actions =
        `<button class="act ok" title="Approve" onclick="approve('${e.emp_id}')">✔</button>`+
        `<button class="act no" title="Reject" onclick="reject('${e.emp_id}')">✖</button>`;
    } else {
      actions =
        `<button class="act" title="Edit" onclick="openEdit('${e.emp_id}')">✎</button>`+
        `<button class="act" title="Reset password" onclick="openReset('${e.emp_id}')">⟳</button>`+
        (isAdmin ? "" : `<button class="act del" title="Delete" onclick="del('${e.emp_id}')">🗑</button>`);
    }

    return `<tr>
      <td>${escapeHtml(e.name||"")}</td>
      <td>${escapeHtml(e.emp_id||"")}</td>
      <td>${escapeHtml(e.designation||"")}</td>
      <td>${escapeHtml(e.phone||"")}</td>
      <td><span class="pill ${rc}">${rl}</span></td>
      <td>${statusPill}</td>
      <td>${actions}</td>
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

/* ---- edit ---- */
function openEdit(emp_id){
  const e = EMPLOYEES.find(x=>x.emp_id===emp_id);
  if(!e) return;
  CURRENT_EDIT = emp_id;
  $("editSub").textContent = e.name + " · " + e.emp_id;
  $("eName").value = e.name || "";
  $("ePhone").value = e.phone || "";
  $("eDesg").value = e.designation || "";
  $("eRole").value = e.role || "staff";
  openModal("editOv");
}
async function saveEdit(){
  if(!CURRENT_EDIT) return;
  const r = await api("/api/admin/update-user", {
    emp_id: CURRENT_EDIT,
    name: $("eName").value.trim(),
    phone: $("ePhone").value.trim(),
    designation: $("eDesg").value.trim(),
    role: $("eRole").value
  });
  if(r.ok){ closeModal("editOv"); toast("Saved."); loadDashboard(); }
  else toast(r.msg || "Could not save.");
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
async function del(emp_id){
  const e = EMPLOYEES.find(x=>x.emp_id===emp_id);
  if(!confirm("Delete " + (e?e.name:emp_id) + " permanently? Their scores are removed too.")) return;
  const r = await api("/api/admin/delete-user", { emp_id });
  if(r.ok){ toast("Deleted."); loadDashboard(); } else toast(r.msg||"Failed.");
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
