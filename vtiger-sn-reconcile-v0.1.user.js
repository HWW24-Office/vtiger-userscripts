// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.7.4
// @description  Stable SN panel + multi-SN add dialog (no matrix), full logic enabled
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /* =============================
     GUARD: Edit Mode only
     ============================= */
  if (
    !location.href.includes('view=Edit') ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* =============================
     Utilities
     ============================= */
  const $ = id => document.getElementById(id);
  const S = s => (s || '').toString().trim();
  const norm = s => S(s).toUpperCase().replace(/\s+/g,'');
  const uniq = a => [...new Set(a)];
  const parseList = t =>
    uniq(S(t).split(/[\n,;]+/).map(norm).filter(Boolean));
  const fire = el =>
    el && ['input','change','blur'].forEach(e =>
      el.dispatchEvent(new Event(e,{bubbles:true}))
    );

  /* =============================
     Line Items
     ============================= */
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

  function buildSNIndex(items){
    const idx = new Map();
    items.forEach(it=>{
      it.sns.forEach(sn=>{
        if(!idx.has(sn)) idx.set(sn,[]);
        idx.get(sn).push(it);
      });
    });
    return idx;
  }

  /* =============================
     PANEL (guaranteed visible)
     ============================= */
  function injectPanel(){
    if ($('hw24-sn-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'hw24-sn-panel';
    panel.style.cssText = `
      position:fixed;
      bottom:20px;
      left:20px;
      width:360px;
      padding:12px;
      background:#111;
      color:#fff;
      border:1px solid #333;
      border-radius:10px;
      box-shadow:0 8px 24px rgba(0,0,0,.5);
      z-index:2147483647;
      font-family:system-ui,Segoe UI,Roboto,Arial;
      font-size:13px;
    `;

    panel.innerHTML = `
      <b style="display:block;margin-bottom:6px">SN-Abgleich</b>

      <label>Behalten</label>
      <textarea id="sn-keep" style="width:100%;height:46px;margin-bottom:6px"></textarea>

      <label>Entfernen</label>
      <textarea id="sn-remove" style="width:100%;height:46px;margin-bottom:6px"></textarea>

      <label>Hinzufügen</label>
      <textarea id="sn-add" style="width:100%;height:46px"></textarea>

      <div style="margin-top:8px;display:flex;gap:6px">
        <button id="sn-preview">Preview</button>
        <button id="sn-apply">Apply</button>
        <button id="sn-undo" disabled>Undo</button>
      </div>

      <div id="sn-msg" style="margin-top:6px;color:#ffd966;font-size:12px"></div>
    `;

    panel.querySelectorAll('textarea,button').forEach(el=>{
      el.style.background = '#fff';
      el.style.color = '#111';
      el.style.border = '1px solid #444';
    });

    document.body.appendChild(panel);
  }

  /* =============================
     Ensure panel persists
     ============================= */
  function initPanel(){
    injectPanel();
    const obs = new MutationObserver(()=>{
      if (!$('hw24-sn-panel')) injectPanel();
    });
    obs.observe(document.body,{childList:true,subtree:true});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanel);
  } else {
    initPanel();
  }

  /* =============================
     Snapshot / Undo
     ============================= */
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

  /* =============================
     Preview
     ============================= */
  $('sn-preview').onclick = ()=>{
    const items = getLineItems();
    const idx = buildSNIndex(items);

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

  /* =============================
     Add Dialog (multi SN → one position)
     ============================= */
  function openAddDialog(addList, items, onDone){
    let remaining = [...addList];

    const dlg = document.createElement('div');
    dlg.style.cssText = `
      position:fixed;inset:0;
      background:rgba(0,0,0,.6);
      z-index:2147483647;
      display:flex;align-items:center;justify-content:center;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background:#fff;color:#111;
      width:90%;max-width:900px;
      max-height:80vh;overflow:auto;
      padding:16px;border-radius:10px;
      font-family:system-ui,Segoe UI,Roboto,Arial;
    `;

    function render(){
      box.innerHTML = `<h3>Seriennummern zuordnen</h3>`;

      if(!remaining.length){
        const close = document.createElement('button');
        close.textContent = 'Schließen';
        close.onclick = ()=>{ dlg.remove(); onDone(); };
        box.appendChild(close);
        return;
      }

      const snWrap = document.createElement('div');
      snWrap.innerHTML = '<b>Seriennummern</b>';
      remaining.forEach(sn=>{
        const d = document.createElement('div');
        d.innerHTML = `<label><input type="checkbox" value="${sn}"> ${sn}</label>`;
        snWrap.appendChild(d);
      });

      const prodWrap = document.createElement('div');
      prodWrap.innerHTML = '<b>Position</b>';
      items.forEach(it=>{
        const d = document.createElement('div');
        d.innerHTML =
          `<label><input type="radio" name="hw24-sn-target" value="${it.rn}"> ${it.prodName}</label>`;
        prodWrap.appendChild(d);
      });

      const assign = document.createElement('button');
      assign.textContent = 'Ausgewählte Seriennummern zuordnen';
      assign.onclick = ()=>{
        const sns = [...snWrap.querySelectorAll('input[type=checkbox]:checked')]
          .map(i=>i.value);
        const sel = prodWrap.querySelector('input[type=radio]:checked');
        if(!sns.length || !sel)
          return alert('Bitte Seriennummer(n) UND Position wählen');

        const it = items.find(x=>x.rn === sel.value);
        sns.forEach(sn=>{
          if(!it.sns.includes(sn)) it.sns.push(sn);
          remaining = remaining.filter(x=>x!==sn);
        });
        render();
      };

      box.append(snWrap, prodWrap, assign);
    }

    render();
    dlg.appendChild(box);
    document.body.appendChild(dlg);
  }

  /* =============================
     Apply
     ============================= */
  $('sn-apply').onclick = ()=>{
    const items = getLineItems();
    SNAPSHOT = snapshot(items);
    $('sn-undo').disabled = false;

    const idx = buildSNIndex(items);
    const keep = new Set(parseList($('sn-keep').value));
    const rem  = parseList($('sn-remove').value).filter(sn=>!keep.has(sn));
    const add  = parseList($('sn-add').value)
      .filter(sn=>!keep.has(sn) && !idx.has(sn));

    // Entfernen
    items.forEach(it=>{
      it.sns = it.sns.filter(sn=>!rem.includes(sn));
    });

    const writeBack = ()=>{
      items.forEach(it=>{
        const snLine = it.sns.length ? `S/N: ${it.sns.join(', ')}` : '';
        const rest = it.desc.replace(/S\/N\s*:[^\n\r]+/i,'').trim();
        it.descEl.value = [snLine, rest].filter(Boolean).join('\n');
        fire(it.descEl);
        if(it.qtyEl){
          it.qtyEl.value = it.sns.length;
          fire(it.qtyEl);
        }
      });
      $('sn-msg').textContent = 'Apply durchgeführt';
    };

    if(add.length){
      openAddDialog(add, items, writeBack);
    } else {
      writeBack();
    }
  };

  /* =============================
     Undo
     ============================= */
  $('sn-undo').onclick = ()=>{
    if(SNAPSHOT) restore(SNAPSHOT);
    $('sn-msg').textContent = 'Undo durchgeführt';
  };

})();
