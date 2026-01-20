/*
 * VTiger Maintenance Description Auditor – Core v0.1
 * Loaded via Tampermonkey @require
 * Analysis-only (no auto-write)
 */

(() => {
  "use strict";

  console.log("[HW24] Maintenance Desc Auditor core v0.1 loaded");

  /***********************
   * CONFIG
   ***********************/
  const LANG = {
    de: {
      sn: "S/N",
      location: "Standort",
      incl: "inkl.:",
      serviceStart: "Service Start",
      serviceEnd: "Service Ende",
      tba: "tba",
    },
    en: {
      sn: "S/N",
      location: "Location",
      incl: "incl.:",
      serviceStart: "Service Start",
      serviceEnd: "Service End",
      tba: "tba",
    }
  };

  let currentLanguage = "de";

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

  function normalizeColonSpacing(text) {
    return text.replace(/\s*:\s*/g, ": ");
  }

  function normalizeSerialList(raw) {
    return [...new Set(
      raw
        .split(/[,;\/\n]+/)
        .map(s => s.trim())
        .filter(Boolean)
    )].join(", ");
  }

  function extractSerials(text) {
    const serials = [];
    const re = /S\/N:\s*([A-Z0-9,\s\-\/;]+)/gi;
    let m;
    while ((m = re.exec(text))) {
      normalizeSerialList(m[1])
        .split(", ")
        .forEach(sn => serials.push(sn));
    }
    return [...new Set(serials)];
  }

  function extractServiceDate(text, type) {
    const re = new RegExp(
      `Service\\s+${type}:\\s*(\\d{2}\\.\\d{2}\\.\\d{4}|tba|\\[nicht angegeben\\])`,
      "i"
    );
    const m = text.match(re);
    return m ? m[1] : null;
  }

  function isFasAff(productName = "") {
    return /\b(FAS|AFF|ASA)\d+/i.test(productName);
  }

  /***********************
   * PARSER
   ***********************/
  function parseDescription(desc, productName, quantity) {
    const normalized = normalizeColonSpacing(desc);

    const serials = extractSerials(normalized);
    const serviceStart = extractServiceDate(normalized, "Start");
    const serviceEnd = extractServiceDate(normalized, "(Ende|End)");

    const qtyCheck = (() => {
      if (!serials.length) return { status: "ignored", reason: "no serials" };
      if (isFasAff(productName) && quantity === 1 && serials.length > 1) {
        return { status: "ok", reason: "FAS/AFF exception" };
      }
      if (serials.length !== quantity) {
        return { status: "warn", reason: `Qty ${quantity} ≠ S/N ${serials.length}` };
      }
      return { status: "ok", reason: "match" };
    })();

    return { serials, serviceStart, serviceEnd, qtyCheck };
  }

  /***********************
   * UI
   ***********************/
  function buildBadge(result, moduleName) {
    if (moduleName === "Quote" && (!result.serviceStart || !result.serviceEnd)) {
      return "🟡 Quote (TBA ok)";
    }
    if (!result.serviceStart || !result.serviceEnd) {
      return "🔴 Missing dates";
    }
    if (result.qtyCheck.status === "warn") {
      return "🟡 Qty mismatch";
    }
    return "🟢 OK";
  }

  function injectRowUI(container, parsed, moduleName) {
    const badge = document.createElement("div");
    badge.style.marginTop = "4px";
    badge.style.fontSize = "11px";
    badge.textContent = buildBadge(parsed, moduleName);
    container.appendChild(badge);
  }

  /***********************
   * MAIN
   ***********************/
  function run() {
    if (!isEditMode()) return;

    const moduleName = detectModule();
    if (moduleName === "Unknown") return;

    console.log("[HW24] Auditor running in", moduleName);

    const rows = $$("tr.lineItemRow");
    if (!rows.length) return;

    rows.forEach(row => {
      const descEl = row.querySelector("textarea[name*='comment']");
      const qtyEl = row.querySelector("input[name*='quantity']");
      const nameEl = row.querySelector("input[name*='productName']");

      if (!descEl || !qtyEl) return;

      // einfache Wartungs-Erkennung (v0.1)
      if (!/wartung/i.test(row.innerText)) return;

      const parsed = parseDescription(
        descEl.value || "",
        nameEl ? nameEl.value : "",
        parseInt(qtyEl.value, 10) || 0
      );

      injectRowUI(descEl.parentElement, parsed, moduleName);
    });
  }

  run();
})();
