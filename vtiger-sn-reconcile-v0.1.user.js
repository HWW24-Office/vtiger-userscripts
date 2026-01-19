// ==UserScript==
// @name         VTiger SN Reconciliation v0.2.2 (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.2.2
// @description  Serial number reconciliation with guided assignment, NetApp FAS HA logic, automatic quantity update, fixed description order and color legend.
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  if (
    !location.href.includes('view=Edit') ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* ===============================
     Utils
     =============================== */

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const T = s => (s || '').toString().trim();
  const norm = s => T(s).toLowerCase().replace(/\s+/g, '');

  const parseDate = s => {
    const m = T(s).match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  };

  const extract = (rx, txt) => {
    const m = T(txt).match(rx);
    return m ? T(m[1]) : '';
  };

  const extractSN = desc => {
    const m = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
    return m ? m[1].split(/[,;\n]+/).map(s => s.trim()).filter(Boolean) : [];
  };

  /* ===============================
     Manufacturer lookup
     =============================== */

  const META = new Map();

  async function getManufacturer(productId) {
    if (!productId) return '';
    if (META.has(productId)) return META.get(productId);

    try {
      const html = await fetch(
        `index.php?module=Products&view=Detail&record=${productId}`,
        { credentials: 'same-origin' }
      ).then(r => r.text());

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const lab = [...doc.querySelectorAll('[id^="Products_detailView_fieldLabel_"]')]
        .find(l => /manufacturer/i.test(l.textContent));

      let val = '';
      if (lab) {
        const v = doc.getElementById(lab.id.replace('fieldLabel', 'fieldValue'));
        val = T(v ? v.textContent : '');
      }

      META.set(productId, val);
      return val;
    } catch {
      return '';
    }
  }

  const isNetAppFAS = (manufacturer, productName) =>
    norm(manufacturer) === 'netapp' && /(fas|aff)/i.test(productName);

  /* ===============================
     Undo
     =============================== */

  let BACKUP = null;

  const snapshot = () => {
    BACKUP = $$('#lineItemTab textarea, #lineItemTab input').map(el => ({
      el, value: el.value
    }));
  };

  const undo = () => {
    if (!BACKUP) return;
    BACKUP.forEach(x => x.el.value = x.value);
    clearHighlights();
    alert('Undo durchgeführt');
  };

  /* ===============================
     Highlighting
     =============================== */

  const mark = (li, color, title) => {
    li.td.style.outline = `3px solid ${color}`;
    li.td.title = title;
  };

  const clearHighlights = () => {
    $$('tr.lineItemRow td, tr.inventoryRow td').forEach(td => {
      td.style.outline = '';
      td.title = '';
    });
  };

  /* ===============================
     Extract Line Items
     =============================== */

  async function extractLineItems() {
    const rows = $$('tr.lineItemRow[id^="row"], tr.inventoryRow');
    const out = [];

    for (const tr of rows) {
      const td = tr.querySelector('td');
      const descEl = tr.querySelector('textarea');
      const qtyEl = tr.querySelector('input[name^="qty"]');
      const hid = tr.querySelector('input[name*="productid"]');

      const desc = descEl ? descEl.value : '';
      const productName = T(td?.innerText || '');

      const li = {
        tr,
        td,
        productName,
        productId: hid?.value || '',
        desc,
        qtyEl,
        qty: qtyEl ? Number(qtyEl.value) : 0,
        serials: extractSN(desc),
        serviceStart: extract(/Service\s*Start\s*:\s*([^\n\r]+)/i, desc),
        serviceEnd: extract(/Service\s*(?:Ende|End)\s*:\s*([^\n\r]+)/i, desc),
        manufacturer: await getManufacturer(hid?.value || '')
      };

      out.push(li);
    }

    return out;
  }

  /* ===============================
     Description rebuild
     =============================== */

  function rebuildDescription(li, newSerials) {
    const lines = li.desc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const rest = lines.filter(l =>
      !/^S\/N\s*:/i.test(l) &&
      !/^Service\s*Start\s*:/i.test(l) &&
      !/^Service\s*(Ende|End)\s*:/i.test(l)
    );

    const out = [];
    out.push(`S/N: ${newSerials.join(', ')}`);
    out.push(...rest);
    if (li.serviceStart) out.push(`Service Start: ${li.serviceStart}`);
    if (li.serviceEnd) out.push(`Service End: ${li.serviceEnd}`);

    return out.join('\n');
  }

  /* ===============================
     UI Panel
     =============================== */

  function showPanel() {
    if ($('#hw24-sn-panel')) return;

    const p = document.createElement('div');
    p.id = 'hw24-sn-panel';
    p.style.cssText = `
      position:fixed;left:16px;bottom:16px;z-index:999999;
      background:#111;color:#fff;padding:12px;width:420px;
      border-radius:10px;font:13px system-ui;
      box-shadow:0 6px 20px rgba(0,0,0,.4)
    `;

    p.innerHTML = `
      <b>SN-Abgleich v0.2.2</b><br><br>
      <textarea id="hw24-sn-input"
        placeholder="Soll-Seriennummern (eine pro Zeile)"
        style="width:100%;height:120px;color:#000;background:#fff"></textarea>

      <div style="margin-top:8px">
        <button id="hw24-run">🔍 Analysieren</button>
        <button id="hw24-assign">➕ Zuordnen</button>
        <button id="hw24-undo">↩ Undo</button>
        <button id="hw24-clear">🧹 Clear</button>
      </div>

      <div id="hw24-sn-result" style="margin-top:8px"></div>

      <div style="margin-top:10px;font-size:12px">
        <b>Legende</b><br>
        🟢 OK<br>
        🟡 NetApp FAS (HA)<br>
        🟠 Ohne Seriennummern<br>
        🔴 Unzugeordnet<br>
        🟣 Mehrfach verwendet
      </div>
    `;

    document.body.appendChild(p);

    $('#hw24-run').onclick = runAnalysis;
    $('#hw24-assign').onclick = runAssignment;
    $('#hw24-undo').onclick = undo;
    $('#hw24-clear').onclick = clearHighlights;
  }

  /* ===============================
     Analysis & Assignment
     =============================== */

  let STATE = null;

  async function runAnalysis() {
    snapshot();
    clearHighlights();

    const soll = $('#hw24-sn-input').value
      .split(/\n+/).map(s => s.trim()).filter(Boolean);

    if (!soll.length) {
      alert('Bitte Soll-Seriennummern eingeben');
      return;
    }

    const items = await extractLineItems();
    const snMap = new Map();

    items.forEach(li => {
      li.serials.forEach(sn => {
        if (!snMap.has(sn)) snMap.set(sn, []);
        snMap.get(sn).push(li);
      });
    });

    const unassigned = soll.filter(sn => !snMap.has(sn));

    let ok = 0, warn = 0;

    items.forEach(li => {
      if (!li.serials.length) {
        mark(li, 'orange', 'Produkt ohne Seriennummern');
        warn++;
        return;
      }

      const isFAS = isNetAppFAS(li.manufacturer, li.productName);
      const expected = isFAS
        ? Math.ceil(li.serials.length / 2)
        : li.serials.length;

      if (li.qty !== expected) {
        mark(li, isFAS ? 'gold' : 'yellow', 'Quantity passt nicht');
        warn++;
      } else {
        mark(li, 'limegreen', 'OK');
        ok++;
      }
    });

    snMap.forEach((arr, sn) => {
      if (arr.length > 1) {
        arr.forEach(li => mark(li, 'purple', `SN ${sn} mehrfach verwendet`));
        warn++;
      }
    });

    STATE = { items, unassigned };

    $('#hw24-sn-result').textContent =
      `OK: ${ok} · Warnungen: ${warn} · Unzugeordnet: ${unassigned.length}`;
  }

  async function runAssignment() {
    if (!STATE || !STATE.unassigned.length) {
      alert('Keine unzugeordneten Seriennummern');
      return;
    }

    const items = STATE.items;
    const choice = prompt(
      STATE.unassigned.join(', ') +
      '\n\nZu welchem Produkt zuordnen? (Nummer)\n\n' +
      items.map((li, i) => `${i + 1}: ${li.productName}`).join('\n')
    );

    const idx = Number(choice) - 1;
    const target = items[idx];
    if (!target) return;

    const descEl = target.tr.querySelector('textarea');
    const newSerials = [...new Set([...target.serials, ...STATE.unassigned])];

    descEl.value = rebuildDescription(target, newSerials);

    const isFAS = isNetAppFAS(target.manufacturer, target.productName);
    const newQty = isFAS ? Math.ceil(newSerials.length / 2) : newSerials.length;
    if (target.qtyEl) target.qtyEl.value = newQty;

    alert('Zuordnung & Quantity aktualisiert');
  }

  /* ===============================
     Boot
     =============================== */

  showPanel();

})();
