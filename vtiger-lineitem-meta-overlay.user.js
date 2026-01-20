// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.2.0
// @description  Meta overlay + maintenance auditor with tooltip, DE/EN toggle and manual standardization
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  /* ===============================
     MODULE DETECTION
     =============================== */

  const SUPPORTED_MODULES = ['Quotes','SalesOrder','Invoice','PurchaseOrder','Products'];

  const currentModule =
    location.href.match(new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`))?.[1] || '';

  const isEdit =
    location.href.includes('view=Edit') &&
    SUPPORTED_MODULES.includes(currentModule);

  if (!isEdit) return;

  /* ===============================
     LANGUAGE
     =============================== */

  let currentLang = 'de';

  const I18N = {
    de: {
      ok: '🟢 Wartung: OK',
      quoteOk: '🟡 Wartung: Quote (TBA ok)',
      noDesc: '🔴 Wartung: Keine Beschreibung',
      noSn: '🟡 Wartung: Keine S/N',
      noDates: '🔴 Wartung: Fehlende Service-Daten',
      qtyMismatch: (q,s)=>`🟡 Wartung: Quantity (${q}) ≠ S/N (${s})`,
      start: 'Service Start',
      end: 'Service Ende',
      location: 'Standort',
      incl: 'inkl.'
    },
    en: {
      ok: '🟢 Maintenance: OK',
      quoteOk: '🟡 Maintenance: Quote (TBA ok)',
      noDesc: '🔴 Maintenance: No description',
      noSn: '🟡 Maintenance: No S/N',
      noDates: '🔴 Maintenance: Missing service dates',
      qtyMismatch: (q,s)=>`🟡 Maintenance: Qty (${q}) ≠ S/N (${s})`,
      start: 'Service Start',
      end: 'Service End',
      location: 'Location',
      incl: 'incl.'
    }
  };

  /* ===============================
     UTILITIES
     =============================== */

  const debounce = (fn, ms) => {
    let t; return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};
  };

  function extractSerials(desc) {
    const out=[];
    const re=/S\/N:\s*([^\n]+)/gi;
    let m;
    while((m=re.exec(desc))){
      m[1].split(/[,;\/]/).map(s=>s.trim()).filter(Boolean).forEach(sn=>out.push(sn));
    }
    return [...new Set(out)];
  }

  function extractDate(desc,label){
    const r=new RegExp(`${label}:\\s*(\\d{2}\\.\\d{2}\\.\\d{4}|tba|\\[nicht angegeben\\])`,'i');
    return desc.match(r)?.[1]||'';
  }

  function getQuantity(tr,rn){
    const q=tr.querySelector(`#qty${rn},#quantity${rn},input[name="qty${rn}"],input[name="quantity${rn}"]`);
    const v=parseInt(q?.value,10);
    return Number.isFinite(v)?v:0;
  }

  /* ===============================
     AUDIT
     =============================== */

  function audit(desc,qty,productName){
    const t=I18N[currentLang];
    if(!desc) return {text:t.noDesc};

    const sn=extractSerials(desc);
    const start=extractDate(desc,t.start);
    const end=extractDate(desc,t.end);
    const fasAff=/\b(FAS|AFF|ASA)\d+/i.test(productName||'');

    if(currentModule==='Quotes' && (!start||!end)){
      return {text:t.quoteOk,tooltip:{sn,start,end,qty}};
    }
    if(!sn.length) return {text:t.noSn,tooltip:{sn,start,end,qty}};
    if(!start||!end) return {text:t.noDates,tooltip:{sn,start,end,qty}};
    if(!(fasAff&&qty===1)&&sn.length!==qty){
      return {text:t.qtyMismatch(qty,sn.length),tooltip:{sn,start,end,qty}};
    }
    return {text:t.ok,tooltip:{sn,start,end,qty}};
  }

  /* ===============================
     UI HELPERS
     =============================== */

  function ensureAuditor(info){
    let d=info.querySelector('.hw24-auditor');
    if(!d){
      d=document.createElement('div');
      d.className='hw24-auditor';
      d.style.cssText='margin-top:4px;font-size:11px;font-weight:bold;cursor:help';
      info.appendChild(d);
    }
    return d;
  }

  function setTooltip(el,data){
    el.title=
      `S/N: ${data.sn.join(', ')||'—'}\n`+
      `Qty: ${data.qty}\n`+
      `Start: ${data.start||'—'}\n`+
      `End: ${data.end||'—'}`;
  }

  /* ===============================
     STANDARDIZE (PREVIEW ONLY)
     =============================== */

  function standardize(desc){
    const sn=extractSerials(desc);
    const start=extractDate(desc,I18N[currentLang].start);
    const end=extractDate(desc,I18N[currentLang].end);

    let out=`S/N: ${sn.join(', ')}`;
    if(start) out+=`\n${I18N[currentLang].start}: ${start}`;
    if(end) out+=`\n${I18N[currentLang].end}: ${end}`;
    return out;
  }

  function showPreview(textarea){
    const orig=textarea.value;
    const std=standardize(orig);

    if(orig===std) return alert('Bereits standardisiert');

    if(confirm(`Original:\n\n${orig}\n\nNeu:\n\n${std}\n\nÜbernehmen?`)){
      textarea.value=std;
      textarea.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }

  /* ===============================
     PROCESS
     =============================== */

  async function process(){
    const rows=[...document.querySelectorAll('#lineItemTab tr.lineItemRow[id^="row"],tr.inventoryRow')];

    rows.forEach(tr=>{
      const rn=tr.getAttribute('data-row-num')||tr.id.replace('row','');
      const descEl=tr.querySelector('textarea[name*="comment"]');
      if(!descEl) return;

      const productName=tr.querySelector(`#productName${rn}`)?.value||'';
      const qty=getQuantity(tr,rn);

      const info=tr.querySelector('.vt-prodinfo');
      if(!info) return;

      const res=audit(descEl.value,qty,productName);
      const aud=ensureAuditor(info);
      aud.textContent=res.text;
      if(res.tooltip) setTooltip(aud,res.tooltip);

      if(!aud.querySelector('button')){
        const b=document.createElement('button');
        b.textContent='✎';
        b.style.cssText='margin-left:6px;font-size:10px';
        b.onclick=()=>showPreview(descEl);
        aud.appendChild(b);
      }
    });
  }

  /* ===============================
     PANEL
     =============================== */

  const panel=document.createElement('div');
  panel.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#111;color:#fff;padding:8px;border-radius:8px;font-size:12px';
  panel.innerHTML=`
    <button id="lang">DE / EN</button>
  `;
  panel.querySelector('#lang').onclick=()=>{
    currentLang=currentLang==='de'?'en':'de';
    process();
  };
  document.body.appendChild(panel);

  process();
  new MutationObserver(debounce(process,600))
    .observe(document.querySelector('#lineItemTab'),{childList:true,subtree:true});

})();
