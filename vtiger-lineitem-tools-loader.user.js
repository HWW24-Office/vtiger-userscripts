// ==UserScript==
// @name         VTiger LineItem Tools (Loader)
// @namespace    hw24.vtiger.lineitem.tools.loader
// @version      1.0.0
// @description  Loader for VTiger LineItem Tools - loads latest version from GitHub
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_URL = 'https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-lineitem-tools.user.js';

  const script = document.createElement('script');
  script.src = SCRIPT_URL + '?t=' + Date.now(); // Cache-Busting
  script.type = 'text/javascript';
  script.onerror = () => console.error('[HW24 Loader] Failed to load vtiger-lineitem-tools.user.js');
  script.onload = () => console.log('[HW24 Loader] vtiger-lineitem-tools.user.js loaded successfully');
  document.head.appendChild(script);
})();
