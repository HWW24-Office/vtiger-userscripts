// ==UserScript==
// @name         VTiger Product Number Tools
// @namespace    hw24.vtiger.product.numbertools
// @version      1.0.2
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-product-number-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-product-number-tools.user.js
// @description  Bulk multiply/divide Purchase Cost, Unit Price and Duration in months with undo support
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (
    !location.href.includes('module=Products') ||
    !location.href.includes('view=Edit')
  ) return;

  const ID = 'vtNumToolsPanel';
  if (document.getElementById(ID)) return;

  const TARGET_SELECTORS = [
    '#Products-editview-fieldname-unit_price',
    'input[name="purchase_cost"]',
    'input[name="cf_1203"]'
  ];

  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const fire = e => e && ["input","change","blur"].forEach(t =>
    e.dispatchEvent(new Event(t, { bubbles: true }))
  );

  /* ===== CSS ===== */
  const css = `
#${ID}{position:fixed;z-index:999999;top:12px;right:12px;max-width:380px;background:#111;border:1px solid #444;color:#fff;font:13px/1.35 system-ui;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
#${ID} header{display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #333}
#${ID} button{cursor:pointer;border:1px solid #333;background:#1e1e1e;color:#fff;border-radius:8px;padding:6px 10px}
#${ID} .body{padding:10px}
#${ID} .row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:4px 6px;border:1px dashed #333;border-radius:8px;margin-bottom:8px}
#${ID} input[type="text"]{background:#0f0f0f;border:1px solid #2a2a2a;color:#eee;border-radius:6px;padding:4px 6px;width:100%}
#${ID} .foot{padding:10px;border-top:1px solid #333;display:flex;gap:6px;flex-wrap:wrap}
#${ID} .pill{font-size:11px;padding:3px 6px;border-radius:999px;border:1px solid #2a2a2a;background:#161616}
`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  /* ===== Panel ===== */
  const panel = document.createElement('div');
  panel.id = ID;
  panel.innerHTML = `
<header>
  <b>vtiger Number Tools</b>
  <button id="vtNTClose">✕</button>
</header>
<div class="body">
  <div id="vtNTList"></div>
</div>
<div class="foot">
  <input id="vtNTExpr" type="text" placeholder="z. B. *1.77 oder /2" style="width:150px">
  <button data-act="apply">Anwenden</button>
  <button data-act="undo">Undo</button>
  <span class="pill" id="vtNTInfo">0 geändert</span>
</div>`;
  document.body.appendChild(panel);
  document.getElementById('vtNTClose').onclick = () => panel.remove();

  /* ===== Felder sammeln ===== */
  const targets = TARGET_SELECTORS.flatMap(sel => $$(sel))
    .filter(el => el && !el.readOnly && !el.disabled);

  const items = [];
  const listEl = document.getElementById('vtNTList');

  targets.forEach(el => {
    const orig = el.value;

    const row = document.createElement('div');
    row.className = 'row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;

    const label = document.createElement('div');
    label.innerHTML = `<b>${el.name || el.id}</b><div style="font-size:11px;color:#bbb">${orig}</div>`;

    const peek = document.createElement('input');
    peek.type = 'text';
    peek.value = orig;

    row.append(cb, label, peek);
    listEl.appendChild(row);

    items.push({
      el,
      cb,
      peek,
      orig
    });
  });

  const info = document.getElementById('vtNTInfo');

  const parseExpr = s => {
    s = (s || '').trim().replace(',', '.');
    if (!s) return null;
    const div = s.startsWith('/');
    s = s.replace(/^[*/]/, '');
    const n = Number(s);
    return Number.isFinite(n) ? (div ? 1 / n : n) : null;
  };

  /* ===== Apply ===== */
  panel.querySelector('[data-act="apply"]').onclick = () => {
    const f = parseExpr(document.getElementById('vtNTExpr').value);
    if (f === null) return alert('Ungültiger Ausdruck');

    let changed = 0;
    items.forEach(it => {
      if (!it.cb.checked) return;
      const n = Number(it.el.value);
      if (!Number.isFinite(n)) return;
      const out = n * f;
      it.el.value = out;
      it.peek.value = out;
      fire(it.el);
      changed++;
    });
    info.textContent = `${changed} geändert`;
  };

  /* ===== Undo ===== */
  panel.querySelector('[data-act="undo"]').onclick = () => {
    let restored = 0;
    items.forEach(it => {
      if (!it.cb.checked) return;
      it.el.value = it.orig;
      it.peek.value = it.orig;
      fire(it.el);
      restored++;
    });
    info.textContent = `${restored} zurückgesetzt`;
  };
})();
