// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.1.1
// @description  Show product number (PROxxxxx) and audit maintenance descriptions in VTiger line items
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-meta-overlay.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-meta-overlay.user.js
// ==/UserScript==

(async function () {
  'use strict';

  /* ===============================
     MODULE DETECTION
     =============================== */

  const SUPPORTED_MODULES = [
    'Quotes',
    'SalesOrder',
    'Invoice',
    'PurchaseOrder',
    'Products'
  ];

  const isEdit =
    location.href.includes('view=Edit') &&
    new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`).test(location.href);

  const isDetail =
    location.href.includes('view=Detail') &&
    new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`).test(location.href);

  if (!isEdit && !isDetail) return;

  const currentModule =
    location.href.match(new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`))?.[1] || '';

  /* ===============================
     UTILITIES
     =============================== */

  const mem = new Map();
  const S = s => (s || '').toString().trim();

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  function getQuantity(tr, rn) {
    const q =
      tr.querySelector(`#qty${rn}`) ||
      tr.querySelector(`#quantity${rn}`) ||
      tr.querySelector(`input[name="qty${rn}"]`) ||
      tr.querySelector(`input[name="quantity${rn}"]`);

    const v = parseInt(q?.value, 10);
    return Number.isFinite(v) ? v : 0;
  }

  /* ===============================
     AUDITOR
     =============================== */

  function extractSerials(desc) {
    const out = [];
    const re = /S\/N:\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(desc))) {
      m[1]
        .split(/[,;\/]/)
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(sn => out.push(sn));
    }
    return [...new Set(out)];
  }

  function auditMaintenance(desc, qty, productName) {
    if (!desc) return "🔴 Wartung: Keine Beschreibung";

    const serials = extractSerials(desc);
    const hasStart = /Service\s+Start:/i.test(desc);
    const hasEnd = /Service\s+(Ende|End):/i.test(desc);
    const isFasAff = /\b(FAS|AFF|ASA)\d+/i.test(productName || '');

    if (currentModule === "Quotes" && (!hasStart || !hasEnd)) {
      return "🟡 Wartung: Quote (TBA ok)";
    }

    if (!serials.length) return "🟡 Wartung: Keine S/N";
    if (!hasStart || !hasEnd) return "🔴 Wartung: Fehlende Service-Daten";

    if (!(isFasAff && qty === 1) && serials.length !== qty) {
      return `🟡 Wartung: Quantity (${qty}) ≠ S/N (${serials.length})`;
    }

    return "🟢 Wartung: OK";
  }

  /* ===============================
     CORE: EDIT MODE (gekürzt)
     =============================== */

  async function processEdit() {
    const tbl = document.querySelector('#lineItemTab');
    if (!tbl) return;

    const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];

    for (const tr of rows) {
      const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');
      const desc = tr.querySelector('textarea[name*="comment"]')?.value || '';
      const qty = getQuantity(tr, rn);

      const productName =
        tr.querySelector(`#productName${rn}`)?.value ||
        tr.querySelector('input[id^="productName"]')?.value || '';

      const info =
        tr.querySelector('.vt-prodinfo') ||
        tr.querySelector('td')?.querySelector('.vt-prodinfo');

      if (!info) continue;

      let auditor = info.querySelector('.hw24-auditor');
      if (!auditor) {
        auditor = document.createElement('div');
        auditor.className = 'hw24-auditor';
        auditor.style.cssText = 'margin-top:4px;font-size:11px;font-weight:bold';
        info.appendChild(auditor);
      }

      auditor.textContent = auditMaintenance(desc, qty, productName);
    }
  }

  if (isEdit) {
    await processEdit();
    const rerun = debounce(processEdit, 700);
    const tbl = document.querySelector('#lineItemTab');
    if (tbl) new MutationObserver(rerun).observe(tbl, { childList: true, subtree: true });
  }

})();
