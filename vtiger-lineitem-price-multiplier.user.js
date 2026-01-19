// ==UserScript==
// @name         VTiger LineItem Price Multiplier
// @namespace    hw24.vtiger.lineitem.multiplier
// @version      1.2.0
// @description  Multiply or divide Selling Prices based on Purchase Cost, Qty and factor with undo support
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const isEdit =
    location.href.includes('view=Edit') &&
    (
      location.href.includes('module=SalesOrder') ||
      location.href.includes('module=Quotes') ||
      location.href.includes('module=Invoice')
    );

  if (!isEdit) return;

  /* ===== Helpers ===== */
  const parseNum = v =>
    v == null ? NaN : parseFloat(v.toString().replace(',', '.'));

  const fireChange = el =>
    el && el.dispatchEvent(new Event('change', { bubbles: true }));

  const parseFactor = raw => {
    if (!raw) return null;
    raw = raw.trim().replace(',', '.');

    const isDiv = raw.startsWith('/');
    raw = raw.replace(/^[*/]/, '');

    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;

    return isDiv ? 1 / n : n;
  };

  /* ===== Core ===== */
  function runMultiplier() {
    const input = prompt(
      'Faktor eingeben:\n\n' +
      '• 1.77  oder *1.77  → multiplizieren\n' +
      '• /3               → dividieren',
      '1.77'
    );

    const factor = parseFactor(input);
    if (!factor) {
      alert('Ungültiger Faktor');
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
      ) return;

      // Originalwert merken (nur einmal)
      if (!sp.dataset.hw24Orig) {
        sp.dataset.hw24Orig = sp.value;
      }

      const sellingPrice =
        Math.round((purchaseCost * factor / quantity) * 10) / 10;

      sp.value = sellingPrice.toFixed(1);
      fireChange(sp);
      updated++;
    });

    alert(`Fertig ✅\n${updated} Position(en) aktualisiert`);
  }

  /* ===== Undo ===== */
  function undoChanges() {
    let restored = 0;

    document.querySelectorAll("input[name^='listPrice']").forEach(sp => {
      if (sp.dataset.hw24Orig != null) {
        sp.value = sp.dataset.hw24Orig;
        delete sp.dataset.hw24Orig;
        fireChange(sp);
        restored++;
      }
    });

    alert(`Undo abgeschlossen ↩️\n${restored} Position(en) zurückgesetzt`);
  }

  /* ===== Button ===== */
  function addButton() {
    if (document.getElementById('hw24-multiplier-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'hw24-multiplier-btn';
    btn.type = 'button';
    btn.textContent = 'HW24 Preis × / Faktor';
    btn.style.cssText =
      'margin-left:8px;background:#1f6feb;color:#fff;border:0;padding:6px 12px;border-radius:4px;cursor:pointer;';

    btn.onclick = runMultiplier;

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.textContent = 'Undo';
    undoBtn.style.cssText =
      'margin-left:4px;background:#555;color:#fff;border:0;padding:6px 10px;border-radius:4px;cursor:pointer;';

    undoBtn.onclick = undoChanges;

    const target =
      document.querySelector('.btn-toolbar') ||
      document.querySelector('.editViewHeader');

    if (target) {
      target.appendChild(btn);
      target.appendChild(undoBtn);
    }
  }

  new MutationObserver(addButton)
    .observe(document.body, { childList: true, subtree: true });
})();
