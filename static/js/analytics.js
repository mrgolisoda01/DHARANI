/* ============================================================
   analytics.js — Admin "Learning Analytics" tab (Phase A)
   ------------------------------------------------------------
   Three sub-views, all read-only, built from existing data:
     • Employee  — one person's full learning journey
     • Activity  — what happened today / this week / this month
     • Trainers  — per-trainer roll-up (KPI foundation)
   Helper names are suffixed "An" to avoid clashing with admin.js.
   ============================================================ */
(function () {
  "use strict";

  var $an = function (id) { return document.getElementById(id); };
  var escAn = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  function getJAn(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) { return r.json(); });
  }

  var AN = { view: "overview", people: [], curEmp: null };

  // ---- styles (scoped to #anRoot) ----
  function css() {
    return "<style>" + [
      "#anRoot .an-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 18px}",
      "#anRoot .an-card{background:#fff;border:1px solid var(--mg-line);border-radius:12px;padding:16px;text-align:center}",
      "#anRoot .an-card .n{font-size:28px;font-weight:800;margin:2px 0;color:var(--mg-blue)}",
      "#anRoot .an-card .l{font-size:12px;color:var(--mg-muted)}",
      "#anRoot .an-sub{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 16px}",
      "#anRoot .an-pill{border:1px solid var(--mg-line);background:#fff;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;color:#44515b}",
      "#anRoot .an-pill.on{background:var(--mg-blue);color:#fff;border-color:var(--mg-blue)}",
      "#anRoot .an-sect{background:#fff;border:1px solid var(--mg-line);border-radius:12px;padding:16px;margin-bottom:14px}",
      "#anRoot .an-sect h4{margin:0 0 10px;font-size:14px;color:var(--mg-ink)}",
      "#anRoot table{width:100%;border-collapse:collapse;font-size:13px}",
      "#anRoot th,#anRoot td{padding:8px 10px;border-top:1px solid var(--mg-line);text-align:left;vertical-align:middle}",
      "#anRoot thead th{border-top:none;font-size:11.5px;text-transform:uppercase;letter-spacing:.02em;color:#64707a;background:#f7fafc}",
      "#anRoot tbody tr:hover{background:#f3f8fd}",
      "#anRoot .bar{height:8px;background:#eef2f5;border-radius:5px;overflow:hidden;min-width:90px;display:inline-block;vertical-align:middle}",
      "#anRoot .bar>i{display:block;height:100%;background:var(--mg-blue);border-radius:5px}",
      "#anRoot .tag{display:inline-block;border-radius:9px;padding:1px 8px;font-size:11px;font-weight:600}",
      "#anRoot .t-pass{background:#e1f5ee;color:#0a7d4f}",
      "#anRoot .t-fail{background:#fdecea;color:#b4231d}",
      "#anRoot .t-done{background:#e1f5ee;color:#0a7d4f}",
      "#anRoot .t-no{background:#eef1f4;color:#7a8690}",
      "#anRoot .an-input{padding:8px 10px;border:1px solid var(--mg-line);border-radius:8px;font-size:13px;min-width:240px;font-family:inherit}",
      "#anRoot .an-empty{padding:22px;text-align:center;color:var(--mg-muted);font-size:13px}",
      "#anRoot .an-muted{color:var(--mg-muted);font-size:12px}",
      "@media(max-width:820px){#anRoot .an-grid2{grid-template-columns:1fr !important}}"
    ].join("") + "</style>";
  }

  function shell() {
    return css() +
      '<div class="an-sub">' +
        '<button class="an-pill" id="anTabOv" onclick="window.__anView(\'overview\')">📊 Overview</button>' +
        '<button class="an-pill" id="anTabEmp" onclick="window.__anView(\'employee\')">👤 Employee</button>' +
        '<button class="an-pill" id="anTabAct" onclick="window.__anView(\'activity\')">🕒 Activity</button>' +
        '<button class="an-pill" id="anTabTr" onclick="window.__anView(\'trainers\')">🧑‍🏫 ' +
          (window.IS_ADMIN ? 'Trainers' : 'My Performance') + '</button>' +
        '<button class="an-pill" id="anTabFb" onclick="window.__anView(\'feedback\')">💬 Feedback</button>' +
        (window.IS_ADMIN ? '<button class="an-pill" id="anTabRep" onclick="window.__anView(\'reports\')">📄 Reports</button>' : '') +
      '</div>' +
      '<div id="anViewBox"></div>';
  }

  function setActivePill() {
    ["Ov", "Emp", "Act", "Tr", "Fb", "Rep"].forEach(function (s) {
      var b = $an("anTab" + s);
      if (b) b.classList.remove("on");
    });
    var map = { overview: "Ov", employee: "Emp", activity: "Act", trainers: "Tr", feedback: "Fb", reports: "Rep" };
    var b = $an("anTab" + map[AN.view]);
    if (b) b.classList.add("on");
  }

  window.__anView = function (v) { AN.view = v; renderView(); };

  function renderView() {
    setActivePill();
    // clear any Chart.js instances from the previous view before switching
    try { destroyCharts(); } catch (e) {}
    if (AN.view === "overview") return renderOverview();
    if (AN.view === "employee") return renderEmployee();
    if (AN.view === "activity") return renderActivity();
    if (AN.view === "trainers") return renderTrainers();
    if (AN.view === "feedback") return renderFeedback();
    if (AN.view === "reports") return renderReports();
  }

  // ===================== OVERVIEW (dashboard) =====================
  var AN_CHARTS = {};
  function destroyCharts() {
    Object.keys(AN_CHARTS).forEach(function (k) {
      try { AN_CHARTS[k].destroy(); } catch (e) {}
    });
    AN_CHARTS = {};
  }

  function renderOverview() {
    var box = $an("anViewBox");
    box.innerHTML = '<div id="anOvBody"><div class="an-empty">Loading dashboard…</div></div>';
    getJAn("/api/analytics/overview").then(function (d) {
      var body = $an("anOvBody");
      if (!d || !d.ok) { body.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      var o = d.overview || {}, p = d.pulse || {}, f = d.funnel || {};
      destroyCharts();

      var kpi = function (n, l, color, suffix) {
        return '<div class="an-card"><div class="n" style="color:' + (color || "var(--mg-blue)") + '">' +
          n + (suffix || "") + '</div><div class="l">' + l + '</div></div>';
      };

      var html = "";
      // KPI row
      html += '<div class="an-cards">' +
        kpi(o.total_staff || 0, "Total learners", "#1f5fa9") +
        kpi(o.active_week || 0, "Active this week", "#0a7d4f") +
        kpi(o.induction_rate || 0, "Induction complete", "#1f5fa9", "%") +
        kpi(o.training_rate || 0, "Training complete", "#0a7d4f", "%") +
        kpi(o.avg_score || 0, "Avg assessment score", "#534ab7", "%") +
        kpi(o.total_certs || 0, "Certificates issued", "#8a5a00") +
        '</div>';

      // Onboarding pulse (today)
      html += '<div class="an-sect"><h4>📅 Onboarding pulse — today</h4>' +
        '<div class="an-cards" style="margin:0">' +
        kpi(p.enrolled_today || 0, "Enrolled today", "#1f5fa9") +
        kpi(p.logged_in_today || 0, "Logged in today", "#0a7d4f") +
        kpi(p.logged_in || 0, "Ever logged in", "#534ab7") +
        kpi(p.never_logged || 0, "Never logged in", "#b4231d") +
        '</div></div>';

      // Funnel + Trend side by side
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="an-grid2">' +
        '<div class="an-sect"><h4>🪜 Completion funnel</h4><canvas id="anFunnel" height="200"></canvas></div>' +
        '<div class="an-sect"><h4>📈 Activity — last 30 days</h4><canvas id="anTrend" height="200"></canvas></div>' +
        '</div>';

      // Needs attention
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="an-grid2">';
      html += '<div class="an-sect"><h4>⚠ Inactive 7+ days (' + (d.attention || []).length + ')</h4>';
      if ((d.attention || []).length) {
        html += '<table><tbody>' + d.attention.map(function (a) {
          return '<tr><td>' + escAn(a.name) + '</td><td class="an-muted">' + escAn(a.reason) + '</td></tr>';
        }).join("") + '</tbody></table>';
      } else { html += '<div class="an-empty">Everyone active 🎉</div>'; }
      html += '</div>';
      html += '<div class="an-sect"><h4>🔁 Repeat failers (' + (d.repeat_failers || []).length + ')</h4>';
      if ((d.repeat_failers || []).length) {
        html += '<table><thead><tr><th>Learner</th><th>Assessment</th><th>Fails</th></tr></thead><tbody>' +
          d.repeat_failers.map(function (r) {
            return '<tr><td>' + escAn(r.name) + '</td><td>' + escAn(r.assessment) + '</td>' +
              '<td><span class="tag t-fail">' + r.fails + '</span></td></tr>';
          }).join("") + '</tbody></table>';
      } else { html += '<div class="an-empty">No repeat failers 🎉</div>'; }
      html += '</div></div>';

      body.innerHTML = html;

      // draw charts (if Chart.js loaded)
      if (typeof Chart !== "undefined") {
        try {
          var fc = $an("anFunnel");
          if (fc) AN_CHARTS.funnel = new Chart(fc, {
            type: "bar",
            data: {
              labels: ["Enrolled", "Induction", "Training", "Certified"],
              datasets: [{
                data: [f.enrolled || 0, f.induction || 0, f.training || 0, f.certified || 0],
                backgroundColor: ["#9db8d6", "#1f5fa9", "#0a7d4f", "#8a5a00"]
              }]
            },
            options: { indexAxis: "y", plugins: { legend: { display: false } },
              scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
          });
          var tc = $an("anTrend");
          if (tc && d.trend) AN_CHARTS.trend = new Chart(tc, {
            type: "line",
            data: {
              labels: d.trend.map(function (x) { return x.date; }),
              datasets: [
                { label: "Completions", data: d.trend.map(function (x) { return x.completions; }),
                  borderColor: "#1f5fa9", backgroundColor: "rgba(31,95,169,.1)", tension: .3, fill: true },
                { label: "Assessments", data: d.trend.map(function (x) { return x.assessments; }),
                  borderColor: "#0a7d4f", backgroundColor: "rgba(10,125,79,.08)", tension: .3, fill: true }
              ]
            },
            options: { plugins: { legend: { position: "bottom" } },
              scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
          });
        } catch (e) {}
      }
    });
  }

  // ===================== EMPLOYEE =====================
  function renderEmployee() {
    var box = $an("anViewBox");
    var opts = '<option value="">— Select an employee —</option>' +
      AN.people.map(function (p) {
        return '<option value="' + escAn(p.emp_id) + '"' + (p.emp_id === AN.curEmp ? " selected" : "") + '>' +
          escAn(p.name) + " · " + escAn(p.designation || "") + "</option>";
      }).join("");
    box.innerHTML =
      '<div class="an-sect"><h4>Pick an employee to see their full learning journey</h4>' +
      '<select class="an-input" id="anEmpPick" onchange="window.__anPick(this.value)">' + opts + '</select></div>' +
      '<div id="anEmpBody"></div>';
    if (AN.curEmp) loadEmployee(AN.curEmp);
  }

  window.__anPick = function (emp) {
    AN.curEmp = emp || null;
    if (!emp) { $an("anEmpBody").innerHTML = ""; return; }
    loadEmployee(emp);
  };

  function pctBar(pct) {
    pct = pct || 0;
    return '<span class="bar" style="width:120px"><i style="width:' + pct + '%"></i></span> ' +
      '<span class="an-muted">' + pct + '%</span>';
  }

  function loadEmployee(emp) {
    var body = $an("anEmpBody");
    body.innerHTML = '<div class="an-empty">Loading…</div>';
    getJAn("/api/analytics/employee?emp_id=" + encodeURIComponent(emp)).then(function (d) {
      if (!d || !d.ok) { body.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      var e = d.employee, html = "";

      // header
      html += '<div class="an-sect"><h4>' + escAn(e.name) + ' · ' + escAn(e.designation || "") + '</h4>' +
        '<div class="an-muted">' + escAn(e.emp_id) +
        ' &nbsp;·&nbsp; ' + (e.activated ? '<span class="tag t-pass">Activated</span>' : '<span class="tag t-no">Not activated</span>') +
        (e.last_login ? ' &nbsp;·&nbsp; Last login: ' + escAn(e.last_login) : "") + '</div></div>';

      // induction + training progress
      html += '<div class="an-sect"><h4>Induction &nbsp; ' +
        '<span class="an-muted">' + d.induction.done + ' / ' + d.induction.total + '</span></h4>' +
        pctBar(d.induction.pct) + moduleTable(d.induction.items) + '</div>';

      if (d.training.total > 0) {
        html += '<div class="an-sect"><h4>Training modules &nbsp; ' +
          '<span class="an-muted">' + d.training.done + ' / ' + d.training.total + '</span></h4>' +
          pctBar(d.training.pct) + moduleTable(d.training.items) + '</div>';
      }

      // assessments
      html += '<div class="an-sect"><h4>Assessments</h4>';
      if (d.assessments.length) {
        html += '<table><thead><tr><th>Assessment</th><th>Best</th><th>Result</th><th>Attempts</th><th>Last taken</th></tr></thead><tbody>';
        d.assessments.forEach(function (a) {
          html += '<tr><td>' + escAn(a.title) + '</td>' +
            '<td>' + (a.best == null ? "—" : a.best + "%") + '</td>' +
            '<td>' + (a.passed ? '<span class="tag t-pass">Passed</span>' : '<span class="tag t-fail">Not passed</span>') +
            ' <span class="an-muted">(need ' + a.pass_percent + '%)</span></td>' +
            '<td>' + a.attempts + '</td><td>' + escAn(a.last_taken || "") + '</td></tr>';
        });
        html += '</tbody></table>';
      } else { html += '<div class="an-empty">No assessment attempts yet.</div>'; }
      html += '</div>';

      // certificates
      html += '<div class="an-sect"><h4>Certificates</h4>';
      if (d.certificates.length) {
        html += '<table><thead><tr><th>Certificate</th><th>Issued</th></tr></thead><tbody>';
        d.certificates.forEach(function (c) {
          html += '<tr><td>' + escAn(c.name) + '</td><td>' + escAn(c.issued_on || "") + '</td></tr>';
        });
        html += '</tbody></table>';
      } else { html += '<div class="an-empty">No certificates yet.</div>'; }
      html += '</div>';

      // OJT
      if (d.ojt) {
        html += '<div class="an-sect"><h4>OJT &nbsp; <span class="an-muted">' + escAn(d.ojt.role) +
          ' · ' + escAn(d.ojt.status) + '</span></h4>' +
          pctBar(d.ojt.pct) + ' <span class="an-muted">' + d.ojt.done + ' / ' + d.ojt.total + ' tasks</span></div>';
      }

      body.innerHTML = html;
    });
  }

  function moduleTable(items) {
    if (!items || !items.length) return '<div class="an-empty">No modules for this role.</div>';
    var h = '<table style="margin-top:10px"><thead><tr><th>Module</th><th>Status</th><th>On</th><th>Trainer</th></tr></thead><tbody>';
    items.forEach(function (m) {
      h += '<tr><td>' + escAn(m.title) + '</td>' +
        '<td>' + (m.completed ? '<span class="tag t-done">✓ Done</span>' : '<span class="tag t-no">Pending</span>') + '</td>' +
        '<td>' + escAn(m.completed_on || "") + '</td>' +
        '<td>' + (m.trainers && m.trainers.length ? escAn(m.trainers.join(", ")) : '<span class="an-muted">—</span>') + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  // ===================== ACTIVITY =====================
  function renderActivity() {
    var box = $an("anViewBox");
    box.innerHTML =
      '<div class="an-sub">' +
        '<button class="an-pill on" id="anR_today" onclick="window.__anRange(\'today\')">Today</button>' +
        '<button class="an-pill" id="anR_week" onclick="window.__anRange(\'week\')">This week</button>' +
        '<button class="an-pill" id="anR_month" onclick="window.__anRange(\'month\')">This month</button>' +
      '</div><div id="anActBody"><div class="an-empty">Loading…</div></div>';
    loadActivity("today");
  }

  window.__anRange = function (r) {
    ["today", "week", "month"].forEach(function (x) {
      var b = $an("anR_" + x); if (b) b.classList.toggle("on", x === r);
    });
    loadActivity(r);
  };

  // group definitions: key -> {label, icon, color}
  var ACT_GROUPS = [
    { key: "induction",  label: "Induction completed",  icon: "📘", color: "#1f5fa9" },
    { key: "training",   label: "Training completed",   icon: "🎓", color: "#0a7d4f" },
    { key: "assessment", label: "Assessments taken",    icon: "📝", color: "#8a5a00" },
    { key: "video",      label: "Videos watched",       icon: "🎥", color: "#6b46c1" },
    { key: "cert",       label: "Certificates issued",  icon: "📜", color: "#b4231d" },
    { key: "ojt_call",   label: "OJT calls",            icon: "📞", color: "#0c7b93" }
  ];

  function totalsBar(t) {
    t = t || {};
    var card = function (n, l, color) {
      return '<div class="an-card" style="padding:12px">' +
        '<div class="n" style="color:' + color + ';font-size:24px">' + (n || 0) + '</div>' +
        '<div class="l">' + l + '</div></div>';
    };
    return '<div class="an-cards" style="margin-bottom:14px">' +
      card(t.induction, "Induction done", "#1f5fa9") +
      card(t.training, "Training done", "#0a7d4f") +
      card(t.assess_pass, "Assessments passed", "#0a7d4f") +
      card(t.assess_fail, "Assessments failed", "#b4231d") +
      card(t.videos, "Videos watched", "#6b46c1") +
      card(t.certs, "Certificates", "#8a5a00") +
      card(t.ojt_calls, "OJT calls", "#0c7b93") +
      '</div>';
  }

  // one collapsible section for a group of events
  function groupSection(g, evs) {
    if (!evs.length) return "";
    var id = "actg_" + g.key;
    var rows = evs.map(function (ev) {
      var resClass = "";
      if (ev.type === "assessment") resClass = ev.passed ? "t-pass" : "t-fail";
      var resHtml = resClass ? '<span class="tag ' + resClass + '">' + escAn(ev.result) + '</span>' : escAn(ev.result);
      return '<tr><td style="white-space:nowrap">' + escAn(ev.when) + '</td>' +
        '<td>' + escAn(ev.name) + '</td>' +
        '<td>' + escAn(ev.detail) + '</td>' +
        '<td>' + resHtml + '</td></tr>';
    }).join("");
    return '<div class="an-sect" style="padding:0;overflow:hidden">' +
      '<div onclick="window.__anToggle(\'' + id + '\')" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-left:4px solid ' + g.color + '">' +
        '<h4 style="margin:0">' + g.icon + ' ' + g.label + ' <span class="an-muted" style="font-weight:400">(' + evs.length + ')</span></h4>' +
        '<span class="an-muted" id="' + id + '_arw">▾</span>' +
      '</div>' +
      '<div id="' + id + '" style="padding:0 16px 12px">' +
        '<table><thead><tr><th>Date</th><th>Employee</th><th>Detail</th><th>Result</th></tr></thead><tbody>' +
        rows + '</tbody></table></div></div>';
  }

  window.__anToggle = function (id) {
    var el = $an(id), arw = $an(id + "_arw");
    if (!el) return;
    var hidden = el.style.display === "none";
    el.style.display = hidden ? "" : "none";
    if (arw) arw.textContent = hidden ? "▾" : "▸";
  };

  function loadActivity(range) {
    var body = $an("anActBody");
    body.innerHTML = '<div class="an-empty">Loading…</div>';
    getJAn("/api/analytics/activity?range=" + range).then(function (d) {
      if (!d || !d.ok) { body.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      var html = totalsBar(d.totals);
      if (!d.events || !d.events.length) {
        body.innerHTML = html + '<div class="an-empty">No activity in this period.</div>';
        return;
      }
      // bucket events by group key
      var buckets = {};
      d.events.forEach(function (ev) {
        (buckets[ev.type] = buckets[ev.type] || []).push(ev);
      });
      ACT_GROUPS.forEach(function (g) {
        html += groupSection(g, buckets[g.key] || []);
      });
      body.innerHTML = html;
    });
  }

  // ===================== TRAINERS =====================
  function kpiColor(s) {
    if (s >= 80) return "#0a7d4f";
    if (s >= 60) return "#8a5a00";
    return "#b4231d";
  }
  function starTxt(v, n) {
    if (v == null) return '<span class="an-muted">—</span>';
    return '<b>' + v + '</b>★' + (n ? ' <span class="an-muted">(' + n + ')</span>' : '');
  }

  function renderTrainers() {
    // Trainers (instructors) see ONLY their own performance; admin sees all.
    if (!window.IS_ADMIN) return renderMyPerformance();

    var box = $an("anViewBox");
    box.innerHTML = '<div id="anTrBody"><div class="an-empty">Loading…</div></div>';
    getJAn("/api/analytics/trainers").then(function (d) {
      var body = $an("anTrBody");
      if (!d || !d.ok) { body.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      if (!d.trainers.length) { body.innerHTML = '<div class="an-empty">No trainer deliveries recorded yet.</div>'; return; }
      var w = d.kpi_weights || {};

      // leaderboard (top 3 as medal cards)
      var medal = ["🥇", "🥈", "🥉"];
      var top = d.trainers.slice(0, 3);
      var lead = '<div class="an-cards" style="margin-bottom:14px">';
      top.forEach(function (t, i) {
        lead += '<div class="an-card" style="cursor:pointer" onclick="window.__anTrainer(\'' + escAn(t.trainer_id) + '\')">' +
          '<div style="font-size:22px">' + (medal[i] || "") + '</div>' +
          '<div class="n" style="color:' + kpiColor(t.kpi_score) + '">' + t.kpi_score + '</div>' +
          '<div class="l">' + escAn(t.trainer) + (t.low_data ? ' <span class="tag t-no">low data</span>' : '') + '</div></div>';
      });
      lead += '</div>';

      // full scorecard table
      var h = '<div class="an-sect"><h4>🏆 Trainers — competition (L&D Executives)</h4>' +
        '<div class="an-muted" style="margin-bottom:10px">KPI score (0–100) = Pass ' + (w.pass||30) + '% · Avg score ' + (w.score||20) +
        '% · First-attempt ' + (w.first_attempt||20) + '% · Rating ' + (w.rating||20) + '% · Engagement ' + (w.engagement||10) + '%. Click a trainer for details. (The L&D Manager is shown separately below, not in this ranking.)</div>' +
        '<table><thead><tr><th>Rank</th><th>Trainer</th><th>KPI</th><th>Learners</th><th>Pass rate</th>' +
        '<th>Avg score</th><th>1st-attempt</th><th>Rating</th><th>OJT calls</th></tr></thead><tbody>';
      d.trainers.forEach(function (t, i) {
        h += '<tr style="cursor:pointer" onclick="window.__anTrainer(\'' + escAn(t.trainer_id) + '\')">' +
          '<td style="font-weight:700;color:var(--mg-muted)">' + (i+1) + '</td>' +
          '<td><b>' + escAn(t.trainer) + '</b>' + (t.low_data ? ' <span class="tag t-no">low data</span>' : '') + '</td>' +
          '<td><span style="display:inline-block;min-width:34px;text-align:center;font-weight:800;color:#fff;background:' + kpiColor(t.kpi_score) + ';border-radius:8px;padding:2px 6px">' + t.kpi_score + '</span></td>' +
          '<td>' + t.learners + '</td>' +
          '<td>' + (t.pass_rate == null ? '<span class="an-muted">—</span>' :
            '<span class="bar" style="width:60px"><i style="width:' + t.pass_rate + '%"></i></span> ' + t.pass_rate + '%') + '</td>' +
          '<td>' + (t.avg_score == null ? '<span class="an-muted">—</span>' : t.avg_score + '%') + '</td>' +
          '<td>' + (t.first_attempt_rate == null ? '<span class="an-muted">—</span>' : t.first_attempt_rate + '%') + '</td>' +
          '<td>' + starTxt(t.trainer_rating, t.trainer_rating_n) + '</td>' +
          '<td>' + (t.ojt_calls || 0) + '</td></tr>';
      });
      // render competition first, then the manager panel below it
      body.innerHTML = lead + h + '</tbody></table></div>' +
        '<div id="anLdMgr"><div class="an-empty">Loading your L&D Manager view…</div></div>';
      renderLdManager();
    });
  }

  // ---- L&D Manager view (Dharani): own activity + team roll-up ----
  function renderLdManager() {
    getJAn("/api/analytics/ld-manager").then(function (d) {
      var el = $an("anLdMgr");
      if (!el) return;
      if (!d || !d.ok) { el.innerHTML = ''; return; }
      var t = d.team || {}, my = d.my || {}, mgr = d.manager || {};

      // team summary strip
      var html = '<div class="an-sect"><h4>👤 ' + escAn(mgr.name || 'L&D Manager') +
        ' — L&D Manager view <span class="an-muted" style="font-weight:600">· your team + your own activity (not in the competition)</span></h4>';

      html += '<div class="an-cards">' +
        anCard((t.trainers || 0), 'Trainers') +
        anCard((t.distinct_learners != null ? t.distinct_learners : 0), 'Learners trained (team)') +
        anCard((t.avg_kpi == null ? '—' : t.avg_kpi), 'Team avg KPI') +
        anCard((t.avg_pass == null ? '—' : t.avg_pass + '%'), 'Team pass rate') +
        anCard((t.total_deliveries || 0), 'Modules delivered (team)') +
        anCard((t.total_ojt_calls || 0), 'OJT calls (team)') +
      '</div>';

      // best / needs-support flags
      if (d.best || d.needs_support) {
        html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px">';
        if (d.best) {
          html += '<div style="flex:1;min-width:200px;border:1px solid #bfe6d3;background:#e9f9f2;border-radius:10px;padding:10px 12px">' +
            '<div style="font-size:12px;color:#0a7d4f;font-weight:700">🌟 Top performer</div>' +
            '<div style="font-size:13px;margin-top:2px">' + escAn(d.best.trainer) + ' · KPI ' + d.best.kpi_score + '</div></div>';
        }
        if (d.needs_support) {
          html += '<div style="flex:1;min-width:200px;border:1px solid #f0d9a9;background:#fff7e6;border-radius:10px;padding:10px 12px">' +
            '<div style="font-size:12px;color:#9a6a00;font-weight:700">🤝 Needs support</div>' +
            '<div style="font-size:13px;margin-top:2px">' + escAn(d.needs_support.trainer) + ' · KPI ' + d.needs_support.kpi_score + '</div></div>';
        }
        html += '</div>';
      }
      html += '</div>';

      // per-trainer roll-up (compact, clickable)
      html += '<div class="an-sect"><h4>Your trainers — progress</h4>' +
        '<table><thead><tr><th>Trainer</th><th>KPI</th><th>Learners</th><th>Pass</th><th>Avg</th><th>Rating</th></tr></thead><tbody>';
      (d.trainers || []).forEach(function (x) {
        html += '<tr style="cursor:pointer" onclick="window.__anTrainer(\'' + escAn(x.trainer_id) + '\')">' +
          '<td><b>' + escAn(x.trainer) + '</b>' + (x.low_data ? ' <span class="tag t-no">low data</span>' : '') + '</td>' +
          '<td><span style="font-weight:800;color:' + kpiColor(x.kpi_score) + '">' + x.kpi_score + '</span></td>' +
          '<td>' + x.learners + '</td>' +
          '<td>' + (x.pass_rate == null ? '—' : x.pass_rate + '%') + '</td>' +
          '<td>' + (x.avg_score == null ? '—' : x.avg_score + '%') + '</td>' +
          '<td>' + starTxt(x.trainer_rating, x.trainer_rating_n) + '</td></tr>';
      });
      html += '</tbody></table></div>';

      // my own activity (not scored against trainers)
      html += '<div class="an-sect"><h4>My own delivery activity <span class="an-muted" style="font-weight:600">· as L&D Manager (not ranked)</span></h4>' +
        '<div class="an-cards">' +
        anCard((my.learners || 0), 'Learners I trained') +
        anCard((my.deliveries || 0), 'Modules I delivered') +
        anCard((my.pass_rate == null ? '—' : my.pass_rate + '%'), 'Their pass rate') +
        anCard((my.avg_score == null ? '—' : my.avg_score + '%'), 'Their avg score') +
        anCard((my.ojt_calls || 0), 'My OJT calls') +
        anCardRaw(starTxt(my.trainer_rating, my.trainer_rating_n), 'My rating') +
        '</div>' +
        '<div class="an-muted" style="font-size:11.5px">Your own training work is shown here for visibility but is kept out of the trainer competition above.</div>' +
        '</div>';

      el.innerHTML = html;
    });
  }

  // shared detail block (learners + modules + comments) used by the admin
  // drill-in AND the trainer's own "My Performance" view.
  function _trainerDetailHTML(d) {
    var html = "";
    // learners
    html += '<div class="an-sect"><h4>Learners trained (' + (d.learners || []).length + ')</h4>';
    if ((d.learners || []).length) {
      html += '<table><thead><tr><th>Learner</th><th>Best score</th><th>Passed</th><th>Attempts</th></tr></thead><tbody>' +
        d.learners.map(function (l) {
          return '<tr><td>' + escAn(l.name) + '</td>' +
            '<td>' + (l.best == null ? '—' : l.best + '%') + '</td>' +
            '<td>' + (l.passed ? '<span class="tag t-pass">Yes</span>' : '<span class="tag t-fail">No</span>') + '</td>' +
            '<td>' + l.attempts + '</td></tr>';
        }).join("") + '</tbody></table>';
    } else { html += '<div class="an-empty">No learners.</div>'; }
    html += '</div>';

    // modules
    html += '<div class="an-sect"><h4>Modules delivered (' + (d.modules || []).length + ')</h4>';
    if ((d.modules || []).length) {
      html += '<table><thead><tr><th>Module</th><th>Learners</th></tr></thead><tbody>' +
        d.modules.map(function (m) {
          return '<tr><td>' + escAn(m.title) + '</td><td>' + m.learners + '</td></tr>';
        }).join("") + '</tbody></table>';
    } else { html += '<div class="an-empty">No modules.</div>'; }
    html += '</div>';

    // comments
    html += '<div class="an-sect"><h4>Feedback comments (' + (d.comments || []).length + ')</h4>';
    if ((d.comments || []).length) {
      html += d.comments.map(function (c) {
        return '<div style="border:1px solid var(--mg-line);border-radius:8px;padding:10px;margin-bottom:8px;background:#fafdff">' +
          '<div style="font-size:13px">"' + escAn(c.comment) + '"</div>' +
          '<div class="an-muted" style="margin-top:4px">— ' + escAn(c.learner) +
          (c.module ? ' · ' + escAn(c.module) : '') +
          (c.trainer_rating ? ' · ' + c.trainer_rating + '★' : '') +
          ' · ' + escAn(c.when) + '</div></div>';
      }).join("");
    } else { html += '<div class="an-empty">No written feedback yet.</div>'; }
    html += '</div>';
    return html;
  }

  // drill-in for one trainer (admin)
  window.__anTrainer = function (tid) {
    var box = $an("anViewBox");
    box.innerHTML = '<div class="an-sect"><button class="an-pill" onclick="window.__anView(\'trainers\')">‹ Back to trainers</button></div>' +
      '<div id="anTrDetail"><div class="an-empty">Loading…</div></div>';
    getJAn("/api/analytics/trainer?id=" + encodeURIComponent(tid)).then(function (d) {
      var el = $an("anTrDetail");
      if (!d || !d.ok) { el.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      var r = d.ratings || {};
      var html = '<div class="an-sect"><h4>' + escAn(d.trainer) + '</h4>' +
        '<div class="an-muted">Trainer rating: ' + starTxt(r.trainer_avg, r.n) +
        ' &nbsp;·&nbsp; Content rating: ' + starTxt(r.content_avg, 0) + '</div></div>';
      el.innerHTML = html + _trainerDetailHTML(d);
    });
  };

  // ===================== MY PERFORMANCE (trainer's own view) =====================
  function renderMyPerformance() {
    var box = $an("anViewBox");
    box.innerHTML = '<div id="anMyBody"><div class="an-empty">Loading…</div></div>';
    // 1) own KPI summary card, then 2) own detail (learners/modules/comments)
    getJAn("/api/analytics/my-trainer").then(function (d) {
      var body = $an("anMyBody");
      if (!d || !d.ok) { body.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      var m = d.me || {};
      var w = d.kpi_weights || {};

      // big KPI card
      var html = '<div class="an-sect" style="text-align:center">' +
        '<div class="an-muted" style="margin-bottom:6px">My KPI score</div>' +
        '<div style="font-size:52px;font-weight:800;line-height:1;color:' + kpiColor(m.kpi_score) + '">' + (m.kpi_score || 0) + '</div>' +
        '<div class="an-muted" style="margin-top:6px">out of 100' +
        (m.low_data ? ' · <span class="tag t-no">low data</span>' : '') + '</div>' +
        '<div class="an-muted" style="margin-top:10px;font-size:11.5px">Pass ' + (w.pass||30) + '% · Avg score ' + (w.score||20) +
        '% · First-attempt ' + (w.first_attempt||20) + '% · Rating ' + (w.rating||20) + '% · Engagement ' + (w.engagement||10) + '%</div>' +
        '</div>';

      // my metrics row
      html += '<div class="an-cards">' +
        anCard(m.pass_rate == null ? '—' : m.pass_rate + '%', 'Pass rate') +
        anCard(m.avg_score == null ? '—' : m.avg_score + '%', 'Avg learner score') +
        anCard(m.first_attempt_rate == null ? '—' : m.first_attempt_rate + '%', '1st-attempt pass') +
        anCard(m.learners || 0, 'Learners trained') +
        anCard(m.deliveries || 0, 'Modules delivered') +
        anCard(m.ojt_calls || 0, 'OJT calls') +
      '</div>';

      // my ratings
      html += '<div class="an-sect"><h4>⭐ My ratings from learners</h4>' +
        '<div class="an-muted">Trainer rating: ' + starTxt(m.trainer_rating, m.trainer_rating_n) +
        ' &nbsp;·&nbsp; Content rating: ' + starTxt(m.content_rating, 0) + '</div></div>';

      body.innerHTML = html + '<div id="anMyDetail"><div class="an-empty">Loading your learners & feedback…</div></div>';

      // 2) reuse the drill-in detail for myself
      getJAn("/api/analytics/trainer?id=" + encodeURIComponent(m.trainer_id)).then(function (dd) {
        var el = $an("anMyDetail");
        if (!el) return;
        if (!dd || !dd.ok) { el.innerHTML = '<div class="an-empty">Could not load your details.</div>'; return; }
        el.innerHTML = _trainerDetailHTML(dd);
      });
    });
  }

  // small stat card helper (used by My Performance)
  function anCard(n, label) {
    return '<div class="an-card"><div class="n">' + escAn(n) + '</div><div class="l">' + escAn(label) + '</div></div>';
  }
  // value is already-safe HTML (e.g. a star string); label is escaped
  function anCardRaw(htmlValue, label) {
    return '<div class="an-card"><div class="n" style="font-size:18px">' + htmlValue + '</div><div class="l">' + escAn(label) + '</div></div>';
  }

  // ===================== FEEDBACK (dashboard) =====================
  var LOW_STAR = 3;  // ratings at or below this are flagged for attention

  function renderFeedback() {
    var box = $an("anViewBox");
    box.innerHTML = '<div id="anFbBody"><div class="an-empty">Loading…</div></div>';
    getJAn("/api/analytics/feedback").then(function (d) {
      var body = $an("anFbBody");
      if (!d || !d.ok) { body.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      // cache for toggle re-render + edit popup
      AN._fbRows = (d.feedback || []);
      AN._fbIsAdmin = !!d.is_admin;
      AN._fb = {};
      AN._fbRows.forEach(function (f) { AN._fb[f.id] = f; });
      if (!AN._fbGroup) AN._fbGroup = "trainer";  // default grouping
      drawFeedback();
    });
  }

  // average helper (ignores nulls)
  function _avg(arr) {
    var v = arr.filter(function (x) { return x != null; });
    if (!v.length) return null;
    return Math.round((v.reduce(function (a, b) { return a + b; }, 0) / v.length) * 10) / 10;
  }
  function starStr(v, n) {
    if (v == null) return '<span class="an-muted">—</span>';
    var full = Math.round(v);
    var s = "";
    for (var i = 1; i <= 5; i++) s += (i <= full ? "★" : "☆");
    return '<span style="color:#f0a500;letter-spacing:1px">' + s + '</span> ' +
      '<span class="an-muted">' + v + (n ? " · " + n : "") + '</span>';
  }

  window.__anFbGroup = function (g) { AN._fbGroup = g; drawFeedback(); };

  function drawFeedback() {
    var body = $an("anFbBody");
    if (!body) return;
    var rows = AN._fbRows || [];
    var isAdmin = AN._fbIsAdmin;

    if (!rows.length) {
      body.innerHTML = '<div class="an-empty">No learner feedback yet. It appears here once learners rate modules/courses.</div>';
      return;
    }

    // ---- collect all star values for summary + distribution ----
    var trAll = [], ctAll = [], coAll = [], dist = [0, 0, 0, 0, 0]; // dist[0]=1★ … dist[4]=5★
    rows.forEach(function (f) {
      [f.trainer_rating, f.content_rating, f.course_rating].forEach(function (v) {
        if (v != null && v >= 1 && v <= 5) dist[v - 1]++;
      });
      if (f.trainer_rating != null) trAll.push(f.trainer_rating);
      if (f.content_rating != null) ctAll.push(f.content_rating);
      if (f.course_rating != null) coAll.push(f.course_rating);
    });

    // ---- 1) summary cards ----
    var html = '<div class="an-cards">' +
      anCard(rows.length, "Feedback entries") +
      anCard(_avg(trAll) == null ? "—" : _avg(trAll) + "★", "Avg trainer rating") +
      anCard(_avg(ctAll) == null ? "—" : _avg(ctAll) + "★", "Avg content rating") +
      anCard(_avg(coAll) == null ? "—" : _avg(coAll) + "★", "Avg course rating") +
    '</div>';

    // ---- 2) distribution chart ----
    html += '<div class="an-sect"><h4>⭐ Rating distribution</h4>' +
      '<div style="height:200px"><canvas id="anFbDist"></canvas></div></div>';

    // ---- 3) low-rating flags (<= LOW_STAR) ----
    var low = rows.filter(function (f) {
      return [f.trainer_rating, f.content_rating, f.course_rating].some(function (v) {
        return v != null && v <= LOW_STAR;
      });
    });
    html += '<div class="an-sect" style="border-color:#f0c9c9;background:#fffafa">' +
      '<h4 style="color:#b4231d">⚠️ Needs attention — ' + LOW_STAR + '★ or below (' + low.length + ')</h4>';
    if (!low.length) {
      html += '<div class="an-empty">No low ratings. 👍</div>';
    } else {
      html += low.map(function (f) { return fbCardHTML(f, isAdmin, true); }).join("");
    }
    html += '</div>';

    // ---- 4) grouped comments with toggle ----
    html += '<div class="an-sub" style="margin-top:4px">' +
      '<button class="an-pill' + (AN._fbGroup === "trainer" ? " on" : "") + '" onclick="window.__anFbGroup(\'trainer\')">By Trainer</button>' +
      '<button class="an-pill' + (AN._fbGroup === "module" ? " on" : "") + '" onclick="window.__anFbGroup(\'module\')">By Module / Course</button>' +
      '</div>';

    var groups = {};
    rows.forEach(function (f) {
      var key, label;
      if (AN._fbGroup === "trainer") {
        key = f.trainer_id || "_none";
        label = f.trainer || "— No trainer —";
      } else {
        key = (f.type || "") + ":" + (f.about || "");
        label = (f.about || "Untitled") + (f.type === "course" ? " (course)" : "");
      }
      (groups[key] = groups[key] || { label: label, rows: [] }).rows.push(f);
    });

    var keys = Object.keys(groups).sort(function (a, b) {
      return groups[b].rows.length - groups[a].rows.length;
    });
    keys.forEach(function (k) {
      var g = groups[k];
      // group mini-summary
      var gtr = [], gct = [], gco = [];
      g.rows.forEach(function (f) {
        if (f.trainer_rating != null) gtr.push(f.trainer_rating);
        if (f.content_rating != null) gct.push(f.content_rating);
        if (f.course_rating != null) gco.push(f.course_rating);
      });
      var parts = [];
      if (gtr.length) parts.push("Trainer " + _avg(gtr) + "★");
      if (gct.length) parts.push("Content " + _avg(gct) + "★");
      if (gco.length) parts.push("Course " + _avg(gco) + "★");
      html += '<div class="an-sect"><h4>' + escAn(g.label) +
        ' <span class="an-muted" style="font-weight:600">· ' + g.rows.length + ' feedback' +
        (parts.length ? " · " + parts.join(" · ") : "") + '</span></h4>' +
        g.rows.map(function (f) { return fbCardHTML(f, isAdmin, false); }).join("") +
        '</div>';
    });

    body.innerHTML = html;

    // draw the distribution chart (after DOM is in place)
    var cv = $an("anFbDist");
    if (cv && window.Chart) {
      try { if (AN_CHARTS.fbDist) { AN_CHARTS.fbDist.destroy(); delete AN_CHARTS.fbDist; } } catch (e) {}
      try {
        AN_CHARTS.fbDist = new Chart(cv.getContext("2d"), {
          type: "bar",
          data: {
            labels: ["1★", "2★", "3★", "4★", "5★"],
            datasets: [{
              data: dist,
              backgroundColor: ["#b4231d", "#e24b4a", "#f0a500", "#6cc04a", "#1d9e75"],
              borderRadius: 6
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
          }
        });
      } catch (e) {}
    }
  }

  // one feedback card (used in flags + grouped lists)
  function fbCardHTML(f, isAdmin, flagMode) {
    var ratings = [];
    if (f.trainer_rating != null) ratings.push("Trainer " + f.trainer_rating + "★");
    if (f.content_rating != null) ratings.push("Content " + f.content_rating + "★");
    if (f.course_rating != null) ratings.push("Course " + f.course_rating + "★");
    var low = [f.trainer_rating, f.content_rating, f.course_rating].some(function (v) {
      return v != null && v <= LOW_STAR;
    });
    return '<div style="border:1px solid ' + (flagMode ? "#f0c9c9" : "var(--mg-line)") +
      ';border-radius:8px;padding:10px 12px;margin-bottom:8px;background:' + (flagMode ? "#fff" : "#fafdff") + '">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">' +
      '<div style="flex:1">' +
      (f.comment ? '<div style="font-size:13px;margin-bottom:5px">"' + escAn(f.comment) + '"</div>' : '<div class="an-muted" style="font-size:12.5px;margin-bottom:5px">(no comment)</div>') +
      '<div class="an-muted" style="font-size:12px">' +
      escAn(f.learner) +
      ' · ' + escAn(f.about || "") +
      (f.trainer ? ' · trainer: ' + escAn(f.trainer) : '') +
      ' · ' + escAn(f.when) + '</div>' +
      '<div style="margin-top:4px;font-size:12px' + (low ? ";color:#b4231d;font-weight:600" : ";color:#44515b") + '">' +
      escAn(ratings.join("  ·  ")) + '</div>' +
      '</div>' +
      (isAdmin ? '<button class="an-pill" style="padding:3px 10px;white-space:nowrap" onclick="window.__anEditFb(' + f.id + ')">Edit</button>' : '') +
      '</div></div>';
  }

  // admin: edit a submitted rating (fix trainer / stars / delete)
  window.__anEditFb = function (id) {
    var f = (AN._fb || {})[id];
    if (!f) return;
    // ensure we have the trainer list
    var buildPopup = function (trainers) {
      var opts = '<option value="">— No trainer —</option>' + trainers.map(function (t) {
        return '<option value="' + escAn(t.emp_id) + '"' + (t.emp_id === f.trainer_id ? ' selected' : '') + '>' +
          escAn(t.name) + (t.designation ? ' · ' + escAn(t.designation) : '') + '</option>';
      }).join("");
      var ov = $an("anFbEditOv");
      if (!ov) { ov = document.createElement("div"); ov.id = "anFbEditOv"; document.body.appendChild(ov); }
      ov.style = "position:fixed;inset:0;background:rgba(8,30,40,.5);display:flex;align-items:center;justify-content:center;padding:20px;z-index:95";
      var starSel = function (label, field, val) {
        if (val == null) return "";
        var o = "";
        for (var i = 1; i <= 5; i++) o += '<option value="' + i + '"' + (i === val ? ' selected' : '') + '>' + i + '★</option>';
        return '<div style="margin:8px 0"><label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:3px">' + label + '</label>' +
          '<select id="anFb_' + field + '" style="padding:7px;border:1px solid var(--mg-line);border-radius:8px;font-size:13px">' + o + '</select></div>';
      };
      ov.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:20px;box-shadow:0 18px 50px rgba(0,0,0,.25)">' +
        '<h3 style="margin:0 0 4px;font-size:15px">Edit feedback</h3>' +
        '<div class="an-muted" style="margin-bottom:10px">From ' + escAn(f.learner) + ' · ' + escAn(f.about || "") + '</div>' +
        '<div style="margin:8px 0"><label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:3px">Trainer</label>' +
        '<select id="anFb_trainer" style="width:100%;padding:8px;border:1px solid var(--mg-line);border-radius:8px;font-size:13px">' + opts + '</select></div>' +
        starSel("Trainer rating", "trainer_rating", f.trainer_rating) +
        starSel("Content rating", "content_rating", f.content_rating) +
        starSel("Course rating", "course_rating", f.course_rating) +
        '<div style="display:flex;justify-content:space-between;margin-top:16px">' +
        '<button class="an-pill" style="color:#b4231d;border-color:#f0c9c9" onclick="window.__anDeleteFb(' + id + ')">Delete</button>' +
        '<div style="display:flex;gap:8px">' +
        '<button class="an-pill" onclick="document.getElementById(\'anFbEditOv\').remove()">Cancel</button>' +
        '<button class="an-pill" style="background:var(--mg-blue);color:#fff;border-color:var(--mg-blue)" onclick="window.__anSaveFb(' + id + ')">Save</button>' +
        '</div></div></div>';
    };
    if (AN._trainers) { buildPopup(AN._trainers); }
    else {
      getJAn("/api/analytics/rating/trainers-list").then(function (d) {
        AN._trainers = (d && d.ok && d.trainers) ? d.trainers : [];
        buildPopup(AN._trainers);
      });
    }
  };

  window.__anSaveFb = function (id) {
    var body = { id: id };
    var tr = $an("anFb_trainer"); if (tr) body.trainer_id = tr.value;
    ["trainer_rating", "content_rating", "course_rating"].forEach(function (k) {
      var el = $an("anFb_" + k); if (el) body[k] = parseInt(el.value, 10);
    });
    fetch("/api/analytics/rating/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        var ov = $an("anFbEditOv"); if (ov) ov.remove();
        if (r && r.ok) { renderFeedback(); } else { alert((r && r.msg) || "Could not save."); }
      });
  };

  window.__anDeleteFb = function (id) {
    if (!confirm("Delete this feedback permanently?")) return;
    fetch("/api/analytics/rating/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        var ov = $an("anFbEditOv"); if (ov) ov.remove();
        if (r && r.ok) { renderFeedback(); } else { alert((r && r.msg) || "Could not delete."); }
      });
  };

  // ===================== REPORTS / EXPORT (admin) =====================
  var REPORTS = [
    { kind: "trainers",  icon: "🧑‍🏫", title: "Trainer KPI scorecards",
      desc: "Each trainer's KPI, pass rate, ratings, deliveries. Cumulative (as of today).", dated: false },
    { kind: "employees", icon: "👤", title: "Employee training records",
      desc: "Per employee: modules done, assessments passed, avg score, certificates, who trained them. Cumulative.", dated: false },
    { kind: "activity",  icon: "🕒", title: "Activity log",
      desc: "Completions, assessments, certificates and OJT calls within the chosen date range.", dated: true },
    { kind: "feedback",  icon: "💬", title: "Feedback report",
      desc: "All learner ratings and comments within the chosen date range.", dated: true }
  ];

  window.__anExport = function (kind) {
    var f = ($an("anRepFrom") || {}).value || "";
    var t = ($an("anRepTo") || {}).value || "";
    var q = [];
    if (f) q.push("from=" + encodeURIComponent(f));
    if (t) q.push("to=" + encodeURIComponent(t));
    var url = "/api/analytics/export/" + kind + (q.length ? ("?" + q.join("&")) : "");
    // trigger a download without leaving the page
    var a = document.createElement("a");
    a.href = url; a.rel = "noopener";
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); }, 1500);
  };

  function renderReports() {
    var box = $an("anViewBox");
    // default range: this month start -> today
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth(), 1);
    var iso = function (d) { return d.toISOString().slice(0, 10); };

    var html = '<div class="an-sect"><h4>📄 Export reports</h4>' +
      '<div class="an-muted" style="margin-bottom:10px">Pick a date range (used by the Activity and Feedback reports), then download. Files are Excel (.xlsx).</div>' +
      '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">' +
        '<div><label class="an-muted" style="display:block;margin-bottom:3px">From</label>' +
        '<input type="date" id="anRepFrom" class="an-input" style="min-width:160px" value="' + iso(first) + '"></div>' +
        '<div><label class="an-muted" style="display:block;margin-bottom:3px">To</label>' +
        '<input type="date" id="anRepTo" class="an-input" style="min-width:160px" value="' + iso(now) + '"></div>' +
        '<button class="an-pill" onclick="window.__anRepClear()">Clear dates (all time)</button>' +
      '</div></div>';

    html += '<div class="an-cards" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">';
    REPORTS.forEach(function (r) {
      html += '<div class="an-card" style="text-align:left">' +
        '<div style="font-size:22px;margin-bottom:4px">' + r.icon + '</div>' +
        '<div style="font-weight:700;color:var(--mg-ink);font-size:14px">' + escAn(r.title) + '</div>' +
        '<div class="an-muted" style="margin:6px 0 12px;font-size:12px;line-height:1.5">' + escAn(r.desc) + '</div>' +
        '<button class="an-pill" style="background:var(--mg-green,#1d9e75);color:#fff;border-color:var(--mg-green,#1d9e75)" ' +
        'onclick="window.__anExport(\'' + r.kind + '\')">⬇ Download Excel</button>' +
        (r.dated ? '' : '<div class="an-muted" style="margin-top:6px;font-size:11px">Date range not applied (cumulative report)</div>') +
        '</div>';
    });
    html += '</div>';

    box.innerHTML = html;
  }

  window.__anRepClear = function () {
    var f = $an("anRepFrom"), t = $an("anRepTo");
    if (f) f.value = ""; if (t) t.value = "";
  };

  // ---- entry point (called by switchTab('an')) ----
  window.loadAnalytics = function () {
    var root = $an("anRoot");
    if (!root) return;
    if (!root.getAttribute("data-built")) {
      root.innerHTML = shell();
      root.setAttribute("data-built", "1");
    }
    // Render the current view immediately (paints fast); load the people
    // list in parallel in the background — it's only needed for the Employee
    // picker, so it must not block the first paint.
    renderView();
    if (!AN.people.length) {
      getJAn("/api/analytics/people").then(function (d) {
        AN.people = (d && d.ok && d.people) ? d.people : [];
        // if the user is already on the Employee view, refresh it now that
        // the picker data has arrived
        if (AN.view === "employee") renderView();
      });
    }
  };
})();
