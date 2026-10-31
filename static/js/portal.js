/* ============================================================
   portal.js — tabbed learner portal
   Tabs: Home | Induction | Training | Assessments | Videos | Certificates
   Keeps the original Induction module system (slides + 90% quiz unlock)
   and adds the Assessment Engine + Certificates inside the same portal.
   ============================================================ */

const PASS = 90;
let progress = {};
let cur = null;
let slideIdx = 0;

const $ = id => document.getElementById(id);

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

/* ---------------- TAB SWITCHING ---------------- */
function showTab(name){
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('show'));
  document.querySelectorAll('.pt-tab').forEach(t=>t.classList.remove('active'));
  $('tab-'+name).classList.add('show');
  document.querySelector('.pt-tab[data-tab="'+name+'"]').classList.add('active');
  if(name==='induction') goHome();  // reset induction view on a real tab click
  loadTabData(name);
}

// Load (or reload) the data for a tab — shared by showTab and auto-refresh.
function loadTabData(name){
  if(name==='assess') loadAssessments();
  if(name==='certs') loadCertificates();
  if(name==='home') loadHomeStats();
  if(name==='induction') loadFileModules('induction');
  if(name==='training') loadFileModules('training');
  if(name==='videos') loadVideos();
}

// ---- Auto-refresh the current tab every 30s ----
// Only the tab you're viewing, pauses when the browser tab is hidden, and
// skips while a module viewer or rating popup is open (so it won't interrupt).
function portalAutoRefresh(){
  try{
    if(document.hidden) return;                       // not visible
    if(document.querySelector('.fm-ov.show')) return; // a module/rating modal is open
    if(typeof MOD_VIEWING !== 'undefined' && MOD_VIEWING) return;  // mid module view
    var active = document.querySelector('.pt-tab.active');
    var tab = active ? active.getAttribute('data-tab') : '';
    if(tab) loadTabData(tab);
    if(typeof loadPendingBadges === 'function') loadPendingBadges();  // keep tab badges fresh
  }catch(e){}
}
setInterval(portalAutoRefresh, 30000);

// red count badges on the Induction / Training / Assessments tabs
async function loadPendingBadges(){
  let d;
  try { d = await (await fetch('/api/my-pending-counts')).json(); }
  catch(e){ return; }
  if(!d || !d.ok) return;
  const set = (id, n)=>{
    const b = document.getElementById(id);
    if(!b) return;
    if(n > 0){ b.textContent = n; b.classList.add('show'); }
    else { b.textContent = ''; b.classList.remove('show'); }
  };
  set('badgeInduction', d.induction);
  set('badgeTraining', d.training);
  set('badgeAssess', d.assess);
  set('badgeVideos', d.videos);
}

/* ---------------- FILE MODULES (Drive PDF/HTML/PPT) ---------------- */
let MOD_TIMER = null, MOD_VIEWING = null;

