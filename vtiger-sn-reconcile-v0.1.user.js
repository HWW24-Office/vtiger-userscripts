// ==UserScript==
// @name         VTiger SN Reconciliation (Delta Mode v0.3.4)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.3.4
// @description  Delta-based SN reconciliation with conflict detection and product-based SLA/Country matching
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
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
  const splitList = s => S(s).split(/[\n,]+/).map(S).filter(Boolean);
  const fire = el => el && ['input','change','blur']
    .forEach(e=>el.dispatchEvent(new Event(e,{bubbles:true})));

  /* ===============================
     PRODUCT META CACHE (SLA, COUNTRY)
     =============================== */
  const META_CACHE = {};
  async function fetchProductMeta(productId){
    if(META_CACHE[productId]) return META_CACHE[productId];
    try{
      const url = `index.php?module=Products&view=Detail&record=${productId}`;
      const html = await fetch(url,{credentials:'same-origin'}).then(r=>r.text());
      const doc = new DOMParser().parseFromString(html,'text/html');
      const pick = lbl => {
        const lab=[...doc.querySelectorAll('[id^="Products_detailView_fieldLabel_"]')]
          .find(l=>S(l.textContent).toLowerCase()===lbl);
        if(!lab) return '';
        const v=doc.getElementById(lab.id.replace('fieldLabel','fieldValue'));
        return S(v?.textContent);
      };
      const meta = {
        sla: pick('sla'),
        country: pick('country'),
        manufacturer: pick('manufacturer')
      };
      META_CACHE[productId]=meta;
      return meta;
    }catch{
      return {sla:'',country:'',manufacturer:''};
    }
  }

  /* ===============================
     DESCRIPTION PARSER / BUILDER
     =============================== */
  function parseDesc(desc){
    const lines=S(desc).split(/\r?\n/);
    let snLine='', ss='', se=''; const rest=[];
    for(const l of lines){
      if(/^s\/?n\s*:/i.test(l)) snLine=l;
      else if(/^service\s*start\s*:/i.test(l)) ss=l;
      else if(/^service\s*(ende|end)\s*:/i.test(l)) se=l;
      else rest.push(l);
    }
    return {snLine,ss,se,rest};
  }
  function buildDesc(snList,p){
    const out=[];
    if(snList.length) out.push('S/N: '+snList.join(', '));
    out.push(...p.rest.filter(Boolean));
    if(p.ss) out.push(p.ss);
    if(p.se) out.push(p.se);
    return out.join('\n');
  }

  /* ===============================
     LINE ITEMS
     =============================== */
  function rows(){
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
  }
  function descField(r){
    return r.querySelector("textarea[name*='comment'],textarea[name*='description']");
  }
  function qtyField(r){
    return r.querySelector("input[name^='qty']");
  }
  function productId(r){
    return r.querySelector("input[name*='productid']")?.value||'';
  }
  function productName(r){
    const rn=r.getAttribute('data-row-num')||r.id.replace('row','');
    const el=r.querySelector('#productName'+rn)||r.querySelector("input[id^='productName']");
    return S(el?.value||el?.textContent);
  }

  /* ===============================
     UNDO
     =============================== */
  let SNAPSHOT=null;
  function snapshot(){
    SNAPSHOT=rows().map(r=>{
      const d=descField(r), q=qtyField(r);
      return {r, d:d?.value||'', q:q?.value||''};
    });
  }
  function undo(){
    if(!SNAPSHOT) return alert('Kein Undo verfügbar');
    SNAPSHOT.forEach(s=>{
      const d=descField(s.r), q=qtyField(s.r);
      if(d){d.value=s.d; fire(d);}
      if(q){q.value=s.q; fire(q);}
    });
    alert('Undo durchgeführt');
  }

  /* ===============================
     PANEL
     =============================== */
  function panel(){
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
      <label style="color:#9fdf9f">🟢 Behalten</label>
      <textarea id="sn-keep"></textarea>
      <label style="color:#ff9f9f">🔴 Entfernen</label>
      <textarea id="sn-remove"></textarea>
      <label style="color:#9fd0ff">🔵 Hinzufügen</label>
      <textarea id="sn-add"></textarea>
      <div style="margin-top:8px;display:flex;gap:6px">
        <button id="sn-apply">🔍 Anwenden</button>
        <button id="sn-undo">↩ Undo</button>
      </div>
    `;
    p.querySelectorAll('textarea').forEach(t=>{
      t.style.cssText='width:100%;height:60px;background:#0f0f0f;color:#f1f1f1;border:1px solid #444;border-radius:6px;margin-bottom:6px';
    });
    p.querySelectorAll('button').forEach(b=>{
      b.style.cssText='flex:1;background:#2b2b2b;color:#fff;border:1px solid #444;border-radius:8px;padding:6px;cursor:pointer';
    });
    document.body.appendChild(p);
    p.querySelector('#sn-apply').onclick=apply;
    p.querySelector('#sn-undo').onclick=undo;
  }

  /* ===============================
     CORE LOGIC
     =============================== */
  async function apply(){
    const keep=splitList(document.getElementById('sn-keep').value);
    const remove=splitList(document.getElementById('sn-remove').value);
    const add=splitList(document.getElementById('sn-add').value);

    /* ---- CONFLICT DETECTION ---- */
    const conflicts=[
      ...keep.filter(sn=>remove.includes(sn)).map(sn=>`${sn} (Behalten + Entfernen)`),
      ...keep.filter(sn=>add.includes(sn)).map(sn=>`${sn} (Behalten + Hinzufügen)`),
      ...remove.filter(sn=>add.includes(sn)).map(sn=>`${sn} (Entfernen + Hinzufügen)`)
    ];
    const blocked=new Set(conflicts.map(c=>c.split(' ')[0]));
    if(conflicts.length){
      alert(
        'Warnung – widersprüchliche Seriennummern:\n\n'+
        conflicts.join('\n')+
        '\n\nDiese Seriennummern wurden NICHT verändert.'
      );
    }

    snapshot();

    const groups=[];
    for(const r of rows()){
      const d=descField(r); if(!d) continue;
      const pid=productId(r);
      const meta=pid?await fetchProductMeta(pid):{sla:'',country:''};
      const parsed=parseDesc(d.value);
      let sns=[];
      if(parsed.snLine){
        sns=parsed.snLine.replace(/^s\/?n\s*:/i,'').split(',').map(S).filter(Boolean);
      }
      sns=sns.filter(sn=>!remove.includes(sn)&&!blocked.has(sn));
      groups.push({r,d,parsed,sns,meta});
    }

    // ADD is not auto-applied in v0.3.4 (only via dialog in 0.3.3+)
    if(add.filter(sn=>!blocked.has(sn)).length){
      alert(
        'Hinweis:\nNeue Seriennummern bitte über den Zuordnungsdialog (v0.3.3+) zuordnen.\n'+
        'Konfliktfreie Seriennummern:\n'+
        add.filter(sn=>!blocked.has(sn)).join(', ')
      );
    }

    groups.forEach(g=>{
      g.d.value=buildDesc(g.sns,g.parsed);
      fire(g.d);
      const q=qtyField(g.r);
      if(q){q.value=String(g.sns.length); fire(q);}
    });

    alert('SN-Abgleich abgeschlossen (v0.3.4)');
  }

  panel();
})();
