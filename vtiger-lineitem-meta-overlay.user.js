// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.6.1
// @description  Show product number (PROxxxxx), audit maintenance descriptions, enforce description structure, display margin calculations, tax region validation
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
    if ('value' in el) return toNum(el.value);
    return toNum(el.textContent);
  }

  // Detail-View: Werte aus Tabellenzellen extrahieren (Index-basiert)
  // Spalten: 0=Item Name, 1=Quantity, 2=Purchase Cost, 3=Selling Price, 4=Total, 5=Margin, 6=Net Price
  function getDetailCellValue(tr, colIndex) {
    const cells = tr.querySelectorAll('td');
    if (cells.length > colIndex) {
      return toNum(cells[colIndex].textContent);
    }
    return 0;
  }

  function getQuantity(tr, rn) {
    // Edit-Modus
    const q =
      tr.querySelector(`#qty${rn}`) ||
      tr.querySelector(`#quantity${rn}`) ||
      tr.querySelector(`input[name="qty${rn}"]`) ||
      tr.querySelector(`input[name="quantity${rn}"]`) ||
      tr.querySelector(`#qty${rn}_display`) ||
      tr.querySelector(`#quantity${rn}_display`);
    if (q) {
      const v = parseInt(S(q?.value ?? q?.textContent), 10);
      return Number.isFinite(v) ? v : 0;
    }
    // Detail-Modus: Spalte 1
    if (isDetail) return getDetailCellValue(tr, 1);
    return 0;
  }

  // Selling Price pro Stück (Unit Selling Price) — NICHT quantity-abhängig
  function getSellingPricePerUnit(tr, rn) {
    // Edit-Modus
    const el =
      tr.querySelector(`#listPrice${rn}`) ||
      tr.querySelector(`input[name="listPrice${rn}"]`) ||
      tr.querySelector(`#listPrice${rn}_display`) ||
      tr.querySelector(`span#listPrice${rn}_display`) ||
      tr.querySelector(`div#listPrice${rn}_display`) ||
      tr.querySelector(`[id="listPrice${rn}_display"]`);
    if (el) return getFieldNumber(el);
    // Detail-Modus: Spalte 3
    if (isDetail) return getDetailCellValue(tr, 3);
    return 0;
  }

  function getPurchaseCostPerUnit(tr, rn) {
    // Edit-Modus
    const el =
      tr.querySelector(`#purchaseCost${rn}`) ||
      tr.querySelector(`input[name="purchaseCost${rn}"]`) ||
      tr.querySelector(`#purchaseCost${rn}_display`) ||
      tr.querySelector(`span#purchaseCost${rn}_display`) ||
      tr.querySelector(`div#purchaseCost${rn}_display`) ||
      tr.querySelector(`[id="purchaseCost${rn}_display"]`);
    if (el) return getFieldNumber(el);
    // Detail-Modus: Spalte 2 ist bereits PC * Qty, also durch Qty teilen
    if (isDetail) {
      const totalPC = getDetailCellValue(tr, 2);
      const qty = getDetailCellValue(tr, 1) || 1;
      return totalPC / qty;
    }
    return 0;
  }

  // Detail-View: Purchase Cost Summe aus Zelle (bereits multipliziert)
  function getPurchaseCostTotal(tr, rn) {
    // Edit-Modus: PC pro Stück * Qty
    const el =
      tr.querySelector(`#purchaseCost${rn}`) ||
      tr.querySelector(`input[name="purchaseCost${rn}"]`) ||
      tr.querySelector(`#purchaseCost${rn}_display`);
    if (el) {
      const pcPerUnit = getFieldNumber(el);
      const qty = getQuantity(tr, rn) || 1;
      return pcPerUnit * qty;
    }
    // Detail-Modus: Spalte 2 ist bereits die Summe (PC * Qty)
    if (isDetail) return getDetailCellValue(tr, 2);
    return 0;
  }

  function getLineItemTotal(tr, rn) {
    // Edit-Modus
    const el =
      tr.querySelector(`#productTotal${rn}`) ||
      tr.querySelector(`#netPrice${rn}`) ||
      tr.querySelector(`#productTotal${rn}_display`);
    if (el) return getFieldNumber(el);
    // Detail-Modus: Spalte 6 (Net Price)
    if (isDetail) return getDetailCellValue(tr, 6);
    return 0;
  }

  /* ===============================
     META FETCH (extended with Product Purchase Cost)
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

      // Produkt-Purchase-Cost kann je nach Sprache/Label variieren → mehrere Kandidaten
      const pcRaw =
        getVal('purchase cost') ||
        getVal('purchasecost') ||
        getVal('einkauf') ||
        getVal('ek');

      const meta = {
        pn: productNo,
        vendor: getVal('vendor'),
        sla: getVal('sla'),
        duration: getVal('duration'),
        country: getVal('country'),
        purchaseCost: toNum(pcRaw) // ✅ Produktseite EK pro Stück
      };

      mem.set(url, meta);
      return meta;
    } catch {
      return {};
    }
  }

  /* ===============================
     MARKUP (FIXED)
     Markup = Selling Price (pro Stück) / Product Purchase Cost (pro Stück)
     =============================== */

  function calcMarkup(tr, rn, meta) {
    const sellingPerUnit = getSellingPricePerUnit(tr, rn);   // ✅ pro Stück

    // Versuche zuerst den Purchase Cost aus der Zeile (Detail-View)
    let pcProduct = getPurchaseCostPerUnit(tr, rn);

    // Fallback auf Meta-Daten (Produktseite)
    if (!pcProduct) {
      pcProduct = toNum(meta?.purchaseCost || 0);
    }

    if (!sellingPerUnit || !pcProduct) return null;
    return (sellingPerUnit / pcProduct).toFixed(2);
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

    const DE_ONLY = ["Standort:", "inkl.:", "Service Ende:"];
    const EN_ONLY = ["Location:", "incl.:", "Service End:"];

    const hasDE = lines.some(l => DE_ONLY.some(k => l.startsWith(k)));
    const hasEN = lines.some(l => EN_ONLY.some(k => l.startsWith(k)));

    if (hasDE && hasEN) return { ok: false, reason: "Sprachmix" };

    const base = hasEN ? LABELS.en : LABELS.de;
    let lastIndex = -1;

    const found = [];
    for (const l of lines) {
      const key = Object.values(LABELS).flat().find(k => l.startsWith(k));
      if (key) found.push(key);
    }

    for (const f of found) {
      const idx = base.indexOf(f);
      if (idx === -1) continue;
      if (idx < lastIndex) return { ok: false, reason: "Reihenfolge" };
      lastIndex = idx;
    }

    if (
      !lines.some(l => l.startsWith("Service Start:")) ||
      !lines.some(l => l.startsWith("Service Ende:") || l.startsWith("Service End:"))
    ) {
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

    return { line: `${label} ${raw}`, ok: false };
  }

  function hasInvalidServiceDate(desc) {
    const lines = desc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const dateLines = lines.filter(l => /^Service (Start|Ende|End):/i.test(l));
    return dateLines.some(l => !normalizeServiceDateLine(l).ok);
  }

  /* ===============================
     AUDITOR
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

  function hasBadSerialFormat(desc) {
    const m = desc.match(/S\/N:\s*([^\n]+)/i);
    if (!m) return false;
    return m[1].includes(';') || /,[^\s]/.test(m[1]);
  }

  function auditMaintenance(desc, qty) {
    if (!desc) return "🔴 Wartung: Keine Beschreibung";
    if (hasInvalidServiceDate(desc)) return "🔴 Wartung: Ungültiges Datum";
    if (hasBadSerialFormat(desc)) return "🟡 Wartung: S/N Format";

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
     DESCRIPTION STANDARDIZER
     =============================== */

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
    const desc =
      tr.querySelector('textarea[name*="comment"]')?.value ||
      tr.querySelector(`#comment${rn}`)?.value ||
      '';
    const qty = getQuantity(tr, rn);
    const info = tr.querySelector('.vt-prodinfo');
    if (!info) return;
    const auditor = ensureAuditor(info);
    auditor.textContent = auditMaintenance(desc, qty);
  }

  function renderInfo(info, meta, tr = null, rn = '') {
    // Falls tr nicht übergeben, aus info ermitteln
    if (!tr) tr = info.closest('tr');
    if (!rn) rn = tr?.getAttribute('data-row-num') || tr?.id?.replace('row', '') || '';

    const markup = tr ? calcMarkup(tr, rn, meta) : null;

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
     TOTALS PANEL (EDIT + DETAIL)
     =============================== */

  function calculateTotals() {
    // Edit-Modus: originale Selektoren
    let rows = [...document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];

    // Detail-Modus: Fallback auf lineItemsTable
    if (rows.length === 0 && isDetail) {
      const tbl = document.querySelector('table.lineItemsTable') || document.querySelector('.lineItemsTable');
      if (tbl) {
        rows = [...tbl.querySelectorAll('tr')].filter(tr =>
          tr.querySelector('a[href*="module=Products"]') ||
          tr.querySelector('a[href*="module=Services"]')
        );
      }
    }

    let sumPC = 0;
    let sumSelling = 0;

    rows.forEach(tr => {
      const rn = tr.getAttribute('data-row-num') || tr.id?.replace('row', '') || '';
      const qty = getQuantity(tr, rn) || 1;
      const sellingPerUnit = getSellingPricePerUnit(tr, rn);

      // Purchase Cost: getPurchaseCostTotal liefert bereits die Summe (auch in Detail-View)
      sumPC += getPurchaseCostTotal(tr, rn);
      sumSelling += sellingPerUnit * qty;
    });

    // Items Total aus dem DOM
    const netTotalEl =
      document.getElementById('netTotal') ||
      document.querySelector('[id$="_netTotal"]') ||
      document.querySelector('.netTotal');
    const itemsTotal = netTotalEl ? toNum(netTotalEl.textContent || netTotalEl.value) : sumSelling;

    // Overall Discount
    const discountEl =
      document.getElementById('discountTotal_final') ||
      document.querySelector('[id$="_discountTotal_final"]') ||
      document.querySelector('.discountTotal_final');
    const overallDiscount = toNum(discountEl?.textContent || discountEl?.value);

    // Margin vor Discount
    const marginBeforeDiscount = itemsTotal - sumPC;
    const marginBeforeDiscountPct = sumPC ? (marginBeforeDiscount / sumPC * 100) : 0;

    // Effective Total nach Discount
    const effectiveTotal = itemsTotal - overallDiscount;

    // Margin nach Discount
    const marginAfterDiscount = effectiveTotal - sumPC;
    const marginAfterDiscountPct = sumPC ? (marginAfterDiscount / sumPC * 100) : 0;

    return {
      sumPC,
      itemsTotal,
      overallDiscount,
      marginBeforeDiscount,
      marginBeforeDiscountPct,
      effectiveTotal,
      marginAfterDiscount,
      marginAfterDiscountPct
    };
  }

  function injectTotalsPanel() {
    // Entferne existierendes Panel
    document.getElementById('hw24-totals-panel')?.remove();

    const totals = calculateTotals();

    // Finde Einfügepunkt
    const netTotalEl =
      document.getElementById('netTotal') ||
      document.querySelector('[id$="_netTotal"]') ||
      document.querySelector('.netTotal');

    const tbl = document.querySelector('#lineItemTab') ||
                document.querySelector('table.lineItemsTable') ||
                document.querySelector('.lineItemsTable');
    const insertTarget = netTotalEl?.closest('tr')?.parentElement || tbl?.parentElement;

    if (!insertTarget) return;

    const panel = document.createElement('div');
    panel.id = 'hw24-totals-panel';
    panel.style.cssText = `
      margin: 12px 0;
      padding: 10px 14px;
      background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.6;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    `;

    const formatNum = n => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatPct = n => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    const marginColor = totals.marginAfterDiscount >= 0 ? '#16a34a' : '#dc2626';
    const marginBeforeColor = totals.marginBeforeDiscount >= 0 ? '#16a34a' : '#dc2626';

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-weight:bold;font-size:13px;margin-bottom:8px;color:#1e293b;border-bottom:1px solid #cbd5e1;padding-bottom:6px;">
        <span>📊 Kalkulation</span>
        <button type="button" id="hw24-panel-refresh" style="
          padding: 4px 10px;
          font-size: 11px;
          background: #3b82f6;
          color: #fff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        ">🔄 Refresh</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr>
          <td style="padding:3px 0;color:#64748b;">Purchase Cost (Summe):</td>
          <td style="padding:3px 0;text-align:right;font-weight:600;">${totals.sumPC ? formatNum(totals.sumPC) + ' €' : '—'}</td>
        </tr>
        <tr>
          <td style="padding:3px 0;color:#64748b;">Items Total:</td>
          <td style="padding:3px 0;text-align:right;font-weight:600;">${formatNum(totals.itemsTotal)} €</td>
        </tr>
        <tr style="border-top:1px dashed #cbd5e1;">
          <td style="padding:6px 0 3px;color:#475569;font-weight:500;">Marge (vor Discount):</td>
          <td style="padding:6px 0 3px;text-align:right;font-weight:bold;color:${marginBeforeColor};">
            ${totals.sumPC ? formatNum(totals.marginBeforeDiscount) + ' €' : '—'}
            ${totals.sumPC ? '<span style="font-weight:normal;color:#64748b;"> (' + formatPct(totals.marginBeforeDiscountPct) + '%)</span>' : ''}
          </td>
        </tr>
        ${totals.overallDiscount ? `
        <tr>
          <td style="padding:3px 0;color:#64748b;">Overall Discount:</td>
          <td style="padding:3px 0;text-align:right;font-weight:600;color:#dc2626;">- ${formatNum(totals.overallDiscount)} €</td>
        </tr>
        ` : ''}
        <tr style="background:#e2e8f0;border-radius:4px;">
          <td style="padding:6px 8px;color:#1e293b;font-weight:600;">Marge (nach Discount):</td>
          <td style="padding:6px 8px;text-align:right;font-weight:bold;font-size:13px;color:${marginColor};">
            ${totals.sumPC ? formatNum(totals.marginAfterDiscount) + ' €' : '—'}
            ${totals.sumPC ? '<span style="font-weight:normal;color:#64748b;"> (' + formatPct(totals.marginAfterDiscountPct) + '%)</span>' : ''}
          </td>
        </tr>
      </table>
    `;

    // Refresh Button Event
    panel.querySelector('#hw24-panel-refresh').onclick = async () => {
      const btn = panel.querySelector('#hw24-panel-refresh');
      btn.disabled = true;
      btn.textContent = '⏳...';

      if (isEdit) {
        await processEdit();
      } else if (isDetail) {
        await processDetail();
      }
      injectTotalsPanel();
    };

    // Einfügen nach der lineItemTab Tabelle
    if (tbl?.parentElement) {
      tbl.parentElement.insertBefore(panel, tbl.nextSibling);
    } else {
      insertTarget.appendChild(panel);
    }
  }

  // Meta-Daten Sichtbarkeit State
  let metaVisible = true;

  function toggleMetaVisibility() {
    metaVisible = !metaVisible;
    document.querySelectorAll('.vt-prodinfo').forEach(el => {
      el.style.display = metaVisible ? 'block' : 'none';
    });
    const toggleBtn = document.getElementById('hw24-meta-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = metaVisible ? '👁 Meta ausblenden' : '👁 Meta einblenden';
    }
  }

  function injectReloadButton() {
    if (document.getElementById('hw24-reload-btn')) return;

    const tbl = document.querySelector('#lineItemTab') ||
                document.querySelector('table.lineItemsTable') ||
                document.querySelector('.lineItemsTable');
    if (!tbl) return;

    // Container für Buttons
    const btnContainer = document.createElement('div');
    btnContainer.id = 'hw24-btn-container';
    btnContainer.style.cssText = 'margin: 8px 0; display: flex; gap: 8px; flex-wrap: wrap;';

    // Reload Button
    const btn = document.createElement('button');
    btn.id = 'hw24-reload-btn';
    btn.type = 'button';
    btn.textContent = '🔄 Meta & Kalkulation neu laden';
    btn.style.cssText = `
      padding: 6px 12px;
      font-size: 12px;
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;

    btn.onmouseenter = () => btn.style.background = '#2563eb';
    btn.onmouseleave = () => btn.style.background = '#3b82f6';

    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '⏳ Laden...';

      if (isEdit) {
        await processEdit();
      } else if (isDetail) {
        await processDetail();
      }
      injectTotalsPanel();

      btn.disabled = false;
      btn.textContent = '🔄 Meta & Kalkulation neu laden';
    };

    // Toggle Button für Meta-Daten
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'hw24-meta-toggle';
    toggleBtn.type = 'button';
    toggleBtn.textContent = '👁 Meta ausblenden';
    toggleBtn.style.cssText = `
      padding: 6px 12px;
      font-size: 12px;
      background: #6b7280;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    `;

    toggleBtn.onmouseenter = () => toggleBtn.style.background = '#4b5563';
    toggleBtn.onmouseleave = () => toggleBtn.style.background = '#6b7280';
    toggleBtn.onclick = toggleMetaVisibility;

    btnContainer.appendChild(btn);
    btnContainer.appendChild(toggleBtn);
    tbl.parentElement?.insertBefore(btnContainer, tbl);
  }

  /* ===============================
     TAX / REVERSE CHARGE VALIDATION
     =============================== */

  // EU-Länder Liste (für Tax Region Bestimmung)
  const EU_COUNTRIES = [
    'austria', 'österreich', 'belgium', 'belgien', 'bulgaria', 'bulgarien',
    'croatia', 'kroatien', 'cyprus', 'zypern', 'czech republic', 'tschechien',
    'denmark', 'dänemark', 'estonia', 'estland', 'finland', 'finnland',
    'france', 'frankreich', 'germany', 'deutschland', 'greece', 'griechenland',
    'hungary', 'ungarn', 'ireland', 'irland', 'italy', 'italien',
    'latvia', 'lettland', 'lithuania', 'litauen', 'luxembourg', 'luxemburg',
    'malta', 'netherlands', 'niederlande', 'poland', 'polen', 'portugal',
    'romania', 'rumänien', 'slovakia', 'slowakei', 'slovenia', 'slowenien',
    'spain', 'spanien', 'sweden', 'schweden'
  ];

  function isAustria(country) {
    const c = S(country).toLowerCase();
    return c === 'austria' || c === 'österreich' || c === 'at';
  }

  function isGermany(country) {
    const c = S(country).toLowerCase();
    return c === 'germany' || c === 'deutschland' || c === 'de';
  }

  function isEUCountry(country) {
    const c = S(country).toLowerCase();
    return EU_COUNTRIES.some(eu => c.includes(eu) || eu.includes(c));
  }

  function getFieldValue(fieldName) {
    // Versuche verschiedene Selektoren
    const el =
      document.querySelector(`[name="${fieldName}"]`) ||
      document.querySelector(`#${fieldName}`) ||
      document.querySelector(`select[name="${fieldName}"]`) ||
      document.querySelector(`input[name="${fieldName}"]`);
    if (el) {
      if (el.type === 'checkbox') return el.checked;
      return el.value;
    }
    // Fallback: data-name Attribut
    const el2 = document.querySelector(`[data-name="${fieldName}"]`);
    return el2?.value || el2?.textContent || '';
  }

  function setFieldValue(fieldName, value) {
    const el =
      document.querySelector(`[name="${fieldName}"]`) ||
      document.querySelector(`#${fieldName}`) ||
      document.querySelector(`select[name="${fieldName}"]`) ||
      document.querySelector(`input[name="${fieldName}"]`);
    if (!el) return false;

    if (el.type === 'checkbox') {
      el.checked = !!value;
    } else {
      el.value = value;
    }
    // Trigger change event
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function getBillingCountry() {
    // Billing Country Feld
    const el =
      document.querySelector('[name="bill_country"]') ||
      document.querySelector('[data-fieldname="bill_country"]') ||
      document.querySelector('input[id*="_editView_fieldName_bill_country"]') ||
      document.querySelector('[name="billing_country"]');
    return el?.value || '';
  }

  // Tax Region: Select2 Dropdown mit id="region_id"
  // Werte: 12=EU, 13=Non-EU, 14=Germany (19%), 15=Austria
  const TAX_REGION_MAP = {
    'eu': '12',
    'non-eu': '13',
    'germany': '14',
    'germany (19%)': '14',
    'austria': '15'
  };

  function getTaxRegion() {
    const el = document.querySelector('#region_id');
    if (el && el.selectedIndex >= 0) {
      return el.options[el.selectedIndex]?.textContent?.trim() || '';
    }
    return '';
  }

  function setTaxRegion(targetName) {
    const el = document.querySelector('#region_id');
    if (!el) return false;

    const targetLower = targetName.toLowerCase();
    const targetValue = TAX_REGION_MAP[targetLower];

    // Finde die passende Option
    for (let i = 0; i < el.options.length; i++) {
      const optText = el.options[i].textContent.toLowerCase();
      const optValue = el.options[i].value;

      if (optValue === targetValue || optText.includes(targetLower)) {
        el.value = optValue;

        // Trigger Select2 Change Event
        if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
          jQuery(el).trigger('change');
        } else {
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }
    }
    return false;
  }

  function findReverseChargeCheckbox() {
    // Reverse Charge Custom Field IDs je nach Modul:
    // - Quote: cf_924
    // - Sales Order: cf_928
    // - Invoice: cf_876
    const reverseChargeFields = ['cf_924', 'cf_928', 'cf_876'];

    for (const fieldName of reverseChargeFields) {
      const selectors = [
        `input[type="checkbox"][name="${fieldName}"]`,
        `input[name="${fieldName}"]`,
        `input[type="checkbox"][data-fieldname="${fieldName}"]`,
        `[data-name="${fieldName}"]`
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && (el.type === 'checkbox' || el.type === 'hidden')) {
          return el;
        }
      }
    }

    return null;
  }

  function getReverseCharge() {
    const el = findReverseChargeCheckbox();
    if (!el) return false;

    // Checkbox
    if (el.type === 'checkbox') {
      return el.checked;
    }
    // Hidden input (value = "1" oder "on" = aktiv)
    if (el.type === 'hidden') {
      return el.value === '1' || el.value === 'on' || el.value === 'true';
    }
    return false;
  }

  function setReverseCharge(value) {
    const el = findReverseChargeCheckbox();
    if (!el) return false;

    if (el.type === 'checkbox') {
      el.checked = !!value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // Manche VTiger Checkboxen brauchen click Event
      if (!value && el.checked) {
        el.click();
      }
    } else if (el.type === 'hidden') {
      el.value = value ? '1' : '0';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function getSubject() {
    // Subject Feld - verschiedene IDs je nach Modul
    const el =
      document.querySelector('[name="subject"]') ||
      document.querySelector('[data-fieldname="subject"]') ||
      document.querySelector('#PurchaseOrder_editView_fieldName_subject') ||
      document.querySelector('#Quotes_editView_fieldName_subject') ||
      document.querySelector('#SalesOrder_editView_fieldName_subject') ||
      document.querySelector('#Invoice_editView_fieldName_subject') ||
      document.querySelector('input[id*="_editView_fieldName_subject"]');
    return el?.value || '';
  }

  // Subject-Präfix bestimmt den Typ: W/WV=Wartung, H=Handel, M=Managed Service, R=Reparatur
  function getSubjectType() {
    const subject = S(getSubject()).toUpperCase();
    if (!subject) return '';

    if (subject.startsWith('WV')) return 'wartung';
    if (subject.startsWith('W')) return 'wartung';
    if (subject.startsWith('H')) return 'handel';
    if (subject.startsWith('M')) return 'managed';
    if (subject.startsWith('R')) return 'reparatur';
    return '';
  }

  function validateTaxSettings() {
    if (!isEdit) return null;

    const billingCountry = getBillingCountry();
    const taxRegion = getTaxRegion();
    const reverseCharge = getReverseCharge();
    const subjectType = getSubjectType(); // W/WV=wartung, H=handel, M=managed, R=reparatur
    const issues = [];

    const taxRegionLower = taxRegion.toLowerCase();
    const isAustriaTaxRegion = taxRegionLower.includes('austria');
    const isGermanyTaxRegion = taxRegionLower.includes('germany');
    const isEUTaxRegion = taxRegionLower === 'eu';
    const isNonEUTaxRegion = taxRegionLower.includes('non-eu');

    // Bestimme die korrekte Tax Region basierend auf Billing Country
    const billingIsAustria = isAustria(billingCountry);
    const billingIsGermany = isGermany(billingCountry);
    const billingIsEU = !billingIsAustria && !billingIsGermany && isEUCountry(billingCountry);
    const billingIsNonEU = billingCountry && !billingIsAustria && !billingIsGermany && !billingIsEU;

    // Für Quotes, SalesOrder, Invoice
    if (['Quotes', 'SalesOrder', 'Invoice'].includes(currentModule)) {

      // === BILLING COUNTRY AUSTRIA ===
      if (billingIsAustria) {
        // Reverse Charge darf nicht aktiv sein
        if (reverseCharge) {
          issues.push({
            type: 'error',
            message: '⚠️ Reverse Charge ist aktiviert, aber Billing Country ist Österreich!',
            fix: () => setReverseCharge(false),
            fixLabel: 'Reverse Charge deaktivieren'
          });
        }
        // Tax Region muss Austria sein
        if (taxRegion && !isAustriaTaxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Austria" sein für Billing Country Österreich.`,
            fix: () => setTaxRegion('Austria'),
            fixLabel: 'Tax Region → Austria'
          });
        }
      }

      // === BILLING COUNTRY GERMANY ===
      else if (billingIsGermany) {
        // Reverse Charge darf nicht aktiv sein
        if (reverseCharge) {
          issues.push({
            type: 'error',
            message: '⚠️ Reverse Charge ist aktiviert, aber Billing Country ist Deutschland!',
            fix: () => setReverseCharge(false),
            fixLabel: 'Reverse Charge deaktivieren'
          });
        }
        // Tax Region muss Germany sein
        if (taxRegion && !isGermanyTaxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Germany (19%)" sein für Billing Country Deutschland.`,
            fix: () => setTaxRegion('Germany'),
            fixLabel: 'Tax Region → Germany (19%)'
          });
        }
      }

      // === BILLING COUNTRY EU (nicht AT/DE) ===
      else if (billingIsEU) {
        // Tax Region muss EU sein
        if (taxRegion && !isEUTaxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "EU" sein für Billing Country ${billingCountry}.`,
            fix: () => setTaxRegion('EU'),
            fixLabel: 'Tax Region → EU'
          });
        }
        // Reverse Charge ist OK für EU
      }

      // === BILLING COUNTRY NON-EU ===
      else if (billingIsNonEU) {
        // Tax Region muss Non-EU sein
        if (taxRegion && !isNonEUTaxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Non-EU" sein für Billing Country ${billingCountry}.`,
            fix: () => setTaxRegion('Non-EU'),
            fixLabel: 'Tax Region → Non-EU'
          });
        }
        // Reverse Charge ist OK für Non-EU
      }

      // === ZUSÄTZLICHE KOMBINATIONS-CHECKS (falls Billing Country nicht gesetzt) ===
      if (!billingCountry) {
        // Reverse Charge + Tax Region Austria = NICHT erlaubt
        if (reverseCharge && isAustriaTaxRegion) {
          issues.push({
            type: 'error',
            message: '⚠️ Reverse Charge + Tax Region Austria ist nicht erlaubt. Bitte Billing Country prüfen!',
            fix: () => setReverseCharge(false),
            fixLabel: 'Reverse Charge deaktivieren'
          });
        }

        // Reverse Charge + Tax Region Germany = NICHT erlaubt
        if (reverseCharge && isGermanyTaxRegion) {
          issues.push({
            type: 'error',
            message: '⚠️ Reverse Charge + Tax Region Germany ist nicht erlaubt. Bitte Billing Country prüfen!',
            fix: () => setReverseCharge(false),
            fixLabel: 'Reverse Charge deaktivieren'
          });
        }
      }
    }

    // Für PurchaseOrder
    if (currentModule === 'PurchaseOrder') {
      if (billingIsAustria) {
        // Österreich → Tax Region Austria
        if (taxRegion && !isAustriaTaxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Austria" sein für Billing Country Österreich.`,
            fix: () => setTaxRegion('Austria'),
            fixLabel: 'Tax Region → Austria'
          });
        }
      } else if (billingIsGermany) {
        if (subjectType === 'wartung') {
          // Deutschland + Wartung (W/WV) → EU (nicht Austria)
          if (taxRegion && !isEUTaxRegion) {
            issues.push({
              type: 'error',
              message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "EU" sein für Deutschland + Wartung (W/WV).`,
              fix: () => setTaxRegion('EU'),
              fixLabel: 'Tax Region → EU'
            });
          }
        } else if (subjectType === 'handel') {
          // Deutschland + Handel (H) → Germany (19%)
          if (taxRegion && !isGermanyTaxRegion) {
            issues.push({
              type: 'error',
              message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Germany (19%)" sein für Deutschland + Handel (H).`,
              fix: () => setTaxRegion('Germany'),
              fixLabel: 'Tax Region → Germany (19%)'
            });
          }
        }
      } else if (billingIsEU) {
        // EU-Land → Tax Region EU
        if (taxRegion && !isEUTaxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "EU" sein für Billing Country ${billingCountry}.`,
            fix: () => setTaxRegion('EU'),
            fixLabel: 'Tax Region → EU'
          });
        }
      } else if (billingIsNonEU) {
        // Non-EU-Land → Tax Region Non-EU
        if (taxRegion && !isNonEUTaxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Non-EU" sein für Billing Country ${billingCountry}.`,
            fix: () => setTaxRegion('Non-EU'),
            fixLabel: 'Tax Region → Non-EU'
          });
        }
      }
    }

    return issues;
  }

  // Popup für Tax-Validierung beim Speichern
  function showTaxValidationPopup(issues, onFix, onIgnore) {
    // Entferne existierendes Popup
    document.getElementById('hw24-tax-popup-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hw24-tax-popup-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const popup = document.createElement('div');
    popup.style.cssText = `
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
    `;

    let issuesHtml = '';
    issues.forEach((issue) => {
      const bgColor = issue.type === 'error' ? '#fef2f2' : '#fef3c7';
      const borderColor = issue.type === 'error' ? '#f87171' : '#fbbf24';
      const icon = issue.type === 'error' ? '🔴' : '🟡';
      issuesHtml += `
        <div style="
          background: ${bgColor};
          border: 1px solid ${borderColor};
          border-radius: 6px;
          padding: 10px 12px;
          margin-bottom: 8px;
          font-size: 13px;
        ">
          ${icon} ${issue.message}
        </div>
      `;
    });

    popup.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
        color: #fff;
        padding: 16px 20px;
        border-radius: 12px 12px 0 0;
        font-weight: bold;
        font-size: 15px;
      ">
        🚨 Tax / Reverse Charge Warnung
      </div>
      <div style="padding: 20px;">
        <p style="margin: 0 0 16px 0; color: #374151; font-size: 13px;">
          Es wurden folgende Probleme gefunden:
        </p>
        ${issuesHtml}
        <div style="
          display: flex;
          gap: 12px;
          margin-top: 20px;
          justify-content: flex-end;
        ">
          <button type="button" id="hw24-popup-ignore" style="
            padding: 10px 20px;
            font-size: 13px;
            background: #6b7280;
            color: #fff;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
          ">Ignorieren & Speichern</button>
          <button type="button" id="hw24-popup-fix" style="
            padding: 10px 20px;
            font-size: 13px;
            background: #16a34a;
            color: #fff;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
          ">✓ Korrigieren & Speichern</button>
        </div>
      </div>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Event Listener
    document.getElementById('hw24-popup-fix').onclick = () => {
      overlay.remove();
      onFix();
    };

    document.getElementById('hw24-popup-ignore').onclick = () => {
      overlay.remove();
      onIgnore();
    };

    // ESC zum Schließen (ohne Speichern)
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  // Save-Button Interceptor
  let originalSaveHandler = null;
  let saveInterceptorInstalled = false;

  function interceptSaveButton() {
    if (!isEdit || saveInterceptorInstalled) return;

    // Finde Save-Buttons
    const saveButtons = document.querySelectorAll(
      'button[name="saveButton"], ' +
      'input[name="saveButton"], ' +
      'button.btn-success[type="submit"], ' +
      '[data-action="Save"], ' +
      '.saveButton, ' +
      'button[type="submit"]'
    );

    saveButtons.forEach(btn => {
      // Clone und ersetze den Button, um bestehende Event Listener zu entfernen
      const newBtn = btn.cloneNode(true);
      btn.parentNode?.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', function(e) {
        const issues = validateTaxSettings();

        if (issues && issues.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          showTaxValidationPopup(
            issues,
            // onFix
            () => {
              issues.forEach(issue => issue.fix?.());
              // Nach Fix speichern
              setTimeout(() => triggerSave(), 100);
            },
            // onIgnore
            () => {
              // Direkt speichern ohne Fix
              triggerSave();
            }
          );

          return false;
        }
      }, true); // useCapture = true für höchste Priorität
    });

    saveInterceptorInstalled = true;
  }

  function triggerSave() {
    // Temporär den Interceptor deaktivieren
    saveInterceptorInstalled = false;

    // Finde und klicke den Save-Button
    const saveBtn = document.querySelector(
      'button[name="saveButton"], ' +
      'input[name="saveButton"], ' +
      'button.btn-success[type="submit"], ' +
      '.saveButton'
    );

    if (saveBtn) {
      // Erstelle einen neuen Click ohne unseren Interceptor
      const form = saveBtn.closest('form');
      if (form) {
        form.submit();
      } else {
        saveBtn.click();
      }
    }
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

  function extractProductUrlFromRow(tr) {
    // Verschiedene Selektoren für Produkt-Links in Detail-Ansicht
    const a =
      tr.querySelector(`a[href*="module=Products"][href*="record="]`) ||
      tr.querySelector(`a[href*="module=Products"][href*="view=Detail"]`) ||
      tr.querySelector(`a[href*="module=Services"][href*="record="]`) ||
      tr.querySelector(`a.productsPopupLink`) ||
      tr.querySelector(`a[data-module="Products"]`);

    const href = a?.getAttribute('href');
    if (!href) return '';

    try {
      const u = new URL(href, location.origin);
      const rec = u.searchParams.get('record');
      if (!rec) return '';
      return `index.php?module=Products&view=Detail&record=${rec}`;
    } catch {
      return '';
    }
  }

  function findLineItemTable() {
    // Verschiedene Selektoren für die LineItem-Tabelle
    return document.querySelector('#lineItemTab') ||
           document.querySelector('table.lineItemsTable') ||
           document.querySelector('.lineItemsTable') ||
           document.querySelector('.lineItemTab') ||
           document.querySelector('[id*="lineItem"]') ||
           document.querySelector('.detailViewTable table') ||
           document.querySelector('.inventoryTable') ||
           document.querySelector('table.listview-table');
  }

  function findLineItemRows(container) {
    if (!container) return [];

    // Verschiedene Selektoren für LineItem-Zeilen
    const selectors = [
      'tr.lineItemRow[id^="row"]',
      'tr.inventoryRow',
      'tr[id^="row"]',
      'tr.listViewEntries',
      'tr[data-row-num]',
      'tbody tr',
      'tr'
    ];

    for (const sel of selectors) {
      const rows = [...container.querySelectorAll(sel)];
      // Filter: nur Zeilen mit Produkt-Link (verschiedene Klassen)
      const validRows = rows.filter(tr =>
        tr.querySelector('a[href*="module=Products"]') ||
        tr.querySelector('a[href*="module=Services"]') ||
        tr.querySelector('a.productsPopupLink') ||
        tr.querySelector('a.fieldValue[href*="module=Products"]')
      );
      if (validRows.length > 0) return validRows;
    }

    // Fallback: Alle Zeilen die einen Produkt-Link enthalten
    const allRows = [...container.querySelectorAll('tr')];
    const productRows = allRows.filter(tr =>
      tr.querySelector('a[href*="module=Products"]') ||
      tr.querySelector('a[href*="module=Services"]')
    );
    if (productRows.length > 0) return productRows;

    return [];
  }

  async function processDetail() {
    const tbl = findLineItemTable();
    if (!tbl) return;

    const rows = findLineItemRows(tbl);

    for (const tr of rows) {
      const rn = tr.getAttribute('data-row-num') || tr.id?.replace('row', '') || '';

      const url = extractProductUrlFromRow(tr);
      if (!url) continue;

      // Finde die Produktnamen-Zelle
      const a = tr.querySelector(`a[href*="module=Products"]`) ||
                tr.querySelector(`a[href*="module=Services"]`) ||
                tr.querySelector(`a.productsPopupLink`);
      const td = a?.closest('td');
      if (!td) continue;

      const meta = await fetchMeta(url);
      const info = ensureInfo(td);
      renderInfo(info, meta, tr, rn);
    }
  }

  // Warte auf AJAX-geladene Inhalte
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /* ===============================
     BOOTSTRAP
     =============================== */

  if (isEdit) {
    await processEdit();
    injectTotalsPanel();
    injectReloadButton();
    interceptSaveButton();

    const rerun = debounce(async () => {
      await processEdit();
      injectTotalsPanel();
    }, 700);

    const tbl = document.querySelector('#lineItemTab');
    if (tbl) new MutationObserver(rerun).observe(tbl, { childList: true, subtree: true });
  }

  if (isDetail) {
    const initDetail = async () => {
      let tbl = findLineItemTable();

      // Falls Tabelle noch nicht da, warte darauf
      if (!tbl) {
        tbl = await waitForElement('#lineItemTab, .lineItemsTable, .lineItemTab, [id*="lineItem"], .inventoryTable', 5000);
      }

      if (tbl) {
        await processDetail();
        injectTotalsPanel();
        injectReloadButton();

        const rerunD = debounce(async () => {
          await processDetail();
          injectTotalsPanel();
        }, 700);

        new MutationObserver(rerunD).observe(tbl, { childList: true, subtree: true });
      }
    };

    // Starte sofort und auch nach vollständigem Laden
    await initDetail();

    // Fallback: Nochmal versuchen wenn Seite komplett geladen
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => setTimeout(initDetail, 1000));
    }

    // Extra Fallback nach 2 Sekunden
    setTimeout(initDetail, 2000);
  }

})();
