/* ============================================================
   Mr. Golisoda LMS — Trainer Credit tab.
   Trainer marks who they trained (induction/training) -> admin
   approves -> productivity + per-learner summary.
   Self-wires into admin switchTab().
   ============================================================ */
(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }

  var css = document.createElement("style");
  css.textContent = [
    "#tcRoot{width:100%;box-sizing:border-box}",
    "#tcRoot #tcBody{width:100%;box-sizing:border-box}",
    "#tcRoot .pcards{width:100%;box-sizing:border-box}",
    "#tcRoot .card>div{width:100%;box-sizing:border-box}",
    "#tcRoot .subtabs{display:flex;gap:4px;border-bottom:1px solid var(--mg-line,#e3e8ee);margin-bottom:14px;flex-wrap:wrap}",
    "#tcRoot .subtab{border:none;background:none;padding:10px 14px;font-size:13.5px;font-weight:600;color:#62707a;cursor:pointer;border-bottom:3px solid transparent;font-family:inherit}",
    "#tcRoot .subtab.on{color:var(--mg-blue,#1F5FA9);border-bottom-color:var(--mg-blue,#1F5FA9)}",
    "#tcRoot .card{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:12px;padding:16px;margin-bottom:12px}",
    "#tcRoot label.fl{display:block;font-size:12px;color:#62707a;margin:8px 0 3px}",
    "#tcRoot select,#tcRoot input{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--mg-line,#e3e8ee);border-radius:8px;font-size:14px;font-family:inherit}",
    "#tcRoot .modlist{max-height:220px;overflow:auto;border:1px solid var(--mg-line,#e3e8ee);border-radius:8px;padding:8px;margin-top:4px}",
    "#tcRoot .modlist label{display:flex;gap:8px;align-items:center;padding:4px 2px;font-size:13px;cursor:pointer}",
    "#tcRoot .modlist input{width:auto}",
    "#tcRoot .btn{padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none}",
    "#tcRoot .btn.pri{background:var(--mg-blue,#1F5FA9);color:#fff}#tcRoot .btn.sec{background:#eef2f5;color:#12284B}#tcRoot .btn.ok{background:#1d9e75;color:#fff}#tcRoot .btn.no{background:#fdeaea;color:#b5390b}",
    "#tcRoot table{width:100%;border-collapse:collapse;font-size:12.5px}",
    "#tcRoot th{background:#12284B;color:#fff;padding:7px 6px;text-align:left;font-size:11.5px}",
    "#tcRoot td{border-bottom:1px solid #f0f0f0;padding:7px 6px}",
    "#tcRoot .pill{padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}",
    "#tcRoot .arow{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:10px;padding:10px 13px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px}",
    "#tcRoot .eff{display:inline-block;height:10px;border-radius:5px}",
    "#tcRoot .big{font-size:22px;font-weight:800;color:#12284B}",
    "#tcRoot .pcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}",
    "#tcRoot .pcard{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:14px;padding:16px 18px}",
    "#tcRoot .pcard .pv{font-size:30px;font-weight:800;line-height:1.1}",
    "#tcRoot .pcard .pl{font-size:12.5px;color:#62707a;margin-top:4px}",
    "#tcRoot .pbar{display:flex;align-items:center;gap:10px;margin:8px 0;font-size:12.5px}",
    "#tcRoot .pbar.mine{background:#eef5fc;border-radius:7px;padding:3px 6px;margin:5px -6px}",
    "#tcRoot .pbar .pn{width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#42515c}",
    "#tcRoot .pbar .pt{flex:1;height:16px;background:#eef2f5;border-radius:8px;overflow:hidden}",
    "#tcRoot .pbar .pt i{display:block;height:100%}",
    "#tcRoot .pbar .pvv{width:46px;text-align:right;font-weight:800;color:#12284B}",
    // --- width overrides (LAST so they win over the global .card max-width cap) ---
    "#tcRoot .card{width:100%!important;max-width:none!important;box-sizing:border-box}",
    "#tcRoot table{width:100%!important;min-width:0!important}"
  ].join("\n");
  document.head.appendChild(css);

  var S = { view:"mark", cfg:null };

  async function getJ(u){ try{ return await (await fetch(u,{credentials:"same-origin"})).json(); }catch(e){ return {ok:false}; } }
  async function postJ(u,b){ try{ return await (await fetch(u,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)})).json(); }catch(e){ return {ok:false,msg:"Network problem."}; } }
  function note(m){ var n=document.createElement("div"); n.textContent=m; n.style.cssText="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#12284B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999"; document.body.appendChild(n); setTimeout(function(){n.remove();},2600); }

  function shell(inner){
    var tabs = [["mark","➕ Mark training"],
                [S.cfg&&S.cfg.is_admin?"approve":"mine", S.cfg&&S.cfg.is_admin?"✅ Approvals":"📋 My submissions"],
                ["confirm","✔ Confirmations"],
                ["prod","📊 Productivity"],
                ["byl","👥 By learner"]];
    var bar = '<div class="subtabs">'+tabs.map(function(t){
      return '<button class="subtab'+(S.view===t[0]?" on":"")+'" data-tv="'+t[0]+'">'+t[1]+'</button>';
    }).join("")+'</div>';
    $("tcRoot").innerHTML = bar + '<div id="tcBody">'+inner+'</div>';
    $("tcRoot").querySelectorAll(".subtab").forEach(function(b){
      b.addEventListener("click", function(){ S.view=b.dataset.tv; route(); });
    });
  }

  async function route(){
    if(!S.cfg){ var c=await getJ("/api/training/options"); S.cfg=(c&&c.ok)?c:{is_admin:false,trainers:[],learners:[],induction:[],training:[]}; }
    if(S.view==="mark") return renderMark();
    if(S.view==="approve"||S.view==="mine") return renderPending();
    if(S.view==="confirm") return renderConfirmations();
    if(S.view==="prod") return renderProd();
    if(S.view==="byl") return renderByLearner();
  }

  // ---- Mark training ----
  function renderMark(){
    var c=S.cfg;
    var trainerSel = c.is_admin
      ? '<label class="fl">Trainer (who delivered)</label><select id="tcTrainer"><option value="">— select trainer —</option>'+
          c.trainers.map(function(t){return '<option value="'+esc(t.emp_id)+'">'+esc(t.name)+'</option>';}).join("")+'</select>'
      : '<label class="fl">Trainer</label><input value="'+esc(c.me.name)+' (you)" readonly>';
    shell(
      '<div class="card"><h3 style="margin:0 0 4px">Mark who you trained</h3>'+
      '<p style="font-size:12.5px;color:#62707a;margin:0 0 8px">'+(c.is_admin?'As admin, this is recorded immediately.':'This goes to admin for approval before it counts.')+'</p>'+
      trainerSel+
      '<label class="fl">Learner (who was trained)</label><select id="tcLearner"><option value="">— select learner —</option>'+
        c.learners.map(function(l){return '<option value="'+esc(l.emp_id)+'">'+esc(l.name)+' ('+esc(l.designation||"")+')</option>';}).join("")+'</select>'+
      '<label class="fl">Type</label><select id="tcKind"><option value="induction">Induction</option><option value="training">Training</option></select>'+
      '<label class="fl">Modules delivered (tick all that apply)</label><div class="modlist" id="tcMods"></div>'+
      '<div style="margin-top:12px"><button class="btn pri" id="tcMarkBtn">Record training</button></div></div>'
    );
    fillMods();
    $("tcKind").addEventListener("change", fillMods);
    $("tcLearner").addEventListener("change", fillMods);
    $("tcMarkBtn").addEventListener("click", submitMark);
  }

  // does a module's roles field apply to this designation?
  function roleMatch(rolesField, designation){
    var roles = (rolesField || "all").trim().toLowerCase();
    if(roles === "" || roles === "all") return true;
    var desg = (designation || "").trim().toLowerCase();
    return roles.split(",").some(function(r){ r = r.trim(); return r && desg.indexOf(r) >= 0; });
  }

  // the selected learner's designation (for filtering training by designation)
  function selectedLearnerDesg(){
    var id = ($("tcLearner")||{}).value || "";
    var l = (S.cfg.learners||[]).find(function(x){ return x.emp_id === id; });
    return l ? (l.designation || "") : "";
  }

  function fillMods(){
    var kind = $("tcKind").value;
    var box = $("tcMods");
    var list;
    if(kind === "induction"){
      // induction is common to everyone — show all
      list = S.cfg.induction || [];
    } else {
      // training — filter to the selected learner's designation
      var learnerId = ($("tcLearner")||{}).value || "";
      if(!learnerId){
        box.innerHTML = '<div style="font-size:12.5px;color:#c98a00;padding:4px">Pick a learner first — training modules are shown for their designation.</div>';
        return;
      }
      var desg = selectedLearnerDesg();
      list = (S.cfg.training || []).filter(function(m){ return roleMatch(m.roles, desg); });
    }
    if(!list.length){
      box.innerHTML = '<div style="font-size:12.5px;color:#8a97a1;padding:4px">No '+kind+' modules found'+(kind==="training"?' for this designation.':'.')+'</div>';
      return;
    }
    // "Select all" row on top, then one checkbox per module
    var header = '<label style="border-bottom:1px solid var(--mg-line,#e3e8ee);margin-bottom:4px;padding-bottom:6px;font-weight:700">'+
                 '<input type="checkbox" id="tcModAll"> Select all ('+list.length+')</label>';
    box.innerHTML = header + list.map(function(m){
      return '<label><input type="checkbox" class="tcMod" value="'+m.id+'"> '+esc(m.title)+'</label>';
    }).join("");
    var all = $("tcModAll");
    if(all){
      all.addEventListener("change", function(){
        var on = all.checked;
        Array.prototype.slice.call(box.querySelectorAll(".tcMod")).forEach(function(c){ c.checked = on; });
      });
    }
    // keep "Select all" in sync if individual boxes change
    Array.prototype.slice.call(box.querySelectorAll(".tcMod")).forEach(function(c){
      c.addEventListener("change", function(){
        var boxes = Array.prototype.slice.call(box.querySelectorAll(".tcMod"));
        if(all) all.checked = boxes.length && boxes.every(function(x){ return x.checked; });
      });
    });
  }
  async function submitMark(){
    var trainer = S.cfg.is_admin ? ($("tcTrainer")||{}).value : S.cfg.me.emp_id;
    var learner = $("tcLearner").value;
    var kind = $("tcKind").value;
    var mods = Array.prototype.slice.call(document.querySelectorAll(".tcMod:checked")).map(function(x){return x.value;});
    if(!trainer){ note("Pick a trainer."); return; }
    if(!learner){ note("Pick a learner."); return; }
    if(!mods.length){ note("Tick at least one module."); return; }
    var r=await postJ("/api/training/mark",{trainer_id:trainer,learner_id:learner,kind:kind,module_ids:mods});
    if(r.ok){ note(r.msg||"Saved."); renderMark(); } else note(r.msg||"Could not save.");
  }

  // ---- Approvals / My submissions ----
  async function renderPending(){
    shell('<div class="empty">Loading…</div>');
    var d=await getJ("/api/training/pending");
    var items=(d&&d.ok)?d.items:[];

    // instructor (My submissions): simple flat list, unchanged
    if(!d.is_admin){
      var mine = items.length ? items.map(function(it){
        var stat = it.status==="approved" ? '<span class="pill" style="background:#eaf7f0;color:#0f6b45">Approved</span>'
          : '<span class="pill" style="background:#faf1de;color:#845a0b">Pending</span>';
        return '<div class="arow"><div><b>'+esc(it.trainer_name||it.trainer_id)+'</b> trained <b>'+esc(it.learner_name||it.learner_id)+'</b>'+
          '<br><span style="font-size:12px;color:#62707a">'+esc((it.kind||"").toUpperCase())+' · '+esc(it.module_title||"module")+'</span></div>'+
          '<div style="text-align:right">'+stat+'</div></div>';
      }).join("") : '<div class="empty" style="padding:16px">You haven\'t marked any training yet.</div>';
      shell(mine);
      return;
    }

    // ----- admin: pending deliveries, grouped by trainer, with filters + bulk approve -----
    var pending = items.filter(function(it){ return it.status==="pending"; });
    if(!pending.length){ shell('<div class="empty" style="padding:16px">Nothing waiting for approval. 👍</div>'); return; }

    // apply trainer + kind filters
    var tf = window.__tcPendTrainer || "";
    var kf = window.__tcPendKind || "";
    var view = pending.filter(function(it){
      if(tf && String(it.trainer_id)!==tf) return false;
      if(kf && (it.kind||"")!==kf) return false;
      return true;
    });

    // trainer dropdown (counts from the full pending set)
    var tc = {};
    pending.forEach(function(it){ var id=it.trainer_id||""; tc[id]=tc[id]||{name:it.trainer_name||id,n:0}; tc[id].n++; });
    var tOpts = '<option value="">All trainers ('+pending.length+')</option>' +
      Object.keys(tc).sort(function(a,b){return (tc[a].name||"").localeCompare(tc[b].name||"");}).map(function(id){
        return '<option value="'+esc(id)+'"'+(tf===id?' selected':'')+'>'+esc(tc[id].name)+' ('+tc[id].n+')</option>';
      }).join("");
    var kOpts = ['','induction','training'].map(function(k){
      var lbl = k===''?'All kinds':(k==='induction'?'Induction':'Training');
      return '<option value="'+k+'"'+(kf===k?' selected':'')+'>'+lbl+'</option>';
    }).join("");

    var filterBar = '<div class="card" style="padding:10px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px">'+
      '<span style="font-size:13px;font-weight:600;color:#12284B">Filter:</span>'+
      '<select id="tcPendTrainer" style="max-width:260px">'+tOpts+'</select>'+
      '<select id="tcPendKind">'+kOpts+'</select>'+
      ((tf||kf)?'<button class="btn sec" id="tcPendClear" style="padding:4px 10px;font-size:12px">Clear</button>':'')+
      '<span style="margin-left:auto;font-size:12px;color:#62707a">Showing <b>'+view.length+'</b> of '+pending.length+'</span>'+
      '</div>';

    // fast bulk-approve bar (approve-only; reject stays per-row)
    var scopeLabel = tf ? (' for '+esc((tc[tf]||{}).name||'')) : '';
    if(kf) scopeLabel += ' · '+(kf==='induction'?'Induction':'Training');
    var bulkBar = '<div class="card" style="padding:10px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px">'+
      '<button class="btn ok" id="tcApproveFiltered" style="padding:6px 16px;font-size:13px;font-weight:600">✓ Approve all '+view.length+(scopeLabel?('<span style="font-weight:400">'+scopeLabel+'</span>'):'')+'</button>'+
      '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer"><input type="checkbox" id="tcSelAll"> Select</label>'+
      '<button class="btn ok" id="tcApproveSel" style="padding:6px 14px;font-size:12.5px;display:none">✓ Approve selected (<span id="tcSelN">0</span>)</button>'+
      '<span style="margin-left:auto;font-size:11.5px;color:#9aa6ae">Reject is per-row (no bulk delete)</span>'+
      '</div>';

    // group the filtered rows by trainer, each group collapsible
    var groups = {};
    view.forEach(function(it){ var id=it.trainer_id||""; (groups[id]=groups[id]||{name:it.trainer_name||id, items:[]}).items.push(it); });
    window.__tcPendOpen = window.__tcPendOpen || {};
    var groupsHtml = Object.keys(groups).sort(function(a,b){return (groups[a].name||"").localeCompare(groups[b].name||"");}).map(function(gid){
      var g = groups[gid];
      var open = (tf ? true : (window.__tcPendOpen[gid] !== false));  // open when a single trainer is filtered
      var gidSafe = esc(gid);
      var head = '<div class="arow" style="background:#f7f9fa;cursor:pointer" data-gtoggle="'+gidSafe+'">'+
        '<div><b>'+esc(g.name)+'</b> <span style="font-size:12px;color:#62707a">· '+g.items.length+' pending</span></div>'+
        '<div style="display:flex;gap:8px;align-items:center">'+
          '<button class="btn ok" style="padding:4px 11px;font-size:11.5px" data-gapprove="'+gidSafe+'">✓ Approve these '+g.items.length+'</button>'+
          '<span style="font-size:14px;color:#8a97a0">'+(open?'▾':'▸')+'</span>'+
        '</div></div>';
      var body = open ? g.items.map(function(it){
        return '<div class="arow" style="padding-left:18px">'+
          '<div style="display:flex;align-items:center;gap:9px">'+
            '<input type="checkbox" class="tcPendChk" data-id="'+it.id+'">'+
            '<div>trained <b>'+esc(it.learner_name||it.learner_id)+'</b>'+
            '<br><span style="font-size:12px;color:#62707a">'+esc((it.kind||"").toUpperCase())+' · '+esc(it.module_title||"module")+'</span></div>'+
          '</div>'+
          '<div style="text-align:right;white-space:nowrap">'+
            '<button class="btn ok" style="padding:4px 11px;font-size:12px" data-ap="'+it.id+'">Approve</button> '+
            '<button class="btn no" style="padding:4px 11px;font-size:12px" data-rj="'+it.id+'">Reject</button>'+
          '</div></div>';
      }).join("") : "";
      return '<div class="card" style="padding:0;overflow:hidden;margin:0 0 8px">'+head+body+'</div>';
    }).join("");
    if(!view.length) groupsHtml = '<div class="empty" style="padding:16px">Nothing matches this filter.</div>';

    shell(filterBar + bulkBar + groupsHtml);

    // --- wiring ---
    var tsel=$("tcPendTrainer"); if(tsel) tsel.addEventListener("change", function(){ window.__tcPendTrainer=tsel.value||""; renderPending(); });
    var ksel=$("tcPendKind");    if(ksel) ksel.addEventListener("change", function(){ window.__tcPendKind=ksel.value||""; renderPending(); });
    var clr=$("tcPendClear");    if(clr) clr.addEventListener("click", function(){ window.__tcPendTrainer=""; window.__tcPendKind=""; renderPending(); });

    // group collapse/expand
    $("tcRoot").querySelectorAll("[data-gtoggle]").forEach(function(h){
      h.addEventListener("click", function(ev){
        if(ev.target.closest("[data-gapprove]")) return;   // the approve button handles itself
        var gid=h.getAttribute("data-gtoggle");
        window.__tcPendOpen[gid] = (window.__tcPendOpen[gid]===false) ? true : false;
        renderPending();
      });
    });
    // per-group approve (one fast request)
    $("tcRoot").querySelectorAll("[data-gapprove]").forEach(function(b){
      b.addEventListener("click", async function(ev){
        ev.stopPropagation();
        var gid=b.getAttribute("data-gapprove"); var g=groups[gid];
        if(!confirm("Approve all "+g.items.length+" deliveries for "+g.name+"?")) return;
        var r = await postJ("/api/training/resolve-bulk",{ids: g.items.map(function(x){return x.id;})});
        if(r.ok){ note(r.msg||("Approved "+(r.approved||0)+".")); } else note(r.msg||"Failed.");
        renderPending();
      });
    });
    // approve all (filtered) — one fast request, by filter
    var aF=$("tcApproveFiltered");
    if(aF) aF.addEventListener("click", async function(){
      if(!confirm("Approve all "+view.length+" shown deliveries"+(scopeLabel.replace(/<[^>]+>/g,''))+"?")) return;
      var payload = {};
      if(tf) payload.trainer_id = tf;
      if(kf) payload.kind = kf;
      // if no filter, approve exactly the shown ids to be safe
      if(!tf && !kf) payload = {ids: view.map(function(x){return x.id;})};
      var r = await postJ("/api/training/resolve-bulk", payload);
      if(r.ok){ note(r.msg||("Approved "+(r.approved||0)+".")); } else note(r.msg||"Failed.");
      renderPending();
    });
    // select mode + approve selected
    var selAll=$("tcSelAll"), aSel=$("tcApproveSel");
    function updSel(){
      var n=$("tcRoot").querySelectorAll(".tcPendChk:checked").length;
      if($("tcSelN")) $("tcSelN").textContent=n;
      if(aSel) aSel.style.display = n>0 ? "inline-block" : "none";
    }
    if(selAll) selAll.addEventListener("change", function(){
      $("tcRoot").querySelectorAll(".tcPendChk").forEach(function(c){ c.checked=selAll.checked; }); updSel();
    });
    $("tcRoot").querySelectorAll(".tcPendChk").forEach(function(c){ c.addEventListener("change", updSel); });
    if(aSel) aSel.addEventListener("click", async function(){
      var ids=[]; $("tcRoot").querySelectorAll(".tcPendChk:checked").forEach(function(c){ ids.push(c.dataset.id); });
      if(!ids.length){ note("Nothing selected."); return; }
      if(!confirm("Approve "+ids.length+" selected delivery(ies)?")) return;
      var r = await postJ("/api/training/resolve-bulk",{ids:ids});
      if(r.ok){ note(r.msg||("Approved "+(r.approved||0)+".")); } else note(r.msg||"Failed.");
      renderPending();
    });
    // per-row approve / reject (reject stays single — no bulk delete)
    $("tcRoot").querySelectorAll("[data-ap]").forEach(function(b){ b.addEventListener("click", function(){ resolve(b.dataset.ap,"approve"); }); });
    $("tcRoot").querySelectorAll("[data-rj]").forEach(function(b){ b.addEventListener("click", function(){ if(confirm("Reject (delete) this one delivery?")) resolve(b.dataset.rj,"reject"); }); });
  }
  async function resolve(id,decision){ var r=await postJ("/api/training/resolve",{id:id,decision:decision}); if(r.ok){note(r.msg||"Done.");renderPending();}else note(r.msg||"Failed."); }
  async function delRec(id){ var r=await postJ("/api/training/delete",{id:id}); if(r.ok){note("Removed.");renderPending();}else note(r.msg||"Failed."); }

  // ---- Confirmations (two-sided) ----
  async function renderConfirmations(){
    shell('<div class="empty">Loading…</div>');
    var isAdmin = S.cfg && S.cfg.is_admin;

    if(isAdmin){
      var d = await getJ("/api/training/confirmations");
      if(!d || !d.ok){ shell('<div class="empty" style="padding:16px">Could not load.</div>'); return; }
      var sm = d.summary || {};
      function card(v,l,col){ return '<div class="pcard"><div class="pv" style="color:'+(col||"#12284B")+'">'+v+'</div><div class="pl">'+l+'</div></div>'; }
      function fdate(s){ if(!s) return ""; var p=String(s).slice(0,10).split("-"); return p.length===3?(p[2]+"/"+p[1]+"/"+p[0]):s; }
      function kindTag(k){ if(!k) return ""; var ind=(k==="induction"); return ' <span style="font-size:10px;padding:1px 7px;border-radius:20px;'+(ind?"background:#eef5fc;color:#0c447c;border:1px solid #cddff0":"background:#f0f7ee;color:#3c6b1f;border:1px solid #cfe6c0")+'">'+(ind?"Induction":"Training")+'</span>'; }

      var cards = '<div class="pcards">'+
        card(sm.confirmed!=null?sm.confirmed:0,"✅ Confirmed (both agree)","#1d9e75")+
        card(sm.provisional!=null?sm.provisional:0,"⏳ Provisional (auto-confirming)",(sm.provisional?"#0c6fb0":"#62707a"))+
        card(sm.disputed!=null?sm.disputed:0,"🚩 Disputed — need you",(sm.disputed?"#d64545":"#1d9e75"))+
        card(sm.conflict!=null?sm.conflict:0,"⚠️ Conflicts — need you",(sm.conflict?"#d64545":"#1d9e75"))+
        card(sm.awaiting_trainer!=null?sm.awaiting_trainer:0,"🕐 Awaiting trainer","#c9a227")+
        card(sm.awaiting_learner!=null?sm.awaiting_learner:0,"🕐 Awaiting learner","#62707a")+
      '</div>';

      var trainerOpts = (S.cfg.trainers||[]).map(function(t){ return '<option value="'+esc(t.emp_id)+'">'+esc(t.name)+'</option>'; }).join("");
      var conf = d.conflicts || [];
      var aw   = d.awaiting_trainer_list || [];
      var awl  = d.awaiting_learner_list || [];
      var prov = d.provisional_list || [];
      var disp = d.disputed_list || [];

      // ----- trainer filter (applies to both lists) -----
      // which trainers appear anywhere, with counts, for the dropdown
      var tcount = {};  // emp_id -> {name, conf, aw}
      conf.forEach(function(c){ (c.record_says_ids||[]).concat([c.learner_says_id]).forEach(function(id){ if(!id)return; var nm=(id===c.learner_says_id)?c.learner_says:((c.record_says||"").split(", ")[(c.record_says_ids||[]).indexOf(id)]||id); tcount[id]=tcount[id]||{name:nm,conf:0,aw:0}; }); });
      conf.forEach(function(c){ var id=c.learner_says_id; if(id){ tcount[id]=tcount[id]||{name:c.learner_says,conf:0,aw:0}; tcount[id].conf++; } });
      aw.forEach(function(a){ var id=a.learner_says_id; if(id){ tcount[id]=tcount[id]||{name:a.learner_says,conf:0,aw:0}; tcount[id].aw++; } });
      var tfOpts = '<option value="">All trainers ('+conf.length+' conflicts · '+aw.length+' awaiting)</option>' +
        Object.keys(tcount).sort(function(a,b){return (tcount[a].name||"").localeCompare(tcount[b].name||"");}).map(function(id){
          var t=tcount[id]; return '<option value="'+esc(id)+'"'+(window.__tcConfTrainer===id?' selected':'')+'>'+esc(t.name)+' — '+t.aw+' awaiting'+(t.conf?(' · '+t.conf+' conflict'):'')+'</option>';
        }).join("");
      var filterBar = '<div class="card" style="padding:10px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">'+
        '<span style="font-size:13px;font-weight:600;color:#12284B">Filter by trainer:</span>'+
        '<select id="tcConfTrainer" style="max-width:320px">'+tfOpts+'</select>'+
        (window.__tcConfTrainer?'<button class="btn sec" id="tcConfClear" style="padding:4px 10px;font-size:12px">Clear</button>':'')+
        '</div>';

      // apply the filter
      var tf = window.__tcConfTrainer || "";
      if(tf){
        conf = conf.filter(function(c){ return c.learner_says_id===tf || (c.record_says_ids||[]).indexOf(tf)>=0; });
        aw   = aw.filter(function(a){ return a.learner_says_id===tf; });
      }

      // ----- conflicts (one-by-one; each needs a decision) -----
      var confHtml = '<div class="card"><h4 style="margin:0 0 4px;font-size:14px;color:#b4231d">⚠️ Conflicts — learner & trainer record disagree ('+conf.length+')</h4>'+
        '<p style="font-size:12px;color:#62707a;margin:0 0 10px">Pick the correct trainer. That becomes the confirmed delivery and the learner\'s rating is aligned to match.</p>';
      if(!conf.length){ confHtml += '<div class="empty" style="padding:10px">No conflicts'+(tf?" for this trainer":"")+'. 👍</div>'; }
      else {
        confHtml += conf.map(function(c){
          var key = esc(c.learner_id)+'|'+c.module_id;
          var sel = '<select data-csel="'+key+'" style="max-width:220px">'+
            '<option value="'+esc(c.learner_says_id)+'">'+esc(c.learner_says)+' (learner\'s pick)</option>'+
            (c.record_says_ids||[]).map(function(id,i){ return '<option value="'+esc(id)+'">'+esc((c.record_says||"").split(", ")[i]||id)+' (record)</option>'; }).join("")+
            trainerOpts+'</select>';
          return '<div class="arow" style="flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>'+esc(c.learner)+'</b> · '+esc(c.module)+kindTag(c.kind)+(c.date?' <span style="font-size:11px;color:#9aa6ae">· '+fdate(c.date)+'</span>':'')+
            '<br><span style="font-size:12px;color:#62707a">Learner says <b>'+esc(c.learner_says)+'</b> · Record says <b>'+esc(c.record_says)+'</b></span></div>'+
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+sel+
            '<button class="btn ok" style="padding:5px 12px;font-size:12px" data-cres="'+key+'" data-lid="'+esc(c.learner_id)+'" data-mid="'+c.module_id+'">Confirm</button>'+
            '<button class="btn sec" style="padding:5px 10px;font-size:12px" data-cdis="'+key+'" data-lid="'+esc(c.learner_id)+'" data-mid="'+c.module_id+'">Dismiss</button>'+
            '</div></div>';
        }).join("");
      }
      confHtml += '</div>';

      // ----- awaiting trainer (learner claimed, no record) + Confirm-all -----
      var awLabel = tf ? ('Confirm all '+aw.length+' for '+esc((tcount[tf]||{}).name||"")) : ('Confirm all '+aw.length);
      var awHtml = '<div class="card"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 4px">'+
        '<h4 style="margin:0;font-size:14px;color:#845a0b">🕐 Awaiting trainer confirmation ('+aw.length+')</h4>'+
        (aw.length?'<button class="btn ok" id="tcConfAll" style="margin-left:auto;padding:6px 14px;font-size:12.5px;font-weight:600">✅ '+awLabel+'</button>':'')+
        '</div>'+
        '<p style="font-size:12px;color:#62707a;margin:0 0 10px">A learner marked who trained them, but that trainer hasn\'t logged it. Confirm to record it.</p>';
      if(!aw.length){ awHtml += '<div class="empty" style="padding:10px">Nothing waiting'+(tf?" for this trainer":"")+'.</div>'; }
      else {
        awHtml += aw.map(function(a){
          var key = esc(a.learner_id)+'|'+a.module_id;
          return '<div class="arow"><div style="flex:1"><b>'+esc(a.learner)+'</b> · '+esc(a.module)+kindTag(a.kind)+(a.date?' <span style="font-size:11px;color:#9aa6ae">· '+fdate(a.date)+'</span>':'')+
            '<br><span style="font-size:12px;color:#62707a">Learner says trainer: <b>'+esc(a.learner_says)+'</b></span></div>'+
            '<button class="btn ok" style="padding:5px 12px;font-size:12px" data-aw="'+key+'" data-lid="'+esc(a.learner_id)+'" data-tid="'+esc(a.learner_says_id)+'" data-mid="'+a.module_id+'">Confirm</button></div>';
        }).join("");
      }
      awHtml += '</div>';

      // ----- awaiting learner (trainer logged, learner hasn't rated) — collapsed -----
      var awlHtml = '<div class="card"><h4 style="margin:0 0 4px;font-size:14px;color:#55636d">🕐 Awaiting learner rating ('+awl.length+') '+
        '<button class="btn sec" id="tcAwlToggle" style="padding:3px 10px;font-size:11.5px;margin-left:6px">'+(window.__tcAwlOpen?"Hide":"Show")+'</button></h4>'+
        '<p style="font-size:12px;color:#62707a;margin:0 0 6px">Trainer logged the delivery; the learner hasn\'t rated the module yet, so it can\'t auto-confirm. Nudge these learners to rate.</p>';
      if(window.__tcAwlOpen){
        if(!awl.length){ awlHtml += '<div class="empty" style="padding:10px">None.</div>'; }
        else {
          awlHtml += '<div style="max-height:320px;overflow:auto">'+awl.map(function(a){
            return '<div class="arow"><div style="flex:1"><b>'+esc(a.learner)+'</b> · '+esc(a.module)+kindTag(a.kind)+(a.date?' <span style="font-size:11px;color:#9aa6ae">· '+fdate(a.date)+'</span>':'')+
              '<br><span style="font-size:12px;color:#62707a">Trainer on record: <b>'+esc(a.record_says)+'</b> — waiting on learner\'s rating</span></div></div>';
          }).join("")+'</div>';
        }
      }
      awlHtml += '</div>';

      // apply trainer filter to provisional + disputed too
      if(tf){
        prov = prov.filter(function(p){ return p.trainer_id===tf; });
        disp = disp.filter(function(x){ return x.trainer_id===tf; });
      }

      // ----- 🚩 DISPUTED — trainer says they didn't train this; admin decides -----
      var dispHtml = '<div class="card"><h4 style="margin:0 0 4px;font-size:14px;color:#b4231d">🚩 Disputed credits — a trainer says this is wrong ('+disp.length+')</h4>'+
        '<p style="font-size:12px;color:#62707a;margin:0 0 10px">Approve to remove the credit (they didn\'t train this learner), or reject to let it stand.</p>';
      if(!disp.length){ dispHtml += '<div class="empty" style="padding:10px">No disputes'+(tf?" for this trainer":"")+'. 👍</div>'; }
      else {
        dispHtml += disp.map(function(x){
          return '<div class="arow" style="flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>'+esc(x.learner)+'</b> · '+esc(x.module)+kindTag(x.kind)+(x.date?' <span style="font-size:11px;color:#9aa6ae">· '+fdate(x.date)+'</span>':'')+
            '<br><span style="font-size:12px;color:#62707a">Credit was to <b>'+esc(x.trainer)+'</b> — they dispute it'+(x.reason?(': “'+esc(x.reason)+'”'):'')+(x.raised_by?(' <span style="color:#9aa6ae">(raised by '+esc(x.raised_by)+')</span>'):'')+'</span></div>'+
            '<div style="display:flex;gap:6px;align-items:center">'+
            '<button class="btn ok" style="padding:5px 12px;font-size:12px" data-dapp="'+x.delivery_id+'">Approve — remove credit</button>'+
            '<button class="btn sec" style="padding:5px 10px;font-size:12px" data-drej="'+x.delivery_id+'">Reject — keep it</button>'+
            '</div></div>';
        }).join("");
      }
      dispHtml += '</div>';

      // ----- ⏳ PROVISIONAL — learner-named, auto-confirming (info; admin can act) -----
      var provHtml = '<div class="card"><h4 style="margin:0 0 4px;font-size:14px;color:#0c6fb0">⏳ Provisional — auto-confirming ('+prov.length+') '+
        '<button class="btn sec" id="tcProvToggle" style="padding:3px 10px;font-size:11.5px;margin-left:6px">'+(window.__tcProvOpen?"Hide":"Show")+'</button></h4>'+
        '<p style="font-size:12px;color:#62707a;margin:0 0 6px">A learner named the trainer. These count toward KPI automatically once the 48h window passes — unless the trainer disputes. You can confirm now or revoke early.</p>';
      if(window.__tcProvOpen){
        if(!prov.length){ provHtml += '<div class="empty" style="padding:10px">None'+(tf?" for this trainer":"")+'.</div>'; }
        else {
          provHtml += '<div style="max-height:360px;overflow:auto">'+prov.map(function(p){
            var hl = (p.hours_left!=null)?(p.hours_left<=0?'<b style="color:#0f6b45">due now</b>':('in <b>'+p.hours_left+'h</b>')):'';
            return '<div class="arow"><div style="flex:1"><b>'+esc(p.learner)+'</b> · '+esc(p.module)+kindTag(p.kind)+(p.date?' <span style="font-size:11px;color:#9aa6ae">· '+fdate(p.date)+'</span>':'')+
              '<br><span style="font-size:12px;color:#62707a">Credit to <b>'+esc(p.trainer)+'</b> — auto-confirms '+hl+'</span></div>'+
              '<div style="display:flex;gap:6px;align-items:center">'+
              '<button class="btn ok" style="padding:4px 10px;font-size:11.5px" data-provok="'+p.delivery_id+'" data-lid="'+esc(p.learner_id)+'" data-tid="'+esc(p.trainer_id)+'" data-mid="'+p.module_id+'">Confirm now</button>'+
              '<button class="btn sec" style="padding:4px 10px;font-size:11.5px" data-provno="'+p.delivery_id+'" data-lid="'+esc(p.learner_id)+'" data-tid="'+esc(p.trainer_id)+'" data-mid="'+p.module_id+'">Revoke</button>'+
              '</div></div>';
          }).join("")+'</div>';
        }
      }
      provHtml += '</div>';

      shell(cards + filterBar + dispHtml + provHtml + confHtml + awHtml + awlHtml);

      // disputed resolve wiring
      $("tcRoot").querySelectorAll("[data-dapp]").forEach(function(b){
        b.addEventListener("click", async function(){
          if(!confirm("Approve this dispute and REMOVE the credit? This takes it off the trainer's KPI.")) return;
          var r = await postJ("/api/training/dispute-resolve",{delivery_id:b.dataset.dapp,decision:"approve"});
          if(r.ok){ note(r.msg||"Credit removed."); renderConfirmations(); } else note(r.msg||"Failed.");
        });
      });
      $("tcRoot").querySelectorAll("[data-drej]").forEach(function(b){
        b.addEventListener("click", async function(){
          var r = await postJ("/api/training/dispute-resolve",{delivery_id:b.dataset.drej,decision:"reject"});
          if(r.ok){ note(r.msg||"Credit stands."); renderConfirmations(); } else note(r.msg||"Failed.");
        });
      });
      // provisional toggle + act-now
      var provT = $("tcProvToggle");
      if(provT){ provT.addEventListener("click", function(){ window.__tcProvOpen=!window.__tcProvOpen; renderConfirmations(); }); }
      $("tcRoot").querySelectorAll("[data-provok]").forEach(function(b){
        b.addEventListener("click", async function(){
          var r = await postJ("/api/training/confirm-claim",{learner_id:b.dataset.lid,trainer_id:b.dataset.tid,module_id:b.dataset.mid});
          if(r.ok){ note(r.msg||"Confirmed now."); renderConfirmations(); } else note(r.msg||"Failed.");
        });
      });
      $("tcRoot").querySelectorAll("[data-provno]").forEach(function(b){
        b.addEventListener("click", async function(){
          if(!confirm("Revoke this provisional credit? It won't count toward KPI.")) return;
          var r = await postJ("/api/training/confirm-undo",{items:[{learner_id:b.dataset.lid,trainer_id:b.dataset.tid,module_id:b.dataset.mid}]});
          if(r.ok){ note(r.msg||"Revoked."); renderConfirmations(); } else note(r.msg||"Failed.");
        });
      });

      // trainer filter wiring
      var tsel = $("tcConfTrainer");
      if(tsel){ tsel.addEventListener("change", function(){ window.__tcConfTrainer = tsel.value || ""; renderConfirmations(); }); }
      var tclr = $("tcConfClear");
      if(tclr){ tclr.addEventListener("click", function(){ window.__tcConfTrainer=""; renderConfirmations(); }); }
      var awlT = $("tcAwlToggle");
      if(awlT){ awlT.addEventListener("click", function(){ window.__tcAwlOpen = !window.__tcAwlOpen; renderConfirmations(); }); }

      // Confirm-all (awaiting-trainer), scoped to the selected trainer if any
      var allBtn = $("tcConfAll");
      if(allBtn){
        allBtn.addEventListener("click", async function(){
          var scope = window.__tcConfTrainer || "";
          var n = aw.length;
          if(!confirm("Confirm "+n+" awaiting delivery(ies)"+(scope?(" for "+((tcount[scope]||{}).name||"this trainer")):"")+"?\n\nEach records the trainer the learner named. You can undo right after.")) return;
          var r = await postJ("/api/training/confirm-claim-bulk", scope?{trainer_id:scope}:{});
          if(r.ok){
            note(r.msg||("Confirmed "+(r.confirmed||0)+"."));
            window.__tcLastBulk = r.done || [];   // remember for undo
            renderConfirmations();
            // offer undo
            if((r.confirmed||0)>0){
              setTimeout(function(){
                var bar = document.createElement("div");
                bar.id="tcUndoBar";
                bar.style.cssText="position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#12284B;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.25);z-index:9999;display:flex;gap:12px;align-items:center";
                bar.innerHTML='Confirmed '+(r.confirmed||0)+' delivery(ies). <button id="tcUndoBtn" style="background:#fff;color:#12284B;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer">Undo</button>';
                document.body.appendChild(bar);
                $("tcUndoBtn").addEventListener("click", async function(){
                  var ru = await postJ("/api/training/confirm-undo",{items: window.__tcLastBulk||[]});
                  note(ru.ok?(ru.msg||"Undone."):(ru.msg||"Could not undo.")); bar.remove(); renderConfirmations();
                });
                setTimeout(function(){ var b=$("tcUndoBar"); if(b) b.remove(); }, 12000);
              }, 60);
            }
          } else note(r.msg||"Failed.");
        });
      }

      // wire conflict resolve/dismiss
      $("tcRoot").querySelectorAll("[data-cres]").forEach(function(b){
        b.addEventListener("click", async function(){
          var sel = $("tcRoot").querySelector('[data-csel="'+b.dataset.cres.replace(/"/g,'\\"')+'"]');
          var tid = sel ? sel.value : "";
          var r = await postJ("/api/training/confirm-resolve",{learner_id:b.dataset.lid,module_id:b.dataset.mid,trainer_id:tid,decision:"resolve"});
          if(r.ok){ note(r.msg||"Resolved."); renderConfirmations(); } else note(r.msg||"Failed.");
        });
      });
      $("tcRoot").querySelectorAll("[data-cdis]").forEach(function(b){
        b.addEventListener("click", async function(){
          var r = await postJ("/api/training/confirm-resolve",{learner_id:b.dataset.lid,module_id:b.dataset.mid,decision:"dismiss"});
          if(r.ok){ note(r.msg||"Left as-is."); renderConfirmations(); } else note(r.msg||"Failed.");
        });
      });
      // single awaiting-trainer confirm (with an undo offer)
      $("tcRoot").querySelectorAll("[data-aw]").forEach(function(b){
        b.addEventListener("click", async function(){
          var payload={learner_id:b.dataset.lid,trainer_id:b.dataset.tid,module_id:b.dataset.mid};
          var r = await postJ("/api/training/confirm-claim",payload);
          if(r.ok){
            note(r.msg||"Confirmed.");
            window.__tcLastBulk=[payload];
            renderConfirmations();
          } else note(r.msg||"Failed.");
        });
      });
      return;
    }

    // ----- instructor view: their own 'awaiting your confirmation' items -----
    var p = await getJ("/api/training/pending");
    var aw2 = (p && p.ok) ? (p.awaiting_confirmation || []) : [];
    var html = '<div class="card"><h4 style="margin:0 0 4px;font-size:14px;color:#12284B">✔ Awaiting your confirmation ('+aw2.length+')</h4>'+
      '<p style="font-size:12px;color:#62707a;margin:0 0 10px">Learners marked that <b>you</b> trained them on these modules. Confirm to record it — or ignore if it\'s wrong.</p>';
    if(!aw2.length){ html += '<div class="empty" style="padding:10px">Nothing waiting. When a learner names you as their trainer, it shows here.</div>'; }
    else {
      html += aw2.map(function(a){
        var key = esc(a.learner_id)+'|'+a.module_id;
        return '<div class="arow"><div style="flex:1"><b>'+esc(a.learner_name)+'</b> · '+esc(a.module_title)+'</div>'+
          '<button class="btn ok" style="padding:5px 12px;font-size:12px" data-aw="'+key+'" data-lid="'+esc(a.learner_id)+'" data-tid="'+esc(a.trainer_id)+'" data-mid="'+a.module_id+'">Confirm I trained them</button></div>';
      }).join("");
    }
    html += '</div>';

    // ----- your credits (dispute if wrong) -----
    var mc = await getJ("/api/training/my-credits");
    var credits = (mc && mc.ok) ? (mc.credits || []) : [];
    function kTag(k){ if(!k) return ""; var ind=(k==="induction"); return ' <span style="font-size:10px;padding:1px 7px;border-radius:20px;'+(ind?"background:#eef5fc;color:#0c447c;border:1px solid #cddff0":"background:#f0f7ee;color:#3c6b1f;border:1px solid #cfe6c0")+'">'+(ind?"Induction":"Training")+'</span>'; }
    var ch = '<div class="card"><h4 style="margin:0 0 4px;font-size:14px;color:#12284B">📒 Credits assigned to you ('+credits.length+')</h4>'+
      '<p style="font-size:12px;color:#62707a;margin:0 0 10px">These count toward your KPI. If a learner named you by mistake, tap <b>Dispute</b> — it goes to the admin to remove.</p>';
    if(!credits.length){ ch += '<div class="empty" style="padding:10px">No credits yet.</div>'; }
    else {
      ch += credits.map(function(c){
        var badge = c.disputed
          ? '<span style="font-size:11px;color:#b4231d;font-weight:600">🚩 Disputed — with admin</span>'
          : (c.status==="provisional"
              ? '<span style="font-size:11px;color:#0c6fb0">⏳ Auto-confirms'+(c.hours_left!=null?(' in '+c.hours_left+'h'):'')+'</span>'
              : '<span style="font-size:11px;color:#0f6b45">✅ Counting</span>');
        var btn = c.disputed ? '' : '<button class="btn sec" style="padding:4px 10px;font-size:11.5px" data-disp="'+c.delivery_id+'">Dispute</button>';
        return '<div class="arow"><div style="flex:1"><b>'+esc(c.learner)+'</b> · '+esc(c.module)+kTag(c.kind)+'<br>'+badge+'</div>'+btn+'</div>';
      }).join("");
    }
    ch += '</div>';

    shell(html + ch);
    $("tcRoot").querySelectorAll("[data-aw]").forEach(function(b){
      b.addEventListener("click", async function(){
        var r = await postJ("/api/training/confirm-claim",{learner_id:b.dataset.lid,trainer_id:b.dataset.tid,module_id:b.dataset.mid});
        if(r.ok){ note(r.msg||"Confirmed."); renderConfirmations(); } else note(r.msg||"Failed.");
      });
    });
    $("tcRoot").querySelectorAll("[data-disp]").forEach(function(b){
      b.addEventListener("click", async function(){
        var why = prompt("Dispute this credit — why wasn't it you? (optional)");
        if(why === null) return;  // cancelled
        var r = await postJ("/api/training/dispute",{delivery_id:b.dataset.disp,reason:why||""});
        if(r.ok){ note(r.msg||"Dispute raised."); renderConfirmations(); } else note(r.msg||"Failed.");
      });
    });
  }

  // ---- Productivity ----
  var PROD_RANGE = "today";
  window.__tcProdRange = function(r){ PROD_RANGE = r; renderProd(); };

  async function renderProd(){
    shell('<div class="empty">Loading…</div>');
    var meId = (S.cfg && S.cfg.me) ? S.cfg.me.emp_id : null;

    // pull cumulative scorecard + the period activity together
    var d = await getJ("/api/training/productivity");
    var act = await getJ("/api/training/activity-by-trainer?range=" + encodeURIComponent(PROD_RANGE));

    var all = (d && d.ok) ? d.trainers : [];
    if(!all.length){ shell('<div class="empty" style="padding:16px">No approved training records yet. Mark some training first.</div>'); return; }

    // split competition (L&D Executives) vs L&D Manager (you / others)
    var t = all.filter(function(x){ return x.is_trainer; });
    var mgr = all.filter(function(x){ return !x.is_trainer; });

    function card(v, l, col){ return '<div class="pcard"><div class="pv" style="color:'+(col||"#12284B")+'">'+v+'</div><div class="pl">'+l+'</div></div>'; }

    // ---------- PERIOD ACTIVITY (who did what, today/week/month) ----------
    var rngLabel = {today:"Today", week:"This week", month:"This month", all:"All time"}[PROD_RANGE] || "Today";
    var pills = '<div class="subtabs" style="border:none;margin:0 0 12px">'+
      [["today","Today"],["week","This week"],["month","This month"],["all","All time"]].map(function(p){
        return '<button class="subtab'+(PROD_RANGE===p[0]?" on":"")+'" onclick="window.__tcProdRange(\''+p[0]+'\')">'+p[1]+'</button>';
      }).join("")+'</div>';

    var ts = (act && act.ok && act.team_summary) || {};
    var periodCards = '<div class="pcards">'+
      card((ts.active_trainers!=null?ts.active_trainers:0)+" / "+(ts.total_trainers!=null?ts.total_trainers:0), "Active trainers ("+rngLabel.toLowerCase()+")")+
      card(ts.deliveries!=null?ts.deliveries:0, "Modules delivered")+
      card(ts.completions!=null?ts.completions:0, "Modules completed")+
      card((ts.assess_passed!=null?ts.assess_passed:0)+" / "+(ts.assess_taken!=null?ts.assess_taken:0), "Assessments passed/taken")+
      card(ts.ojt_calls!=null?ts.ojt_calls:0, "OJT calls")+
    '</div>';

    var aTr = (act && act.ok) ? (act.trainers||[]) : [];
    var periodTable;
    if(!aTr.length){
      periodTable = '<div class="empty" style="padding:14px">No trainer activity '+rngLabel.toLowerCase()+'.</div>';
    } else {
      periodTable = '<div style="overflow-x:auto;width:100%"><table style="width:100%">'+
        '<thead><tr><th>Trainer</th><th style="text-align:center">Delivered</th><th style="text-align:center">Completed</th>'+
        '<th style="text-align:center">Assess (pass/taken)</th><th style="text-align:center">OJT calls</th><th style="text-align:center">Learners</th><th style="text-align:center">Status</th></tr></thead><tbody>'+
        aTr.map(function(x){
          var statusTag = x.active
            ? '<span class="pill" style="background:#eaf7f0;color:#0f6b45">Active</span>'
            : '<span class="pill" style="background:#faf1de;color:#845a0b">No activity</span>';
          return '<tr><td style="white-space:nowrap"><b>'+esc(x.trainer)+'</b></td>'+
            '<td style="text-align:center;font-weight:700">'+x.deliveries+'</td>'+
            '<td style="text-align:center">'+x.completions+'</td>'+
            '<td style="text-align:center">'+x.assess_passed+' / '+x.assess_taken+'</td>'+
            '<td style="text-align:center">'+x.ojt_calls+'</td>'+
            '<td style="text-align:center">'+x.learners+'</td>'+
            '<td style="text-align:center">'+statusTag+'</td></tr>';
        }).join("")+'</tbody></table></div>';
    }

    var periodSection = '<div class="card"><h4 style="margin:0 0 6px;font-size:14px;color:#12284B">🕒 Trainer activity — '+esc(rngLabel)+'</h4>'+
      '<p style="font-size:12px;color:#62707a;margin:0 0 10px">Who did what in this period — modules delivered & completed, assessments taken/passed, OJT calls. (Attributed to the trainer who delivered each learner\'s module.)</p>'+
      pills + periodCards + periodTable + '</div>';

    // ---------- CUMULATIVE COMPETITION (L&D Executives, all-time) ----------
    var sm=(d&&d.summary)||{};
    var cards = '<div class="pcards">'+
      card(t.length, "Trainers (competing)")+
      card(sm.trained!=null?sm.trained:"—", "People trained (all)")+
      card(sm.avg_score!=null?sm.avg_score+"%":"—", "Overall avg score", sm.avg_score!=null?(sm.avg_score>=70?"#1d9e75":"#c9a227"):"#12284B")+
      card(sm.first_rate!=null?sm.first_rate+"%":"—", "Overall 1st-try rate", sm.first_rate!=null?(sm.first_rate>=70?"#1d9e75":(sm.first_rate>=50?"#c9a227":"#d64545")):"#12284B")+
    '</div>';

    var maxRate = Math.max.apply(null, t.map(function(x){return x.first_rate||0;})) || 100;
    var chart = '<div class="card"><h4 style="margin:0 0 12px;font-size:14px;color:#12284B">1st-try pass rate by trainer (all-time)</h4>'+
      t.map(function(x){
        var r=x.first_rate||0, col=r>=70?"#1d9e75":(r>=50?"#c9a227":"#d64545");
        return '<div class="pbar"><span class="pn">'+esc(x.trainer)+'</span>'+
          '<span class="pt"><i style="width:'+Math.round((x.first_rate||0)*100/maxRate)+'%;background:'+col+'"></i></span>'+
          '<span class="pvv">'+(x.first_rate==null?"—":x.first_rate+"%")+'</span></div>';
      }).join("")+'</div>';

    function scoreRow(x, idx){
      var fr = x.first_rate==null?"—":x.first_rate+"%";
      var frCol = x.first_rate==null?"#aaa":(x.first_rate>=70?"#1d9e75":(x.first_rate>=50?"#c9a227":"#d64545"));
      var avg = x.avg_score==null?"—":x.avg_score+"%";
      var tot = x.pass_events||0;
      function seg(n,col){ return tot&&n? '<span class="eff" style="flex:'+n+';background:'+col+'" title="'+n+'"></span>':''; }
      var bar = tot? '<div style="display:flex;gap:1px;align-items:center;width:140px;height:12px;border-radius:6px;overflow:hidden;background:#eef2f5">'+seg(x.first_try,"#1d9e75")+seg(x.second,"#c9a227")+seg(x.third_plus,"#d64545")+'</div>' : '<span style="color:#aaa">—</span>';
      var medal = idx===0?"🥇 ":idx===1?"🥈 ":idx===2?"🥉 ":"";
      return '<tr><td style="white-space:nowrap">'+(idx!=null?medal:'')+'<b>'+esc(x.trainer)+'</b></td>'+
        '<td style="text-align:center;font-weight:700">'+x.learners+'</td>'+
        '<td style="text-align:center">'+x.ind+' / '+x.trn+'</td>'+
        '<td style="text-align:center;font-weight:700">'+avg+'</td>'+
        '<td style="text-align:center;font-weight:800;color:'+frCol+'">'+fr+'</td>'+
        '<td>'+bar+'</td>'+
        '<td style="font-size:11px;color:#62707a;white-space:nowrap">1st '+x.first_try+' · 2nd '+x.second+' · 3rd+ '+x.third_plus+'</td></tr>';
    }
    var compTable = '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto;width:100%"><table style="width:100%">'+
      '<thead><tr><th>Trainer</th><th style="text-align:center">Trained</th><th style="text-align:center">Ind / Trn</th>'+
      '<th style="text-align:center">Avg score</th><th style="text-align:center">1st-try rate</th><th>Pass split</th><th>Breakdown</th></tr></thead>'+
      '<tbody>'+t.map(function(x,i){return scoreRow(x,i);}).join("")+'</tbody></table></div></div>';

    var compSection = '<div style="margin-top:6px"><h3 style="font-size:15px;color:#12284B;margin:16px 0 8px">🏆 Trainers — competition (all-time)</h3>'+
      cards + chart + compTable +
      '<div style="font-size:11.5px;color:#62707a;padding:4px 2px 12px">“1st-try pass rate” = of all assessments this trainer’s learners passed, how many on the first attempt. The L&D Manager is shown separately below, not in this ranking.</div></div>';

    // ---------- L&D MANAGER (you) — separate ----------
    var mgrSection = "";
    if(mgr.length){
      mgrSection = '<div style="margin-top:6px"><h3 style="font-size:15px;color:#12284B;margin:16px 0 8px">👤 L&D Manager — your own activity <span style="font-size:12px;color:#62707a;font-weight:400">(not in the competition)</span></h3>'+
        '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto;width:100%"><table style="width:100%">'+
        '<thead><tr><th>Name</th><th style="text-align:center">Trained</th><th style="text-align:center">Ind / Trn</th>'+
        '<th style="text-align:center">Avg score</th><th style="text-align:center">1st-try rate</th><th>Pass split</th></tr></thead><tbody>'+
        mgr.map(function(x){
          var fr = x.first_rate==null?"—":x.first_rate+"%";
          var avg = x.avg_score==null?"—":x.avg_score+"%";
          var tot=x.pass_events||0;
          function seg(n,col){ return tot&&n? '<span class="eff" style="flex:'+n+';background:'+col+'"></span>':''; }
          var bar = tot? '<div style="display:flex;gap:1px;align-items:center;width:120px;height:10px;border-radius:5px;overflow:hidden;background:#eef2f5">'+seg(x.first_try,"#1d9e75")+seg(x.second,"#c9a227")+seg(x.third_plus,"#d64545")+'</div>' : '—';
          var you = (x.trainer_id===meId) ? ' <span style="font-size:10px;color:#1F5FA9">(you)</span>' : '';
          return '<tr><td><b>'+esc(x.trainer)+'</b>'+you+'</td>'+
            '<td style="text-align:center;font-weight:700">'+x.learners+'</td>'+
            '<td style="text-align:center">'+x.ind+' / '+x.trn+'</td>'+
            '<td style="text-align:center;font-weight:700">'+avg+'</td>'+
            '<td style="text-align:center;font-weight:800">'+fr+'</td>'+
            '<td>'+bar+'</td></tr>';
        }).join("")+'</tbody></table></div></div></div>';
    }

    shell(periodSection + compSection + mgrSection);
  }

  // ---- By learner ----
  async function renderByLearner(){
    shell('<div class="empty">Loading…</div>');
    var d=await getJ("/api/training/by-learner");
    var l=(d&&d.ok)?d.learners:[];
    if(!l.length){ shell('<div class="empty" style="padding:16px">No approved training records yet.</div>'); return; }
    var rows=l.map(function(x){
      return '<tr><td><b>'+esc(x.name)+'</b><br><span style="font-size:11px;color:#8a97a1">'+esc(x.learner_id)+'</span></td>'+
        '<td>'+(x.induction_by.length?x.induction_by.map(esc).join(", "):'<span style="color:#aaa">—</span>')+'</td>'+
        '<td>'+(x.training_by.length?x.training_by.map(esc).join(", "):'<span style="color:#aaa">—</span>')+'</td></tr>';
    }).join("");
    shell('<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto;width:100%"><table style="width:100%">'+
      '<thead><tr><th>Learner</th><th>Induction by</th><th>Training by</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>');
  }

  // self-wire
  try { TABS.tc = "tabTc"; TAB_BTNS.tc = "tabTcBtn"; } catch(e){}
  document.addEventListener("DOMContentLoaded", function(){
    var _os=window.switchTab;
    window.switchTab=function(w){ if(_os)_os(w); if(w==="tc"){ S.cfg=null; S.view="mark"; route(); } };
  });
  if(document.readyState!=="loading"){ var _os2=window.switchTab; window.switchTab=function(w){ if(_os2)_os2(w); if(w==="tc"){ S.cfg=null; S.view="mark"; route(); } }; }
})();
