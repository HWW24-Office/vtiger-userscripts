// ==UserScript==
// @name         VTiger SalesOrder Helper Button
// @namespace    hw24.salesorder.helper
// @version      1.4.0
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

  function runAutofill(){
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
        desc = replaceLine(desc, "Service End", fmt(end));
        desc = replaceLine(desc, "Service Ende", fmt(end));
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

    alert(
      "Auto-Fill abgeschlossen:\n" +
      `Positionen: ${cnt}\n` +
      `POP Start: ${fmt(popStart)}\n` +
      `POP End: ${fmt(popEnd)}\n` +
      `First Service End: ${fmt(firstEnd)}\n\n` +
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
    btn.onclick=runAutofill;

    const target=document.querySelector(".btn-toolbar,.editViewHeader");
    target && target.appendChild(btn);
  }

  new MutationObserver(addButton).observe(document.body,{childList:true,subtree:true});  
})();
