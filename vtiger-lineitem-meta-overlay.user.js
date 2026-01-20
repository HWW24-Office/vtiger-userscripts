// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.2.5
// @description  Show product number (PROxxxxx), audit maintenance descriptions and enforce description structure
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
     META FETCH (unchanged)
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
     DESCRIPTION ORDER + LANGUAGE AUDIT
     =============================== */

  const LABELS = {
    de: ["S/N:", "inkl.:", "Standort:", "Service Start:", "Service Ende:"],
    en: ["S/N:", "incl.:", "Location:", "Service Start:", "Service End:"]
  };

  function analyzeDescription(desc) {
    const lines = desc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const found = [];
    for (const l of lines) {
      const key = Object.values(LABELS).flat().find(k => l.startsWith(k));
      if (key) found.push(key);
    }

    const isDE = found.some(f => LABELS.de.includes(f));
    const isEN = found.some(f => LABELS.en.includes(f));
    if (isDE && isEN) return { ok: false, reason: "Sprachmix" };

    const base = isEN ? LABELS.en : LABELS.de;
    let lastIndex = -1;

    for (const f of found) {
      const idx = base.indexOf(f);
      if (idx === -1 || idx < lastIndex) {
        return { ok: false, reason: "Reihenfolge" };
      }
      lastIndex = idx;
    }

    if (!found.includes("Service Start:") || !(found.includes("Service Ende:") || found.includes("Service End:"))) {
      return { ok: false, reason: "Service-Daten fehlen" };
    }

    return { ok: true };
  }

  /* ===============================
     AUDITOR (extended)
     =============================== */

  function extractSerials(desc) {
    const out = [];
    const re = /S\/N:\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(desc))) {
      m[1].split(/[,;\/]/).map(s => s.trim()).filter(Boolean).forEach(sn => out.push(sn));
    }
    return [...new Set(out)];
  }

  function auditMaintenance(desc, qty, productName) {
    if (!desc) return "🔴 Wartung: Keine Beschreibung";

    const serials = extractSerials(desc);
    const structure = analyzeDescription(desc);
    if (!structure.ok) return `🟡 Wartung: ${structure.reason}`;

    if (!serials.length) return "🟡 Wartung: Keine S/N";

    if (!(serials.length === qty)) {
      return `🟡 Wartung: Quantity (${qty}) ≠ S/N (${serials.length})`;
    }

    return "🟢 Wartung: OK";
  }

  /* ===============================
     DESCRIPTION STANDARDIZER
     =============================== */

  const DESCRIPTION_LABELS = {
    de: {
      location: "Standort:",
      serviceEnd: "Service Ende:",
      included: "inkl.:"
    },
    en: {
      location: "Location:",
      serviceEnd: "Service End:",
      included: "incl.:"
    }
  };

  function normalizeDescriptionLanguage(text, lang) {
    let t = text;

    // reset to DE
    t = t
      .replaceAll("Location:", "Standort:")
      .replaceAll("incl.:", "inkl.:")
      .replaceAll("Service End:", "Service Ende:");

    // apply target
    return lang === "en"
      ? t
          .replaceAll("Standort:", "Location:")
          .replaceAll("inkl.:", "incl.:")
          .replaceAll("Service Ende:", "Service End:")
      : t;
  }

  function openStandardizer(tr, textarea, meta) {
    const original = textarea.value;
    let lang = 'en';

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

    const update = () => prevTA.value = normalizeDescriptionLanguage(original, lang);
    update();

    const switcher = document.createElement('div');
    switcher.innerHTML = `
      <button type="button" data-lang="de">DE</button>
      <button type="button" data-lang="en">EN</button>
    `;
    switcher.querySelectorAll('button').forEach(b =>
      b.onclick = () => { lang = b.dataset.lang; update(); }
    );

    const actions = document.createElement('div');
    actions.innerHTML = `
      <button type="button" id="apply">Apply</button>
      <button type="button" id="cancel">Cancel</button>
    `;
    actions.onclick = e => {
      if (e.target.id === 'apply') {
        textarea.value = prevTA.value;
        refreshBadgeForRow(tr, meta);
      }
      overlay.remove();
    };

    box.append('Original', origTA, 'Vorschau', switcher, prevTA, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
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

  function refreshBadgeForRow(tr, meta) {
    const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');
    const desc = tr.querySelector('textarea[name*="comment"]')?.value || '';
    const qty = getQuantity(tr, rn);
    const info = tr.querySelector('.vt-prodinfo');
    if (!info) return;
    const auditor = ensureAuditor(info);
    auditor.textContent = auditMaintenance(desc, qty, meta.pn);
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

  function injectButtons(tr, meta) {
    if (tr.querySelector('.hw24-desc-btn')) return;
    const ta = tr.querySelector('textarea[name*="comment"]');
    if (!ta) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hw24-desc-btn';
    btn.textContent = 'Description standardisieren';
    btn.style.cssText = 'margin-top:4px;font-size:11px';

    btn.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      openStandardizer(tr, ta, meta);
    };

    ta.after(btn);
  }

  /* ===============================
     CORE
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

      refreshBadgeForRow(tr, meta);
      injectButtons(tr, meta);
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
