// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.7.3
// @description  Fix UI color regression and re-enable add dialog (step 1)
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
     HARD CSS RESET (FINAL FIX)
     ========================= */
  const css = document.createElement('style');
  css.textContent = `
    /* PANEL */
    #hw24-sn-panel {
      background:#111 !important;
      color:#fff !important;
      font-family:system-ui,Segoe UI,Roboto,Arial !important;
    }
    #hw24-sn-panel label,
    #hw24-sn-panel b,
    #hw24-sn-panel div {
      color:#fff !important;
    }
    #hw24-sn-panel textarea,
    #hw24-sn-panel button {
      background:#fff !important;
      color:#111 !important;
      border:1px solid #444 !important;
    }

    /* DIALOG OVERLAY */
    .hw24-sn-dialog {
      position:fixed;
      inset:0;
      background:rgba(0,0,0,.6) !important;
      z-index:2147483647;
      display:flex;
      align-items:center;
      justify-content:center;
    }

    /* DIALOG BOX */
    .hw24-sn-box {
      background:#fff !important;
      color:#111 !important;
      width:90%;
      max-width:1000px;
      max-height:80vh;
      overflow:auto;
      padding:16px;
      border-radius:10px;
      font-family:system-ui,Segoe UI,Roboto,Arial !important;
    }
    .hw24-sn-box * {
      color:#111 !important;
      background:transparent !important;
    }
    .hw24-sn-sn {
      padding:6px 0;
      border-bottom:1px dashed #ccc;
    }
    .hw24-sn-prod {
      border:1px solid #ccc;
      border-radius:6px;
      padding:6px;
      margin:4px 0;
    }
    .hw24-sn-box button {
      background:#111 !important;
      color:#fff !important;
      border:1px solid #333 !important;
      padding:6px 10px;
      border-radius:4px;
      cursor:pointer;
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

  /* ================= Panel ================= */

  const panel = document.createElement('div');
  panel.id = 'hw24-sn-panel';
  panel.style.cssText = `
    position:fixed;
    bottom:16px;
    left:16px;
    width:340px;
    padding:12px;
    border-radius:10px;
    z-index:2147483646;
  `;
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

  /* ================= Snapshot / Undo ================= */

  let SNAPSHOT = null;
  const snapshot = items => items.map(it=>({
    rn: it.rn,
    desc: it.descEl?.value,
    qty: it.qtyEl?.value
  }));

  const restore = snap => snap.forEach(s=>{
    const tr = document.getElementById('row'+s.rn) ||
               document.querySelector(\`tr[data-row-num="\${s.rn}"]\`);
    if(!tr) return;
    const d = tr.querySelector('textarea[name*="comment"], textarea[name*="description"]');
    const q = tr.querySelector('input[name^="qty"]');
    if(d){ d.value=s.desc; fire(d); }
    if(q){ q.value=s.qty; fire(q); }
  });

  /* ================= Preview ================= */

  $('sn-preview').onclick = ()=>{
    const items = getLineItems();
    const idx = buildSNIndex(items);

    const keep = parseList($('sn-keep').value);
    const rem  = parseList($('sn-remove').value);
    const add  = parseList($('sn-add').value);

    const msg = [];

    const conflicts = keep.filter(sn=>rem.includes(sn));
    if(conflicts.length) msg.push(`❌ Konflikt Behalten/Entfernen: ${conflicts.join(', ')}`);

    const keepMissing = keep.filter(sn=>!idx.has(sn));
    if(keepMissing.length) msg.push(`⚠ Behalten fehlt: ${keepMissing.join(', ')}`);

    const remMissing = rem.filter(sn=>!idx.has(sn) && !keep.includes(sn));
    if(remMissing.length) msg.push(`⚠ Entfernen fehlt: ${remMissing.join(', ')}`);

    const addExists = add.filter(sn=>idx.has(sn));
    if(addExists.length) msg.push(`🚫 Bereits vorhanden: ${addExists.join(', ')}`);

    $('sn-msg').textContent = msg.length ? msg.join(' | ') : '✅ Preview OK';
  };

  /* ================= Add Dialog (STEP 1) ================= */

  function openAddDialog(addList, items, onDone){
    let remaining = [...addList];

    const dlg = document.createElement('div');
    dlg.className = 'hw24-sn-dialog';

    const box = document.createElement('div');
    box.className = 'hw24-sn-box';

    function render(){
      box.innerHTML = '<h3>Seriennummern zuordnen</h3>';

      if(!remaining.length){
        const close = document.createElement('button');
        close.textContent = 'Schließen';
        close.onclick = ()=>{ dlg.remove(); onDone(); };
        box.appendChild(close);
        return;
      }

      const snWrap = document.createElement('div');
      remaining.forEach(sn=>{
        const d = document.createElement('div');
        d.className = 'hw24-sn-sn';
        d.innerHTML = `<label><input type="checkbox" value="${sn}"> ${sn}</label>`;
        snWrap.appendChild(d);
      });

      const prodWrap = document.createElement('div');
      items.forEach(it=>{
        const d = document.createElement('div');
        d.className = 'hw24-sn-prod';
        d.innerHTML = `
          <label>
            <input type="radio" name="hw24-sn-target" value="${it.rn}">
            ${it.prodName}
          </label>`;
        prodWrap.appendChild(d);
      });

      const assign = document.createElement('button');
      assign.textContent = 'Zuordnen';
      assign.onclick = ()=>{
        const sns = [...snWrap.querySelectorAll('input[type=checkbox]:checked')]
          .map(i=>i.value);
        const sel = prodWrap.querySelector('input[type=radio]:checked');
        if(!sns.length || !sel) return alert('Bitte Seriennummer(n) und Position wählen');

        const it = items.find(x=>x.rn===sel.value);
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

  /* ================= Apply ================= */

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
        it.descEl.value = [snLine, rest].filter(Boolean).join('\n');
        fire(it.descEl);
        if(it.qtyEl){ it.qtyEl.value = it.sns.length; fire(it.qtyEl); }
      });
      $('sn-msg').textContent = 'Apply durchgeführt';
    };

    if(add.length){
      openAddDialog(add, items, writeBack);
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
