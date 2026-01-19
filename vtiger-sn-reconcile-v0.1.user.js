// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.4.0
// @description  Seriennummern-Abgleich mit Undo, globaler Duplikatsperre und sicherem Zuordnungsdialog
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

  /* ===========================
     SNAPSHOT FOR UNDO
  =========================== */

  let SNAPSHOT = null;

  function takeSnapshot(items) {
    SNAPSHOT = items.map(it => ({
      ta: it.ta,
      qty: it.qty,
      desc: it.ta.value,
      q: it.qty.value
    }));
  }

  function undo() {
    if (!SNAPSHOT) {
      alert('Kein Undo verfügbar.');
      return;
    }
    SNAPSHOT.forEach(s => {
      s.ta.value = s.desc;
      s.qty.value = s.q;
      s.ta.dispatchEvent(new Event('change', { bubbles: true }));
      s.qty.dispatchEvent(new Event('change', { bubbles: true }));
    });
    alert('Undo durchgeführt.');
    SNAPSHOT = null;
  }

  /* ===========================
     UI PANEL
  =========================== */

  const panel = document.createElement('div');
  panel.id = 'hw24-sn-panel';
  panel.style.cssText = `
    position:fixed; top:12px; right:12px; z-index:2147483647;
    background:#111; color:#eaeaea; padding:12px;
    border-radius:10px; width:400px;
    box-shadow:0 8px 28px rgba(0,0,0,.45);
    font:13px system-ui;
  `;
  panel.innerHTML = `
    <b>SN-Abgleich</b>
    <label>Behalten</label>
    <textarea id="sn_keep"></textarea>
    <label>Entfernen</label>
    <textarea id="sn_remove"></textarea>
    <label>Hinzufügen</label>
    <textarea id="sn_add"></textarea>
    <button id="sn_apply">Anwenden</button>
    <button id="sn_undo" style="background:#444">Undo</button>
  `;
  document.body.appendChild(panel);

  /* ===========================
     STYLES
  =========================== */

  const style = document.createElement('style');
  style.textContent = `
    #hw24-sn-panel textarea {
      width:100%; height:60px;
      background:#1a1a1a; color:#eaeaea;
      border:1px solid #333; border-radius:6px;
      padding:6px;
    }
    #hw24-sn-panel label { margin-top:6px; display:block; color:#bbb }
    #hw24-sn-panel button {
      width:100%; margin-top:8px;
      background:#1f6feb; color:#fff;
      border:0; border-radius:8px; padding:8px; cursor:pointer;
    }
  `;
  document.head.appendChild(style);

  /* ===========================
     CORE
  =========================== */

  function getItems() {
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')]
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

        const start = desc.match(/Service Start:[^\n]+/i)?.[0] || '';
        const end = desc.match(/Service End:[^\n]+/i)?.[0] || '';

        return { tr, ta, qty, name, sns, start, end };
      })
      .filter(Boolean);
  }

  function extractSN(desc) {
    const m = desc.match(/S\/N:\s*([^\n\r]+)/i);
    return m ? splitSN(m[1]) : [];
  }

  function rebuildDescription(desc, snList) {
    let rest = desc.replace(/S\/N:.*(\n|$)/i, '').trim();
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

  /* ===========================
     APPLY
  =========================== */

  document.getElementById('sn_undo').onclick = undo;

  document.getElementById('sn_apply').onclick = () => {

    const keep = splitSN(document.getElementById('sn_keep').value);
    const remove = splitSN(document.getElementById('sn_remove').value);
    const add = splitSN(document.getElementById('sn_add').value);

    const items = getItems();
    takeSnapshot(items);

    const allExisting = new Map();
    items.forEach(it => it.sns.forEach(sn => allExisting.set(sn, it)));

    const blocked = new Set(
      uniq(
        keep.filter(sn => remove.includes(sn) || add.includes(sn))
          .concat(remove.filter(sn => add.includes(sn)))
      )
    );

    if (blocked.size) {
      alert('⚠️ Konflikt – diese Seriennummern werden ignoriert:\n' + [...blocked].join(', '));
    }

    /* === REMOVE === */
    items.forEach(it => {
      let sns = it.sns.filter(sn => {
        if (blocked.has(sn)) return true;
        if (remove.includes(sn)) return false;
        return true;
      });

      if (sns.length !== it.sns.length) {
        it.ta.value = rebuildDescription(it.ta.value, sns);
        it.qty.value = sns.length;
        it.ta.dispatchEvent(new Event('change', { bubbles:true }));
        it.qty.dispatchEvent(new Event('change', { bubbles:true }));
        it.sns = sns;
      }
    });

    /* === ADD === */
    const cleanAdd = add.filter(sn =>
      !blocked.has(sn) &&
      !keep.includes(sn) &&
      !remove.includes(sn)
    );

    cleanAdd.forEach(sn => {
      if (allExisting.has(sn)) {
        alert(`⚠️ Seriennummer ${sn} existiert bereits in "${allExisting.get(sn).name}" und kann nicht doppelt zugeordnet werden.`);
        return;
      }

      const choice = prompt(
        `Neue Seriennummer: ${sn}\n\n` +
        items.map((p,i)=>`${i+1}) ${p.name} | ${p.start} ${p.end}`).join('\n') +
        `\n\nNummer eingeben oder abbrechen`
      );
      if (!choice) return;

      const idx = parseInt(choice,10)-1;
      const it = items[idx];
      if (!it) return;

      it.sns.push(sn);
      it.sns = uniq(it.sns);

      it.ta.value = rebuildDescription(it.ta.value, it.sns);
      it.qty.value = it.sns.length;
      it.ta.dispatchEvent(new Event('change',{bubbles:true}));
      it.qty.dispatchEvent(new Event('change',{bubbles:true}));
    });
  };

})();
