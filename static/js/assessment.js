/* ============================================================
   assessment.js — Learner assessment experience (Delivery 3)
   ============================================================ */

let CUR = null;          // current assessment {id,title,time_limit,pass_percent,total}
let QUESTIONS = [];      // served questions
let ANSWERS = {};        // { qid: chosen_orig_letter }
let TIMER_INT = null;
let TIME_LEFT = 0;
let LAST_CERT = null;
let QUIZ_START = 0;      // timestamp when the quiz started (for time taken)

const $q = (id) => document.getElementById(id);

async function apiQ(url, body){
  const opt = { method: body ? "POST" : "GET", headers:{ "Content-Type":"application/json" } };
  if(body) opt.body = JSON.stringify(body);
  const res = await fetch(url, opt);
  return res.json();
}

function esc(s){ return String(s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

/* ---- LIST ---- */
async function loadList(){
  const d = await apiQ("/api/my-assessments");
  const box = $q("assessList");
  if(!d.ok){ box.innerHTML = '<div class="empty">Could not load assessments.</div>'; return; }
  const list = d.assessments || [];
  if(list.length === 0){
    box.innerHTML = '<div class="empty">No assessments are assigned to you yet.</div>';
    return;
  }
  box.innerHTML = list.map(a=>{
    const done = a.passed
      ? '<span class="badge b-pass">Passed ' + (a.best!=null?a.best+'%':'') + '</span>'
      : (a.best!=null ? '<span class="badge b-todo">Best ' + a.best + '% — retry</span>'
                      : '<span class="badge b-todo">Not attempted</span>');
    const timer = a.time_limit > 0 ? a.time_limit + ' min' : 'No time limit';
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
        <div>
          <h3>${esc(a.title)} ${done}</h3>
          <div class="meta">${esc(a.description||'')}</div>
          <div class="meta" style="margin-top:6px">${a.num_questions} questions · Pass mark ${a.pass_percent}% · ${timer}</div>
        </div>
        <button class="btn primary" onclick="startQuiz(${a.id})">${a.passed?'Retake':'Start'}</button>
      </div>
    </div>`;
  }).join("");
}

/* ---- START ---- */
async function startQuiz(id){
  const d = await apiQ("/api/start-assessment?id=" + id);
  if(!d.ok){ alert(d.msg || "Could not start."); return; }
  CUR = d.assessment;
  QUESTIONS = d.questions;
  ANSWERS = {};
  QUIZ_START = Date.now();   // record when they started (for time taken)

  $q("quizTitle").textContent = CUR.title;
  renderQuiz();

  show("quizView");
  hide("listView"); hide("resultView"); hide("certView");

  // timer
  clearInterval(TIMER_INT);
  if(CUR.time_limit && CUR.time_limit > 0){
    TIME_LEFT = CUR.time_limit * 60;
    updateTimer();
    TIMER_INT = setInterval(()=>{
      TIME_LEFT--;
      updateTimer();
      if(TIME_LEFT <= 0){
        clearInterval(TIMER_INT);
        alert("Time's up! Submitting your answers.");
        submitQuiz();
      }
    }, 1000);
  } else {
    $q("timer").textContent = "No time limit";
  }
}

function updateTimer(){
  const m = Math.floor(TIME_LEFT/60), s = TIME_LEFT%60;
  const t = $q("timer");
  t.textContent = "⏱ " + m + ":" + (s<10?"0":"") + s;
  t.classList.toggle("warn", TIME_LEFT <= 30);
}

function renderQuiz(){
  $q("quizBody").innerHTML = QUESTIONS.map((q, i)=>{
    return `<div class="qcard">
      <div class="qnum">Question ${i+1} of ${QUESTIONS.length}</div>
      <div class="qtext">${esc(q.question)}</div>
      ${q.options.map(o=>`
        <label class="opt" id="opt-${q.qid}-${o._orig}" onclick="pick(${q.qid},'${o._orig}')">
          <input type="radio" name="q${q.qid}" ${ANSWERS[q.qid]===o._orig?'checked':''}/>
          <b>${o.key}.</b> ${esc(o.text)}
        </label>`).join("")}
    </div>`;
  }).join("");
  updateProgress();
}

function pick(qid, orig){
  ANSWERS[qid] = orig;
  // refresh selected styling for this question
  QUESTIONS.find(q=>q.qid===qid).options.forEach(o=>{
    const el = $q(`opt-${qid}-${o._orig}`);
    if(el) el.classList.toggle("sel", o._orig===orig);
  });
  updateProgress();
}

function updateProgress(){
  const answered = Object.keys(ANSWERS).length;
  const pct = QUESTIONS.length ? (answered/QUESTIONS.length)*100 : 0;
  $q("progBar").style.width = pct + "%";
}

/* ---- SUBMIT ---- */
async function submitQuiz(){
  clearInterval(TIMER_INT);
  const unanswered = QUESTIONS.length - Object.keys(ANSWERS).length;
  if(unanswered > 0){
    if(!confirm(unanswered + " question(s) not answered. Submit anyway?")){
      // restart timer if still timed and time remains
      if(CUR.time_limit && TIME_LEFT > 0){
        TIMER_INT = setInterval(()=>{ TIME_LEFT--; updateTimer(); if(TIME_LEFT<=0){clearInterval(TIMER_INT);submitQuiz();} },1000);
      }
      return;
    }
  }
  $q("submitBtn").disabled = true;
  const timeTaken = QUIZ_START ? Math.round((Date.now() - QUIZ_START) / 1000) : 0;  // seconds
  const d = await apiQ("/api/submit-assessment", { assessment_id: CUR.id, answers: ANSWERS, time_taken: timeTaken });
  $q("submitBtn").disabled = false;
  if(!d.ok){ alert(d.msg || "Submit failed."); return; }
  showResult(d);
}

function showResult(d){
  hide("quizView"); show("resultView");
  $q("resTitle").textContent = CUR.title;
  $q("resPct").textContent = d.percent + "%";
  $q("resPct").className = "big " + (d.passed ? "pass-c" : "fail-c");
  $q("resMsg").textContent = d.passed ? "Congratulations — you passed!" : "Not passed this time.";
  $q("resDetail").textContent = `You answered ${d.score} of ${d.total} correctly. Pass mark is ${d.pass_percent}%.`;

  const certBtn = $q("viewCertBtn");
  if(d.passed && d.cert){
    LAST_CERT = d.cert;
    certBtn.classList.remove("hidden");
  } else {
    LAST_CERT = null;
    certBtn.classList.add("hidden");
  }
}

function showCert(){
  if(!LAST_CERT) return;
  $q("certName").textContent = LAST_CERT.name;
  $q("certAssessment").textContent = LAST_CERT.assessment;
  $q("certScore").textContent = LAST_CERT.score + "%";
  $q("certDate").textContent = LAST_CERT.date;
  hide("resultView"); show("certView");
}

/* ---- nav ---- */
function backToList(){
  clearInterval(TIMER_INT);
  hide("quizView"); hide("resultView"); hide("certView"); show("listView");
  loadList();
}
function goPortal(){ window.location.href = "/portal"; }

function show(id){ $q(id).classList.remove("hidden"); $q(id).style.display=""; }
function hide(id){ $q(id).classList.add("hidden"); }

/* warn before leaving mid-quiz */
window.addEventListener("beforeunload", (e)=>{
  if($q("quizView") && !$q("quizView").classList.contains("hidden")){
    e.preventDefault(); e.returnValue = "";
  }
});

/* boot */
loadList();
