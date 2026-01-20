// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.7.3-fix2
// @description  Guaranteed visible SN panel using DOMReady + MutationObserver
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /* =============================
     HARD GUARD: only Edit mode
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
  const norm = s => S(s).toUpperCase().replace(/\s+/g,'');
  const uniq = a => [...new Set(a)];
  const parseList = t => uniq(S(t).split(/[\n,;]+/).map(norm).filter(Boolean));
  const fire = el => el && ['input','change','blur'].forEach(e =>
    el.dispatchEvent(new Event(e,{bubbles:true}))
  );

  /* =============================
     PANEL CREATION (ISOLATED)
     ============================= */
  function createPanel(){
    if ($('hw24-sn-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'hw24-sn-panel';

    panel.style.cssText = `
      position: fixed !important;
      bottom: 20px !important;
      left: 20px !important;
      width: 360px !important;
      padding: 12px !important;
      background: #111 !important;
      color: #fff !important;
      border: 2px solid #ffcc00 !important;
      border-radius: 10px !important;
      box-shadow: 0 10px 30px rgba(0,0,0,.6) !important;
      z-index: 2147483647 !important;
      font-family: system-ui, Segoe UI, Roboto, Arial !important;
      font-size: 13px !important;
      pointer-events: auto !important;
    `;

    panel.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">
        🧪 SN-Abgleich (DEBUG PANEL)
      </div>

      <label>Behalten</label>
      <textarea id="sn-keep"
        style="width:100%;height:46px;margin-bottom:6px;
               background:#fff;color:#111;border:1px solid #444"></textarea>

      <label>Entfernen</label>
      <textarea id="sn-remove"
        style="width:100%;height:46px;margin-bottom:6px;
               background:#fff;color:#111;border:1px solid #444"></textarea>

      <label>Hinzufügen</label>
      <textarea id="sn-add"
        style="width:100%;height:46px;
               background:#fff;color:#111;border:1px solid #444"></textarea>

      <div style="margin-top:8px;display:flex;gap:6px">
        <button id="sn-preview"
          style="flex:1;background:#fff;color:#111;border:1px solid #444">Preview</button>
        <button id="sn-apply"
          style="flex:1;background:#fff;color:#111;border:1px solid #444">Apply</button>
        <button id="sn-undo"
          style="flex:1;background:#ddd;color:#111;border:1px solid #444" disabled>Undo</button>
      </div>

      <div id="sn-msg"
        style="margin-top:6px;color:#ffd966;font-size:12px"></div>
    `;

    document.body.appendChild(panel);
    console.info('[HW24 SN] Panel injected');
  }

  /* =============================
     ENSURE PANEL EXISTS
     ============================= */
  function ensurePanel(){
    createPanel();
    if (!$('hw24-sn-panel')) {
      console.warn('[HW24 SN] Panel missing – retrying');
      setTimeout(ensurePanel, 500);
    }
  }

  /* =============================
     MutationObserver (VTiger-safe)
     ============================= */
  const observer = new MutationObserver(() => {
    if (!$('hw24-sn-panel')) {
      console.warn('[HW24 SN] Panel removed by VTiger – reinjecting');
      createPanel();
    }
  });

  /* =============================
     INIT (DOM SAFE)
     ============================= */
  function init(){
    ensurePanel();
    observer.observe(document.body, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
