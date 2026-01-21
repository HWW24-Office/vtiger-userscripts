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

  function toNum(x) {
    const s = S(x).replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function getFieldNumber(el) {
    if (!el) return 0;
    // input/select
    if ('value' in el) return toNum(el.value);
    // div/span
    return toNum(el.textContent);
  }

  function getQuantity(tr, rn) {
    const q =
      tr.querySelector(`#qty${rn}`) ||
      tr.querySelector(`#quantity${rn}`) ||
      tr.querySelector(`input[name="qty${rn}"]`) ||
      tr.querySelector(`input[name="quantity${rn}"]`) ||
      tr.querySelector(`#qty${rn}_display`) ||
      tr.querySelector(`#quantity${rn}_display`);
    const v = parseInt(S(q?.value ?? q?.textContent), 10);
    return Number.isFinite(v) ? v : 0;
  }

  function getPurchaseCost(tr, rn) {
    const el =
      tr.querySelector(`#purchaseCost${rn}`) ||
      tr.querySelector(`input[name="purchaseCost${rn}"]`) ||
      tr.querySelector(`#purchaseCost${rn}_display`);
    return getFieldNumber(el);
  }

  function getLineItemTotal(tr, rn) {
    const el =
      tr.querySelector(`#productTotal${rn}`) ||
      tr.querySelector(`#netPrice${rn}`) ||
      tr.querySelector(`#productTotal${rn}_display`);
    return getFieldNumber(el);
  }

  /* ===============================
     MARKUP (Total / Purchase Cost)
     =============================== */

  function calcMarkup(tr, rn) {
    const pc = getPurchaseCost(tr, rn);
    const total = getLineItemTotal(tr, rn);
    if (!pc || !total) return null;
    return (total / pc).toFixed(2);
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

  // Fix: Sprachdetektion nur über sprachspezifische Labels (Service Start ist neutral)
  function analyzeDescription(desc) {
    const lines = desc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    const DE_ONLY = ["Standort:", "inkl.:", "Service Ende:"];
    const EN_ONLY = ["Location:", "incl.:", "Service End:"];

    const hasDE = lines.some(l => DE_ONLY.some(k => l.startsWith(k)));
    const hasEN = lines.some(l => EN_ONLY.some(k => l.startsWith(k)));
    if (hasDE && hasEN) return { ok: false, reason: "Sprachmix" };

    // Reihenfolge grob prüfen (zeilenbasiert, wie v1.2.5)
    const base = hasEN ? LABELS.en : LABELS.de;
    let lastIndex = -1;

    const found = [];
    for (const l of lines) {
      const key = base.find(k => l.startsWith(k));
      if (key) found.push(key);
      else {
        // erlauben wir "S/N:" auch, wenn Sprache nicht eindeutig
        const anyKey = Object.values(LABELS).flat().find(k => l.startsWith(k));
        if (anyKey) found.push(anyKey);
      }
    }

    for (const f of found) {
      const idx = base.indexOf(f);
      if (idx !== -1) {
        if (idx < lastIndex) return { ok: false, reason: "Reihenfolge" };
        lastIndex = idx;
      }
    }

    if (!lines.some(l => l.startsWith("Service Start:")) ||
        !lines.some(l => l.startsWith("Service Ende:") || l.startsWith("Service End:"))) {
      return { ok: false, reason: "Service-Daten fehlen" };
    }

    return { ok: true };
  }

  /* ===============================
     STRICT DATE VALIDATION (RED)
     =============================== */

  function isValidDDMMYYYY(s) {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return false;
    const [dd, mm, yyyy] = s.split('.').map(n => parseInt(n, 10));
    if (mm < 1 || mm > 12) return false;
    if (dd < 1 || dd > 31) return false;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    return d.getUTCFullYear() === yyyy && d.getUTCMonth() === (mm - 1) && d.getUTCDate() === dd;
  }

  function normalizeServiceDateLine(line) {
    const m = line.match(/^(Service (Start|Ende|End):)\s*(.*)$/i);
    if (!m) return { line, ok: true };

    const label = m[1];
    const raw = S(m[3]);

    if (/^(tba|\[nichtangegeben\])$/i.test(raw)) {
      return { line: `${label} ${raw}`, ok: true };
    }
    if (isValidDDMMYYYY(raw)) {
      return { line: `${label} ${raw}`, ok: true };
    }
    // Leerzeichen wird korrigiert, Inhalt bleibt -> ok:false (ROT)
    return { line: `${label} ${raw}`, ok: false };
  }

  function hasInvalidServiceDate(desc) {
    const lines = desc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const dateLines = lines.filter(l => /^Service (Start|Ende|End):/i.test(l));
    return dateLines.some(l => !normalizeServiceDateLine(l).ok);
  }

  /* ===============================
     AUDITOR (extended)
     =============================== */

  function extractSerials(desc) {
    const out = [];
    const re = /S\/N:\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(desc))) {
      // auditor akzeptiert weiterhin , ; / als Trenner
      m[1].split(/[,;\/]/).map(s => s.trim()).filter(Boolean).forEach(sn => out.push(sn));
    }
    return [...new Set(out)];
  }

  function hasBadSerialFormat(desc) {
    const m = desc.match(/S\/N:\s*([^\n]+)/i);
    if (!m) return false;
    // Gelb, wenn ; verwendet wird oder wenn nach "," kein Leerzeichen folgt
    return m[1].includes(';') || /,[^\s]/.test(m[1]);
  }

  function auditMaintenance(desc, qty) {
    if (!desc) return "🔴 Wartung: Keine Beschreibung";

    // ROT: Datum kaputt
    if (hasInvalidServiceDate(desc)) return "🔴 Wartung: Ungültiges Datum";

    // GELB: Seriennummern nicht norm-konform
    if (hasBadSerialFormat(desc)) return "🟡 Wartung: S/N Format";

    const structure = analyzeDescription(desc);
    if (!structure.ok) return `🟡 Wartung: ${structure.reason}`;

    const serials = extractSerials(desc);
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

  // NEW: Fixer für S/N und Service Dates (Leerzeichen + strict recognition)
  function fixSerialFormat(desc) {
    return desc.replace(/S\/N:\s*([^\n]+)/i, (_, s) =>
      'S/N: ' + s.replace(/;/g, ',').replace(/,\s*/g, ', ')
    );
  }

  function fixServiceDates(desc) {
    const lines = desc.split(/\r?\n/);
    return lines.map(l => normalizeServiceDateLine(l.trimEnd()).line).join('\n');
  }

  function applyAllFixes(desc) {
    return fixServiceDates(fixSerialFormat(desc));
  }

  function openStandardizer(tr, textarea) {
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

    const update = () => {
      // erst Sprach-Standardisierung, dann Fixer (S/N + Dates)
      const t = applyAllFixes(normalizeDescriptionLanguage(original, lang));
      prevTA.value = t;
    };
    update();

    const switcher = document.createElement('div');
    switcher.style.cssText = 'margin:6px 0;';
    switcher.innerHTML = `
      <button type="button" data-lang="de">DE</button>
      <button type="button" data-lang="en">EN</button>
    `;
    switcher.querySelectorAll('button').forEach(b =>
      b.onclick = () => { lang = b.dataset.lang; update(); }
    );

    const actions = document.createElement('div');
    actions.style.cssText = 'margin-top:6px;';
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

  function refreshBadgeForRow(tr) {
    const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');
    const desc = tr.querySelector('textarea[name*="comment"]')?.value
              || tr.querySelector(`#comment${rn}`)?.value
              || '';
    const qty = getQuantity(tr, rn);
    const info = tr.querySelector('.vt-prodinfo');
    if (!info) return;
    const auditor = ensureAuditor(info);
    auditor.textContent = auditMaintenance(desc, qty);
  }

  function renderInfo(info, meta) {
    const tr = info.closest('tr');
    const rn = tr?.getAttribute('data-row-num') || tr?.id?.replace('row', '') || '';
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

  function injectButtons(tr) {
    if (tr.querySelector('.hw24-desc-btn')) return;

    const ta =
      tr.querySelector('textarea[name*="comment"]') ||
      tr.querySelector('textarea[id^="comment"]');

    if (!ta) return;

    const stdBtn = document.createElement('button');
    stdBtn.type = 'button';
    stdBtn.className = 'hw24-desc-btn';
    stdBtn.textContent = 'Description standardisieren';
    stdBtn.style.cssText = 'margin-top:4px;font-size:11px';

    stdBtn.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      openStandardizer(tr, ta);
    };

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.textContent = 'Refresh Check';
    refreshBtn.style.cssText = 'margin-top:4px;margin-left:6px;font-size:11px';

    refreshBtn.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      refreshBadgeForRow(tr);
    };

    ta.after(stdBtn, refreshBtn);
  }

  /* ===============================
     GLOBAL FIX BUTTON (EDIT MODE)
     =============================== */

  function injectGlobalFixButton() {
    if (!isEdit) return;

    if (document.getElementById('hw24-global-fix')) return;

    const btn = document.createElement('button');
    btn.id = 'hw24-global-fix';
    btn.type = 'button';
    btn.textContent = 'Alle Descriptions korrigieren';
    btn.style.cssText = 'margin:8px 0;font-size:12px';

    btn.onclick = () => {
      const tbl = document.querySelector('#lineItemTab');
      if (!tbl) return;

      const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
      rows.forEach(tr => {
        const ta =
          tr.querySelector('textarea[name*="comment"]') ||
          tr.querySelector('textarea[id^="comment"]');
        if (!ta) return;
        ta.value = applyAllFixes(ta.value);
        refreshBadgeForRow(tr);
      });
    };

    const tbl = document.querySelector('#lineItemTab');
    tbl?.parentElement?.insertBefore(btn, tbl);
  }

  /* ===============================
     DETAIL VIEW TOTALS (MARGIN)
     =============================== */

  function injectDetailTotals() {
    if (!isDetail) return;
    if (document.getElementById('hw24-detail-totals')) return;

    const netTotalEl = document.getElementById('netTotal'); // Items Total position
    if (!netTotalEl) return;

    // Purchase Cost Sum: from line item purchase costs
    const rows = [...document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
    let sumPC = 0;

    rows.forEach(tr => {
      const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');
      sumPC += getPurchaseCost(tr, rn);
    });

    const itemsTotal = toNum(netTotalEl.textContent);
    const discountEl = document.getElementById('discountTotal_final'); // Overall Discount
    const overallDiscount = toNum(discountEl?.textContent);

    const effectiveTotal = itemsTotal - overallDiscount;
    const marginAbs = effectiveTotal - sumPC;
    const marginPct = sumPC ? (marginAbs / sumPC * 100) : 0;

    const box = document.createElement('div');
    box.id = 'hw24-detail-totals';
    box.style.cssText = 'margin-top:6px;font-weight:bold;text-align:right;font-size:12px;line-height:1.4';
    box.innerHTML = `
      <div>Purchase Cost Sum: ${sumPC.toFixed(2)}</div>
      <div>Margin: ${marginAbs.toFixed(2)} (${marginPct.toFixed(1)}%)</div>
    `;

    netTotalEl.parentElement?.appendChild(box);
  }

  function injectDetailMetaReloadButton() {
    if (!isDetail) return;
    if (document.getElementById('hw24-detail-reload')) return;

    const tbl = document.querySelector('#lineItemTab');
    if (!tbl) return;

    const btn = document.createElement('button');
    btn.id = 'hw24-detail-reload';
    btn.type = 'button';
    btn.textContent = 'Meta neu laden';
    btn.style.cssText = 'margin:8px 0;font-size:12px';

    btn.onclick = async () => {
      // optional: cache beibehalten, aber Re-Render + Badge/Totals
      await processDetail();
      injectDetailTotals();
    };

    tbl.parentElement?.insertBefore(btn, tbl);
  }

  /* ===============================
     CORE (EDIT)
     =============================== */

  async function processEdit() {
    injectGlobalFixButton();

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

      refreshBadgeForRow(tr);
      injectButtons(tr);
    }
  }

  /* ===============================
     CORE (DETAIL)
     =============================== */

  async function processDetail() {
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
        tr.querySelector('a[href*="module=Products"]')?.closest('td') ||
        tr.querySelector('td') ;

      if (!td) continue;

      const meta = await fetchMeta(`index.php?module=Products&view=Detail&record=${hid.value}`);
      const info = ensureInfo(td);
      renderInfo(info, meta);

      // Detail View: Badge nur, wenn Description vorhanden (manchmal readonly/hidden)
      refreshBadgeForRow(tr);
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

  if (isDetail) {
    // Auto-Meta im Detail View (wie gewünscht)
    await processDetail();
    injectDetailTotals();
    injectDetailMetaReloadButton();
  }

})();
