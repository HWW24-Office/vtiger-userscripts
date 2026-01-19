// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.5.0
// @description  SN-Abgleich mit Multi-Zuordnung, Preview-Diff, Undo und SLA/Country Anzeige
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (
    !/view=Edit/.test(location.href) ||
    !/module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href)
  ) return;

  /* ===========================
     HELPERS
  =========================== */

  const T = s => (s || '').toString().trim();
  const splitSN = s => T(s).split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
  const uniq = a => [...new Set(a)];

  /* ===========================
     SNAPSHOT / UNDO
  =========================== */

  let SNAPSHOT = null;

  function takeSnapshot(items) {
    SNAPSHOT = items.map(it => ({
      ta: it.ta,
      qty: it.qty,
      desc: it.ta.value,
      q: it.qty.value
    }));
  }

  function undo() {
    if (!SNAPSHOT) return alert('Kein Undo verfügbar');
    SNAPSHOT.forEach(s => {
      s.ta.value = s.desc;
      s.qty.value = s.q;
      s.ta.dispatchEvent(new Event('change',{bubbles:true}));
      s.qty.dispatchEvent(new Event('change',{bubbles:true}));
    });
    SNAPSHOT = null;
    alert('Undo durchgeführt');
  }

  /* ===========================
     ITEM EXTRACTION
  =========================== */

  function extractSN(desc) {
    const m = desc.match(/S\/N:\s*([^\n\r]+)/i);
    return m ? splitSN(m[1]) : [];
  }

  function rebuildDescription(desc, snList) {
    let rest = desc.replace(/S\/N:.*(\n|$)/i,'').trim();
    const start = rest.match(/Service Start:[^\n]+/i);
    const end   = rest.match(/Service End:[^\n]+/i);
    rest = rest.replace(/Service Start:[^\n]+/ig,'')
               .replace(/Service End:[^\n]+/ig,'')
               .trim();

    let out = `S/N: ${snList.join(', ')}\n`;
    if (rest) out += rest + '\n';
    if (start) out += start[0] + '\n';
    if (end) out += end[0];
    return out.trim();
  }

  function getItems() {
    return [...document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow')]
      .map(tr => {
        const ta = tr.querySelector('textarea');
        const qty = tr.querySelector('input[name^="qty"]');
        if (!ta || !qty) return null;

        const name =
          tr.querySelector('input[id^="productName"]')?.value ||
          tr.querySelector('td')?.innerText.split('\n')[0] ||
          'Produkt';

        const sla =
          tr.querySelector('[data-fieldname="cf_907"]')?.innerText ||
          tr.innerText.match(/SLA\s*:\s*(.*)/i)?.[1] ||
          '—';

        const country =
          tr.querySelector('[data-fieldname="cf_913"]')?.innerText ||
          tr.innerText.match(/Country\s*:\s*(.*)/i)?.[1] ||
          '—';

        const desc = ta.value;
        const sns = extractSN(desc);
        const start = desc.match(/Service Start:[^\n]+/i)?.[0] || '';
        const end   = desc.match(/Service End:[^\n]+/i)?.[0] || '';

        return { tr, ta, qty, name, sla, country, sns, start, end };
      })
      .filter(Boolean);
  }

  /* ===========================
     UI PANEL
  =========================== */

  const panel = document.createElement('div');
  panel.style.cssText = `
    position:fixed; top:12px; right:12px; z-index:2147483647;
    background:#111; color:#eaeaea; padding:12px;
    border-radius:10px; width:420px;
    box-shadow:0 8px 28px rgba(0,0,0,.45);
    font:13px system-ui;
  `;
  panel.innerHTML = `
    <b>SN-Abgleich</b>
    <label>Behalten</label><textarea id="sn_keep"></textarea>
    <label>Entfernen</label><textarea id="sn_remove"></textarea>
    <label>Hinzufügen</label><textarea id="sn_add"></textarea>
    <button id="sn_preview">Preview</button>
    <button id="sn_apply">Apply</button>
    <button id="sn_undo" style="background:#444">Undo</button>
  `;
  document.body.appendChild(panel);

  panel.querySelectorAll('textarea').forEach(t=>{
    t.style.cssText='width:100%;height:60px;background:#1a1a1a;color:#eaeaea;border:1px solid #333;border-radius:6px;padding:6px';
  });

  panel.querySelectorAll('button').forEach(b=>{
    b.style.cssText='margin-top:8px;width:100%;background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer';
  });

  /* ===========================
     PREVIEW + APPLY
  =========================== */

  function buildPlan() {
    const keep = splitSN(document.getElementById('sn_keep').value);
    const remove = splitSN(document.getElementById('sn_remove').value);
    const add = splitSN(document.getElementById('sn_add').value);

    const items = getItems();
    const allExisting = new Map();
    items.forEach(it => it.sns.forEach(sn => allExisting.set(sn, it)));

    const blocked = new Set(
      uniq(
        keep.filter(sn => remove.includes(sn) || add.includes(sn))
          .concat(remove.filter(sn => add.includes(sn)))
      )
    );

    return { keep, remove, add, items, allExisting, blocked };
  }

  function preview() {
    const { remove, add, blocked } = buildPlan();
    alert(
      `Preview:\n\n` +
      `➖ Entfernen:\n${remove.filter(sn=>!blocked.has(sn)).join(', ') || '—'}\n\n` +
      `➕ Hinzufügen:\n${add.filter(sn=>!blocked.has(sn)).join(', ') || '—'}\n\n` +
      (blocked.size ? `⚠️ Blockiert:\n${[...blocked].join(', ')}` : '')
    );
  }

  function apply() {
    const plan = buildPlan();
    const { items, remove, add, blocked, allExisting } = plan;
    takeSnapshot(items);

    /* REMOVE */
    items.forEach(it => {
      const next = it.sns.filter(sn => !remove.includes(sn) || blocked.has(sn));
      if (next.length !== it.sns.length) {
        it.ta.value = rebuildDescription(it.ta.value, next);
        it.qty.value = next.length;
        it.ta.dispatchEvent(new Event('change',{bubbles:true}));
        it.qty.dispatchEvent(new Event('change',{bubbles:true}));
        it.sns = next;
      }
    });

    /* ADD → MULTI ASSIGN */
    const cleanAdd = add.filter(sn =>
      !blocked.has(sn) && !allExisting.has(sn)
    );

    if (!cleanAdd.length) return;

    const choice = prompt(
      `Neue Seriennummern:\n${cleanAdd.join(', ')}\n\n` +
      items.map((p,i)=>
        `${i+1}) ${p.name} | ${p.sla} | ${p.country} | ${p.start} ${p.end} | Qty:${p.sns.length}`
      ).join('\n') +
      `\n\nNummer eingeben oder abbrechen`
    );

    if (!choice) return;

    const idx = parseInt(choice,10)-1;
    const it = items[idx];
    if (!it) return;

    it.sns = uniq(it.sns.concat(cleanAdd));
    it.ta.value = rebuildDescription(it.ta.value, it.sns);
    it.qty.value = it.sns.length;
    it.ta.dispatchEvent(new Event('change',{bubbles:true}));
    it.qty.dispatchEvent(new Event('change',{bubbles:true}));
  }

  document.getElementById('sn_preview').onclick = preview;
  document.getElementById('sn_apply').onclick = apply;
  document.getElementById('sn_undo').onclick = undo;

})();
