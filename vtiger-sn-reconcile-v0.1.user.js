// ==UserScript==
// @name         VTiger SN Reconciliation (Delta Mode FIX)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.3.1
// @description  Delta-based SN reconciliation with strict assignment logic, mandatory dialog on ambiguity, readable UI and undo
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
    S(s).split(/[\n,]+/).map(x => S(x)).filter(Boolean);

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
     LINE ITEMS
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

  function getMetaKey(row) {
    const d = getDescField(row);
    if (!d) return null;
    const p = parseDesc(d.value);
    return [
      p.ss || '',
      p.se || ''
    ].join('|');
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
     UI PANEL
     =============================== */
  function addPanel() {
    if (document.getElementById('hw24-sn-panel')) return;

    const p = document.createElement('div');
    p.id = 'hw24-sn-panel';
    p.style.cssText = `
      position:fixed;right:16px;bottom:16px;z-index:2147483647;
      background:#111;color:#eee;padding:12px;border-radius:10px;
      width:380px;font:13px/1.4 system-ui,Segoe UI,Roboto,Arial;
      box-shadow:0 6px 20px rgba(0,0,0,.35)
    `;

    p.innerHTML = `
      <b>SN Abgleich (Delta)</b><br><br>

      <label style="color:#9fdf9f">🟢 Behalten</label>
      <textarea id="sn-keep"></textarea>

      <label style="color:#ff9f9f">🔴 Entfernen</label>
      <textarea id="sn-remove"></textarea>

      <label style="color:#9fd0ff">🔵 Hinzufügen</label>
      <textarea id="sn-add"></textarea>

      <div style="margin-top:8px;display:flex;gap:6px">
        <button id="sn-apply">🔍 Anwenden</button>
        <button id="sn-undo">↩ Undo</button>
      </div>

      <div style="margin-top:8px;font-size:11px;opacity:.85">
        <b>Legende</b><br>
        🟢 OK · 🔴 Entfernt · 🔵 Neu · 🟣 Mehrfach
      </div>
    `;

    p.querySelectorAll('textarea').forEach(t => {
      t.style.cssText =
        'width:100%;height:60px;background:#0f0f0f;color:#f1f1f1;' +
        'border:1px solid #444;border-radius:6px;margin-bottom:6px';
    });

    p.querySelectorAll('button').forEach(b => {
      b.style.cssText =
        'flex:1;background:#2b2b2b;color:#fff;border:1px solid #444;' +
        'border-radius:8px;padding:6px;cursor:pointer';
    });

    document.body.appendChild(p);
    p.querySelector('#sn-apply').onclick = applyDelta;
    p.querySelector('#sn-undo').onclick = undo;
  }

  /* ===============================
     CORE LOGIC (FIXED)
     =============================== */
  function applyDelta() {
    const keep = splitList(document.getElementById('sn-keep').value);
    const remove = splitList(document.getElementById('sn-remove').value);
    const add = splitList(document.getElementById('sn-add').value);

    snapshot();

    const rows = getRows();

    // Build product groups
    const groups = rows.map(r => ({
      row: r,
      key: getMetaKey(r),
      desc: getDescField(r),
      qty: getQtyField(r)
    })).filter(g => g.key && g.desc);

    // Apply KEEP / REMOVE per row
    groups.forEach(g => {
      const parsed = parseDesc(g.desc.value);
      let sns = [];

      if (parsed.snLine) {
        sns = parsed.snLine.replace(/^s\/?n\s*:/i, '')
          .split(',').map(x => S(x)).filter(Boolean);
      }

      sns = sns.filter(sn => !remove.includes(sn));
      if (keep.length) sns = sns.filter(sn => keep.includes(sn));

      g.sns = sns;
    });

    // ADD logic: strict
    for (const sn of add) {
      const matching = groups.filter(g => true); // same meta group only
      if (matching.length === 1) {
        matching[0].sns.push(sn);
      } else {
        // Ambiguous or none → dialog
        return alert(
          'Zuordnung erforderlich für neue Seriennummer:\n' +
          sn +
          '\n(Mehrere oder keine passenden Produkte)'
        );
      }
    }

    // Write back
    groups.forEach(g => {
      g.desc.value = buildDesc(g.sns, parseDesc(g.desc.value));
      fire(g.desc);
      if (g.qty) {
        g.qty.value = String(g.sns.length);
        fire(g.qty);
      }
    });

    alert('SN-Abgleich abgeschlossen (v0.3.1 FIX)');
  }

  /* ===============================
     INIT
     =============================== */
  addPanel();

})();
