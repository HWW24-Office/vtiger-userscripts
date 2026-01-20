/*
 * VTiger Maintenance Description Auditor – Core v0.1.2
 * Loaded via Tampermonkey @require
 * Analysis-only (no auto-write)
 */

(() => {
  "use strict";

  console.log("[HW24] Maintenance Desc Auditor core v0.1.2 loaded");

  /***********************
   * HELPERS
   ***********************/
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function detectModule() {
    const url = location.href.toLowerCase();
    if (url.includes("module=quotes")) return "Quote";
    if (url.includes("module=salesorder")) return "SalesOrder";
    if (url.includes("module=purchaseorder")) return "PurchaseOrder";
    if (url.includes("module=invoice")) return "Invoice";
    if (url.includes("module=products")) return "Products";
    return "Unknown";
  }

  function isEditMode() {
    return /view=edit/i.test(location.href);
  }

  function extractSerials(text) {
    const re = /S\/N:\s*([^\n]+)/gi;
    const serials = [];
    let m;
    while ((m = re.exec(text))) {
      m[1]
        .split(/[,;\/]/)
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(sn => serials.push(sn));
    }
    return [...new Set(serials)];
  }

  /***********************
   * UI
   ***********************/
  function injectBadge(descEl, text) {
    const badge = document.createElement("div");
    badge.textContent = text;
    badge.style.marginTop = "6px";
    badge.style.padding = "4px 6px";
    badge.style.fontSize = "12px";
    badge.style.fontWeight = "bold";
    badge.style.background = "#fffae6";
    badge.style.border = "1px solid #e0c97f";
    badge.style.display = "inline-block";

    descEl.closest("td").appendChild(badge);
  }

  /***********************
   * MAIN
   ***********************/
  function run() {
    if (!isEditMode()) return;

    const moduleName = detectModule();
    console.log("[HW24] Auditor running in", moduleName);

    // EXTREM robust: finde jede Description-Textarea
    const descFields = $$("textarea[name*='comment']");

    console.log("[HW24] Found description fields:", descFields.length);

    descFields.forEach((descEl, idx) => {
      const text = descEl.value || "";
      const serials = extractSerials(text);

      console.log(`[HW24] Row ${idx + 1}`, { serials });

      injectBadge(
        descEl,
        serials.length
          ? `🧪 TEST Badge – ${serials.length} S/N erkannt`
          : `🧪 TEST Badge – keine S/N erkannt`
      );
    });
  }

  run();
})();
