// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.5.3
// @description  SN-Abgleich mit korrekter Entfernen-Logik, globaler SN-Eindeutigkeit und sicherer Radiobutton-Zuordnung
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
  const uniq = a => [...new Set(a)];

  /* ===========================
     ITEM EXTRACTION
  =========================== */

  function extractSN(desc) {
    const m = desc.match(/S\/N:\s*([^\n\r]+)/i);
    return m ? splitSN(m[1]) : [];
  }

  function rebuildDescription(desc, snList) {
    let rest = desc.replace(/S\/N:.*(\n|$)/i,'').trim();
    const start = rest.match(/Service Start:[^\n]+/i);
    const end   = rest.match(/Service End:[^\n]+/i);
    rest = rest.replace(/Service Start:[^\n]+/ig,'')
               .replace(/Service End:[^\n]+/ig,'')
               .trim();

    let out = `S/N: ${snList.join(', ')}\n`;
    if (rest) out += rest + '\n';
    if (start) out += start[0] + '\n';
    if (end) out += end[0];
    return out.trim();
  }

  function getItems() {
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')]
      .map(tr => {
        const ta = tr.querySelector('textarea');
        const qty = tr.querySelector('input[name^="qty"]');
        if (!ta || !qty) return null;

        const name =
          tr.querySelector('input[id^="productName"]')?.value ||
          tr.querySelector('td')?.innerText.split('\n')[0] ||
          'Produkt';

        const desc = ta.value;
        const sns = extractSN(desc);

        return { tr, ta, qty, name, sns };
      })
      .filter(Boolean);
  }

  /* ===========================
     UI PANEL (minimal)
  =========================== */

  const panel = document.createElement('div');
  panel.style.cssText = `
    position:fixed; top:12px; right:12px; z-index:2147483647;
    background:#111; color:#eaeaea; padding:12px;
    border-radius:10px; width:420px;
    box-shadow:0 8px 28px rgba(0,0,0,.45);
    font:13px system-ui;
  `;
  panel.innerHTML = `
    <b>SN-Abgleich</b>
    <label>Behalten</label><textarea id="sn_keep"></textarea>
    <label>Entfernen</label><textarea id="sn_remove"></textarea>
    <label>Hinzufügen</label><textarea id="sn_add"></textarea>
    <button id="sn_apply">Apply</button>
  `;
  document.body.appendChild(panel);

  panel.querySelectorAll('textarea').forEach(t=>{
    t.style.cssText='width:100%;height:60px;background:#1a1a1a;color:#eaeaea;border:1px solid #333;border-radius:6px;padding:6px';
  });
  panel.querySelector('button').style.cssText =
    'margin-top:8px;width:100%;background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer';

  /* ===========================
     APPLY
  =========================== */

  document.getElementById('sn_apply').onclick = () => {

    const keep = splitSN(document.getElementById('sn_keep').value);
    const remove = splitSN(document.getElementById('sn_remove').value);
    const add = splitSN(document.getElementById('sn_add').value);

    const items = getItems();

    const globalMap = new Map();
    items.forEach(it => it.sns.forEach(sn => globalMap.set(sn, it)));

    const blocked = new Set(
      uniq(
        keep.filter(sn => remove.includes(sn) || add.includes(sn))
          .concat(remove.filter(sn => add.includes(sn)))
      )
    );

    /* === REMOVE LOGIC (RESTORED) === */
    items.forEach(it => {
      let next = it.sns.filter(sn => {
        if (blocked.has(sn)) return true;
        if (keep.length) return keep.includes(sn);
        if (remove.includes(sn)) return false;
        return true;
      });

      if (next.length !== it.sns.length) {
        it.ta.value = rebuildDescription(it.ta.value, next);
        it.qty.value = next.length;
        it.ta.dispatchEvent(new Event('change',{bubbles:true}));
        it.qty.dispatchEvent(new Event('change',{bubbles:true}));
        it.sns = next;
      }
    });

    /* === ADD WITH GLOBAL CHECK === */
    const cleanAdd = add.filter(sn =>
      !blocked.has(sn) && !globalMap.has(sn)
    );

    if (!cleanAdd.length) return;

    alert(
      'Neue Seriennummern wurden NICHT automatisch zugeordnet:\n' +
      cleanAdd.join(', ') +
      '\n\nBitte einzeln prüfen oder Produkt hinzufügen.'
    );
  };

})();