async function loadFileModules(kind){
  const boxId = kind==='induction' ? 'indFileBox' : 'trnFileBox';
  const box = $(boxId);
  if(!box) return;
  try{
    const d = await (await fetch('/api/content/'+kind)).json();
    const list = (d && d.modules) || [];
    if(list.length===0){
      box.innerHTML = kind==='training'
        ? '<div class="placeholder"><div class="ic">🎓</div><h3 style="margin:0 0 6px;color:var(--mg-ink)">No training modules yet</h3><p>Role-specific modules will appear here when added.</p></div>'
        : '<div class="empty">No document modules yet.</div>';
      return;
    }
    // which modules has this learner already rated? (to show Rate vs ✓ Rated)
    let ratedSet = {};
    try{
      const rr = await (await fetch('/api/rating/my-rated',{cache:'no-store'})).json();
      if(rr && rr.ok){ (rr.modules||[]).forEach(id=>{ ratedSet[id]=1; }); }
    }catch(e){}
    box.innerHTML = list.map(m=>{
      const done = m.completed ? '<span class="badge b-pass">✓ Completed</span>' : '';
      const t = m.min_minutes>0 ? `Min viewing: ${m.min_minutes} min` : 'No minimum time';
      const safeTitle = esc(m.title).replace(/'/g,"&#39;");
      // rating button: only for completed modules
      let rateBtn = '';
      if(m.completed){
        rateBtn = ratedSet[m.id]
          ? '<button class="btn btn-sec" disabled style="opacity:.6">★ Rated</button>'
          : `<button class="btn btn-sec" onclick="openModuleRating(${m.id},'${safeTitle}')">★ Rate</button>`;
      }
      return `<div class="as-card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div><h4>📄 ${esc(m.title)} ${done}</h4>
            <div class="meta">${esc(m.description||'')}</div>
            <div class="meta" style="margin-top:5px">${(m.file_type||'file').toUpperCase()} · ${t}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${rateBtn}
            <button class="btn btn-pri" onclick="openFileModule(${m.id},'${safeTitle}','${esc(m.link)}',${m.min_minutes},${m.completed?1:0})">${m.completed?'View again':'Open'}</button>
          </div>
        </div></div>`;
    }).join('');
  }catch(e){ box.innerHTML = '<div class="empty">Could not load modules.</div>'; }
}

function openFileModule(id, title, link, minMins, alreadyDone){
  MOD_VIEWING = { id, title, minMins, alreadyDone };
  $('fmTitle').textContent = title;
  // embed Drive/PDF link; convert /view links to /preview for embedding
  let embed = link;
  if(link.indexOf('drive.google.com')>=0){
    embed = link.replace('/view','/preview').replace('?usp=sharing','');
  }
  $('fmFrame').src = embed;
  $('fmOpenLink').href = link;
  $('fmModal').classList.add('show');

  // timer
  clearInterval(MOD_TIMER);
  const btn = $('fmComplete');
  if(alreadyDone){
    btn.disabled = false; btn.textContent = 'Already completed ✓';
    $('fmCountdown').textContent = '';
    return;
  }
  let left = (minMins||0)*60;
  if(left<=0){
    btn.disabled = false; btn.textContent = 'Mark complete';
    $('fmCountdown').textContent = '';
  } else {
    btn.disabled = true;
    const tick = ()=>{
      const m=Math.floor(left/60), s=left%60;
      $('fmCountdown').textContent = `Please view for ${m}:${s<10?'0':''}${s} before completing`;
      $('fmComplete').textContent = 'Mark complete';
      if(left<=0){ clearInterval(MOD_TIMER); btn.disabled=false; $('fmCountdown').textContent='You may now mark this complete ✓'; }
      left--;
    };
    tick(); MOD_TIMER = setInterval(tick, 1000);
  }
}

async function completeFileModule(){
  if(!MOD_VIEWING) return;
  const wasDone = MOD_VIEWING.alreadyDone;
  const modId = MOD_VIEWING.id, modTitle = MOD_VIEWING.title || 'this module';
  let newCerts = [];
  try{
    const r = await (await fetch('/api/content/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({module_id:MOD_VIEWING.id})})).json();
    newCerts = (r && r.new_certificates) || [];
  }catch(e){}
  closeFileModule();
  if(newCerts.length){
    alert("🎉 Congratulations! You earned: " + newCerts.join(", ") + "\nCheck your Certificates tab.");
  }
  const active = document.querySelector('.pt-tab.active').getAttribute('data-tab');
  if(active==='induction') loadFileModules('induction');
  if(active==='training') loadFileModules('training');
  loadHomeStats();
  loadPendingBadges();
  // Ask for a rating the FIRST time they complete this module (required)
  if(!wasDone){ openModuleRating(modId, modTitle); }
}

function closeFileModule(){
  clearInterval(MOD_TIMER);
  $('fmFrame').src = 'about:blank';
  $('fmModal').classList.remove('show');
  MOD_VIEWING = null;   // no longer viewing — let auto-refresh resume
}

/* ---------------- VIDEOS ---------------- */
async function loadVideos(){
  const box = $('vidBox');
  if(!box) return;
  try{
    const d = await (await fetch('/api/content/videos')).json();
    const list = (d && d.videos) || [];
    if(list.length===0){
      box.innerHTML = '<div class="placeholder"><div class="ic">🎥</div><h3 style="margin:0 0 6px;color:var(--mg-ink)">No videos yet</h3><p>Training videos will appear here when added.</p></div>';
      return;
    }
    box.innerHTML = list.map(v=>`
      <div class="as-card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div><h4>🎥 ${esc(v.title)} ${v.completed?'<span style="color:#1d9e75;font-size:12px">✓ Watched</span>':''}</h4>
            <div class="meta">${esc(v.description||'')}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn btn-pri" href="${esc(v.link)}" target="_blank">Watch ↗</a>
            ${v.completed
              ? '<button class="btn btn-sec" disabled style="opacity:.6">Watched</button>'
              : `<button class="btn btn-sec" onclick="markVideoWatched(${v.id})">Mark as watched</button>`}
          </div>
        </div></div>`).join('');
  }catch(e){ box.innerHTML = '<div class="empty">Could not load videos.</div>'; }
}

async function markVideoWatched(id){
  try{
    await fetch('/api/content/complete-video',{method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({video_id:id})});
  }catch(e){}
  loadVideos();
  loadPendingBadges();
}

/* ---------------- HOME STATS ---------------- */
// set the induction progress ring (r=30 => circumference ≈ 188.5)
function setIndRing(done, total){
  const C = 188.5;
  const pct = total > 0 ? done/total : 0;
  const fg = $('indRingFg');
  if(fg) fg.style.strokeDashoffset = String(C - C*pct);
  if($('indRingTxt')) $('indRingTxt').textContent = done + ' / ' + total;
}

async function loadHomeStats(){
  // ----- induction modules: count completed + find next pending -----
  let indDone = 0, indTotal = 0, nextMod = null;
  try{
    const d = await (await fetch('/api/content/induction')).json();
    const list = (d && d.modules) || [];
    indTotal = list.length;
    list.forEach(m=>{ if(m.completed) indDone++; });
    nextMod = list.find(m=>!m.completed) || null;
  }catch(e){}
  setIndRing(indDone, indTotal);

  // ----- "Continue where you left off" -----
  const cbox = $('continueBox'), cbtn = $('continueBtn'), csub = $('continueSub');
  if(cbox && cbtn){
    if(nextMod){
      cbox.style.display = 'block';
      cbtn.textContent = '▶ Continue: ' + (nextMod.title || 'Next module');
      if(csub) csub.textContent = 'Your next induction module is waiting.';
      cbtn.onclick = function(){
        showTab('induction');
        // open the module directly after the tab renders
        setTimeout(function(){
          try{
            openFileModule(nextMod.id, nextMod.title, nextMod.link,
                           nextMod.min_minutes||0, nextMod.completed?1:0);
          }catch(e){}
        }, 350);
      };
    } else if(indTotal > 0){
      cbox.style.display = 'block';
      cbtn.textContent = '✓ All induction modules completed';
      cbtn.onclick = function(){ showTab('induction'); };
      if(csub) csub.textContent = 'Great work — your induction is fully done.';
    } else {
      cbox.style.display = 'none';
    }
  }

  // ----- certificates -----
  let certCount = 0;
  try{
    const r = await (await fetch('/api/my-certificates')).json();
    certCount = ((r && r.certificates) || []).length;
  }catch(e){}
  if($('hCert')) $('hCert').textContent = certCount;

  // ----- assessments -----
  let assPassed = 0, assTotal = 0;
  try{
    const r = await (await fetch('/api/my-assessments')).json();
    const list = (r && r.assessments) || [];
    assTotal = list.length;
    assPassed = list.filter(a=>a.passed).length;
  }catch(e){}
  if($('hAss')) $('hAss').textContent = assPassed;

  // ----- overall onboarding % (induction modules + assessments combined) -----
  const totUnits = indTotal + assTotal;
  const doneUnits = indDone + assPassed;
  const onbPct = totUnits > 0 ? Math.round(doneUnits*100/totUnits) : 0;
  const ow = $('onbWrap');
  if(ow){
    if(totUnits > 0){
      ow.style.display = 'block';
      if($('onbPct')) $('onbPct').textContent = onbPct + '%';
      if($('onbFill')) $('onbFill').style.width = onbPct + '%';
    } else {
      ow.style.display = 'none';
    }
  }

  // ----- manager Team card (only if viewer manages people) -----
  loadHomeTeamCard();
}

async function loadHomeTeamCard(){
  const card = $('teamCard');
  if(!card) return;
  try{
    const d = await (await fetch('/api/team')).json();
    if(!d || !d.ok){ card.style.display='none'; return; }
    const rows = d.rows || [];
    const n = (d.summary && d.summary.people) || rows.length;
    // show only if this person actually has a team (managers/admin)
    if(n <= 0){ card.style.display='none'; return; }
    // count people with an active OJT (status not done/resigned/—)
    const activeStates = ['in_progress','active','ongoing','started','open'];
    let inOjt = 0;
    rows.forEach(r=>{
      const s = (r.ojt_status||'').toString().toLowerCase().trim();
      if(s && activeStates.indexOf(s) >= 0) inOjt++;
    });
    if($('hTeam')) $('hTeam').textContent = n;
    if($('hTeamOjt')) $('hTeamOjt').textContent = inOjt + ' in OJT';
    card.style.display = 'flex';
  }catch(e){ card.style.display='none'; }
}

/* ---------------- INDUCTION (original system) ---------------- */
async function boot(){
  try{
    const res = await fetch('/api/my-progress');
    const body = await res.json();
    progress = (body && body.progress) || {};
  }catch(e){ progress = {}; }
  drawGrid();
  loadHomeStats();
}

function isUnlocked(i){
  if(i===0) return true;
  const prev = INDUCTION[i-1];
  return progress[prev.id] && progress[prev.id].passed;
}

function drawGrid(){
  const grid = $('ind-grid');
  if(!grid) return;
  // show/hide the legacy slide-module section based on whether any exist
  const wrap = $('slideModsWrap');
  if(wrap) wrap.style.display = (INDUCTION && INDUCTION.length > 0) ? 'block' : 'none';
  grid.innerHTML = '';
  INDUCTION.forEach((m, i)=>{
    const unlocked = isUnlocked(i);
    const done = progress[m.id] && progress[m.id].passed;
    const card = document.createElement('div');
    card.className = 'mod ' + (unlocked ? 'open' : 'locked');
    card.innerHTML = `
      <div class="num">${m.num}</div>
      <h3>${m.title}</h3>
      <p>${m.summary}</p>
      ${ done ? '<span class="badge b-done">✓ Passed</span>'
              : unlocked ? '<span class="badge b-open">Start ›</span>'
                         : '<span class="badge b-lock">🔒 Locked</span>' }
      ${ unlocked ? '' : '<div class="lockicon">🔒</div>' }
    `;
    if(unlocked) card.onclick = ()=> openModule(m);
    grid.appendChild(card);
  });
}

function openModule(m){
  cur = m; slideIdx = 0;
  $('p-home').classList.add('hide');
  $('p-quiz').classList.add('hide');
  $('p-view').classList.remove('hide');
  drawSlide();
}

function drawSlide(){
  const s = cur.slides[slideIdx];
  const last = slideIdx === cur.slides.length - 1;
  $('slidearea').innerHTML = `
    <div class="slide">
      <div class="eye">${s.eye}</div>
      <h2>${s.h}</h2>
      <p>${s.body}</p>
      ${ s.bullets ? '<ul>'+s.bullets.map(b=>`<li>${b}</li>`).join('')+'</ul>' : '' }
      <div class="qrow">
        <button class="btn btn-sec" onclick="prevSlide()" ${slideIdx===0?'style="visibility:hidden"':''}>‹ Previous</button>
        <button class="btn btn-pri" onclick="${ last ? 'startQuiz()' : 'nextSlide()' }">
          ${ last ? 'Take Assessment ›' : 'Next ›' }
        </button>
      </div>
      <div style="text-align:center;margin-top:14px;font-size:12px;color:var(--muted)">
        Slide ${slideIdx+1} of ${cur.slides.length}
      </div>
    </div>`;
}
function nextSlide(){ if(slideIdx<cur.slides.length-1){slideIdx++; drawSlide();} }
function prevSlide(){ if(slideIdx>0){slideIdx--; drawSlide();} }

let quizQs = [];
let answers = {};

function startQuiz(){
  quizQs = shuffle(cur.quiz).map(q=>{
    const opts = q.options.map((text,idx)=>({text, correct: idx===q.answer}));
    return { q:q.q, options: shuffle(opts) };
  });
  answers = {};
  $('p-view').classList.add('hide');
  $('p-quiz').classList.remove('hide');
  drawQuiz();
}

function drawQuiz(){
  let html = `<h2 style="margin:4px 0 4px">${cur.title} — Assessment</h2>
    <p style="color:var(--muted);font-size:14px;margin:0 0 16px">
      Answer all questions. You need ${PASS}% to pass and unlock the next module.</p>`;
  quizQs.forEach((q, qi)=>{
    html += `<div class="q"><h4>${qi+1}. ${q.q}</h4>`;
    q.options.forEach((o, oi)=>{
      const sel = answers[qi]===oi ? 'sel' : '';
      html += `<label class="opt ${sel}" onclick="pick(${qi},${oi})">${o.text}</label>`;
    });
    html += `</div>`;
  });
  html += `<button class="btn btn-pri" style="width:100%;margin-top:6px" onclick="submitQuiz()">Submit Assessment</button>`;
  $('quizarea').innerHTML = html;
}

function pick(qi, oi){ answers[qi]=oi; drawQuiz(); }

async function submitQuiz(){
  if(Object.keys(answers).length < quizQs.length){
    alert('Please answer all questions before submitting.'); return;
  }
  let correct = 0;
  quizQs.forEach((q, qi)=>{ if(q.options[answers[qi]].correct) correct++; });
  const total = quizQs.length;
  const percent = Math.round((correct/total)*100);
  const passed = percent >= PASS;

  try{
    await fetch('/api/save-score', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ module_id: cur.id, set_no:1, score: correct, total })
    });
  }catch(e){}

  if(passed){ progress[cur.id] = { best: percent, passed: true }; }

  $('quizarea').innerHTML = `
    <div class="result">
      <div class="big ${passed?'pass':'fail'}">${percent}%</div>
      <h2 style="margin:6px 0">${passed ? 'Passed! 🎉' : 'Not passed yet'}</h2>
      <p style="color:var(--muted)">You answered ${correct} of ${total} correctly.
         ${ passed ? 'The next module is now unlocked.' : `You need ${PASS}% to pass. Review the slides and try again.` }</p>
      <div style="margin-top:18px;display:flex;gap:10px;justify-content:center">
        ${ passed ? '' : '<button class="btn btn-sec" onclick="openModule(cur)">Review &amp; Retry</button>' }
        <button class="btn btn-pri" onclick="goHome()">Back to Modules</button>
      </div>
    </div>`;
}

