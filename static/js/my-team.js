/* ============================================================
   my-team.js — "My Team" for managers (BDM / State Head / RSM / NSM)
   Shows everyone below them in the reporting chain: each person's
   induction / training / assessment completion, average score, and
   who trained them. Drill into one person; export the team to Excel.

   Self-wires into showTab('myteam') and reveals its own tab button
   only when the signed-in person actually has a team (like My OJT).
   Backend: /api/team, /api/team/member, /api/team/export.xlsx
   ============================================================ */
(function () {
  "use strict";
  function $mt(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function getJ(u) {
    return fetch(u, { credentials: "same-origin" }).then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; });
  }

  var css = document.createElement("style");
  css.textContent = [
    "#myTeam .mt-hero{background:linear-gradient(135deg,#12284B,#1F5FA9);color:#fff;border-radius:16px;padding:18px 20px;margin-bottom:14px}",
    "#myTeam .mt-hero h2{margin:0;font-size:19px}",
    "#myTeam .mt-hero p{margin:4px 0 0;font-size:13px;opacity:.9}",
    "#myTeam .mt-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}",
    "#myTeam .mt-card{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:14px;padding:14px 16px}",
    "#myTeam .mt-card .v{font-size:26px;font-weight:800;color:#12284B;line-height:1.1}",
    "#myTeam .mt-card .l{font-size:12px;color:#62707a;margin-top:3px}",
    "#myTeam .mt-bar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}",
    "#myTeam .mt-search{flex:1;min-width:180px;padding:9px 12px;border:1px solid var(--mg-line,#e3e8ee);border-radius:9px;font-size:14px;font-family:inherit}",
    "#myTeam .mt-btn{padding:9px 14px;border-radius:9px;border:none;font-size:13px;font-weight:700;cursor:pointer;background:#1d9e75;color:#fff}",
    "#myTeam table{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border-radius:12px;overflow:hidden}",
    "#myTeam th{background:#12284B;color:#fff;padding:9px 8px;text-align:left;font-size:11.5px;white-space:nowrap}",
    "#myTeam td{border-bottom:1px solid #f0f0f0;padding:8px;vertical-align:middle}",
    "#myTeam tr.mt-row{cursor:pointer}",
    "#myTeam tr.mt-row:hover td{background:#f5f9fe}",
    "#myTeam .prog{height:9px;background:#eef2f5;border-radius:6px;overflow:hidden;min-width:70px;margin-top:3px}",
    "#myTeam .prog i{display:block;height:100%}",
    "#myTeam .pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}",
    "#myTeam .chip{display:inline-block;background:#eef5fc;color:#0c447c;border:1px solid #cddff0;border-radius:20px;padding:2px 9px;font-size:11.5px;margin:2px 3px 2px 0}",
    "#myTeam .mt-back{background:none;border:none;color:#1F5FA9;font-weight:700;cursor:pointer;font-size:13px;padding:6px 0;font-family:inherit}",
    "#myTeam .mt-sec{background:#fff;border:1px solid var(--mg-line,#e3e8ee);border-radius:14px;padding:16px;margin-bottom:12px}",
    "#myTeam .mt-sec h4{margin:0 0 10px;font-size:14px;color:#12284B}"
  ].join("\n");
  document.head.appendChild(css);

  var DATA = null;   // cached /api/team response

  function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }
  function bar(a, b) {
    var p = pct(a, b), c = p >= 100 ? "#1d9e75" : (p >= 50 ? "#c9a227" : "#d64545");
    return '<div class="prog"><i style="width:' + p + '%;background:' + c + '"></i></div>';
  }

  // reveal the tab button if this person has a team (called once on load)
  function revealIfManager() {
    getJ("/api/team").then(function (d) {
      if (d && d.ok && ((d.rows && d.rows.length) || d.is_admin)) {
        var btn = document.querySelector('.pt-tab[data-tab="myteam"]');
        if (btn) btn.style.display = "";
      }
    });
  }

  async function render() {
    var box = $mt("myTeam");
    if (!box) return;
    box.innerHTML = '<div class="empty">Loading your team…</div>';
    var d = await getJ("/api/team");
    DATA = d;
    if (!d || !d.ok) { box.innerHTML = '<div class="empty">Could not load your team.</div>'; return; }
    if (!d.rows || !d.rows.length) {
      box.innerHTML = '<div class="empty">No team members are assigned under you yet.</div>';
      return;
    }
    drawList();
  }

  function drawList() {
    var d = DATA;
    var s = d.summary || {};
    var hero = '<div class="mt-hero"><h2>My Team</h2><p>' +
      esc(d.scope || "") + ' · ' + (s.people || 0) + ' people</p></div>';

    var cards = '<div class="mt-cards">' +
      card((s.people || 0), "People") +
      card((s.induction_rate || 0) + "%", "Induction done") +
      card((s.training_rate || 0) + "%", "Training done") +
      card((s.assessment_rate || 0) + "%", "Assessments passed") +
      card((s.team_avg != null ? s.team_avg + "%" : "—"), "Team avg score") +
      '</div>';

    var bar2 = '<div class="mt-bar">' +
      '<input class="mt-search" id="mtSearch" placeholder="Search name, designation, region…" oninput="window.__mtFilter()">' +
      '<button class="mt-btn" onclick="window.__mtExport()">⬇ Export to Excel</button>' +
      '</div>';

    var table = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Name</th><th>Designation</th><th>Region</th>' +
      '<th>Induction</th><th>Training</th><th>Assessments</th><th>OJT</th><th>Avg</th>' +
      '</tr></thead><tbody id="mtBody">' + rowsHtml(d.rows) + '</tbody></table></div>';

    $mt("myTeam").innerHTML = hero + cards + bar2 + table;
  }

  function card(v, l) {
    return '<div class="mt-card"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
  }

  function ojtCell(r) {
    if (!r.ojt_status) return '<span style="color:#aaa">—</span>';
    var col = r.ojt_status === "completed" ? "#0f6b45"
            : (r.ojt_status === "failed" ? "#9e2b2b" : "#0c447c");
    var bg = r.ojt_status === "completed" ? "#eaf7f0"
           : (r.ojt_status === "failed" ? "#fdeaea" : "#eef5fc");
    var label = r.ojt_status.charAt(0).toUpperCase() + r.ojt_status.slice(1);
    return '<span class="pill" style="background:' + bg + ';color:' + col + '">' + esc(label) + '</span>' +
           '<div style="font-size:11px;color:#62707a;margin-top:2px">' + r.ojt_done + '/' + r.ojt_total +
           (r.ojt_pct != null ? ' · ' + r.ojt_pct + '%' : '') + '</div>';
  }

  function rowsHtml(rows) {
    return rows.map(function (r) {
      var avg = (r.avg_score != null)
        ? '<span class="pill" style="background:#eaf7f0;color:#0f6b45">' + r.avg_score + '%</span>'
        : '<span style="color:#aaa">—</span>';
      return '<tr class="mt-row" data-emp="' + esc(r.emp_id) + '" onclick="window.__mtOpen(\'' + esc(r.emp_id) + '\')">' +
        '<td><b>' + esc(r.name) + '</b><div style="font-size:11px;color:#8a97a1">' + esc(r.emp_id) + '</div></td>' +
        '<td>' + esc(r.designation || "—") + '</td>' +
        '<td>' + esc(r.region || "—") + '</td>' +
        '<td>' + r.ind_done + '/' + r.ind_total + bar(r.ind_done, r.ind_total) + '</td>' +
        '<td>' + r.trn_done + '/' + r.trn_total + bar(r.trn_done, r.trn_total) + '</td>' +
        '<td>' + r.ass_passed + '/' + r.ass_total + bar(r.ass_passed, r.ass_total) + '</td>' +
        '<td>' + ojtCell(r) + '</td>' +
        '<td>' + avg + '</td>' +
        '</tr>';
    }).join("");
  }

  window.__mtFilter = function () {
    var q = ($mt("mtSearch").value || "").toLowerCase().trim();
    var rows = (DATA.rows || []).filter(function (r) {
      if (!q) return true;
      return (r.name + " " + r.designation + " " + r.region + " " + r.emp_id).toLowerCase().indexOf(q) >= 0;
    });
    $mt("mtBody").innerHTML = rowsHtml(rows);
  };

  window.__mtExport = function () {
    window.location.href = "/api/team/export.xlsx?x=" + Date.now();
  };

  window.__mtOpen = async function (emp) {
    var box = $mt("myTeam");
    box.innerHTML = '<div class="empty">Loading…</div>';
    var d = await getJ("/api/team/member?emp_id=" + encodeURIComponent(emp));
    if (!d || !d.ok) { box.innerHTML = '<div class="empty">Could not load. </div><button class="mt-back" onclick="window.__mtBack()">‹ Back to team</button>'; return; }
    var p = d.person || {};
    function who(arr) {
      return (arr && arr.length)
        ? arr.map(function (x) { return '<span class="chip">👤 ' + esc(x) + '</span>'; }).join("")
        : '<span style="color:#aaa;font-size:12.5px">Not recorded</span>';
    }
    var aRows = (d.assessments || []).map(function (a) {
      var st = a.pass_attempt
        ? '<span style="color:#0f6b45;font-weight:700">Passed on attempt ' + a.pass_attempt + '</span>'
        : (a.attempts ? '<span style="color:#9e2b2b">Not passed (' + a.attempts + ')</span>' : '<span style="color:#aaa">Not attempted</span>');
      return '<tr><td><b>' + esc(a.title) + '</b></td><td style="text-align:center">' + a.attempts + '</td><td>' + st + '</td></tr>';
    }).join("");

    box.innerHTML =
      '<button class="mt-back" onclick="window.__mtBack()">‹ Back to team</button>' +
      '<div class="mt-hero"><h2>' + esc(p.name) + '</h2><p>' + esc(p.emp_id) +
        (p.designation ? ' · ' + esc(p.designation) : '') +
        (p.region ? ' · ' + esc(p.region) : '') +
        (p.manager_name ? ' · reports to ' + esc(p.manager_name) : '') + '</p></div>' +
      '<div class="mt-cards">' +
        card(d.ind_done + '/' + d.ind_total, "Induction done") +
        card(d.trn_done + '/' + d.trn_total, "Training done") +
        card(d.ass_passed + '/' + d.ass_total, "Assessments passed") +
        card((d.avg_score != null ? d.avg_score + '%' : '—'), "Average score") +
        (d.ojt_status
          ? card((d.ojt_pct != null ? d.ojt_pct + '%' : (d.ojt_done + '/' + d.ojt_total)),
                 "OJT (" + esc(d.ojt_status) + ")")
          : '') +
      '</div>' +
      '<div class="mt-sec"><h4>Who trained them</h4>' +
        '<div style="font-size:12px;color:#62707a;margin-bottom:3px">Induction</div>' + who(d.induction_by) +
        '<div style="font-size:12px;color:#62707a;margin:10px 0 3px">Training</div>' + who(d.training_by) +
      '</div>' +
      (aRows
        ? '<div class="mt-sec"><h4>Assessments</h4><div style="overflow-x:auto"><table><thead><tr><th>Assessment</th><th style="text-align:center">Attempts</th><th>Result</th></tr></thead><tbody>' + aRows + '</tbody></table></div></div>'
        : '');
  };

  window.__mtBack = function () { drawList(); };

  // self-wire into showTab + reveal the tab for managers
  function wire() {
    var prev = window.showTab;
    window.showTab = function (w) {
      if (prev) prev(w);
      if (w === "myteam") render();
    };
  }
  if (document.readyState !== "loading") { wire(); revealIfManager(); }
  else document.addEventListener("DOMContentLoaded", function () { wire(); revealIfManager(); });
})();
