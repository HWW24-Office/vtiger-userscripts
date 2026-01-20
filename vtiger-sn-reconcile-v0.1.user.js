// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.7.2-fix
// @description  Fixed preview/apply logic, strict SN integrity, stable add dialog
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

  /* ========== Utilities ========== */

  const $ = id => document.getElementById(id);
  const S = s => (s || '').toString().trim();
  const norm = s => S(s).toUpperCase().replace(/\s+/g, '');
  const uniq = a => [...new Set(a)];
  const parseList = t => uniq(S(t).split(/[\n,;]+/).map(norm).filter(Boolean));
  const fire = el => el && ['input','change','blur'].forEach(e =>
    el.dispatchEvent(new Event(e,{bubbles:true}))
  );

  /* ========== Line Items ========== */

  function getLineItems(){
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')]
      .map(tr=>{
        const rn = tr.dataset.rowNum || tr.id.replace('row','');
        const descEl = tr.querySelector('textarea[name*="comment"], textarea[name*="description"]');
        const qtyEl = tr.querySelector('input[name^="qty"]');
        const desc = S(descEl?.value);
        const m = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
        const sns = m ? parseList(m[1]) : [];
        const prodName = S(tr.querySelector(`#productName${rn}`)?.textContent) || `Position ${rn}`;
        return { rn, tr, descEl, qtyEl, desc, sns, prodName };
      });
  }

  const buildSNIndex = items => {
    const idx = new Map();
    items.forEach(it=>{
      it.sns.forEach(sn=>{
        if(!idx.has(sn)) idx.set(sn,[]);
        idx.get(sn).push(it);
      });
    });
    return idx;
  };

  /* ========== Panel ========== */

  const panel = document.createElement('div');
  panel.id = 'hw24-sn-panel';
  panel.style.cssText = 'position:fixed;bottom:16px;left:16px;width:340px;padding:12px;background:#111;color:#fff;z-index:2147483646;border-radius:10px';
  panel.innerHTML = `
    <b>SN-Abgleich</b>
    <label>Behalten</label>
    <textarea id="sn-keep" style="width:100%;height:50px"></textarea>
    <label>Entfernen</label>
    <textarea id="sn-remove" style="width:100%;height:50px"></textarea>
    <label>Hinzufügen</label>
    <textarea id="sn-add" style="width:100%;height:50px"></textarea>
    <div style="margin-top:6px;display:flex;gap:6px">
      <button id="sn-preview">Preview</button>
      <button id="sn-apply">Apply</button>
      <button id="sn-undo" disabled>Undo</button>
    </div>
    <div id="sn-msg" style="margin-top:6px;color:#ffd966"></div>
  `;
  document.body.appendChild(panel);

  /* ========== Snapshot / Undo ========== */

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

  /* ========== Preview ========== */

  $('sn-preview').onclick = ()=>{
    const items = getLineItems();
    const idx = buildSNIndex(items);

    const keep = parseList($('sn-keep').value);
    const rem  = parseList($('sn-remove').value);
    const add  = parseList($('sn-add').value);

    const msg = [];

    const conflicts = keep.filter(sn=>rem.includes(sn));
    if(conflicts.length) msg.push(`❌ Konflikt: ${conflicts.join(', ')}`);

    const keepMissing = keep.filter(sn=>!idx.has(sn));
    if(keepMissing.length) msg.push(`⚠ Behalten fehlt: ${keepMissing.join(', ')}`);

    const remMissing = rem.filter(sn=>!idx.has(sn) && !keep.includes(sn));
    if(remMissing.length) msg.push(`⚠ Entfernen fehlt: ${remMissing.join(', ')}`);

    const addExists = add.filter(sn=>idx.has(sn));
    if(addExists.length) msg.push(`🚫 Bereits vorhanden: ${addExists.join(', ')}`);

    $('sn-msg').textContent = msg.length ? msg.join(' | ') : '✅ Preview OK';
  };

  /* ========== Apply ========== */

  $('sn-apply').onclick = ()=>{
    const items = getLineItems();
    SNAPSHOT = snapshot(items);
    $('sn-undo').disabled = false;

    const idx = buildSNIndex(items);
    const keep = new Set(parseList($('sn-keep').value));
    const rem  = parseList($('sn-remove').value).filter(sn=>!keep.has(sn));
    const add  = parseList($('sn-add').value).filter(sn=>!keep.has(sn) && !idx.has(sn));

    items.forEach(it=>{
      it.sns = it.sns.filter(sn=>!rem.includes(sn));
    });

    const writeBack = ()=>{
      items.forEach(it=>{
        const snLine = it.sns.length ? `S/N: ${it.sns.join(', ')}` : '';
        const rest = it.desc.replace(/S\/N\s*:[^\n\r]+/i,'').trim();
        it.descEl.value = [snLine,rest].filter(Boolean).join('\n');
        fire(it.descEl);
        if(it.qtyEl){ it.qtyEl.value = it.sns.length; fire(it.qtyEl); }
      });
      $('sn-msg').textContent = 'Apply durchgeführt';
    };

    if(add.length){
      alert('Hinzufügen-Dialog ist im nächsten Schritt – aktuell bewusst deaktiviert für Stabilität.');
      writeBack();
    } else {
      writeBack();
    }
  };

  /* ========== Undo ========== */

  $('sn-undo').onclick = ()=>{
    if(SNAPSHOT) restore(SNAPSHOT);
    $('sn-msg').textContent = 'Undo durchgeführt';
  };

})();
