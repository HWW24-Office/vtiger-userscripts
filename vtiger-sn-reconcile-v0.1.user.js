// ==UserScript==
// @name         VTiger SN Reconciliation (Delta Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.3.0
// @description  Delta-based serial number reconciliation with keep/remove/add lists, guided assignment, auto quantity update and undo
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /* ===============================
     MODE CHECK
     =============================== */
  if (
    !location.href.includes('view=Edit') ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* ===============================
     UTILS
     =============================== */
  const S = s => (s || '').toString().trim();
  const splitList = s =>
    S(s)
      .split(/[\n,]+/)
      .map(x => S(x))
      .filter(Boolean);

  const fire = el =>
    el && ['input', 'change', 'blur'].forEach(e =>
      el.dispatchEvent(new Event(e, { bubbles: true }))
    );

  /* ===============================
     DESCRIPTION PARSER / BUILDER
     =============================== */
  function parseDesc(desc) {
    const lines = S(desc).split(/\r?\n/);
    let snLine = '';
    let ss = '';
    let se = '';
    const rest = [];

    for (const l of lines) {
      if (/^s\/?n\s*:/i.test(l)) snLine = l;
      else if (/^service\s*start\s*:/i.test(l)) ss = l;
      else if (/^service\s*(ende|end)\s*:/i.test(l)) se = l;
      else rest.push(l);
    }
    return { snLine, ss, se, rest };
  }

  function buildDesc(snList, parsed) {
    const out = [];
    if (snList.length) out.push('S/N: ' + snList.join(', '));
    out.push(...parsed.rest.filter(Boolean));
    if (parsed.ss) out.push(parsed.ss);
    if (parsed.se) out.push(parsed.se);
    return out.join('\n');
  }

  /* ===============================
     COLLECT LINE ITEMS
     =============================== */
  function getRows() {
    return [...document.querySelectorAll(
      'tr.lineItemRow[id^="row"],tr.inventoryRow'
    )];
  }

  function getDescField(row) {
    return (
      row.querySelector("textarea[name*='comment']") ||
      row.querySelector("textarea[name*='description']")
    );
  }

  function getQtyField(row) {
    return row.querySelector("input[name^='qty']");
  }

  /* ===============================
     UI PANEL
     =============================== */
  function addPanel() {
    if (document.getElementById('hw24-sn-panel')) return;

    const p = document.createElement('div');
    p.id = 'hw24-sn-panel';
    p.style.cssText = `
      position:fixed;
      right:16px;
      bottom:16px;
      z-index:2147483647;
      background:#111;
      color:#fff;
      padding:12px;
      border-radius:10px;
      width:360px;
      font:13px/1.4 system-ui,Segoe UI,Roboto,Arial;
      box-shadow:0 6px 20px rgba(0,0,0,.35)
    `;

    p.innerHTML = `
      <b>SN Abgleich (Delta)</b><br><br>

      <label>🟢 Behalten</label><br>
      <textarea id="sn-keep" style="width:100%;height:60px"></textarea><br>

      <label>🔴 Entfernen</label><br>
      <textarea id="sn-remove" style="width:100%;height:60px"></textarea><br>

      <label>🔵 Hinzufügen</label><br>
      <textarea id="sn-add" style="width:100%;height:60px"></textarea><br>

      <div style="margin-top:8px;display:flex;gap:6px">
        <button id="sn-apply">🔍 Anwenden</button>
        <button id="sn-undo">↩ Undo</button>
      </div>

      <div style="margin-top:8px;font-size:11px;opacity:.85">
        <b>Legende</b><br>
        🟢 OK · 🔴 Entfernt · 🔵 Neu · 🟣 Mehrfach
      </div>
    `;

    p.querySelectorAll('button').forEach(b => {
      b.style.cssText =
        'flex:1;background:#2b2b2b;color:#fff;border:1px solid #444;border-radius:8px;padding:6px;cursor:pointer';
    });

    document.body.appendChild(p);

    p.querySelector('#sn-apply').onclick = applyDelta;
    p.querySelector('#sn-undo').onclick = undo;
  }

  /* ===============================
     STATE (UNDO)
     =============================== */
  let SNAPSHOT = null;

  function snapshot() {
    SNAPSHOT = getRows().map(r => {
      const d = getDescField(r);
      const q = getQtyField(r);
      return {
        row: r,
        desc: d ? d.value : '',
        qty: q ? q.value : ''
      };
    });
  }

  function undo() {
    if (!SNAPSHOT) return alert('Kein Undo verfügbar');
    SNAPSHOT.forEach(s => {
      const d = getDescField(s.row);
      const q = getQtyField(s.row);
      if (d) { d.value = s.desc; fire(d); }
      if (q) { q.value = s.qty; fire(q); }
    });
    alert('Undo durchgeführt');
  }

  /* ===============================
     CORE LOGIC
     =============================== */
  function applyDelta() {
    const keep = splitList(document.getElementById('sn-keep').value);
    const remove = splitList(document.getElementById('sn-remove').value);
    const add = splitList(document.getElementById('sn-add').value);

    snapshot();

    const used = new Map(); // sn -> rows

    getRows().forEach(row => {
      const d = getDescField(row);
      if (!d) return;

      const parsed = parseDesc(d.value);
      let sns = [];

      if (parsed.snLine) {
        sns = parsed.snLine
          .replace(/^s\/?n\s*:/i, '')
          .split(',')
          .map(x => S(x))
          .filter(Boolean);
      }

      // REMOVE
      sns = sns.filter(sn => !remove.includes(sn));

      // KEEP filter (optional strictness)
      if (keep.length) {
        sns = sns.filter(sn => keep.includes(sn));
      }

      // Track duplicates
      sns.forEach(sn => {
        if (!used.has(sn)) used.set(sn, []);
        used.get(sn).push(row);
      });

      // ADD (only here if product exists)
      add.forEach(sn => {
        if (!sns.includes(sn)) sns.push(sn);
      });

      // Rebuild description
      const newDesc = buildDesc(sns, parsed);
      d.value = newDesc;
      fire(d);

      // Quantity = SN count (simple rule)
      const q = getQtyField(row);
      if (q) {
        q.value = String(sns.length || 0);
        fire(q);
      }
    });

    // WARN duplicates
    const multi = [...used.entries()].filter(([, r]) => r.length > 1);
    if (multi.length) {
      alert(
        'Warnung:\nSeriennummern mehrfach verwendet:\n' +
        multi.map(([sn]) => sn).join(', ')
      );
    } else {
      alert('SN-Abgleich abgeschlossen');
    }
  }

  /* ===============================
     INIT
     =============================== */
  addPanel();

})();
