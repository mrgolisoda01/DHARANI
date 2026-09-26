/* ============================================================
   Mr. Golisoda LMS — "Audit" tab for admin / trainer (v2).
   Lists route audits, opens per-outlet detail, verifies, exports,
   manages who can fill audits (enable), settings, and a sample.
   Self-wires into admin switchTab().
   ============================================================ */
(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function num(v){ var n=parseFloat(v); return isNaN(n)?0:n; }
  function fmtD(iso){ if(!iso) return ""; return new Date(iso.slice(0,10)+"T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); }

  var css = document.createElement("style");
  css.textContent = [
    "#auditRoot .abar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}",
    "#auditRoot .arow{background:#fff;border:1px solid var(--mg-line);border-radius:10px;padding:11px 13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px}",
    "#auditRoot .pill{padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600}",
    "#auditRoot .pill.sub{background:#faf1de;color:#845a0b}#auditRoot .pill.ver{background:#eaf7f0;color:#0f6b45}",
    "#auditRoot .btn{padding:6px 12px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:none}",
    "#auditRoot .btn.pri{background:var(--mg-blue,#1F5FA9);color:#fff}#auditRoot .btn.sec{background:#eef2f5;color:#12284B}#auditRoot .btn.ok{background:#1d9e75;color:#fff}",
    "#auditRoot table{width:100%;border-collapse:collapse;font-size:12.5px}",
    "#auditRoot .det th{background:#12284B;color:#fff;padding:5px 6px;font-size:11px;text-align:left}",
    "#auditRoot .det td{border-bottom:1px solid #eee;padding:5px 6px}",
    "#auditRoot .sec{background:#fff;border:1px solid var(--mg-line);border-radius:10px;padding:12px;margin-bottom:10px}",
    "#auditRoot .sec h4{margin:0 0 8px;font-size:13px;color:#12284B}",
    "#auditRoot .ol{background:#fbfdff;border:1px solid #d7e8f5;border-radius:10px;padding:11px;margin-bottom:8px}",
    "#auditRoot .grand{background:#12284B;color:#fff;border-radius:10px;padding:12px 14px;font-size:13px;margin:10px 0}",
    "#auditRoot .grand b{color:#FFD600}",
    "#auditRoot .kv{font-size:12.5px;padding:2px 0}",
    "#auditRoot .sw{position:relative;width:44px;height:24px;display:inline-block}",
    "#auditRoot .sw input{opacity:0;width:0;height:0}",
    "#auditRoot .sl{position:absolute;cursor:pointer;inset:0;background:#ccc;border-radius:24px;transition:.2s}",
    "#auditRoot .sl:before{content:'';position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}",
    "#auditRoot input:checked+.sl{background:#1d9e75}#auditRoot input:checked+.sl:before{transform:translateX(20px)}"
  ].join("\n");
  document.head.appendChild(css);

  var S = { filter:"submitted", cfg:null };

  async function getJ(u){ try{ return await (await fetch(u,{credentials:"same-origin"})).json(); }catch(e){ return {ok:false}; } }
  async function postJ(u,b){ try{ return await (await fetch(u,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})).json(); }catch(e){ return {ok:false,msg:"Network problem."}; } }
  function note(m){ var n=document.createElement("div"); n.textContent=m; n.style.cssText="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#12284B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999"; document.body.appendChild(n); setTimeout(function(){n.remove();},2400); }

  async function loadList(){
    var root=$("auditRoot"); if(!root) return;
    if(!S.cfg){ var cf=await getJ("/api/audit/config"); S.cfg=(cf&&cf.ok)?cf:{is_admin:false}; }
    root.innerHTML='<div class="empty">Loading…</div>';
    var d=await getJ("/api/audit/list?status="+encodeURIComponent(S.filter==="all"?"":S.filter));
    var audits=(d&&d.ok)?d.audits:[];
    var rows=audits.length?audits.map(function(a){
      return '<div class="arow"><div><b>'+esc(a.emp_name||a.emp_id)+'</b> <span style="color:#62707a;font-size:12px">· '+esc(a.role||"")+'</span><br>'+
        '<span style="font-size:12px;color:#62707a">'+esc(a.route||"(no route)")+' · '+(a.outlet_count||0)+' outlet(s) · '+esc(fmtD(a.audit_date))+'</span></div>'+
        '<div style="text-align:right;white-space:nowrap"><span class="pill '+(a.status==="verified"?"ver":"sub")+'">'+(a.status==="verified"?"Verified":"Submitted")+'</span><br>'+
        '<button class="btn sec" style="margin-top:5px" onclick="__aaOpen('+a.id+')">Open</button></div></div>';
    }).join(""):'<div class="empty" style="padding:16px">No audits '+(S.filter==="all"?"":"("+S.filter+")")+' yet.</div>';
    var sel=function(v,l){ return '<option value="'+v+'"'+(S.filter===v?" selected":"")+'>'+l+'</option>'; };
    root.innerHTML=
      '<div class="abar">'+
        '<select onchange="__aaFilter(this.value)" style="padding:8px;border:1px solid var(--mg-line);border-radius:8px;font-size:13px">'+
          sel("submitted","Pending verification")+sel("verified","Verified")+sel("all","All audits")+'</select>'+
        '<a class="btn sec" href="/api/audit/export-all.xlsx'+(S.filter!=="all"?("?status="+S.filter):"")+'" style="text-decoration:none">⬇ Export all (Excel)</a>'+
        '<button class="btn sec" onclick="__aaAccess()">👥 Who can audit</button>'+
        '<button class="btn sec" onclick="__aaSample()">📖 Sample & guide</button>'+
        (S.cfg.is_admin?'<button class="btn sec" onclick="__aaSettings()">⚙ Prices & flavours</button>':'')+
      '</div>'+rows;
  }

  async function openAudit(id){
    var root=$("auditRoot");
    root.innerHTML='<div class="empty">Loading…</div>';
    var d=await getJ("/api/audit/get?id="+id);
    if(!d||!d.ok){ root.innerHTML='<div class="empty">Could not open.</div>'; return; }
    var a=d.audit, p=a.payload||{}, h=p.header||{}, c=a.computed||{}, s=d.settings;
    var outlets=(p.outlets||[]).map(function(o,i){
      var flTable='<table class="det"><thead><tr><th>Flavour</th><th>G made</th><th>P made</th><th>G sold</th><th>P sold</th></tr></thead><tbody>'+
        s.flavours.filter(function(f){return (o.flavours||{})[f];}).map(function(f){var r=o.flavours[f];return '<tr><td>'+esc(f)+'</td><td>'+num(r.gp)+'</td><td>'+num(r.pp)+'</td><td>'+num(r.gs)+'</td><td>'+num(r.ps)+'</td></tr>';}).join("")+'</tbody></table>';
      var checks=d.checks.map(function(item,j){var v=(o.checks||{})[j]||(o.checks||{})[String(j)]||"—";var rm=(o.check_remarks||{})[j]||(o.check_remarks||{})[String(j)]||"";return '<div class="kv">'+(j+1)+". "+esc(item)+": <b>"+esc(v)+"</b>"+(rm?' — <i>'+esc(rm)+'</i>':'')+'</div>';}).join("");
      var n=o.numbers||{};
      return '<div class="ol"><b>Outlet '+(i+1)+': '+esc(o.outlet_name||"")+'</b>'+
        (o.location?' <span style="font-size:11px;color:#62707a">· '+esc(o.location)+'</span>':'')+
        '<div class="kv" style="margin-top:3px">Selling price: Glass ₹'+num(o.glass_sell||s.glass_sell)+' · PET ₹'+num(o.pet_sell||s.pet_sell)+'</div>'+
        flTable+
        '<div class="kv" style="margin-top:4px">Empties: <b>'+num(o.empties)+'</b> · Orders: <b>'+num(n.orders_taken)+'</b> · New: <b>'+num(n.new_outlets)+'</b> · Payment: <b>₹'+num(n.payment_collected)+'</b> · Issues: <b>'+num(n.issues_found)+'</b></div>'+
        '<div style="margin-top:5px">'+checks+'</div>'+
        (o.notes?'<div class="kv" style="margin-top:4px"><i>'+esc(o.notes)+'</i></div>':'')+'</div>';
    }).join("");

    root.innerHTML=
      '<button class="btn sec" onclick="__aaBack()" style="margin-bottom:10px">← Back to list</button>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+
        '<a class="btn sec" href="/api/audit/export.xlsx?id='+a.id+'" style="text-decoration:none">⬇ Download Excel</a>'+
        '<button class="btn sec" onclick="__aaWA('+a.id+')">📋 WhatsApp summary</button>'+
        (a.status!=="verified"&&d.can_verify?'<button class="btn ok" onclick="__aaVerify('+a.id+')">✔ Verify audit</button>':'')+
        (S.cfg.is_admin?'<button class="btn sec" style="color:#d64545" onclick="__aaDelete('+a.id+')">Delete</button>':'')+
      '</div>'+
      '<div class="sec"><h4>Header</h4>'+
        '<div class="kv"><b>BDE:</b> '+esc(a.emp_name)+' ('+esc(a.emp_id)+') · '+esc(a.role||"")+'</div>'+
        '<div class="kv"><b>Route:</b> '+esc(a.route||"")+' · <b>Franchise:</b> '+esc(a.franchise||"")+'</div>'+
        '<div class="kv"><b>Went with:</b> '+esc(a.went_with||"")+' · <b>Date:</b> '+esc(fmtD(a.audit_date))+'</div>'+
        '<div class="kv"><b>Trays:</b> '+num(h.factory_trays)+' → daily target <b>'+c.daily_target+'</b>, outlets needed <b>'+c.outlet_need+'</b></div>'+
        '<div class="kv"><b>Status:</b> '+esc(a.status)+(a.verified_by?' · verified by '+esc(a.verified_by):'')+'</div></div>'+
      '<div class="sec"><h4>Outlets ('+(p.outlets||[]).length+')</h4>'+outlets+'</div>'+
      '<div class="grand">DAY TOTAL — Produced: <b>'+Math.round(c.produced)+'</b> · Sold: <b>'+Math.round(c.sold)+'</b><br>'+
        'Orders: <b>'+Math.round(c.orders)+'</b> · New outlets: <b>'+Math.round(c.new_outlets)+'</b> · Empties: <b>'+Math.round(c.empties)+'</b><br>'+
        'Revenue: <b>₹'+Math.round(c.revenue)+'</b> · Payment: <b>₹'+Math.round(c.payment)+'</b> · Net: <b>₹'+Math.round(c.net)+'</b></div>';
  }

  async function accessScreen(){
    var root=$("auditRoot");
    root.innerHTML='<div class="empty">Loading…</div>';
    var d=await getJ("/api/audit/access-list");
    var people=(d&&d.ok)?d.people:[];
    var rows=people.length?people.map(function(p){
      return '<div class="arow"><div><b>'+esc(p.name)+'</b> <span style="font-size:12px;color:#62707a">· '+esc(p.designation)+' · '+esc(p.emp_id)+'</span></div>'+
        '<label class="sw"><input type="checkbox" '+(p.enabled?"checked":"")+' onchange="__aaToggle(\''+esc(p.emp_id)+'\',this.checked)"><span class="sl"></span></label></div>';
    }).join(""):'<div class="empty" style="padding:16px">No BDE / BDM / State Head found.</div>';
    root.innerHTML=
      '<button class="btn sec" onclick="__aaBack()" style="margin-bottom:10px">← Back</button>'+
      '<div class="sectiontitle" style="margin:0 0 6px">Who can fill Route Audits</div>'+
      '<p style="font-size:12.5px;color:#62707a;margin:0 0 12px">Turn the switch ON to let that person fill audits. They will see the Route Audit tab only when enabled.</p>'+
      rows;
  }

  async function sampleScreen(){
    var root=$("auditRoot");
    var d=await getJ("/api/audit/sample");
    if(!d||!d.ok){ note("Could not load sample."); return; }
    var s=d.settings,p=d.payload,c=d.computed;
    var help='<div class="sec"><h4>How to explain it to a first-timer</h4><ol style="margin:0 0 0 18px;padding:0;font-size:12.5px">'+d.help_steps.map(function(x){return "<li style=\"margin:3px 0\">"+esc(x)+"</li>";}).join("")+'</ol></div>';
    var outlets=p.outlets.map(function(o,i){
      var lines=s.flavours.filter(function(f){return o.flavours[f];}).map(function(f){var r=o.flavours[f];return esc(f)+": "+num(r.gp)+"/"+num(r.pp)+" made, "+num(r.gs)+"/"+num(r.ps)+" sold";}).join("<br>");
      return '<div class="ol"><b>Outlet '+(i+1)+': '+esc(o.outlet_name)+'</b><div class="kv" style="margin-top:4px">'+lines+'<br>Orders '+num((o.numbers||{}).orders_taken)+' · Payment ₹'+num((o.numbers||{}).payment_collected)+'<br><i>'+esc(o.notes||"")+'</i></div></div>';
    }).join("");
    root.innerHTML=
      '<button class="btn sec" onclick="__aaBack()" style="margin-bottom:10px">← Back</button>'+
      '<div class="sectiontitle" style="margin:0 0 10px">Sample audit & guide</div>'+help+
      '<div class="sec"><h4>Sample — header</h4><div class="kv">Route: '+esc(p.header.route)+'<br>Franchise: '+esc(p.header.franchise)+'<br>Trays: '+num(p.header.factory_trays)+' → daily target '+c.daily_target+'</div></div>'+
      '<div class="sec"><h4>Sample — outlets</h4>'+outlets+'</div>'+
      '<div class="grand">DAY TOTAL ('+c.outlet_count+' outlets) — Sold: <b>'+Math.round(c.sold)+'</b> · Revenue: <b>₹'+Math.round(c.revenue)+'</b> · Net: <b>₹'+Math.round(c.net)+'</b></div>';
  }

  async function settings(){
    var root=$("auditRoot");
    var cf=await getJ("/api/audit/config"); var s=(cf&&cf.ok)?cf.settings:null;
    if(!s){ note("Could not load settings."); return; }
    root.innerHTML=
      '<button class="btn sec" onclick="__aaBack()" style="margin-bottom:10px">← Back</button>'+
      '<div class="sec"><h4>Prices (₹)</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        ['glass_sell|Glass sell','glass_cost|Glass cost','pet_sell|PET sell','pet_cost|PET cost'].map(function(x){var k=x.split("|");return '<div><label style="font-size:12px;color:#62707a">'+k[1]+'</label><input id="set_'+k[0]+'" type="number" step="0.01" value="'+s[k[0]]+'" style="width:100%;padding:8px;border:1px solid var(--mg-line);border-radius:8px"></div>';}).join("")+'</div></div>'+
      '<div class="sec"><h4>Calculation</h4><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">'+
        ['trays_divisor|Trays ÷','routes|Routes','outlet_buffer|Outlet ×'].map(function(x){var k=x.split("|");return '<div><label style="font-size:12px;color:#62707a">'+k[1]+'</label><input id="set_'+k[0]+'" type="number" step="0.1" value="'+s[k[0]]+'" style="width:100%;padding:8px;border:1px solid var(--mg-line);border-radius:8px"></div>';}).join("")+'</div></div>'+
      '<div class="sec"><h4>Flavours (one per line)</h4><textarea id="set_flavours" rows="8" style="width:100%;padding:8px;border:1px solid var(--mg-line);border-radius:8px;font-family:inherit">'+esc((s.flavours||[]).join("\n"))+'</textarea></div>'+
      '<div class="sec"><h4>Locations & selling price</h4>'+
        '<p style="font-size:12px;color:#62707a;margin:0 0 8px">One line per location as <b>Name, GlassPrice, PetPrice</b> — e.g. <i>Chennai, 15, 20</i>. The BDE picks a location and its price pre-fills (they can still change it).</p>'+
        '<textarea id="set_locations" rows="6" style="width:100%;padding:8px;border:1px solid var(--mg-line);border-radius:8px;font-family:inherit">'+esc((s.locations||[]).map(function(L){return L.name+", "+L.glass+", "+L.pet;}).join("\n"))+'</textarea></div>'+
      '<button class="btn pri" onclick="__aaSaveSettings()">Save settings</button>';
  }

  // ---- handlers ----
  window.__aaFilter=function(v){ S.filter=v; loadList(); };
  window.__aaOpen=function(id){ openAudit(id); };
  window.__aaBack=function(){ loadList(); };
  window.__aaAccess=function(){ accessScreen(); };
  window.__aaSample=function(){ sampleScreen(); };
  window.__aaSettings=function(){ settings(); };
  window.__aaToggle=async function(emp,on){
    var r=await postJ("/api/audit/set-access",{emp_id:emp,enabled:on});
    if(!r.ok){
      note((r.msg && r.msg.indexOf("Network")<0) ? r.msg : "Couldn't save — the server may be waking up. Please try again in a moment.");
      // revert the switch so it reflects the real (unsaved) state
      var cb=document.querySelector('input[onchange*="'+emp+'"]');
      if(cb) cb.checked=!on;
    } else {
      note(on?"Enabled — this person can now fill audits.":"Disabled.");
    }
  };
  window.__aaVerify=async function(id){ if(!confirm("Mark this audit as verified?"))return; var r=await postJ("/api/audit/verify",{id:id}); if(r.ok){note("Verified.");openAudit(id);}else note(r.msg||"Failed."); };
  window.__aaDelete=async function(id){ if(!confirm("Delete this audit permanently?"))return; var r=await postJ("/api/audit/delete",{id:id}); if(r.ok){note("Deleted.");loadList();}else note(r.msg||"Failed."); };
  window.__aaWA=async function(id){ var d=await getJ("/api/audit/whatsapp?id="+id); if(d&&d.ok){ if(navigator.clipboard){navigator.clipboard.writeText(d.text).then(function(){note("Summary copied.");});} alert(d.text);} else note("Could not build summary."); };
  window.__aaSaveSettings=async function(){
    var locs=($("set_locations").value||"").split("\n").map(function(line){
      var parts=line.split(",").map(function(x){return x.trim();});
      if(!parts[0]) return null;
      return {name:parts[0], glass:parseFloat(parts[1])||0, pet:parseFloat(parts[2])||0};
    }).filter(Boolean);
    var body={glass_sell:$("set_glass_sell").value,glass_cost:$("set_glass_cost").value,pet_sell:$("set_pet_sell").value,pet_cost:$("set_pet_cost").value,
      trays_divisor:$("set_trays_divisor").value,routes:$("set_routes").value,outlet_buffer:$("set_outlet_buffer").value,
      flavours:$("set_flavours").value.split("\n").map(function(x){return x.trim();}).filter(Boolean),
      locations:locs};
    var r=await postJ("/api/audit/save-settings",body);
    if(r.ok){ S.cfg=null; note("Settings saved."); loadList(); } else note(r.msg||"Failed.");
  };

  // ---- self-wire ----
  try { TABS.audit = "tabAudit"; TAB_BTNS.audit = "tabAuditBtn"; } catch(e){}
  document.addEventListener("DOMContentLoaded", function(){
    var _os=window.switchTab;
    window.switchTab=function(which){ if(_os)_os(which); if(which==="audit") loadList(); };
  });
  if(document.readyState!=="loading"){ var _os2=window.switchTab; window.switchTab=function(w){ if(_os2)_os2(w); if(w==="audit") loadList(); }; }
})();
