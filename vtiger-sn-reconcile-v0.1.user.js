// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.7.3-fix1
// @description  Restore SN panel visibility and keep readable UI + add dialog step 1
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (
    !location.href.includes('view=Edit') ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* =========================
     HARD CSS RESET (SAFE)
     ========================= */
  const css = document.createElement('style');
  css.textContent = `
    #hw24-sn-panel,
    #hw24-sn-panel * {
      box-sizing: border-box !important;
      font-family: system-ui, Segoe UI, Roboto, Arial !important;
    }

    .hw24-sn-dialog {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.6) !important;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .hw24-sn-box {
      background: #fff !important;
      color: #111 !important;
      width: 90%;
      max-width: 1000px;
      max-height: 80vh;
      overflow: auto;
      padding: 16px;
      border-radius: 10px;
    }

    .hw24-sn-box * {
      color: #111 !important;
    }
  `;
  document.head.appendChild(css);

  /* ================= Utilities ================= */

  const $ = id => document.getElementById(id);
  const S = s => (s || '').toString().trim();
  const norm = s => S(s).toUpperCase().replace(/\s+/g,'');
  const uniq = a => [...new Set(a)];
  const parseList = t => uniq(S(t).split(/[\n,;]+/).map(norm).filter(Boolean));
  const fire = el => el && ['input','change','blur'].forEach(e =>
    el.dispatchEvent(new Event(e,{bubbles:true}))
  );

  /* ================= Line Items ================= */

  function getLineItems(){
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')]
      .map(tr=>{
        const rn = tr.dataset.rowNum || tr.id.replace('row','');
        const descEl =
          tr.querySelector('textarea[name*="comment"], textarea[name*="description"]');
        const qtyEl = tr.querySelector('input[name^="qty"]');
        const desc = S(descEl?.value);
        const m = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
        const sns = m ? parseList(m[1]) : [];
        const prodName =
          S(tr.querySelector(`#productName${rn}`)?.textContent) || `Position ${rn}`;
        return { rn, tr, descEl, qtyEl, desc, sns, prodName };
      });
  }

  /* ================= PANEL (FIXED VISIBILITY) ================= */

  if (!document.getElementById('hw24-sn-panel')) {
    const panel = document.createElement('div');
    panel.id = 'hw24-sn-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 16px;
      left: 16px;
      width: 360px;
      padding: 12px;
      background: #111;
      color: #fff;
      border: 1px solid #333;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.5);
      z-index: 2147483646;
      font-size: 13px;
    `;

    panel.innerHTML = `
      <b style="display:block;margin-bottom:6px">SN-Abgleich</b>

      <label>Behalten</label>
      <textarea id="sn-keep" style="width:100%;height:48px;margin-bottom:6px"></textarea>

      <label>Entfernen</label>
      <textarea id="sn-remove" style="width:100%;height:48px;margin-bottom:6px"></textarea>

      <label>Hinzufügen</label>
      <textarea id="sn-add" style="width:100%;height:48px"></textarea>

      <div style="margin-top:8px;display:flex;gap:6px">
        <button id="sn-preview">Preview</button>
        <button id="sn-apply">Apply</button>
        <button id="sn-undo" disabled>Undo</button>
      </div>

      <div id="sn-msg" style="margin-top:6px;color:#ffd966;font-size:12px"></div>
    `;

    document.body.appendChild(panel);
  }

  /* ================= Snapshot / Undo ================= */

  let SNAPSHOT = null;

  const snapshot = items => items.map(it=>({
    rn: it.rn,
    desc: it.descEl?.value,
    qty: it.qtyEl?.value
  }));

  const restore = snap => snap.forEach(s=>{
    const tr = document.getElementById('row'+s.rn) ||
               document.querySelector(`tr[data-row-num="${s.rn}"]`);
    if(!tr) return;
    const d = tr.querySelector('textarea[name*="comment"], textarea[name*="description"]');
    const q = tr.querySelector('input[name^="qty"]');
    if(d){ d.value=s.desc; fire(d); }
    if(q){ q.value=s.qty; fire(q); }
  });

  /* ================= Preview ================= */

  $('sn-preview').onclick = ()=>{
    const items = getLineItems();
    const idx = new Map();
    items.forEach(it=>it.sns.forEach(sn=>{
      if(!idx.has(sn)) idx.set(sn,[]);
      idx.get(sn).push(it);
    }));

    const keep = parseList($('sn-keep').value);
    const rem  = parseList($('sn-remove').value);
    const add  = parseList($('sn-add').value);

    const msg = [];

    if (keep.some(sn=>rem.includes(sn)))
      msg.push('❌ Konflikt Behalten / Entfernen');

    if (keep.some(sn=>!idx.has(sn)))
      msg.push('⚠ Behalten: Produkt fehlt');

    if (add.some(sn=>idx.has(sn)))
      msg.push('🚫 Hinzufügen: bereits vorhanden');

    $('sn-msg').textContent = msg.length ? msg.join(' | ') : '✅ Preview OK';
  };

  /* ================= Apply (unchanged logic) ================= */

  $('sn-apply').onclick = ()=>{
    const items = getLineItems();
    SNAPSHOT = snapshot(items);
    $('sn-undo').disabled = false;

    const keep = new Set(parseList($('sn-keep').value));
    const rem  = parseList($('sn-remove').value).filter(sn=>!keep.has(sn));
    const add  = parseList($('sn-add').value);

    items.forEach(it=>{
      it.sns = it.sns.filter(sn=>!rem.includes(sn));
    });

    const writeBack = ()=>{
      items.forEach(it=>{
        const snLine = it.sns.length ? `S/N: ${it.sns.join(', ')}` : '';
        const rest = it.desc.replace(/S\/N\s*:[^\n\r]+/i,'').trim();
        it.descEl.value = [snLine, rest].filter(Boolean).join('\n');
        fire(it.descEl);
        if(it.qtyEl){ it.qtyEl.value = it.sns.length; fire(it.qtyEl); }
      });
      $('sn-msg').textContent = 'Apply durchgeführt';
    };

    if(add.length){
      alert('Add-Dialog kommt im nächsten Schritt – aktuell deaktiviert.');
      writeBack();
    } else {
      writeBack();
    }
  };

  /* ================= Undo ================= */

  $('sn-undo').onclick = ()=>{
    if(SNAPSHOT) restore(SNAPSHOT);
    $('sn-msg').textContent = 'Undo durchgeführt';
  };

})();
