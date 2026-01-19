// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.5.2
// @description  SN-Abgleich mit Preview, Undo und Radiobutton-Zuordnung mehrerer Seriennummern auf mehrere Positionen
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

  /* =======================
     HELPERS
  ======================= */

  const T = s => (s || '').toString().trim();
  const splitSN = s => T(s).split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
  const uniq = a => [...new Set(a)];

  /* =======================
     ITEM EXTRACTION
  ======================= */

  function extractSN(desc) {
    const m = desc.match(/S\/N:\s*([^\n\r]+)/i);
    return m ? splitSN(m[1]) : [];
  }

  function rebuildDescription(desc, snList) {
    let rest = desc.replace(/S\/N:.*(\n|$)/i, '').trim();
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

        const desc = ta.value;
        const sns = extractSN(desc);

        const start = desc.match(/Service Start:[^\n]+/i)?.[0] || '';
        const end   = desc.match(/Service End:[^\n]+/i)?.[0] || '';

        const sla = tr.innerText.match(/SLA\s*:\s*([^\n]+)/i)?.[1] || '—';
        const country = tr.innerText.match(/Country\s*:\s*([^\n]+)/i)?.[1] || '—';

        return { tr, ta, qty, name, sla, country, start, end, sns };
      })
      .filter(Boolean);
  }

  /* =======================
     UI PANEL
  ======================= */

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
  `;
  document.body.appendChild(panel);

  panel.querySelectorAll('textarea').forEach(t=>{
    t.style.cssText='width:100%;height:60px;background:#1a1a1a;color:#eaeaea;border:1px solid #333;border-radius:6px;padding:6px';
  });
  panel.querySelectorAll('button').forEach(b=>{
    b.style.cssText='margin-top:8px;width:100%;background:#1f6feb;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer';
  });

  /* =======================
     PREVIEW
  ======================= */

  function preview() {
    const keep = splitSN(document.getElementById('sn_keep').value);
    const remove = splitSN(document.getElementById('sn_remove').value);
    const add = splitSN(document.getElementById('sn_add').value);

    alert(
      `Preview\n\n` +
      `Behalten:\n${keep.join(', ') || '—'}\n\n` +
      `Entfernen:\n${remove.join(', ') || '—'}\n\n` +
      `Hinzufügen:\n${add.join(', ') || '—'}`
    );
  }

  document.getElementById('sn_preview').onclick = preview;

  /* =======================
     APPLY → RADIO DIALOG
  ======================= */

  document.getElementById('sn_apply').onclick = () => {

    const items = getItems();
    const add = splitSN(document.getElementById('sn_add').value);
    if (!add.length) return;

    const modal = document.createElement('div');
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.7);
      z-index:2147483647; display:flex; align-items:center; justify-content:center;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      background:#111; color:#eaeaea; padding:16px;
      border-radius:10px; width:90%; max-width:1100px;
      max-height:80vh; overflow:auto;
      font:13px system-ui;
    `;

    let html = `<b>Zuordnung neuer Seriennummern</b><br><br><table style="width:100%;border-collapse:collapse">`;
    html += `<tr><th>SN</th>`;
    items.forEach((p,i)=>{
      html += `<th>${p.name}<br><small>${p.sla} | ${p.country}<br>${p.start} – ${p.end}</small></th>`;
    });
    html += `</tr>`;

    add.forEach(sn=>{
      html += `<tr><td>${sn}</td>`;
      items.forEach((_,i)=>{
        html += `<td style="text-align:center"><input type="radio" name="sn_${sn}" value="${i}"></td>`;
      });
      html += `</tr>`;
    });

    html += `</table><br><button id="sn_assign_ok">Übernehmen</button>`;
    box.innerHTML = html;
    modal.appendChild(box);
    document.body.appendChild(modal);

    box.querySelector('#sn_assign_ok').onclick = () => {
      add.forEach(sn=>{
        const sel = box.querySelector(`input[name="sn_${sn}"]:checked`);
        if (!sel) return;
        const it = items[parseInt(sel.value,10)];
        if (it.sns.includes(sn)) return;
        it.sns.push(sn);
        it.ta.value = rebuildDescription(it.ta.value, it.sns);
        it.qty.value = it.sns.length;
        it.ta.dispatchEvent(new Event('change',{bubbles:true}));
        it.qty.dispatchEvent(new Event('change',{bubbles:true}));
      });
      modal.remove();
    };
  };

})();
