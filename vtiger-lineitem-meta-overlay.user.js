// ==UserScript==
// @name         VTiger LineItem Meta Overlay (SAFE TEST)
// @namespace    hw24.vtiger.lineitem.meta.overlay.safe
// @version      1.0.3-safe
// @description  Minimal safe test: render meta info only
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  console.log('[HW24][SAFE] Script loaded');

  if (!location.href.includes('view=Edit')) return;

  const tbl = document.querySelector('#lineItemTab');
  if (!tbl) {
    console.warn('[HW24][SAFE] #lineItemTab not found');
    return;
  }

  const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')];
  console.log('[HW24][SAFE] rows found:', rows.length);

  for (const tr of rows) {
    const nameEl =
      tr.querySelector('input[id^="productName"]') ||
      tr.querySelector('a[href*="module=Products"]');

    const td = nameEl?.closest('td');
    if (!td) continue;

    let info = td.querySelector('.vt-prodinfo');
    if (!info) {
      info = document.createElement('div');
      info.className = 'vt-prodinfo';
      info.style.cssText = 'margin-top:6px;font-size:12px';
      info.textContent = 'HW24 META TEST ✔';
      td.appendChild(info);
    }
  }

})();
