/* ============================================================
   ui-busy.js — global "Please wait…" button state
   ------------------------------------------------------------
   When any action button is clicked, it immediately disables
   itself and shows "Please wait…" so the user knows the click
   registered and can't double-click (which caused duplicate
   submissions). It auto-restores shortly after, or sooner if
   the button is re-rendered by the action.

   Works for the inline onclick="..." buttons used across the
   admin and learner portals without editing each one.
   ============================================================ */
(function () {
  "use strict";

  // Buttons we should NOT busy-lock (they don't submit anything):
  //  - type=button used purely to toggle UI? we still lock briefly; harmless.
  // We skip: links styled as buttons handled elsewhere, and the star-rating
  // spans (they aren't <button>). Only real <button> elements are handled.
  var BUSY_MS = 2000;       // how long the button stays "Please wait…"
  var BUSY_LABEL = "Please wait…";

  // actions that should NOT be locked (pure navigation / toggles that must
  // stay instantly clickable). Match by the onclick text.
  var SKIP_PATTERNS = [
    "switchTab(", "showTab(", "__anView(", "__anRange(",
    "goHome(", "loadAssessments(", "closeFileModule(", "closeEdit",
    "closeModal", "openModal", "filterQuestions(", "renderTable(",
    "window.print("
  ];

  function shouldSkip(btn) {
    // never lock a button that only opens/closes a view or switches tabs
    var oc = btn.getAttribute("onclick") || "";
    for (var i = 0; i < SKIP_PATTERNS.length; i++) {
      if (oc.indexOf(SKIP_PATTERNS[i]) >= 0) return true;
    }
    // don't double-handle an already-busy button
    if (btn.getAttribute("data-busy") === "1") return true;
    // don't lock disabled buttons
    if (btn.disabled) return true;
    return false;
  }

  function setBusy(btn) {
    btn.setAttribute("data-busy", "1");
    btn.setAttribute("data-prev-html", btn.innerHTML);
    btn.setAttribute("data-prev-disabled", btn.disabled ? "1" : "0");
    // keep the button width stable so the layout doesn't jump
    try {
      var w = btn.offsetWidth;
      if (w) btn.style.minWidth = w + "px";
    } catch (e) {}
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.style.cursor = "progress";
    btn.innerHTML = BUSY_LABEL;

    var restore = function () {
      // if the button was removed/replaced by the action, nothing to do
      if (!btn || !btn.isConnected) return;
      btn.innerHTML = btn.getAttribute("data-prev-html") || btn.innerHTML;
      btn.disabled = (btn.getAttribute("data-prev-disabled") === "1");
      btn.style.opacity = "";
      btn.style.cursor = "";
      btn.style.minWidth = "";
      btn.removeAttribute("data-busy");
      btn.removeAttribute("data-prev-html");
      btn.removeAttribute("data-prev-disabled");
    };
    setTimeout(restore, BUSY_MS);
  }

  // Bubble phase (not capture), and defer the disable by a tick so the
  // button's own onclick fires FIRST (a disabled button won't fire click).
  document.addEventListener("click", function (ev) {
    var el = ev.target;
    // climb up to the nearest <button>
    while (el && el !== document && el.tagName !== "BUTTON") {
      el = el.parentNode;
    }
    if (!el || el.tagName !== "BUTTON") return;
    if (shouldSkip(el)) return;
    // defer so the real action starts before we grey out the button
    setTimeout(function () {
      if (el && el.isConnected && el.getAttribute("data-busy") !== "1" && !el.disabled) {
        setBusy(el);
      }
    }, 0);
  }, false);
})();
