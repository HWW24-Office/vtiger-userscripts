// ==UserScript==
// @name         VTiger LineItem Price Multiplier
// @namespace    hw24.vtiger.lineitem.multiplier
// @version      1.1.0
// @description  Multiplies Purchase Cost by a factor and updates Selling Price per line item in SalesOrder, Quote and Invoice edit views
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ✅ Nur relevante Module im Edit-Modus
  const isEdit =
    location.href.includes('view=Edit') &&
    (
      location.href.includes('module=SalesOrder') ||
      location.href.includes('module=Quotes') ||
      location.href.includes('module=Invoice')
    );

  if (!isEdit) return;

  /* ===== Hilfsfunktionen ===== */
  function parseNum(v) {
    if (v == null) return NaN;
    return parseFloat(v.toString().replace(',', '.'));
  }

  function fireChange(el) {
    el && el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ===== Hauptlogik ===== */
  function runMultiplier() {
    const raw = prompt(
      'Multiplikator eingeben (z. B. 1.77):',
      '1.77'
    );

    const multiplier = parseNum(raw);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      alert('Ungültiger Multiplikator');
      return;
    }

    let updated = 0;

    document.querySelectorAll('tr.lineItemRow').forEach(row => {
      const pc  = row.querySelector("input[name^='purchaseCost']");
      const sp  = row.querySelector("input[name^='listPrice']");
      const qty = row.querySelector("input[name^='qty']");

      if (!pc || !sp || !qty) return;

      const purchaseCost = parseNum(pc.value);
      const quantity     = parseNum(qty.value);

      if (
        !Number.isFinite(purchaseCost) ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return;
      }

      // gleiche Formel wie im Bookmarklet
      const sellingPrice =
        Math.round((purchaseCost * multiplier / quantity) * 10) / 10;

      sp.value = sellingPrice.toFixed(1);
      fireChange(sp);

      updated++;
    });

    alert(`Fertig ✅\n${updated} Position(en) aktualisiert`);
  }

  /* ===== Button ===== */
  function addButton() {
    if (document.getElementById('hw24-multiplier-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'hw24-multiplier-btn';
    btn.type = 'button';
    btn.textContent = 'HW24 Preis × Faktor';
    btn.style.cssText =
      'margin-left:8px;background:#1f6feb;color:#fff;border:0;padding:6px 12px;border-radius:4px;cursor:pointer;';

    btn.onclick = runMultiplier;

    const target =
      document.querySelector('.btn-toolbar') ||
      document.querySelector('.editViewHeader');

    target && target.appendChild(btn);
  }

  new MutationObserver(addButton)
    .observe(document.body, { childList: true, subtree: true });
})();
