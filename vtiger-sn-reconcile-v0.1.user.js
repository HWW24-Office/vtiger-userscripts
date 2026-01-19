// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.3.6
// @description  Seriennummern-Abgleich mit Konfliktschutz, Zuordnungsdialog, Quantity-Fix und minimierbarem Panel
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (
    !/view=Edit/.test(location.href) ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* ===========================
     HELPERS
  =========================== */

  const T = s => (s || '').toString().trim();
  const splitSN = s => T(s).split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
  const uniq = arr => [...new Set(arr)];
  const LS_KEY = '__hw24_sn_panel_min';

  /* ===========================
     PANEL UI
  =========================== */

  const panel = document.createElement('div');
  panel.id = 'hw24-sn-panel';

  const minimized = localStorage.getItem(LS_KEY) === '1';

  panel.style.cssText = `
    position:fixed;
    top:12px;
    right:12px;
    z-index:2147483647;
    background:#111;
    color:#eaeaea;
    padding:12px;
    border-radius:10px;
    width:${minimized ? '52px' : '380px'};
    box-shadow:0 8px 28px rgba(0,0,0,.45);
    font:13px system-ui;
  `;

  panel.innerHTML = minimized
    ? `<button id="sn_restore" title="SN-Abgleich öffnen"
        style="width:100%;height:40px;background:#1f6feb;color:#fff;border:0;border-radius:8px;cursor:pointer">SN</button>`
    : `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>SN-Abgleich</b>
        <button id="sn_min" title="Minimieren"
          style="background:none;color:#aaa;border:0;cursor:pointer;font-size:14px">▁</button>
      </div>

      <label>Behalten</label>
      <textarea id="sn_keep"></textarea>

      <label>Entfernen</label>
      <textarea id="sn_remove"></textarea>

      <label>Hinzufügen</label>
      <textarea id="sn_add"></textarea>

      <button id="sn_apply">Anwenden</button>
    `;

  document.body.appendChild(panel);

  /* ===========================
     STYLES (fix white-on-white)
  =========================== */

  const style = document.createElement('style');
  style.textContent = `
    #hw24-sn-panel label {
      display:block;
      margin-top:8px;
      font-size:12px;
      color:#bbb;
    }
    #hw24-sn-panel textarea {
      width:100%;
      height:58px;
      background:#1a1a1a;
      color:#eaeaea;
      border:1px solid #333;
      border-radius:6px;
      padding:6px;
      resize:vertical;
    }
    #hw24-sn-panel textarea::placeholder {
      color:#777;
    }
    #hw24-sn-panel button {
      margin-top:10px;
      width:100%;
      background:#1f6feb;
      color:#fff;
      border:0;
      border-radius:8px;
      padding:8px;
      cursor:pointer;
    }
  `;
  document.head.appendChild(style);

  /* ===========================
     MINIMIZE / RESTORE
  =========================== */

  panel.onclick = e => {
    if (e.target.id === 'sn_min') {
      localStorage.setItem(LS_KEY, '1');
      location.reload();
    }
    if (e.target.id === 'sn_restore') {
      localStorage.removeItem(LS_KEY);
      location.reload();
    }
  };

  if (minimized) return;

  /* ===========================
     CORE LOGIC
  =========================== */

  function getLineItems() {
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')];
  }

  function extractSN(desc) {
    const m = desc.match(/S\/N:\s*([^\n\r]+)/i);
    return m ? splitSN(m[1]) : [];
  }

  function rebuildDescription(desc, snList) {
    let rest = desc.replace(/S\/N:.*(\n|$)/i, '').trim();

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
     APPLY
  =========================== */

  document.getElementById('sn_apply').onclick = () => {

    const keep = splitSN(document.getElementById('sn_keep').value);
    const remove = splitSN(document.getElementById('sn_remove').value);
    const add = splitSN(document.getElementById('sn_add').value);

    const blocked = new Set(
      uniq(
        keep.filter(sn => remove.includes(sn) || add.includes(sn))
          .concat(remove.filter(sn => add.includes(sn)))
      )
    );

    if (blocked.size) {
      alert(
        '⚠️ Konflikt – diese Seriennummern werden nicht verändert:\n\n' +
        [...blocked].join(', ')
      );
    }

    const items = getLineItems();
    const products = [];

    items.forEach(tr => {
      const ta = tr.querySelector('textarea');
      const qty = tr.querySelector('input[name^="qty"]');
      const name =
        tr.querySelector('input[id^="productName"]')?.value ||
        tr.querySelector('td')?.innerText.split('\n')[0] ||
        'Produkt';

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

      products.push({ tr, ta, qty, name, sns });
    });

    const cleanAdd = add.filter(sn =>
      !blocked.has(sn) &&
      !keep.includes(sn) &&
      !remove.includes(sn)
    );

    cleanAdd.forEach(sn => {
      const choice = prompt(
        `Neue Seriennummer: ${sn}\n\n` +
        products.map((p, i) => `${i + 1}) ${p.name}`).join('\n') +
        `\n\nNummer eingeben oder leer lassen (Produkt existiert noch nicht)`
      );

      if (!choice) return;

      const idx = parseInt(choice, 10) - 1;
      const p = products[idx];
      if (!p) return;

      p.sns.push(sn);
      p.sns = uniq(p.sns);

      p.ta.value = rebuildDescription(p.ta.value, p.sns);
      p.qty.value = p.sns.length;

      p.ta.dispatchEvent(new Event('change', { bubbles: true }));
      p.qty.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

})();