function goHome(){
  if($('p-view')) $('p-view').classList.add('hide');
  if($('p-quiz')) $('p-quiz').classList.add('hide');
  if($('p-home')) $('p-home').classList.remove('hide');
  drawGrid();
}

/* ---------------- ASSESSMENTS (engine inside portal) ---------------- */
let AS_CUR = null, AS_QS = [], AS_ANS = {}, AS_TIMER = null, AS_LEFT = 0, AS_LASTCERT = null;

async function loadAssessments(){
  showAsView('list');
  const box = $('asListBox');
  try{
    const d = await (await fetch('/api/my-assessments')).json();
    const list = (d && d.assessments) || [];
    if(list.length===0){ box.innerHTML = '<div class="empty">No assessments are assigned to you yet.</div>'; return; }
    box.innerHTML = list.map(a=>{
      const done = a.passed
        ? '<span class="badge b-pass">Passed '+(a.best!=null?a.best+'%':'')+'</span>'
        : (a.best!=null ? '<span class="badge b-todo">Best '+a.best+'% — retry</span>' : '<span class="badge b-todo">Not attempted</span>');
      const timer = a.time_limit>0 ? a.time_limit+' min' : 'No time limit';
      return `<div class="as-card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
          <div><h4>${esc(a.title)} ${done}</h4>
            <div class="meta">${esc(a.description||'')}</div>
            <div class="meta" style="margin-top:6px">${a.num_questions} questions · Pass ${a.pass_percent}% · ${timer}</div></div>
          <button class="btn btn-pri" onclick="startAssessment(${a.id})">${a.passed?'Retake':'Start'}</button>
        </div></div>`;
    }).join('');
  }catch(e){ box.innerHTML = '<div class="empty">Could not load assessments.</div>'; }
}

