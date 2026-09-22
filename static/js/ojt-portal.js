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

  function render(d){
    var box = $("myOjt");
    if(!box) return;
    if(!d.ok){ box.innerHTML = '<div class="m" style="padding:20px">Could not load your OJT. Please try again.</div>'; return; }
    if(!d.enrolled){ box.innerHTML = '<div class="m" style="padding:20px">Your OJT starts after your audit session.</div>'; return; }
    var e = d.enrollment, tl = d.timeline;
    var pct = tl.total ? Math.round(tl.done * 100 / tl.total) : 0;
    var today = tl.days.find(function(x){ return x.is_today; });
    var head = '<div class="oc"><b style="font-size:16px">' + esc(e.day_label) + "</b>" +
      '<div class="m">' + esc(e.role) + " OJT · " + fmtD(e.start_date) + " → " + fmtD(tl.end_date) + " · Trainer: " + esc(e.trainer) + "</div>" +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="m">' + tl.done + " of " + tl.total + " tasks signed off by your trainer" +
      (tl.overdue ? " · <b style=\"color:var(--mg-red)\">" + tl.overdue + " due tasks not yet signed off</b>" : "") + "</div></div>";

    var days = tl.days.map(function(day){
      var badge = day.kind === "sunday" ? '<span class="k k-sunday">Week off</span>'
        : day.kind === "holiday" ? '<span class="k k-holiday">Holiday</span>'
        : day.kind === "review" ? '<span class="k k-review">Final review</span>' : "";
      if(day.is_today) badge += '<span class="k k-today">Today</span>';
      var tasks = day.tasks.map(function(t){
        return '<div class="t"><span>' + (t.done ? "✅" : "⬜") + "</span><span><b>" + esc(t.title) + "</b>" +
          (t.description ? '<br><span class="m">' + esc(t.description) + "</span>" : "") + "</span></div>";
      }).join("");
      return '<div class="od' + (day.is_today ? " today" : "") + (day.kind === "sunday" || day.kind === "holiday" ? " off" : "") + '"' +
        (day.is_today ? ' id="myOjtToday"' : "") + ">" +
        "<b>Day " + day.day + '</b> <span class="m">· ' + day.weekday + ", " + fmtD(day.date) + "</span>" + badge +
        (tasks || (day.kind === "sunday" ? "" : '<div class="m">No tasks for this day.</div>')) + "</div>";
    }).join("");
    box.innerHTML = head + days;
    if(today){ var t = $("myOjtToday"); if(t) setTimeout(function(){ t.scrollIntoView({ block:"center" }); }, 50); }
  }

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
