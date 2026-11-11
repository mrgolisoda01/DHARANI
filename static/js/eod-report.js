/* ============================================================
   eod-report.js — "EOD Report" tab (admin + trainers)
   ------------------------------------------------------------
   • Left : your own update for the day (work done, in progress,
            support needed, tomorrow's plan) — saved per date.
   • Right: the WhatsApp-ready report = auto LMS section (from
            /api/eod/report) + everyone's saved updates, with a
            Copy button.
   Admin sees the whole L&D report + who has filled their update.
   A trainer sees their own trainer block + their own update.
   Helper names are suffixed "Eod" to avoid clashing with admin.js.
   ============================================================ */
(function () {
  "use strict";

  var $e = function (id) { return document.getElementById(id); };
  var escEod = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var FIELDS = [
    { k: "work_done",      label: "✅ Work completed today", ph: "One item per line, e.g.\nTook induction for 3 BDEs (Modules 1–4)\nPrepared BDM 15-day plan draft" },
    { k: "in_progress",    label: "🔄 In progress / pending", ph: "One item per line — what's still going on and what it's waiting for" },
    { k: "support_needed", label: "🙋 Support needed",       ph: "Anything you need from others (optional)" },
    { k: "tomorrow_plan",  label: "📅 Tomorrow's plan",      ph: "One item per line" }
  ];

  var EOD = { date: null, data: null, dirty: false, loadedFor: null };

  function toastEod(m) { if (typeof toast === "function") toast(m); else alert(m); }

  function todayIst() {
    var d = new Date(Date.now() + 330 * 60000);   // IST wall-clock, read via toISOString (UTC)
    return d.toISOString().slice(0, 10);
  }
  function ddmmyyyy(iso) { var p = (iso || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso; }
  function shiftDate(iso, days) {
    var d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function lines(t) {
    return String(t || "").split(/\r?\n/).map(function (s) { return s.replace(/^\s*([-•*]|\d+[.)])\s*/, "").trim(); })
      .filter(function (s) { return s; });
  }

  // ---- styles (scoped to #eodRoot) ----
  function css() {
    return "<style>" + [
      "#eodRoot .eod-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px}",
      "#eodRoot .eod-top h3{margin:0 12px 0 0;font-size:18px;color:var(--mg-ink)}",
      "#eodRoot .eod-btn{border:1px solid var(--mg-line);background:#fff;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;cursor:pointer;color:#44515b}",
      "#eodRoot .eod-btn.pri{background:var(--mg-blue);border-color:var(--mg-blue);color:#fff}",
      "#eodRoot .eod-btn.wa{background:#25d366;border-color:#25d366;color:#fff}",
      "#eodRoot .eod-btn:disabled{opacity:.5;cursor:default}",
      "#eodRoot input[type=date]{padding:7px 10px;border:1px solid var(--mg-line);border-radius:8px;font-size:13px;font-family:inherit}",
      "#eodRoot .eod-grid{display:grid;grid-template-columns:minmax(320px,1fr) minmax(340px,1.15fr);gap:16px;align-items:start}",
      "#eodRoot .eod-card{background:#fff;border:1px solid var(--mg-line);border-radius:12px;padding:16px;margin-bottom:14px}",
      "#eodRoot .eod-card h4{margin:0 0 10px;font-size:14px;color:var(--mg-ink)}",
      "#eodRoot .eod-fld{margin-bottom:12px}",
      "#eodRoot .eod-fld label{display:block;font-size:12.5px;font-weight:600;color:#44515b;margin-bottom:4px}",
      "#eodRoot textarea{width:100%;box-sizing:border-box;min-height:84px;padding:9px 10px;border:1px solid var(--mg-line);border-radius:8px;font-size:13px;font-family:inherit;resize:vertical;line-height:1.45}",
      "#eodRoot textarea:disabled{background:#f5f7f9}",
      "#eodRoot .eod-muted{color:var(--mg-muted);font-size:12px}",
      "#eodRoot .eod-warn{color:#b26a00;font-size:12px;font-weight:600}",
      "#eodRoot .eod-prev{background:#fff8e6;border:1px solid #f3dca4;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12.5px}",
      "#eodRoot .eod-prev pre{white-space:pre-wrap;margin:6px 0;font-family:inherit}",
      "#eodRoot .eod-chips{display:flex;flex-wrap:wrap;gap:6px}",
      "#eodRoot .eod-chip{border-radius:14px;padding:3px 10px;font-size:12px;font-weight:600}",
      "#eodRoot .eod-chip.ok{background:#e1f5ee;color:#0a7d4f}",
      "#eodRoot .eod-chip.no{background:#fdf1e3;color:#a65b00}",
      "#eodRoot .eod-preview{white-space:pre-wrap;word-wrap:break-word;background:#e9f6ec;border:1px solid #cfe9d6;border-radius:10px;padding:14px;font-size:13px;line-height:1.5;max-height:72vh;overflow:auto;font-family:inherit;margin:0}",
      "#eodRoot .eod-actions{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}",
      "@media(max-width:900px){#eodRoot .eod-grid{grid-template-columns:1fr}}"
    ].join("") + "</style>";
  }

  function shell() {
    var t = todayIst();
    return css() +
      '<div class="eod-top">' +
        '<h3>📝 EOD Report</h3>' +
        '<button class="eod-btn" onclick="window.__eodShift(-1)" title="Previous day">◀</button>' +
        '<input type="date" id="eodDate" max="' + t + '" onchange="window.__eodGo(this.value)">' +
        '<button class="eod-btn" id="eodNext" onclick="window.__eodShift(1)" title="Next day">▶</button>' +
        '<button class="eod-btn" onclick="window.__eodGo(\'' + t + '\')">Today</button>' +
        '<span class="eod-muted" id="eodSub"></span>' +
      '</div>' +
      '<div class="eod-grid">' +
        '<div>' +
          '<div class="eod-card"><h4 id="eodFormTitle">Your update</h4>' +
            '<div id="eodPrev"></div>' +
            FIELDS.map(function (f) {
              return '<div class="eod-fld"><label for="eod_' + f.k + '">' + f.label + '</label>' +
                '<textarea id="eod_' + f.k + '" placeholder="' + escEod(f.ph) + '" oninput="window.__eodDirty()"></textarea></div>';
            }).join("") +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
              '<button class="eod-btn pri" id="eodSave" onclick="window.__eodSave()">💾 Save my update</button>' +
              '<span id="eodSaved" class="eod-muted"></span>' +
            '</div>' +
          '</div>' +
          '<div class="eod-card" id="eodTeamCard" style="display:none"><h4>👥 Team updates for this day</h4><div id="eodTeam"></div></div>' +
        '</div>' +
        '<div>' +
          '<div class="eod-card"><h4>📱 WhatsApp report</h4>' +
            '<div class="eod-actions">' +
              '<button class="eod-btn wa" onclick="window.__eodCopy()">📋 Copy for WhatsApp</button>' +
              '<button class="eod-btn" id="eodShare" style="display:none" onclick="window.__eodShare()">📤 Share</button>' +
              '<button class="eod-btn" onclick="window.__eodReload()">🔄 Refresh LMS data</button>' +
            '</div>' +
            '<pre class="eod-preview" id="eodPreview">Loading…</pre>' +
            '<div class="eod-muted" style="margin-top:8px">LMS numbers update automatically. Assessment pass/fail uses each trainee\'s best attempt of the day. Trainers and admins taking tests are not counted.</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ---- WhatsApp text = header + auto (server) + manual (live) ----
  function formVals() {
    var v = {};
    FIELDS.forEach(function (f) { var el = $e("eod_" + f.k); v[f.k] = el ? el.value : ""; });
    return v;
  }

  function buildText() {
    var d = EOD.data;
    if (!d) return "";
    var mine = formVals();
    var others = (d.entries || []).filter(function (e) { return e.emp_id !== d.me; });
    var L = [];
    if (d.is_admin) L.push("*L&D Team – EOD Report : " + ddmmyyyy(d.date) + "*");
    else L.push("*EOD Update – " + d.my_name + " : " + ddmmyyyy(d.date) + "*");
    L.push("");
    L.push(d.auto_text);

    var wd = lines(mine.work_done);
    if (wd.length) {
      L.push(""); L.push("*✅ Work completed today*");
      wd.forEach(function (s, i) { L.push((i + 1) + ". " + s); });
    }
    var ip = lines(mine.in_progress);
    if (ip.length) {
      L.push(""); L.push("*🔄 In progress / pending*");
      ip.forEach(function (s) { L.push("• " + s); });
    }
    var team = others.filter(function (e) { return lines(e.work_done).length || lines(e.in_progress).length || lines(e.tomorrow_plan).length; });
    if (team.length) {
      L.push(""); L.push("*👥 Team updates*");
      team.forEach(function (e) {
        L.push("*" + e.name + "*");
        lines(e.work_done).forEach(function (s) { L.push("✅ " + s); });
        lines(e.in_progress).forEach(function (s) { L.push("🔄 " + s); });
        lines(e.tomorrow_plan).forEach(function (s) { L.push("📅 " + s); });
      });
    }
    var sup = lines(mine.support_needed).map(function (s) { return "• " + s; });
    others.forEach(function (e) { lines(e.support_needed).forEach(function (s) { sup.push("• " + s + " (" + e.name + ")"); }); });
    if (sup.length) { L.push(""); L.push("*🙋 Support needed*"); L = L.concat(sup); }
    var tp = lines(mine.tomorrow_plan);
    if (tp.length) {
      L.push(""); L.push("*📅 Tomorrow's plan*");
      tp.forEach(function (s) { L.push("• " + s); });
    }
    return L.join("\n");
  }

  function renderPreview() { var p = $e("eodPreview"); if (p) p.textContent = buildText(); }

  function renderTeam() {
    var d = EOD.data, card = $e("eodTeamCard"), box = $e("eodTeam");
    if (!card || !box) return;
    if (!d || !d.is_admin) { card.style.display = "none"; return; }
    card.style.display = "block";
    var st = d.team_status || [];
    var filled = st.filter(function (t) { return t.filled; }).length;
    box.innerHTML = (st.length
      ? '<div class="eod-muted" style="margin-bottom:8px">' + filled + " of " + st.length + " have filled their update</div>" +
        '<div class="eod-chips">' + st.map(function (t) {
          return '<span class="eod-chip ' + (t.filled ? "ok" : "no") + '">' + (t.filled ? "✅ " : "⏳ ") + escEod(t.name) + "</span>";
        }).join("") + "</div>"
      : '<div class="eod-muted">No trainers found.</div>');
  }

  function fillForm() {
    var d = EOD.data;
    var m = d.mine || {};
    FIELDS.forEach(function (f) {
      var el = $e("eod_" + f.k);
      if (el) { el.value = m[f.k] || ""; el.disabled = !d.can_edit; }
    });
    $e("eodSave").disabled = !d.can_edit;
    $e("eodFormTitle").textContent = "Your update — " + ddmmyyyy(d.date);
    $e("eodSaved").innerHTML = !d.can_edit
      ? '<span class="eod-warn">This date is closed for editing.</span>'
      : (m.updated_at ? "Last saved " + new Date(m.updated_at + "Z").toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "Not saved yet");
    var pv = $e("eodPrev");
    if (d.prev_plan && d.can_edit) {
      pv.innerHTML = '<div class="eod-prev"><b>Your plan from ' + escEod(ddmmyyyy(d.prev_plan.date)) + ":</b>" +
        "<pre>" + escEod(d.prev_plan.text) + "</pre>" +
        '<button class="eod-btn" onclick="window.__eodUsePrev()">➕ Add to "Work completed today"</button></div>';
    } else pv.innerHTML = "";
    EOD.dirty = false;
  }

  function load(silent) {
    var date = EOD.date || todayIst();
    return fetch("/api/eod/report?date=" + encodeURIComponent(date), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { $e("eodPreview").textContent = d.msg || "Could not load."; return; }
        EOD.data = d;
        EOD.date = d.date;
        $e("eodDate").value = d.date;
        $e("eodNext").disabled = (d.date >= d.today);
        $e("eodSub").textContent = d.is_admin ? "Full L&D report" : "Your trainer report";
        // never overwrite what someone is typing during the 30s auto-refresh
        // (and never wipe unsaved text when coming back to the tab)
        if (!((silent || EOD.dirty) && EOD.loadedFor === d.date)) fillForm();
        EOD.loadedFor = d.date;
        renderTeam();
        renderPreview();
      })
      .catch(function () { if (!silent) $e("eodPreview").textContent = "Could not load — check your connection."; });
  }

  function save(quiet) {
    if (!EOD.data || !EOD.data.can_edit) return Promise.resolve(false);
    var body = formVals(); body.date = EOD.date;
    return fetch("/api/eod/save", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        EOD.dirty = false;
        $e("eodSaved").textContent = "Saved just now";
        if (!quiet) toastEod(d.msg || "Saved.");
        return load(true).then(function () { return true; });
      }
      toastEod(d.msg || "Could not save."); return false;
    }).catch(function () { toastEod("Could not save — check your connection."); return false; });
  }

  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (res, rej) {
      var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? res() : rej(); } catch (e) { rej(e); }
      document.body.removeChild(ta);
    });
  }

  // ---- public hooks ----
  window.__eodDirty = function () {
    EOD.dirty = true;
    $e("eodSaved").innerHTML = '<span class="eod-warn">Unsaved changes</span>';
    renderPreview();
  };
  window.__eodGo = function (iso) {
    if (!iso) return;
    if (EOD.dirty && !confirm("You have unsaved changes. Leave this date without saving?")) {
      $e("eodDate").value = EOD.date; return;
    }
    var t = todayIst();
    EOD.date = iso > t ? t : iso;
    EOD.loadedFor = null;
    load(false);
  };
  window.__eodShift = function (n) { window.__eodGo(shiftDate(EOD.date || todayIst(), n)); };
  window.__eodSave = function () { save(false); };
  window.__eodReload = function () { load(true); };
  window.__eodUsePrev = function () {
    var d = EOD.data, el = $e("eod_work_done");
    if (!d || !d.prev_plan || !el) return;
    el.value = (el.value.trim() ? el.value.trim() + "\n" : "") + d.prev_plan.text.trim();
    window.__eodDirty();
  };
  window.__eodCopy = function () {
    var go = function () {
      copyText(buildText()).then(function () { toastEod("Copied — paste it in the WhatsApp group."); },
        function () { toastEod("Couldn't copy automatically — select the text and copy it."); });
    };
    if (EOD.dirty) save(true).then(go); else go();
  };
  window.__eodShare = function () {
    var go = function () { navigator.share({ text: buildText() }).catch(function () {}); };
    if (EOD.dirty) save(true).then(go); else go();
  };

  window.loadEod = function () {
    var root = $e("eodRoot");
    if (!root) return;
    if (!$e("eodPreview")) {
      root.innerHTML = shell();
      if (navigator.share) $e("eodShare").style.display = "";
    }
    load(!!window.__SILENT_REFRESH);
  };

  // warn before closing the page with unsaved text
  window.addEventListener("beforeunload", function (e) {
    if (EOD.dirty) { e.preventDefault(); e.returnValue = ""; }
  });
})();
