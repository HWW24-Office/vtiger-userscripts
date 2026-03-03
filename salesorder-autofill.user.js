// ==UserScript==
// @name         VTiger SalesOrder Helper Button
// @namespace    hw24.salesorder.helper
// @version      1.5.0
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/salesorder-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/salesorder-autofill.user.js
// @description  Autofill für POP, Status, Reverse Charge & Produktdaten
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (!location.href.includes('module=SalesOrder') || !location.href.includes('view=Edit')) return;

  function T(s){ return (s||"").toString().trim(); }
  function fire(e){ e && ["input","change","blur"].forEach(t=>e.dispatchEvent(new Event(t,{bubbles:true}))); }
  function fmt(d){ return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`; }

  function addBusinessDays(start, days){
    const d = new Date(start);
    while(days > 0){
      d.setDate(d.getDate() + 1);
      if(d.getDay() !== 0 && d.getDay() !== 6) days--;
    }
    return d;
  }

  function addMonthsMinusOneDay(start, months){
    const d = new Date(start);
    d.setMonth(d.getMonth() + months);
    d.setDate(d.getDate() - 1);
    return d;
  }

  function parseDateOrNull(s){
    s=T(s).toLowerCase();
    if(!s) return null;
    if(s==="tba") return null;
    if(s==="dd.mm.yyyy") return null;
    if(s.includes("nicht angegeben")) return null;
    const m=s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if(!m) return null;
    const d=new Date(m[3],m[2]-1,m[1]);
    return isNaN(d) ? null : d;
  }

  function extractDurationMonths(txt){
    const m = txt.match(/duration in months\s*:\s*(\d{1,3})/i);
    return m ? parseInt(m[1],10) : 12;
  }

  function replaceLine(desc, label, value){
    const rx = new RegExp(`(${label}\\s*:\\s*)(tba|dd\\.mm\\.yyyy|\\[[^\\]]+\\]|\\s*)`, "i");
    return rx.test(desc)
      ? desc.replace(rx, `$1${value}`)
      : desc + `\n${label}: ${value}`;
  }

  /* ── Vendor → Provider Servicebook Mapping ──────────────────────────── */

  const VENDOR_SERVICEBOOK_MAP = [
    { vendor: 'Axians',      servicebook: 'AX' },
    { vendor: 'Technogroup',  servicebook: 'EV' },
    { vendor: 'DIS',          servicebook: 'DIS' },
    { vendor: 'Inter Data',   servicebook: 'IDS' },
    { vendor: 'Park Place', country: 'usa',   servicebook: 'PP USA' },
    { vendor: 'Park Place', country: 'uk',    servicebook: 'PP UK' },
    { vendor: 'Park Place', country: 'eu',    servicebook: 'PP EU' },
    { vendor: 'Park Place', country: 'other', servicebook: 'PP-Mex-CentralAm-CarribbeanIslands' },
    { vendor: 'ITRIS',      country: 'de',    servicebook: 'ITRIS DE' },
    { vendor: 'ITRIS',      country: 'at',    servicebook: 'ITRIS AT' },
  ];

  const EU_COUNTRIES = [
    'france','italy','spain','netherlands','belgium','luxembourg','switzerland',
    'poland','czech republic','czechia','sweden','denmark','norway','finland',
    'portugal','greece','ireland','hungary','romania','bulgaria','croatia',
    'slovakia','slovenia','lithuania','latvia','estonia','malta','cyprus',
    'germany','deutschland','austria','österreich','de','at',
  ];

  function classifyCountry(countryStr) {
    const c = (countryStr || '').toString().trim().toLowerCase();
    if (!c) return 'other';
    if (['usa','united states','us','u.s.','u.s.a.'].some(k => c === k || c.includes(k))) return 'usa';
    if (['uk','united kingdom','gb','great britain','england'].some(k => c === k || c.includes(k))) return 'uk';
    if (['at','austria','österreich'].some(k => c === k || c.includes(k))) return 'at';
    if (['de','germany','deutschland'].some(k => c === k || c.includes(k))) return 'de';
    if (EU_COUNTRIES.some(k => c === k || c.includes(k))) return 'eu';
    return 'other';
  }

  function resolveServicebook(vendorName, countryStr) {
    const v = (vendorName || '').toLowerCase();
    const matches = VENDOR_SERVICEBOOK_MAP.filter(m => v.includes(m.vendor.toLowerCase()));
    if (!matches.length) return null;
    const simple = matches.find(m => !m.country);
    if (simple) return simple.servicebook;
    const cc = classifyCountry(countryStr);
    // For country-dependent vendors: try exact match, then 'eu' for AT/DE, then 'other'
    let entry = matches.find(m => m.country === cc);
    if (!entry && (cc === 'at' || cc === 'de')) entry = matches.find(m => m.country === 'eu');
    if (!entry) entry = matches.find(m => m.country === 'other');
    return entry ? entry.servicebook : null;
  }

  const productMetaCache = new Map();

  async function fetchProductMeta(productId) {
    if (!productId) return {};
    if (productMetaCache.has(productId)) return productMetaCache.get(productId);
    try {
      const r = await fetch(`index.php?module=Products&view=Detail&record=${productId}`, { credentials: 'same-origin' });
      const h = await r.text();
      const dp = new DOMParser().parseFromString(h, 'text/html');
      const getVal = label => {
        const lab = [...dp.querySelectorAll('[id^="Products_detailView_fieldLabel_"]')]
          .find(l => (l.textContent||'').trim().toLowerCase().includes(label));
        if (!lab) return '';
        const val = dp.getElementById(lab.id.replace('fieldLabel', 'fieldValue'));
        return val ? (val.textContent||'').trim() : '';
      };
      const meta = { vendor: getVal('vendor'), country: getVal('country') };
      productMetaCache.set(productId, meta);
      return meta;
    } catch { return {}; }
  }

  async function findServicebookRecord(name) {
    try {
      const url = `index.php?module=Vtiger&action=ReferenceAjax&mode=GetSearchResults`
        + `&search_module=ProviderServicebook&search_value=${encodeURIComponent(name)}`;
      const r = await fetch(url, { credentials: 'same-origin' });
      const html = await r.text();
      // Try JSON first
      try {
        const json = JSON.parse(html);
        if (json.result) {
          const dp = new DOMParser().parseFromString(json.result, 'text/html');
          const li = dp.querySelector('li[data-key]');
          if (li) return { id: li.dataset.key, label: (li.textContent||'').trim() };
        }
      } catch {
        // HTML response – parse directly
        const dp = new DOMParser().parseFromString(html, 'text/html');
        const li = dp.querySelector('li[data-key]');
        if (li) return { id: li.dataset.key, label: (li.textContent||'').trim() };
      }
    } catch { /* ignore */ }

    // Fallback: ListView search
    try {
      const url = `index.php?module=ProviderServicebook&view=List&search_value=${encodeURIComponent(name)}`;
      const r = await fetch(url, { credentials: 'same-origin' });
      const html = await r.text();
      const dp = new DOMParser().parseFromString(html, 'text/html');
      const row = [...dp.querySelectorAll('tr.listViewEntries')].find(tr =>
        (tr.textContent||'').toLowerCase().includes(name.toLowerCase())
      );
      if (row) {
        const id = row.dataset.id || row.getAttribute('data-id') || row.id?.replace(/\D/g,'');
        if (id) return { id, label: name };
      }
    } catch { /* ignore */ }

    return null;
  }

  function setReferenceField(record) {
    const display = document.querySelector('#cf_nrl_providerservicebook788_id_display')
      || document.querySelector('input[id*="providerservicebook"][id$="_display"]');
    if (!display) return false;
    const hidden = document.querySelector('input[name*="providerservicebook"][type="hidden"]')
      || document.getElementById(display.id.replace('_display',''));
    display.value = record.label;
    fire(display);
    if (hidden) { hidden.value = record.id; fire(hidden); }
    return true;
  }

  async function assignServicebook(rows) {
    const subject = T(document.querySelector('input[name="subject"]')?.value);
    if (!/^(W|WV)\b/i.test(subject)) return null; // nur W/WV

    const sbCounts = new Map();
    for (const r of rows) {
      const rn = r.id?.replace(/\D/g, '') || '1';
      const hid = r.querySelector(`input[name="hdnProductId${rn}"]`)
        || r.querySelector('input[name^="hdnProductId"]');
      if (!hid?.value) continue;
      const meta = await fetchProductMeta(hid.value);
      const sb = resolveServicebook(meta.vendor, meta.country);
      if (sb) sbCounts.set(sb, (sbCounts.get(sb) || 0) + 1);
    }

    if (!sbCounts.size) return { warning: 'Kein Vendor-Match für Provider Servicebook gefunden.' };

    const sorted = [...sbCounts.entries()].sort((a,b) => b[1] - a[1]);
    const topSb = sorted[0][0];
    let warning = '';
    if (sorted.length > 1) {
      warning = `Mehrere verschiedene Servicebooks erkannt: ${sorted.map(([n,c])=>`${n} (${c}x)`).join(', ')}. Häufigster wird gesetzt.`;
    }

    const record = await findServicebookRecord(topSb);
    if (!record) return { warning: `Provider Servicebook "${topSb}" konnte nicht im System gefunden werden.` };

    const ok = setReferenceField(record);
    if (!ok) return { warning: `Provider Servicebook Feld nicht im DOM gefunden.` };

    return { name: topSb, warning };
  }

  async function runAutofill(){
    const rows=[...document.querySelectorAll("tr.lineItemRow[id^='row'],tr.inventoryRow")];
    if(!rows.length){ alert("Keine Positionen gefunden"); return; }

    let starts=[], ends=[], cnt=0;
    const fallbackStart = addBusinessDays(new Date(), 3);

    for(const r of rows){
      const ta=r.querySelector("textarea");
      if(!ta) continue;

      let desc=T(ta.value);

      const ms=desc.match(/Service\s*Start\s*:\s*([^\r\n]+)/i);
      const me=desc.match(/Service\s*(?:Ende|End)\s*:\s*([^\r\n]+)/i);

      let start = ms ? parseDateOrNull(ms[1]) : null;
      const duration = extractDurationMonths(desc);

      if(!start){
        start = fallbackStart;
        desc = replaceLine(desc, "Service Start", fmt(start));
      }

      let end = me ? parseDateOrNull(me[1]) : null;
      if(!end){
        end = addMonthsMinusOneDay(start, duration);
        // Prüfen welche Variante bereits existiert (Fix: doppeltes Service End vermeiden)
        const hasEnglish = /Service\s*End\s*:/i.test(desc);
        const hasGerman = /Service\s*Ende\s*:/i.test(desc);

        if (hasEnglish && !hasGerman) {
          desc = replaceLine(desc, "Service End", fmt(end));
        } else {
          // Standard: Deutsche Version (auch wenn keine existiert)
          desc = replaceLine(desc, "Service Ende", fmt(end));
        }
      }

      ta.value = desc;
      fire(ta);

      starts.push(start);
      ends.push(end);
      cnt++;
    }

    const popStart = new Date(Math.min(...starts));
    const popEnd   = new Date(Math.max(...ends));
    const firstEnd = new Date(Math.min(...ends));

    const fStart=document.getElementById("SalesOrder_editView_fieldName_cf_2246");
    const fEnd=document.getElementById("SalesOrder_editView_fieldName_cf_2248");
    const fFirst=document.getElementById("SalesOrder_editView_fieldName_cf_2250");

    fStart && (fStart.value=fmt(popStart), fire(fStart));
    fEnd   && (fEnd.value=fmt(popEnd),   fire(fEnd));
    fFirst && (fFirst.value=fmt(firstEnd),fire(fFirst));

    const status=document.querySelector("select[name='sostatus']");
    status && (status.value="Delivered", fire(status));

    const taxText=document.querySelector("#s2id_region_id .select2-chosen")?.textContent||"";
    if(/austria/i.test(taxText)){
      const rc=document.getElementById("SalesOrder_editView_fieldName_cf_928");
      rc && (rc.checked=false, rc.value="0", fire(rc));
    }

    // Provider Servicebook Zuordnung (nur W/WV)
    let sbInfo = '';
    const sbResult = await assignServicebook(rows);
    if (sbResult) {
      if (sbResult.warning) {
        alert(`Provider Servicebook Hinweis:\n${sbResult.warning}`);
      }
      if (sbResult.name) {
        sbInfo = `\nProvider Servicebook: ${sbResult.name}`;
      }
    }

    alert(
      "Auto-Fill abgeschlossen:\n" +
      `Positionen: ${cnt}\n` +
      `POP Start: ${fmt(popStart)}\n` +
      `POP End: ${fmt(popEnd)}\n` +
      `First Service End: ${fmt(firstEnd)}` +
      sbInfo + "\n\n" +
      "Produktbeschreibungen wurden aktualisiert.\n" +
      "Jetzt bitte manuell speichern."
    );
  }

  function addButton(){
    if(document.getElementById("hw24-helper-btn")) return;

    const btn=document.createElement("button");
    btn.id="hw24-helper-btn";
    btn.type="button";
    btn.textContent="HW24 Auto-Fill";
    btn.style.cssText="margin-left:8px;background:#1f6feb;color:#fff;border:0;padding:6px 12px;border-radius:4px;cursor:pointer;";
    btn.onclick=()=>{ runAutofill().catch(e=>alert("Auto-Fill Fehler: "+e.message)); };

    const target=document.querySelector(".btn-toolbar,.editViewHeader");
    target && target.appendChild(btn);
  }

  new MutationObserver(addButton).observe(document.body,{childList:true,subtree:true});  
})();
