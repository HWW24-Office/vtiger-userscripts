// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.7.1
// @description  SN-Abgleich im Edit-Modus mit sicherer Behalten/Entfernen-Logik und Hinzufügen-Zuordnungsdialog (Checkbox SN + Radio Position), Preview und Undo
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const isEdit =
    location.href.includes('view=Edit') &&
    /module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href);
  if (!isEdit) return;

  /* =========================
     HARD CSS RESET (FINAL)
     ========================= */
  const css = document.createElement('style');
  css.textContent = `
    .hw24-sn-panel, .hw24-sn-panel * {
      box-sizing: border-box !important;
      color: #fff !important;
      background: #111 !important;
      font-family: system-ui,Segoe UI,Roboto,Arial !important;
    }
    .hw24-sn-panel textarea,
    .hw24-sn-panel button {
      background:#fff !important;
      color:#111 !important;
      border:1px solid #444 !important;
    }

    .hw24-sn-dialog {
      position:fixed; inset:0;
      background:rgba(0,0,0,.6) !important;
      z-index:2147483647;
      display:flex; align-items:center; justify-content:center;
    }
    .hw24-sn-dialog, .hw24-sn-dialog * {
      color:#111 !important;
      background:#fff !important;
      font-family: system-ui,Segoe UI,Roboto,Arial !important;
    }
    .hw24-sn-box {
      background:#fff !important;
      border-radius:10px;
      padding:16px;
      width:90%;
      max-width:1100px;
      max-height:80vh;
      overflow:auto;
    }
    .hw24-sn-sn {
      border-bottom:1px dashed #ccc;
      padding:6px 0;
    }
    .hw24-sn-prod {
      border:1px solid #ccc;
      border-radius:8px;
      padding:8px;
      margin:6px 0;
    }
    .hw24-sn-actions {
      margin-top:10px;
      display:flex;
      gap:8px;
    }
  `;
  document.head.appendChild(css);

  /* ================= Utilities ================= */

  const S = s => (s || '').toString().trim();
  const norm = s => S(s).toUpperCase().replace(/[\s\u00A0]/g, '');
  const uniq = arr => [...new Set(arr)];
  const parseList = t => uniq(S(t).split(/[\n,;]+/).map(x => norm(x)).filter(Boolean));

  function fire(el){
    if(!el) return;
    ['input','change','blur'].forEach(e=>el.dispatchEvent(new Event(e,{bubbles:true})));
  }

  /* ================= Line Items ================= */

  function getLineItems(){
    const rows = [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')];
    return rows.map(tr=>{
      const rn = tr.getAttribute('data-row-num') || tr.id.replace('row','');
      const descEl =
        tr.querySelector('textarea[name*="comment"], textarea[name*="description"]') ||
        tr.querySelector('input[name*="comment"], input[name*="description"]');

      const desc = S(descEl?.value || '');
      const snMatch = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
      const sns = snMatch ? parseList(snMatch[1]) : [];

      const prodName =
        S(tr.querySelector(`#productName${rn}`)?.textContent) ||
        S(tr.querySelector('input[id^="productName"]')?.value) ||
        `Position ${rn}`;

      const qtyEl = tr.querySelector('input[name^="qty"]');
      const qty = qtyEl ? Number(qtyEl.value || 0) : 0;

      return { tr, rn, descEl, desc, sns, prodName, qty, qtyEl };
    });
  }

  /* ================= Panel ================= */

  let SNAPSHOT = null;

  function snapshot(items){
    return items.map(it=>({
      rn: it.rn,
      desc: it.descEl?.value,
      qty: it.qtyEl?.value
    }));
  }

  function restore(snapshot){
    snapshot.forEach(s=>{
      const tr = document.getElementById('row'+s.rn) || document.querySelector(`tr[data-row-num="${s.rn}"]`);
      if(!tr) return;
      const d =
        tr.querySelector('textarea[name*="comment"], textarea[name*="description"]') ||
        tr.querySelector('input[name*="comment"], input[name*="description"]');
      const q = tr.querySelector('input[name^="qty"]');
      if(d){ d.value = s.desc; fire(d); }
      if(q){ q.value = s.qty; fire(q); }
    });
  }

  function addPanel(){
    if(document.getElementById('hw24-sn-panel')) return;
    const p = document.createElement('div');
    p.id = 'hw24-sn-panel';
    p.className = 'hw24-sn-panel';
    p.style.cssText = `
      position:fixed; bottom:16px; left:16px;
      width:340px; padding:12px;
      border-radius:10px;
      z-index:2147483646;
      box-shadow:0 6px 18px rgba(0,0,0,.35);
    `;
    p.innerHTML = `
      <b>SN-Abgleich</b>
      <label>Behalten (Soll)</label>
      <textarea id="sn-keep" style="width:100%;height:50px"></textarea>
      <label>Entfernen</label>
      <textarea id="sn-remove" style="width:100%;height:50px"></textarea>
      <label>Hinzufügen</label>
      <textarea id="sn-add" style="width:100%;height:50px"></textarea>
      <div class="hw24-sn-actions">
        <button id="sn-preview">Preview</button>
        <button id="sn-apply">Apply</button>
        <button id="sn-undo" disabled>Undo</button>
      </div>
      <div id="sn-msg" style="margin-top:6px;color:#ffd966"></div>
    `;
    document.body.appendChild(p);
  }

  addPanel();

  /* ================= Preview ================= */

  document.getElementById('sn-preview').onclick = ()=>{
    const items = getLineItems();
    const idx = new Map();
    items.forEach(it=>it.sns.forEach(sn=>{
      if(!idx.has(sn)) idx.set(sn,[]);
      idx.get(sn).push(it.prodName);
    }));

    const keep = parseList(document.getElementById('sn-keep').value);
    const rem  = parseList(document.getElementById('sn-remove').value);

    const conflicts = keep.filter(sn=>rem.includes(sn));
    const missing = keep.filter(sn=>!idx.has(sn));
    const multi = [...idx.entries()].filter(e=>e[1].length>1).map(e=>e[0]);

    let msg=[];
    if(conflicts.length) msg.push(`Konflikt Behalten/Entfernen: ${conflicts.join(', ')}`);
    if(missing.length) msg.push(`Fehlen im Angebot: ${missing.join(', ')}`);
    if(multi.length) msg.push(`Mehrfach vorhanden: ${multi.join(', ')}`);
    if(!msg.length) msg.push('Preview OK');

    document.getElementById('sn-msg').textContent = msg.join(' | ');
  };

  /* ================= Hinzufügen Dialog ================= */

  function openAddDialog(addList, items){
    let remaining = [...addList];

    const dlg = document.createElement('div');
    dlg.className='hw24-sn-dialog';

    const box = document.createElement('div');
    box.className='hw24-sn-box';

    function render(){
      box.innerHTML = `<h3>Seriennummern zuordnen</h3>`;

      if(!remaining.length){
        box.innerHTML += `<p>Alle Seriennummern wurden zugeordnet.</p>`;
        const close = document.createElement('button');
        close.textContent='Schließen';
        close.onclick=()=>dlg.remove();
        box.appendChild(close);
        return;
      }

      const snWrap = document.createElement('div');
      snWrap.innerHTML = `<b>Seriennummern</b>`;
      remaining.forEach(sn=>{
        const d=document.createElement('div');
        d.className='hw24-sn-sn';
        d.innerHTML=`<label><input type="checkbox" value="${sn}"> ${sn}</label>`;
        snWrap.appendChild(d);
      });

      const prodWrap = document.createElement('div');
      prodWrap.innerHTML = `<b>Position wählen</b>`;
      items.forEach(it=>{
        const d=document.createElement('div');
        d.className='hw24-sn-prod';
        d.innerHTML=`
          <label>
            <input type="radio" name="hw24-sn-target" value="${it.rn}">
            ${it.prodName}
          </label>
        `;
        prodWrap.appendChild(d);
      });

      const assign = document.createElement('button');
      assign.textContent='Ausgewählte Seriennummern zuordnen';
      assign.onclick=()=>{
        const sns=[...snWrap.querySelectorAll('input[type=checkbox]:checked')].map(i=>i.value);
        const sel=prodWrap.querySelector('input[type=radio]:checked');
        if(!sns.length||!sel){ alert('Bitte Seriennummer(n) UND Position wählen'); return; }

        const it=items.find(x=>x.rn===sel.value);
        sns.forEach(sn=>{
          if(!it.sns.includes(sn)) it.sns.push(sn);
          remaining=remaining.filter(x=>x!==sn);
        });
        render();
      };

      box.appendChild(snWrap);
      box.appendChild(prodWrap);
      box.appendChild(assign);
    }

    render();
    dlg.appendChild(box);
    document.body.appendChild(dlg);
  }

  /* ================= Apply ================= */

  document.getElementById('sn-apply').onclick = ()=>{
    const items = getLineItems();
    SNAPSHOT = snapshot(items);
    document.getElementById('sn-undo').disabled=false;

    const rem  = parseList(document.getElementById('sn-remove').value);
    const add  = parseList(document.getElementById('sn-add').value);

    // Entfernen
    items.forEach(it=>{
      it.sns = it.sns.filter(sn=>!rem.includes(sn));
    });

    // Hinzufügen Dialog
    if(add.length){
      openAddDialog(add, items);
    }

    // Write back
    items.forEach(it=>{
      const snLine = it.sns.length ? `S/N: ${it.sns.join(', ')}` : '';
      let rest = it.desc.replace(/S\/N\s*:[^\n\r]+/i,'').trim();
      it.descEl.value = [snLine,rest].filter(Boolean).join('\n');
      fire(it.descEl);
      if(it.qtyEl){
        it.qtyEl.value = it.sns.length;
        fire(it.qtyEl);
      }
    });

    document.getElementById('sn-msg').textContent='Apply durchgeführt';
  };

  /* ================= Undo ================= */

  document.getElementById('sn-undo').onclick = ()=>{
    if(!SNAPSHOT) return;
    restore(SNAPSHOT);
    document.getElementById('sn-msg').textContent='Undo durchgeführt';
  };

})();
