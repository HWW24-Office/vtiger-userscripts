// ==UserScript==
// @name         VTiger SalesOrder AutoFill (Loader)
// @namespace    hw24.salesorder.helper.loader
// @version      1.0.1
// @description  Loader for VTiger SalesOrder AutoFill - loads latest version from GitHub
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  const SCRIPT_URL = 'https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/salesorder-autofill.user.js';

  try {
    const response = await fetch(SCRIPT_URL + '?t=' + Date.now());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const code = await response.text();

    const blob = new Blob([code], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);

    const script = document.createElement('script');
    script.src = blobUrl;
    script.onload = () => {
      URL.revokeObjectURL(blobUrl);
      console.log('[HW24 Loader] salesorder-autofill.user.js loaded successfully');
    };
    script.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      console.error('[HW24 Loader] Failed to execute script');
    };
    document.head.appendChild(script);

  } catch (err) {
    console.error('[HW24 Loader] Failed to load salesorder-autofill.user.js:', err.message);
  }
})();
