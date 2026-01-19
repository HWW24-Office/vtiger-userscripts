// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.0.0
// @description  Auto-run line item meta overlay in Edit mode with toggle, status badge and manual refresh; button-only in Detail view
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
     UTILITIES
     =============================== */

  const W = window;
  const LSKEY = '__vt_meta_cache_v3';
  const mem = new Map();

  const S = s => (s || '').toString().trim();
  const n = v => {
    if (v == null) return NaN;
    let s = ('' + v).replace(/[^0-9,.\-]/g, '');
    if ((s.match(/[.,]/g) || []).length > 1) s = s.replace(/\.(?=.*\.)/g, '');
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(',', '.');
    return parseFloat(s);
  };
  const fire = el => el && ['input', 'change'].forEach(e => el.dispatchEvent(new Event(e, { bubbles: true })));
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  function getLS() {
    try { return JSON.parse(localStorage.getItem(LSKEY) || '{}'); }
    catch { return {}; }
  }
  function setLS(k, v) {
    const c = getLS();
    c[k] = v;
    localStorage.setItem(LSKEY, JSON.stringify(c));
  }

  /* ===============================
     META FETCH (unchanged logic)
     =============================== */

  async function fetchMeta(url) {
    if (!url) return {};
    if (mem.has(url)) return mem.get(url);

    const ls = getLS();
    if (ls[url]) {
      mem.set(url, ls[url]);
      return ls[url];
    }

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

      const meta = {
        pn: getVal('product'),
        vendor: getVal('vendor'),
        sla: getVal('sla'),
        duration: getVal('duration'),
        country: getVal('country')
      };

      mem.set(url, meta);
      setLS(url, meta);
      return meta;
    } catch {
      return {};
    }
  }

  /* ===============================
     CORE LOGIC
     =============================== */

  function ensureInfo(td) {
    let d = td.querySelector('.vt-prodinfo');
    if (!d) {
      d = document.createElement('div');
      d.className = 'vt-prodinfo';
      d.style.cssText = 'margin-top:6px;color:#555;font-size:12px;white-space:pre-wrap';
      td.appendChild(d);
    }
    return d;
  }

  function sigForRow(tr) {
    return [
      tr.querySelector('.purchaseCost')?.value,
      tr.querySelector('textarea')?.value,
      tr.querySelector('input[name*="productid"]')?.value
    ].join('|');
  }

  async function processEdit() {
    const tbl = document.querySelector('#lineItemTab');
    if (!tbl) return;

    const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
    for (const tr of rows) {
      const sig = sigForRow(tr);
      if (tr.dataset.vtSig === sig) continue;
      tr.dataset.vtSig = sig;

      const td = tr.querySelector('td');
      if (!td) continue;

      const hid = tr.querySelector('input[name*="productid"]');
      if (!hid || !hid.value) continue;

      const url = `index.php?module=Products&view=Detail&record=${hid.value}`;
      const meta = await fetchMeta(url);

      const info = ensureInfo(td);
      info.textContent =
        `PN: ${meta.pn || '—'} • Vendor: ${meta.vendor || '—'} • SLA: ${meta.sla || '—'} • Duration: ${meta.duration || '—'} • Country: ${meta.country || '—'}`;
    }
  }

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
      info.textContent =
        `PN: ${meta.pn || '—'} • Vendor: ${meta.vendor || '—'} • SLA: ${meta.sla || '—'} • Duration: ${meta.duration || '—'} • Country: ${meta.country || '—'}`;
    }
  }

  /* ===============================
     UI PANEL (Toggle / Status / Refresh)
     =============================== */

  let autoRunEnabled = true;
  let observer = null;

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
      <div id="hw24-meta-status">🟢 Meta aktuell</div>
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
      observer = new MutationObserver(rerun);
      observer.observe(tbl, { childList: true, subtree: true });
    }
  }

  if (isDetail) {
    const btn = document.createElement('button');
    btn.textContent = 'HW24 Meta';
    btn.style.cssText = `
      position:fixed;
      bottom:16px;
      right:16px;
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
