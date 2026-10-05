/* ============================================================
   Mr. Golisoda LMS — Home dashboard (admin / instructor).
   Clean cards + attention strip + simple charts. Cards click
   through to their tab. Self-wires into admin switchTab().
   ============================================================ */
(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  var css = document.createElement("style");
  css.textContent = [
    "#dashRoot{padding:4px 2px}",
    "#dashRoot .dhead{font-size:20px;font-weight:800;color:#12284B;margin:4px 0 2px}",
    "#dashRoot .dsub{color:#62707a;font-size:13px;margin-bottom:16px}",
    "#dashRoot .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px}",
    "#dashRoot .card{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:14px;padding:16px 18px;cursor:pointer;transition:box-shadow .15s,transform .15s;position:relative}",
    "#dashRoot .card:hover{box-shadow:0 6px 18px rgba(18,40,75,.10);transform:translateY(-2px)}",
    "#dashRoot .card .v{font-size:30px;font-weight:800;color:#12284B;line-height:1.1}",
    "#dashRoot .card .l{font-size:12.5px;color:#62707a;margin-top:4px}",
    "#dashRoot .card.alert{border-color:#f0c98b;background:#fff9ef}",
    "#dashRoot .card.alert .v{color:#b5790b}",
    "#dashRoot .card .dot{position:absolute;top:12px;right:12px;width:9px;height:9px;border-radius:50%;background:#e0a82e}",
    "#dashRoot .att{background:#fff7e6;border:1px solid #f0d9a0;border-radius:12px;padding:12px 14px;margin-bottom:18px}",
    "#dashRoot .att b{color:#845a0b}",
    "#dashRoot .att .ai{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;cursor:pointer}",
    "#dashRoot .att .ai:hover{text-decoration:underline}",
    "#dashRoot .panes{display:grid;grid-template-columns:1fr 1fr;gap:14px}",
    "@media(max-width:720px){#dashRoot .panes{grid-template-columns:1fr}}",
    "#dashRoot .pane{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:14px;padding:16px}",
    "#dashRoot .pane h4{margin:0 0 12px;font-size:14px;color:#12284B}",
    "#dashRoot .bar-row{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:12.5px}",
    "#dashRoot .bar-row .nm{width:120px;color:#42515c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    "#dashRoot .bar-row .tk{flex:1;height:14px;background:#eef2f5;border-radius:7px;overflow:hidden}",
    "#dashRoot .bar-row .tk i{display:block;height:100%;background:#1F5FA9}",
    "#dashRoot .bar-row .vv{width:38px;text-align:right;font-weight:700;color:#12284B}",
    "#dashRoot .recent .ri{font-size:12.5px;padding:5px 0;border-bottom:1px solid #f0f0f0;color:#42515c}"
  ].join("\n");
  document.head.appendChild(css);

  async function getJ(u){ try{ return await (await fetch(u,{credentials:"same-origin"})).json(); }catch(e){ return {ok:false}; } }

  function go(tab){ if(tab && typeof window.switchTab === "function") window.switchTab(tab); }

  function cardHtml(c){
    return '<div class="card'+(c.alert?" alert":"")+'"'+(c.tab?' data-go="'+esc(c.tab)+'"':"")+'>'+
      (c.alert?'<span class="dot"></span>':"")+
      '<div class="v">'+esc(c.value)+'</div><div class="l">'+esc(c.label)+'</div></div>';
  }

  function barChart(title, rows){
    if(!rows || !rows.length) return "";
    var max = Math.max.apply(null, rows.map(function(r){ return r.value; })) || 1;
    var body = rows.map(function(r){
      return '<div class="bar-row"><span class="nm">'+esc(r.label)+'</span>'+
        '<span class="tk"><i style="width:'+Math.round(r.value*100/max)+'%"></i></span>'+
        '<span class="vv">'+esc(r.value)+'</span></div>';
    }).join("");
    return '<div class="pane"><h4>'+esc(title)+'</h4>'+body+'</div>';
  }

  async function render(){
    var root = $("dashRoot"); if(!root) return;
    root.innerHTML = '<div class="empty">Loading…</div>';
    var d = await getJ("/api/dashboard/home");
    if(!d || !d.ok){ root.innerHTML = '<div class="empty">Could not load the dashboard.</div>'; return; }

    var hello = d.me ? ("Welcome back, " + esc(d.me.name.split(" ")[0]) + " 👋") : "Dashboard";
    var cards = '<div class="cards">' + (d.cards||[]).map(cardHtml).join("") + '</div>';

    var att = "";
    if(d.attention && d.attention.length){
      att = '<div class="att"><b>Needs your attention</b>' +
        d.attention.map(function(a){ return '<div class="ai" data-go="'+esc(a.tab||"")+'">• '+esc(a.text)+' <span style="color:#1F5FA9">→</span></div>'; }).join("") +
        '</div>';
    }

    var panes = "";
    if(d.charts){
      var c1 = barChart("Learners by designation", d.charts.designation);
      var c2 = barChart("Assessments: passed vs failed", d.charts.assessments);
      if(c1 || c2) panes += '<div class="panes">' + c1 + c2 + '</div>';
    }

    // OJT + audits quick panes for admin/instructor
    var extra = "";
    if(d.ojt && (d.role === "admin" || d.role === "instructor")){
      var ojtPane = '<div class="pane"><h4>OJT</h4>'+
        '<div class="bar-row"><span class="nm">In training</span><span class="tk"><i style="width:'+(d.ojt.active?100:0)+'%"></i></span><span class="vv">'+esc(d.ojt.active)+'</span></div>'+
        '<div class="bar-row"><span class="nm">Completed</span><span class="tk"><i style="width:'+(d.ojt.completed?100:0)+'%;background:#1d9e75"></i></span><span class="vv">'+esc(d.ojt.completed)+'</span></div></div>';
      var audPane = d.audits ? '<div class="pane"><h4>Route audits</h4>'+
        '<div class="bar-row"><span class="nm">To verify</span><span class="tk"><i style="width:'+(d.audits.submitted?100:0)+'%;background:#e0a82e"></i></span><span class="vv">'+esc(d.audits.submitted)+'</span></div>'+
        '<div class="bar-row"><span class="nm">Verified</span><span class="tk"><i style="width:'+(d.audits.verified?100:0)+'%;background:#1d9e75"></i></span><span class="vv">'+esc(d.audits.verified)+'</span></div></div>' : "";
      if(ojtPane || audPane) extra += '<div class="panes" style="margin-top:14px">' + ojtPane + audPane + '</div>';
    }

    var recent = "";
    if(d.recent && d.recent.length){
      recent = '<div class="pane recent" style="margin-top:14px"><h4>Recent activity</h4>' +
        d.recent.map(function(r){ return '<div class="ri"><b>'+esc(r.who||"")+'</b> '+esc(r.action||"")+(r.what?' · '+esc(r.what):"")+'</div>'; }).join("") +
        '</div>';
    }

    root.innerHTML = '<div class="dhead">'+hello+'</div>'+
      '<div class="dsub">Here\'s your overview at a glance.</div>'+
      cards + att + panes + extra + recent;

    root.querySelectorAll("[data-go]").forEach(function(el){
      el.addEventListener("click", function(){ go(el.dataset.go); });
    });
  }

  // self-wire: load when Home tab is shown, and on first load (Home is default)
  document.addEventListener("DOMContentLoaded", function(){
    var _os = window.switchTab;
    window.switchTab = function(which){ if(_os) _os(which); if(which === "home") render(); };
    if($("dashRoot")) render();
  });
  if(document.readyState !== "loading"){
    var _os2 = window.switchTab;
    window.switchTab = function(w){ if(_os2) _os2(w); if(w === "home") render(); };
    if($("dashRoot")) render();
  }
})();
