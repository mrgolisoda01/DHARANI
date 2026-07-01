/* ============================================================
   assess-admin.js — Admin Assessment management (Delivery 3)
   Loaded on the admin page. Adds the Assessments panel.
   ============================================================ */

let ASSESSMENTS = [];
let ROLE_CHOICES = [];

const $a = (id) => document.getElementById(id);

async function apiA(url, body){
  const opt = { method: body ? "POST" : "GET", headers:{ "Content-Type":"application/json" } };
  if(body) opt.body = JSON.stringify(body);
  const res = await fetch(url, opt);
  return res.json();
}

function toastA(msg){
  const t = document.getElementById("toast");
  if(!t){ alert(msg); return; }
  t.textContent = msg; t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"), 3000);
}

async function loadAssessments(){
  const d = await apiA("/api/admin/assessments");
  if(!d.ok) return;
  ASSESSMENTS = d.assessments || [];
  ROLE_CHOICES = d.role_choices || [];
  renderAssessments();
  buildRoleChecks();
}

function buildRoleChecks(){
  const box = $a("roleChecks");
  if(!box) return;
  box.innerHTML = ROLE_CHOICES.map(r=>
    `<label style="display:inline-flex;align-items:center;gap:5px;margin:3px 10px 3px 0;font-size:13px">
       <input type="checkbox" class="roleck" value="${r}" style="width:auto"> ${r}
     </label>`
  ).join("");
}

