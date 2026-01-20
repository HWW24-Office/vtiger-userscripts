// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.0.3
// @description  Show product number (PROxxxxx) instead of product name in line item meta overlay
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-meta-overlay.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-meta-overlay.user.js
// ==/UserScript==

(async function () {
  'use strict';

  /* ===============================
     MODE DETECTION
     =============================== */

  const isEdit =
    location.href.includes('view=Edit') &&
    /module=(Quotes|SalesOrder|Invoice)/.test(location.href);

  const isDetail =
    location.href.includes('view=Detail') &&
    /module=(Quotes|SalesOrder|Invoice)/.test(location.href);

  if (!isEdit && !isDetail) return;

  /* ===============================
     CONFIG: Vendor Colors
     =============================== */

  const VENDOR_COLORS = {
    "Technogroup": "#2563eb",
    "Park Place": "#16a34a",
    "ITRIS": "#9333ea",
    "IDS": "#ea580c",
    "DIS": "#dc2626",
    "Axians": "#0891b2"
  };

  function colorForVendor(vendor) {
    if (!vendor) return "#6b7280";
    const v = vendor.toLowerCase();
    for (const key of Object.keys(VENDOR_COLORS)) {
      if (v.includes(key.toLowerCase())) return VENDOR_COLORS[key];
    }
    return "#6b7280";
  }

  /* ===============================
     UTILITIES
     =============================== */

  const mem = new Map(); // in-memory cache per page load only
  const S = s => (s || '').toString().trim();

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /* ===============================
     META FETCH (ALWAYS LIVE)
     =============================== */

  async function fetchMeta(url) {
    if (!url) return {};
    if (mem.has(url)) return mem.get(url);

    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      const h = await r.text();
      const dp = new DOMParser().parseFromString(h, 'text/html');

      const getVal = label => {
        const lab = [...dp.querySelectorAll('[id^="Products_detailView_fieldLabel_"]')]
          .find(l => S(l.textContent).toLowerCase().includes(label));
        if (!lab) return '';
        const v = dp.getElementById(lab.id.replace('fieldLabel', 'fieldValue'));
        return S(v ? v.textContent : '');
      };

      /* ✅ Product Number (PROxxxxx) */
      const productNo =
        S(dp.querySelector('.product_no.value')?.textContent) || '';

      const meta = {
        pn: productNo,
        vendor: getVal('vendor'),
        sla: getVal('sla'),
        duration: getVal('duration'),
        country: getVal('country')
      };

      mem.set(url, meta);
      return meta;
    } catch {
      return {};
    }
  }

  /* ===============================
     RENDER HELPERS
     =============================== */

  function ensureInfo(td) {
    let d = td.querySelector('.vt-prodinfo');
    if (!d) {
      d = document.createElement('div');
      d.className = 'vt-prodinfo';
      d.style.cssText = 'margin-top:6px;font-size:12px;white-space:pre-wrap';
      td.appendChild(d);
    }
    return d;
  }

  function sigForRow(tr) {
    return [
      tr.querySelector('.purchaseCost')?.value,
      tr.querySelector('textarea')?.value,
      tr.querySelector('input[name^="hdnProductId"]')?.value
    ].join('|');
  }

  function renderInfo(info, meta) {
    info.innerHTML = `
      <span style="
        display:inline-block;
        padding:2px 6px;
        border-radius:999px;
        background:${colorForVendor(meta.vendor)};
        color:#fff;
        font-size:11px;
        margin-right:6px
      ">${meta.vendor || '—'}</span>
      PN: ${meta.pn || '—'}
      • SLA: ${meta.sla || '—'}
      • Duration: ${meta.duration || '—'}
      • Country: ${meta.country || '—'}
    `;
  }

  /* ===============================
     CORE: EDIT MODE
     =============================== */

  async function processEdit() {
    const tbl = document.querySelector('#lineItemTab');
    if (!tbl) return;

    const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
    const vendorsSeen = new Set();

    for (const tr of rows) {
      const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');
      const sig = sigForRow(tr);
      if (tr.dataset.vtSig === sig) continue;
      tr.dataset.vtSig = sig;

      const nameEl =
        tr.querySelector('#productName' + rn) ||
        tr.querySelector('input[id^="productName"]') ||
        tr.querySelector('a[href*="module=Products"]');

      const td = nameEl ? nameEl.closest('td') : null;
      if (!td) continue;

      const hid =
        tr.querySelector(`input[name="hdnProductId${rn}"]`) ||
        tr.querySelector('input[name^="hdnProductId"]');

      if (!hid || !hid.value) continue;

      const url = `index.php?module=Products&view=Detail&record=${hid.value}`;
      const meta = await fetchMeta(url);

      if (meta.vendor) vendorsSeen.add(meta.vendor);

      const info = ensureInfo(td);
      renderInfo(info, meta);
    }

    const warn = document.getElementById('hw24-meta-warning');
    if (warn) {
      if (vendorsSeen.size > 1) {
        warn.textContent = `⚠️ Gemischte Vendors (${vendorsSeen.size})`;
        warn.style.color = "#facc15";
      } else {
        warn.textContent = "";
      }
    }
  }

  /* ===============================
     CORE: DETAIL MODE
     =============================== */

  async function processDetail() {
    const tbl = document.querySelector('.lineItemsTable');
    if (!tbl) return;

    const rows = [...tbl.querySelectorAll('tbody tr')].slice(1);
    for (const tr of rows) {
      const td = tr.querySelector('td');
      const a = td?.querySelector('a[href*="module=Products"]');
      if (!a) continue;

      const meta = await fetchMeta(a.href);
      const info = ensureInfo(td);
      renderInfo(info, meta);
    }
  }

  /* ===============================
     UI PANEL (Edit Mode)
     =============================== */

  let autoRunEnabled = true;

  function addControlPanel() {
    if (document.getElementById('hw24-meta-panel')) return;

    const p = document.createElement('div');
    p.id = 'hw24-meta-panel';
    p.style.cssText = `
      position:fixed;
      bottom:16px;
      right:16px;
      z-index:2147483647;
      background:#111;
      color:#fff;
      padding:10px;
      border-radius:10px;
      font-size:12px;
      box-shadow:0 6px 18px rgba(0,0,0,.35)
    `;

    p.innerHTML = `
      <div id="hw24-meta-status">🟢 Auto-Run aktiv</div>
      <div id="hw24-meta-warning" style="margin-top:4px;font-size:11px;"></div>
      <button id="hw24-meta-toggle">⏸ Pause Auto-Run</button>
      <button id="hw24-meta-refresh">♻ Refresh</button>
    `;

    p.querySelectorAll('button').forEach(b => {
      b.style.cssText = 'margin-top:6px;width:100%;cursor:pointer';
    });

    p.querySelector('#hw24-meta-toggle').onclick = () => {
      autoRunEnabled = !autoRunEnabled;
      p.querySelector('#hw24-meta-toggle').textContent =
        autoRunEnabled ? '⏸ Pause Auto-Run' : '▶ Resume Auto-Run';
      p.querySelector('#hw24-meta-status').textContent =
        autoRunEnabled ? '🟢 Auto-Run aktiv' : '⏸ Auto-Run pausiert';
    };

    p.querySelector('#hw24-meta-refresh').onclick = async () => {
      await processEdit();
      p.querySelector('#hw24-meta-status').textContent = '🟢 Meta aktualisiert';
    };

    document.body.appendChild(p);
  }

  /* ===============================
     BOOTSTRAP
     =============================== */

  if (isEdit) {
    addControlPanel();
    await processEdit();

    const rerun = debounce(() => {
      if (!autoRunEnabled) return;
      processEdit();
    }, 700);

    const tbl = document.querySelector('#lineItemTab');
    if (tbl) {
      const obs = new MutationObserver(rerun);
      obs.observe(tbl, { childList: true, subtree: true });
    }
  }

  if (isDetail) {
    const btn = document.createElement('button');
    btn.textContent = 'HW24 Meta';
    btn.style.cssText = `
      position:fixed;
      bottom:16px;
      left:16px;
      z-index:2147483647;
      background:#1f6feb;
      color:#fff;
      border:none;
      padding:10px 14px;
      border-radius:999px;
      cursor:pointer
    `;
    btn.onclick = () => processDetail();
    document.body.appendChild(btn);
  }

})();
