/* ============================================================
   Mr. Golisoda LMS — "My Record" for learners.
   Who trained them (induction/training) + their own completion,
   assessment scores and pass attempts. Self-wires into showTab().
   ============================================================ */
(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  var css = document.createElement("style");
  css.textContent = [
    "#myRecord .rhero{background:linear-gradient(135deg,#12284B,#1F5FA9);color:#fff;border-radius:16px;padding:20px 22px;margin-bottom:14px}",
    "#myRecord .rhero h2{margin:0;font-size:20px}",
    "#myRecord .rhero p{margin:4px 0 0;font-size:13px;opacity:.9}",
    "#myRecord .rcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:14px}",
    "#myRecord .rcard{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:14px;padding:16px 18px}",
    "#myRecord .rcard .rv{font-size:26px;font-weight:800;color:#12284B;line-height:1.1}",
    "#myRecord .rcard .rl{font-size:12px;color:#62707a;margin-top:3px}",
    "#myRecord .rsec{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:14px;padding:16px;margin-bottom:14px}",
    "#myRecord .rsec h4{margin:0 0 10px;font-size:14px;color:#12284B}",
    "#myRecord .chip{display:inline-block;background:#eef5fc;color:#0c447c;border:1px solid #cddff0;border-radius:20px;padding:3px 11px;font-size:12.5px;margin:2px 4px 2px 0}",
    "#myRecord table{width:100%;border-collapse:collapse;font-size:12.5px}",
    "#myRecord th{background:#12284B;color:#fff;padding:7px 6px;text-align:left;font-size:11.5px}",
    "#myRecord td{border-bottom:1px solid #f0f0f0;padding:7px 6px}",
    "#myRecord .prog{height:10px;background:#eef2f5;border-radius:6px;overflow:hidden;margin-top:5px}",
    "#myRecord .prog i{display:block;height:100%}"
  ].join("\n");
  document.head.appendChild(css);

  async function getJ(u){ try{ return await (await fetch(u,{credentials:"same-origin"})).json(); }catch(e){ return {ok:false}; } }

  async function render(){
    var box=$("myRecord"); if(!box) return;
    box.innerHTML='<div class="empty">Loading…</div>';
    var d=await getJ("/api/training/my-record");
    if(!d||!d.ok){ box.innerHTML='<div class="empty">Could not load your record.</div>'; return; }

    function pct(a,b){ return b?Math.round(a*100/b):0; }
    function bar(a,b){ var p=pct(a,b),c=p>=100?"#1d9e75":(p>=50?"#c9a227":"#d64545"); return '<div class="prog"><i style="width:'+p+'%;background:'+c+'"></i></div>'; }

    // overall numbers
    var passed=0, attemptsTotal=0;
    (d.assessments||[]).forEach(function(a){ if(a.pass_attempt) passed++; attemptsTotal+=a.attempts; });
    var bestAvg = (function(){ var v=(d.assessments||[]).filter(function(a){return a.best!=null;}).map(function(a){return a.best;}); return v.length?Math.round(v.reduce(function(s,x){return s+x;},0)/v.length):null; })();

    var hero='<div class="rhero"><h2>'+esc(d.me.name)+'</h2>'+
      '<p>'+esc(d.me.emp_id)+(d.me.designation?' · '+esc(d.me.designation):'')+' — your training record</p></div>';

    var cards='<div class="rcards">'+
      '<div class="rcard"><div class="rv">'+d.ind_done+'/'+d.ind_total+'</div><div class="rl">Induction modules'+bar(d.ind_done,d.ind_total)+'</div></div>'+
      '<div class="rcard"><div class="rv">'+d.trn_done+'/'+d.trn_total+'</div><div class="rl">Training modules'+bar(d.trn_done,d.trn_total)+'</div></div>'+
      '<div class="rcard"><div class="rv">'+passed+'/'+(d.assessments||[]).length+'</div><div class="rl">Assessments passed</div></div>'+
      '<div class="rcard"><div class="rv">'+(bestAvg!=null?bestAvg+'%':'—')+'</div><div class="rl">Your average score</div></div>'+
    '</div>';

    // who trained me
    function who(arr){ return arr&&arr.length ? arr.map(function(x){return '<span class="chip">👤 '+esc(x)+'</span>';}).join("") : '<span style="color:#aaa;font-size:12.5px">Not recorded yet</span>'; }
    var trainers='<div class="rsec"><h4>Who trained you</h4>'+
      '<div style="font-size:12.5px;color:#62707a;margin-bottom:4px">Induction</div>'+who(d.induction_by)+
      '<div style="font-size:12.5px;color:#62707a;margin:10px 0 4px">Training</div>'+who(d.training_by)+'</div>';

    // assessment detail
    var aRows=(d.assessments||[]).map(function(a){
      var st = a.pass_attempt
        ? '<span style="color:#0f6b45;font-weight:700">Passed on attempt '+a.pass_attempt+'</span>'
        : (a.attempts ? '<span style="color:#9e2b2b">Not passed ('+a.attempts+' attempt'+(a.attempts===1?'':'s')+')</span>' : '<span style="color:#aaa">Not attempted</span>');
      return '<tr><td><b>'+esc(a.title)+'</b></td><td style="text-align:center">'+(a.best!=null?a.best+'%':'—')+'</td><td style="text-align:center">'+a.attempts+'</td><td>'+st+'</td></tr>';
    }).join("");
    var assess = (d.assessments||[]).length
      ? '<div class="rsec"><h4>Your assessments</h4><div style="overflow-x:auto"><table><thead><tr><th>Assessment</th><th style="text-align:center">Best</th><th style="text-align:center">Attempts</th><th>Result</th></tr></thead><tbody>'+aRows+'</tbody></table></div></div>'
      : '';

    box.innerHTML = hero + cards + trainers + assess;
  }

  // self-wire
  document.addEventListener("DOMContentLoaded", function(){
    var _os=window.showTab;
    window.showTab=function(w){ if(_os)_os(w); if(w==="myrecord") render(); };
  });
  if(document.readyState!=="loading"){ var _os2=window.showTab; window.showTab=function(w){ if(_os2)_os2(w); if(w==="myrecord") render(); }; }
})();
