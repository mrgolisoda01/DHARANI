/* ============================================================
   Mr. Golisoda LMS — "Audit" tab for admin / trainer.
   Lists all submitted Route Audits, open to view full detail,
   verify, download Excel (one / all), and (admin) edit settings.
   Self-wires into the admin portal's switchTab().
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
    "#auditRoot .btn.pri{background:var(--mg-blue,#1F5FA9);color:#fff}#auditRoot .btn.sec{background:#eef2f5;color:#12284B}",
    "#auditRoot .btn.ok{background:#1d9e75;color:#fff}",
    "#auditRoot table{width:100%;border-collapse:collapse;font-size:12.5px}",
    "#auditRoot .det th{background:#12284B;color:#fff;padding:5px 6px;font-size:11px;text-align:left}",
    "#auditRoot .det td{border-bottom:1px solid #eee;padding:5px 6px}",
    "#auditRoot .sec{background:#fff;border:1px solid var(--mg-line);border-radius:10px;padding:12px;margin-bottom:10px}",
    "#auditRoot .sec h4{margin:0 0 8px;font-size:13px;color:#12284B}",
    "#auditRoot .kv{font-size:12.5px;padding:2px 0}"
  ].join("\n");
  document.head.appendChild(css);

  var S = { view:"list", filter:"submitted", cfg:null };

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
        '<span style="font-size:12px;color:#62707a">'+esc(a.route||"(no route)")+' · '+esc(fmtD(a.audit_date))+(a.franchise?" · "+esc(a.franchise):"")+'</span></div>'+
        '<div style="text-align:right;white-space:nowrap"><span class="pill '+(a.status==="verified"?"ver":"sub")+'">'+(a.status==="verified"?"Verified":"Submitted")+'</span><br>'+
        '<button class="btn sec" style="margin-top:5px" onclick="__aaOpen('+a.id+')">Open</button></div></div>';
    }).join(""):'<div class="empty" style="padding:16px">No audits '+(S.filter==="all"?"":"("+S.filter+")")+' yet.</div>';
    var sel=function(v,l){ return '<option value="'+v+'"'+(S.filter===v?" selected":"")+'>'+l+'</option>'; };
    root.innerHTML=
      '<div class="abar">'+
        '<select onchange="__aaFilter(this.value)" style="padding:8px;border:1px solid var(--mg-line);border-radius:8px;font-size:13px">'+
          sel("submitted","Pending verification")+sel("verified","Verified")+sel("all","All audits")+'</select>'+
        '<a class="btn sec" href="/api/audit/export-all.xlsx'+(S.filter!=="all"?("?status="+S.filter):"")+'" style="text-decoration:none">⬇ Export all (Excel)</a>'+
        (S.cfg.is_admin?'<button class="btn sec" onclick="__aaSettings()">⚙ Prices & flavours</button>':'')+
      '</div>'+rows;
  }

  async function openAudit(id){
    var root=$("auditRoot");
    root.innerHTML='<div class="empty">Loading…</div>';
    var d=await getJ("/api/audit/get?id="+id);
    if(!d||!d.ok){ root.innerHTML='<div class="empty">Could not open.</div>'; return; }
    var a=d.audit, p=a.payload||{}, c=a.computed||{}, s=d.settings;
    var flTable='<table class="det"><thead><tr><th>Flavour</th><th>Glass made</th><th>PET made</th><th>Glass sold</th><th>PET sold</th></tr></thead><tbody>'+
      s.flavours.map(function(f){ var r=(p.flavours||{})[f]||{}; return '<tr><td>'+esc(f)+'</td><td>'+num(r.gp)+'</td><td>'+num(r.pp)+'</td><td>'+num(r.gs)+'</td><td>'+num(r.ps)+'</td></tr>'; }).join("")+
      '<tr style="font-weight:700"><td>TOTAL</td><td>'+c.tot_gp+'</td><td>'+c.tot_pp+'</td><td>'+c.tot_gs+'</td><td>'+c.tot_ps+'</td></tr></tbody></table>';
    var checkTable='<table class="det"><thead><tr><th>Check</th><th>Result</th><th>Remarks</th></tr></thead><tbody>'+
      d.checks.map(function(item,i){ var v=(p.checks||{})[i]||(p.checks||{})[String(i)]||"—"; var rm=(p.check_remarks||{})[i]||(p.check_remarks||{})[String(i)]||""; return '<tr><td>'+(i+1)+". "+esc(item)+'</td><td>'+esc(v)+'</td><td>'+esc(rm)+'</td></tr>'; }).join("")+'</tbody></table>';
    var nums=p.numbers||{};
    var numTable=d.numbers.map(function(n){ return '<div class="kv"><b>'+esc(n[1])+':</b> '+num(nums[n[0]])+'</div>'; }).join("");

    root.innerHTML=
      '<button class="btn sec" onclick="__aaBack()" style="margin-bottom:10px">← Back to list</button>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+
        '<a class="btn sec" href="/api/audit/export.xlsx?id='+a.id+'" style="text-decoration:none">⬇ Download Excel</a>'+
        '<button class="btn sec" onclick="__aaWA('+a.id+')">📋 WhatsApp summary</button>'+
        (a.status!=="verified"&&d.can_verify?'<button class="btn ok" onclick="__aaVerify('+a.id+')">✔ Verify audit</button>':'')+
        (S.cfg.is_admin?'<button class="btn sec" style="color:#d64545" onclick="__aaDelete('+a.id+')">Delete</button>':'')+
      '</div>'+
      '<div class="sec"><h4>Audit details</h4>'+
        '<div class="kv"><b>BDE:</b> '+esc(a.emp_name)+' ('+esc(a.emp_id)+') · '+esc(a.role||"")+'</div>'+
        '<div class="kv"><b>Route:</b> '+esc(a.route||"")+' · <b>Franchise:</b> '+esc(a.franchise||"")+'</div>'+
        '<div class="kv"><b>Went with:</b> '+esc(a.went_with||"")+' · <b>Date:</b> '+esc(fmtD(a.audit_date))+'</div>'+
        '<div class="kv"><b>Status:</b> '+esc(a.status)+(a.verified_by?' · verified by '+esc(a.verified_by):'')+'</div></div>'+
      '<div class="sec"><h4>Targets</h4><div class="kv">Factory trays: <b>'+num(p.factory_trays)+'</b> · Max cases/day: <b>'+c.max_cases+'</b> · Weekly max: <b>'+c.weekly_max+'</b> · Daily target/route: <b>'+c.daily_target+'</b> · Outlets needed: <b>'+c.outlet_need+'</b></div></div>'+
      '<div class="sec"><h4>Production & sales</h4>'+flTable+'<div class="kv" style="margin-top:6px">Empties collected: <b>'+num(p.empties)+'</b></div></div>'+
      '<div class="sec"><h4>Store / route checks</h4>'+checkTable+'</div>'+
      '<div class="sec"><h4>Daily numbers</h4>'+numTable+'</div>'+
      '<div class="sec"><h4>P&L (₹)</h4>'+
        '<div class="kv">Revenue: <b>₹'+Math.round(c.revenue)+'</b> · Prod. cost: <b>₹'+Math.round(c.prod_cost)+'</b> · Gross: <b>₹'+Math.round(c.gross)+'</b></div>'+
        '<div class="kv">Fixed: ₹'+Math.round(c.fixed)+' · Variable: ₹'+Math.round(c.variable)+' · <b>Net: ₹'+Math.round(c.net)+'</b></div></div>'+
      (p.notes?'<div class="sec"><h4>Notes</h4><div class="kv">'+esc(p.notes)+'</div></div>':'');
  }

  async function settings(){
    var root=$("auditRoot");
    var cf=await getJ("/api/audit/config"); var s=(cf&&cf.ok)?cf.settings:null;
    if(!s){ note("Could not load settings."); return; }
    root.innerHTML=
      '<button class="btn sec" onclick="__aaBack()" style="margin-bottom:10px">← Back</button>'+
      '<div class="sec"><h4>Prices (₹)</h4>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
        ['glass_sell|Glass sell','glass_cost|Glass cost','pet_sell|PET sell','pet_cost|PET cost'].map(function(x){var k=x.split("|");return '<div><label style="font-size:12px;color:#62707a">'+k[1]+'</label><input id="set_'+k[0]+'" type="number" step="0.01" value="'+s[k[0]]+'" style="width:100%;padding:8px;border:1px solid var(--mg-line);border-radius:8px"></div>';}).join("")+
        '</div></div>'+
      '<div class="sec"><h4>Calculation</h4>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">'+
        ['trays_divisor|Trays ÷ divisor','routes|Routes','outlet_buffer|Outlet buffer ×'].map(function(x){var k=x.split("|");return '<div><label style="font-size:12px;color:#62707a">'+k[1]+'</label><input id="set_'+k[0]+'" type="number" step="0.1" value="'+s[k[0]]+'" style="width:100%;padding:8px;border:1px solid var(--mg-line);border-radius:8px"></div>';}).join("")+
        '</div></div>'+
      '<div class="sec"><h4>Flavours (one per line)</h4>'+
        '<textarea id="set_flavours" rows="8" style="width:100%;padding:8px;border:1px solid var(--mg-line);border-radius:8px;font-family:inherit">'+esc((s.flavours||[]).join("\n"))+'</textarea></div>'+
      '<button class="btn pri" onclick="__aaSaveSettings()">Save settings</button>';
  }

  // ---- global handlers ----
  window.__aaFilter=function(v){ S.filter=v; loadList(); };
  window.__aaOpen=function(id){ openAudit(id); };
  window.__aaBack=function(){ loadList(); };
  window.__aaSettings=function(){ settings(); };
  window.__aaVerify=async function(id){ if(!confirm("Mark this audit as verified?"))return; var r=await postJ("/api/audit/verify",{id:id}); if(r.ok){note("Verified.");openAudit(id);}else note(r.msg||"Failed."); };
  window.__aaDelete=async function(id){ if(!confirm("Delete this audit permanently?"))return; var r=await postJ("/api/audit/delete",{id:id}); if(r.ok){note("Deleted.");loadList();}else note(r.msg||"Failed."); };
  window.__aaWA=async function(id){ var d=await getJ("/api/audit/whatsapp?id="+id); if(d&&d.ok){ if(navigator.clipboard){navigator.clipboard.writeText(d.text).then(function(){note("Summary copied.");});} alert(d.text);} else note("Could not build summary."); };
  window.__aaSaveSettings=async function(){
    var body={
      glass_sell:$("set_glass_sell").value, glass_cost:$("set_glass_cost").value,
      pet_sell:$("set_pet_sell").value, pet_cost:$("set_pet_cost").value,
      trays_divisor:$("set_trays_divisor").value, routes:$("set_routes").value,
      outlet_buffer:$("set_outlet_buffer").value,
      flavours:$("set_flavours").value.split("\n").map(function(x){return x.trim();}).filter(Boolean)
    };
    var r=await postJ("/api/audit/save-settings",body);
    if(r.ok){ S.cfg=null; note("Settings saved."); loadList(); } else note(r.msg||"Failed.");
  };

  // ---- self-wire into admin switchTab ----
  try { TABS.audit = "tabAudit"; TAB_BTNS.audit = "tabAuditBtn"; } catch(e){}
  document.addEventListener("DOMContentLoaded", function(){
    var _os=window.switchTab;
    window.switchTab=function(which){ if(_os)_os(which); if(which==="audit") loadList(); };
  });
  if(document.readyState!=="loading"){ var _os2=window.switchTab; window.switchTab=function(w){ if(_os2)_os2(w); if(w==="audit") loadList(); }; }
})();
