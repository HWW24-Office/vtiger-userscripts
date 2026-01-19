// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.3.5
// @description  Seriennummern-Abgleich mit Konfliktschutz, Zuordnungsdialog und korrekter Quantity-Anpassung (Edit Mode)
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (!/view=Edit/.test(location.href) ||
      !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)) {
    return;
  }

  /* ===========================
     UTIL
  =========================== */

  const T = s => (s || '').toString().trim();
  const splitSN = s => T(s).split(/[\n,]+/).map(x => x.trim()).filter(Boolean);

  const uniq = arr => [...new Set(arr)];

  /* ===========================
     INPUT PANEL
  =========================== */

  const panel = document.createElement('div');
  panel.style.cssText = `
    position:fixed; top:12px; right:12px; z-index:2147483647;
    background:#111; color:#fff; padding:12px;
    border-radius:10px; width:360px;
    box-shadow:0 8px 28px rgba(0,0,0,.45);
    font:13px system-ui;
  `;
  panel.innerHTML = `
    <b>SN-Abgleich</b><br><br>
    <label>Behalten</label>
    <textarea id="sn_keep" style="width:100%;height:60px"></textarea>
    <label>Entfernen</label>
    <textarea id="sn_remove" style="width:100%;height:60px"></textarea>
    <label>Hinzufügen</label>
    <textarea id="sn_add" style="width:100%;height:60px"></textarea>
    <br>
    <button id="sn_apply">Anwenden</button>
  `;
  document.body.appendChild(panel);

  /* ===========================
     CORE DATA EXTRACTION
  =========================== */

  function getLineItems() {
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')];
  }

  function extractSN(desc) {
    const m = desc.match(/S\/N:\s*([^\n\r]+)/i);
    return m ? splitSN(m[1]) : [];
  }

  function rebuildDescription(desc, snList) {
    let rest = desc
      .replace(/S\/N:.*(\n|$)/i, '')
      .trim();

    const start = rest.match(/Service Start:[^\n]+/i);
    const end   = rest.match(/Service End:[^\n]+/i);

    rest = rest
      .replace(/Service Start:[^\n]+/ig, '')
      .replace(/Service End:[^\n]+/ig, '')
      .trim();

    let out = `S/N: ${snList.join(', ')}\n`;
    if (rest) out += rest + '\n';
    if (start) out += start[0] + '\n';
    if (end) out += end[0];

    return out.trim();
  }

  /* ===========================
     APPLY LOGIC
  =========================== */

  document.getElementById('sn_apply').onclick = () => {

    const keep = splitSN(document.getElementById('sn_keep').value);
    const remove = splitSN(document.getElementById('sn_remove').value);
    const add = splitSN(document.getElementById('sn_add').value);

    const blocked = new Set(
      uniq(keep.filter(sn => remove.includes(sn) || add.includes(sn))
        .concat(remove.filter(sn => add.includes(sn))))
    );

    if (blocked.size) {
      alert(
        '⚠️ Konflikt:\n' +
        [...blocked].join(', ') +
        '\n\nDiese Seriennummern werden nicht verändert.'
      );
    }

    const items = getLineItems();
    const addQueue = [];

    items.forEach(tr => {
      const ta = tr.querySelector('textarea');
      const qty = tr.querySelector('input[name^="qty"]');
      if (!ta || !qty) return;

      let sns = extractSN(ta.value);
      const before = sns.length;

      sns = sns.filter(sn => {
        if (blocked.has(sn)) return true;
        if (remove.includes(sn)) return false;
        return true;
      });

      if (sns.length !== before) {
        ta.value = rebuildDescription(ta.value, sns);
        qty.value = sns.length;
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        qty.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    /* ===========================
       ADD → DIALOG
    =========================== */

    const cleanAdd = add.filter(sn =>
      !blocked.has(sn) &&
      !keep.includes(sn) &&
      !remove.includes(sn)
    );

    if (!cleanAdd.length) return;

    // collect product meta
    const products = items.map(tr => {
      const name = tr.querySelector('input[id^="productName"]')?.value || 'Produkt';
      const desc = tr.querySelector('textarea')?.value || '';
      const start = desc.match(/Service Start:[^\n]+/i)?.[0] || '';
      const end = desc.match(/Service End:[^\n]+/i)?.[0] || '';
      return { tr, name, start, end };
    });

    cleanAdd.forEach(sn => {
      const choice = prompt(
        `Neue Seriennummer: ${sn}\n\n` +
        products.map((p, i) =>
          `${i + 1}) ${p.name}\n   ${p.start} ${p.end}`
        ).join('\n') +
        `\n\nNummer eingeben oder leer lassen (Produkt existiert noch nicht)`
      );

      if (!choice) return;

      const idx = parseInt(choice, 10) - 1;
      const p = products[idx];
      if (!p) return;

      const ta = p.tr.querySelector('textarea');
      const qty = p.tr.querySelector('input[name^="qty"]');
      let sns = extractSN(ta.value);

      sns.push(sn);
      sns = uniq(sns);

      ta.value = rebuildDescription(ta.value, sns);
      qty.value = sns.length;

      ta.dispatchEvent(new Event('change', { bubbles: true }));
      qty.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

})();
