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
        '<button class="an-pill" id="anTabTr" onclick="window.__anView(\'trainers\')">🧑‍🏫 Trainers</button>' +
        '<button class="an-pill" id="anTabFb" onclick="window.__anView(\'feedback\')">💬 Feedback</button>' +
      '</div>' +
      '<div id="anViewBox"></div>';
  }

  function setActivePill() {
    ["Ov", "Emp", "Act", "Tr", "Fb"].forEach(function (s) {
      var b = $an("anTab" + s);
      if (b) b.classList.remove("on");
    });
    var map = { overview: "Ov", employee: "Emp", activity: "Act", trainers: "Tr", feedback: "Fb" };
    var b = $an("anTab" + map[AN.view]);
    if (b) b.classList.add("on");
  }

  window.__anView = function (v) { AN.view = v; renderView(); };

  function renderView() {
    setActivePill();
    if (AN.view === "overview") return renderOverview();
    if (AN.view === "employee") return renderEmployee();
    if (AN.view === "activity") return renderActivity();
    if (AN.view === "trainers") return renderTrainers();
    if (AN.view === "feedback") return renderFeedback();
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
      var h = '<div class="an-sect"><h4>🧑‍🏫 Trainer KPI scorecard</h4>' +
        '<div class="an-muted" style="margin-bottom:10px">KPI score (0–100) = Pass ' + (w.pass||30) + '% · Avg score ' + (w.score||20) +
        '% · First-attempt ' + (w.first_attempt||20) + '% · Rating ' + (w.rating||20) + '% · Engagement ' + (w.engagement||10) + '%. Click a trainer for details.</div>' +
        '<table><thead><tr><th>Trainer</th><th>KPI</th><th>Learners</th><th>Pass rate</th>' +
        '<th>Avg score</th><th>1st-attempt</th><th>Rating</th><th>OJT calls</th></tr></thead><tbody>';
      d.trainers.forEach(function (t) {
        h += '<tr style="cursor:pointer" onclick="window.__anTrainer(\'' + escAn(t.trainer_id) + '\')">' +
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
      body.innerHTML = lead + h + '</tbody></table></div>';
    });
  }

  // drill-in for one trainer
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

      el.innerHTML = html;
    });
  };

  // ===================== FEEDBACK =====================
  function renderFeedback() {
    var box = $an("anViewBox");
    box.innerHTML = '<div id="anFbBody"><div class="an-empty">Loading…</div></div>';
    getJAn("/api/analytics/feedback").then(function (d) {
      var body = $an("anFbBody");
      if (!d || !d.ok) { body.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      if (!d.feedback.length) {
        body.innerHTML = '<div class="an-empty">No learner feedback yet. It appears here once learners rate modules/courses.</div>';
        return;
      }
      var starTxt = function (v) { return v == null ? "" : (v + "★"); };
      AN._fb = {}; // cache rows by id for the edit popup
      var h = '<div class="an-sect"><h4>Learner feedback &amp; comments' +
        (d.is_admin ? '' : ' (your trainings)') + '</h4>' +
        '<table><thead><tr><th>Date</th><th>Learner</th><th>About</th><th>Trainer</th>' +
        '<th>Ratings</th><th>Comment</th>' + (d.is_admin ? '<th></th>' : '') + '</tr></thead><tbody>';
      d.feedback.forEach(function (f) {
        AN._fb[f.id] = f;
        var ratings = [];
        if (f.trainer_rating != null) ratings.push("Trainer " + starTxt(f.trainer_rating));
        if (f.content_rating != null) ratings.push("Content " + starTxt(f.content_rating));
        if (f.course_rating != null) ratings.push("Course " + starTxt(f.course_rating));
        h += '<tr><td style="white-space:nowrap">' + escAn(f.when) + '</td><td>' + escAn(f.learner) + '</td>' +
          '<td>' + escAn(f.about || "") + '</td>' +
          '<td>' + (f.trainer ? escAn(f.trainer) : '<span class="an-muted">—</span>') + '</td>' +
          '<td>' + escAn(ratings.join(" · ")) + '</td>' +
          '<td>' + (f.comment ? escAn(f.comment) : '<span class="an-muted">—</span>') + '</td>' +
          (d.is_admin ? '<td style="white-space:nowrap"><button class="an-pill" style="padding:3px 10px" onclick="window.__anEditFb(' + f.id + ')">Edit</button></td>' : '') +
          '</tr>';
      });
      body.innerHTML = h + '</tbody></table>' +
        (d.is_admin ? '<div class="an-muted" style="margin-top:8px">Use Edit to correct the trainer if a learner picked the wrong one.</div>' : '') +
        '</div>';
    });
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
