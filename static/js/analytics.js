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

  var AN = { view: "employee", people: [], curEmp: null };

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
      "#anRoot .an-muted{color:var(--mg-muted);font-size:12px}"
    ].join("") + "</style>";
  }

  function shell() {
    return css() +
      '<div class="an-cards" id="anOverview"></div>' +
      '<div class="an-sub">' +
        '<button class="an-pill" id="anTabEmp" onclick="window.__anView(\'employee\')">👤 Employee</button>' +
        '<button class="an-pill" id="anTabAct" onclick="window.__anView(\'activity\')">🕒 Activity</button>' +
        '<button class="an-pill" id="anTabTr" onclick="window.__anView(\'trainers\')">🧑‍🏫 Trainers</button>' +
        '<button class="an-pill" id="anTabFb" onclick="window.__anView(\'feedback\')">💬 Feedback</button>' +
      '</div>' +
      '<div id="anViewBox"></div>';
  }

  // ---- overview cards ----
  function loadOverview() {
    getJAn("/api/analytics/overview").then(function (d) {
      if (!d || !d.ok) return;
      var o = d.overview || {};
      var card = function (n, l) {
        return '<div class="an-card"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>';
      };
      $an("anOverview").innerHTML =
        card(o.total_staff || 0, "Total learners") +
        card(o.completions_today || 0, "Modules completed today") +
        card(o.assessments_today || 0, "Assessments taken today") +
        card(o.passed_today || 0, "Passed today") +
        card(o.certs_today || 0, "Certificates issued today");
    });
  }

  function setActivePill() {
    ["Emp", "Act", "Tr", "Fb"].forEach(function (s) {
      var b = $an("anTab" + s);
      if (b) b.classList.remove("on");
    });
    var map = { employee: "Emp", activity: "Act", trainers: "Tr", feedback: "Fb" };
    var b = $an("anTab" + map[AN.view]);
    if (b) b.classList.add("on");
  }

  window.__anView = function (v) { AN.view = v; renderView(); };

  function renderView() {
    setActivePill();
    if (AN.view === "employee") return renderEmployee();
    if (AN.view === "activity") return renderActivity();
    if (AN.view === "trainers") return renderTrainers();
    if (AN.view === "feedback") return renderFeedback();
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
  function renderTrainers() {
    var box = $an("anViewBox");
    box.innerHTML = '<div id="anTrBody"><div class="an-empty">Loading…</div></div>';
    getJAn("/api/analytics/trainers").then(function (d) {
      var body = $an("anTrBody");
      if (!d || !d.ok) { body.innerHTML = '<div class="an-empty">Could not load.</div>'; return; }
      if (!d.trainers.length) { body.innerHTML = '<div class="an-empty">No trainer deliveries recorded yet.</div>'; return; }
      var stars = function (v, n) {
        if (v == null) return '<span class="an-muted">—</span>';
        return '<b>' + v + '</b> ★' + (n ? ' <span class="an-muted">(' + n + ')</span>' : '');
      };
      var h = '<div class="an-sect"><h4>Trainer performance &amp; ratings</h4>' +
        '<table><thead><tr><th>Trainer</th><th>Learners</th><th>Modules</th><th>Deliveries</th>' +
        '<th>Avg score</th><th>Pass rate</th><th>Trainer rating</th><th>Content rating</th></tr></thead><tbody>';
      d.trainers.forEach(function (t) {
        h += '<tr><td><b>' + escAn(t.trainer) + '</b></td>' +
          '<td>' + t.learners + '</td><td>' + t.modules + '</td><td>' + t.deliveries + '</td>' +
          '<td>' + (t.avg_score == null ? '<span class="an-muted">—</span>' : t.avg_score + "%") + '</td>' +
          '<td>' + (t.pass_rate == null ? '<span class="an-muted">—</span>' :
            '<span class="bar" style="width:70px"><i style="width:' + t.pass_rate + '%"></i></span> ' + t.pass_rate + "%") + '</td>' +
          '<td>' + stars(t.trainer_rating, t.trainer_rating_n) + '</td>' +
          '<td>' + stars(t.content_rating, 0) + '</td></tr>';
      });
      body.innerHTML = h + '</tbody></table>' +
        '<div class="an-muted" style="margin-top:10px">Ratings are collected from learners after they complete a module (content + trainer) or pass a course.</div></div>';
    });
  }

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
      var h = '<div class="an-sect"><h4>Learner feedback &amp; comments' +
        (d.is_admin ? '' : ' (your trainings)') + '</h4>' +
        '<table><thead><tr><th>Date</th><th>Learner</th><th>About</th><th>Trainer</th>' +
        '<th>Ratings</th><th>Comment</th></tr></thead><tbody>';
      d.feedback.forEach(function (f) {
        var ratings = [];
        if (f.trainer_rating != null) ratings.push("Trainer " + starTxt(f.trainer_rating));
        if (f.content_rating != null) ratings.push("Content " + starTxt(f.content_rating));
        if (f.course_rating != null) ratings.push("Course " + starTxt(f.course_rating));
        h += '<tr><td>' + escAn(f.when) + '</td><td>' + escAn(f.learner) + '</td>' +
          '<td>' + escAn(f.about || "") + '</td>' +
          '<td>' + (f.trainer ? escAn(f.trainer) : '<span class="an-muted">—</span>') + '</td>' +
          '<td>' + escAn(ratings.join(" · ")) + '</td>' +
          '<td>' + (f.comment ? escAn(f.comment) : '<span class="an-muted">—</span>') + '</td></tr>';
      });
      body.innerHTML = h + '</tbody></table></div>';
    });
  }

  // ---- entry point (called by switchTab('an')) ----
  window.loadAnalytics = function () {
    var root = $an("anRoot");
    if (!root) return;
    if (!root.getAttribute("data-built")) {
      root.innerHTML = shell();
      root.setAttribute("data-built", "1");
    }
    loadOverview();
    // load people list once, then render current view
    if (!AN.people.length) {
      getJAn("/api/analytics/people").then(function (d) {
        AN.people = (d && d.ok && d.people) ? d.people : [];
        renderView();
      });
    } else {
      renderView();
    }
  };
})();