function showAsView(which){
  $('as-list').classList.toggle('hide', which!=='list');
  $('as-quiz').classList.toggle('hide', which!=='quiz');
  $('as-result').classList.toggle('hide', which!=='result');
}

async function startAssessment(id){
  let d;
  try{ d = await (await fetch('/api/start-assessment?id='+id)).json(); }
  catch(e){ alert('Could not start.'); return; }
  if(!d.ok){ alert(d.msg||'Could not start.'); return; }
  AS_CUR = d.assessment; AS_QS = d.questions; AS_ANS = {};
  $('asQuizTitle').textContent = AS_CUR.title;
  drawAsQuiz();
  showAsView('quiz');
  clearInterval(AS_TIMER);
  if(AS_CUR.time_limit>0){
    AS_LEFT = AS_CUR.time_limit*60; updateAsTimer();
    AS_TIMER = setInterval(()=>{ AS_LEFT--; updateAsTimer(); if(AS_LEFT<=0){clearInterval(AS_TIMER);alert("Time's up! Submitting.");submitAssessment();} },1000);
  } else { $('asTimer').textContent='No time limit'; }
}

function updateAsTimer(){
  const m=Math.floor(AS_LEFT/60), s=AS_LEFT%60;
  const t=$('asTimer'); t.textContent='⏱ '+m+':'+(s<10?'0':'')+s; t.classList.toggle('warn', AS_LEFT<=30);
}

