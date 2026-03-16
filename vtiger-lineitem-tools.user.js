// ==UserScript==
// @name         VTiger LineItem Tools (Unified)
// @namespace    hw24.vtiger.lineitem.tools
// @version      2.7.11
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-tools.user.js
// @description  Unified LineItem tools: Meta Overlay, SN Reconciliation, Price Multiplier
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  const HW24_VERSION = '2.7.12';
  console.log('%c[HW24] vtiger-lineitem-tools v' + HW24_VERSION + ' loaded', 'color:#059669;font-weight:bold;font-size:14px');

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE / VIEW DETECTION
     ═══════════════════════════════════════════════════════════════════════════ */

  const SUPPORTED_MODULES = ['Quotes', 'SalesOrder', 'Invoice', 'PurchaseOrder', 'Products', 'Potentials'];
  const LINEITEM_MODULES = ['Quotes', 'SalesOrder', 'Invoice', 'PurchaseOrder'];

  const currentModule = location.href.match(new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`))?.[1] || '';
  const isEdit = location.href.includes('view=Edit') && currentModule;
  const isDetail = location.href.includes('view=Detail') && currentModule;
  const isLineItemModule = LINEITEM_MODULES.includes(currentModule);

  if (!isEdit && !isDetail) return;

  /* ═══════════════════════════════════════════════════════════════════════════
     SHARED UTILITIES
     ═══════════════════════════════════════════════════════════════════════════ */

  const $ = id => document.getElementById(id);
  const S = s => (s || '').toString().trim();
  const norm = s => S(s).toUpperCase().replace(/\s+/g, '');
  const uniq = a => [...new Set(a)];

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

  function fire(el) {
    el && ['input', 'change', 'blur'].forEach(e =>
      el.dispatchEvent(new Event(e, { bubbles: true }))
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SHARED META FETCH
     ═══════════════════════════════════════════════════════════════════════════ */

  const metaCache = new Map();

  async function fetchMeta(url) {
    if (!url) return {};
    if (metaCache.has(url)) return metaCache.get(url);

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
      const productName = getVal('product name') || getVal('produktname') || getVal('product');

      // Produkt-Purchase-Cost
      const pcRaw = getVal('purchase cost') || getVal('purchasecost') || getVal('einkauf') || getVal('ek');

      // Listenpreis (cf_2205)
      let listenpreisRaw = '';
      const cfEl1 = dp.querySelector('#Products_detailView_fieldValue_cf_2205');
      if (cfEl1) listenpreisRaw = S(cfEl1.textContent);
      if (!listenpreisRaw) {
        const cfEl2 = dp.querySelector('[data-name="cf_2205"]');
        if (cfEl2) listenpreisRaw = S(cfEl2.textContent || cfEl2.value);
      }
      if (!listenpreisRaw) {
        const cfEl3 = dp.querySelector('[id*="cf_2205"]');
        if (cfEl3) listenpreisRaw = S(cfEl3.textContent || cfEl3.value);
      }
      if (!listenpreisRaw) {
        const cfEl4 = dp.querySelector('input[name="cf_2205"]');
        if (cfEl4) {
          listenpreisRaw = cfEl4.type === 'checkbox' ? (cfEl4.checked ? 'ja' : '') : S(cfEl4.value);
        }
      }
      if (!listenpreisRaw) {
        const allLabels = dp.querySelectorAll('td.fieldLabel, th.fieldLabel, .fieldLabel, label');
        for (const lab of allLabels) {
          const txt = S(lab.textContent).toLowerCase();
          if (txt.includes('listenpreis') || txt.includes('list price') || txt.includes('listprice')) {
            const valueCell = lab.nextElementSibling ||
              lab.closest('tr')?.querySelector('td.fieldValue, .fieldValue') ||
              lab.parentElement?.querySelector('.fieldValue');
            if (valueCell) {
              listenpreisRaw = S(valueCell.textContent);
              break;
            }
          }
        }
      }

      const isListenpreis = listenpreisRaw && ['ja', 'yes', '1', 'true', 'x', '✓', '✔', 'on'].some(
        v => listenpreisRaw.toLowerCase().includes(v)
      );

      const meta = {
        pn: productNo,
        productName: productName,
        vendor: getVal('vendor'),
        sla: getVal('sla'),
        duration: getVal('duration'),
        country: getVal('country'),
        purchaseCost: toNum(pcRaw),
        listenpreis: isListenpreis
      };

      metaCache.set(url, meta);
      return meta;
    } catch {
      return {};
    }
  }

  async function fetchMetaById(productId) {
    if (!productId) return {};
    return fetchMeta(`index.php?module=Products&view=Detail&record=${productId}`);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SHARED STYLES
     ═══════════════════════════════════════════════════════════════════════════ */

  const SHARED_STYLES = `
    /* ===== Meta Overlay Panel ===== */
    #hw24-totals-panel {
      margin: 12px 0;
      padding: 10px 14px;
      background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.6;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    /* ===== SN Reconcile ===== */
    #hw24-sn-toggle {
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
      color: #fff;
      border: none;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
      cursor: pointer;
      font-size: 20px;
      z-index: 2147483646;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #hw24-sn-toggle:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 16px rgba(59, 130, 246, 0.5);
    }

    #hw24-sn-panel {
      position: fixed;
      bottom: 80px;
      left: 20px;
      width: 420px;
      max-height: calc(100vh - 120px);
      background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      z-index: 2147483647;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px;
      overflow: hidden;
      display: none;
    }
    #hw24-sn-panel.visible { display: block; }

    #hw24-sn-panel .panel-header {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      color: #fff;
      padding: 12px 16px;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #hw24-sn-panel .panel-header button {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 18px;
      padding: 0;
      line-height: 1;
    }
    #hw24-sn-panel .panel-header button:hover { color: #fff; }

    #hw24-sn-panel .panel-body {
      padding: 16px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }

    #hw24-sn-panel .section { margin-bottom: 16px; }
    #hw24-sn-panel .section-title {
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #hw24-sn-panel .section-title .count {
      background: #3b82f6;
      color: #fff;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
    }

    #hw24-sn-panel .line-item {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    #hw24-sn-panel .line-item-header {
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 4px;
      font-size: 12px;
    }
    #hw24-sn-panel .line-item-meta {
      font-size: 11px;
      color: #64748b;
      margin-bottom: 6px;
    }
    #hw24-sn-panel .sn-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    #hw24-sn-panel .sn-tag {
      background: #dbeafe;
      color: #1e40af;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    #hw24-sn-panel .sn-tag.to-remove {
      background: #fee2e2;
      color: #991b1b;
      text-decoration: line-through;
    }

    #hw24-sn-panel textarea {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 12px;
      font-family: monospace;
      resize: vertical;
      min-height: 60px;
    }
    #hw24-sn-panel textarea:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    #hw24-sn-panel .btn-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }
    #hw24-sn-panel .btn {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    #hw24-sn-panel .btn-primary { background: #3b82f6; color: #fff; }
    #hw24-sn-panel .btn-primary:hover { background: #2563eb; }
    #hw24-sn-panel .btn-secondary { background: #e2e8f0; color: #475569; }
    #hw24-sn-panel .btn-secondary:hover { background: #cbd5e1; }
    #hw24-sn-panel .btn-danger { background: #ef4444; color: #fff; }
    #hw24-sn-panel .btn-danger:hover { background: #dc2626; }
    #hw24-sn-panel .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    #hw24-sn-panel .status-msg {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 12px;
    }
    #hw24-sn-panel .status-msg.success { background: #dcfce7; color: #166534; }
    #hw24-sn-panel .status-msg.warning { background: #fef3c7; color: #92400e; }
    #hw24-sn-panel .status-msg.error { background: #fee2e2; color: #991b1b; }

    #hw24-sn-panel .result-group { margin-bottom: 12px; }
    #hw24-sn-panel .result-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 12px;
      margin-bottom: 6px;
      padding: 6px 8px;
      border-radius: 6px;
    }
    #hw24-sn-panel .result-header.matching { background: #dcfce7; color: #166534; }
    #hw24-sn-panel .result-header.to-remove { background: #fee2e2; color: #991b1b; }
    #hw24-sn-panel .result-header.missing { background: #fef3c7; color: #92400e; }
    #hw24-sn-panel .result-header .count { margin-left: auto; font-weight: 700; }
    #hw24-sn-panel .result-sns {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding-left: 8px;
    }
    #hw24-sn-panel .result-sn {
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
    }
    #hw24-sn-panel .result-sn.matching { background: #bbf7d0; color: #166534; }
    #hw24-sn-panel .result-sn.to-remove { background: #fecaca; color: #991b1b; }
    #hw24-sn-panel .result-sn.missing { background: #fde68a; color: #92400e; }
    #hw24-sn-panel .result-position { font-size: 10px; color: #64748b; margin-left: 4px; }
    #hw24-sn-panel .summary-box {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      font-size: 12px;
    }
    #hw24-sn-panel .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }
    #hw24-sn-panel .summary-row.total {
      border-top: 1px solid #e2e8f0;
      margin-top: 4px;
      padding-top: 8px;
      font-weight: 600;
    }

    /* SN Dialog */
    #hw24-sn-dialog {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2147483648;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #hw24-sn-dialog .dialog-box {
      background: #fff;
      width: 90%;
      max-width: 800px;
      max-height: 80vh;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
    }
    #hw24-sn-dialog .dialog-header {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      color: #fff;
      padding: 16px 20px;
      font-weight: 600;
      font-size: 15px;
    }
    #hw24-sn-dialog .dialog-body {
      padding: 20px;
      max-height: calc(80vh - 120px);
      overflow-y: auto;
    }
    #hw24-sn-dialog .dialog-footer {
      padding: 12px 20px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    #hw24-sn-dialog .sn-checkbox-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }
    #hw24-sn-dialog .sn-checkbox {
      background: #f1f5f9;
      padding: 6px 10px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      cursor: pointer;
      border: 2px solid transparent;
      transition: all 0.2s;
    }
    #hw24-sn-dialog .sn-checkbox:hover { background: #e2e8f0; }
    #hw24-sn-dialog .sn-checkbox.selected { background: #dbeafe; border-color: #3b82f6; }
    #hw24-sn-dialog .target-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #hw24-sn-dialog .target-item {
      background: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    #hw24-sn-dialog .target-item:hover { border-color: #94a3b8; }
    #hw24-sn-dialog .target-item.selected { border-color: #3b82f6; background: #eff6ff; }
    #hw24-sn-dialog .target-item-name { font-weight: 600; color: #1e293b; margin-bottom: 4px; }
    #hw24-sn-dialog .target-item-meta { font-size: 11px; color: #64748b; }

    /* ===== Tax Validation Popup ===== */
    #hw24-tax-popup-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ===== Contact Meta Chips ===== */
    .hw24-contact-meta-wrap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 8px;
      vertical-align: middle;
      flex-wrap: wrap;
    }
    .hw24-contact-chip {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.5;
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .hw24-contact-chip.lang-de {
      background: #dbeafe;
      color: #1d4ed8;
      border-color: #93c5fd;
    }
    .hw24-contact-chip.lang-en {
      background: #dcfce7;
      color: #166534;
      border-color: #86efac;
    }
    .hw24-contact-chip.optout-on {
      background: #fee2e2;
      color: #991b1b;
      border-color: #fca5a5;
    }
    .hw24-contact-chip.optout-off {
      background: #dcfce7;
      color: #166534;
      border-color: #86efac;
    }
    .hw24-contact-chip.optout-na {
      background: #f1f5f9;
      color: #475569;
      border-color: #cbd5e1;
    }
  `;

  function injectStyles() {
    if ($('hw24-unified-styles')) return;
    const style = document.createElement('style');
    style.id = 'hw24-unified-styles';
    style.textContent = SHARED_STYLES;
    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 1: META OVERLAY
     ═══════════════════════════════════════════════════════════════════════════ */

  const MetaOverlay = (function () {

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

    function getFieldNumber(el) {
      if (!el) return 0;
      if ('value' in el) return toNum(el.value);
      return toNum(el.textContent);
    }

    function getDetailCellValue(tr, colIndex) {
      const cells = tr.querySelectorAll('td');
      if (cells.length > colIndex) return toNum(cells[colIndex].textContent);
      return 0;
    }

    function getQuantity(tr, rn) {
      const q = tr.querySelector(`#qty${rn}`) ||
        tr.querySelector(`#quantity${rn}`) ||
        tr.querySelector(`input[name="qty${rn}"]`) ||
        tr.querySelector(`input[name="quantity${rn}"]`) ||
        tr.querySelector(`#qty${rn}_display`) ||
        tr.querySelector(`#quantity${rn}_display`);
      if (q) {
        const v = parseInt(S(q?.value ?? q?.textContent), 10);
        return Number.isFinite(v) ? v : 0;
      }
      if (isDetail) return getDetailCellValue(tr, 1);
      return 0;
    }

    function getSellingPricePerUnit(tr, rn) {
      const el = tr.querySelector(`#listPrice${rn}`) ||
        tr.querySelector(`input[name="listPrice${rn}"]`) ||
        tr.querySelector(`#listPrice${rn}_display`) ||
        tr.querySelector(`span#listPrice${rn}_display`) ||
        tr.querySelector(`div#listPrice${rn}_display`) ||
        tr.querySelector(`[id="listPrice${rn}_display"]`);
      if (el) return getFieldNumber(el);
      if (isDetail) return getDetailCellValue(tr, 3);
      return 0;
    }

    function getPurchaseCostPerUnit(tr, rn) {
      const el = tr.querySelector(`#purchaseCost${rn}`) ||
        tr.querySelector(`input[name="purchaseCost${rn}"]`) ||
        tr.querySelector(`#purchaseCost${rn}_display`) ||
        tr.querySelector(`span#purchaseCost${rn}_display`) ||
        tr.querySelector(`div#purchaseCost${rn}_display`) ||
        tr.querySelector(`[id="purchaseCost${rn}_display"]`);
      if (el) return getFieldNumber(el);
      if (isDetail) {
        const totalPC = getDetailCellValue(tr, 2);
        const qty = getDetailCellValue(tr, 1) || 1;
        return totalPC / qty;
      }
      return 0;
    }

    function getPurchaseCostTotal(tr, rn) {
      const el = tr.querySelector(`#purchaseCost${rn}`) ||
        tr.querySelector(`input[name="purchaseCost${rn}"]`) ||
        tr.querySelector(`#purchaseCost${rn}_display`);
      if (el) {
        const pcPerUnit = getFieldNumber(el);
        const qty = getQuantity(tr, rn) || 1;
        return pcPerUnit * qty;
      }
      if (isDetail) return getDetailCellValue(tr, 2);
      return 0;
    }

    function getLineItemTotal(tr, rn) {
      const el = tr.querySelector(`#productTotal${rn}`) ||
        tr.querySelector(`#netPrice${rn}`) ||
        tr.querySelector(`#productTotal${rn}_display`);
      if (el) return getFieldNumber(el);
      if (isDetail) return getDetailCellValue(tr, 6);
      return 0;
    }

    function calcMarkup(tr, rn, meta) {
      const sellingPerUnit = getSellingPricePerUnit(tr, rn);
      let pcProduct = getPurchaseCostPerUnit(tr, rn);
      if (!pcProduct) pcProduct = toNum(meta?.purchaseCost || 0);
      if (!sellingPerUnit || !pcProduct) return null;
      return (sellingPerUnit / pcProduct).toFixed(2);
    }

    /* Description Analysis */
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
      if (!lines.some(l => l.startsWith("Service Start:")) ||
          !lines.some(l => l.startsWith("Service Ende:") || l.startsWith("Service End:"))) {
        return { ok: false, reason: "Service-Daten fehlen" };
      }
      return { ok: true };
    }

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
      if (/^(tba|\[nichtangegeben\])$/i.test(raw)) return { line: `${label} ${raw}`, ok: true };
      if (isValidDDMMYYYY(raw)) return { line: `${label} ${raw}`, ok: true };
      return { line: `${label} ${raw}`, ok: false };
    }

    function hasInvalidServiceDate(desc) {
      const lines = desc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const dateLines = lines.filter(l => /^Service (Start|Ende|End):/i.test(l));
      return dateLines.some(l => !normalizeServiceDateLine(l).ok);
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
      if (serials.length !== qty) return `🟡 Wartung: Quantity (${qty}) ≠ S/N (${serials.length})`;
      return "🟢 Wartung: OK";
    }

    /* Description Standardizer */
    function normalizeDescriptionLanguage(text, lang) {
      let t = text;
      t = t.replaceAll("Location:", "Standort:")
           .replaceAll("incl.:", "inkl.:")
           .replaceAll("Service End:", "Service Ende:");
      return lang === "en"
        ? t.replaceAll("Standort:", "Location:")
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

    function fixLiteralNewlines(desc) {
      // Konvertiert literale \n Strings zu echten Zeilenumbrüchen
      return desc.replace(/\\n/g, '\n');
    }

    function fixLabelTypos(desc) {
      // Common misspellings of "Service"
      const svcTypos = 'Servcie|Servce|Serivce|Sevice|Srevice|Srvice';
      // Common misspellings of "Start"
      const startTypos = 'Satrt|Strat|Strart|Statr|Sart|Strt|Starrt|Tsart';
      // Common misspellings of "Ende"
      const endeTypos = 'Ened|Edne|Ennde';
      // Common misspellings of "End"
      const endTypos = 'Edn|Ned|Eend';

      let r = desc;
      // Service Start: — typo in "Service", "Start", or both
      r = r.replace(new RegExp(`^(\\s*)(?:${svcTypos})\\s+(Start|${startTypos})\\s*:`, 'gim'), '$1Service Start:');
      r = r.replace(new RegExp(`^(\\s*)Service\\s+(${startTypos})\\s*:`, 'gim'), '$1Service Start:');
      // Service Ende: — typo in "Service", "Ende", or both
      r = r.replace(new RegExp(`^(\\s*)(?:${svcTypos})\\s+(Ende|${endeTypos})\\s*:`, 'gim'), '$1Service Ende:');
      r = r.replace(new RegExp(`^(\\s*)Service\\s+(${endeTypos})\\s*:`, 'gim'), '$1Service Ende:');
      // Service End: — typo in "Service", "End", or both
      r = r.replace(new RegExp(`^(\\s*)(?:${svcTypos})\\s+(End|${endTypos})\\s*:`, 'gim'), '$1Service End:');
      r = r.replace(new RegExp(`^(\\s*)Service\\s+(${endTypos})\\s*:`, 'gim'), '$1Service End:');
      // Standort:
      r = r.replace(/^(\s*)(?:Standrot|Standord|Stnadort|Stadnort|Standrt)\s*:/gim, '$1Standort:');
      // inkl.: / incl.:
      r = r.replace(/^(\s*)(?:inlk\.|ilnk\.)\s*:/gim, '$1inkl.:');
      r = r.replace(/^(\s*)(?:inlc\.|ilnc\.)\s*:/gim, '$1incl.:');
      return r;
    }

    function applyAllFixes(desc) {
      return fixServiceDates(fixSerialFormat(fixLabelTypos(fixLiteralNewlines(desc))));
    }

    /* Render Helpers */
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
      const desc = tr.querySelector('textarea[name*="comment"]')?.value ||
        tr.querySelector(`#comment${rn}`)?.value || '';
      const qty = getQuantity(tr, rn);
      const info = tr.querySelector('.vt-prodinfo');
      if (!info) return;
      const auditor = ensureAuditor(info);
      auditor.textContent = auditMaintenance(desc, qty);
    }

    function renderInfo(info, meta, tr = null, rn = '', positionIndex = null) {
      if (!tr) tr = info.closest('tr');
      if (!rn) rn = tr?.getAttribute('data-row-num') || tr?.id?.replace('row', '') || '';
      const markup = tr ? calcMarkup(tr, rn, meta) : null;
      const listenpreisSymbol = meta.listenpreis ? '✓' : '—';
      const posNum = positionIndex !== null ? positionIndex + 1 : '';

      info.innerHTML = `
        <span style="display:inline-block;padding:2px 6px;border-radius:999px;background:#64748b;color:#fff;font-size:10px;font-weight:bold;margin-right:4px">#${posNum || rn}</span>
        <span style="display:inline-block;padding:2px 6px;border-radius:999px;background:${colorForVendor(meta.vendor)};color:#fff;font-size:11px;margin-right:6px">${meta.vendor || '—'}</span>
        PN: ${meta.pn || '—'}
        • SLA: ${meta.sla || '—'}
        • Duration: ${meta.duration || '—'}
        • Country: ${meta.country || '—'}
        • Markup: ${markup || '—'}
        • LP: ${listenpreisSymbol}
      `;
    }

    function openStandardizer(tr, textarea) {
      const original = textarea.value;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;';

      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;border-radius:12px;width:700px;max-width:90%;font-size:13px;box-shadow:0 20px 50px rgba(0,0,0,0.3);overflow:hidden;';

      const header = document.createElement('div');
      header.style.cssText = 'background:linear-gradient(135deg,#1e293b 0%,#334155 100%);color:#fff;padding:14px 18px;font-weight:600;font-size:14px;';
      header.textContent = 'Description prüfen';

      const body = document.createElement('div');
      body.style.cssText = 'padding:18px;';

      const labelOrig = document.createElement('div');
      labelOrig.style.cssText = 'font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase;margin-bottom:6px;';
      labelOrig.textContent = 'Original';

      const origTA = document.createElement('textarea');
      origTA.readOnly = true;
      origTA.style.cssText = 'width:100%;height:120px;border:1px solid #e2e8f0;border-radius:6px;padding:10px;font-family:monospace;font-size:12px;background:#f8fafc;resize:none;';
      origTA.value = original;

      const labelPrev = document.createElement('div');
      labelPrev.style.cssText = 'font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase;margin:14px 0 6px;';
      labelPrev.textContent = 'Vorschau (nach Auto-Fix)';

      const prevTA = document.createElement('textarea');
      prevTA.readOnly = true;
      prevTA.style.cssText = 'width:100%;height:120px;border:1px solid #e2e8f0;border-radius:6px;padding:10px;font-family:monospace;font-size:12px;background:#f0fdf4;resize:none;';
      prevTA.value = applyAllFixes(original);

      const footer = document.createElement('div');
      footer.style.cssText = 'padding:14px 18px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:10px;';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Abbrechen';
      cancelBtn.style.cssText = 'padding:8px 16px;border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:6px;font-size:13px;cursor:pointer;';
      cancelBtn.onclick = () => overlay.remove();

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.textContent = 'Übernehmen';
      applyBtn.style.cssText = 'padding:8px 16px;border:none;background:#16a34a;color:#fff;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;';
      applyBtn.onclick = () => {
        textarea.value = prevTA.value;
        refreshBadgeForRow(tr);
        fire(textarea);
        overlay.remove();
      };

      footer.append(cancelBtn, applyBtn);
      body.append(labelOrig, origTA, labelPrev, prevTA);
      box.append(header, body, footer);
      overlay.appendChild(box);
      overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);
    }

    function injectButtons(tr) {
      if (tr.querySelector('.hw24-desc-btn')) return;
      const ta = tr.querySelector('textarea[name*="comment"]') || tr.querySelector('textarea[id^="comment"]');
      if (!ta) return;

      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'margin-top:6px;display:flex;gap:6px;';

      const stdBtn = document.createElement('button');
      stdBtn.type = 'button';
      stdBtn.className = 'hw24-desc-btn';
      stdBtn.textContent = '🔍 Prüfen';
      stdBtn.title = 'Zeigt Vorschau der korrigierten Description (S/N-Format, Datumsformat)';
      stdBtn.style.cssText = 'padding:4px 8px;font-size:11px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;color:#475569;';
      stdBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); openStandardizer(tr, ta); };

      const refreshBtn = document.createElement('button');
      refreshBtn.type = 'button';
      refreshBtn.textContent = '↻';
      refreshBtn.title = 'Wartungs-Check aktualisieren';
      refreshBtn.style.cssText = 'padding:4px 8px;font-size:11px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;color:#475569;';
      refreshBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); refreshBadgeForRow(tr); };

      // EK × Faktor pro Position
      const ekMultBtn = document.createElement('button');
      ekMultBtn.type = 'button';
      ekMultBtn.className = 'hw24-ek-btn';
      ekMultBtn.textContent = 'EK×';
      ekMultBtn.title = 'EK × Faktor = VK (nur diese Position)';
      ekMultBtn.style.cssText = 'padding:4px 8px;font-size:11px;background:#dbeafe;border:1px solid #3b82f6;border-radius:4px;cursor:pointer;color:#1d4ed8;font-weight:bold;';
      ekMultBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); runMultiplierForRow(tr); };

      // VP × Faktor pro Position
      const vpMultBtn = document.createElement('button');
      vpMultBtn.type = 'button';
      vpMultBtn.className = 'hw24-vp-btn';
      vpMultBtn.textContent = 'VP×';
      vpMultBtn.title = 'Verkaufspreis × Faktor (nur diese Position)';
      vpMultBtn.style.cssText = 'padding:4px 8px;font-size:11px;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;cursor:pointer;color:#92400e;font-weight:bold;';
      vpMultBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); runUnitPriceMultiplier(tr); };

      btnContainer.append(stdBtn, refreshBtn, ekMultBtn, vpMultBtn);
      ta.after(btnContainer);
    }

    function injectGlobalFixButton() {
      if (!isEdit) return;
      if ($('hw24-desc-toolbar')) return;

      const toolbar = document.createElement('div');
      toolbar.id = 'hw24-desc-toolbar';
      toolbar.style.cssText = 'margin:10px 0;padding:10px 14px;background:linear-gradient(135deg,#f8fafc 0%,#e2e8f0 100%);border:1px solid #cbd5e1;border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';

      const label = document.createElement('span');
      label.style.cssText = 'font-size:12px;font-weight:600;color:#475569;margin-right:4px;';
      label.textContent = 'Descriptions:';

      const btnStyle = 'padding:6px 12px;font-size:12px;border:none;border-radius:6px;cursor:pointer;font-weight:500;transition:all 0.15s;';

      // Auto-Fix Button
      const fixBtn = document.createElement('button');
      fixBtn.id = 'hw24-global-fix';
      fixBtn.type = 'button';
      fixBtn.innerHTML = '🔧 Auto-Fix';
      fixBtn.title = 'Korrigiert S/N-Format (Komma + Leerzeichen) und Datumsformate in allen Positionen';
      fixBtn.style.cssText = btnStyle + 'background:#3b82f6;color:#fff;';
      fixBtn.onmouseenter = () => fixBtn.style.background = '#2563eb';
      fixBtn.onmouseleave = () => fixBtn.style.background = '#3b82f6';
      fixBtn.onclick = () => {
        const tbl = document.querySelector('#lineItemTab');
        if (!tbl) return;
        const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
        let count = 0;
        rows.forEach(tr => {
          const ta = tr.querySelector('textarea[name*="comment"]') || tr.querySelector('textarea[id^="comment"]');
          if (!ta) return;
          const before = ta.value;
          ta.value = applyAllFixes(ta.value);
          if (before !== ta.value) count++;
          fire(ta);
          refreshBadgeForRow(tr);
        });
        showToolbarStatus(toolbar, `✓ ${count} korrigiert`);
      };

      // Translate to EN Button
      const toEnBtn = document.createElement('button');
      toEnBtn.type = 'button';
      toEnBtn.innerHTML = '🌐 → EN';
      toEnBtn.title = 'Übersetzt alle Descriptions nach Englisch (Standort→Location, inkl.→incl., Service Ende→Service End)';
      toEnBtn.style.cssText = btnStyle + 'background:#8b5cf6;color:#fff;';
      toEnBtn.onmouseenter = () => toEnBtn.style.background = '#7c3aed';
      toEnBtn.onmouseleave = () => toEnBtn.style.background = '#8b5cf6';
      toEnBtn.onclick = () => translateAllDescriptions('en', toolbar);

      // Translate to DE Button
      const toDeBtn = document.createElement('button');
      toDeBtn.type = 'button';
      toDeBtn.innerHTML = '🌐 → DE';
      toDeBtn.title = 'Übersetzt alle Descriptions nach Deutsch (Location→Standort, incl.→inkl., Service End→Service Ende)';
      toDeBtn.style.cssText = btnStyle + 'background:#8b5cf6;color:#fff;';
      toDeBtn.onmouseenter = () => toDeBtn.style.background = '#7c3aed';
      toDeBtn.onmouseleave = () => toDeBtn.style.background = '#8b5cf6';
      toDeBtn.onclick = () => translateAllDescriptions('de', toolbar);

      // Globales Datum Button
      const globalDateBtn = document.createElement('button');
      globalDateBtn.id = 'hw24-global-date';
      globalDateBtn.type = 'button';
      globalDateBtn.innerHTML = '📅 Globales Datum';
      globalDateBtn.title = 'Service Start & Ende für alle Positionen setzen';
      globalDateBtn.style.cssText = btnStyle + 'background:#10b981;color:#fff;';
      globalDateBtn.onmouseenter = () => globalDateBtn.style.background = '#059669';
      globalDateBtn.onmouseleave = () => globalDateBtn.style.background = '#10b981';
      globalDateBtn.onclick = () => runGlobalDate(toolbar);

      // EK × Faktor Button (global) - ehemals "HW24 Preis × / Faktor"
      const ekMultBtn = document.createElement('button');
      ekMultBtn.id = 'hw24-ek-mult';
      ekMultBtn.type = 'button';
      ekMultBtn.innerHTML = '💵 EK × Faktor';
      ekMultBtn.title = 'Einkaufspreis × Faktor = Verkaufspreis (alle Positionen)';
      ekMultBtn.style.cssText = btnStyle + 'background:#3b82f6;color:#fff;';
      ekMultBtn.onmouseenter = () => ekMultBtn.style.background = '#2563eb';
      ekMultBtn.onmouseleave = () => ekMultBtn.style.background = '#3b82f6';
      ekMultBtn.onclick = () => runGlobalEKMultiplier();

      // VP × Faktor Button (global)
      const vpMultBtn = document.createElement('button');
      vpMultBtn.id = 'hw24-vp-mult';
      vpMultBtn.type = 'button';
      vpMultBtn.innerHTML = '💰 VP × Faktor';
      vpMultBtn.title = 'Verkaufspreis aller Positionen mit Faktor multiplizieren';
      vpMultBtn.style.cssText = btnStyle + 'background:#f59e0b;color:#fff;';
      vpMultBtn.onmouseenter = () => vpMultBtn.style.background = '#d97706';
      vpMultBtn.onmouseleave = () => vpMultBtn.style.background = '#f59e0b';
      vpMultBtn.onclick = () => runUnitPriceMultiplier();

      // Undo Button
      const undoBtn = document.createElement('button');
      undoBtn.id = 'hw24-undo';
      undoBtn.type = 'button';
      undoBtn.innerHTML = '↩️ Undo';
      undoBtn.title = 'Preisänderungen rückgängig machen';
      undoBtn.style.cssText = btnStyle + 'background:#6b7280;color:#fff;';
      undoBtn.onmouseenter = () => undoBtn.style.background = '#4b5563';
      undoBtn.onmouseleave = () => undoBtn.style.background = '#6b7280';
      undoBtn.onclick = () => runUndo();

      // Provision % Button
      const commissionBtn = document.createElement('button');
      commissionBtn.id = 'hw24-commission-btn';
      commissionBtn.type = 'button';
      commissionBtn.innerHTML = '💼 Provision %';
      commissionBtn.title = 'Partner-Provisionsanteil konfigurieren (Standard: 50%)';
      commissionBtn.style.cssText = btnStyle + 'background:#f59e0b;color:#fff;';
      commissionBtn.onmouseenter = () => commissionBtn.style.background = '#d97706';
      commissionBtn.onmouseleave = () => commissionBtn.style.background = '#f59e0b';
      commissionBtn.onclick = () => {
        const current = localStorage.getItem('hw24-commission-pct') || '50';
        const input = prompt('Partner-Provisionsanteil (%) der Marge:', current);
        if (input !== null) {
          const pct = parseFloat(input);
          if (!isNaN(pct) && pct >= 0 && pct <= 100) {
            localStorage.setItem('hw24-commission-pct', pct.toString());
            MetaOverlay.injectTotalsPanel();
            showToolbarStatus(toolbar, `✓ Provision ${pct}%`);
          } else {
            alert('Ungültiger Wert. Bitte 0-100 eingeben.');
          }
        }
      };

      // Status span
      const status = document.createElement('span');
      status.id = 'hw24-toolbar-status';
      status.style.cssText = 'font-size:11px;color:#16a34a;font-weight:500;margin-left:auto;opacity:0;transition:opacity 0.3s;';

      toolbar.append(label, fixBtn, toEnBtn, toDeBtn, globalDateBtn, ekMultBtn, vpMultBtn, undoBtn, commissionBtn, status);

      const tbl = document.querySelector('#lineItemTab');
      tbl?.parentElement?.insertBefore(toolbar, tbl);
    }

    function translateAllDescriptions(lang, toolbar) {
      const tbl = document.querySelector('#lineItemTab');
      if (!tbl) return;
      const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
      let count = 0;
      rows.forEach(tr => {
        const ta = tr.querySelector('textarea[name*="comment"]') || tr.querySelector('textarea[id^="comment"]');
        if (!ta) return;
        const before = ta.value;
        ta.value = normalizeDescriptionLanguage(ta.value, lang);
        if (before !== ta.value) count++;
        fire(ta);
        refreshBadgeForRow(tr);
      });
      const langName = lang === 'en' ? 'EN' : 'DE';
      showToolbarStatus(toolbar, `✓ ${count} → ${langName}`);
    }

    function showToolbarStatus(toolbar, msg) {
      const status = toolbar.querySelector('#hw24-toolbar-status');
      if (status) {
        status.textContent = msg;
        status.style.opacity = '1';
        setTimeout(() => { status.style.opacity = '0'; }, 2500);
      }
    }

    /* Globales Datum */
    function getTodayFormatted() {
      const d = new Date();
      return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    }

    function getOneYearLater(dateStr) {
      const [dd, mm, yyyy] = dateStr.split('.').map(Number);
      const date = new Date(yyyy + 1, mm - 1, dd - 1);
      return `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}.${date.getFullYear()}`;
    }

    function updateServiceDates(desc, startDate, endDate) {
      let result = desc;

      // Service Start ersetzen oder hinzufügen
      if (/Service\s*Start\s*:/i.test(result)) {
        result = result.replace(/Service\s*Start\s*:\s*[^\n\r]*/i, `Service Start: ${startDate}`);
      } else {
        result += `\nService Start: ${startDate}`;
      }

      // Service Ende ersetzen oder hinzufügen (beide Varianten prüfen)
      const hasEnglish = /Service\s*End\s*:/i.test(result);
      const hasGerman = /Service\s*Ende\s*:/i.test(result);

      if (hasEnglish && !hasGerman) {
        result = result.replace(/Service\s*End\s*:\s*[^\n\r]*/i, `Service End: ${endDate}`);
      } else if (hasGerman) {
        result = result.replace(/Service\s*Ende\s*:\s*[^\n\r]*/i, `Service Ende: ${endDate}`);
      } else {
        result += `\nService Ende: ${endDate}`;
      }

      return result;
    }

    function runGlobalDate(toolbar) {
      const startDate = prompt('Service Start Datum (DD.MM.YYYY):', getTodayFormatted());
      if (!startDate) return;
      if (!isValidDDMMYYYY(startDate)) {
        alert('Ungültiges Datumsformat. Bitte DD.MM.YYYY verwenden.');
        return;
      }

      const endDate = prompt('Service Ende Datum (DD.MM.YYYY):', getOneYearLater(startDate));
      if (!endDate) return;
      if (!isValidDDMMYYYY(endDate)) {
        alert('Ungültiges Datumsformat. Bitte DD.MM.YYYY verwenden.');
        return;
      }

      const tbl = document.querySelector('#lineItemTab');
      if (!tbl) return;

      const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
      let count = 0;

      rows.forEach(tr => {
        const ta = tr.querySelector('textarea[name*="comment"]') || tr.querySelector('textarea[id^="comment"]');
        if (!ta) return;

        const before = ta.value;
        ta.value = updateServiceDates(ta.value, startDate, endDate);
        if (before !== ta.value) count++;
        fire(ta);
        refreshBadgeForRow(tr);
      });

      showToolbarStatus(toolbar, `✓ ${count} Positionen aktualisiert`);
    }

    function buildTotals(sumPC, itemsTotal, overallDiscount) {
      const marginBeforeDiscount = itemsTotal - sumPC;
      const marginBeforeDiscountPct = sumPC ? (marginBeforeDiscount / sumPC * 100) : 0;
      const effectiveTotal = itemsTotal - overallDiscount;
      const marginAfterDiscount = effectiveTotal - sumPC;
      const marginAfterDiscountPct = sumPC ? (marginAfterDiscount / sumPC * 100) : 0;
      const commissionPct = parseFloat(localStorage.getItem('hw24-commission-pct') || '50');
      const partnerCommission = marginAfterDiscount * (commissionPct / 100);
      return {
        sumPC,
        itemsTotal,
        overallDiscount,
        marginBeforeDiscount,
        marginBeforeDiscountPct,
        effectiveTotal,
        marginAfterDiscount,
        marginAfterDiscountPct,
        partnerCommission,
        commissionPct
      };
    }

    function getRecordIdFromLocation() {
      return new URLSearchParams(location.search).get('record') || '';
    }

    function findLineItemTableIn(root) {
      return root.querySelector('#lineItemTab') ||
        root.querySelector('table.lineItemsTable') ||
        root.querySelector('.lineItemsTable') ||
        root.querySelector('.lineItemTab') ||
        root.querySelector('[id*="lineItem"]') ||
        root.querySelector('.detailViewTable table') ||
        root.querySelector('.inventoryTable') ||
        root.querySelector('table.listview-table');
    }

    function findLineItemRowsIn(container) {
      if (!container) return [];
      const selectors = ['tr.lineItemRow[id^="row"]', 'tr.inventoryRow', 'tr[id^="row"]', 'tr.listViewEntries', 'tr[data-row-num]', 'tbody tr', 'tr'];
      for (const sel of selectors) {
        const rows = [...container.querySelectorAll(sel)];
        const validRows = rows.filter(tr =>
          tr.querySelector('a[href*="module=Products"]') ||
          tr.querySelector('a[href*="module=Services"]')
        );
        if (validRows.length > 0) return validRows;
      }
      return [];
    }

    async function fetchTotalsFromDetailRecord() {
      const recordId = getRecordIdFromLocation();
      if (!recordId || !currentModule) {
        console.warn('[HW24] Commission fallback: missing record/module', { recordId, currentModule, href: location.href });
        return null;
      }

      try {
        const url = `index.php?module=${currentModule}&view=Detail&record=${recordId}`;
        console.log('[HW24] Commission fallback: fetching detail record', { url, recordId, currentModule });
        const r = await fetch(url, { credentials: 'same-origin' });
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const tbl = findLineItemTableIn(doc);
        const rows = findLineItemRowsIn(tbl);
        if (!rows.length) {
          console.warn('[HW24] Commission fallback: no line item rows found in fetched detail HTML');
          return null;
        }

        let sumPC = 0;
        let sumSelling = 0;

        rows.forEach(tr => {
          const cells = tr.querySelectorAll('td');
          if (cells.length < 4) return;
          const qty = toNum(cells[1]?.textContent) || 1;
          const pcTotal = toNum(cells[2]?.textContent);
          const sellingPerUnit = toNum(cells[3]?.textContent);
          sumPC += pcTotal;
          sumSelling += sellingPerUnit * qty;
        });

        const netTotalEl = doc.getElementById('netTotal') || doc.querySelector('[id$="_netTotal"]') || doc.querySelector('.netTotal');
        const itemsTotal = netTotalEl ? toNum(netTotalEl.textContent || netTotalEl.value) : sumSelling;
        const discountEl = doc.getElementById('discountTotal_final') || doc.querySelector('[id$="_discountTotal_final"]') || doc.querySelector('.discountTotal_final');
        const overallDiscount = toNum(discountEl?.textContent || discountEl?.value);

        console.log('[HW24] Commission fallback: parsed totals from detail HTML', {
          rows: rows.length,
          sumPC,
          sumSelling,
          itemsTotal,
          overallDiscount
        });

        return buildTotals(sumPC, itemsTotal, overallDiscount);
      } catch (e) {
        console.error('[HW24] Commission fallback: fetch/parse failed', e);
        return null;
      }
    }

    async function fetchTotalsFromEditRecord() {
      const recordId = getRecordIdFromLocation();
      if (!recordId || !currentModule) return null;

      try {
        const url = `index.php?module=${currentModule}&view=Edit&record=${recordId}`;
        console.log('[HW24] Commission fallback: fetching edit record', { url, recordId, currentModule });
        const r = await fetch(url, { credentials: 'same-origin' });
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const rows = [...doc.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')];
        if (!rows.length) {
          console.warn('[HW24] Commission fallback: no line item rows found in fetched edit HTML');
          return null;
        }

        let sumPC = 0;
        let sumSelling = 0;

        rows.forEach((tr, idx) => {
          const rn = tr.getAttribute('data-row-num') || tr.id?.replace('row', '') || String(idx + 1);
          const qtyEl = tr.querySelector(`#qty${rn}, #quantity${rn}, input[name="qty${rn}"], input[name="quantity${rn}"]`);
          const listEl = tr.querySelector(`#listPrice${rn}, input[name="listPrice${rn}"], #listPrice${rn}_display`);
          const pcEl = tr.querySelector(`#purchaseCost${rn}, input[name="purchaseCost${rn}"], #purchaseCost${rn}_display`);
          const qty = Math.max(1, parseInt(S(qtyEl?.value ?? qtyEl?.textContent), 10) || 1);
          const listPrice = toNum(listEl?.value ?? listEl?.textContent);
          const purchaseCost = toNum(pcEl?.value ?? pcEl?.textContent);
          sumPC += purchaseCost * qty;
          sumSelling += listPrice * qty;
        });

        const netTotalEl = doc.getElementById('netTotal') || doc.querySelector('[id$="_netTotal"]') || doc.querySelector('.netTotal');
        const itemsTotal = netTotalEl ? toNum(netTotalEl.textContent || netTotalEl.value) : sumSelling;
        const discountEl = doc.getElementById('discountTotal_final') || doc.querySelector('[id$="_discountTotal_final"]') || doc.querySelector('.discountTotal_final');
        const overallDiscount = toNum(discountEl?.textContent || discountEl?.value);

        console.log('[HW24] Commission fallback: parsed totals from edit HTML', {
          rows: rows.length,
          sumPC,
          sumSelling,
          itemsTotal,
          overallDiscount
        });

        return buildTotals(sumPC, itemsTotal, overallDiscount);
      } catch (e) {
        console.error('[HW24] Commission fallback: edit fetch/parse failed', e);
        return null;
      }
    }

    async function calculateTotalsWithFallback() {
      const localTotals = calculateTotals();
      console.log('[HW24] Commission calc: local totals', {
        sumPC: localTotals.sumPC,
        itemsTotal: localTotals.itemsTotal,
        overallDiscount: localTotals.overallDiscount,
        partnerCommission: localTotals.partnerCommission
      });

      if (localTotals.sumPC > 0) {
        return { ...localTotals, _hw24Source: 'local-dom' };
      }

      const fetchedTotals = await fetchTotalsFromDetailRecord();
      if (fetchedTotals && fetchedTotals.sumPC > 0) {
        return { ...fetchedTotals, _hw24Source: 'detail-fetch' };
      }

      const fetchedEditTotals = await fetchTotalsFromEditRecord();
      if (fetchedEditTotals && fetchedEditTotals.sumPC > 0) {
        return { ...fetchedEditTotals, _hw24Source: 'edit-fetch' };
      }

      console.warn('[HW24] Commission calc: local and fallback totals unavailable', {
        localSumPC: localTotals.sumPC,
        fallbackDetailSumPC: fetchedTotals?.sumPC ?? null,
        fallbackEditSumPC: fetchedEditTotals?.sumPC ?? null
      });
      return { ...localTotals, _hw24Source: 'local-dom-empty' };
    }

    /* Totals Panel */
    function calculateTotals() {
      let rows = [...document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];
      if (rows.length === 0 && isDetail) {
        const tbl = document.querySelector('table.lineItemsTable') || document.querySelector('.lineItemsTable');
        if (tbl) {
          rows = [...tbl.querySelectorAll('tr')].filter(tr =>
            tr.querySelector('a[href*="module=Products"]') || tr.querySelector('a[href*="module=Services"]')
          );
        }
      }

      let sumPC = 0;
      let sumSelling = 0;
      rows.forEach(tr => {
        const rn = tr.getAttribute('data-row-num') || tr.id?.replace('row', '') || '';
        const qty = getQuantity(tr, rn) || 1;
        const sellingPerUnit = getSellingPricePerUnit(tr, rn);
        sumPC += getPurchaseCostTotal(tr, rn);
        sumSelling += sellingPerUnit * qty;
      });

      const netTotalEl = $('netTotal') || document.querySelector('[id$="_netTotal"]') || document.querySelector('.netTotal');
      const itemsTotal = netTotalEl ? toNum(netTotalEl.textContent || netTotalEl.value) : sumSelling;

      const discountEl = $('discountTotal_final') || document.querySelector('[id$="_discountTotal_final"]') || document.querySelector('.discountTotal_final');
      const overallDiscount = toNum(discountEl?.textContent || discountEl?.value);

      return buildTotals(sumPC, itemsTotal, overallDiscount);
    }

    function injectTotalsPanel() {
      $('hw24-totals-panel')?.remove();
      const totals = calculateTotals();

      const tbl = document.querySelector('#lineItemTab') || document.querySelector('table.lineItemsTable') || document.querySelector('.lineItemsTable');
      if (!tbl) return;

      const panel = document.createElement('div');
      panel.id = 'hw24-totals-panel';

      const formatNum = n => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formatPct = n => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const marginColor = totals.marginAfterDiscount >= 0 ? '#16a34a' : '#dc2626';
      const marginBeforeColor = totals.marginBeforeDiscount >= 0 ? '#16a34a' : '#dc2626';

      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;font-weight:bold;font-size:13px;margin-bottom:8px;color:#1e293b;border-bottom:1px solid #cbd5e1;padding-bottom:6px;">
          <span>📊 Kalkulation</span>
          <button type="button" id="hw24-panel-refresh" style="padding:4px 10px;font-size:11px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;">🔄 Refresh</button>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tr><td style="padding:3px 0;color:#64748b;">Purchase Cost (Summe):</td><td style="padding:3px 0;text-align:right;font-weight:600;">${totals.sumPC ? formatNum(totals.sumPC) + ' €' : '—'}</td></tr>
          <tr><td style="padding:3px 0;color:#64748b;">Items Total:</td><td style="padding:3px 0;text-align:right;font-weight:600;">${formatNum(totals.itemsTotal)} €</td></tr>
          <tr style="border-top:1px dashed #cbd5e1;"><td style="padding:6px 0 3px;color:#475569;font-weight:500;">Marge (vor Discount):</td><td style="padding:6px 0 3px;text-align:right;font-weight:bold;color:${marginBeforeColor};">${totals.sumPC ? formatNum(totals.marginBeforeDiscount) + ' €' : '—'}${totals.sumPC ? '<span style="font-weight:normal;color:#64748b;"> (' + formatPct(totals.marginBeforeDiscountPct) + '%)</span>' : ''}</td></tr>
          ${totals.overallDiscount ? `<tr><td style="padding:3px 0;color:#64748b;">Overall Discount:</td><td style="padding:3px 0;text-align:right;font-weight:600;color:#dc2626;">- ${formatNum(totals.overallDiscount)} €</td></tr>` : ''}
          <tr style="background:#e2e8f0;border-radius:4px;"><td style="padding:6px 8px;color:#1e293b;font-weight:600;">Marge (nach Discount):</td><td style="padding:6px 8px;text-align:right;font-weight:bold;font-size:13px;color:${marginColor};">${totals.sumPC ? formatNum(totals.marginAfterDiscount) + ' €' : '—'}${totals.sumPC ? '<span style="font-weight:normal;color:#64748b;"> (' + formatPct(totals.marginAfterDiscountPct) + '%)</span>' : ''}</td></tr>
          <tr style="background:#fef3c7;border-radius:4px;"><td style="padding:6px 8px;color:#92400e;font-weight:500;">💼 Partner-Provision (${totals.commissionPct}%):</td><td style="padding:6px 8px;text-align:right;font-weight:bold;font-size:13px;color:#f59e0b;">${totals.sumPC ? formatNum(totals.partnerCommission) + ' €' : '—'}</td></tr>
        </table>
      `;

      panel.querySelector('#hw24-panel-refresh').onclick = async () => {
        const btn = panel.querySelector('#hw24-panel-refresh');
        btn.disabled = true;
        btn.textContent = '⏳...';
        if (isEdit) await processEdit();
        else if (isDetail) await processDetail();
        injectTotalsPanel();
      };

      tbl.parentElement?.insertBefore(panel, tbl.nextSibling);
    }

    let metaVisible = true;

    function toggleMetaVisibility() {
      metaVisible = !metaVisible;
      document.querySelectorAll('.vt-prodinfo').forEach(el => {
        el.style.display = metaVisible ? 'block' : 'none';
      });
      const toggleBtn = $('hw24-meta-toggle');
      if (toggleBtn) toggleBtn.textContent = metaVisible ? '👁 Meta ausblenden' : '👁 Meta einblenden';
    }

    function injectReloadButton() {
      if ($('hw24-reload-btn')) return;
      const tbl = document.querySelector('#lineItemTab') || document.querySelector('table.lineItemsTable') || document.querySelector('.lineItemsTable');
      if (!tbl) return;

      const btnContainer = document.createElement('div');
      btnContainer.id = 'hw24-btn-container';
      btnContainer.style.cssText = 'margin: 8px 0; display: flex; gap: 8px; flex-wrap: wrap;';

      const btn = document.createElement('button');
      btn.id = 'hw24-reload-btn';
      btn.type = 'button';
      btn.textContent = '🔄 Meta & Kalkulation neu laden';
      btn.style.cssText = 'padding:6px 12px;font-size:12px;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;';
      btn.onmouseenter = () => btn.style.background = '#2563eb';
      btn.onmouseleave = () => btn.style.background = '#3b82f6';
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = '⏳ Laden...';
        if (isEdit) await processEdit();
        else if (isDetail) await processDetail();
        injectTotalsPanel();
        btn.disabled = false;
        btn.textContent = '🔄 Meta & Kalkulation neu laden';
      };

      const toggleBtn = document.createElement('button');
      toggleBtn.id = 'hw24-meta-toggle';
      toggleBtn.type = 'button';
      toggleBtn.textContent = '👁 Meta ausblenden';
      toggleBtn.style.cssText = 'padding:6px 12px;font-size:12px;background:#6b7280;color:#fff;border:none;border-radius:4px;cursor:pointer;';
      toggleBtn.onmouseenter = () => toggleBtn.style.background = '#4b5563';
      toggleBtn.onmouseleave = () => toggleBtn.style.background = '#6b7280';
      toggleBtn.onclick = toggleMetaVisibility;

      btnContainer.appendChild(btn);
      btnContainer.appendChild(toggleBtn);
      tbl.parentElement?.insertBefore(btnContainer, tbl);
    }

    /* Tax Validation */
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

    function getBillingCountry() {
      const el = document.querySelector('[name="bill_country"]') ||
        document.querySelector('[data-fieldname="bill_country"]') ||
        document.querySelector('input[id*="_editView_fieldName_bill_country"]') ||
        document.querySelector('[name="billing_country"]');
      return el?.value || '';
    }

    const TAX_REGION_MAP = { 'eu': '12', 'non-eu': '13', 'germany': '14', 'germany (19%)': '14', 'austria': '15' };

    const NICHT_STEUERBAR_FIELDS = {
      'SalesOrder': 'cf_2282',
      'Quotes': 'cf_2278',
      'Invoice': 'cf_2280'
    };

    /* Organization VAT Cache */
    let cachedVAT = null;
    let cachedOrgId = null;

    function getOrganizationId() {
      // Method 1: <a> link (Detail view of Quote/SO/Invoice)
      const orgLink = document.querySelector('a[href*="module=Accounts&view=Detail"]') ||
                      document.querySelector('a[href*="module=Organizations&view=Detail"]');
      if (orgLink) {
        const match = orgLink.getAttribute('href').match(/record=(\d+)/);
        if (match) return match[1];
      }
      // Method 2: Hidden input in Edit view (account_id reference field)
      const hiddenInput = document.querySelector('input[name="account_id"]');
      if (hiddenInput && hiddenInput.value) return hiddenInput.value;
      return null;
    }

    async function fetchOrganizationVAT() {
      const orgId = getOrganizationId();
      if (!orgId) {
        console.warn('HW24: Organization ID nicht gefunden');
        return '';
      }

      if (orgId === cachedOrgId && cachedVAT !== null) {
        return cachedVAT;
      }

      try {
        const url = `index.php?module=Accounts&view=Detail&record=${orgId}`;
        const r = await fetch(url, { credentials: 'same-origin' });
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        cachedVAT = '';
        const isVatText = txt => txt.includes('vat') || txt.includes('uid') || txt.includes('ust');

        // Method 1: Detail view field label IDs (Details tab)
        const labels = [...doc.querySelectorAll('[id*="_detailView_fieldLabel_"]')];
        const vatLabel = labels.find(l => isVatText(l.textContent.toLowerCase()));
        if (vatLabel) {
          const valueId = vatLabel.id.replace('fieldLabel', 'fieldValue');
          const valueEl = doc.getElementById(valueId);
          cachedVAT = (valueEl?.textContent || '').trim();
        }

        // Method 2: Fallback for Summary view — fieldLabel/fieldValue CSS classes
        if (!cachedVAT) {
          const allFieldLabels = [...doc.querySelectorAll('td.fieldLabel, .fieldLabel')];
          const vatTd = allFieldLabels.find(el => isVatText(el.textContent.toLowerCase().trim()));
          if (vatTd) {
            const valueSibling = vatTd.nextElementSibling;
            if (valueSibling) {
              cachedVAT = valueSibling.textContent.trim();
            }
          }
        }

        cachedOrgId = orgId;
        return cachedVAT;
      } catch (e) {
        console.error('HW24: Fehler beim Laden der VAT Number:', e);
        return '';
      }
    }

    function findNichtSteuerbarCheckbox() {
      const fieldName = NICHT_STEUERBAR_FIELDS[currentModule];
      if (!fieldName) return null;

      const selectors = [
        `input[type="checkbox"][name="${fieldName}"]`,
        `input[name="${fieldName}"]`,
        `input[id*="_editView_fieldName_${fieldName}"]`
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    function getNichtSteuerbar() {
      const el = findNichtSteuerbarCheckbox();
      if (!el) return false;
      if (el.type === 'checkbox') return el.checked;
      return el.value === '1' || el.value === 'on';
    }

    function setNichtSteuerbar(value) {
      const el = findNichtSteuerbarCheckbox();
      if (!el) return false;
      if (el.type === 'checkbox') {
        el.checked = !!value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.value = value ? '1' : '0';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }

    function getTaxRegion() {
      const el = document.querySelector('#region_id');
      if (el && el.selectedIndex >= 0) return el.options[el.selectedIndex]?.textContent?.trim() || '';
      return '';
    }

    function setTaxRegion(targetName) {
      const el = document.querySelector('#region_id');
      if (!el) return false;
      const targetLower = targetName.toLowerCase();
      const targetValue = TAX_REGION_MAP[targetLower];
      for (let i = 0; i < el.options.length; i++) {
        const optText = el.options[i].textContent.toLowerCase();
        const optValue = el.options[i].value;
        if (optValue === targetValue || optText.includes(targetLower)) {
          el.value = optValue;
          el.selectedIndex = i;

          // Fix: Select2-spezifische Events triggern damit vtiger die Steuer neu berechnet
          if (typeof jQuery !== 'undefined' && jQuery.fn.select2) {
            const $el = jQuery(el);
            $el.trigger('change');
            $el.trigger({
              type: 'select2:select',
              params: { data: { id: optValue, text: el.options[i].textContent } }
            });
            $el.trigger('change.select2');
          } else {
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        }
      }
      return false;
    }

    function findReverseChargeCheckbox() {
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
          if (el && (el.type === 'checkbox' || el.type === 'hidden')) return el;
        }
      }
      return null;
    }

    function getReverseCharge() {
      const el = findReverseChargeCheckbox();
      if (!el) return false;
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'hidden') return el.value === '1' || el.value === 'on' || el.value === 'true';
      return false;
    }

    function setReverseCharge(value) {
      const el = findReverseChargeCheckbox();
      if (!el) return false;
      if (el.type === 'checkbox') {
        el.checked = !!value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (!value && el.checked) el.click();
      } else if (el.type === 'hidden') {
        el.value = value ? '1' : '0';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }

    function getSubject() {
      const el = document.querySelector('[name="subject"]') ||
        document.querySelector('[data-fieldname="subject"]') ||
        document.querySelector('#PurchaseOrder_editView_fieldName_subject') ||
        document.querySelector('#Quotes_editView_fieldName_subject') ||
        document.querySelector('#SalesOrder_editView_fieldName_subject') ||
        document.querySelector('#Invoice_editView_fieldName_subject') ||
        document.querySelector('input[id*="_editView_fieldName_subject"]');
      return el?.value || '';
    }

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

    async function validateTaxSettings() {
      if (!isEdit) return null;

      const billingCountry = getBillingCountry();
      const taxRegion = getTaxRegion();
      const reverseCharge = getReverseCharge();
      const nichtSteuerbar = getNichtSteuerbar();
      const subjectType = getSubjectType();
      const isPurchaseOrderModule = currentModule === 'PurchaseOrder';
      const vatNumber = isPurchaseOrderModule ? '' : await fetchOrganizationVAT();
      const hasVAT = vatNumber.length > 0;

      const issues = [];

      const taxRegionLower = taxRegion.toLowerCase();
      const isAustriaTaxRegion = taxRegionLower.includes('austria');
      const isGermanyTaxRegion = taxRegionLower.includes('germany');
      const isEUTaxRegion = taxRegionLower === 'eu';
      const isNonEUTaxRegion = taxRegionLower.includes('non-eu');

      const billingIsAustria = isAustria(billingCountry);
      const billingIsGermany = isGermany(billingCountry);
      const billingIsEU = !billingIsAustria && isEUCountry(billingCountry);
      const billingIsNonEU = billingCountry && !billingIsAustria && !billingIsGermany && !billingIsEU;

      // ═══════════════════════════════════════════════════════════════
      // REGEL 1: Österreich → 20% (Austria), kein RC, kein Nicht-steuerbar
      // ═══════════════════════════════════════════════════════════════
      if (billingIsAustria) {
        if (!isAustriaTaxRegion && taxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Kunde in Österreich → Tax Region muss "Austria" (20%) sein, nicht "${taxRegion}".`,
            fix: () => setTaxRegion('Austria'),
            fixLabel: 'Tax Region → Austria'
          });
        }
        if (reverseCharge) {
          issues.push({
            type: 'error',
            message: '⚠️ Reverse Charge darf bei österreichischen Kunden nicht aktiviert sein.',
            fix: () => setReverseCharge(false),
            fixLabel: 'RC deaktivieren'
          });
        }
        if (nichtSteuerbar) {
          issues.push({
            type: 'error',
            message: '⚠️ "Nicht steuerbar" darf bei österreichischen Kunden nicht aktiviert sein.',
            fix: () => setNichtSteuerbar(false),
            fixLabel: 'Nicht steuerbar deaktivieren'
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // REGEL 2: DE/EU
      // PurchaseOrder: UID ist irrelevant → immer EU + RC aktiv
      // Andere Module: mit UID → EU + RC aktiv, ohne UID → Austria + kein RC
      // ═══════════════════════════════════════════════════════════════
      else if (billingIsGermany || billingIsEU) {
        if (isPurchaseOrderModule) {
          if (!isEUTaxRegion && taxRegion) {
            issues.push({
              type: 'error',
              message: `⚠️ Purchase Order (DE/EU) → Tax Region muss "EU" sein, nicht "${taxRegion}".`,
              fix: () => setTaxRegion('EU'),
              fixLabel: 'Tax Region → EU'
            });
          }
          if (!reverseCharge) {
            issues.push({
              type: 'error',
              message: '⚠️ Purchase Order (DE/EU) → Reverse Charge muss aktiviert sein (UID irrelevant).',
              fix: () => setReverseCharge(true),
              fixLabel: 'RC aktivieren'
            });
          }
          if (nichtSteuerbar) {
            issues.push({
              type: 'error',
              message: '⚠️ "Nicht steuerbar" darf bei Purchase Order (DE/EU) nicht aktiviert sein.',
              fix: () => setNichtSteuerbar(false),
              fixLabel: 'Nicht steuerbar deaktivieren'
            });
          }
        }

        // MIT UID → EU Tax Region, RC aktivieren
        else if (hasVAT) {
          if (!isEUTaxRegion && taxRegion) {
            issues.push({
              type: 'error',
              message: `⚠️ EU-Kunde mit UID (${vatNumber}) → Tax Region muss "EU" sein, nicht "${taxRegion}".`,
              fix: () => setTaxRegion('EU'),
              fixLabel: 'Tax Region → EU'
            });
          }
          if (!reverseCharge) {
            issues.push({
              type: 'error',
              message: `⚠️ EU-Kunde mit UID (${vatNumber}) → Reverse Charge muss aktiviert sein.`,
              fix: () => setReverseCharge(true),
              fixLabel: 'RC aktivieren'
            });
          }
          if (nichtSteuerbar) {
            issues.push({
              type: 'error',
              message: '⚠️ "Nicht steuerbar" darf bei EU-Kunden mit UID nicht aktiviert sein.',
              fix: () => setNichtSteuerbar(false),
              fixLabel: 'Nicht steuerbar deaktivieren'
            });
          }
        }

        // OHNE UID → 20% (Austria), kein RC
        else {
          if (!isAustriaTaxRegion && taxRegion) {
            issues.push({
              type: 'error',
              message: `⚠️ EU-Kunde ohne UID → Tax Region muss "Austria" (20%) sein, nicht "${taxRegion}".`,
              fix: () => setTaxRegion('Austria'),
              fixLabel: 'Tax Region → Austria'
            });
          }
          if (reverseCharge) {
            issues.push({
              type: 'error',
              message: '⚠️ Reverse Charge darf bei EU-Kunden ohne UID nicht aktiviert sein.',
              fix: () => setReverseCharge(false),
              fixLabel: 'RC deaktivieren'
            });
          }
          if (nichtSteuerbar) {
            issues.push({
              type: 'error',
              message: '⚠️ "Nicht steuerbar" darf bei EU-Kunden ohne UID nicht aktiviert sein.',
              fix: () => setNichtSteuerbar(false),
              fixLabel: 'Nicht steuerbar deaktivieren'
            });
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // REGEL 4: Non-EU + Wartung → Non-EU, Nicht-steuerbar aktivieren
      // ═══════════════════════════════════════════════════════════════
      else if (billingIsNonEU && subjectType === 'wartung') {
        if (!isNonEUTaxRegion && taxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Drittland + Wartung → Tax Region muss "Non-EU" sein, nicht "${taxRegion}".`,
            fix: () => setTaxRegion('Non-EU'),
            fixLabel: 'Tax Region → Non-EU'
          });
        }
        if (!nichtSteuerbar) {
          issues.push({
            type: 'error',
            message: '⚠️ Drittland + Wartung → "Nicht steuerbar" muss aktiviert sein.',
            fix: () => setNichtSteuerbar(true),
            fixLabel: 'Nicht steuerbar aktivieren'
          });
        }
        if (reverseCharge) {
          issues.push({
            type: 'error',
            message: '⚠️ Reverse Charge ist bei Drittland-Kunden nicht anwendbar.',
            fix: () => setReverseCharge(false),
            fixLabel: 'RC deaktivieren'
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // REGEL 5: Non-EU + Handel → Non-EU, kein Nicht-steuerbar
      // ═══════════════════════════════════════════════════════════════
      else if (billingIsNonEU) {
        if (!isNonEUTaxRegion && taxRegion) {
          issues.push({
            type: 'error',
            message: `⚠️ Drittland → Tax Region muss "Non-EU" sein, nicht "${taxRegion}".`,
            fix: () => setTaxRegion('Non-EU'),
            fixLabel: 'Tax Region → Non-EU'
          });
        }
        if (reverseCharge) {
          issues.push({
            type: 'error',
            message: '⚠️ Reverse Charge ist bei Drittland-Kunden nicht anwendbar.',
            fix: () => setReverseCharge(false),
            fixLabel: 'RC deaktivieren'
          });
        }
      }

      return issues.length > 0 ? issues : null;
    }

    function showTaxValidationPopup(issues, onFix, onIgnore) {
      $('hw24-tax-popup-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'hw24-tax-popup-overlay';

      const popup = document.createElement('div');
      popup.style.cssText = 'background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,0.3);max-width:500px;width:90%;max-height:80vh;overflow-y:auto;';

      let issuesHtml = '';
      issues.forEach(issue => {
        const bgColor = issue.type === 'error' ? '#fef2f2' : '#fef3c7';
        const borderColor = issue.type === 'error' ? '#f87171' : '#fbbf24';
        const icon = issue.type === 'error' ? '🔴' : '🟡';
        issuesHtml += `<div style="background:${bgColor};border:1px solid ${borderColor};border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px;">${icon} ${issue.message}</div>`;
      });

      popup.innerHTML = `
        <div style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold;font-size:15px;">🚨 Tax / Reverse Charge Warnung</div>
        <div style="padding:20px;">
          <p style="margin:0 0 16px 0;color:#374151;font-size:13px;">Es wurden folgende Probleme gefunden:</p>
          ${issuesHtml}
          <div style="display:flex;gap:12px;margin-top:20px;justify-content:flex-end;">
            <button type="button" id="hw24-popup-ignore" style="padding:10px 20px;font-size:13px;background:#6b7280;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;">Ignorieren & Speichern</button>
            <button type="button" id="hw24-popup-fix" style="padding:10px 20px;font-size:13px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;">✓ Korrigieren & Speichern</button>
          </div>
        </div>
      `;

      overlay.appendChild(popup);
      document.body.appendChild(overlay);

      $('hw24-popup-fix').onclick = () => { overlay.remove(); onFix(); };
      $('hw24-popup-ignore').onclick = () => { overlay.remove(); onIgnore(); };

      const escHandler = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
      document.addEventListener('keydown', escHandler);
    }

    let saveInterceptorInstalled = false;
    let skipValidation = false;

    function interceptSaveButton() {
      if (!isEdit || saveInterceptorInstalled) return;

      const saveButtons = document.querySelectorAll('button[name="saveButton"],input[name="saveButton"],button.btn-success[type="submit"],[data-action="Save"],.saveButton,button[type="submit"]');

      saveButtons.forEach(btn => {
        btn.addEventListener('click', async function (e) {
          if (skipValidation) { skipValidation = false; return; }

          // Prevent default immediately while we await validation
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          const issues = await validateTaxSettings();
          if (issues && issues.length > 0) {
            showTaxValidationPopup(issues,
              // Fix: Timeout auf 500ms erhöht für vtiger Tax-Rekalkulierung
              () => { issues.forEach(issue => issue.fix?.()); setTimeout(() => triggerSave(btn), 500); },
              () => { triggerSave(btn); }
            );
          } else {
            // No issues, proceed with save
            triggerSave(btn);
          }
        }, true);
      });

      saveInterceptorInstalled = true;
    }

    function triggerSave(btn) {
      skipValidation = true;
      if (btn) btn.click();
      else {
        const saveBtn = document.querySelector('button[name="saveButton"],input[name="saveButton"],button.btn-success[type="submit"],.saveButton');
        if (saveBtn) saveBtn.click();
      }
    }

    /* Core Processing */
    async function processEdit() {
      injectGlobalFixButton();
      const tbl = document.querySelector('#lineItemTab');
      if (!tbl) return;

      const rows = [...tbl.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')];

      for (let i = 0; i < rows.length; i++) {
        const tr = rows[i];
        const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');

        const nameEl = tr.querySelector('#productName' + rn) || tr.querySelector('input[id^="productName"]') || tr.querySelector('a[href*="module=Products"]');
        const td = nameEl?.closest('td');
        if (!td) continue;

        const hid = tr.querySelector(`input[name="hdnProductId${rn}"]`) || tr.querySelector('input[name^="hdnProductId"]');
        if (!hid?.value) continue;

        const meta = await fetchMetaById(hid.value);
        const info = ensureInfo(td);
        renderInfo(info, meta, tr, rn, i);

        refreshBadgeForRow(tr);
        injectButtons(tr);
      }
    }

    function extractProductUrlFromRow(tr) {
      const a = tr.querySelector('a[href*="module=Products"][href*="record="]') ||
        tr.querySelector('a[href*="module=Products"][href*="view=Detail"]') ||
        tr.querySelector('a[href*="module=Services"][href*="record="]') ||
        tr.querySelector('a.productsPopupLink') ||
        tr.querySelector('a[data-module="Products"]');
      const href = a?.getAttribute('href');
      if (!href) return '';
      try {
        const u = new URL(href, location.origin);
        const rec = u.searchParams.get('record');
        if (!rec) return '';
        return `index.php?module=Products&view=Detail&record=${rec}`;
      } catch { return ''; }
    }

    function findLineItemTable() {
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
      const selectors = ['tr.lineItemRow[id^="row"]', 'tr.inventoryRow', 'tr[id^="row"]', 'tr.listViewEntries', 'tr[data-row-num]', 'tbody tr', 'tr'];
      for (const sel of selectors) {
        const rows = [...container.querySelectorAll(sel)];
        const validRows = rows.filter(tr =>
          tr.querySelector('a[href*="module=Products"]') ||
          tr.querySelector('a[href*="module=Services"]') ||
          tr.querySelector('a.productsPopupLink') ||
          tr.querySelector('a.fieldValue[href*="module=Products"]')
        );
        if (validRows.length > 0) return validRows;
      }
      const allRows = [...container.querySelectorAll('tr')];
      return allRows.filter(tr => tr.querySelector('a[href*="module=Products"]') || tr.querySelector('a[href*="module=Services"]'));
    }

    async function processDetail() {
      const tbl = findLineItemTable();
      if (!tbl) return;

      const rows = findLineItemRows(tbl);

      for (let i = 0; i < rows.length; i++) {
        const tr = rows[i];
        const rn = tr.getAttribute('data-row-num') || tr.id?.replace('row', '') || '';
        const url = extractProductUrlFromRow(tr);
        if (!url) continue;

        const a = tr.querySelector('a[href*="module=Products"]') || tr.querySelector('a[href*="module=Services"]') || tr.querySelector('a.productsPopupLink');
        const td = a?.closest('td');
        if (!td) continue;

        const meta = await fetchMeta(url);
        const info = ensureInfo(td);
        renderInfo(info, meta, tr, rn, i);
      }
    }

    function waitForElement(selector, timeout = 5000) {
      return new Promise(resolve => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const observer = new MutationObserver(() => {
          const el = document.querySelector(selector);
          if (el) { observer.disconnect(); resolve(el); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
      });
    }

    return { processEdit, processDetail, injectTotalsPanel, injectReloadButton, interceptSaveButton, waitForElement, findLineItemTable, calculateTotals, calculateTotalsWithFallback };
  })();

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 2: SN RECONCILE
     ═══════════════════════════════════════════════════════════════════════════ */

  const SNReconcile = (function () {
    // Fix: Storage-Keys für unzugeordnete SNs
    const SN_STORAGE_KEY = 'hw24_remaining_sns';
    const SN_STORAGE_MODULE_KEY = 'hw24_remaining_sns_module';

    const parseList = t => uniq(S(t).split(/[\n,;]+/).map(norm).filter(Boolean));

    function extractRuntime(desc) {
      const s = desc.match(/Service Start\s*:\s*([0-9.\-]+)/i);
      const e = desc.match(/Service Ende?\s*:\s*([0-9.\-]+)/i);
      if (s && e) return `${s[1]} → ${e[1]}`;
      return '—';
    }

    function getLineItems() {
      return [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')]
        .map(tr => {
          const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');
          const descEl = tr.querySelector('textarea[name*="comment"], textarea[name*="description"]');
          const qtyEl = tr.querySelector('input[name^="qty"]');
          const desc = S(descEl?.value);
          const m = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
          const sns = m ? parseList(m[1]) : [];
          const productId = tr.querySelector(`input[name="hdnProductId${rn}"]`)?.value || tr.querySelector('input[name^="hdnProductId"]')?.value || '';
          const nameEl = tr.querySelector(`#productName${rn}`) || tr.querySelector('input[id^="productName"]') || tr.querySelector('a[href*="module=Products"]');
          const productName = nameEl?.value || nameEl?.textContent || '';
          return { rn, tr, descEl, qtyEl, desc, sns, productId, productName: S(productName), runtime: extractRuntime(desc), meta: null };
        });
    }

    let panelVisible = false;
    let SNAPSHOT = null;
    let reconcileResult = null;

    function injectToggleButton() {
      if ($('hw24-sn-toggle')) return;
      const btn = document.createElement('button');
      btn.id = 'hw24-sn-toggle';
      btn.innerHTML = '🔢';
      btn.title = 'SN-Abgleich öffnen';
      btn.onclick = togglePanel;
      document.body.appendChild(btn);
    }

    function injectPanel() {
      if ($('hw24-sn-panel')) return;

      const panel = document.createElement('div');
      panel.id = 'hw24-sn-panel';
      panel.innerHTML = `
        <div class="panel-header">
          <span>🔢 SN-Abgleich</span>
          <button id="hw24-sn-close" title="Schließen">✕</button>
        </div>
        <div class="panel-body">
          <div class="section">
            <div class="section-title">Soll-Liste (Kunde behält)</div>
            <textarea id="hw24-sn-soll" placeholder="Seriennummern vom Kunden einfügen (eine pro Zeile oder durch Komma getrennt)"></textarea>
            <div class="btn-row" style="margin-top:8px">
              <button id="hw24-sn-reconcile" class="btn btn-primary" style="flex:2">🔍 Abgleichen</button>
              <button id="hw24-sn-refresh" class="btn btn-secondary">🔄</button>
            </div>
          </div>
          <div id="hw24-sn-results" class="section" style="display:none"></div>
          <div id="hw24-sn-actions" class="btn-row" style="display:none">
            <button id="hw24-sn-apply" class="btn btn-primary">✓ Änderungen anwenden</button>
            <button id="hw24-sn-undo" class="btn btn-secondary" disabled>↩ Undo</button>
          </div>
          <div id="hw24-sn-status"></div>
        </div>
      `;

      document.body.appendChild(panel);

      $('hw24-sn-close').onclick = () => togglePanel(false);
      $('hw24-sn-reconcile').onclick = performReconcile;
      $('hw24-sn-refresh').onclick = () => { reconcileResult = null; performReconcile(); };
      $('hw24-sn-apply').onclick = applyChanges;
      $('hw24-sn-undo').onclick = undoChanges;
    }

    function togglePanel(forceState) {
      panelVisible = typeof forceState === 'boolean' ? forceState : !panelVisible;
      const panel = $('hw24-sn-panel');
      if (panel) {
        panel.classList.toggle('visible', panelVisible);
        if (panelVisible) { reconcileResult = null; performReconcile(); }
      }
    }

    async function performReconcile() {
      const resultsContainer = $('hw24-sn-results');
      const actionsContainer = $('hw24-sn-actions');
      if (!resultsContainer) return;

      const sollText = S($('hw24-sn-soll')?.value);
      const sollList = parseList(sollText);
      const items = getLineItems();

      for (const it of items) {
        if (!it.meta && it.productId) it.meta = await fetchMetaById(it.productId);
      }

      const istIndex = new Map();
      items.forEach(it => {
        const meta = it.meta || {};
        const displayName = meta.productName || it.productName || `Pos ${it.rn}`;
        it.sns.forEach(sn => istIndex.set(sn, { sn, position: displayName, item: it }));
      });

      const istSNs = new Set(istIndex.keys());
      const sollSNs = new Set(sollList);

      const matching = [], toRemove = [], missing = [];

      for (const [sn, info] of istIndex) {
        if (sollSNs.has(sn)) matching.push({ sn, position: info.position, rn: info.item.rn });
        else toRemove.push({ sn, position: info.position, rn: info.item.rn });
      }

      for (const sn of sollList) {
        if (!istSNs.has(sn)) missing.push({ sn });
      }

      const positionsToDelete = [];
      items.forEach(it => {
        if (it.sns.length === 0) return;
        const remainingSNs = it.sns.filter(sn => sollSNs.has(sn));
        if (remainingSNs.length === 0) {
          const meta = it.meta || {};
          positionsToDelete.push({ rn: it.rn, position: meta.productName || it.productName || `Position ${it.rn}`, removedSNs: it.sns.length });
        }
      });

      reconcileResult = { matching, toRemove, missing, items, positionsToDelete };

      resultsContainer.style.display = 'block';
      actionsContainer.style.display = (toRemove.length > 0 || missing.length > 0) ? 'flex' : 'none';

      if (sollList.length === 0) {
        resultsContainer.innerHTML = `
          <div class="summary-box">
            <div style="font-weight:600;margin-bottom:8px;">Aktueller Stand</div>
            <div class="summary-row"><span>Positionen:</span><span>${items.length}</span></div>
            <div class="summary-row"><span>Seriennummern gesamt:</span><span>${istSNs.size}</span></div>
          </div>
          <div style="color:#64748b;font-size:12px;text-align:center;padding:10px;">Füge die Soll-Liste vom Kunden ein und klicke "Abgleichen"</div>
        `;
        actionsContainer.style.display = 'none';
        return;
      }

      let html = `
        <div class="summary-box">
          <div class="summary-row"><span>✓ Übereinstimmend:</span><span style="color:#166534">${matching.length}</span></div>
          <div class="summary-row"><span>✗ Zu entfernen (nicht in Soll):</span><span style="color:#991b1b">${toRemove.length}</span></div>
          <div class="summary-row"><span>⚠ Fehlend (nicht im Angebot):</span><span style="color:#92400e">${missing.length}</span></div>
          ${positionsToDelete.length > 0 ? `<div class="summary-row" style="margin-top:4px;padding-top:4px;border-top:1px dashed #e2e8f0;"><span>🗑 Positionen werden gelöscht:</span><span style="color:#991b1b">${positionsToDelete.length}</span></div>` : ''}
          <div class="summary-row total"><span>Soll-Liste:</span><span>${sollList.length} SNs</span></div>
        </div>
      `;

      if (matching.length > 0) {
        html += `<div class="result-group"><div class="result-header matching"><span>✓ Übereinstimmend</span><span class="count">${matching.length}</span></div><div class="result-sns">${matching.map(m => `<span class="result-sn matching">${m.sn}<span class="result-position">${m.position}</span></span>`).join('')}</div></div>`;
      }
      if (toRemove.length > 0) {
        html += `<div class="result-group"><div class="result-header to-remove"><span>✗ Werden entfernt</span><span class="count">${toRemove.length}</span></div><div class="result-sns">${toRemove.map(m => `<span class="result-sn to-remove">${m.sn}<span class="result-position">${m.position}</span></span>`).join('')}</div></div>`;
      }
      if (missing.length > 0) {
        html += `<div class="result-group"><div class="result-header missing"><span>⚠ Fehlen im Angebot</span><span class="count">${missing.length}</span></div><div class="result-sns">${missing.map(m => `<span class="result-sn missing">${m.sn}</span>`).join('')}</div><div style="font-size:11px;color:#92400e;margin-top:6px;padding-left:8px;">Diese SNs sind in der Kundenliste, aber nicht im Angebot!</div></div>`;
      }
      if (positionsToDelete.length > 0) {
        html += `<div class="result-group"><div class="result-header to-remove" style="background:#fecaca;"><span>🗑 Positionen werden gelöscht</span><span class="count">${positionsToDelete.length}</span></div><div style="padding:8px;font-size:12px;">${positionsToDelete.map(p => `<div style="padding:4px 0;border-bottom:1px solid #fee2e2;"><strong>${p.position}</strong><span style="color:#64748b;font-size:11px;margin-left:8px;">(${p.removedSNs} SNs entfernt → 0 übrig)</span></div>`).join('')}</div><div style="font-size:11px;color:#991b1b;margin-top:6px;padding-left:8px;">Diese Positionen hatten SNs, nach dem Abgleich bleiben keine übrig.</div></div>`;
      }

      resultsContainer.innerHTML = html;
    }

    function deleteLineItemRow(tr) {
      if (!tr) return false;
      const deleteBtn = tr.querySelector('.deleteRow') || tr.querySelector('[data-action="deleteRow"]') || tr.querySelector('button[title*="Delete"]') || tr.querySelector('button[title*="Löschen"]') || tr.querySelector('i.fa-trash')?.closest('button') || tr.querySelector('.fa-trash')?.closest('a') || tr.querySelector('a[onclick*="deleteRow"]') || tr.querySelector('[onclick*="deleteRow"]');
      if (deleteBtn) { deleteBtn.click(); return true; }

      const rn = tr.getAttribute('data-row-num') || tr.id?.replace('row', '');
      if (rn && typeof window.Inventory_Edit_Js !== 'undefined') {
        try {
          const container = tr.closest('.inventoryBlock') || tr.closest('#lineItemTab');
          if (container) {
            const instance = container.__inventoryInstance;
            if (instance && typeof instance.deleteRow === 'function') { instance.deleteRow(tr); return true; }
          }
        } catch (e) { console.log('SN-Reconcile: deleteRow fallback failed', e); }
      }

      tr.style.display = 'none';
      tr.querySelectorAll('input, textarea, select').forEach(inp => { if (inp.name && !inp.name.includes('deleted')) inp.disabled = true; });
      return true;
    }

    async function applyChanges() {
      if (!reconcileResult) { showStatus('error', 'Bitte zuerst Abgleich durchführen'); return; }

      const items = getLineItems();
      const originalHadSNs = new Map();
      items.forEach(it => originalHadSNs.set(it.rn, it.sns.length > 0));

      SNAPSHOT = items.map(it => ({ rn: it.rn, desc: it.descEl?.value, qty: it.qtyEl?.value, hadSNs: it.sns.length > 0, rowHtml: it.tr?.outerHTML }));
      $('hw24-sn-undo').disabled = false;

      const toRemoveSet = new Set(reconcileResult.toRemove.map(r => r.sn));
      const missingSNs = reconcileResult.missing.map(m => m.sn);

      items.forEach(it => { it.sns = it.sns.filter(sn => !toRemoveSet.has(sn)); });

      const writeBack = () => {
        let deletedCount = 0;
        items.forEach(it => {
          if (!it.descEl) return;
          const hadSNsBefore = originalHadSNs.get(it.rn);
          const hasNoSNsNow = it.sns.length === 0;

          if (hadSNsBefore && hasNoSNsNow) {
            if (deleteLineItemRow(it.tr)) { deletedCount++; return; }
          }

          const snLine = it.sns.length ? `S/N: ${it.sns.join(', ')}` : '';
          const rest = it.desc.replace(/S\/N\s*:[^\n\r]+/i, '').trim();
          it.descEl.value = [snLine, rest].filter(Boolean).join('\n');
          fire(it.descEl);

          if (it.qtyEl && it.sns.length > 0) { it.qtyEl.value = it.sns.length; fire(it.qtyEl); }
        });

        reconcileResult = null;
        if ($('hw24-sn-soll')) $('hw24-sn-soll').value = '';
        $('hw24-sn-results').style.display = 'none';
        $('hw24-sn-actions').style.display = 'none';

        let msg = [];
        if (toRemoveSet.size > 0) msg.push(`${toRemoveSet.size} SN(s) entfernt`);
        if (deletedCount > 0) msg.push(`${deletedCount} Position(en) gelöscht`);
        showStatus('success', `✓ ${msg.join(', ')}`);
      };

      if (missingSNs.length > 0) {
        for (const it of items) { if (!it.meta && it.productId) it.meta = await fetchMetaById(it.productId); }
        openAddDialog(missingSNs, items, writeBack);
      } else { writeBack(); }
    }

    function undoChanges() {
      if (!SNAPSHOT) return;
      SNAPSHOT.forEach(s => {
        const tr = document.getElementById('row' + s.rn) || document.querySelector(`tr[data-row-num="${s.rn}"]`);
        if (!tr) return;
        const d = tr.querySelector('textarea[name*="comment"], textarea[name*="description"]');
        const q = tr.querySelector('input[name^="qty"]');
        if (d) { d.value = s.desc; fire(d); }
        if (q) { q.value = s.qty; fire(q); }
      });
      reconcileResult = null;
      $('hw24-sn-results').style.display = 'none';
      $('hw24-sn-actions').style.display = 'none';
      showStatus('success', '↩ Undo durchgeführt');
    }

    function showStatus(type, message) {
      const status = $('hw24-sn-status');
      if (status) {
        status.innerHTML = `<div class="status-msg ${type}">${message}</div>`;
        setTimeout(() => { status.innerHTML = ''; }, 3000);
      }
    }

    function openAddDialog(snList, items, onDone) {
      $('hw24-sn-dialog')?.remove();

      // Fix: Gespeicherte SNs laden und mit neuen kombinieren
      let storedSNs = [];
      try {
        const stored = sessionStorage.getItem(SN_STORAGE_KEY);
        const storedModule = sessionStorage.getItem(SN_STORAGE_MODULE_KEY);
        if (stored && storedModule === currentModule) {
          storedSNs = JSON.parse(stored);
        }
      } catch (e) {}

      let remaining = [...new Set([...snList, ...storedSNs])];
      let selectedSNs = new Set();
      let selectedTarget = null;

      const dialog = document.createElement('div');
      dialog.id = 'hw24-sn-dialog';

      function render() {
        dialog.innerHTML = `
          <div class="dialog-box">
            <div class="dialog-header">Neue Seriennummern zuordnen ${remaining.length > 0 ? `(${remaining.length} übrig)` : ''}</div>
            <div class="dialog-body">
              ${remaining.length === 0 ? `<div style="text-align:center;padding:20px;color:#16a34a;"><div style="font-size:32px;margin-bottom:8px;">✓</div><div>Alle Seriennummern wurden zugeordnet!</div></div>` : `
              <div style="margin-bottom:16px;">
                <div style="font-weight:600;margin-bottom:8px;">1. Seriennummern auswählen:</div>
                <div class="sn-checkbox-list">${remaining.map(sn => `<div class="sn-checkbox${selectedSNs.has(sn) ? ' selected' : ''}" data-sn="${sn}">${sn}</div>`).join('')}</div>
              </div>
              <div>
                <div style="font-weight:600;margin-bottom:8px;">2. Ziel-Position auswählen:</div>
                <div class="target-list">${items.map(it => {
                  const meta = it.meta || {};
                  const displayName = meta.productName || it.productName || `Position ${it.rn}`;
                  return `<div class="target-item${selectedTarget === it.rn ? ' selected' : ''}" data-rn="${it.rn}"><div class="target-item-name">${displayName}</div><div class="target-item-meta">${meta.sla ? `SLA: ${meta.sla} • ` : ''}${meta.duration ? `Duration: ${meta.duration} • ` : ''}Laufzeit: ${it.runtime}${it.sns.length ? ` • Aktuelle SNs: ${it.sns.length}` : ''}</div></div>`;
                }).join('')}</div>
              </div>`}
            </div>
            <div class="dialog-footer">
              ${remaining.length > 0 ? `<button class="btn btn-outline" id="hw24-dlg-copy" title="SNs in Zwischenablage kopieren" style="margin-right:auto;">📋 Kopieren</button><button class="btn btn-secondary" id="hw24-dlg-cancel">Abbrechen</button><button class="btn btn-primary" id="hw24-dlg-assign" ${selectedSNs.size === 0 || !selectedTarget ? 'disabled' : ''}>Zuordnen (${selectedSNs.size})</button>` : `<button class="btn btn-primary" id="hw24-dlg-close">Schließen</button>`}
            </div>
          </div>
        `;

        dialog.querySelectorAll('.sn-checkbox').forEach(el => {
          el.onclick = () => {
            const sn = el.dataset.sn;
            if (selectedSNs.has(sn)) selectedSNs.delete(sn);
            else selectedSNs.add(sn);
            render();
          };
        });

        dialog.querySelectorAll('.target-item').forEach(el => { el.onclick = () => { selectedTarget = el.dataset.rn; render(); }; });

        const assignBtn = dialog.querySelector('#hw24-dlg-assign');
        if (assignBtn) {
          assignBtn.onclick = () => {
            const targetItem = items.find(it => it.rn === selectedTarget);
            if (targetItem && selectedSNs.size > 0) {
              selectedSNs.forEach(sn => { if (!targetItem.sns.includes(sn)) targetItem.sns.push(sn); remaining = remaining.filter(x => x !== sn); });
              selectedSNs.clear();
              selectedTarget = null;
              render();
            }
          };
        }

        // Fix: Kopieren-Button für unzugeordnete SNs
        const copyBtn = dialog.querySelector('#hw24-dlg-copy');
        if (copyBtn) {
          copyBtn.onclick = async () => {
            try {
              await navigator.clipboard.writeText(remaining.join('\n'));
              copyBtn.textContent = '✓ Kopiert!';
              setTimeout(() => { copyBtn.textContent = '📋 Kopieren'; }, 2000);
            } catch (e) {
              const textArea = document.createElement('textarea');
              textArea.value = remaining.join('\n');
              document.body.appendChild(textArea);
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
              copyBtn.textContent = '✓ Kopiert!';
              setTimeout(() => { copyBtn.textContent = '📋 Kopieren'; }, 2000);
            }
          };
        }

        // Fix: Abbrechen speichert unzugeordnete SNs
        const cancelBtn = dialog.querySelector('#hw24-dlg-cancel');
        if (cancelBtn) {
          cancelBtn.onclick = () => {
            if (remaining.length > 0) {
              try {
                sessionStorage.setItem(SN_STORAGE_KEY, JSON.stringify(remaining));
                sessionStorage.setItem(SN_STORAGE_MODULE_KEY, currentModule);
              } catch (e) {}
            }
            dialog.remove();
          };
        }

        // Fix: Schließen leert Storage (alle SNs zugeordnet)
        const closeBtn = dialog.querySelector('#hw24-dlg-close');
        if (closeBtn) {
          closeBtn.onclick = () => {
            try {
              sessionStorage.removeItem(SN_STORAGE_KEY);
              sessionStorage.removeItem(SN_STORAGE_MODULE_KEY);
            } catch (e) {}
            dialog.remove();
            onDone();
          };
        }
      }

      render();
      document.body.appendChild(dialog);
    }

    function init() {
      injectToggleButton();
      injectPanel();
    }

    return { init };
  })();

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 3: PRICE MULTIPLIER
     ═══════════════════════════════════════════════════════════════════════════ */

  const PriceMultiplier = (function () {
    const isMultiplierModule = ['SalesOrder', 'Quotes', 'Invoice'].includes(currentModule);

    // Fix: Alle Events dispatchen (input, change, blur) damit vtiger Totals aktualisiert
    const fireChange = el => {
      if (!el) return;
      ['input', 'change', 'blur'].forEach(e => el.dispatchEvent(new Event(e, { bubbles: true })));
    };

    const parseFactor = raw => {
      if (!raw) return null;
      raw = raw.trim().replace(',', '.');
      const isDiv = raw.startsWith('/');
      raw = raw.replace(/^[*/]/, '');
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return null;
      return isDiv ? 1 / n : n;
    };

    function runMultiplier() {
      const input = prompt(
        'Faktor eingeben:\n\n• 1.77  oder *1.77  → multiplizieren\n• /3               → dividieren',
        '1.77'
      );

      const factor = parseFactor(input);
      if (!factor) { alert('Ungültiger Faktor'); return; }

      let updated = 0;

      document.querySelectorAll('tr.lineItemRow').forEach(row => {
        const pc = row.querySelector("input[name^='purchaseCost']");
        const sp = row.querySelector("input[name^='listPrice']");
        const qty = row.querySelector("input[name^='qty']");

        if (!pc || !sp || !qty) return;

        const purchaseCost = toNum(pc.value);
        const quantity = toNum(qty.value);

        if (!Number.isFinite(purchaseCost) || !Number.isFinite(quantity) || quantity <= 0) return;

        if (!sp.dataset.hw24Orig) sp.dataset.hw24Orig = sp.value;

        const sellingPrice = Math.round((purchaseCost * factor / quantity) * 10) / 10;
        sp.value = sellingPrice.toFixed(1);
        fireChange(sp);
        updated++;
      });

      // Fix: Totals Panel nach Preisänderung aktualisieren
      setTimeout(() => {
        if (typeof MetaOverlay !== 'undefined' && MetaOverlay.injectTotalsPanel) {
          MetaOverlay.injectTotalsPanel();
        }
      }, 200);

      alert(`Fertig ✅\n${updated} Position(en) aktualisiert`);
    }

    function undoChanges() {
      let restored = 0;
      document.querySelectorAll("input[name^='listPrice']").forEach(sp => {
        // Undo EK × Faktor
        if (sp.dataset.hw24Orig != null) {
          sp.value = sp.dataset.hw24Orig;
          delete sp.dataset.hw24Orig;
          fireChange(sp);
          restored++;
        }
        // Undo VP × Faktor
        if (sp.dataset.hw24OrigUP != null) {
          sp.value = sp.dataset.hw24OrigUP;
          delete sp.dataset.hw24OrigUP;
          fireChange(sp);
          restored++;
        }
      });
      alert(`Undo abgeschlossen ↩️\n${restored} Position(en) zurückgesetzt`);
    }

    // EK × Faktor pro Position
    function runMultiplierForRow(row) {
      const input = prompt(
        'Aufschlag-Faktor für diese Position:\n\n• 1.77  → EK × 1.77 = VK\n• /3    → EK ÷ 3 = VK',
        '1.77'
      );

      const factor = parseFactor(input);
      if (!factor) { alert('Ungültiger Faktor'); return; }

      const pc = row.querySelector("input[name^='purchaseCost']");
      const sp = row.querySelector("input[name^='listPrice']");
      const qty = row.querySelector("input[name^='qty']");

      if (!pc || !sp || !qty) { alert('Felder nicht gefunden'); return; }

      const purchaseCost = toNum(pc.value);
      const quantity = toNum(qty.value);

      if (!Number.isFinite(purchaseCost) || !Number.isFinite(quantity) || quantity <= 0) {
        alert('Ungültige Werte in EK oder Menge');
        return;
      }

      if (!sp.dataset.hw24Orig) sp.dataset.hw24Orig = sp.value;

      const sellingPrice = Math.round((purchaseCost * factor / quantity) * 10) / 10;
      sp.value = sellingPrice.toFixed(1);
      fireChange(sp);

      setTimeout(() => {
        if (typeof MetaOverlay !== 'undefined' && MetaOverlay.injectTotalsPanel) {
          MetaOverlay.injectTotalsPanel();
        }
      }, 200);
    }

    // VP × Faktor (global oder pro Position)
    function runUnitPriceMultiplier(singleRow = null) {
      const input = prompt(
        'Verkaufspreis-Faktor:\n\n• 1.05  → +5% Aufschlag\n• 0.9   → -10% Rabatt\n• /2    → halbieren',
        '1.0'
      );

      const factor = parseFactor(input);
      if (!factor) { alert('Ungültiger Faktor'); return; }

      let updated = 0;
      const rows = singleRow ? [singleRow] : [...document.querySelectorAll('tr.lineItemRow')];

      rows.forEach(row => {
        const sp = row.querySelector("input[name^='listPrice']");
        if (!sp) return;

        const currentPrice = toNum(sp.value);
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;

        if (!sp.dataset.hw24OrigUP) sp.dataset.hw24OrigUP = sp.value;

        const newPrice = Math.round(currentPrice * factor * 100) / 100;
        sp.value = newPrice.toFixed(2);
        fireChange(sp);
        updated++;
      });

      setTimeout(() => {
        if (typeof MetaOverlay !== 'undefined' && MetaOverlay.injectTotalsPanel) {
          MetaOverlay.injectTotalsPanel();
        }
      }, 200);

      if (!singleRow) {
        alert(`Fertig ✅\n${updated} Verkaufspreis(e) aktualisiert`);
      }
    }

    // Buttons werden jetzt in der Descriptions-Toolbar angezeigt (injectGlobalFixButton)
    function init() {
      // Keine separate Button-Injection mehr nötig
    }

    return { init, runMultiplier, undoChanges, runMultiplierForRow, runUnitPriceMultiplier };
  })();

  // Globale Funktionen für Buttons in MetaOverlay
  function runMultiplierForRow(row) { PriceMultiplier.runMultiplierForRow(row); }
  function runUnitPriceMultiplier(singleRow) { PriceMultiplier.runUnitPriceMultiplier(singleRow); }
  function runGlobalEKMultiplier() { PriceMultiplier.runMultiplier(); }
  function runUndo() { PriceMultiplier.undoChanges(); }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 4: EMAILMAKER TOOLS
     ═══════════════════════════════════════════════════════════════════════════ */

  const EMAILMakerTools = (function () {
    const CONTACT_CONTEXT_MODULES = ['Quotes', 'SalesOrder', 'Potentials', 'Invoice', 'PurchaseOrder'];
    const EMAIL_TOOLBAR_MODULES = ['Quotes', 'SalesOrder', 'Potentials'];
    const STEP1_AUTO_LANG_MODULES = ['Quotes', 'SalesOrder', 'Invoice', 'PurchaseOrder'];
    const isSalesOrder = currentModule === 'SalesOrder';
    if (!CONTACT_CONTEXT_MODULES.includes(currentModule) || !isDetail) return { init() {} };

    const hasEmailToolbar = EMAIL_TOOLBAR_MODULES.includes(currentModule);
    const hasAutoStep1Language = STEP1_AUTO_LANG_MODULES.includes(currentModule);

    const TOOLBAR_ID = 'hw24-email-toolbar';
    let savedEmailData = null; // for undo
    let perDuApplied = false;  // track if PerDu was applied (for Danke form)

    /* ── Contact first name fetching ── */
    let cachedContactMeta = null;

    function normalizeLabelText(text) {
      return S(text).toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function findFieldValueByLabel(doc, matcher) {
      const idLabels = [...doc.querySelectorAll('[id*="_detailView_fieldLabel_"]')];
      for (const labelEl of idLabels) {
        const labelText = normalizeLabelText(labelEl.textContent);
        if (!matcher(labelText)) continue;
        const valueId = labelEl.id.replace('fieldLabel', 'fieldValue');
        const valueEl = doc.getElementById(valueId);
        const valueText = S(valueEl?.textContent || valueEl?.value);
        if (valueText) return valueText;
      }

      const genericLabels = [...doc.querySelectorAll('td.fieldLabel, th.fieldLabel, .fieldLabel, label')];
      for (const labelEl of genericLabels) {
        const labelText = normalizeLabelText(labelEl.textContent);
        if (!matcher(labelText)) continue;
        const valueEl =
          labelEl.nextElementSibling ||
          labelEl.closest('tr')?.querySelector('td.fieldValue, .fieldValue') ||
          labelEl.parentElement?.querySelector('.fieldValue');
        const valueText = S(valueEl?.textContent || valueEl?.value);
        if (valueText) return valueText;
      }

      return '';
    }

    function normalizeContactLanguage(rawLanguage) {
      const txt = normalizeLabelText(rawLanguage);
      if (/\b(en|english|englisch)\b/.test(txt)) return 'en';
      if (/\b(de|deutsch|german)\b/.test(txt)) return 'de';
      return 'de';
    }

    function normalizeEmailOptOut(rawValue) {
      const txt = normalizeLabelText(rawValue);
      if (!txt) return null;
      if (/\b(yes|ja|true|1|on|aktiv|enabled|checked)\b|[✓✔]/.test(txt)) return true;
      if (/\b(no|nein|false|0|off|deaktiv|disabled|not checked)\b|[✗✘]/.test(txt)) return false;
      return null;
    }

    function parseEmailOptOutFromNode(node) {
      if (!node) return null;

      const checkbox = node.matches?.('input[type="checkbox"]')
        ? node
        : node.querySelector?.('input[type="checkbox"]');
      if (checkbox) return !!checkbox.checked;

      const checkedIcon = node.querySelector?.('.fa-check, .fa-check-square, .fa-check-circle, .glyphicon-ok');
      if (checkedIcon) return true;
      const uncheckedIcon = node.querySelector?.('.fa-times, .fa-close, .fa-ban, .fa-minus, .glyphicon-remove');
      if (uncheckedIcon) return false;

      const fromText = normalizeEmailOptOut(node.textContent || node.value || '');
      if (fromText !== null) return fromText;

      return null;
    }

    function resolveEmailOptOut(doc, rawEmailOptOutText) {
      const candidates = [
        doc.getElementById('Contacts_detailView_fieldValue_emailoptout'),
        doc.querySelector('[id$="_fieldValue_emailoptout"]'),
        doc.querySelector('[id*="_fieldValue_emailoptout"]'),
        doc.querySelector('[data-name="emailoptout"]'),
        doc.querySelector('input[name="emailoptout"]')
      ].filter(Boolean);

      for (const node of candidates) {
        const parsed = parseEmailOptOutFromNode(node);
        if (parsed !== null) return parsed;
      }

      const fromRaw = normalizeEmailOptOut(rawEmailOptOutText);
      if (fromRaw !== null) return fromRaw;

      return null;
    }

    function getContactId() {
      const link = document.querySelector('a[href*="module=Contacts&view=Detail"]');
      if (!link) return null;
      const m = link.getAttribute('href').match(/record=(\d+)/);
      return m ? m[1] : null;
    }

    async function fetchContactMeta(contactId) {
      if (!contactId) return { firstName: '', lang: 'de', emailOptOut: null };
      if (cachedContactMeta?.id === contactId) return cachedContactMeta;
      try {
        const r = await fetch(`index.php?module=Contacts&view=Detail&record=${contactId}`, { credentials: 'same-origin' });
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const firstName = findFieldValueByLabel(doc, txt => (
          txt === 'first name' || txt === 'vorname' || txt.includes('firstname')
        ));

        const rawLanguage = findFieldValueByLabel(doc, txt => (
          txt === 'language' || txt === 'sprache' || txt.includes('portal language') || txt.includes('language')
        ));

        const rawEmailOptOut = findFieldValueByLabel(doc, txt => (
          /email\s*opt\s*out|e-?mail\s*opt\s*out|opt\s*out/.test(txt)
        ));

        cachedContactMeta = {
          id: contactId,
          firstName: S(firstName),
          lang: normalizeContactLanguage(rawLanguage),
          emailOptOut: resolveEmailOptOut(doc, rawEmailOptOut),
          rawLanguage: S(rawLanguage),
          rawEmailOptOut: S(rawEmailOptOut)
        };
        return cachedContactMeta;
      } catch (e) {
        console.error('HW24: Fehler beim Laden der Kontakt-Metadaten:', e);
        cachedContactMeta = { id: contactId, firstName: '', lang: 'de', emailOptOut: null };
        return cachedContactMeta;
      }
    }

    async function fetchContactFirstName(contactId) {
      const meta = await fetchContactMeta(contactId);
      return meta.firstName || '';
    }

    function findContactLinkInCurrentView() {
      const links = [...document.querySelectorAll('a[href*="module=Contacts&view=Detail"][href*="record="]')];
      if (!links.length) return null;

      const preferred = links.find(link =>
        link.closest('#detailView, .detailViewContainer, .summaryView, .summaryViewEntries, .details')
      );

      return preferred || links[0];
    }

    function renderContactMetaChip(target, meta) {
      const langLabel = meta.lang === 'en' ? 'EN' : 'DE';
      const optOutLabel = meta.emailOptOut === true
        ? 'Email Opt Out: ON'
        : meta.emailOptOut === false
          ? 'Email Opt Out: OFF'
          : 'Email Opt Out: n/a';

      const optOutClass = meta.emailOptOut === true
        ? 'optout-on'
        : meta.emailOptOut === false
          ? 'optout-off'
          : 'optout-na';

      target.innerHTML = `
        <span class="hw24-contact-chip ${meta.lang === 'en' ? 'lang-en' : 'lang-de'}">${langLabel}</span>
        <span class="hw24-contact-chip ${optOutClass}">${optOutLabel}</span>
      `;
    }

    async function injectContactMetaBadge() {
      const contactLink = findContactLinkInCurrentView();
      if (!contactLink) return;

      const contactId = getContactId();
      if (!contactId) return;

      const meta = await fetchContactMeta(contactId);

      let wrap = document.getElementById('hw24-contact-meta-wrap');
      if (!wrap) {
        wrap = document.createElement('span');
        wrap.id = 'hw24-contact-meta-wrap';
        wrap.className = 'hw24-contact-meta-wrap';
      }

      renderContactMetaChip(wrap, meta);

      if (contactLink.nextElementSibling !== wrap) {
        contactLink.insertAdjacentElement('afterend', wrap);
      }
    }

    function findStep1Container() {
      const selectors = [
        '.SendEmailFormStep1',
        '#sendEmailFormStep1',
        '.modelContainer',
        '.modal.in',
        '.modal.show',
        '[role="dialog"]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const hasCKEditor = el.querySelector('.cke, [id^="cke_"], .cke_editable');
        if (hasCKEditor) continue;
        const hasSelect = el.querySelector('select');
        if (hasSelect) return el;
      }
      return null;
    }

    function setLanguageInStep1(container, lang) {
      const jq = window.jQuery || window.$;
      const wanted = lang === 'en' ? 'en' : 'de';
      const languageMatcher = wanted === 'en'
        ? /\b(en|english|englisch)\b/i
        : /\b(de|deutsch|german)\b/i;

      const selects = [...container.querySelectorAll('select')];
      for (const sel of selects) {
        const key = `${sel.name || ''} ${sel.id || ''}`.toLowerCase();
        const options = [...sel.options];
        const looksLikeLanguage = /lang|sprache|language/.test(key)
          || (options.some(o => /\b(de|deutsch|german)\b/i.test(o.text))
            && options.some(o => /\b(en|english|englisch)\b/i.test(o.text)));
        if (!looksLikeLanguage) continue;

        const target = options.find(o => languageMatcher.test(o.text) || S(o.value).toLowerCase() === wanted);
        if (!target) continue;

        sel.value = target.value;
        fire(sel);
        if (jq) {
          try { jq(sel).val(target.value).trigger('change'); } catch { /* ignore */ }
        }
        container.dataset.hw24LangApplied = wanted;
        console.log('[HW24] Step1 language set from Contact:', target.text);
        return true;
      }
      return false;
    }

    async function tryApplyStep1Language() {
      if (!hasAutoStep1Language) return;
      const container = findStep1Container();
      if (!container) return;

      const contactId = getContactId();
      if (!contactId) return;

      const meta = await fetchContactMeta(contactId);
      const targetLang = meta.lang || 'de';

      if (container.dataset.hw24LangApplied === targetLang) return;
      setLanguageInStep1(container, targetLang);
    }

    /* ── Email toolbar button config ── */
    const isPotentials = currentModule === 'Potentials';

    function getToolbarButtons() {
      const buttons = [];
      if (isSalesOrder) {
        buttons.push({
          id: 'hw24-email-commission-btn',
          label: '\uD83D\uDCBC Provision einf\u00FCgen',
          title: 'Partner-Provision in E-Mail einf\u00FCgen',
          action: insertCommission
        });
      }
      buttons.push({
        id: 'hw24-email-perdu-btn',
        label: '\uD83D\uDC4B Per Du',
        title: 'E-Mail von Sie auf du umstellen',
        action: applyPerDu
      });
      if (isPotentials) {
        buttons.push({
          id: 'hw24-email-danke-btn',
          label: '\uD83D\uDE4F Danke',
          title: 'Danke-Satz einf\u00FCgen',
          action: applyDanke
        });
      }
      buttons.push({
        id: 'hw24-email-undo-btn',
        label: '\u21A9 Undo',
        title: 'Letzte Aktion r\u00FCckg\u00E4ngig machen',
        action: undoEmail,
        hidden: true
      });
      return buttons;
    }

    /* ── Get CKEditor instance for the email body ── */
    function getCKEditorInstance() {
      if (typeof CKEDITOR === 'undefined' || !CKEDITOR.instances) return null;
      // Find the email body editor — try common field names
      for (const name of ['description', 'email_body', 'body']) {
        if (CKEDITOR.instances[name]) return CKEDITOR.instances[name];
      }
      // Fallback: return first available instance
      const keys = Object.keys(CKEDITOR.instances);
      return keys.length ? CKEDITOR.instances[keys[keys.length - 1]] : null;
    }

    /* ── Find the email body editor (CKEditor → iframe → contenteditable → textarea) ── */
    function findEmailBody(container) {
      // Strategy 1: CKEditor API (VTiger uses CKEditor for Compose Email)
      const ckInstance = getCKEditorInstance();
      if (ckInstance) {
        try {
          const data = ckInstance.getData();
          if (data && data.length > 10) return { type: 'ckeditor', editor: ckInstance };
        } catch { /* editor not ready */ }
      }

      // Strategy 2: iframe with contentDocument (CKEditor creates an iframe)
      const iframes = container.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc?.body && doc.body.innerHTML.length > 10) return { type: 'iframe', el: iframe, doc };
        } catch { /* cross-origin — skip */ }
      }

      // Strategy 3: contenteditable div
      const editables = container.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        if (el.innerHTML.length > 10) return { type: 'contenteditable', el };
      }

      // Strategy 4: textarea (raw source mode)
      const textareas = container.querySelectorAll('textarea');
      for (const ta of textareas) {
        if (ta.value.length > 10 && !ta.classList.contains('cke_source')) return { type: 'textarea', el: ta };
      }

      return null;
    }

    /* ── Detect language from email body content ── */
    function detectLanguage(html) {
      if (/Ebenso finden Sie/i.test(html)) return 'de';
      if (/We also attached/i.test(html)) return 'en';
      if (/Sehr geehrte|Auftragsbestätigung|hiermit bestätigen/i.test(html)) return 'de';
      if (/Dear |order confirmation|hereby confirm/i.test(html)) return 'en';
      return 'de';
    }

    /* ── Format commission amount per locale ── */
    function formatCommission(amount, lang) {
      if (lang === 'en') {
        return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20AC';
      }
      return amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20AC';
    }

    /* ── Build the commission text (plain) ── */
    function buildCommissionText(amount, lang) {
      const formatted = formatCommission(amount, lang);
      if (lang === 'en') return `Your commission amounts to: ${formatted}`;
      return `Ihr Provisionsanteil betr\u00E4gt: ${formatted}`;
    }

    /* ── Extract inline style from existing paragraphs in the email body ── */
    function extractBodyStyle(html) {
      // Parse the HTML and find a representative <p> or <span> with inline style
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      // Look for a <p> or <span> near the anchor text or any body paragraph with style
      const candidates = tmp.querySelectorAll('p[style], span[style], div[style], font');
      for (const el of candidates) {
        const text = el.textContent.trim();
        // Skip empty or very short elements, prefer real body text
        if (text.length < 5) continue;
        // Return the tag name and style attribute
        const style = el.getAttribute('style') || '';
        const tag = el.tagName.toLowerCase();
        // For <font> tags, extract face/size/color attributes
        if (tag === 'font') {
          const face = el.getAttribute('face') || '';
          const size = el.getAttribute('size') || '';
          const color = el.getAttribute('color') || '';
          return { tag: 'font', style, face, size, color };
        }
        if (style) return { tag, style, face: '', size: '', color: '' };
      }
      return null;
    }

    /* ── Build the commission HTML snippet matching existing email style ── */
    function buildCommissionHTML(commissionText, html) {
      const bodyStyle = extractBodyStyle(html);
      if (bodyStyle && bodyStyle.tag === 'font') {
        // Match <font> based email templates
        const attrs = [];
        if (bodyStyle.face) attrs.push(`face="${bodyStyle.face}"`);
        if (bodyStyle.size) attrs.push(`size="${bodyStyle.size}"`);
        if (bodyStyle.color) attrs.push(`color="${bodyStyle.color}"`);
        const fontAttrs = attrs.length ? ' ' + attrs.join(' ') : '';
        return `<p><font${fontAttrs}>${commissionText}</font></p>`;
      }
      if (bodyStyle && bodyStyle.style) {
        return `<p style="${bodyStyle.style}">${commissionText}</p>`;
      }
      // No style found — use a safe default matching common email fonts
      return `<p>${commissionText}</p>`;
    }

    function normalizeMatchText(text) {
      return S(text)
        .toLowerCase()
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[.,;:!?]/g, '')
        .trim();
    }

    function getAnchorRegexes(lang) {
      if (lang === 'en') {
        return [
          /we also attached our servicebook/i,
          /attached our servicebook/i,
          /servicebook/i
        ];
      }
      return [
        /ebenso finden sie unser servicebook im anhang/i,
        /ebenso findest du unser servicebook im anhang/i,
        /servicebook im anhang/i
      ];
    }

    function getSignatureRegexes() {
      return [
        /mit freundlichen gr(?:u|ü)(?:ss|ß)en/i,
        /liebe gr(?:u|ü)(?:ss|ß)e/i,
        /kind regards/i,
        /best regards/i
      ];
    }

    function findTextNodeByRegexes(root, regexes) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      while (walker.nextNode()) {
        const normalized = normalizeMatchText(walker.currentNode.textContent);
        if (!normalized) continue;
        if (regexes.some(rx => rx.test(normalized))) return walker.currentNode;
      }
      return null;
    }

    function findAnchorNode(root, lang) {
      return findTextNodeByRegexes(root, getAnchorRegexes(lang));
    }

    function findSignatureNode(root) {
      return findTextNodeByRegexes(root, getSignatureRegexes());
    }

    function findInsertIndexByRegexes(text, regexes) {
      let best = null;
      for (const rx of regexes) {
        const m = rx.exec(text);
        if (!m) continue;
        if (!best || m.index < best.index) best = { index: m.index, length: m[0].length };
      }
      return best;
    }

    /* ── Helper: read current email HTML ── */
    function readEmailHTML() {
      const container = document.querySelector('#composeEmailContainer, .SendEmailFormStep2, .modelContainer, .modal.in, .modal.show, [role="dialog"]') || document.body;
      const body = findEmailBody(container);
      if (!body) return null;
      let html;
      if (body.type === 'ckeditor') html = body.editor.getData();
      else if (body.type === 'iframe') html = body.doc.body.innerHTML;
      else if (body.type === 'contenteditable') html = body.el.innerHTML;
      else html = body.el.value;
      return { body, html };
    }

    /* ── Helper: write HTML back to email editor ── */
    function writeEmailHTML(body, html) {
      if (body.type === 'ckeditor') {
        body.editor.setData(html);
      } else if (body.type === 'textarea') {
        body.el.value = html;
        fire(body.el);
      } else if (body.type === 'iframe') {
        body.doc.body.innerHTML = html;
      } else {
        body.el.innerHTML = html;
      }
    }

    /* ── Helper: save state for undo (only first save kept until undo) ── */
    function saveForUndo(html, bodyType) {
      if (!savedEmailData) {
        savedEmailData = { html, bodyType };
      }
    }

    /* ── Helper: mark a button as done ── */
    function markButtonDone(btnId, doneLabel) {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.textContent = doneLabel;
      }
      const undoBtn = document.getElementById('hw24-email-undo-btn');
      if (undoBtn) undoBtn.style.display = '';
    }

    /* ── Helper: reset all action buttons ── */
    function resetAllButtons() {
      const resets = [
        { id: 'hw24-email-commission-btn', label: '\uD83D\uDCBC Provision einf\u00FCgen' },
        { id: 'hw24-email-perdu-btn', label: '\uD83D\uDC4B Per Du' },
        { id: 'hw24-email-danke-btn', label: '\uD83D\uDE4F Danke' }
      ];
      for (const r of resets) {
        const btn = document.getElementById(r.id);
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.style.cursor = 'pointer';
          btn.textContent = r.label;
        }
      }
      const undoBtn = document.getElementById('hw24-email-undo-btn');
      if (undoBtn) undoBtn.style.display = 'none';
    }

    /* ── Undo: restore original email body ── */
    function undoEmail() {
      if (!savedEmailData) return;

      const container = document.querySelector('#composeEmailContainer, .SendEmailFormStep2, .modelContainer, .modal.in, .modal.show, [role="dialog"]') || document.body;
      const body = findEmailBody(container);
      if (!body) return;

      writeEmailHTML(body, savedEmailData.html);
      savedEmailData = null;
      perDuApplied = false;
      resetAllButtons();
    }

    /* ── PerDu: Sie→du / Mr./Mrs.→Vorname transformation ── */
    async function applyPerDu() {
      const data = readEmailHTML();
      if (!data) { alert('E-Mail-Body nicht gefunden.'); return; }
      const { body, html } = data;

      // Save original for undo
      saveForUndo(html, body.type);

      // Fetch contact first name
      const contactId = getContactId();
      const firstName = await fetchContactFirstName(contactId);

      let result = html;

      // Pre-processing: decode HTML entities so regex patterns can match
      // Umlauts and ß (CKEditor returns &ouml; instead of ö etc.)
      result = result.replace(/&auml;/g, '\u00E4');
      result = result.replace(/&ouml;/g, '\u00F6');
      result = result.replace(/&uuml;/g, '\u00FC');
      result = result.replace(/&Auml;/g, '\u00C4');
      result = result.replace(/&Ouml;/g, '\u00D6');
      result = result.replace(/&Uuml;/g, '\u00DC');
      result = result.replace(/&szlig;/g, '\u00DF');
      // Spaces
      result = result.replace(/&nbsp;/g, ' ');
      result = result.replace(/\u00A0/g, ' ');
      result = result.replace(/&#160;/g, ' ');

      // E-early) Extract user first name from signature BEFORE replacements
      // Look for bold name after closing formula in the ORIGINAL text
      let userFirstName = '';
      // Words that are NOT person names (pronouns, determiners, common words)
      const NOT_NAMES = ['Ihr', 'Dein', 'Das', 'Die', 'Der', 'Den', 'Dem', 'Ein', 'Eine', 'Mit',
        'Von', 'Und', 'Oder', 'Aber', 'Wenn', 'Wir', 'Uns', 'Unser', 'Service', 'Team', 'The',
        'Your', 'Our', 'Best', 'Kind', 'Dear', 'Sent', 'From', 'Tel', 'Fax', 'Web', 'Mob'];
      const closingRe = /(?:Mit freundlichen Gr\u00FC\u00DFen|Liebe Gr\u00FC\u00DFe|Kind regards)/i;
      const closingMatch = result.match(closingRe);
      if (closingMatch) {
        const afterClosing = result.substring(closingMatch.index + closingMatch[0].length);
        // Strategy 1: bold/strong tag — extract first + last name candidate
        const boldMatch = afterClosing.match(/<(?:b|strong|span)[^>]*>\s*([A-Z\u00C0-\u017E][a-z\u00E0-\u017E]+)(?:\s+[A-Z\u00C0-\u017E][\w\u00C0-\u024F]*)?/);
        if (boldMatch && !NOT_NAMES.includes(boldMatch[1])) userFirstName = boldMatch[1];
        // Strategy 2: name after <br> or </p><p> (no bold)
        if (!userFirstName) {
          const brMatch = afterClosing.match(/(?:<br\s*\/?>[\s]*(?:<br\s*\/?>)?|<\/p>\s*<p[^>]*>)\s*(?:<[^>]*>)*\s*([A-Z\u00C0-\u017E][a-z\u00E0-\u017E]+)(?:\s+[A-Z\u00C0-\u017E][\w\u00C0-\u024F]*)?/);
          if (brMatch && !NOT_NAMES.includes(brMatch[1])) userFirstName = brMatch[1];
        }
      }
      console.log('[HW24] PerDu: userFirstName from signature =', userFirstName || '(not found)');
      console.log('[HW24] PerDu: contact firstName =', firstName || '(not found)');

      // A) Salutation replacements (DE + EN)
      // Strategy: strip HTML tags to find salutation in plain text, then build a
      // flexible regex from the matched words that allows any tags between them.
      // This reliably handles CKEditor wrapping words in <span>, <b>, <font> etc.
      const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const TAG_SEP = '(?:\\s|<[^>]*>)*'; // zero or more whitespace/tags between words
      if (firstName) {
        const plainText = result.replace(/<[^>]*>/g, '');
        console.log('[HW24] PerDu: plainText salutation area =', plainText.substring(0, 200));

        // DE: "Sehr geehrter Herr Nachname" / "Hallo Herr Nachname" → "Hallo Vorname"
        const salutDE = plainText.match(/(?:Sehr geehrte[r]?\s+(?:Herr|Frau)\s+[\w\u00C0-\u024F]+|Hallo\s+(?:Herr|Frau)\s+[\w\u00C0-\u024F]+)/);
        if (salutDE) {
          const words = salutDE[0].split(/\s+/);
          const flexPattern = words.map(w => escRx(w)).join(TAG_SEP + '\\s?' + TAG_SEP);
          result = result.replace(new RegExp(flexPattern, 'g'), `Hallo ${firstName}`);
          console.log('[HW24] PerDu: DE salutation matched:', salutDE[0], '\u2192 Hallo', firstName);
        } else {
          console.log('[HW24] PerDu: DE salutation NOT found in plain text');
        }

        // EN: "Dear/Hello Mr./Mrs./Ms. Lastname" → "Dear/Hello Vorname"
        const salutEN = plainText.match(/(Dear|Hello)\s+(?:Mr\.|Mrs\.|Ms\.)\s+[\w\u00C0-\u024F]+/);
        if (salutEN) {
          const words = salutEN[0].split(/\s+/);
          const flexPattern = words.map(w => escRx(w)).join(TAG_SEP + '\\s?' + TAG_SEP);
          result = result.replace(new RegExp(flexPattern, 'g'), `${salutEN[1]} ${firstName}`);
          console.log('[HW24] PerDu: EN salutation matched:', salutEN[0], '\u2192', salutEN[1], firstName);
        }

        // A2) Hardcoded cleanup: remove any leftover "Herr"/"Frau"/"Mr."/"Mrs."/"Ms." + trailing space/tags
        result = result.replace(/(?:Herr|Frau|Mr\.|Mrs\.|Ms\.)(?:\s|<[^>]*>)+/g, '');
      }

      // B) Multi-word phrase mappings (SPECIFIC BEFORE GENERIC)
      const phraseMappings = [
        // Reflexive dative: sich ... Zeit → dir ... Zeit
        [/\bsich ((?:noch )?(?:\w+ )*)Zeit zu nehmen\b/g, 'dir $1Zeit zu nehmen'],
        [/\bsich Zeit\b/g, 'dir Zeit'],
        // Object-Sie (accusative/dative)
        [/\bwir m\u00F6chten Sie\b/gi, 'wir m\u00F6chten dich'],
        [/\bw\u00FCrden wir Sie bitten\b/gi, 'w\u00FCrden wir dich bitten'],
        [/\bstehen wir Ihnen\b/gi, 'stehen wir dir'],
        // Subject-Sie (verb conjugation)
        [/\bfinden Sie\b/gi, 'findest du'],
        [/\bk\u00F6nnen Sie\b/gi, 'kannst du'],
        [/\bhaben Sie\b/gi, 'hast du'],
        [/\bm\u00F6chten Sie\b/gi, 'm\u00F6chtest du'],
        [/\bSollten Sie\b/g, 'Solltest du'],
        [/\bsollten Sie\b/g, 'solltest du'],
        [/\bWenn Sie\b/g, 'Wenn du'],
        [/\bwenn Sie\b/g, 'wenn du'],
        [/\bteilen Sie uns\b/gi, 'teile uns'],
        [/\bschreiben Sie uns\b/gi, 'schreibe uns'],
        [/\bBewerten Sie\b/g, 'Bewerte'],
        [/\bbewerten Sie\b/g, 'bewerte'],
        // Verb conjugation in du-clauses
        [/\bzufrieden waren\b/g, 'zufrieden warst'],
        [/\bverl\u00E4ngern m\u00F6chten\b/g, 'verl\u00E4ngern m\u00F6chtest'],
      ];
      for (const [pat, repl] of phraseMappings) {
        result = result.replace(pat, repl);
      }

      // C) Imperative DE (Verb + Sie → informal)
      const imperativeMappings = [
        [/\bbewahren Sie\b/gi, 'bewahre'],
        [/\bschicken Sie\b/gi, 'schick'],
        [/\bklicken Sie\b/gi, 'klick'],
        [/\bgeben [Ss]ie\b/g, 'gib'],
        [/\brufen Sie\b/gi, 'ruf'],
        [/\bschreiben Sie\b/gi, 'schreib'],
        [/\bnehmen Sie\b/gi, 'nimm'],
        [/\bkontaktieren Sie\b/gi, 'kontaktiere'],
        [/\bmelden Sie\b/gi, 'melde'],
        [/\bsenden Sie\b/gi, 'sende'],
        [/\blesen Sie\b/gi, 'lies'],
        [/\bwenden Sie sich\b/gi, 'wende dich'],
      ];
      for (const [pat, repl] of imperativeMappings) {
        result = result.replace(pat, repl);
      }

      // D) Pronoun replacements (specific noun phrases first, then generic)
      result = result.replace(/\b[Ii]hr Angebot\b/g, 'das Angebot');
      result = result.replace(/\bIhr pers\u00F6nliches Angebot\b/g, 'Dein pers\u00F6nliches Angebot');
      result = result.replace(/\bihr pers\u00F6nliches Angebot\b/g, 'dein pers\u00F6nliches Angebot');
      // Possessive: Uppercase Ihr→Dein (beginning of phrase/line), lowercase ihr→dein
      result = result.replace(/\bIhre\b/g, 'Deine');
      result = result.replace(/\bihre\b/g, 'deine');
      result = result.replace(/\bIhrem\b/g, 'Deinem');
      result = result.replace(/\bihrem\b/g, 'deinem');
      result = result.replace(/\bIhren\b/g, 'Deinen');
      result = result.replace(/\bihren\b/g, 'deinen');
      result = result.replace(/\bIhrer\b/g, 'Deiner');
      result = result.replace(/\bihrer\b/g, 'deiner');
      // Dative
      result = result.replace(/\bIhnen\b/g, 'Dir');
      result = result.replace(/\bihnen\b/g, 'dir');
      // Possessive "Ihr" → "Dein" / "ihr" → "dein"
      result = result.replace(/\bIhr\b/g, 'Dein');
      result = result.replace(/\bihr\b/g, 'dein');
      // Reflexive: sich → dich (dative cases handled in phrase mappings above)
      result = result.replace(/\bsich\b/g, 'dich');
      // Standalone Sie → du (final catch-all)
      result = result.replace(/\bSie\b/g, 'du');

      // D2) Fix leftover unconjugated verbs (HTML tags between words prevented phrase/imperative match)
      result = result.replace(/\bschreiben uns\b/g, 'schreib uns');
      result = result.replace(/\bschreiben du\b/g, 'schreibst du');
      result = result.replace(/\brufen du\b/g, 'rufst du');
      result = result.replace(/\bgeben du\b/g, 'gibst du');
      result = result.replace(/\bnehmen du\b/g, 'nimmst du');
      result = result.replace(/\blesen du\b/g, 'liest du');

      // D3) Lowercase pronouns mid-sentence (". Dein" stays, but "für Deine" → "für deine")
      // After sentence boundaries or line starts: keep uppercase
      // Mid-sentence (after lowercase word + space): lowercase Dein/Deine/Dir etc.
      result = result.replace(/(\b(?:du|f\u00FCr|zu|mit|auf|an|in|um|von|bei|aus|nach|vor|bis|\u00FCber|unter|zwischen|durch|gegen|ohne|wegen|trotz|seit|und|oder|aber|dass|ob|weil|wenn|als|wie|auch|noch|schon|mal|bitte|vielen|herzlichen)\s+)(D)(ein\b|eine\b|einem\b|einen\b|einer\b|ir\b)/g,
        (m, prefix, d, suffix) => prefix + 'd' + suffix);

      // E) Closing formula: replace MfG → Liebe Grüße, append user first name AFTER
      if (userFirstName) {
        console.log('[HW24] PerDu: inserting', userFirstName, 'after closing formula');
        const hasMfG = /Mit freundlichen Gr\u00FC\u00DFen/.test(result);
        const hasLG = /Liebe Gr\u00FC\u00DFe/.test(result);
        const hasKR = /Kind regards/i.test(result);

        if (hasMfG) {
          result = result.replace(/Mit freundlichen Gr\u00FC\u00DFen/g,
            `Liebe Gr\u00FC\u00DFe<br>${userFirstName}`);
        } else if (hasLG) {
          result = result.replace(/Liebe Gr\u00FC\u00DFe/g,
            `Liebe Gr\u00FC\u00DFe<br>${userFirstName}`);
        }
        if (hasKR) {
          result = result.replace(/(Kind regards)/gi,
            `$1<br>${userFirstName}`);
        }
      } else {
        console.log('[HW24] PerDu: no user first name found, skipping signature personalization');
        result = result.replace(/Mit freundlichen Gr\u00FC\u00DFen/g, 'Liebe Gr\u00FC\u00DFe');
      }

      writeEmailHTML(body, result);
      perDuApplied = true;

      if (body.type === 'ckeditor') body.editor.fire('change');

      markButtonDone('hw24-email-perdu-btn', '\u2705 Per Du angewendet');
    }

    /* ── Danke: replace info request with thank-you sentence ── */
    function applyDanke() {
      const data = readEmailHTML();
      if (!data) { alert('E-Mail-Body nicht gefunden.'); return; }
      const { body, html } = data;

      // Decode HTML entities first (same as PerDu) so needle strings can match
      let result = html;
      result = result.replace(/&auml;/g, '\u00E4');
      result = result.replace(/&ouml;/g, '\u00F6');
      result = result.replace(/&uuml;/g, '\u00FC');
      result = result.replace(/&Auml;/g, '\u00C4');
      result = result.replace(/&Ouml;/g, '\u00D6');
      result = result.replace(/&Uuml;/g, '\u00DC');
      result = result.replace(/&szlig;/g, '\u00DF');
      result = result.replace(/&nbsp;/g, ' ');
      result = result.replace(/\u00A0/g, ' ');
      result = result.replace(/&#160;/g, ' ');

      const needle = 'haben Sie schon die ben\u00F6tigten Informationen f\u00FCr uns';
      const needleQ = needle + '?';
      // Also check du-form variant in case PerDu was already applied
      const needleDu = 'hast du schon die ben\u00F6tigten Informationen f\u00FCr uns';
      const needleDuQ = needleDu + '?';

      let found = false;
      const replSie = 'vielen Dank f\u00FCr Ihre Anfrage.';
      const replDu = 'vielen Dank f\u00FCr deine Anfrage.';

      // Try with question mark first (replace ? → .), then without
      if (result.includes(needleQ)) {
        result = result.replace(needleQ, perDuApplied ? replDu : replSie);
        found = true;
      } else if (result.includes(needle)) {
        result = result.replace(needle, perDuApplied ? replDu : replSie);
        found = true;
      } else if (result.includes(needleDuQ)) {
        result = result.replace(needleDuQ, replDu);
        found = true;
      } else if (result.includes(needleDu)) {
        result = result.replace(needleDu, replDu);
        found = true;
      }

      if (!found) {
        alert('Satz nicht gefunden: "' + needle + '"');
        return;
      }

      // Save original for undo
      saveForUndo(html, body.type);

      writeEmailHTML(body, result);

      // Notify CKEditor if applicable
      if (body.type === 'ckeditor') body.editor.fire('change');

      markButtonDone('hw24-email-danke-btn', '\u2705 Danke eingef\u00FCgt');
    }

    /* ── Insert commission into email body ── */
    async function insertCommission() {
      let totals = await MetaOverlay.calculateTotalsWithFallback();
      console.log('[HW24] Commission insert: first calculation result', {
        source: totals?._hw24Source || 'unknown',
        sumPC: totals?.sumPC,
        partnerCommission: totals?.partnerCommission
      });

      if (!(totals?.sumPC > 0) || !Number.isFinite(totals?.partnerCommission)) {
        console.log('[HW24] Commission insert: retry after injectTotalsPanel()');
        MetaOverlay.injectTotalsPanel();
        totals = await MetaOverlay.calculateTotalsWithFallback();
        console.log('[HW24] Commission insert: second calculation result', {
          source: totals?._hw24Source || 'unknown',
          sumPC: totals?.sumPC,
          partnerCommission: totals?.partnerCommission
        });
      }
      if (!(totals?.sumPC > 0) || !Number.isFinite(totals?.partnerCommission)) {
        console.warn('[HW24] Commission insert: aborting, no valid totals available');
        alert('Provision kann aktuell nicht berechnet werden. Bitte Kalkulation neu laden.');
        return;
      }

      const data = readEmailHTML();
      if (!data) {
        alert('E-Mail-Body nicht gefunden. Bitte pr\u00FCfen Sie, ob der E-Mail-Editor geladen ist.');
        return;
      }
      const { body, html } = data;

      saveForUndo(html, body.type);

      const lang = detectLanguage(html);
      const commissionText = buildCommissionText(totals.partnerCommission, lang);

      let inserted = false;

      if (body.type === 'textarea') {
        const anchorMatch = findInsertIndexByRegexes(html, getAnchorRegexes(lang));
        const signatureMatch = findInsertIndexByRegexes(html, getSignatureRegexes());
        const target = anchorMatch || signatureMatch;

        if (target) {
          const before = html.substring(0, target.index);
          const after = html.substring(target.index);
          body.el.value = before + commissionText + '\n\n' + after;
        } else {
          body.el.value = html + '\n\n' + commissionText;
        }
        fire(body.el);
        inserted = true;
      } else {
        let root;
        let ownerDoc;
        if (body.type === 'ckeditor') {
          const editable = body.editor.editable();
          root = editable ? editable.$ : null;
          ownerDoc = root ? root.ownerDocument : document;
        } else if (body.type === 'iframe') {
          root = body.doc.body;
          ownerDoc = body.doc;
        } else {
          root = body.el;
          ownerDoc = document;
        }

        if (root) {
          const bodyStyle = extractBodyStyle(html);
          const newP = ownerDoc.createElement('p');
          if (bodyStyle && bodyStyle.tag === 'font') {
            const font = ownerDoc.createElement('font');
            if (bodyStyle.face) font.setAttribute('face', bodyStyle.face);
            if (bodyStyle.size) font.setAttribute('size', bodyStyle.size);
            if (bodyStyle.color) font.setAttribute('color', bodyStyle.color);
            font.textContent = commissionText;
            newP.appendChild(font);
          } else if (bodyStyle && bodyStyle.style) {
            newP.setAttribute('style', bodyStyle.style);
            newP.textContent = commissionText;
          } else {
            newP.textContent = commissionText;
          }

          const anchorNode = findAnchorNode(root, lang);
          const signatureNode = findSignatureNode(root);
          const insertBeforeNode = anchorNode || signatureNode;

          if (insertBeforeNode) {
            const insertEl = insertBeforeNode.nodeType === Node.TEXT_NODE
              ? insertBeforeNode.parentElement : insertBeforeNode;
            const blockEl = insertEl.closest('p, div, tr, li, blockquote') || insertEl;
            blockEl.parentNode.insertBefore(newP, blockEl);
          } else {
            root.appendChild(newP);
          }

          if (body.type === 'ckeditor') {
            body.editor.fire('change');
          }
          inserted = true;
        }
      }

      if (inserted) {
        markButtonDone('hw24-email-commission-btn', '\u2705 Provision eingef\u00FCgt');
      }
    }

    /* ── Inject toolbar into the Compose Email container ── */
    function injectEmailToolbar(container) {
      if (!hasEmailToolbar) return;
      if (document.getElementById(TOOLBAR_ID)) return;
      console.log('[HW24] EMAILMakerTools: injecting toolbar into', container.className || container.id || container.tagName);

      const toolbar = document.createElement('div');
      toolbar.id = TOOLBAR_ID;
      toolbar.style.cssText = 'padding:8px 12px;background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border-bottom:1px solid #f59e0b;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;font-family:system-ui,-apple-system,sans-serif;z-index:1000;';

      const label = document.createElement('span');
      label.textContent = '\uD83D\uDCE7 E-Mail Tools:';
      label.style.cssText = 'font-weight:600;color:#92400e;margin-right:4px;';
      toolbar.appendChild(label);

      for (const cfg of getToolbarButtons()) {
        const btn = document.createElement('button');
        btn.id = cfg.id;
        btn.type = 'button';
        btn.textContent = cfg.label;
        btn.title = cfg.title || '';
        btn.style.cssText = 'padding:5px 12px;font-size:12px;background:#fff;color:#1e293b;border:1px solid #d97706;border-radius:4px;cursor:pointer;font-weight:500;transition:background 0.2s,border-color 0.2s;';
        if (cfg.hidden) btn.style.display = 'none';
        btn.onmouseenter = () => { if (!btn.disabled) { btn.style.background = '#fffbeb'; btn.style.borderColor = '#b45309'; } };
        btn.onmouseleave = () => { if (!btn.disabled) { btn.style.background = '#fff'; btn.style.borderColor = '#d97706'; } };
        btn.onclick = cfg.action;
        toolbar.appendChild(btn);
      }

      // Insert at top of modal-body, or before CKEditor toolbar, or as first child
      const modalBody = container.querySelector('.modal-body');
      if (modalBody) {
        // Inside modal-body: insert before the editor area
        const editorWrap = modalBody.querySelector('.cke, .cke_inner, .cke_top, #cke_description, #cke_email_body');
        if (editorWrap) {
          editorWrap.parentNode.insertBefore(toolbar, editorWrap);
        } else {
          modalBody.appendChild(toolbar);
        }
      } else {
        // Fallback: insert before CKEditor or at end of container
        const editorWrap = container.querySelector('.cke, #cke_description, #cke_email_body');
        if (editorWrap) {
          editorWrap.parentNode.insertBefore(toolbar, editorWrap);
        } else {
          container.appendChild(toolbar);
        }
      }
    }

    /* ── Find the Compose Email container (broad search) ── */
    function findComposeContainer() {
      // Try specific selectors first, then broader ones
      const selectors = [
        '#composeEmailContainer',
        '.SendEmailFormStep2',
        '.modelContainer',
        '.modal.in',
        '.modal.show',
        '[role="dialog"]'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        // Verify it actually contains a compose email form (CKEditor or subject field)
        if (el.querySelector('input[name="subject"], .cke, [id^="cke_"], textarea.ckEditorSource, .cke_editable')) {
          return el;
        }
      }
      return null;
    }

    /* ── Check if the Compose Email form is present and ready ── */
    function tryInjectToolbar() {
      if (!hasEmailToolbar) return;
      if (document.getElementById(TOOLBAR_ID)) return;

      const container = findComposeContainer();
      if (!container) return;

      injectEmailToolbar(container);
    }

    /* ── MutationObserver to detect EMAILMaker Compose Email popup ── */
    function init() {
      console.log('[HW24] EMAILMakerTools: init for', currentModule);

      const scheduleRetries = () => {
        setTimeout(() => { injectContactMetaBadge(); tryApplyStep1Language(); }, 200);
        setTimeout(() => { injectContactMetaBadge(); tryApplyStep1Language(); }, 500);
        setTimeout(tryInjectToolbar, 300);
        setTimeout(() => { injectContactMetaBadge(); tryApplyStep1Language(); }, 900);
        setTimeout(tryInjectToolbar, 800);
        setTimeout(() => { injectContactMetaBadge(); tryApplyStep1Language(); }, 1500);
        setTimeout(tryInjectToolbar, 1500);
        setTimeout(tryInjectToolbar, 3000);
        setTimeout(() => { injectContactMetaBadge(); tryApplyStep1Language(); }, 3200);
        setTimeout(tryInjectToolbar, 5000);
      };

      injectContactMetaBadge();
      tryApplyStep1Language();

      const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;

            // Direct match: the added node is a compose container or modal
            const isCompose = node.id === 'composeEmailContainer'
              || node.classList?.contains('SendEmailFormStep2')
              || node.classList?.contains('modelContainer')
              || node.matches?.('.modal, [role="dialog"]');

            // Or it contains a compose container
            const hasCompose = !isCompose && (
              node.querySelector?.('#composeEmailContainer, .SendEmailFormStep2, .cke, [id^="cke_"]')
            );

            if (isCompose || hasCompose) {
              scheduleRetries();
            }
          }

          // Also check attribute changes (e.g. modal becoming visible via class change)
          if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
            const t = mutation.target;
            if (t.id === 'composeEmailContainer' || t.classList?.contains('SendEmailFormStep2')
              || t.classList?.contains('modal') || t.classList?.contains('modelContainer')) {
              scheduleRetries();
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

      // Fallback: periodic poll every 2s (catches edge cases the observer misses)
      const poll = setInterval(() => {
        injectContactMetaBadge();
        tryApplyStep1Language();
        if (hasEmailToolbar && document.getElementById(TOOLBAR_ID)) return;
        tryInjectToolbar();
      }, 2000);
      // Stop polling after 10 minutes
      setTimeout(() => clearInterval(poll), 600000);
    }

    return { init };
  })();

  /* ═══════════════════════════════════════════════════════════════════════════
     BOOTSTRAP
     ═══════════════════════════════════════════════════════════════════════════ */

  injectStyles();

  if (isEdit && isLineItemModule) {
    await MetaOverlay.processEdit();
    MetaOverlay.injectTotalsPanel();
    MetaOverlay.injectReloadButton();
    MetaOverlay.interceptSaveButton();

    const rerun = debounce(async () => {
      await MetaOverlay.processEdit();
      MetaOverlay.injectTotalsPanel();
    }, 700);

    const tbl = document.querySelector('#lineItemTab');
    if (tbl) new MutationObserver(rerun).observe(tbl, { childList: true, subtree: true });

    // SN Reconcile
    SNReconcile.init();

    // Price Multiplier
    PriceMultiplier.init();
  }

  if (isDetail && isLineItemModule) {
    const initDetail = async () => {
      let tbl = MetaOverlay.findLineItemTable();
      if (!tbl) tbl = await MetaOverlay.waitForElement('#lineItemTab, .lineItemsTable, .lineItemTab, [id*="lineItem"], .inventoryTable', 5000);
      if (tbl) {
        await MetaOverlay.processDetail();
        MetaOverlay.injectTotalsPanel();
        MetaOverlay.injectReloadButton();

        const rerunD = debounce(async () => {
          await MetaOverlay.processDetail();
          MetaOverlay.injectTotalsPanel();
        }, 700);

        new MutationObserver(rerunD).observe(tbl, { childList: true, subtree: true });
      }
    };

    await initDetail();
    if (document.readyState !== 'complete') window.addEventListener('load', () => setTimeout(initDetail, 1000));
    setTimeout(initDetail, 2000);

  }

  // EMAILMaker Tools (MutationObserver for modal detection)
  // Runs on detail view for Quotes, SalesOrder, Potentials
  if (isDetail) {
    EMAILMakerTools.init();
  }

})();
