// ==UserScript==
// @name         VTiger SN Reconciliation (Delta Mode v0.3.3)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.3.3
// @description  Delta-based SN reconciliation with batch assignment dialog, multi-product mapping, readable UI and undo
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /* ===============================
     MODE CHECK
     =============================== */
  if (
    !location.href.includes('view=Edit') ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* ===============================
     UTILS
     =============================== */
  const S = s => (s || '').toString().trim();
  const splitList = s => S(s).split(/[\n,]+/).map(x => S(x)).filter(Boolean);
  const fire = el => el && ['input','change','blur'].forEach(e=>el.dispatchEvent(new Event(e,{bubbles:true})));

  /* ===============================
     DESCRIPTION PARSER / BUILDER
     Order: S/N -> rest -> Service Start -> Service End
     =============================== */
  function parseDesc(desc){
    const lines = S(desc).split(/\r?\n/);
    let snLine='', ss='', se=''; const rest=[];
    for(const l of lines){
      if(/^s\/?n\s*:/i.test(l)) snLine=l;
      else if(/^service\s*start\s*:/i.test(l)) ss=l;
      else if(/^service\s*(ende|end)\s*:/i.test(l)) se=l;
      else rest.push(l);
    }
    return {snLine, ss, se, rest};
  }
  function buildDesc(snList, parsed){
    const out=[];
    if(snList.length) out.push('S/N: '+snList.join(', '));
    out.push(...parsed.rest.filter(Boolean));
    if(parsed.ss) out.push(parsed.ss);
    if(parsed.se) out.push(parsed.se);
    return out.join('\n');
  }

  /* ===============================
     LINE ITEMS
     =============================== */
  function getRows(){
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
  }
  function getDescField(r){
    return r.querySelector("textarea[name*='comment'],textarea[name*='description']");
  }
  function getQtyField(r){
    return r.querySelector("input[name^='qty']");
  }
  function getProductName(r){
    const rn = r.getAttribute('data-row-num') || r.id.replace('row','');
    const el = r.querySelector('#productName'+rn) || r.querySelector('input[id^="productName"]');
    return S(el ? (el.value||el.textContent) : '');
  }
  function getCountry(r){
    const d = getDescField(r); if(!d) return '';
    const m = S(d.value).match(/country\s*:\s*([^\n]+)/i);
    return m?S(m[1]):'';
  }
  function getSLA(r){
    const d = getDescField(r); if(!d) return '';
    const m = S(d.value).match(/sla\s*:\s*([^\n]+)/i);
    return m?S(m[1]):'';
  }
  function getDates(r){
    const d = getDescField(r); if(!d) return {ss:'',se:''};
    const ss = (S(d.value).match(/^service\s*start\s*:\s*(.+)$/im)||[])[1]||'';
    const se = (S(d.value).match(/^service\s*(?:ende|end)\s*:\s*(.+)$/im)||[])[1]||'';
    return {ss:S(ss), se:S(se)};
  }
  function groupKey(r){
    const {ss,se}=getDates(r);
    return [getProductName(r), getSLA(r), getCountry(r), ss, se].join('||');
  }

  /* ===============================
     STATE (UNDO)
     =============================== */
  let SNAPSHOT=null;
  function snapshot(){
    SNAPSHOT=getRows().map(r=>{
      const d=getDescField(r), q=getQtyField(r);
      return {r, d:d?d.value:'', q:q?q.value:''};
    });
  }
  function undo(){
    if(!SNAPSHOT) return alert('Kein Undo verfügbar');
    SNAPSHOT.forEach(s=>{
      const d=getDescField(s.r), q=getQtyField(s.r);
      if(d){d.value=s.d; fire(d);}
      if(q){q.value=s.q; fire(q);}
    });
    alert('Undo durchgeführt');
  }

  /* ===============================
     UI PANEL
     =============================== */
  function addPanel(){
    if(document.getElementById('hw24-sn-panel')) return;
    const p=document.createElement('div');
    p.id='hw24-sn-panel';
    p.style.cssText=`
      position:fixed;right:16px;bottom:16px;z-index:2147483647;
      background:#111;color:#eee;padding:12px;border-radius:10px;width:420px;
      font:13px/1.4 system-ui,Segoe UI,Roboto,Arial;
      box-shadow:0 6px 20px rgba(0,0,0,.35)
    `;
    p.innerHTML=`
      <b>SN Abgleich (Delta)</b><br><br>
      <label style="color:#9fdf9f">🟢 Behalten (Validierung)</label>
      <textarea id="sn-keep"></textarea>
      <label style="color:#ff9f9f">🔴 Entfernen</label>
      <textarea id="sn-remove"></textarea>
      <label style="color:#9fd0ff">🔵 Hinzufügen</label>
      <textarea id="sn-add"></textarea>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button id="sn-apply">🔍 Anwenden</button>
        <button id="sn-undo">↩ Undo</button>
      </div>
      <div style="margin-top:8px;font-size:11px;opacity:.85">
        <b>Legende</b><br>
        🟢 OK · 🔴 Entfernt · 🔵 Neu · 🟣 Mehrfach · ⚠ Produkt fehlt
      </div>
    `;
    p.querySelectorAll('textarea').forEach(t=>{
      t.style.cssText='width:100%;height:60px;background:#0f0f0f;color:#f1f1f1;border:1px solid #444;border-radius:6px;margin-bottom:6px';
    });
    p.querySelectorAll('button').forEach(b=>{
      b.style.cssText='flex:1;background:#2b2b2b;color:#fff;border:1px solid #444;border-radius:8px;padding:6px;cursor:pointer';
    });
    document.body.appendChild(p);
    p.querySelector('#sn-apply').onclick=applyDelta;
    p.querySelector('#sn-undo').onclick=undo;
  }

  /* ===============================
     ASSIGNMENT DIALOG (BATCH)
     =============================== */
  function assignmentDialog(snPool, groups, onDone){
    let remaining=[...snPool];
    const parked=[];

    const dlg=document.createElement('div');
    dlg.style.cssText=`
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:#111;color:#eee;padding:14px;border-radius:10px;
      z-index:2147483647;width:640px;max-height:80vh;overflow:auto;
      box-shadow:0 8px 30px rgba(0,0,0,.5)
    `;

    function render(){
      dlg.innerHTML=`<b>Neue Seriennummern zuordnen</b><br><br>`;
      dlg.innerHTML+=`<div><b>Seriennummern (mehrfach auswählbar):</b></div>`;
      remaining.forEach(sn=>{
        dlg.innerHTML+=`<label style="display:block"><input type="checkbox" class="sn-cb" value="${sn}"> ${sn}</label>`;
      });
      dlg.innerHTML+=`<br><div><b>Zielprodukt:</b></div>`;
      groups.forEach((g,i)=>{
        const {ss,se}=getDates(g.r);
        dlg.innerHTML+=`
          <label style="display:block;margin:6px 0">
            <input type="radio" name="target" value="${i}">
            ${getProductName(g.r)} – SLA ${getSLA(g.r)||'—'} – ${getCountry(g.r)||'—'} – ${ss||'—'} → ${se||'—'}
          </label>`;
      });

      const btnRow=document.createElement('div');
      btnRow.style.cssText='margin-top:10px;display:flex;gap:8px;flex-wrap:wrap';

      const assign=document.createElement('button');
      assign.textContent='Zuordnen';
      assign.onclick=()=>{
        const selSN=[...dlg.querySelectorAll('.sn-cb:checked')].map(cb=>cb.value);
        const selT=dlg.querySelector('input[name="target"]:checked');
        if(!selSN.length) return alert('Bitte mindestens eine Seriennummer auswählen');
        if(!selT) return alert('Bitte ein Zielprodukt auswählen');
        const g=groups[Number(selT.value)];
        g.sns.push(...selSN);
        remaining=remaining.filter(sn=>!selSN.includes(sn));
        if(!remaining.length){ dlg.remove(); onDone(parked); }
        else render();
      };

      const park=document.createElement('button');
      park.textContent='Produkt fehlt – später hinzufügen';
      park.onclick=()=>{
        const selSN=[...dlg.querySelectorAll('.sn-cb:checked')].map(cb=>cb.value);
        if(!selSN.length) return alert('Bitte Seriennummern auswählen');
        parked.push(...selSN);
        remaining=remaining.filter(sn=>!selSN.includes(sn));
        if(!remaining.length){ dlg.remove(); onDone(parked); }
        else render();
      };

      const cancel=document.createElement('button');
      cancel.textContent='Abbrechen';
      cancel.onclick=()=>dlg.remove();

      [assign,park,cancel].forEach(b=>{
        b.style.cssText='flex:1;background:#2b2b2b;color:#fff;border:1px solid #444;border-radius:8px;padding:6px;cursor:pointer';
        btnRow.appendChild(b);
      });
      dlg.appendChild(btnRow);
    }

    render();
    document.body.appendChild(dlg);
  }

  /* ===============================
     CORE LOGIC
     =============================== */
  function applyDelta(){
    const keep=splitList(document.getElementById('sn-keep').value);
    const remove=splitList(document.getElementById('sn-remove').value);
    const add=splitList(document.getElementById('sn-add').value);

    snapshot();

    const groups = getRows().map(r=>{
      const d=getDescField(r), q=getQtyField(r), parsed=d?parseDesc(d.value):null;
      let sns=[];
      if(parsed && parsed.snLine){
        sns=parsed.snLine.replace(/^s\/?n\s*:/i,'').split(',').map(S).filter(Boolean);
      }
      // REMOVE only
      sns=sns.filter(sn=>!remove.includes(sn));
      return {r, d, q, parsed, sns};
    }).filter(g=>g.d);

    // Validate KEEP (no deletion)
    const allSN=groups.flatMap(g=>g.sns);
    const missingKeep=keep.filter(sn=>!allSN.includes(sn));
    if(missingKeep.length){
      alert('Warnung:\nFolgende Seriennummern aus "Behalten" fehlen:\n'+missingKeep.join(', '));
    }

    if(add.length){
      assignmentDialog(add, groups, parked=>{
        writeBack(groups);
        if(parked.length){
          alert('Nicht zugeordnet (Produkt fehlt):\n'+parked.join(', '));
        }
      });
    } else {
      writeBack(groups);
    }
  }

  function writeBack(groups){
    groups.forEach(g=>{
      g.d.value=buildDesc(g.sns, g.parsed);
      fire(g.d);
      if(g.q){ g.q.value=String(g.sns.length); fire(g.q); }
    });
    alert('SN-Abgleich abgeschlossen (v0.3.3)');
  }

  /* ===============================
     INIT
     =============================== */
  addPanel();

})();
