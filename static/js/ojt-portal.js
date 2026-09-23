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

  function render(d){
    var box = $("myOjt");
    if(!box) return;
    if(!d.ok){ box.innerHTML = '<div class="m" style="padding:20px">Could not load your OJT. Please try again.</div>'; return; }
    if(!d.enrolled){ box.innerHTML = '<div class="m" style="padding:20px">Your OJT starts after your audit session.</div>'; return; }
    var e = d.enrollment, tl = d.timeline;
    S.enrollment = e;
    var pct = tl.total ? Math.round(tl.done * 100 / tl.total) : 0;
    var today = tl.days.find(function(x){ return x.is_today; });
    var head = '<div class="oc"><b style="font-size:16px">' + esc(e.day_label) + "</b>" +
      '<div class="m">' + esc(e.role) + " OJT · " + fmtD(e.start_date) + " → " + fmtD(tl.end_date) + " · Trainer: " + esc(e.trainer) + "</div>" +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="m">' + tl.done + " of " + tl.total + " tasks signed off by your trainer" +
      (tl.overdue ? " · <b style=\"color:var(--mg-red)\">" + tl.overdue + " due tasks not yet signed off</b>" : "") + "</div></div>";

    var active = (S.enrollment && S.enrollment.status === "active");
    var days = tl.days.map(function(day){
      var isWork = (day.kind === "work" || day.kind === "review");
      var badge = day.kind === "sunday" ? '<span class="k k-sunday">Week off (Sun)</span>'
        : day.kind === "weekoff" ? '<span class="k k-sunday">Week off</span>'
        : day.kind === "leave" ? '<span class="k k-holiday">Leave</span>'
        : day.kind === "review" ? '<span class="k k-review">Final review</span>' : "";
      if(day.is_today) badge += '<span class="k k-today">Today</span>';
      var tasks = day.tasks.map(function(t){
        // trainer's official confirmation
        var trainerMark = t.done
          ? '<span class="ojt-conf" style="color:#1d9e75;font-weight:600">✔ Trainer confirmed</span>'
          : '<span class="ojt-conf m">Awaiting trainer</span>';
        // trainee's own self-mark checkbox (their claim)
        var selfBox = '<label class="ojt-self"><input type="checkbox" data-act="selfmark" data-task="' + t.id + '"' +
          (t.self_done ? " checked" : "") + (active ? "" : " disabled") + "> I've done this</label>";
        return '<div class="t" style="flex-direction:column;align-items:flex-start;gap:4px">' +
          '<div><span>' + (t.done ? "✅" : (t.self_done ? "🟡" : "⬜")) + "</span> <b>" + esc(t.title) + "</b>" +
          (t.description ? '<br><span class="m">' + esc(t.description) + "</span>" : "") + "</div>" +
          '<div style="display:flex;gap:14px;align-items:center;font-size:12px;padding-left:22px">' + selfBox + trainerMark + "</div>" +
          "</div>";
      }).join("");
      // daily notes (problems faced / work done) — editable by trainee
      var notes = "";
      if(isWork){
        notes = '<div class="ojt-notes" style="margin-top:8px;padding:10px;border:1px dashed var(--mg-line);border-radius:8px">' +
          '<div style="font-size:12px;font-weight:600;margin-bottom:5px">Daily update</div>' +
          '<textarea data-note="work" data-day="' + day.day + '" placeholder="What did you do today?" ' +
            (active ? "" : "disabled") + ' style="width:100%;min-height:46px;font-size:13px;padding:7px;border:1px solid var(--mg-line);border-radius:6px;margin-bottom:6px;font-family:inherit">' + esc(day.work_done || "") + '</textarea>' +
          '<textarea data-note="problems" data-day="' + day.day + '" placeholder="Any problems you faced today?" ' +
            (active ? "" : "disabled") + ' style="width:100%;min-height:46px;font-size:13px;padding:7px;border:1px solid var(--mg-line);border-radius:6px;font-family:inherit">' + esc(day.problems || "") + '</textarea>' +
          (active ? '<div style="text-align:right;margin-top:6px"><button class="ojt-savebtn" data-act="savenote" data-day="' + day.day + '" style="background:var(--mg-blue);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer">Save update</button></div>' : "") +
          "</div>";
      }
      var dayLabel = (day.day !== null && day.day !== undefined) ? ("Day " + day.day) : "—";
      return '<div class="od' + (day.is_today ? " today" : "") + (isWork ? "" : " off") + '"' +
        (day.is_today ? ' id="myOjtToday"' : "") + ">" +
        "<b>" + dayLabel + '</b> <span class="m">· ' + day.weekday + ", " + fmtD(day.date) + "</span>" + badge +
        (isWork ? ((tasks || '<div class="m">No tasks for this day.</div>') + notes) : "") + "</div>";
    }).join("");
    box.innerHTML = head + days;
    if(today){ var t = $("myOjtToday"); if(t) setTimeout(function(){ t.scrollIntoView({ block:"center" }); }, 50); }
  }

  // handle trainee self-mark + save-note clicks/changes
  document.addEventListener("change", async function(e){
    var el = e.target.closest('[data-act="selfmark"]');
    if(!el) return;
    var r = await postJ("/api/ojt/my-selfmark", { task_id: el.dataset.task, on: el.checked });
    if(!r.ok){ note(r.msg || "Could not save."); el.checked = !el.checked; }
    else { render(await fetchMy()); }
  });
  document.addEventListener("click", async function(e){
    var el = e.target.closest('[data-act="savenote"]');
    if(!el) return;
    var day = el.dataset.day;
    var work = document.querySelector('textarea[data-note="work"][data-day="' + day + '"]');
    var prob = document.querySelector('textarea[data-note="problems"][data-day="' + day + '"]');
    var r = await postJ("/api/ojt/my-daynote", { day_no: day,
      work_done: work ? work.value : "", problems: prob ? prob.value : "" });
    note(r.ok ? "Update saved." : (r.msg || "Could not save."));
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
