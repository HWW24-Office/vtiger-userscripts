// ==UserScript==
// @name         VTiger SN Reconciliation v0.2.1 (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.2.1
// @description  Serial number reconciliation with guided assignment dialog and NetApp FAS HA logic. Edit mode only. Includes highlighting and undo.
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  /* ===============================
     MODE CHECK
     =============================== */

  if (
    !location.href.includes('view=Edit') ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* ===============================
     BASIC UTILS
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

  function extract(rx, txt) {
    const m = T(txt).match(rx);
    return m ? T(m[1]) : '';
  }

  function extractSN(desc) {
    const m = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
    if (!m) return [];
    return m[1].split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  }

  /* ===============================
     PRODUCT META (Manufacturer)
     =============================== */

  const META_CACHE = new Map();

  async function getManufacturer(productId) {
    if (!productId) return '';
    if (META_CACHE.has(productId)) return META_CACHE.get(productId);

    try {
      const url = `index.php?module=Products&view=Detail&record=${productId}`;
      const html = await fetch(url, { credentials: 'same-origin' }).then(r => r.text());
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const labels = [...doc.querySelectorAll('[id^="Products_detailView_fieldLabel_"]')];
      const lab = labels.find(l => /manufacturer/i.test(l.textContent));
      let val = '';

      if (lab) {
        const v = doc.getElementById(lab.id.replace('fieldLabel', 'fieldValue'));
        val = T(v ? v.textContent : '');
      }

      META_CACHE.set(productId, val);
      return val;
    } catch {
      return '';
    }
  }

  function isNetAppFAS(manufacturer, productName) {
    return (
      norm(manufacturer) === 'netapp' &&
      /(fas|aff)/i.test(productName)
    );
  }

  /* ===============================
     UNDO SNAPSHOT
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

  async function extractLineItems() {
    const rows = $$('tr.lineItemRow[id^="row"], tr.inventoryRow');
    const out = [];

    for (const tr of rows) {
      const td = tr.querySelector('td');
      const descEl = tr.querySelector('textarea[name*="description"], textarea');
      const qtyEl = tr.querySelector('input[name^="qty"]');
      const hid = tr.querySelector('input[name*="productid"]');

      const desc = descEl ? descEl.value : '';
      const productName = T(td?.innerText || '');

      const li = {
        tr,
        td,
        productName,
        productId: hid ? hid.value : '',
        desc,
        qty: qtyEl ? Number(qtyEl.value) : 0,
        serials: extractSN(desc),
        serviceStart: extract(/Service\s*Start\s*:\s*([^\n\r]+)/i, desc),
        serviceEnd: extract(/Service\s*(?:Ende|End)\s*:\s*([^\n\r]+)/i, desc),
        sla: extract(/SLA\s*:\s*([^\n\r]+)/i, desc),
        country: extract(/Country\s*:\s*([^\n\r]+)/i, desc),
        manufacturer: ''
      };

      li.manufacturer = await getManufacturer(li.productId);

      li.key = [
        norm(li.productName),
        norm(li.sla),
        norm(li.country),
        parseDate(li.serviceStart),
        parseDate(li.serviceEnd)
      ].join('|');

      out.push(li);
    }

    return out;
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
      width:380px;
      border-radius:10px;
      font:13px system-ui;
      box-shadow:0 6px 20px rgba(0,0,0,.4)
    `;

    p.innerHTML = `
      <b>SN-Abgleich v0.2.1</b><br><br>
      <textarea id="hw24-sn-input"
        placeholder="Soll-Seriennummern (eine pro Zeile)"
        style="width:100%;height:120px;color:#000;background:#fff"></textarea>
      <br><br>
      <button id="hw24-sn-run">🔍 Analysieren</button>
      <button id="hw24-sn-assign">➕ Zuordnen</button>
      <button id="hw24-sn-undo">↩ Undo</button>
      <button id="hw24-sn-clear">🧹 Clear</button>
      <div id="hw24-sn-result" style="margin-top:8px;font-size:12px;opacity:.9"></div>
    `;

    p.querySelectorAll('button').forEach(b => {
      b.style.cssText = 'margin-right:6px;margin-top:6px;cursor:pointer';
    });

    document.body.appendChild(p);

    $('#hw24-sn-run').onclick = runAnalysis;
    $('#hw24-sn-assign').onclick = runAssignment;
    $('#hw24-sn-undo').onclick = undo;
    $('#hw24-sn-clear').onclick = clearHighlights;
  }

  /* ===============================
     ANALYSIS
     =============================== */

  let LAST_STATE = null;

  async function runAnalysis() {
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

    const items = await extractLineItems();

    const snToItems = new Map();
    items.forEach(li => {
      li.serials.forEach(sn => {
        if (!snToItems.has(sn)) snToItems.set(sn, []);
        snToItems.get(sn).push(li);
      });
    });

    const unassigned = [];
    soll.forEach(sn => {
      if (!snToItems.has(sn)) unassigned.push(sn);
    });

    let ok = 0, warn = 0, crit = 0;

    items.forEach(li => {
      const isFAS = isNetAppFAS(li.manufacturer, li.productName);
      const expectedQty = isFAS
        ? Math.ceil(li.serials.length / 2)
        : li.serials.length;

      if (!li.serials.length) {
        mark(li, 'orange', 'Produkt ohne Seriennummern');
        warn++;
      } else if (li.qty !== expectedQty) {
        mark(
          li,
          isFAS ? 'gold' : 'yellow',
          isFAS
            ? `NetApp FAS: ${li.serials.length} SN → Qty ${expectedQty}`
            : 'Quantity ≠ Seriennummern'
        );
        warn++;
      } else {
        mark(li, 'limegreen', 'OK');
        ok++;
      }
    });

    snToItems.forEach((arr, sn) => {
      if (arr.length > 1) {
        arr.forEach(li => mark(li, 'purple', `SN ${sn} mehrfach verwendet`));
        warn++;
      }
    });

    LAST_STATE = { items, unassigned };

    $('#hw24-sn-result').textContent =
      `OK: ${ok} · Warnungen: ${warn} · Unzugeordnet: ${unassigned.length}`;
  }

  /* ===============================
     ASSIGNMENT DIALOG
     =============================== */

  function runAssignment() {
    if (!LAST_STATE || !LAST_STATE.unassigned.length) {
      alert('Keine unzugeordneten Seriennummern');
      return;
    }

    const items = LAST_STATE.items;
    const unassigned = LAST_STATE.unassigned;

    const choices = items.map((li, i) =>
      `${i + 1}: ${li.productName} | ${li.sla || '-'} | ${li.country || '-'} | ${li.serviceStart} – ${li.serviceEnd}`
    ).join('\n');

    const pick = prompt(
      `Unzugeordnete Seriennummern:\n${unassigned.join(', ')}\n\n` +
      `Zu welchem Produkt zuordnen? (Nummer eingeben)\n\n${choices}`
    );

    const idx = Number(pick) - 1;
    if (!items[idx]) return;

    const target = items[idx];
    const descEl = target.tr.querySelector('textarea[name*="description"], textarea');
    if (!descEl) return;

    let desc = descEl.value.trim();
    const existing = new Set(target.serials);

    unassigned.forEach(sn => existing.add(sn));

    desc = desc.replace(/S\/N\s*:\s*[^\n\r]+/i, '').trim();
    desc += `\nS/N: ${[...existing].join(', ')}`;

    descEl.value = desc;
    alert(`Seriennummern zugeordnet: ${unassigned.join(', ')}`);
  }

  /* ===============================
     BOOT
     =============================== */

  showPanel();

})();
