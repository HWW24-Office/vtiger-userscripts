// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      1.1.0
// @description  Serial number reconciliation with modern UI - add, remove, reassign SNs across line items
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  /* =============================
     GUARD
     ============================= */
  if (
    !location.href.includes('view=Edit') ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* =============================
     Utilities
     ============================= */
  const $ = id => document.getElementById(id);
  const S = s => (s || '').toString().trim();
  const norm = s => S(s).toUpperCase().replace(/\s+/g, '');
  const uniq = a => [...new Set(a)];
  const parseList = t =>
    uniq(S(t).split(/[\n,;]+/).map(norm).filter(Boolean));
  const fire = el =>
    el && ['input', 'change', 'blur'].forEach(e =>
      el.dispatchEvent(new Event(e, { bubbles: true }))
    );

  /* =============================
     META FETCH
     ============================= */

  const metaCache = new Map();

  async function fetchProductMeta(productId) {
    if (!productId) return {};
    if (metaCache.has(productId)) return metaCache.get(productId);

    try {
      const url = `index.php?module=Products&view=Detail&record=${productId}`;
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
        productName: getVal('product name') || getVal('produktname') || getVal('product'),
        productNo: productNo,
        sla: getVal('sla'),
        duration: getVal('duration'),
        country: getVal('country')
      };

      metaCache.set(productId, meta);
      return meta;
    } catch {
      return {};
    }
  }

  /* =============================
     Runtime from description
     ============================= */

  function extractRuntime(desc) {
    const s = desc.match(/Service Start\s*:\s*([0-9.\-]+)/i);
    const e = desc.match(/Service Ende?\s*:\s*([0-9.\-]+)/i);
    if (s && e) return `${s[1]} → ${e[1]}`;
    return '—';
  }

  /* =============================
     Line Items
     ============================= */

  function getLineItems() {
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')]
      .map(tr => {
        const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');

        const descEl =
          tr.querySelector('textarea[name*="comment"], textarea[name*="description"]');
        const qtyEl = tr.querySelector('input[name^="qty"]');
        const desc = S(descEl?.value);

        const m = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
        const sns = m ? parseList(m[1]) : [];

        const productId =
          tr.querySelector(`input[name="hdnProductId${rn}"]`)?.value ||
          tr.querySelector('input[name^="hdnProductId"]')?.value ||
          '';

        // Produktname aus dem DOM holen
        const nameEl = tr.querySelector(`#productName${rn}`) ||
          tr.querySelector('input[id^="productName"]') ||
          tr.querySelector('a[href*="module=Products"]');
        const productName = nameEl?.value || nameEl?.textContent || '';

        return {
          rn,
          tr,
          descEl,
          qtyEl,
          desc,
          sns,
          productId,
          productName: S(productName),
          runtime: extractRuntime(desc),
          meta: null
        };
      });
  }

  /* =============================
     STYLES
     ============================= */

  const STYLES = `
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
    #hw24-sn-panel.visible {
      display: block;
    }

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
    #hw24-sn-panel .panel-header button:hover {
      color: #fff;
    }

    #hw24-sn-panel .panel-body {
      padding: 16px;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }

    #hw24-sn-panel .section {
      margin-bottom: 16px;
    }
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
    #hw24-sn-panel .sn-tag .remove-btn {
      cursor: pointer;
      opacity: 0.6;
      font-size: 12px;
    }
    #hw24-sn-panel .sn-tag .remove-btn:hover {
      opacity: 1;
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
    #hw24-sn-panel .btn-primary {
      background: #3b82f6;
      color: #fff;
    }
    #hw24-sn-panel .btn-primary:hover {
      background: #2563eb;
    }
    #hw24-sn-panel .btn-secondary {
      background: #e2e8f0;
      color: #475569;
    }
    #hw24-sn-panel .btn-secondary:hover {
      background: #cbd5e1;
    }
    #hw24-sn-panel .btn-danger {
      background: #ef4444;
      color: #fff;
    }
    #hw24-sn-panel .btn-danger:hover {
      background: #dc2626;
    }
    #hw24-sn-panel .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #hw24-sn-panel .status-msg {
      margin-top: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 12px;
    }
    #hw24-sn-panel .status-msg.success {
      background: #dcfce7;
      color: #166534;
    }
    #hw24-sn-panel .status-msg.warning {
      background: #fef3c7;
      color: #92400e;
    }
    #hw24-sn-panel .status-msg.error {
      background: #fee2e2;
      color: #991b1b;
    }

    /* Reconciliation Results */
    #hw24-sn-panel .result-group {
      margin-bottom: 12px;
    }
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
    #hw24-sn-panel .result-header.matching {
      background: #dcfce7;
      color: #166534;
    }
    #hw24-sn-panel .result-header.to-remove {
      background: #fee2e2;
      color: #991b1b;
    }
    #hw24-sn-panel .result-header.missing {
      background: #fef3c7;
      color: #92400e;
    }
    #hw24-sn-panel .result-header .count {
      margin-left: auto;
      font-weight: 700;
    }
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
    #hw24-sn-panel .result-sn.matching {
      background: #bbf7d0;
      color: #166534;
    }
    #hw24-sn-panel .result-sn.to-remove {
      background: #fecaca;
      color: #991b1b;
    }
    #hw24-sn-panel .result-sn.missing {
      background: #fde68a;
      color: #92400e;
    }
    #hw24-sn-panel .result-position {
      font-size: 10px;
      color: #64748b;
      margin-left: 4px;
    }
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

    /* Add Dialog */
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
    #hw24-sn-dialog .sn-checkbox:hover {
      background: #e2e8f0;
    }
    #hw24-sn-dialog .sn-checkbox.selected {
      background: #dbeafe;
      border-color: #3b82f6;
    }

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
    #hw24-sn-dialog .target-item:hover {
      border-color: #94a3b8;
    }
    #hw24-sn-dialog .target-item.selected {
      border-color: #3b82f6;
      background: #eff6ff;
    }
    #hw24-sn-dialog .target-item-name {
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 4px;
    }
    #hw24-sn-dialog .target-item-meta {
      font-size: 11px;
      color: #64748b;
    }
  `;

  /* =============================
     STATE
     ============================= */

  let panelVisible = false;
  let SNAPSHOT = null;

  // Reconciliation results
  let reconcileResult = null; // { matching: [], toRemove: [], missing: [] }

  /* =============================
     INJECT STYLES & UI
     ============================= */

  function injectStyles() {
    if ($('hw24-sn-styles')) return;
    const style = document.createElement('style');
    style.id = 'hw24-sn-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

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

    // Event listeners
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
      if (panelVisible) {
        reconcileResult = null;
        performReconcile(); // Shows current overview
      }
    }
  }

  /* =============================
     RECONCILIATION LOGIC
     ============================= */

  async function performReconcile() {
    const resultsContainer = $('hw24-sn-results');
    const actionsContainer = $('hw24-sn-actions');
    if (!resultsContainer) return;

    // Get SOLL list from textarea
    const sollText = S($('hw24-sn-soll')?.value);
    const sollList = parseList(sollText);

    // Get current items and their SNs (IST)
    const items = getLineItems();

    // Fetch meta for better display
    for (const it of items) {
      if (!it.meta && it.productId) {
        it.meta = await fetchProductMeta(it.productId);
      }
    }

    // Build IST index: SN -> position info
    const istIndex = new Map();
    items.forEach(it => {
      const meta = it.meta || {};
      const displayName = meta.productName || it.productName || `Pos ${it.rn}`;
      it.sns.forEach(sn => {
        istIndex.set(sn, { sn, position: displayName, item: it });
      });
    });

    const istSNs = new Set(istIndex.keys());
    const sollSNs = new Set(sollList);

    // Calculate differences
    const matching = []; // In both IST and SOLL
    const toRemove = []; // In IST but not in SOLL
    const missing = [];  // In SOLL but not in IST

    // Check IST against SOLL
    for (const [sn, info] of istIndex) {
      if (sollSNs.has(sn)) {
        matching.push({ sn, position: info.position });
      } else {
        toRemove.push({ sn, position: info.position });
      }
    }

    // Check SOLL against IST
    for (const sn of sollList) {
      if (!istSNs.has(sn)) {
        missing.push({ sn });
      }
    }

    // Store result for apply
    reconcileResult = { matching, toRemove, missing, items };

    // Show results
    resultsContainer.style.display = 'block';
    actionsContainer.style.display = (toRemove.length > 0 || missing.length > 0) ? 'flex' : 'none';

    // If no SOLL list provided, show current overview
    if (sollList.length === 0) {
      resultsContainer.innerHTML = `
        <div class="summary-box">
          <div style="font-weight:600;margin-bottom:8px;">Aktueller Stand</div>
          <div class="summary-row">
            <span>Positionen:</span>
            <span>${items.length}</span>
          </div>
          <div class="summary-row">
            <span>Seriennummern gesamt:</span>
            <span>${istSNs.size}</span>
          </div>
        </div>
        <div style="color:#64748b;font-size:12px;text-align:center;padding:10px;">
          Füge die Soll-Liste vom Kunden ein und klicke "Abgleichen"
        </div>
      `;
      actionsContainer.style.display = 'none';
      return;
    }

    // Build results HTML
    let html = `
      <div class="summary-box">
        <div class="summary-row">
          <span>✓ Übereinstimmend:</span>
          <span style="color:#166534">${matching.length}</span>
        </div>
        <div class="summary-row">
          <span>✗ Zu entfernen (nicht in Soll):</span>
          <span style="color:#991b1b">${toRemove.length}</span>
        </div>
        <div class="summary-row">
          <span>⚠ Fehlend (nicht im Angebot):</span>
          <span style="color:#92400e">${missing.length}</span>
        </div>
        <div class="summary-row total">
          <span>Soll-Liste:</span>
          <span>${sollList.length} SNs</span>
        </div>
      </div>
    `;

    // Matching section
    if (matching.length > 0) {
      html += `
        <div class="result-group">
          <div class="result-header matching">
            <span>✓ Übereinstimmend</span>
            <span class="count">${matching.length}</span>
          </div>
          <div class="result-sns">
            ${matching.map(m => `
              <span class="result-sn matching">${m.sn}<span class="result-position">${m.position}</span></span>
            `).join('')}
          </div>
        </div>
      `;
    }

    // To Remove section
    if (toRemove.length > 0) {
      html += `
        <div class="result-group">
          <div class="result-header to-remove">
            <span>✗ Werden entfernt</span>
            <span class="count">${toRemove.length}</span>
          </div>
          <div class="result-sns">
            ${toRemove.map(m => `
              <span class="result-sn to-remove">${m.sn}<span class="result-position">${m.position}</span></span>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Missing section
    if (missing.length > 0) {
      html += `
        <div class="result-group">
          <div class="result-header missing">
            <span>⚠ Fehlen im Angebot</span>
            <span class="count">${missing.length}</span>
          </div>
          <div class="result-sns">
            ${missing.map(m => `
              <span class="result-sn missing">${m.sn}</span>
            `).join('')}
          </div>
          <div style="font-size:11px;color:#92400e;margin-top:6px;padding-left:8px;">
            Diese SNs sind in der Kundenliste, aber nicht im Angebot!
          </div>
        </div>
      `;
    }

    resultsContainer.innerHTML = html;
  }

  /* =============================
     APPLY CHANGES
     ============================= */

  async function applyChanges() {
    if (!reconcileResult) {
      showStatus('error', 'Bitte zuerst Abgleich durchführen');
      return;
    }

    const items = getLineItems();

    // Create snapshot for undo
    SNAPSHOT = items.map(it => ({
      rn: it.rn,
      desc: it.descEl?.value,
      qty: it.qtyEl?.value
    }));
    $('hw24-sn-undo').disabled = false;

    // Get SNs to remove from reconcile result
    const toRemoveSet = new Set(reconcileResult.toRemove.map(r => r.sn));

    // Get missing SNs that need to be added
    const missingSNs = reconcileResult.missing.map(m => m.sn);

    // Remove marked SNs
    items.forEach(it => {
      it.sns = it.sns.filter(sn => !toRemoveSet.has(sn));
    });

    // Function to write back changes
    const writeBack = () => {
      items.forEach(it => {
        if (!it.descEl) return;

        const snLine = it.sns.length ? `S/N: ${it.sns.join(', ')}` : '';
        const rest = it.desc.replace(/S\/N\s*:[^\n\r]+/i, '').trim();
        it.descEl.value = [snLine, rest].filter(Boolean).join('\n');
        fire(it.descEl);

        if (it.qtyEl && it.sns.length > 0) {
          it.qtyEl.value = it.sns.length;
          fire(it.qtyEl);
        }
      });

      // Clear state
      reconcileResult = null;
      if ($('hw24-sn-soll')) $('hw24-sn-soll').value = '';
      $('hw24-sn-results').style.display = 'none';
      $('hw24-sn-actions').style.display = 'none';

      showStatus('success', `✓ ${toRemoveSet.size} SN(s) entfernt`);
    };

    // If there are missing SNs, open dialog to add them
    if (missingSNs.length > 0) {
      // Fetch meta for dialog
      for (const it of items) {
        if (!it.meta && it.productId) {
          it.meta = await fetchProductMeta(it.productId);
        }
      }
      openAddDialog(missingSNs, items, writeBack);
    } else {
      writeBack();
    }
  }

  function undoChanges() {
    if (!SNAPSHOT) return;

    SNAPSHOT.forEach(s => {
      const tr = document.getElementById('row' + s.rn) ||
        document.querySelector(`tr[data-row-num="${s.rn}"]`);
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

  /* =============================
     ADD DIALOG
     ============================= */

  function openAddDialog(snList, items, onDone) {
    // Remove existing dialog
    $('hw24-sn-dialog')?.remove();

    let remaining = [...snList];
    let selectedSNs = new Set();
    let selectedTarget = null;

    const dialog = document.createElement('div');
    dialog.id = 'hw24-sn-dialog';

    function render() {
      dialog.innerHTML = `
        <div class="dialog-box">
          <div class="dialog-header">
            Neue Seriennummern zuordnen
            ${remaining.length > 0 ? `(${remaining.length} übrig)` : ''}
          </div>
          <div class="dialog-body">
            ${remaining.length === 0 ? `
              <div style="text-align:center;padding:20px;color:#16a34a;">
                <div style="font-size:32px;margin-bottom:8px;">✓</div>
                <div>Alle Seriennummern wurden zugeordnet!</div>
              </div>
            ` : `
              <div style="margin-bottom:16px;">
                <div style="font-weight:600;margin-bottom:8px;">1. Seriennummern auswählen:</div>
                <div class="sn-checkbox-list">
                  ${remaining.map(sn => `
                    <div class="sn-checkbox${selectedSNs.has(sn) ? ' selected' : ''}" data-sn="${sn}">
                      ${sn}
                    </div>
                  `).join('')}
                </div>
              </div>

              <div>
                <div style="font-weight:600;margin-bottom:8px;">2. Ziel-Position auswählen:</div>
                <div class="target-list">
                  ${items.map(it => {
                    const meta = it.meta || {};
                    const displayName = meta.productName || it.productName || `Position ${it.rn}`;
                    return `
                      <div class="target-item${selectedTarget === it.rn ? ' selected' : ''}" data-rn="${it.rn}">
                        <div class="target-item-name">${displayName}</div>
                        <div class="target-item-meta">
                          ${meta.sla ? `SLA: ${meta.sla} • ` : ''}
                          ${meta.duration ? `Duration: ${meta.duration} • ` : ''}
                          Laufzeit: ${it.runtime}
                          ${it.sns.length ? ` • Aktuelle SNs: ${it.sns.length}` : ''}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `}
          </div>
          <div class="dialog-footer">
            ${remaining.length > 0 ? `
              <button class="btn btn-secondary" id="hw24-dlg-cancel">Abbrechen</button>
              <button class="btn btn-primary" id="hw24-dlg-assign" ${selectedSNs.size === 0 || !selectedTarget ? 'disabled' : ''}>
                Zuordnen (${selectedSNs.size})
              </button>
            ` : `
              <button class="btn btn-primary" id="hw24-dlg-close">Schließen</button>
            `}
          </div>
        </div>
      `;

      // Event listeners
      dialog.querySelectorAll('.sn-checkbox').forEach(el => {
        el.onclick = () => {
          const sn = el.dataset.sn;
          if (selectedSNs.has(sn)) {
            selectedSNs.delete(sn);
          } else {
            selectedSNs.add(sn);
          }
          render();
        };
      });

      dialog.querySelectorAll('.target-item').forEach(el => {
        el.onclick = () => {
          selectedTarget = el.dataset.rn;
          render();
        };
      });

      const assignBtn = dialog.querySelector('#hw24-dlg-assign');
      if (assignBtn) {
        assignBtn.onclick = () => {
          const targetItem = items.find(it => it.rn === selectedTarget);
          if (targetItem && selectedSNs.size > 0) {
            selectedSNs.forEach(sn => {
              if (!targetItem.sns.includes(sn)) {
                targetItem.sns.push(sn);
              }
              remaining = remaining.filter(x => x !== sn);
            });
            selectedSNs.clear();
            selectedTarget = null;
            render();
          }
        };
      }

      const cancelBtn = dialog.querySelector('#hw24-dlg-cancel');
      if (cancelBtn) {
        cancelBtn.onclick = () => {
          dialog.remove();
        };
      }

      const closeBtn = dialog.querySelector('#hw24-dlg-close');
      if (closeBtn) {
        closeBtn.onclick = () => {
          dialog.remove();
          onDone();
        };
      }
    }

    render();
    document.body.appendChild(dialog);
  }

  /* =============================
     INIT
     ============================= */

  function init() {
    injectStyles();
    injectToggleButton();
    injectPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