function drawAsQuiz(){
  $('asQuizBody').innerHTML = AS_QS.map((q,i)=>`
    <div class="qcard">
      <div class="meta" style="font-weight:700;text-transform:uppercase;font-size:11px">Question ${i+1} of ${AS_QS.length}</div>
      <div class="qtext">${esc(q.question)}</div>
      ${q.options.map(o=>`<label class="opt2" id="aopt-${q.qid}-${o._orig}" onclick="pickAs(${q.qid},'${o._orig}')"><b>${o.key}.</b> ${esc(o.text)}</label>`).join('')}
    </div>`).join('');
}

function pickAs(qid, orig){
  AS_ANS[qid]=orig;
  AS_QS.find(q=>q.qid===qid).options.forEach(o=>{
    const el=$('aopt-'+qid+'-'+o._orig); if(el) el.classList.toggle('sel', o._orig===orig);
  });
}

async function submitAssessment(){
  clearInterval(AS_TIMER);
  const un = AS_QS.length - Object.keys(AS_ANS).length;
  if(un>0 && !confirm(un+' question(s) not answered. Submit anyway?')){
    if(AS_CUR.time_limit>0 && AS_LEFT>0){ AS_TIMER=setInterval(()=>{AS_LEFT--;updateAsTimer();if(AS_LEFT<=0){clearInterval(AS_TIMER);submitAssessment();}},1000); }
    return;
  }
  let d;
  try{ d = await (await fetch('/api/submit-assessment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assessment_id:AS_CUR.id,answers:AS_ANS})})).json(); }
  catch(e){ alert('Submit failed.'); return; }
  if(!d.ok){ alert(d.msg||'Submit failed.'); return; }
  AS_LASTCERT = (d.passed && d.cert) ? d.cert : null;
  loadPendingBadges();
  const newCerts = (d.new_certificates) || [];
  $('as-result').innerHTML = `
    <div class="qcard" style="text-align:center;padding:30px">
      <div class="meta">${esc(AS_CUR.title)}</div>
      <div style="font-size:50px;font-weight:800;margin:6px 0;color:${d.passed?'var(--mg-green)':'var(--mg-red)'}">${d.percent}%</div>
      <div style="font-size:16px;font-weight:600">${d.passed?'Congratulations — you passed!':'Not passed this time.'}</div>
      <div class="meta" style="margin-top:8px">You answered ${d.score} of ${d.total} correctly. Pass mark is ${d.pass_percent}%.</div>
      ${newCerts.length?`<div style="margin-top:12px;padding:10px;background:#e1f5ee;border-radius:8px;color:#085041;font-weight:600">🎉 You also earned: ${newCerts.map(esc).join(", ")}!</div>`:''}
      <div style="margin-top:18px">
        <button class="btn btn-sec" onclick="loadAssessments()">Back to assessments</button>
        ${AS_LASTCERT?'<button class="btn btn-pri" onclick="viewCertFromResult()">View certificate</button>':''}
      </div>
    </div>`;
  showAsView('result');
  // After PASSING, ask for a course rating (required, once per course).
  if(d.passed && !d.duplicate){ openCourseRating(AS_CUR.id, AS_CUR.title); }
}

function viewCertFromResult(){
  if(!AS_LASTCERT) return;
  showTab('certs');
  setTimeout(()=>openCert(AS_LASTCERT), 50);
}

/* ---------------- CERTIFICATES ---------------- */
async function loadCertificates(){
  $('certView').classList.add('hide');
  document.querySelector('#tab-certs .sectiontitle').style.display='';
  const box = $('certListBox'); box.style.display='';
  try{
    const d = await (await fetch('/api/my-certificates')).json();
    const list = (d && d.certificates) || [];
    if(list.length===0){ box.innerHTML = '<div class="empty">No certificates yet. Pass an assessment to earn one.</div>'; return; }

    // heads-up banner if anything is expiring or expired
    const expired = list.filter(c=>c.expiry_state==='expired').length;
    const expiring = list.filter(c=>c.expiry_state==='expiring').length;
    let banner = '';
    if(expired || expiring){
      const parts = [];
      if(expired) parts.push(`<b>${expired}</b> expired`);
      if(expiring) parts.push(`<b>${expiring}</b> expiring soon`);
      const col = expired ? '#e24b4a' : '#c98a00';
      const bg = expired ? '#fdecec' : '#fff7e6';
      banner = `<div style="background:${bg};border:1px solid ${col}55;border-left:4px solid ${col};
        border-radius:8px;padding:11px 14px;margin-bottom:14px;font-size:13px;color:${col}">
        ⚠ You have ${parts.join(' and ')}. Please re-certify to stay current.</div>`;
    }
    box.innerHTML = banner + list.map((c,i)=>{
      const isCompletion = c.type === 'completion';
      const scoreLine = (c.score!=null) ? `Score ${c.score}% · ${esc(c.date)}` : esc(c.date);
      const icon = isCompletion ? '🎖️' : '🏅';
      const tag = isCompletion ? '<span class="badge b-pass">Completion</span>' : '';
      // expiry status line (only track certificates carry this)
      let expiryLine = '';
      if(c.expiry_state === 'valid'){
        expiryLine = `<div style="font-size:12px;color:#1d9e75;margin-top:3px">✓ Valid until ${esc(c.expiry_date)}</div>`;
      } else if(c.expiry_state === 'expiring'){
        const dl = c.days_left;
        expiryLine = `<div style="font-size:12px;color:#c98a00;font-weight:600;margin-top:3px">⚠ Expires in ${dl} day${dl===1?'':'s'} (${esc(c.expiry_date)}) — please re-certify</div>`;
      } else if(c.expiry_state === 'expired'){
        expiryLine = `<div style="font-size:12px;color:#e24b4a;font-weight:600;margin-top:3px">✗ Expired on ${esc(c.expiry_date)} — please re-certify</div>`;
      }
      return `<div class="as-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div><h4>${icon} ${esc(c.assessment)} ${tag}</h4>
            <div class="meta">${scoreLine}</div>${expiryLine}</div>
          <button class="btn btn-pri" onclick='openCert(${JSON.stringify(c).replace(/'/g,"&#39;")})'>View certificate</button>
        </div></div>`;
    }).join('');
  }catch(e){ box.innerHTML = '<div class="empty">Could not load certificates.</div>'; }
}

// ---- Certificate designs: colour + title per achievement ----
const CERT_STYLES = [
  { match: /induction/i,                      colour:"#00AEEF", title:"Certificate of Induction",  badge:"INDUCTION"   },
  { match: /\bbdm\b|business development manager/i, colour:"#534ab7", title:"Certified BDM",       badge:"MANAGEMENT"  },
  { match: /\bbde\b|business development exec/i,   colour:"#1d9e75", title:"Certified BDE",       badge:"BUSINESS DEVELOPMENT" },
  { match: /state\s*head/i,                   colour:"#c98a00", title:"Certified State Head",     badge:"LEADERSHIP"  },
  { match: /\brsm\b|regional sales/i,         colour:"#e24b4a", title:"Certified RSM",            badge:"REGIONAL SALES" },
  { match: /\bnsm\b|national sales/i,         colour:"#0b7a8c", title:"Certified NSM",            badge:"NATIONAL SALES" }
];

function certStyleFor(c){
  // both assessment certs and completion certs put their name in c.assessment
  const text = String(c.assessment || "");
  for(const s of CERT_STYLES){
    if(s.match.test(text)) return s;
  }
  // default (any other achievement) — brand blue
  return { colour:"#00AEEF", title:"Certificate of Achievement", badge:"ACHIEVEMENT" };
}

function openCert(c){
  if(!c){ return; }
  const st = certStyleFor(c);

  // one CSS variable drives every coloured element in the certificate
  const card = $('certCard');
  if(card) card.style.setProperty('--cert-c', st.colour);

  // null-safe setter: if an element is missing, skip it instead of crashing
  const setTxt = (id, val)=>{ const el = $(id); if(el) el.textContent = val; };
  setTxt('certTitle', st.title);
  setTxt('certBadge', st.badge);
  setTxt('certName', c.name);
  setTxt('certAssessment', c.assessment);

  // completion certs have no score — assessment certs show the score
  const wrap = $('certScoreWrap');
  if(wrap){
    wrap.innerHTML = (c.score != null)
      ? ' <span style="color:#8a97a1">· scored</span> <b>' + c.score + '%</b><br><span style="font-size:9.5px;color:#9aa6ae">Issued on ' + esc(c.date) + '</span>'
      : '<br><span style="font-size:9.5px;color:#9aa6ae">Issued on ' + esc(c.date) + '</span>';
  }

  const sec = document.querySelector('#tab-certs .sectiontitle');
  if(sec) sec.style.display='none';
  const listBox = $('certListBox'); if(listBox) listBox.style.display='none';
  const view = $('certView'); if(view) view.classList.remove('hide');
}
function closeCert(){
  $('certView').classList.add('hide');
  document.querySelector('#tab-certs .sectiontitle').style.display='';
  $('certListBox').style.display='';
}

// Reliable certificate download (works on Android + iPhone, unlike window.print()).
// Snapshots the certificate card to a PNG and triggers a download / share.
async function downloadCert(){
  const card = $('certCard');
  const btn = $('certDlBtn');
  if(!card){ return; }
  if(typeof html2canvas === 'undefined'){
    window.print();   // library didn't load — fall back to print
    return;
  }
  const oldLabel = btn ? btn.textContent : '';
  if(btn){ btn.textContent = 'Preparing…'; btn.disabled = true; }
  const restore = ()=>{ if(btn){ btn.textContent = oldLabel; btn.disabled = false; } };
  try{
    const canvas = await html2canvas(card, {
      scale: 2,                 // higher-res so text is crisp
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false
    });
    const nameSafe = ($('certName').textContent || 'certificate')
      .trim().replace(/[^\w]+/g, '_');
    const fname = 'Certificate_' + nameSafe + '.png';

    canvas.toBlob(async (blob)=>{
      if(!blob){ restore(); return; }
      const file = new File([blob], fname, { type: 'image/png' });
      // Prefer the native share sheet on mobile (save to Photos / Files)
      if(navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({ files: [file], title: 'My Certificate' });
          restore();
          return;
        }catch(e){ /* user cancelled — fall through to direct download */ }
      }
      // Direct download (desktop + Android Chrome)
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
      restore();
    }, 'image/png');
  }catch(e){
    restore();
    window.print();   // last-resort fallback
  }
}

/* ---------------- misc ---------------- */
function esc(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function doSignOut(){
  try{ await fetch('/api/logout', {method:'POST'}); }catch(e){}
  location.href = '/';
}

/* ---------------- RATINGS / FEEDBACK (required) ---------------- */
let RT = { mode:null, moduleId:null, assessmentId:null, trainerId:null, stars:{content:0,trainer:0,course:0} };

function starRow(key, label){
  let s = '<div style="margin:10px 0"><div style="font-size:13px;font-weight:600;margin-bottom:4px">'+label+'</div><div class="rt-stars" data-key="'+key+'">';
  for(let i=1;i<=5;i++){
    s += '<span class="rt-star" data-key="'+key+'" data-v="'+i+'" onclick="rtPick(\''+key+'\','+i+')" style="font-size:30px;cursor:pointer;color:#d6dde3;line-height:1">★</span>';
  }
  return s + '</div></div>';
}

function rtPick(key, v){
  RT.stars[key] = v;
  document.querySelectorAll('.rt-star[data-key="'+key+'"]').forEach(el=>{
    el.style.color = (parseInt(el.getAttribute('data-v'),10) <= v) ? '#f5a623' : '#d6dde3';
  });
}

async function openModuleRating(moduleId, title){
  RT = { mode:'module', moduleId:moduleId, assessmentId:null, trainerId:null, stars:{content:0,trainer:0,course:0} };
  // fetch all trainers for the dropdown (+ the suggested one for this module)
  let trainers = [], suggested = null;
  try{
    const r = await (await fetch('/api/rating/trainers?module_id='+encodeURIComponent(moduleId),{cache:'no-store'})).json();
    if(r && r.ok){ trainers = r.trainers || []; suggested = r.suggested || null; }
  }catch(e){}
  let opts = '<option value="">— Select the trainer who took this module —</option>' +
    trainers.map(function(t){
      const lbl = esc(t.name) + (t.designation ? ' · ' + esc(t.designation) : '');
      return '<option value="'+esc(t.emp_id)+'"'+(t.emp_id===suggested?' selected':'')+'>'+lbl+'</option>';
    }).join('');
  $('rtTitle').textContent = 'Rate: ' + (title||'this module');
  $('rtBody').innerHTML =
    '<div style="margin:4px 0 12px"><div style="font-size:13px;font-weight:600;margin-bottom:4px">Who took this training? ★</div>'+
    '<select id="rtTrainer" style="width:100%;box-sizing:border-box;border:1px solid var(--mg-line,#ccc);border-radius:8px;padding:9px;font-family:inherit;font-size:13px">'+opts+'</select></div>' +
    starRow('trainer','Rate this trainer ★') +
    starRow('content','How good was the training content? ★') +
    '<div style="margin-top:10px"><div style="font-size:13px;font-weight:600;margin-bottom:4px">Comments (optional)</div>'+
    '<textarea id="rtComment" rows="3" style="width:100%;box-sizing:border-box;border:1px solid var(--mg-line,#ccc);border-radius:8px;padding:8px;font-family:inherit;font-size:13px" placeholder="What went well / what could improve?"></textarea></div>';
  $('rtModal').classList.add('show');
}

function openCourseRating(assessmentId, title){
  RT = { mode:'course', moduleId:null, assessmentId:assessmentId, trainerId:null, stars:{content:0,trainer:0,course:0} };
  $('rtTitle').textContent = 'Rate the course: ' + (title||'');
  $('rtBody').innerHTML =
    starRow('course','How would you rate this course overall? ★') +
    '<div style="margin-top:10px"><div style="font-size:13px;font-weight:600;margin-bottom:4px">Comments (optional)</div>'+
    '<textarea id="rtComment" rows="3" style="width:100%;box-sizing:border-box;border:1px solid var(--mg-line,#ccc);border-radius:8px;padding:8px;font-family:inherit;font-size:13px" placeholder="Anything you\'d like to add…"></textarea></div>';
  $('rtModal').classList.add('show');
}

// Close/skip the feedback popup (optional). If a login catch-up queue is
// running, skipping closes the whole queue for this session.
function closeRating(){
  $('rtModal').classList.remove('show');
  if(RT_QUEUE && RT_QUEUE.active){ RT_QUEUE.active = false; }
}

async function submitRating(){
  const comment = ($('rtComment') && $('rtComment').value || '').trim();
  let body;
  if(RT.mode === 'module'){
    const chosenTrainer = ($('rtTrainer') && $('rtTrainer').value || '').trim();
    if(!chosenTrainer){ alert('Please select the trainer who took this module.'); return; }
    if(!RT.stars.trainer){ alert('Please give a star rating for the trainer.'); return; }
    if(!RT.stars.content){ alert('Please give a star rating for the content.'); return; }
    body = { target_type:'module', module_id:RT.moduleId, trainer_id:chosenTrainer,
             content_rating:RT.stars.content, trainer_rating:RT.stars.trainer, comment:comment };
  } else if(RT.mode === 'course'){
    if(!RT.stars.course){ alert('Please give the course a star rating.'); return; }
    body = { target_type:'course', assessment_id:RT.assessmentId, course_rating:RT.stars.course, comment:comment };
  } else { return; }
  let r;
  try{ r = await (await fetch('/api/rating/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json(); }
  catch(e){ alert('Could not save — please try again.'); return; }
  if(r && r.ok){
    $('rtModal').classList.remove('show');
    // if a catch-up queue is active, move to the next pending item
    if(RT_QUEUE.active){ RT_QUEUE.idx++; setTimeout(showNextCatchup, 200); }
    else {
      // refresh module lists so the "Rate" button flips to "Rated"
      try{
        const active = document.querySelector('.pt-tab.active');
        const tab = active ? active.getAttribute('data-tab') : '';
        if(tab==='induction') loadFileModules('induction');
        if(tab==='training') loadFileModules('training');
      }catch(e){}
    }
  }
  else { alert((r && r.msg) || 'Could not save your rating.'); }
}

/* ---------- Catch-up: rate previously-completed modules/courses ---------- */
let RT_QUEUE = { active:false, items:[], idx:0 };

async function startRatingCatchup(){
  // staff only; ask for up to 3 pending ratings on login
  let d;
  try{ d = await (await fetch('/api/rating/pending?limit=3',{cache:'no-store'})).json(); }
  catch(e){ return; }
  if(!d || !d.ok || !d.is_staff) return;
  if(!d.items || !d.items.length) return;
  RT_QUEUE = { active:true, items:d.items, idx:0, total:d.total };
  showNextCatchup();
}

function showNextCatchup(){
  if(!RT_QUEUE.active) return;
  if(RT_QUEUE.idx >= RT_QUEUE.items.length){
    // this batch done — if more remain overall, tell them; end the queue for now
    RT_QUEUE.active = false;
    if(RT_QUEUE.total > RT_QUEUE.items.length){
      alert("Thanks! You have more trainings to rate — we'll ask for the rest next time you log in.");
    }
    return;
  }
  const item = RT_QUEUE.items[RT_QUEUE.idx];
  if(item.type === 'module'){ openModuleRating(item.id, item.title); }
  else if(item.type === 'course'){ openCourseRating(item.id, item.title); }
  else { RT_QUEUE.idx++; showNextCatchup(); }
}

/* start */
boot();
loadPendingBadges();
setTimeout(startRatingCatchup, 1200);