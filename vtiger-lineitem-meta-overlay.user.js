// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.1.3
// @description  Stable meta overlay with integrated maintenance auditor (no regressions)
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  /* ===============================
     MODE DETECTION (UNCHANGED)
     =============================== */

  const isEdit =
    location.href.includes('view=Edit') &&
    /module=(Quotes|SalesOrder|Invoice|PurchaseOrder|Products)/.test(location.href);

  if (!isEdit) return;

  const currentModule =
    location.href.match(/module=(Quotes|SalesOrder|Invoice|PurchaseOrder|Products)/)?.[1] || '';

  /* ===============================
     CONFIG (UNCHANGED)
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
     UTILITIES (UNCHANGED)
     =============================== */

  const mem = new Map();
  const S = s => (s || '').toString().trim();

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /* ===============================
     META FETCH (UNCHANGED)
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
     RENDER HELPERS (UNCHANGED)
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
     MAINTENANCE AUDITOR (ADD-ON)
     =============================== */

  let currentLang = 'de';

  const TXT = {
    de: {
      ok: '🟢 Wartung: OK',
      quoteOk: '🟡 Wartung: Quote (TBA ok)',
      noDesc: '🔴 Wartung: Keine Beschreibung',
      noSn: '🟡 Wartung: Keine S/N',
      noDates: '🔴 Wartung: Fehlende Service-Daten'
    },
    en: {
      ok: '🟢 Maintenance: OK',
      quoteOk: '🟡 Maintenance: Quote (TBA ok)',
      noDesc: '🔴 Maintenance: No description',
      noSn: '🟡 Maintenance: No S/N',
      noDates: '🔴 Maintenance: Missing service dates'
    }
  };

  function extractSerials(desc) {
    const out = [];
    const re = /S\/N:\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(desc))) {
      m[1].split(/[,;\/]/).map(s => s.trim()).filter(Boolean).forEach(sn => out.push(sn));
    }
    return [...new Set(out)];
  }

  function audit(desc) {
    const t = TXT[currentLang];
    if (!desc) return t.noDesc;

    const sn = extractSerials(desc);
    const hasStart = /Service\s+Start:/i.test(desc);
    const hasEnd = /Service\s+(Ende|End):/i.test(desc);

    if (currentModule === 'Quotes' && (!hasStart || !hasEnd)) return t.quoteOk;
    if (!sn.length) return t.noSn;
    if (!hasStart || !hasEnd) return t.noDates;
    return t.ok;
  }

  function ensureAuditor(info) {
    let d = info.querySelector('.hw24-auditor');
    if (!d) {
      d = document.createElement('div');
      d.className = 'hw24-auditor';
      d.style.cssText = 'margin-top:4px;font-size:11px;font-weight:bold';
      info.appendChild(d);
    }
    return d;
  }

  /* ===============================
     CORE (BASED ON 1.0.3)
     =============================== */

  async function processEdit() {
    const tbl = document.querySelector('#lineItemTab');
    if (!tbl) return;

    const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];

    for (const tr of rows) {
      const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');

      const nameEl =
        tr.querySelector('#productName' + rn) ||
        tr.querySelector('input[id^="productName"]') ||
        tr.querySelector('a[href*="module=Products"]');

      const td = nameEl?.closest('td');
      if (!td) continue;

      const hid =
        tr.querySelector(`input[name="hdnProductId${rn}"]`) ||
        tr.querySelector('input[name^="hdnProductId"]');

      if (!hid?.value) continue;

      const meta = await fetchMeta(`index.php?module=Products&view=Detail&record=${hid.value}`);
      const info = ensureInfo(td);
      renderInfo(info, meta);

      const desc = tr.querySelector('textarea[name*="comment"]')?.value || '';
      const auditor = ensureAuditor(info);
      auditor.textContent = audit(desc);
    }
  }

  /* ===============================
     PANEL (EXTENSION)
     =============================== */

  const panel = document.createElement('div');
  panel.style.cssText = `
    position:fixed;
    bottom:16px;
    right:16px;
    z-index:2147483647;
    background:#111;
    color:#fff;
    padding:8px;
    border-radius:8px;
    font-size:12px
  `;
  panel.innerHTML = `<button id="hw24-lang">DE / EN</button>`;
  panel.querySelector('#hw24-lang').onclick = () => {
    currentLang = currentLang === 'de' ? 'en' : 'de';
    processEdit();
  };
  document.body.appendChild(panel);

  await processEdit();
  new MutationObserver(debounce(processEdit, 700))
    .observe(document.querySelector('#lineItemTab'), { childList: true, subtree: true });

})();
