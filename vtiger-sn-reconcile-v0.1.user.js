// ==UserScript==
// @name         VTiger SN Reconciliation v0.1 (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.1.0
// @description  Compare serial number Soll-Liste with existing line items using Product+SLA+Country+Service Start/End. Highlight inconsistencies and provide undo. Analysis only.
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /* ===============================
     MODE CHECK
     =============================== */

  if (
    !location.href.includes('view=Edit') ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* ===============================
     UTILITIES
     =============================== */

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const T = s => (s || '').toString().trim();
  const norm = s => T(s).toLowerCase().replace(/\s+/g, '');

  function parseDate(s) {
    const m = T(s).match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!m) return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  function extract(regex, text) {
    const m = T(text).match(regex);
    return m ? T(m[1]) : '';
  }

  function extractSerialNumbers(desc) {
    const m = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
    if (!m) return [];
    return m[1]
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function getProductKey(li) {
    const desc = li.desc;
    return [
      norm(li.product),
      norm(li.sla),
      norm(li.country),
      parseDate(li.serviceStart),
      parseDate(li.serviceEnd)
    ].join('|');
  }

  /* ===============================
     STATE / UNDO
     =============================== */

  let BACKUP = null;

  function snapshot() {
    BACKUP = $$('#lineItemTab textarea, #lineItemTab input').map(el => ({
      el,
      value: el.value
    }));
  }

  function undo() {
    if (!BACKUP) return;
    BACKUP.forEach(x => x.el.value = x.value);
    clearHighlights();
    alert('Undo durchgeführt');
  }

  /* ===============================
     LINE ITEM EXTRACTION
     =============================== */

  function extractLineItems() {
    const rows = $$('tr.lineItemRow[id^="row"], tr.inventoryRow');
    return rows.map(tr => {
      const td = tr.querySelector('td');
      const descEl = tr.querySelector('textarea[name*="description"], textarea');
      const qtyEl = tr.querySelector('input[name^="qty"]');

      const desc = descEl ? descEl.value : '';

      const li = {
        tr,
        td,
        product: T(td?.innerText),
        desc,
        qty: qtyEl ? Number(qtyEl.value) : 0,
        serials: extractSerialNumbers(desc),
        serviceStart: extract(/Service\s*Start\s*:\s*([^\n\r]+)/i, desc),
        serviceEnd: extract(/Service\s*(?:Ende|End)\s*:\s*([^\n\r]+)/i, desc),
        sla: extract(/SLA\s*:\s*([^\n\r]+)/i, desc),
        country: extract(/Country\s*:\s*([^\n\r]+)/i, desc)
      };

      li.key = getProductKey(li);
      return li;
    });
  }

  /* ===============================
     HIGHLIGHTING
     =============================== */

  function mark(li, color, title) {
    li.td.style.outline = `3px solid ${color}`;
    li.td.title = title;
  }

  function clearHighlights() {
    $$('tr.lineItemRow td, tr.inventoryRow td').forEach(td => {
      td.style.outline = '';
      td.title = '';
    });
  }

  /* ===============================
     UI PANEL
     =============================== */

  function showPanel() {
    if ($('#hw24-sn-panel')) return;

    const p = document.createElement('div');
    p.id = 'hw24-sn-panel';
    p.style.cssText = `
      position:fixed;
      left:16px;
      bottom:16px;
      z-index:999999;
      background:#111;
      color:#fff;
      padding:12px;
      width:360px;
      border-radius:10px;
      font:13px system-ui;
      box-shadow:0 6px 20px rgba(0,0,0,.4)
    `;

    p.innerHTML = `
      <b>SN-Abgleich (v0.1)</b><br><br>
      <textarea id="hw24-sn-input" placeholder="Soll-Seriennummern (eine pro Zeile)" style="width:100%;height:120px"></textarea>
      <br><br>
      <button id="hw24-sn-run">🔍 Analysieren</button>
      <button id="hw24-sn-undo">↩ Undo</button>
      <button id="hw24-sn-clear">🧹 Clear</button>
      <div id="hw24-sn-result" style="margin-top:8px;font-size:12px;opacity:.9"></div>
    `;

    p.querySelectorAll('button').forEach(b => {
      b.style.cssText = 'margin-right:6px;margin-top:6px;cursor:pointer';
    });

    document.body.appendChild(p);

    $('#hw24-sn-run').onclick = runAnalysis;
    $('#hw24-sn-undo').onclick = undo;
    $('#hw24-sn-clear').onclick = clearHighlights;
  }

  /* ===============================
     CORE ANALYSIS
     =============================== */

  function runAnalysis() {
    snapshot();
    clearHighlights();

    const soll = $('#hw24-sn-input').value
      .split(/\n+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (!soll.length) {
      alert('Bitte Soll-Seriennummern eingeben');
      return;
    }

    const items = extractLineItems();

    const snMap = new Map();
    items.forEach(li => {
      li.serials.forEach(sn => snMap.set(sn, li));
    });

    let ok = 0, warn = 0, crit = 0;

    items.forEach(li => {
      if (!li.serials.length) {
        mark(li, 'orange', 'Produkt ohne Seriennummern');
        warn++;
      } else if (li.serials.length !== li.qty) {
        mark(li, 'gold', 'Quantity ≠ Anzahl Seriennummern');
        warn++;
      } else {
        mark(li, 'limegreen', 'OK');
        ok++;
      }
    });

    soll.forEach(sn => {
      if (!snMap.has(sn)) crit++;
    });

    $('#hw24-sn-result').textContent =
      `OK: ${ok} · Warnungen: ${warn} · Fehlende SN: ${crit}`;
  }

  /* ===============================
     BOOTSTRAP
     =============================== */

  showPanel();

})();
