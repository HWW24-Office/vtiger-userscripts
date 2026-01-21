// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.2.5
// @description  Show product number (PROxxxxx), audit maintenance descriptions, enforce structure, fix formats and display markup
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  /* ===============================
     MODE / MODULE DETECTION
     =============================== */

  const SUPPORTED_MODULES = [
    'Quotes',
    'SalesOrder',
    'Invoice',
    'PurchaseOrder',
    'Products'
  ];

  const isEdit =
    location.href.includes('view=Edit') &&
    new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`).test(location.href);

  const isDetail =
    location.href.includes('view=Detail') &&
    new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`).test(location.href);

  if (!isEdit && !isDetail) return;

  const currentModule =
    location.href.match(new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`))?.[1] || '';

  /* ===============================
     CONFIG
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

  const mem = new Map();
  const S = s => (s || '').toString().trim();

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  function getQuantity(tr, rn) {
    const q =
      tr.querySelector(`#qty${rn}`) ||
      tr.querySelector(`#quantity${rn}`) ||
      tr.querySelector(`input[name="qty${rn}"]`) ||
      tr.querySelector(`input[name="quantity${rn}"]`);
    const v = parseInt(q?.value, 10);
    return Number.isFinite(v) ? v : 0;
  }

  /* ===============================
     PRICE / MARKUP
     =============================== */

  // NEW
  function calcMarkup(tr, rn) {
    const pc = parseFloat(tr.querySelector(`#purchaseCost${rn}`)?.value || 0);
    const sp = parseFloat(tr.querySelector(`#listPrice${rn}`)?.value || 0);
    const qty = getQuantity(tr, rn);

    if (!pc || !sp || !qty) return null;

    const pcPerUnit = pc / qty;
    return (sp / pcPerUnit).toFixed(2);
  }

  /* ===============================
     META FETCH
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

      const productNo = S(dp.querySelector('.product_no.value')?.textContent);

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
     DESCRIPTION ANALYSIS
     =============================== */

  function analyzeDescription(desc) {
    const lines = desc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const DE_ONLY = ["Standort:", "inkl.:", "Service Ende:"];
    const EN_ONLY = ["Location:", "incl.:", "Service End:"];

    let hasDE = false;
    let hasEN = false;

    for (const l of lines) {
      if (DE_ONLY.some(k => l.startsWith(k))) hasDE = true;
      if (EN_ONLY.some(k => l.startsWith(k))) hasEN = true;
    }

    if (hasDE && hasEN) return { ok: false, reason: "Sprachmix" };

    if (
      !lines.some(l => l.startsWith("Service Start:")) ||
      !lines.some(l => l.startsWith("Service Ende:") || l.startsWith("Service End:"))
    ) {
      return { ok: false, reason: "Service-Daten fehlen" };
    }

    return { ok: true };
  }

  function extractSerials(desc) {
    const out = [];
    const re = /S\/N:\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(desc))) {
      m[1].split(/[,;\/]/).map(s => s.trim()).filter(Boolean).forEach(sn => out.push(sn));
    }
    return [...new Set(out)];
  }

  // NEW
  function hasBadSerialFormat(desc) {
    const m = desc.match(/S\/N:\s*([^\n]+)/i);
    if (!m) return false;
    return m[1].includes(';') || /,[^\s]/.test(m[1]);
  }

  /* ===============================
     FIXERS
     =============================== */

  // NEW
  function fixSerialFormat(desc) {
    return desc.replace(/S\/N:\s*([^\n]+)/i, (_, s) =>
      'S/N: ' + s.replace(/;/g, ',').replace(/,\s*/g, ', ')
    );
  }

  // NEW
  function fixServiceDates(desc) {
    return desc.replace(
      /(Service (Start|Ende|End):)\s*([^\n]+)/gi,
      (m, label, _, value) => {
        const v = value.trim();
        if (/^(tba|\[nichtangegeben\])$/i.test(v)) return `${label} ${v}`;
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(v)) return `${label} ${v}`;
        return m;
      }
    );
  }

  // NEW
  function applyAllFixes(text) {
    return fixServiceDates(fixSerialFormat(text));
  }

  /* ===============================
     AUDITOR
     =============================== */

  function auditMaintenance(desc, qty) {
    if (!desc) return "🔴 Wartung: Keine Beschreibung";

    if (hasBadSerialFormat(desc)) {
      return "🟡 Wartung: S/N Format";
    }

    const structure = analyzeDescription(desc);
    if (!structure.ok) return `🟡 Wartung: ${structure.reason}`;

    const serials = extractSerials(desc);
    if (!serials.length) return "🟡 Wartung: Keine S/N";

    if (serials.length !== qty) {
      return `🟡 Wartung: Quantity (${qty}) ≠ S/N (${serials.length})`;
    }

    return "🟢 Wartung: OK";
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

  function renderInfo(info, meta) {
    const tr = info.closest('tr');
    const rn =
      tr?.getAttribute('data-row-num') ||
      tr?.id?.replace('row', '') ||
      '';

    const markup = tr ? calcMarkup(tr, rn) : null;

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
      • Markup: ${markup || '—'}
    `;
  }

  function refreshBadgeForRow(tr) {
    const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');
    const desc = tr.querySelector('textarea[name*="comment"]')?.value || '';
    const qty = getQuantity(tr, rn);
    const info = tr.querySelector('.vt-prodinfo');
    if (!info) return;
    const auditor = ensureAuditor(info);
    auditor.textContent = auditMaintenance(desc, qty);
  }

  /* ===============================
     DESCRIPTION STANDARDIZER (OVERLAY)
     =============================== */

  function openStandardizer(tr, textarea) {
    const original = textarea.value;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.4);
      z-index:99999; display:flex; align-items:center; justify-content:center;
    `;

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:12px;width:800px;max-width:90%;font-size:12px';

    const origTA = document.createElement('textarea');
    origTA.readOnly = true;
    origTA.style.cssText = 'width:100%;height:140px';
    origTA.value = original;

    const prevTA = document.createElement('textarea');
    prevTA.readOnly = true;
    prevTA.style.cssText = 'width:100%;height:140px';
    prevTA.value = applyAllFixes(original);

    const actions = document.createElement('div');
    actions.innerHTML = `
      <button type="button" id="apply">Apply</button>
      <button type="button" id="cancel">Cancel</button>
    `;

    actions.onclick = e => {
      if (e.target.id === 'apply') {
        textarea.value = prevTA.value;
        refreshBadgeForRow(tr);
      }
      overlay.remove();
    };

    box.append('Original', origTA, 'Vorschau', prevTA, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  /* ===============================
     BUTTONS
     =============================== */

  function injectButtons(tr) {
    if (tr.querySelector('.hw24-desc-btn')) return;

    const ta = tr.querySelector('textarea[name*="comment"]');
    if (!ta) return;

    const std = document.createElement('button');
    std.type = 'button';
    std.className = 'hw24-desc-btn';
    std.textContent = 'Description standardisieren';
    std.style.cssText = 'margin-top:4px;font-size:11px';

    std.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      openStandardizer(tr, ta);
    };

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = 'Refresh Check';
    refresh.style.cssText = 'margin-top:4px;margin-left:6px;font-size:11px';

    refresh.onclick = () => refreshBadgeForRow(tr);

    ta.after(std, refresh);
  }

  // NEW
  function injectGlobalFixButton() {
    if (!isEdit) return;
    if (document.getElementById('hw24-global-fix')) return;

    const btn = document.createElement('button');
    btn.id = 'hw24-global-fix';
    btn.type = 'button';
    btn.textContent = 'Alle Descriptions korrigieren';
    btn.style.cssText = 'margin:8px 0;font-size:12px';

    btn.onclick = () => {
      document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow').forEach(tr => {
        const ta = tr.querySelector('textarea[name*="comment"]');
        if (!ta) return;
        ta.value = applyAllFixes(ta.value);
        refreshBadgeForRow(tr);
      });
    };

    const tbl = document.querySelector('#lineItemTab');
    tbl?.parentElement?.insertBefore(btn, tbl);
  }

  /* ===============================
     CORE
     =============================== */

  async function processEdit() {
    injectGlobalFixButton();

    const tbl = document.querySelector('#lineItemTab');
    if (!tbl) return;

    const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];

    for (const tr of rows) {
      const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');

      const hid =
        tr.querySelector(`input[name="hdnProductId${rn}"]`) ||
        tr.querySelector('input[name^="hdnProductId"]');

      if (!hid?.value) continue;

      const td =
        tr.querySelector(`#productName${rn}`)?.closest('td') ||
        tr.querySelector('a[href*="module=Products"]')?.closest('td');

      if (!td) continue;

      const meta = await fetchMeta(`index.php?module=Products&view=Detail&record=${hid.value}`);
      const info = ensureInfo(td);

      renderInfo(info, meta);
      refreshBadgeForRow(tr);
      injectButtons(tr);
    }
  }

  /* ===============================
     BOOTSTRAP
     =============================== */

  if (isEdit) {
    await processEdit();
    const rerun = debounce(processEdit, 700);
    const tbl = document.querySelector('#lineItemTab');
    if (tbl) new MutationObserver(rerun).observe(tbl, { childList: true, subtree: true });
  }

})();
