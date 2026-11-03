/* ============================================================
   Mr. Golisoda LMS — "My OJT" tab for learners (read-only, Phase 1)
   The tab button only appears once the trainer has started the OJT.
   ============================================================ */
(function(){
  "use strict";
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function fmtD(iso){
    if(!iso) return "";
    return new Date(iso.slice(0,10) + "T00:00:00").toLocaleDateString("en-IN", { day:"2-digit", month:"short" });
  }

  var css = document.createElement("style");
  css.textContent = [
    "#myOjt .oc{background:#fff;border:1px solid var(--mg-line);border-radius:12px;padding:14px;margin-bottom:10px}",
    "#myOjt .od{border:1px solid var(--mg-line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff}",
    "#myOjt .od.today{border-color:var(--mg-blue);box-shadow:0 0 0 2px #cdeefc}",
    "#myOjt .od.off{background:#f7f9fa}",
    "#myOjt .k{padding:2px 8px;border-radius:7px;font-size:11px;font-weight:600;margin-left:4px}",
    "#myOjt .k-sunday{background:#eeedfe;color:#26215c}#myOjt .k-holiday{background:#faeeda;color:#854f0b}",
    "#myOjt .k-review{background:#e6f1fb;color:#0c447c}#myOjt .k-today{background:var(--mg-blue);color:#fff}",
    "#myOjt .t{display:flex;gap:8px;padding:4px 0;font-size:13px}",
    "#myOjt .m{color:var(--muted,#62707a);font-size:12px}",
    "#myOjt .bar{height:8px;background:#eef2f5;border-radius:6px;overflow:hidden;margin:8px 0 4px}",
    "#myOjt .bar i{display:block;height:100%;background:var(--mg-green)}"
  ].join("\n");
  document.head.appendChild(css);

  async function fetchMy(){
    try{ return await (await fetch("/api/ojt/my", { credentials:"same-origin" })).json(); }
    catch(e){ return { ok:false }; }
  }
  async function postJ(url, body){
    try{ return await (await fetch(url, { method:"POST", credentials:"same-origin",
      headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body) })).json(); }
    catch(e){ return { ok:false, msg:"Network problem — please try again." }; }
  }
  function note(msg){
    var n = document.createElement("div");
    n.textContent = msg;
    n.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#12284B;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,.2)";
    document.body.appendChild(n);
    setTimeout(function(){ n.remove(); }, 2200);
  }
  var S = {};   // holds the current enrollment for the change/click handlers

  function sv(x){ return (x!==null&&x!==undefined)?x+"%":"—"; }
  function scol(x){ return (x===null||x===undefined)?"#9aa6ae":(x>=70?"#0f6b45":(x>=50?"#8a6d00":"#9e2b2b")); }

  function render(d){
    var box = $("myOjt");
    if(!box) return;
    if(!d.ok){ box.innerHTML = '<div class="m" style="padding:20px">Could not load your OJT. Please try again.</div>'; return; }
    if(!d.enrolled){ box.innerHTML = '<div class="m" style="padding:20px">Your OJT starts after your audit session.</div>'; return; }
    var e = d.enrollment, tl = d.timeline, sc = d.score || {};
    S.enrollment = e;
    var pct = tl.total ? Math.round(tl.done * 100 / tl.total) : 0;
    var today = tl.days.find(function(x){ return x.is_today; });

    // ---- overall OJT score (read-only, same blend as the trainer sees) ----
    var wtk = (sc.w_tasks!==undefined?sc.w_tasks:60), wac = (sc.w_activity!==undefined?sc.w_activity:40);
    var oj = sc.ojt_score;
    var scoreBox = '<div class="oc" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:linear-gradient(135deg,#f7fbff,#f3f7fa)">'+
      '<div style="text-align:center;min-width:92px">'+
        '<div style="font-size:30px;font-weight:800;line-height:1;color:'+scol(oj)+'">'+((oj!==null&&oj!==undefined)?oj+"%":"—")+'</div>'+
        '<div style="font-size:11px;color:#62707a;margin-top:3px;font-weight:600;text-transform:uppercase;letter-spacing:.3px">Your OJT score</div>'+
      '</div>'+
      '<div style="flex:1;min-width:190px;font-size:12.5px;color:#43515b">'+
        '<div style="display:flex;justify-content:space-between;max-width:300px;padding:2px 0"><span>📋 Tasks <span class="m">(weight '+wtk+'%)</span></span><b style="color:'+scol(sc.task_avg)+'">'+sv(sc.task_avg)+'</b></div>'+
        '<div style="display:flex;justify-content:space-between;max-width:300px;padding:2px 0"><span>📝 Daily activity <span class="m">(weight '+wac+'%)</span></span><b style="color:'+scol(sc.activity_avg)+'">'+sv(sc.activity_avg)+'</b></div>'+
        '<div style="font-size:11px;color:#8a97a0;margin-top:4px">Your trainer records these. A part with no marks yet isn\'t counted against you.</div>'+
      '</div>'+
    '</div>';

    // ---- activity period summary (Today / Week / Month) — read-only ----
    var actSum = '<div class="oc">'+
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">'+
        '<b style="font-size:14px;color:#12284B">📈 Your activity summary</b>'+
        '<span style="margin-left:auto;display:inline-flex;border:1px solid var(--mg-line);border-radius:8px;overflow:hidden">'+
          ["today","week","month"].map(function(rg){ var lbl={today:"Today",week:"This week",month:"This month"}[rg];
            return '<button class="myojt-range" data-enr="'+e.id+'" data-range="'+rg+'" style="border:none;background:'+(rg==="week"?"var(--mg-blue);color:#fff":"#fff;color:#55636d")+';font-size:11.5px;padding:5px 11px;cursor:pointer">'+lbl+'</button>'; }).join("")+
        '</span>'+
      '</div>'+
      '<div id="myOjtActSum"><div class="m" style="font-size:12.5px">Loading…</div></div>'+
    '</div>';

    var head = '<div class="oc"><b style="font-size:16px">' + esc(e.day_label) + "</b>" +
      '<div class="m">' + esc(e.role) + " OJT · " + fmtD(e.start_date) + " → " + fmtD(tl.end_date) + " · Trainer: " + esc(e.trainer) + "</div>" +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="m">' + tl.done + " of " + tl.total + " tasks signed off by your trainer" +
      (tl.overdue ? " · <b style=\"color:var(--mg-red)\">" + tl.overdue + " due tasks not yet signed off</b>" : "") + "</div>" +
      '<div class="m" style="margin-top:6px;font-style:italic">This is a view of your progress — your trainer records everything here.</div></div>';

    var days = tl.days.map(function(day){
      var isWork = (day.kind === "work" || day.kind === "review");
      var badge = day.kind === "sunday" ? '<span class="k k-sunday">Week off (Sun)</span>'
        : day.kind === "weekoff" ? '<span class="k k-sunday">Week off</span>'
        : day.kind === "leave" ? '<span class="k k-holiday">Leave</span>'
        : day.kind === "review" ? '<span class="k k-review">Final review</span>' : "";
      if(day.is_today) badge += '<span class="k k-today">Today</span>';

      // ---- tasks: read-only, show trainer's confirmation + score ----
      var tasks = day.tasks.map(function(t){
        var trainerMark = t.done
          ? '<span style="color:#1d9e75;font-weight:600">✔ Trainer confirmed</span>'
          : '<span class="m">Awaiting trainer</span>';
        var scoreBadge = (t.score!==null&&t.score!==undefined)
          ? ' <span style="font-size:11px;font-weight:700;padding:1px 8px;border-radius:20px;'+(t.score>=70?"background:#eaf7f0;color:#0f6b45":"background:#fdeaea;color:#9e2b2b")+'">'+t.score+'%</span>' : '';
        return '<div class="t" style="flex-direction:column;align-items:flex-start;gap:3px">' +
          '<div><span>' + (t.done ? "✅" : "⬜") + "</span> <b>" + esc(t.title) + "</b>" + scoreBadge +
          (t.description ? '<br><span class="m">' + esc(t.description) + "</span>" : "") + "</div>" +
          '<div style="font-size:12px;padding-left:22px">' + trainerMark + "</div>" +
          (t.remark ? '<div class="m" style="padding-left:22px;font-size:12px">📝 '+esc(t.remark)+'</div>' : '') +
          "</div>";
      }).join("");

      // ---- daily activity the trainer logged (read-only) ----
      var actBlock = "";
      var acts = (day.activity || []).filter(function(a){ return (a.value!==null&&a.value!==undefined)||(a.done!==null&&a.done!==undefined)||(a.score!==null&&a.score!==undefined); });
      if(isWork && acts.length){
        actBlock = '<div style="margin-top:8px;padding:9px 11px;border:1px solid var(--mg-line);border-radius:8px;background:#fafcfe">'+
          '<div style="font-size:12px;font-weight:700;color:#0c6fb0;margin-bottom:4px">📝 Daily activity (by your trainer)</div>'+
          acts.map(function(a){
            var val = (a.kind==="number") ? ((a.value!==null&&a.value!==undefined)?a.value:"—")+(a.target?(" / "+a.target):"")
                                          : ((a.done===1)?"✓ done":"✗ not done");
            var sb = (a.score!==null&&a.score!==undefined)?' <b style="color:'+scol(a.score)+'">'+a.score+'%</b>':'';
            return '<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:2px 0"><span>'+esc(a.label)+'</span><span>'+val+sb+'</span></div>';
          }).join("")+
          '</div>';
      }

      // ---- trainer's day remark (read-only) ----
      var remarkBlock = "";
      if(isWork && day.day_remark && day.day_remark.trim()){
        remarkBlock = '<div style="margin-top:8px;font-size:12.5px;padding:8px 10px;background:#f7f9fa;border-radius:8px">'+
          '<b>Trainer remark:</b> '+esc(day.day_remark)+'</div>';
      }

      var dayLabel = (day.day !== null && day.day !== undefined) ? ("Day " + day.day) : "—";
      return '<div class="od' + (day.is_today ? " today" : "") + (isWork ? "" : " off") + '"' +
        (day.is_today ? ' id="myOjtToday"' : "") + ">" +
        "<b>" + dayLabel + '</b> <span class="m">· ' + day.weekday + ", " + fmtD(day.date) + "</span>" + badge +
        (isWork ? ((tasks || '<div class="m">No tasks for this day.</div>') + actBlock + remarkBlock) : "") + "</div>";
    }).join("");
    box.innerHTML = scoreBox + actSum + head + days;
    setTimeout(function(){ loadMyActSummary(e.id, "week"); }, 30);
    if(today){ var t = $("myOjtToday"); if(t) setTimeout(function(){ t.scrollIntoView({ block:"center" }); }, 50); }
  }

  // read-only period summary (Today / Week / Month) for the trainee
  async function loadMyActSummary(enrId, range){
    var box = $("myOjtActSum");
    if(!box) return;
    box.innerHTML = '<div class="m" style="font-size:12.5px">Loading…</div>';
    var d;
    try{ d = await (await fetch("/api/ojt/activity-summary?enrollment=" + enrId + "&range=" + encodeURIComponent(range), { credentials:"same-origin" })).json(); }
    catch(err){ d = { ok:false }; }
    if(!d || !d.ok){ box.innerHTML = '<div class="m" style="font-size:12.5px">Could not load.</div>'; return; }
    var items = d.items || [];
    if(!items.length){ box.innerHTML = '<div class="m" style="font-size:12.5px">No activity set up for your role yet.</div>'; }
    else {
      var lbl = {today:"today",week:"this week",month:"this month"}[d.range] || "this period";
      var ps = (d.period_score!==null&&d.period_score!==undefined)
        ? '<b style="color:'+scol(d.period_score)+'">'+d.period_score+'%</b>' : '—';
      var rows = items.map(function(it){
        var val = (it.kind==="number")
          ? '<b>'+it.total+'</b>'+(it.target?(' <span class="m" style="font-size:11px">(target '+it.target+'/day)</span>'):'')
          : '<b>'+it.done_days+'</b> <span class="m" style="font-size:11px">day'+(it.done_days===1?'':'s')+' done</span>';
        return '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;border-bottom:1px solid #f3f4f5;font-size:12.5px"><span>'+esc(it.label)+'</span><span>'+val+'</span></div>';
      }).join("");
      box.innerHTML = '<div class="m" style="font-size:12px;margin-bottom:6px">Totals for <b>'+lbl+'</b> · '+(d.days_logged||0)+' day'+((d.days_logged===1)?'':'s')+' logged · activity score '+ps+'</div>'+rows;
    }
    // reflect active range button
    Array.prototype.forEach.call(document.querySelectorAll('.myojt-range[data-enr="'+enrId+'"]'), function(b){
      var on = b.dataset.range === d.range;
      b.style.background = on ? "var(--mg-blue)" : "#fff";
      b.style.color = on ? "#fff" : "#55636d";
    });
  }

  // (The trainee's OJT view is fully READ-ONLY — no self-mark, no note editing.
  //  Everything shown here is recorded by the trainer; the learner only views
  //  their progress and score. The old self-mark / save-note handlers are
  //  intentionally removed.)

  // the only interactive bit: the activity-summary period buttons (read-only data)
  document.addEventListener("click", function(e){
    var b = e.target.closest ? e.target.closest(".myojt-range") : null;
    if(!b) return;
    loadMyActSummary(b.dataset.enr, b.dataset.range);
  });

  // show the tab button only if an OJT exists
  document.addEventListener("DOMContentLoaded", async function(){
    var btn = document.querySelector('.pt-tab[data-tab="ojt"]');
    if(!btn) return;
    var d = await fetchMy();
    if(d.ok && d.enrolled) btn.style.display = "";
  });

  var _orig = window.showTab;
  window.showTab = async function(name){
    _orig(name);
    if(name === "ojt"){
      $("myOjt").innerHTML = '<div class="m" style="padding:20px">Loading…</div>';
      render(await fetchMy());
    }
  };
})();
