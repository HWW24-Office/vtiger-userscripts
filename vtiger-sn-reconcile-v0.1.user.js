// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.7.2
// @description  SN-Abgleich mit harter Behalten/Entfernen/Hinzufügen-Logik, Zuordnungsdialog, Preview & Undo
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
      box-sizing:border-box!important;
      background:#111!important;
      color:#fff!important;
      font-family:system-ui,Segoe UI,Roboto,Arial!important;
    }
    .hw24-sn-panel textarea,
    .hw24-sn-panel button {
      background:#fff!important;
      color:#111!important;
      border:1px solid #444!important;
    }
    .hw24-sn-dialog {
      position:fixed; inset:0;
      background:rgba(0,0,0,.6)!important;
      z-index:2147483647;
      display:flex; align-items:center; justify-content:center;
    }
    .hw24-sn-dialog, .hw24-sn-dialog * {
      background:#fff!important;
      color:#111!important;
    }
    .hw24-sn-box {
      width:90%; max-width:1100px;
      max-height:80vh; overflow:auto;
      padding:16px; border-radius:10px;
    }
    .hw24-sn-sn { padding:6px 0; border-bottom:1px dashed #ccc }
    .hw24-sn-prod { border:1px solid #ccc; border-radius:8px; padding:8px; margin:6px 0 }
  `;
  document.head.appendChild(css);

  /* ================= Utilities ================= */

  const S = s => (s || '').toString().trim();
  const norm = s => S(s).toUpperCase().replace(/[\s\u00A0]/g, '');
  const uniq = a => [...new Set(a)];
  const parseList = t => uniq(S(t).split(/[\n,;]+/).map(norm).filter(Boolean));

  const fire = el => el && ['input','change','blur'].forEach(e =>
    el.dispatchEvent(new Event(e,{bubbles:true}))
  );

  /* ================= Line Items ================= */

  function getLineItems(){
    const rows = [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')];
    return rows.map(tr=>{
      const rn = tr.getAttribute('data-row-num') || tr.id.replace('row','');
      const descEl =
        tr.querySelector('textarea[name*="comment"], textarea[name*="description"]') ||
        tr.querySelector('input[name*="comment"], input[name*="description"]');

      const desc = S(descEl?.value);
      const m = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
      const sns = m ? parseList(m[1]) : [];

      const prodName =
        S(tr.querySelector(`#productName${rn}`)?.textContent) ||
        `Position ${rn}`;

      const qtyEl = tr.querySelector('input[name^="qty"]');

      return { tr, rn, descEl, desc, sns, prodName, qtyEl };
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

  /* ================= Snapshot ================= */

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

  /* ================= Panel ================= */

  const p = document.createElement('div');
  p.id='hw24-sn-panel';
  p.className='hw24-sn-panel';
  p.style.cssText='position:fixed;bottom:16px;left:16px;width:340px;padding:12px;border-radius:10px;z-index:2147483646';
  p.innerHTML=`
    <b>SN-Abgleich</b>
    <label>Behalten (Soll)</label>
    <textarea id="sn-keep" style="width:100%;height:50px"></textarea>
    <label>Entfernen</label>
    <textarea id="sn-remove" style="width:100%;height:50px"></textarea>
    <label>Hinzufügen</label>
    <textarea id="sn-add" style="width:100%;height:50px"></textarea>
    <div style="display:flex;gap:6px;margin-top:6px">
      <button id="sn-preview">Preview</button>
      <button id="sn-apply">Apply</button>
      <button id="sn-undo" disabled>Undo</button>
    </div>
    <div id="sn-msg" style="margin-top:6px;color:#ffd966"></div>
  `;
  document.body.appendChild(p);

  const snMsg = document.getElementById('sn-msg');

  /* ================= Preview ================= */

  document.getElementById('sn-preview').onclick = ()=>{
    const items = getLineItems();
    const idx = buildSNIndex(items);

    const keep = parseList(snKeep.value);
    const rem  = parseList(snRemove.value);
    const add  = parseList(snAdd.value);

    let msg=[];

    const conflicts = keep.filter(sn=>rem.includes(sn));
    if(conflicts.length) msg.push(`❌ Konflikt Behalten/Entfernen: ${conflicts.join(', ')}`);

    const keepMissing = keep.filter(sn=>!idx.has(sn));
    if(keepMissing.length) msg.push(`⚠ Produkt fehlt (Behalten): ${keepMissing.join(', ')}`);

    const remMissing = rem.filter(sn=>!idx.has(sn) && !keep.includes(sn));
    if(remMissing.length) msg.push(`⚠ Entfernen – nicht gefunden: ${remMissing.join(', ')}`);

    const addExists = add.filter(sn=>idx.has(sn));
    if(addExists.length) msg.push(`🚫 Hinzufügen nicht möglich (bereits vorhanden): ${addExists.join(', ')}`);

    const addBlocked = add.filter(sn=>keep.includes(sn));
    if(addBlocked.length) msg.push(`🚫 Hinzufügen blockiert (Behalten): ${addBlocked.join(', ')}`);

    if(!msg.length) msg.push('✅ Preview OK');
    snMsg.textContent = msg.join(' | ');
  };

  /* ================= Add Dialog ================= */

  function openAddDialog(addList, items, onDone){
    let remaining=[...addList];
    const dlg=document.createElement('div');
    dlg.className='hw24-sn-dialog';
    const box=document.createElement('div');
    box.className='hw24-sn-box';

    function render(){
      box.innerHTML='<h3>Seriennummern zuordnen</h3>';
      if(!remaining.length){
        const b=document.createElement('button');
        b.textContent='Schließen';
        b.onclick=()=>{ dlg.remove(); onDone(); };
        box.appendChild(b);
        return;
      }

      const snWrap=document.createElement('div');
      remaining.forEach(sn=>{
        const d=document.createElement('div');
        d.className='hw24-sn-sn';
        d.innerHTML=`<label><input type="checkbox" value="${sn}"> ${sn}</label>`;
        snWrap.appendChild(d);
      });

      const prodWrap=document.createElement('div');
      items.forEach(it=>{
        const d=document.createElement('div');
        d.className='hw24-sn-prod';
        d.innerHTML=`<label><input type="radio" name="hw24-sn-target" value="${it.rn}"> ${it.prodName}</label>`;
        prodWrap.appendChild(d);
      });

      const assign=document.createElement('button');
      assign.textContent='Zuordnen';
      assign.onclick=()=>{
        const sns=[...snWrap.querySelectorAll('input:checked')].map(i=>i.value);
        const sel=prodWrap.querySelector('input:checked');
        if(!sns.length||!sel) return alert('SN und Position wählen');
        const it=items.find(x=>x.rn===sel.value);
        sns.forEach(sn=>{
          if(it.sns.includes(sn)) return;
          it.sns.push(sn);
          remaining=remaining.filter(x=>x!==sn);
        });
        render();
      };

      box.append(snWrap,prodWrap,assign);
    }

    render();
    dlg.appendChild(box);
    document.body.appendChild(dlg);
  }

  /* ================= Apply ================= */

  document.getElementById('sn-apply').onclick=()=>{
    const items=getLineItems();
    SNAPSHOT=snapshot(items);
    document.getElementById('sn-undo').disabled=false;

    const idx=buildSNIndex(items);
    const keep=new Set(parseList(snKeep.value));
    const rem=parseList(snRemove.value).filter(sn=>!keep.has(sn));
    const add=parseList(snAdd.value).filter(sn=>!keep.has(sn)&&!idx.has(sn));

    items.forEach(it=>{
      it.sns=it.sns.filter(sn=>!rem.includes(sn));
    });

    const writeBack=()=>{
      items.forEach(it=>{
        const snLine=it.sns.length?`S/N: ${it.sns.join(', ')}`:'';
        const rest=it.desc.replace(/S\/N\s*:[^\n\r]+/i,'').trim();
        it.descEl.value=[snLine,rest].filter(Boolean).join('\n');
        fire(it.descEl);
        if(it.qtyEl){ it.qtyEl.value=it.sns.length; fire(it.qtyEl); }
      });
      snMsg.textContent='Apply durchgeführt';
    };

    if(add.length){
      openAddDialog(add,items,writeBack);
    } else {
      writeBack();
    }
  };

  /* ================= Undo ================= */

  document.getElementById('sn-undo').onclick=()=>{
    if(SNAPSHOT) restore(SNAPSHOT);
    snMsg.textContent='Undo durchgeführt';
  };

})();
