/* ============================================================
   Mr. Golisoda LMS — "Route Audit" for field staff (v2).
   One day/route header + multiple outlet entries + auto totals.
   Enabled per person by admin. Self-wires into showTab().
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
    "#myAudit .ol{background:#fbfdff;border:1px solid #d7e8f5;border-radius:12px;padding:13px;margin-bottom:12px}",
    "#myAudit .ol h5{margin:0;font-size:13.5px;color:#0c447c}",
    "#myAudit label.fl{display:block;font-size:12px;color:#62707a;margin:6px 0 2px}",
    "#myAudit input,#myAudit select,#myAudit textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--mg-line);border-radius:8px;font-size:14px;font-family:inherit}",
    "#myAudit table{width:100%;border-collapse:collapse;font-size:12.5px}",
    "#myAudit th{background:#12284B;color:#fff;padding:5px 4px;font-size:11px;font-weight:600}",
    "#myAudit td{border-bottom:1px solid #f0f0f0;padding:3px}",
    "#myAudit td input{padding:5px;text-align:center;font-size:13px}",
    "#myAudit .calc{background:#eef5fc;border:1px solid #cddff0;border-radius:8px;padding:8px 10px;font-size:12.5px;margin-top:6px}",
    "#myAudit .calc b{color:#0c447c}",
    "#myAudit .grand{background:#12284B;color:#fff;border-radius:10px;padding:12px 14px;font-size:13px;margin:12px 0}",
    "#myAudit .grand b{color:#FFD600}",
    "#myAudit .yn{display:flex;gap:4px}",
    "#myAudit .yn button{flex:1;padding:5px;border:1px solid var(--mg-line);background:#fff;border-radius:6px;font-size:12px;cursor:pointer}",
    "#myAudit .yn button.on-yes{background:#1d9e75;color:#fff;border-color:#1d9e75}",
    "#myAudit .yn button.on-no{background:#d64545;color:#fff;border-color:#d64545}",
    "#myAudit .yn button.on-na{background:#8a97a1;color:#fff;border-color:#8a97a1}",
    "#myAudit .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
    "#myAudit .btn{padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none}",
    "#myAudit .btn.pri{background:var(--mg-blue,#1F5FA9);color:#fff}",
    "#myAudit .btn.sec{background:#eef2f5;color:#12284B}",
    "#myAudit .btn.ghost{background:#fff;border:1px dashed #1F5FA9;color:#1F5FA9;width:100%}",
    "#myAudit .arow{background:#fff;border:1px solid var(--mg-line);border-radius:10px;padding:11px 13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px}",
    "#myAudit .pill{padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600}",
    "#myAudit .pill.sub{background:#faf1de;color:#845a0b}#myAudit .pill.ver{background:#eaf7f0;color:#0f6b45}",
    "#myAudit .wa{white-space:pre-wrap;background:#f7f9fa;border:1px dashed var(--mg-line);border-radius:8px;padding:10px;font-size:12px;font-family:monospace}",
    "#myAudit .help{background:#fff7e6;border:1px solid #f0d9a0;border-radius:10px;padding:11px 13px;font-size:12.5px;margin-bottom:12px}",
    "#myAudit .help ol{margin:6px 0 0 18px;padding:0}#myAudit .help li{margin:3px 0}"
  ].join("\n");
  document.head.appendChild(css);

  var CFG = null, EDIT_ID = null, MODEL = null;

  async function getJ(u){ try{ return await (await fetch(u,{credentials:"same-origin"})).json(); }catch(e){ return {ok:false}; } }
  async function postJ(u,b){ try{ return await (await fetch(u,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})).json(); }catch(e){ return {ok:false,msg:"Network problem."}; } }
  function note(m){ var n=document.createElement("div"); n.textContent=m; n.style.cssText="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#12284B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999"; document.body.appendChild(n); setTimeout(function(){n.remove();},2400); }

  async function loadList(){
    var box = $("myAudit"); if(!box) return;
    if(!CFG){ var cf = await getJ("/api/audit/config"); CFG = (cf&&cf.ok)?cf:null; }
    if(!CFG){ box.innerHTML='<div class="empty">Could not load.</div>'; return; }
    if(!CFG.enabled){
      box.innerHTML = '<div class="help">Route Audit is <b>not enabled</b> for you yet. Please ask your admin or trainer to enable it, then refresh.</div>';
      return;
    }
    var d = await getJ("/api/audit/my");
    var audits = (d&&d.ok)?d.audits:[];
    var rows = audits.length ? audits.map(function(a){
      return '<div class="arow"><div><b>'+esc(a.route||"(no route)")+'</b> <span style="font-size:11px;color:#62707a">· '+(a.outlet_count||0)+' outlet(s)</span><br>'+
        '<span style="font-size:12px;color:#62707a">'+esc(fmtD(a.audit_date))+(a.franchise?" · "+esc(a.franchise):"")+'</span></div>'+
        '<div style="text-align:right"><span class="pill '+(a.status==="verified"?"ver":"sub")+'">'+(a.status==="verified"?"Verified":"Submitted")+'</span><br>'+
        '<button class="btn sec" style="margin-top:5px;padding:4px 10px;font-size:12px" onclick="__auditOpen('+a.id+')">Open</button></div></div>';
    }).join("") : '<div class="empty" style="padding:16px">No audits yet. Tap "New audit" to start.</div>';
    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'+
        '<div class="sectiontitle" style="margin:0">My Route Audits</div>'+
        '<div><button class="btn sec" onclick="__auditSample()" style="margin-right:6px">View sample</button>'+
        '<button class="btn pri" onclick="__auditNew()">＋ New audit</button></div></div>'+
      '<div>'+rows+'</div>';
  }

  function blankModel(){
    return { header:{ route:"", franchise:"", went_with:"", audit_date:new Date().toISOString().slice(0,10), factory_trays:"" }, outlets:[ blankOutlet() ] };
  }
  function blankOutlet(){ return { outlet_name:"", flavours:{}, empties:"", checks:{}, check_remarks:{}, numbers:{}, fixed_expenses:"", variable_expenses:"", notes:"" }; }

  function renderForm(a){
    EDIT_ID = a ? a.id : null;
    MODEL = a && a.payload ? JSON.parse(JSON.stringify(a.payload)) : blankModel();
    if(!MODEL.header) MODEL.header = blankModel().header;
    if(!MODEL.outlets || !MODEL.outlets.length) MODEL.outlets = [ blankOutlet() ];
    var box = $("myAudit"), s = CFG.settings, me = CFG.me;
    var h = MODEL.header;
    var locked = a && a.status === "verified";

    var outletsHtml = MODEL.outlets.map(function(o, idx){ return outletBlock(o, idx, s, locked); }).join("");

    box.innerHTML =
      '<button class="btn sec" onclick="__auditList()" style="margin-bottom:10px">← Back to my audits</button>'+
      (locked?'<div class="ac" style="background:#eaf7f0;border-color:#b7e3ca;color:#0f6b45"><b>✔ Verified</b> — locked.</div>':'')+
      '<div class="ac"><h4>Day / route header</h4>'+
        '<div class="row2"><div><label class="fl">BDE Name</label><input value="'+esc(me.name)+'" readonly></div>'+
        '<div><label class="fl">Employee ID</label><input value="'+esc(me.emp_id)+'" readonly></div></div>'+
        '<div class="row2"><div><label class="fl">Route</label><input id="h_route" value="'+esc(h.route||"")+'" placeholder="Route 1 - Chennai North"></div>'+
        '<div><label class="fl">Franchise / City</label><input id="h_fr" value="'+esc(h.franchise||"")+'" placeholder="Thiruvallur Franchise"></div></div>'+
        '<div class="row2"><div><label class="fl">Went With</label><input id="h_with" value="'+esc(h.went_with||"")+'" placeholder="Senior BDE / BDM"></div>'+
        '<div><label class="fl">Date</label><input id="h_date" type="date" value="'+esc((h.audit_date||"").slice(0,10))+'"></div></div>'+
        '<label class="fl">Factory Trays available (for the day)</label><input id="h_trays" type="number" min="0" value="'+(h.factory_trays||"")+'" placeholder="1500">'+
        '<div class="calc" id="h_targetcalc"></div></div>'+
      '<div id="outletsWrap">'+outletsHtml+'</div>'+
      (locked?'':'<button class="btn ghost" onclick="__auditAddOutlet()" style="margin-bottom:12px">＋ Add outlet</button>')+
      '<div class="grand" id="grandTotal"></div>'+
      '<div class="ac"><h4>WhatsApp summary (whole day)</h4><div class="wa" id="a_wa"></div>'+
        '<button class="btn sec" style="margin-top:8px" onclick="__auditCopyWA()">📋 Copy summary</button></div>'+
      '<div style="display:flex;gap:10px;margin-bottom:30px">'+
        (locked?'':'<button class="btn pri" style="flex:1" onclick="__auditSubmit()">'+(EDIT_ID?"Update audit":"Submit audit")+'</button>')+
        (EDIT_ID&&!locked?'<button class="btn sec" onclick="__auditDelete('+EDIT_ID+')">Delete</button>':'')+
      '</div>';

    wireForm(locked);
    recompute();
  }

  function outletBlock(o, idx, s, locked){
    var flRows = s.flavours.map(function(f){
      var v = (o.flavours||{})[f]||{};
      return '<tr data-fl="'+esc(f)+'"><td style="text-align:left;padding-left:6px">'+esc(f)+'</td>'+
        '<td><input type="number" min="0" class="ofl" data-k="gp" value="'+(v.gp||"")+'" placeholder="0" '+(locked?"disabled":"")+'></td>'+
        '<td><input type="number" min="0" class="ofl" data-k="pp" value="'+(v.pp||"")+'" placeholder="0" '+(locked?"disabled":"")+'></td>'+
        '<td><input type="number" min="0" class="ofl" data-k="gs" value="'+(v.gs||"")+'" placeholder="0" '+(locked?"disabled":"")+'></td>'+
        '<td><input type="number" min="0" class="ofl" data-k="ps" value="'+(v.ps||"")+'" placeholder="0" '+(locked?"disabled":"")+'></td></tr>';
    }).join("");
    var checkHtml = CFG.checks.map(function(item,i){
      var cur = (o.checks||{})[i]||(o.checks||{})[String(i)]||"";
      function b(val,cls,lbl){ return '<button type="button" data-ci="'+i+'" data-val="'+val+'" class="'+(cur===val?("on-"+cls):"")+'" '+(locked?"disabled":"")+'>'+lbl+'</button>'; }
      return '<div style="padding:6px 0;border-bottom:1px solid #eef2f5">'+
        '<div style="font-size:12.5px;margin-bottom:3px">'+(i+1)+". "+esc(item)+'</div>'+
        '<div class="yn">'+b("Yes","yes","Yes")+b("No","no","No")+b("N.A.","na","N.A.")+'</div>'+
        '<input type="text" class="ocr" data-ci="'+i+'" placeholder="Remarks (optional)" value="'+esc((o.check_remarks||{})[i]||(o.check_remarks||{})[String(i)]||"")+'" style="margin-top:3px;font-size:12px" '+(locked?"disabled":"")+'>'+
        '</div>';
    }).join("");
    var numHtml = CFG.numbers.map(function(n){
      return '<label class="fl">'+esc(n[1])+'</label><input type="number" min="0" class="onum" data-k="'+n[0]+'" value="'+((o.numbers||{})[n[0]]||"")+'" placeholder="0" '+(locked?"disabled":"")+'>';
    }).join("");
    return '<div class="ol" data-outlet="'+idx+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
        '<h5>Outlet '+(idx+1)+'</h5>'+
        (locked?'':'<button class="btn sec" style="padding:3px 10px;font-size:12px;color:#d64545" onclick="__auditRemoveOutlet('+idx+')">Remove</button>')+'</div>'+
      '<label class="fl">Outlet / shop name</label><input class="o_name" value="'+esc(o.outlet_name||"")+'" placeholder="Shop name" '+(locked?"disabled":"")+'>'+
      '<div class="row2" style="margin-top:8px">'+
        '<div><label class="fl">Location</label><select class="o_loc" '+(locked?"disabled":"")+'>'+
          '<option value="">— select location —</option>'+
          (s.locations||[]).map(function(L){ return '<option value="'+esc(L.name)+'"'+((o.location||"")===L.name?" selected":"")+'>'+esc(L.name)+'</option>'; }).join("")+
          '<option value="__other"'+((o.location==="__other")?" selected":"")+'>Other / manual</option>'+
        '</select></div>'+
        '<div></div></div>'+
      '<div class="row2">'+
        '<div><label class="fl">Glass selling price (₹)</label><input type="number" step="0.01" class="o_gsell" value="'+(o.glass_sell||"")+'" placeholder="e.g. 15" '+(locked?"disabled":"")+'></div>'+
        '<div><label class="fl">PET selling price (₹)</label><input type="number" step="0.01" class="o_psell" value="'+(o.pet_sell||"")+'" placeholder="e.g. 20" '+(locked?"disabled":"")+'></div>'+
      '</div>'+
      '<div style="overflow-x:auto;margin-top:8px"><table><thead><tr><th style="text-align:left">Flavour</th><th>Glass made</th><th>PET made</th><th>Glass sold</th><th>PET sold</th></tr></thead><tbody>'+flRows+'</tbody></table></div>'+
      '<label class="fl" style="margin-top:8px">Empties collected here</label><input type="number" min="0" class="o_empties" value="'+(o.empties||"")+'" placeholder="0" '+(locked?"disabled":"")+'>'+
      '<div style="margin-top:10px;font-size:12.5px;font-weight:600;color:#12284B">Store checks</div>'+checkHtml+
      '<div style="margin-top:8px">'+numHtml+'</div>'+
      '<div class="row2" style="margin-top:8px"><div><label class="fl">Fixed exp (₹)</label><input type="number" min="0" class="o_fixed" value="'+(o.fixed_expenses||"")+'" placeholder="0" '+(locked?"disabled":"")+'></div>'+
        '<div><label class="fl">Variable exp (₹)</label><input type="number" min="0" class="o_var" value="'+(o.variable_expenses||"")+'" placeholder="0" '+(locked?"disabled":"")+'></div></div>'+
      '<label class="fl">Notes for this outlet</label><textarea class="o_notes" rows="2" '+(locked?"disabled":"")+'>'+esc(o.notes||"")+'</textarea>'+
      '<div class="calc o_calc"></div>'+
      '</div>';
  }

  function wireForm(locked){
    var box = $("myAudit");
    box.querySelectorAll("input,textarea").forEach(function(el){ el.addEventListener("input", function(){ collect(); recompute(); }); });
    if(locked) return;
    // location dropdown -> pre-fill that location's selling price (BDE can still change)
    box.querySelectorAll(".o_loc").forEach(function(sel){
      sel.addEventListener("change", function(){
        var ol = sel.closest(".ol");
        var loc = (CFG.settings.locations||[]).filter(function(L){ return L.name===sel.value; })[0];
        if(loc){
          var g=ol.querySelector(".o_gsell"), p=ol.querySelector(".o_psell");
          if(g) g.value = loc.glass; if(p) p.value = loc.pet;
        }
        collect(); recompute();
      });
    });
    box.querySelectorAll(".yn button").forEach(function(b){
      b.addEventListener("click", function(){
        var ol = b.closest(".ol"), ci=b.dataset.ci;
        ol.querySelectorAll('.yn button[data-ci="'+ci+'"]').forEach(function(x){ x.className=""; });
        b.className = "on-"+(b.dataset.val==="Yes"?"yes":b.dataset.val==="No"?"no":"na");
        collect(); recompute();
      });
    });
  }

  function collect(){
    var box=$("myAudit");
    MODEL.header = {
      route:$("h_route").value.trim(), franchise:$("h_fr").value.trim(), went_with:$("h_with").value.trim(),
      audit_date:$("h_date").value, factory_trays:$("h_trays").value
    };
    var outlets=[];
    box.querySelectorAll(".ol").forEach(function(ol){
      var o={ flavours:{}, checks:{}, check_remarks:{}, numbers:{} };
      o.outlet_name = ol.querySelector(".o_name").value.trim();
      var locEl=ol.querySelector(".o_loc"); o.location = locEl?locEl.value:"";
      var gsEl=ol.querySelector(".o_gsell"), psEl=ol.querySelector(".o_psell");
      o.glass_sell = gsEl?gsEl.value:""; o.pet_sell = psEl?psEl.value:"";
      ol.querySelectorAll("tr[data-fl]").forEach(function(tr){
        var name=tr.dataset.fl, obj={};
        tr.querySelectorAll(".ofl").forEach(function(i){ obj[i.dataset.k]=i.value; });
        o.flavours[name]=obj;
      });
      o.empties = ol.querySelector(".o_empties").value;
      ol.querySelectorAll('.yn button[class^="on-"]').forEach(function(b){ o.checks[b.dataset.ci]=b.dataset.val; });
      ol.querySelectorAll(".ocr").forEach(function(i){ if(i.value.trim()) o.check_remarks[i.dataset.ci]=i.value.trim(); });
      ol.querySelectorAll(".onum").forEach(function(i){ o.numbers[i.dataset.k]=i.value; });
      o.fixed_expenses = ol.querySelector(".o_fixed").value;
      o.variable_expenses = ol.querySelector(".o_var").value;
      o.notes = ol.querySelector(".o_notes").value.trim();
      outlets.push(o);
    });
    MODEL.outlets = outlets;
    return MODEL;
  }

  function recompute(){
    var s=CFG.settings, box=$("myAudit");
    // header targets
    var trays=num(MODEL.header.factory_trays);
    var maxc=s.trays_divisor?Math.floor(trays/s.trays_divisor):0;
    var weekly=maxc*s.routes, daily=s.routes?Math.floor(weekly/s.routes):0, outlet=Math.ceil(daily*s.outlet_buffer);
    if($("h_targetcalc")) $("h_targetcalc").innerHTML="Max cases/day: <b>"+maxc+"</b> · Weekly max: <b>"+weekly+"</b> · Daily target: <b>"+daily+"</b> · Outlets needed: <b>"+outlet+"</b>";
    // per outlet + grand
    var G={produced:0,sold:0,gs:0,ps:0,gp:0,pp:0,rev:0,cost:0,net:0,orders:0,newo:0,pay:0,empties:0};
    var olEls = box.querySelectorAll(".ol");
    MODEL.outlets.forEach(function(o, i){
      var gp=0,pp=0,gs=0,ps=0;
      Object.keys(o.flavours).forEach(function(k){ var r=o.flavours[k]; gp+=num(r.gp);pp+=num(r.pp);gs+=num(r.gs);ps+=num(r.ps); });
      var gsell=num(o.glass_sell)||s.glass_sell, psell=num(o.pet_sell)||s.pet_sell;
      var rev=gs*gsell+ps*psell, cost=gp*s.glass_cost+pp*s.pet_cost;
      var net=rev-cost-num(o.fixed_expenses)-num(o.variable_expenses);
      G.produced+=gp+pp; G.sold+=gs+ps; G.gs+=gs; G.ps+=ps; G.gp+=gp; G.pp+=pp; G.rev+=rev; G.cost+=cost; G.net+=net;
      G.orders+=num((o.numbers||{}).orders_taken); G.newo+=num((o.numbers||{}).new_outlets);
      G.pay+=num((o.numbers||{}).payment_collected); G.empties+=num(o.empties);
      if(olEls[i]){ var cc=olEls[i].querySelector(".o_calc"); if(cc) cc.innerHTML="This outlet — sold: <b>"+(gs+ps)+"</b> · revenue: <b>₹"+Math.round(rev)+"</b> · net: <b>₹"+Math.round(net)+"</b>"; }
    });
    if($("grandTotal")) $("grandTotal").innerHTML=
      "DAY TOTAL ("+MODEL.outlets.length+" outlets) — Produced: <b>"+Math.round(G.produced)+"</b> · Sold: <b>"+Math.round(G.sold)+"</b><br>"+
      "Orders: <b>"+Math.round(G.orders)+"</b> · New outlets: <b>"+Math.round(G.newo)+"</b> · Empties: <b>"+Math.round(G.empties)+"</b><br>"+
      "Revenue: <b>₹"+Math.round(G.rev)+"</b> · Payment: <b>₹"+Math.round(G.pay)+"</b> · Net: <b>₹"+Math.round(G.net)+"</b>";
    if($("a_wa")) $("a_wa").textContent = buildWA(G);
  }

  function buildWA(G){
    var me=CFG.me, h=MODEL.header, L=[];
    L.push("*MR. GOLISODA — DAILY SUMMARY*","==============");
    L.push("BDE: "+me.name+"   ID: "+me.emp_id);
    L.push("Route: "+(h.route||"")+"  ("+(h.went_with||"")+")");
    L.push("Date: "+(h.audit_date||"")+"   Outlets: "+MODEL.outlets.length);
    L.push("==============","*PER OUTLET:*");
    var s=CFG.settings;
    MODEL.outlets.forEach(function(o,i){
      var gs=0,ps=0,rev=0;
      Object.keys(o.flavours).forEach(function(k){ var r=o.flavours[k]; gs+=num(r.gs);ps+=num(r.ps); });
      rev=gs*(num(o.glass_sell)||s.glass_sell)+ps*(num(o.pet_sell)||s.pet_sell);
      L.push((i+1)+". "+(o.outlet_name||("Outlet "+(i+1)))+": sold "+(gs+ps)+", ₹"+Math.round(rev));
    });
    L.push("==============","*DAY TOTAL:*");
    L.push("Produced: "+Math.round(G.produced)+" · Sold: "+Math.round(G.sold));
    L.push("Orders: "+Math.round(G.orders)+" · New outlets: "+Math.round(G.newo));
    L.push("Empties: "+Math.round(G.empties)+" · Payment: ₹"+Math.round(G.pay));
    L.push("Revenue: ₹"+Math.round(G.rev)+" · Net: ₹"+Math.round(G.net));
    L.push("==============","Submitted by: "+me.name);
    return L.join("\n");
  }

  // ---- sample viewer ----
  async function showSample(){
    var d = await getJ("/api/audit/sample");
    if(!d||!d.ok){ note("Could not load sample."); return; }
    var box=$("myAudit"), s=d.settings, p=d.payload, c=d.computed;
    var help = '<div class="help"><b>How to fill this audit:</b><ol>'+d.help_steps.map(function(x){return "<li>"+esc(x)+"</li>";}).join("")+'</ol></div>';
    var outlets = p.outlets.map(function(o,i){
      var lines = s.flavours.filter(function(f){return o.flavours[f];}).map(function(f){var r=o.flavours[f];return "&nbsp;&nbsp;"+esc(f)+": "+num(r.gp)+"/"+num(r.pp)+" made, "+num(r.gs)+"/"+num(r.ps)+" sold";}).join("<br>");
      return '<div class="ol"><h5>Outlet '+(i+1)+': '+esc(o.outlet_name)+'</h5>'+
        '<div style="font-size:12.5px;margin-top:5px">'+lines+'<br>Orders: '+num((o.numbers||{}).orders_taken)+' · Payment: ₹'+num((o.numbers||{}).payment_collected)+'<br><i>'+esc(o.notes||"")+'</i></div></div>';
    }).join("");
    box.innerHTML =
      '<button class="btn sec" onclick="__auditList()" style="margin-bottom:10px">← Back</button>'+
      '<div class="sectiontitle" style="margin:0 0 10px">Sample audit (example)</div>'+ help +
      '<div class="ac"><h4>Header</h4><div style="font-size:12.5px">Route: '+esc(p.header.route)+'<br>Franchise: '+esc(p.header.franchise)+'<br>Trays: '+num(p.header.factory_trays)+' → daily target '+c.daily_target+', outlets needed '+c.outlet_need+'</div></div>'+
      outlets +
      '<div class="grand">DAY TOTAL ('+c.outlet_count+' outlets) — Produced: <b>'+Math.round(c.produced)+'</b> · Sold: <b>'+Math.round(c.sold)+'</b><br>Revenue: <b>₹'+Math.round(c.revenue)+'</b> · Net: <b>₹'+Math.round(c.net)+'</b></div>'+
      '<button class="btn pri" onclick="__auditNew()">Got it — start my audit</button>';
  }

  // ---- global handlers ----
  window.__auditNew = function(){ renderForm(null); };
  window.__auditList = function(){ loadList(); };
  window.__auditSample = function(){ showSample(); };
  window.__auditOpen = async function(id){ var d=await getJ("/api/audit/get?id="+id); if(d&&d.ok){ renderForm(d.audit); } else note((d&&d.msg)||"Could not open."); };
  window.__auditAddOutlet = function(){ collect(); MODEL.outlets.push(blankOutlet()); rerenderOutlets(); };
  window.__auditRemoveOutlet = function(i){ collect(); if(MODEL.outlets.length<=1){ note("At least one outlet is needed."); return; } MODEL.outlets.splice(i,1); rerenderOutlets(); };
  function rerenderOutlets(){
    var wrap=$("outletsWrap"); if(!wrap) return;
    var s=CFG.settings;
    wrap.innerHTML = MODEL.outlets.map(function(o,idx){ return outletBlock(o, idx, s, false); }).join("");
    wireForm(false); recompute();
  }
  window.__auditCopyWA = function(){ var t=$("a_wa").textContent; if(navigator.clipboard){ navigator.clipboard.writeText(t).then(function(){note("Summary copied.");},function(){note("Long-press to copy.");}); } else note("Long-press the text to copy."); };
  window.__auditSubmit = async function(){
    collect();
    if(!MODEL.header.route){ note("Enter the route in the header."); return; }
    if(!MODEL.outlets.length){ note("Add at least one outlet."); return; }
    var body={payload:MODEL}; if(EDIT_ID) body.id=EDIT_ID;
    var r=await postJ("/api/audit/submit", body);
    if(r.ok){ note(r.msg||"Saved."); loadList(); } else note(r.msg||"Could not save.");
  };
  window.__auditDelete = async function(id){ if(!confirm("Delete this audit?")) return; var r=await postJ("/api/audit/delete",{id:id}); if(r.ok){ note("Deleted."); loadList(); } else note(r.msg||"Could not delete."); };

  // ---- self-wire ----
  function showAuditTab(){ var t=$("tab-audit-btn"); if(t) t.style.display=""; }
  document.addEventListener("DOMContentLoaded", function(){
    showAuditTab();
    var _os = window.showTab;
    window.showTab = function(which){ if(_os) _os(which); if(which==="audit") loadList(); };
  });
  if(document.readyState!=="loading"){ showAuditTab(); var _os2=window.showTab; window.showTab=function(w){ if(_os2)_os2(w); if(w==="audit") loadList(); }; }
})();