function renderAssessments(){
  const box = $a("assessList");
  if(!box) return;
  if(ASSESSMENTS.length === 0){
    box.innerHTML = '<div class="empty">No assessments yet. Create one above.</div>';
    return;
  }
  box.innerHTML = ASSESSMENTS.map(a=>{
    const timer = a.time_limit > 0 ? a.time_limit + " min" : "Untimed";
    const status = a.active
      ? '<span class="pill p-approved">Active</span>'
      : '<span class="pill p-pending">Paused</span>';
    return `<div style="border:1px solid var(--mg-line);border-radius:10px;padding:14px;margin-bottom:10px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:15px">${escA(a.title)} ${status}</div>
          <div style="font-size:12px;color:var(--mg-muted);margin-top:3px">${escA(a.description||"")}</div>
          <div style="font-size:12px;color:var(--mg-muted);margin-top:6px">
            For: <b>${escA(a.roles)}</b> · Pool: <b>${a.question_count}</b> Qs · Each learner gets: <b>${a.num_questions}</b> ·
            Pass: <b>${a.pass_percent}%</b> · ${timer} · Attempts: <b>${a.attempt_count}</b>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn" onclick="openEditAssess(${a.id})" style="color:var(--mg-blue)">Edit</button>
          <button class="btn" onclick="viewResults(${a.id},'${escA(a.title)}')">Results</button>
          <button class="btn" onclick="toggleAssess(${a.id})">${a.active?"Pause":"Activate"}</button>
          <button class="btn" onclick="deleteAssess(${a.id})" style="color:var(--mg-red)">Delete</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

function escA(s){ return String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

async function createAssessment(){
  const title = $a("asTitle").value.trim();
  const desc = $a("asDesc").value.trim();
  const csv = $a("asCsv").value;
  const num = $a("asNum").value;
  const pass = $a("asPass").value;
  const timed = $a("asTimed").checked;
  const tlimit = timed ? ($a("asTime").value || 0) : 0;

  const checked = Array.from(document.querySelectorAll(".roleck:checked")).map(c=>c.value);
  const roles = checked.length ? checked.join(",") : "all";

  if(!title){ toastA("Give the assessment a title."); return; }
  if(!csv.trim()){ toastA("Paste your question CSV."); return; }

  const r = await apiA("/api/admin/create-assessment", {
    title, description: desc, roles,
    num_questions: num, pass_percent: pass, time_limit: tlimit, csv
  });
  if(r.ok){
    let m = r.msg;
    if(r.errors && r.errors.length) m += " — " + r.errors.length + " row(s) skipped";
    toastA(m);
    // clear form
    $a("asTitle").value=""; $a("asDesc").value=""; $a("asCsv").value="";
    document.querySelectorAll(".roleck:checked").forEach(c=>c.checked=false);
    loadAssessments();
  } else {
    let m = r.msg || "Could not create.";
    if(r.errors && r.errors.length) m += "\n" + r.errors.slice(0,5).join("\n");
    toastA(m);
  }
}

async function toggleAssess(id){
  const r = await apiA("/api/admin/toggle-assessment", { id });
  if(r.ok){ toastA(r.active?"Activated":"Paused"); loadAssessments(); }
}
async function deleteAssess(id){
  if(!confirm("Delete this assessment, its questions, and all results? This cannot be undone.")) return;
  const r = await apiA("/api/admin/delete-assessment", { id });
  if(r.ok){ toastA("Deleted."); loadAssessments(); }
}

async function viewResults(id, title){
  const d = await apiA("/api/admin/assessment-results?id=" + id);
  if(!d.ok) return;
  const rows = d.results || [];
  window._lastResults = { title, rows };
  const box = $a("resultsBox");
  if(rows.length === 0){
    box.innerHTML = `<h3 style="margin-top:0">${escA(title)} — Results</h3><div class="empty">No attempts yet.</div>`;
  } else {
    box.innerHTML =
      `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
         <h3 style="margin:0">${escA(title)} — Results (${rows.length})</h3>
         <button class="btn primary" onclick="exportResults()">⬇ Export CSV</button>
       </div>
       <div class="tbl-wrap" style="margin-top:10px">
        <table><thead><tr><th>Name</th><th>Emp ID</th><th>Designation</th><th>Score</th><th>Result</th><th>Date</th></tr></thead>
        <tbody>` +
        rows.map(x=>`<tr>
          <td>${escA(x.name||"")}</td><td>${escA(x.emp_id)}</td><td>${escA(x.designation||"")}</td>
          <td>${x.percent}% (${x.score}/${x.total})</td>
          <td>${x.passed?'<span class="pill p-approved">Pass</span>':'<span class="pill p-pending">Fail</span>'}</td>
          <td style="font-size:12px;color:var(--mg-muted)">${fmtA(x.taken_at)}</td>
        </tr>`).join("") +
        `</tbody></table></div>`;
  }
  $a("resultsOv").classList.add("show");
}

function fmtA(iso){ if(!iso) return ""; try{ return new Date(iso+(iso.endsWith("Z")?"":"Z")).toLocaleString(); }catch(e){ return iso; } }

function exportResults(){
  const data = window._lastResults;
  if(!data) return;
  let csv = "Name,Emp ID,Designation,Score %,Correct,Total,Result,Date\n";
  data.rows.forEach(x=>{
    csv += `"${(x.name||"").replace(/"/g,'""')}","${x.emp_id}","${(x.designation||"").replace(/"/g,'""')}",${x.percent},${x.score},${x.total},${x.passed?"Pass":"Fail"},"${fmtA(x.taken_at)}"\n`;
  });
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = (data.title||"results").replace(/[^a-z0-9]/gi,"_") + ".csv";
  a.click(); URL.revokeObjectURL(url);
}

/* timer toggle show/hide */
function onTimedToggle(){
  const wrap = $a("asTimeWrap");
  if(wrap) wrap.style.display = $a("asTimed").checked ? "block" : "none";
}

/* ============================================================
   EDIT an assessment — settings + questions
   ============================================================ */
let EDIT_A = null;        // current assessment being edited
let EDIT_A_QS = [];       // its questions

async function openEditAssess(id){
  const r = await (await fetch("/api/admin/assessment-detail?id="+id)).json();
  if(!r.ok){ toastA("Could not load."); return; }
  EDIT_A = r.assessment; EDIT_A_QS = r.questions;
  A_ROLES = r.role_choices || A_ROLES;
  renderEditScreen();
  $a("editAssessOv").classList.add("show");
}

function renderEditScreen(){
  const a = EDIT_A;
  const roleChecks = A_ROLES.map(role=>{
    const on = (a.roles||"all").toLowerCase().split(",").map(s=>s.trim()).includes(role.toLowerCase());
    return `<label style="display:inline-flex;align-items:center;gap:5px;margin:3px 10px 3px 0;font-size:12px"><input type="checkbox" class="ea-role" value="${role}" ${on?"checked":""} style="width:auto"> ${role}</label>`;
  }).join("");

  const qrows = EDIT_A_QS.map((q,i)=>`
    <div style="border:1px solid var(--mg-line);border-radius:8px;padding:10px;margin-bottom:8px;background:#fafdff">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div style="font-size:13px"><b>Q${i+1}.</b> ${escA(q.question)}</div>
        <div style="white-space:nowrap">
          <button class="btn" style="padding:3px 8px" onclick="editOneQ(${q.id})">Edit</button>
          <button class="btn" style="padding:3px 8px;color:var(--mg-red)" onclick="delOneQ(${q.id})">✕</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--mg-muted);margin-top:4px">
        A) ${escA(q.opt_a)} &nbsp; B) ${escA(q.opt_b)} ${q.opt_c?"&nbsp; C) "+escA(q.opt_c):""} ${q.opt_d?"&nbsp; D) "+escA(q.opt_d):""}
        &nbsp; · <b style="color:var(--mg-green)">Ans: ${q.correct}</b>
      </div>
    </div>`).join("");

  $a("editAssessBody").innerHTML = `
    <h3 style="margin:0 0 12px">Edit assessment</h3>

    <div style="background:#fff;border:1px solid var(--mg-line);border-radius:10px;padding:14px;margin-bottom:14px">
      <h4 style="margin:0 0 10px;font-size:14px">Settings</h4>
      <div class="fld"><label>Title</label><input id="eaTitle" value="${escAttr(a.title)}"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="fld"><label>Questions per learner</label><input id="eaNumQ" type="number" value="${a.num_questions}"></div>
        <div class="fld"><label>Pass mark % (min 90)</label><input id="eaPass" type="number" value="${a.pass_percent}"></div>
        <div class="fld"><label>Time limit (min, 0=none)</label><input id="eaTime" type="number" value="${a.time_limit}"></div>
      </div>
      <div class="fld"><label>Who can see this?</label><div>${roleChecks}</div></div>
      <div style="text-align:right"><button class="btn primary" onclick="saveAssessSettings()">Save settings</button></div>
    </div>

    <div style="background:#fff;border:1px solid var(--mg-line);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h4 style="margin:0;font-size:14px">Questions (${EDIT_A_QS.length})</h4>
        <button class="btn primary" onclick="editOneQ(0)">＋ Add question</button>
      </div>
      ${qrows || '<div class="empty">No questions yet.</div>'}
    </div>

    <details style="background:#fff;border:1px solid var(--mg-line);border-radius:10px;padding:14px">
      <summary style="cursor:pointer;font-weight:600;font-size:14px">Add many questions at once (paste CSV)</summary>
      <p style="font-size:12px;color:var(--mg-muted);margin:8px 0">Same format as before. These get added to the existing questions.</p>
      <textarea id="eaCsv" rows="5" style="width:100%;font-family:monospace;font-size:12px" placeholder="question,option_a,option_b,option_c,option_d,correct,category"></textarea>
      <div style="text-align:right;margin-top:8px"><button class="btn primary" onclick="addQsCsv()">Add these questions</button></div>
    </details>

    <div style="text-align:right;margin-top:14px">
      <button class="btn" onclick="closeEditAssess()">Close</button>
    </div>`;
}

function closeEditAssess(){ $a("editAssessOv").classList.remove("show"); loadAssessments(); }

async function saveAssessSettings(){
  const roles = Array.from(document.querySelectorAll(".ea-role:checked")).map(c=>c.value);
  const body = {
    id: EDIT_A.id,
    title: $a("eaTitle").value.trim(),
    roles: roles.length ? roles.join(",") : "all",
    num_questions: $a("eaNumQ").value,
    pass_percent: $a("eaPass").value,
    time_limit: $a("eaTime").value
  };
  const r = await (await fetch("/api/admin/update-assessment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).json();
  if(r.ok){ toastA(r.msg); openEditAssess(EDIT_A.id); } else toastA(r.msg||"Failed.");
}

function editOneQ(qid){
  const q = qid ? EDIT_A_QS.find(x=>x.id===qid) : {question:"",opt_a:"",opt_b:"",opt_c:"",opt_d:"",correct:"A",category:""};
  if(!q) return;
  const html = `
    <h3 style="margin:0 0 12px">${qid?"Edit question":"Add question"}</h3>
    <div class="fld"><label>Question</label><textarea id="qQ" rows="2" style="width:100%">${escA(q.question)}</textarea></div>
    <div class="fld"><label>Option A</label><input id="qA" value="${escAttr(q.opt_a)}"></div>
    <div class="fld"><label>Option B</label><input id="qB" value="${escAttr(q.opt_b)}"></div>
    <div class="fld"><label>Option C (optional)</label><input id="qC" value="${escAttr(q.opt_c||'')}"></div>
    <div class="fld"><label>Option D (optional)</label><input id="qD" value="${escAttr(q.opt_d||'')}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="fld"><label>Correct answer</label>
        <select id="qCorrect"><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></div>
      <div class="fld"><label>Category (optional)</label><input id="qCat" value="${escAttr(q.category||'')}"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeQModal()">Cancel</button>
      <button class="btn primary" onclick="saveOneQ(${qid||0})">Save question</button>
    </div>`;
  $a("qModalBody").innerHTML = html;
  $a("qCorrect").value = q.correct || "A";
  $a("qModalOv").classList.add("show");
}
function closeQModal(){ $a("qModalOv").classList.remove("show"); }

async function saveOneQ(qid){
  const body = {
    assessment_id: EDIT_A.id,
    id: qid || null,
    question: $a("qQ").value.trim(),
    opt_a: $a("qA").value.trim(), opt_b: $a("qB").value.trim(),
    opt_c: $a("qC").value.trim(), opt_d: $a("qD").value.trim(),
    correct: $a("qCorrect").value, category: $a("qCat").value.trim()
  };
  const r = await (await fetch("/api/admin/save-question",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).json();
  if(r.ok){ toastA(r.msg); closeQModal(); openEditAssess(EDIT_A.id); } else toastA(r.msg||"Failed.");
}

async function delOneQ(qid){
  if(!confirm("Remove this question?")) return;
  const r = await (await fetch("/api/admin/delete-question",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:qid,assessment_id:EDIT_A.id})})).json();
  if(r.ok){ toastA("Removed."); openEditAssess(EDIT_A.id); } else toastA(r.msg||"Failed.");
}

async function addQsCsv(){
  const csv = $a("eaCsv").value.trim();
  if(!csv){ toastA("Paste some CSV first."); return; }
  const r = await (await fetch("/api/admin/add-questions-csv",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:EDIT_A.id,csv})})).json();
  if(r.ok){ toastA(r.msg); openEditAssess(EDIT_A.id); } else toastA(r.msg||"Failed.");
}

function escAttr(s){ return String(s||"").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
