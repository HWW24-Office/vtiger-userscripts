// ==UserScript==
// @name         VTiger LineItem Tools (Unified)
// @namespace    hw24.vtiger.lineitem.tools
// @version      2.3.0
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-tools.user.js
// @description  Unified LineItem tools: Meta Overlay, SN Reconciliation, Price Multiplier
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE / VIEW DETECTION
     ═══════════════════════════════════════════════════════════════════════════ */

  const SUPPORTED_MODULES = ['Quotes', 'SalesOrder', 'Invoice', 'PurchaseOrder', 'Products'];
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

    function applyAllFixes(desc) {
      return fixServiceDates(fixSerialFormat(fixLiteralNewlines(desc)));
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

      const marginBeforeDiscount = itemsTotal - sumPC;
      const marginBeforeDiscountPct = sumPC ? (marginBeforeDiscount / sumPC * 100) : 0;
      const effectiveTotal = itemsTotal - overallDiscount;
      const marginAfterDiscount = effectiveTotal - sumPC;
      const marginAfterDiscountPct = sumPC ? (marginAfterDiscount / sumPC * 100) : 0;

      // Partner-Provision: Standard 50%, konfigurierbar via localStorage
      const commissionPct = parseFloat(localStorage.getItem('hw24-commission-pct') || '50');
      const partnerCommission = marginAfterDiscount * (commissionPct / 100);

      return { sumPC, itemsTotal, overallDiscount, marginBeforeDiscount, marginBeforeDiscountPct, effectiveTotal, marginAfterDiscount, marginAfterDiscountPct, partnerCommission, commissionPct };
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

    function validateTaxSettings() {
      if (!isEdit) return null;
      const billingCountry = getBillingCountry();
      const taxRegion = getTaxRegion();
      const reverseCharge = getReverseCharge();
      const subjectType = getSubjectType();
      const issues = [];

      const taxRegionLower = taxRegion.toLowerCase();
      const isAustriaTaxRegion = taxRegionLower.includes('austria');
      const isGermanyTaxRegion = taxRegionLower.includes('germany');
      const isEUTaxRegion = taxRegionLower === 'eu';
      const isNonEUTaxRegion = taxRegionLower.includes('non-eu');

      const billingIsAustria = isAustria(billingCountry);
      const billingIsGermany = isGermany(billingCountry);
      const billingIsEU = !billingIsAustria && !billingIsGermany && isEUCountry(billingCountry);
      const billingIsNonEU = billingCountry && !billingIsAustria && !billingIsGermany && !billingIsEU;

      if (['Quotes', 'SalesOrder', 'Invoice'].includes(currentModule)) {
        if (billingIsAustria) {
          if (reverseCharge) {
            issues.push({ type: 'error', message: '⚠️ Reverse Charge ist aktiviert, aber Billing Country ist Österreich!', fix: () => setReverseCharge(false), fixLabel: 'Reverse Charge deaktivieren' });
          }
          if (taxRegion && !isAustriaTaxRegion) {
            issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Austria" sein für Billing Country Österreich.`, fix: () => setTaxRegion('Austria'), fixLabel: 'Tax Region → Austria' });
          }
        } else if (billingIsGermany) {
          if (subjectType === 'wartung') {
            if (taxRegion && !isGermanyTaxRegion && !isEUTaxRegion) {
              issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Germany (19%)" oder "EU" sein für Deutschland + Wartung.`, fix: () => setTaxRegion('Germany'), fixLabel: 'Tax Region → Germany (19%)' });
            }
            if (reverseCharge && isGermanyTaxRegion) {
              issues.push({ type: 'error', message: '⚠️ Reverse Charge ist aktiviert, aber Tax Region ist Germany. Für Reverse Charge "EU" wählen.', fix: () => setTaxRegion('EU'), fixLabel: 'Tax Region → EU' });
            }
          } else {
            if (reverseCharge) {
              issues.push({ type: 'error', message: '⚠️ Reverse Charge ist aktiviert, aber Billing Country ist Deutschland (Handel)!', fix: () => setReverseCharge(false), fixLabel: 'Reverse Charge deaktivieren' });
            }
            if (taxRegion && !isGermanyTaxRegion) {
              issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Germany (19%)" sein für Billing Country Deutschland.`, fix: () => setTaxRegion('Germany'), fixLabel: 'Tax Region → Germany (19%)' });
            }
          }
        } else if (billingIsEU) {
          if (taxRegion && !isEUTaxRegion) {
            issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "EU" sein für Billing Country ${billingCountry}.`, fix: () => setTaxRegion('EU'), fixLabel: 'Tax Region → EU' });
          }
        } else if (billingIsNonEU) {
          if (taxRegion && !isNonEUTaxRegion) {
            issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Non-EU" sein für Billing Country ${billingCountry}.`, fix: () => setTaxRegion('Non-EU'), fixLabel: 'Tax Region → Non-EU' });
          }
        }

        if (!billingCountry) {
          if (reverseCharge && isAustriaTaxRegion) {
            issues.push({ type: 'error', message: '⚠️ Reverse Charge + Tax Region Austria ist nicht erlaubt. Bitte Billing Country prüfen!', fix: () => setReverseCharge(false), fixLabel: 'Reverse Charge deaktivieren' });
          }
          if (reverseCharge && isGermanyTaxRegion) {
            issues.push({ type: 'error', message: '⚠️ Reverse Charge + Tax Region Germany ist nicht erlaubt. Bitte Billing Country prüfen!', fix: () => setReverseCharge(false), fixLabel: 'Reverse Charge deaktivieren' });
          }
        }
      }

      if (currentModule === 'PurchaseOrder') {
        if (billingIsAustria && taxRegion && !isAustriaTaxRegion) {
          issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Austria" sein für Billing Country Österreich.`, fix: () => setTaxRegion('Austria'), fixLabel: 'Tax Region → Austria' });
        } else if (billingIsGermany) {
          if (subjectType === 'wartung' && taxRegion && !isEUTaxRegion) {
            issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "EU" sein für Deutschland + Wartung (W/WV).`, fix: () => setTaxRegion('EU'), fixLabel: 'Tax Region → EU' });
          } else if (subjectType === 'handel' && taxRegion && !isGermanyTaxRegion) {
            issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Germany (19%)" sein für Deutschland + Handel (H).`, fix: () => setTaxRegion('Germany'), fixLabel: 'Tax Region → Germany (19%)' });
          }
        } else if (billingIsEU && taxRegion && !isEUTaxRegion) {
          issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "EU" sein für Billing Country ${billingCountry}.`, fix: () => setTaxRegion('EU'), fixLabel: 'Tax Region → EU' });
        } else if (billingIsNonEU && taxRegion && !isNonEUTaxRegion) {
          issues.push({ type: 'error', message: `⚠️ Tax Region ist "${taxRegion}", sollte aber "Non-EU" sein für Billing Country ${billingCountry}.`, fix: () => setTaxRegion('Non-EU'), fixLabel: 'Tax Region → Non-EU' });
        }
      }

      return issues;
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
        btn.addEventListener('click', function (e) {
          if (skipValidation) { skipValidation = false; return; }

          const issues = validateTaxSettings();
          if (issues && issues.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            showTaxValidationPopup(issues,
              // Fix: Timeout auf 500ms erhöht für vtiger Tax-Rekalkulierung
              () => { issues.forEach(issue => issue.fix?.()); setTimeout(() => triggerSave(btn), 500); },
              () => { triggerSave(btn); }
            );
            return false;
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

    return { processEdit, processDetail, injectTotalsPanel, injectReloadButton, interceptSaveButton, waitForElement, findLineItemTable };
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

})();
