/* ============================================================
   Mr. Golisoda LMS — "Route Audit" tab for field staff.
   Phone-friendly Daily Route Audit form with live calculations,
   auto WhatsApp summary, and a list of the person's own audits.
   Self-wires into the portal's showTab().
   ============================================================ */
(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function num(v){ var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function fmtD(iso){ if(!iso) return ""; return new Date(iso.slice(0,10)+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); }

  var css = document.createElement("style");
  css.textContent = [
    "#myAudit .ac{background:#fff;border:1px solid var(--mg-line);border-radius:12px;padding:14px;margin-bottom:12px}",
    "#myAudit h4{margin:0 0 8px;font-size:14px;color:#12284B}",
    "#myAudit label.fl{display:block;font-size:12px;color:#62707a;margin:6px 0 2px}",
    "#myAudit input,#myAudit select,#myAudit textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--mg-line);border-radius:8px;font-size:14px;font-family:inherit}",
    "#myAudit table{width:100%;border-collapse:collapse;font-size:12.5px}",
    "#myAudit th{background:#12284B;color:#fff;padding:5px 4px;font-size:11px;font-weight:600}",
    "#myAudit td{border-bottom:1px solid #f0f0f0;padding:3px}",
    "#myAudit td input{padding:5px;text-align:center;font-size:13px}",
    "#myAudit .calc{background:#eef5fc;border:1px solid #cddff0;border-radius:8px;padding:8px 10px;font-size:12.5px;margin-top:6px}",
    "#myAudit .calc b{color:#0c447c}",
    "#myAudit .yn{display:flex;gap:4px}",
    "#myAudit .yn button{flex:1;padding:5px;border:1px solid var(--mg-line);background:#fff;border-radius:6px;font-size:12px;cursor:pointer}",
    "#myAudit .yn button.on-yes{background:#1d9e75;color:#fff;border-color:#1d9e75}",
    "#myAudit .yn button.on-no{background:#d64545;color:#fff;border-color:#d64545}",
    "#myAudit .yn button.on-na{background:#8a97a1;color:#fff;border-color:#8a97a1}",
    "#myAudit .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
    "#myAudit .btn{padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none}",
    "#myAudit .btn.pri{background:var(--mg-blue,#1F5FA9);color:#fff}",
    "#myAudit .btn.sec{background:#eef2f5;color:#12284B}",
    "#myAudit .alist .arow{background:#fff;border:1px solid var(--mg-line);border-radius:10px;padding:11px 13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px}",
    "#myAudit .pill{padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600}",
    "#myAudit .pill.sub{background:#faf1de;color:#845a0b}#myAudit .pill.ver{background:#eaf7f0;color:#0f6b45}",
    "#myAudit .wa{white-space:pre-wrap;background:#f7f9fa;border:1px dashed var(--mg-line);border-radius:8px;padding:10px;font-size:12px;font-family:monospace}"
  ].join("\n");
  document.head.appendChild(css);

  var CFG = null, EDIT_ID = null;

  async function getJ(u){ try{ return await (await fetch(u,{credentials:"same-origin"})).json(); }catch(e){ return {ok:false}; } }
  async function postJ(u,b){ try{ return await (await fetch(u,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})).json(); }catch(e){ return {ok:false,msg:"Network problem."}; } }
  function note(m){ var n=document.createElement("div"); n.textContent=m; n.style.cssText="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#12284B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999"; document.body.appendChild(n); setTimeout(function(){n.remove();},2400); }

  async function loadList(){
    var box = $("myAudit"); if(!box) return;
    if(!CFG){ var cf = await getJ("/api/audit/config"); CFG = (cf&&cf.ok)?cf:null; }
    if(!CFG){ box.innerHTML='<div class="empty">Could not load.</div>'; return; }
    var d = await getJ("/api/audit/my");
    var audits = (d&&d.ok)?d.audits:[];
    var rows = audits.length ? audits.map(function(a){
      return '<div class="arow"><div><b>'+esc(a.route||"(no route)")+'</b><br><span style="font-size:12px;color:#62707a">'+esc(fmtD(a.audit_date))+(a.franchise?" · "+esc(a.franchise):"")+'</span></div>'+
        '<div style="text-align:right"><span class="pill '+(a.status==="verified"?"ver":"sub")+'">'+(a.status==="verified"?"Verified":"Submitted")+'</span><br>'+
        '<button class="btn sec" style="margin-top:5px;padding:4px 10px;font-size:12px" onclick="__auditOpen('+a.id+')">Open</button></div></div>';
    }).join("") : '<div class="empty" style="padding:16px">No audits yet. Tap “New audit” to start.</div>';
    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
        '<div class="sectiontitle" style="margin:0">My Route Audits</div>'+
        '<button class="btn pri" onclick="__auditNew()">＋ New audit</button></div>'+
      '<div class="alist">'+rows+'</div>';
  }

  function flavourRows(vals){
    return CFG.settings.flavours.map(function(f){
      var v = (vals&&vals[f])||{};
      return '<tr data-fl="'+esc(f)+'"><td style="text-align:left;padding-left:6px">'+esc(f)+'</td>'+
        '<td><input type="number" min="0" class="afl" data-k="gp" value="'+(v.gp||"")+'" placeholder="0"></td>'+
        '<td><input type="number" min="0" class="afl" data-k="pp" value="'+(v.pp||"")+'" placeholder="0"></td>'+
        '<td><input type="number" min="0" class="afl" data-k="gs" value="'+(v.gs||"")+'" placeholder="0"></td>'+
        '<td><input type="number" min="0" class="afl" data-k="ps" value="'+(v.ps||"")+'" placeholder="0"></td></tr>';
    }).join("");
  }

  function renderForm(a){
    var box = $("myAudit");
    var p = (a&&a.payload)||{};
    EDIT_ID = a? a.id : null;
    var me = CFG.me, s = CFG.settings;
    var checks = p.checks||{}, cremarks = p.check_remarks||{}, nums = p.numbers||{};
    var checkHtml = CFG.checks.map(function(item,i){
      var cur = checks[i]||checks[String(i)]||"";
      function b(val,cls,lbl){ return '<button type="button" data-ci="'+i+'" data-val="'+val+'" class="'+(cur===val?("on-"+cls):"")+'">'+lbl+'</button>'; }
      return '<div style="padding:7px 0;border-bottom:1px solid #f0f0f0">'+
        '<div style="font-size:13px;margin-bottom:4px">'+(i+1)+". "+esc(item)+'</div>'+
        '<div class="yn">'+b("Yes","yes","Yes")+b("No","no","No")+b("N.A.","na","N.A.")+'</div>'+
        '<input type="text" class="acr" data-ci="'+i+'" placeholder="Remarks (optional)" value="'+esc(cremarks[i]||cremarks[String(i)]||"")+'" style="margin-top:4px;font-size:12px">'+
        '</div>';
    }).join("");
    var numHtml = CFG.numbers.map(function(n){
      return '<label class="fl">'+esc(n[1])+'</label><input type="number" min="0" class="anum" data-k="'+n[0]+'" value="'+(nums[n[0]]||"")+'" placeholder="0">';
    }).join("");

    box.innerHTML =
      '<button class="btn sec" onclick="__auditList()" style="margin-bottom:10px">← Back to my audits</button>'+
      (a&&a.status==="verified"?'<div class="ac" style="background:#eaf7f0;border-color:#b7e3ca;color:#0f6b45"><b>✔ Verified</b> by '+esc(a.verified_by||"trainer")+' — this audit is locked.</div>':'')+
      // details
      '<div class="ac"><h4>Audit details</h4>'+
        '<div class="row2"><div><label class="fl">BDE Name</label><input id="a_name" value="'+esc(me.name)+'" readonly></div>'+
        '<div><label class="fl">Employee ID</label><input value="'+esc(me.emp_id)+'" readonly></div></div>'+
        '<div class="row2"><div><label class="fl">Route Audited</label><input id="a_route" value="'+esc(p.route||"")+'" placeholder="Route 1 - Chennai 1"></div>'+
        '<div><label class="fl">Franchise / City</label><input id="a_fr" value="'+esc(p.franchise||"")+'" placeholder="Thiruvallur Franchise"></div></div>'+
        '<div class="row2"><div><label class="fl">Went With (Senior BDE / BDM)</label><input id="a_with" value="'+esc(p.went_with||"")+'" placeholder="BDE / BDM name"></div>'+
        '<div><label class="fl">Audit Date</label><input id="a_date" type="date" value="'+esc((p.audit_date||new Date().toISOString().slice(0,10)).slice(0,10))+'"></div></div></div>'+
      // targets
      '<div class="ac"><h4>Target calculation check</h4>'+
        '<label class="fl">Factory Trays available (actual count on site)</label>'+
        '<input id="a_trays" type="number" min="0" value="'+(p.factory_trays||"")+'" placeholder="1500">'+
        '<div class="calc" id="a_targetcalc"></div></div>'+
      // production
      '<div class="ac"><h4>Production & sales by flavour (bottles)</h4>'+
        '<div style="overflow-x:auto"><table><thead><tr><th style="text-align:left">Flavour</th><th>Glass<br>made</th><th>PET<br>made</th><th>Glass<br>sold</th><th>PET<br>sold</th></tr></thead>'+
        '<tbody id="a_fltbody">'+flavourRows(p.flavours)+'</tbody></table></div>'+
        '<div class="calc" id="a_prodcalc"></div>'+
        '<label class="fl" style="margin-top:8px">Empty bottles collected today</label>'+
        '<input id="a_empties" type="number" min="0" value="'+(p.empties||"")+'" placeholder="0"></div>'+
      // checks
      '<div class="ac"><h4>Store / route checks</h4>'+checkHtml+'</div>'+
      // numbers
      '<div class="ac"><h4>Daily numbers</h4>'+numHtml+'</div>'+
      // p&l
      '<div class="ac"><h4>Full P&L (₹)</h4>'+
        '<div class="row2"><div><label class="fl">Fixed Expenses (₹)</label><input id="a_fixed" type="number" min="0" value="'+(p.fixed_expenses||"")+'" placeholder="0"></div>'+
        '<div><label class="fl">Variable Expenses (₹)</label><input id="a_var" type="number" min="0" value="'+(p.variable_expenses||"")+'" placeholder="0"></div></div>'+
        '<div class="calc" id="a_plcalc"></div></div>'+
      // notes
      '<div class="ac"><h4>Notes / issues</h4><textarea id="a_notes" rows="3" placeholder="Anything else to note">'+esc(p.notes||"")+'</textarea></div>'+
      // whatsapp
      '<div class="ac"><h4>WhatsApp summary</h4><div class="wa" id="a_wa"></div>'+
        '<button class="btn sec" style="margin-top:8px" onclick="__auditCopyWA()">📋 Copy summary</button></div>'+
      // actions
      '<div style="display:flex;gap:10px;margin-bottom:30px">'+
        (a&&a.status==="verified"?"":'<button class="btn pri" style="flex:1" onclick="__auditSubmit()">'+(EDIT_ID?"Update audit":"Submit audit")+'</button>')+
        (EDIT_ID?'<button class="btn sec" onclick="__auditDelete('+EDIT_ID+')">Delete</button>':'')+
      '</div>';

    recompute();
    // live recompute on any input
    box.querySelectorAll("input,textarea").forEach(function(el){ el.addEventListener("input", recompute); });
    // yes/no/na buttons
    box.querySelectorAll(".yn button").forEach(function(b){
      b.addEventListener("click", function(){
        var ci=b.dataset.ci;
        box.querySelectorAll('.yn button[data-ci="'+ci+'"]').forEach(function(x){ x.className=""; });
        b.className = "on-"+(b.dataset.val==="Yes"?"yes":b.dataset.val==="No"?"no":"na");
      });
    });
  }

  function collect(){
    var box=$("myAudit");
    var fl={};
    box.querySelectorAll("#a_fltbody tr").forEach(function(tr){
      var name=tr.dataset.fl, o={};
      tr.querySelectorAll(".afl").forEach(function(i){ o[i.dataset.k]=i.value; });
      fl[name]=o;
    });
    var checks={}, cr={};
    box.querySelectorAll('.yn button[class^="on-"]').forEach(function(b){ checks[b.dataset.ci]=b.dataset.val; });
    box.querySelectorAll(".acr").forEach(function(i){ if(i.value.trim()) cr[i.dataset.ci]=i.value.trim(); });
    var nums={}; box.querySelectorAll(".anum").forEach(function(i){ nums[i.dataset.k]=i.value; });
    return {
      route:$("a_route").value.trim(), franchise:$("a_fr").value.trim(), went_with:$("a_with").value.trim(),
      audit_date:$("a_date").value, factory_trays:$("a_trays").value,
      flavours:fl, empties:$("a_empties").value, checks:checks, check_remarks:cr, numbers:nums,
      fixed_expenses:$("a_fixed").value, variable_expenses:$("a_var").value, notes:$("a_notes").value.trim()
    };
  }

  function recompute(){
    var s=CFG.settings, p=collect();
    // targets
    var trays=num(p.factory_trays);
    var maxc=s.trays_divisor?Math.floor(trays/s.trays_divisor):0;
    var weekly=maxc*s.routes, daily=s.routes?Math.floor(weekly/s.routes):0;
    var outlet=Math.ceil(daily*s.outlet_buffer);
    $("a_targetcalc").innerHTML="Max cases/day: <b>"+maxc+"</b> · Weekly max: <b>"+weekly+"</b> · Daily target/route: <b>"+daily+"</b> · Outlets needed: <b>"+outlet+"</b>";
    // production
    var gp=0,pp=0,gs=0,ps=0;
    Object.keys(p.flavours).forEach(function(k){ var r=p.flavours[k]; gp+=num(r.gp);pp+=num(r.pp);gs+=num(r.gs);ps+=num(r.ps); });
    $("a_prodcalc").innerHTML="Total produced: <b>"+(gp+pp)+"</b> · Total sold: <b>"+(gs+ps)+"</b> (Glass "+gs+" / PET "+ps+")";
    // p&l
    var rev=gs*s.glass_sell+ps*s.pet_sell, cost=gp*s.glass_cost+pp*s.pet_cost, gross=rev-cost;
    var net=gross-num(p.fixed_expenses)-num(p.variable_expenses);
    $("a_plcalc").innerHTML="Revenue: <b>₹"+Math.round(rev)+"</b> · Prod. cost: <b>₹"+Math.round(cost)+"</b> · Gross: <b>₹"+Math.round(gross)+"</b> · <b>Net: ₹"+Math.round(net)+"</b>";
    // whatsapp
    $("a_wa").textContent = buildWA(p, {gp:gp,pp:pp,gs:gs,ps:ps,rev:rev,cost:cost,gross:gross,net:net});
  }

  function buildWA(p, c){
    var s=CFG.settings, me=CFG.me, L=[];
    L.push("*MR. GOLISODA — DAILY SUMMARY*","==============");
    L.push("BDE: "+me.name+"   ID: "+me.emp_id);
    L.push("Route: "+(p.route||"")+"  ("+(p.went_with||"")+")");
    L.push("Date: "+(p.audit_date||""));
    L.push("==============","*PRODUCTION (made / sold):*");
    s.flavours.forEach(function(f){ var r=p.flavours[f]||{}; var made=num(r.gp)+num(r.pp), sold=num(r.gs)+num(r.ps); L.push("• "+f+": "+made+" made / "+sold+" sold"); });
    L.push("Total Produced: "+(c.gp+c.pp)+" bottles","Total Sold: "+(c.gs+c.ps)+" bottles","(Glass sold "+c.gs+" / PET sold "+c.ps+")");
    L.push("Empties collected: "+num(p.empties),"==============","*ROUTE NUMBERS:*");
    var n=p.numbers||{};
    L.push("• Stores visited: "+num(n.stores_visited));
    L.push("• Orders: "+num(n.orders_taken)+"   New outlets: "+num(n.new_outlets));
    L.push("• Payment: ₹"+num(n.payment_collected)+"   Issues: "+num(n.issues_found));
    L.push("==============","*P&L (today):*");
    L.push("• Revenue: ₹"+Math.round(c.rev),"• Prod. Cost: ₹"+Math.round(c.cost),"• Gross Profit: ₹"+Math.round(c.gross),"• Net Profit: ₹"+Math.round(c.net));
    L.push("==============","Submitted by: "+me.name);
    return L.join("\n");
  }

  // ---- global handlers (called from inline onclick) ----
  window.__auditNew = function(){ renderForm(null); };
  window.__auditList = function(){ loadList(); };
  window.__auditOpen = async function(id){ var d=await getJ("/api/audit/get?id="+id); if(d&&d.ok){ renderForm(d.audit); } else note((d&&d.msg)||"Could not open."); };
  window.__auditCopyWA = function(){ var t=$("a_wa").textContent; if(navigator.clipboard){ navigator.clipboard.writeText(t).then(function(){note("Summary copied.");},function(){note("Copy failed — long-press to copy.");}); } else note("Long-press the text to copy."); };
  window.__auditSubmit = async function(){
    var p=collect();
    if(!p.route){ note("Enter the route audited."); return; }
    var body={payload:p}; if(EDIT_ID) body.id=EDIT_ID;
    var r=await postJ("/api/audit/submit", body);
    if(r.ok){ note(r.msg||"Saved."); loadList(); } else note(r.msg||"Could not save.");
  };
  window.__auditDelete = async function(id){
    if(!confirm("Delete this audit?")) return;
    var r=await postJ("/api/audit/delete",{id:id});
    if(r.ok){ note("Deleted."); loadList(); } else note(r.msg||"Could not delete.");
  };

  // ---- self-wire into the portal tab system ----
  function showAuditTab(){ var t=$("tab-audit-btn"); if(t) t.style.display=""; }
  document.addEventListener("DOMContentLoaded", function(){
    showAuditTab();
    var _os = window.showTab;
    window.showTab = function(which){ if(_os) _os(which); if(which==="audit") loadList(); };
  });
  // in case DOMContentLoaded already fired
  if(document.readyState!=="loading"){ showAuditTab(); var _os2=window.showTab; window.showTab=function(w){ if(_os2)_os2(w); if(w==="audit") loadList(); }; }
})();
