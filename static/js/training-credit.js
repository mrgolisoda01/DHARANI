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
    var rows = items.length ? items.map(function(it){
      var stat = it.status==="approved" ? '<span class="pill" style="background:#eaf7f0;color:#0f6b45">Approved</span>'
        : '<span class="pill" style="background:#faf1de;color:#845a0b">Pending</span>';
      var actions = (d.is_admin && it.status==="pending")
        ? '<button class="btn ok" style="padding:5px 12px;font-size:12px" data-ap="'+it.id+'">Approve</button> '+
          '<button class="btn no" style="padding:5px 12px;font-size:12px" data-rj="'+it.id+'">Reject</button>'
        : (d.is_admin ? '<button class="btn sec" style="padding:5px 10px;font-size:12px;color:#d64545" data-del="'+it.id+'">Remove</button>' : stat);
      return '<div class="arow"><div><b>'+esc(it.trainer_name||it.trainer_id)+'</b> trained <b>'+esc(it.learner_name||it.learner_id)+'</b>'+
        '<br><span style="font-size:12px;color:#62707a">'+esc((it.kind||"").toUpperCase())+' · '+esc(it.module_title||"module")+'</span></div>'+
        '<div style="text-align:right;white-space:nowrap">'+actions+'</div></div>';
    }).join("") : '<div class="empty" style="padding:16px">'+(d.is_admin?"Nothing waiting for approval.":"You haven\'t marked any training yet.")+'</div>';
    // bulk bar — admin only, when there are pending items
    var pendingIds = items.filter(function(it){ return it.status==="pending"; }).map(function(it){ return it.id; });
    var bulkBar = "";
    if(d.is_admin && pendingIds.length){
      bulkBar = '<div style="display:flex;justify-content:flex-end;gap:8px;margin:0 0 10px">'+
        '<button class="btn ok" id="tcApproveAll" style="padding:5px 14px;font-size:12.5px">✓ Approve all ('+pendingIds.length+')</button>'+
        '<button class="btn no" id="tcRejectAll" style="padding:5px 14px;font-size:12.5px">Reject all</button></div>';
    }
    shell(bulkBar + rows);
    $("tcRoot").querySelectorAll("[data-ap]").forEach(function(b){ b.addEventListener("click", function(){ resolve(b.dataset.ap,"approve"); }); });
    $("tcRoot").querySelectorAll("[data-rj]").forEach(function(b){ b.addEventListener("click", function(){ resolve(b.dataset.rj,"reject"); }); });
    $("tcRoot").querySelectorAll("[data-del]").forEach(function(b){ b.addEventListener("click", function(){ if(confirm("Remove this record?")) delRec(b.dataset.del); }); });
    var aAll=$("tcApproveAll"); if(aAll) aAll.addEventListener("click", function(){ resolveAllTc(pendingIds,"approve"); });
    var rAll=$("tcRejectAll"); if(rAll) rAll.addEventListener("click", function(){ resolveAllTc(pendingIds,"reject"); });
  }
  async function resolveAllTc(ids, decision){
    if(!ids || !ids.length){ note("Nothing to "+decision+"."); return; }
    var verb = decision==="approve" ? "Approve" : "Reject";
    if(!confirm(verb+" all "+ids.length+" training record(s)?")) return;
    var ok=0, fail=0;
    for(var i=0;i<ids.length;i++){
      var r = await postJ("/api/training/resolve",{id:ids[i],decision:decision});
      if(r && r.ok) ok++; else fail++;
    }
    note(verb+"d "+ok+(fail?(" · "+fail+" failed"):"")+".");
    renderPending();
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
      var cards = '<div class="pcards">'+
        card(sm.confirmed!=null?sm.confirmed:0,"✅ Confirmed (both agree)","#1d9e75")+
        card(sm.conflict!=null?sm.conflict:0,"⚠️ Conflicts — need you",(sm.conflict?"#d64545":"#1d9e75"))+
        card(sm.awaiting_trainer!=null?sm.awaiting_trainer:0,"🕐 Awaiting trainer","#c9a227")+
        card(sm.awaiting_learner!=null?sm.awaiting_learner:0,"🕐 Awaiting learner","#62707a")+
      '</div>';

      var trainerOpts = (S.cfg.trainers||[]).map(function(t){ return '<option value="'+esc(t.emp_id)+'">'+esc(t.name)+'</option>'; }).join("");

      // conflicts
      var conf = d.conflicts || [];
      var confHtml = '<div class="card"><h4 style="margin:0 0 4px;font-size:14px;color:#b4231d">⚠️ Conflicts — learner & trainer record disagree ('+conf.length+')</h4>'+
        '<p style="font-size:12px;color:#62707a;margin:0 0 10px">Pick the correct trainer. That becomes the confirmed delivery and the learner\'s rating is aligned to match.</p>';
      if(!conf.length){ confHtml += '<div class="empty" style="padding:10px">No conflicts. 👍</div>'; }
      else {
        confHtml += conf.map(function(c){
          var key = esc(c.learner_id)+'|'+c.module_id;
          var sel = '<select data-csel="'+key+'" style="max-width:220px">'+
            '<option value="'+esc(c.learner_says_id)+'">'+esc(c.learner_says)+' (learner\'s pick)</option>'+
            (c.record_says_ids||[]).map(function(id,i){ return '<option value="'+esc(id)+'">'+esc((c.record_says||"").split(", ")[i]||id)+' (record)</option>'; }).join("")+
            trainerOpts+'</select>';
          return '<div class="arow" style="flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>'+esc(c.learner)+'</b> · '+esc(c.module)+
            '<br><span style="font-size:12px;color:#62707a">Learner says <b>'+esc(c.learner_says)+'</b> · Record says <b>'+esc(c.record_says)+'</b></span></div>'+
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+sel+
            '<button class="btn ok" style="padding:5px 12px;font-size:12px" data-cres="'+key+'" data-lid="'+esc(c.learner_id)+'" data-mid="'+c.module_id+'">Confirm</button>'+
            '<button class="btn sec" style="padding:5px 10px;font-size:12px" data-cdis="'+key+'" data-lid="'+esc(c.learner_id)+'" data-mid="'+c.module_id+'">Dismiss</button>'+
            '</div></div>';
        }).join("");
      }
      confHtml += '</div>';

      // awaiting trainer (learner claimed, no trainer record) — admin can confirm on the trainer's behalf
      var aw = d.awaiting_trainer_list || [];
      var awHtml = '<div class="card"><h4 style="margin:0 0 4px;font-size:14px;color:#845a0b">🕐 Awaiting trainer confirmation ('+aw.length+')</h4>'+
        '<p style="font-size:12px;color:#62707a;margin:0 0 10px">A learner marked who trained them, but that trainer hasn\'t logged it. Confirm to record it.</p>';
      if(!aw.length){ awHtml += '<div class="empty" style="padding:10px">Nothing waiting.</div>'; }
      else {
        awHtml += aw.map(function(a){
          var key = esc(a.learner_id)+'|'+a.module_id;
          return '<div class="arow"><div style="flex:1"><b>'+esc(a.learner)+'</b> · '+esc(a.module)+
            '<br><span style="font-size:12px;color:#62707a">Learner says trainer: <b>'+esc(a.learner_says)+'</b></span></div>'+
            '<button class="btn ok" style="padding:5px 12px;font-size:12px" data-aw="'+key+'" data-lid="'+esc(a.learner_id)+'" data-tid="'+esc(a.learner_says_id)+'" data-mid="'+a.module_id+'">Confirm</button></div>';
        }).join("");
      }
      awHtml += '</div>';

      shell(cards + confHtml + awHtml);

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
      $("tcRoot").querySelectorAll("[data-aw]").forEach(function(b){
        b.addEventListener("click", async function(){
          var r = await postJ("/api/training/confirm-claim",{learner_id:b.dataset.lid,trainer_id:b.dataset.tid,module_id:b.dataset.mid});
          if(r.ok){ note(r.msg||"Confirmed."); renderConfirmations(); } else note(r.msg||"Failed.");
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
    shell(html);
    $("tcRoot").querySelectorAll("[data-aw]").forEach(function(b){
      b.addEventListener("click", async function(){
        var r = await postJ("/api/training/confirm-claim",{learner_id:b.dataset.lid,trainer_id:b.dataset.tid,module_id:b.dataset.mid});
        if(r.ok){ note(r.msg||"Confirmed."); renderConfirmations(); } else note(r.msg||"Failed.");
      });
    });
  }

  // ---- Productivity ----
  async function renderProd(){
    shell('<div class="empty">Loading…</div>');
    var d=await getJ("/api/training/productivity");
    var t=(d&&d.ok)?d.trainers:[];
    var sm=(d&&d.summary)||{};
    var meId=d&&d.me_id;
    if(!t.length){ shell('<div class="empty" style="padding:16px">No approved training records yet. Mark some training first.</div>'); return; }

    // summary cards
    function card(v, l, col){ return '<div class="pcard"><div class="pv" style="color:'+(col||"#12284B")+'">'+v+'</div><div class="pl">'+l+'</div></div>'; }
    var cards = '<div class="pcards">'+
      card(sm.trainers!=null?sm.trainers:"—", "Active trainers")+
      card(sm.trained!=null?sm.trained:"—", "People trained")+
      card(sm.avg_score!=null?sm.avg_score+"%":"—", "Overall avg score", sm.avg_score!=null?(sm.avg_score>=70?"#1d9e75":"#c9a227"):"#12284B")+
      card(sm.first_rate!=null?sm.first_rate+"%":"—", "Overall 1st-try pass rate", sm.first_rate!=null?(sm.first_rate>=70?"#1d9e75":(sm.first_rate>=50?"#c9a227":"#d64545")):"#12284B")+
    '</div>';

    // bar chart: trainers by 1st-try rate
    var maxRate = Math.max.apply(null, t.map(function(x){return x.first_rate||0;})) || 100;
    var chart = '<div class="card"><h4 style="margin:0 0 12px;font-size:14px;color:#12284B">1st-try pass rate by trainer</h4>'+
      t.map(function(x){
        var r=x.first_rate||0, col=r>=70?"#1d9e75":(r>=50?"#c9a227":"#d64545");
        var mine = (x.trainer_id===meId);
        return '<div class="pbar'+(mine?" mine":"")+'"><span class="pn">'+esc(x.trainer)+(mine?' <span style="font-size:10px;color:#1F5FA9">(you)</span>':'')+'</span>'+
          '<span class="pt"><i style="width:'+Math.round((x.first_rate||0)*100/maxRate)+'%;background:'+col+'"></i></span>'+
          '<span class="pvv">'+(x.first_rate==null?"—":x.first_rate+"%")+'</span></div>';
      }).join("")+'</div>';

    // full table
    var rows=t.map(function(x){
      var fr = x.first_rate==null?"—":x.first_rate+"%";
      var frCol = x.first_rate==null?"#aaa":(x.first_rate>=70?"#1d9e75":(x.first_rate>=50?"#c9a227":"#d64545"));
      var avg = x.avg_score==null?"—":x.avg_score+"%";
      var tot = x.pass_events||0;
      function seg(n,col){ return tot&&n? '<span class="eff" style="flex:'+n+';background:'+col+'" title="'+n+'"></span>':''; }
      var bar = tot? '<div style="display:flex;gap:1px;align-items:center;width:140px;height:12px;border-radius:6px;overflow:hidden;background:#eef2f5">'+seg(x.first_try,"#1d9e75")+seg(x.second,"#c9a227")+seg(x.third_plus,"#d64545")+'</div>' : '<span style="color:#aaa">—</span>';
      var medal = x.rank===1?"🥇 ":x.rank===2?"🥈 ":x.rank===3?"🥉 ":"";
      var mine = (x.trainer_id===meId);
      return '<tr'+(mine?' style="background:#eef5fc"':'')+'>'+
        '<td style="white-space:nowrap">'+medal+'<b>'+esc(x.trainer)+'</b>'+(mine?' <span style="font-size:10px;color:#1F5FA9">(you)</span>':'')+'</td>'+
        '<td style="text-align:center;font-weight:700">'+x.learners+'</td>'+
        '<td style="text-align:center">'+x.ind+' / '+x.trn+'</td>'+
        '<td style="text-align:center;font-weight:700">'+avg+'</td>'+
        '<td style="text-align:center;font-weight:800;color:'+frCol+'">'+fr+'</td>'+
        '<td>'+bar+'</td>'+
        '<td style="font-size:11px;color:#62707a;white-space:nowrap">1st '+x.first_try+' · 2nd '+x.second+' · 3rd+ '+x.third_plus+'</td></tr>';
    }).join("");

    shell(
      cards + chart +
      '<div class="card" style="padding:0;overflow:hidden"><div style="overflow-x:auto;width:100%"><table style="width:100%">'+
      '<thead><tr><th>Trainer</th><th style="text-align:center">Trained</th><th style="text-align:center">Ind / Trn</th>'+
      '<th style="text-align:center">Avg score</th><th style="text-align:center">1st-try rate</th><th>Pass split</th><th>Breakdown</th></tr></thead>'+
      '<tbody>'+rows+'</tbody></table></div></div>'+
      '<div style="font-size:11.5px;color:#62707a;padding:4px 2px 20px">“1st-try pass rate” = of all assessments this trainer’s learners passed, how many on the first attempt. Higher = more effective training. Pass split bar: green 1st try · amber 2nd · red 3rd+.</div>'
    );
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
