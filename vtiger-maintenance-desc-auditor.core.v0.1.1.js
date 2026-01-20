/*
 * VTiger Maintenance Description Auditor – Core v0.1.4
 * Compatible with HW24 LineItem Meta Overlay
 * Analysis-only (no auto-write)
 */

(() => {
  "use strict";

  console.log("[HW24] Maintenance Desc Auditor core v0.1.4 loaded");

  const AUDITOR_CLASS = "hw24-maint-auditor";

  function ensureAuditorContainer(td) {
    let c = td.querySelector(`.${AUDITOR_CLASS}`);
    if (!c) {
      c = document.createElement("div");
      c.className = AUDITOR_CLASS;
      c.style.cssText = `
        margin-top:6px;
        font-size:12px;
        font-weight:bold;
        padding:2px 6px;
        background:#eef2ff;
        border:1px solid #c7d2fe;
        display:inline-block;
      `;
      td.appendChild(c);
    }
    return c;
  }

  function analyze(desc) {
    if (!desc) return "🔴 Keine Beschreibung";

    const sn = desc.match(/S\/N:/i);
    const start = desc.match(/Service\s+Start:/i);
    const end = desc.match(/Service\s+(Ende|End):/i);

    if (!sn) return "🟡 Keine S/N";
    if (!start || !end) return "🟡 Fehlende Service-Daten";
    return "🟢 OK";
  }

  function scan() {
    const rows = document.querySelectorAll(
      "#lineItemTab tr.lineItemRow, #lineItemTab tr.inventoryRow"
    );

    rows.forEach(tr => {
      const desc =
        tr.querySelector('textarea[name*="comment"]')?.value || "";

      const nameCell =
        tr.querySelector('input[id^="productName"]')?.closest("td") ||
        tr.querySelector('a[href*="module=Products"]')?.closest("td");

      if (!nameCell) return;

      const auditor = ensureAuditorContainer(nameCell);
      auditor.textContent = analyze(desc);
    });
  }

  // Initial run
  scan();

  // Re-run whenever Meta Overlay or VTiger re-renders
  const tbl = document.querySelector("#lineItemTab");
  if (tbl) {
    const obs = new MutationObserver(() => scan());
    obs.observe(tbl, { childList: true, subtree: true });
  }

  console.log("[HW24] Maintenance Desc Auditor observer active");
})();
