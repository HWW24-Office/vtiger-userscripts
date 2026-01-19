// ==UserScript==
// @name         VTiger SN Reconcile (Edit Mode)
// @namespace    hw24.vtiger.sn.reconcile
// @version      0.6.0
// @description  SN-Abgleich im Edit-Modus: Behalten = Soll-Liste (nur Prüfung), Entfernen = einzige Löschquelle, Hinzufügen = Dialog mit Mehrfach-Zuordnung, Preview & Undo
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const isEdit =
    location.href.includes('view=Edit') &&
    /module=(Quotes|SalesOrder|Invoice|PurchaseOrder)/.test(location.href);
  if (!isEdit) return;

  /* ================= Utilities ================= */

  const S = s => (s || '').toString().trim();
  const norm = s => S(s).toUpperCase().replace(/[\s\u00A0]/g, '');
  const uniq = arr => [...new Set(arr)];
  const parseList = t => uniq(S(t).split(/[\n,;]+/).map(x => norm(x)).filter(Boolean));

  function fire(el){
    if(!el) return;
    ['input','change','blur'].forEach(e=>el.dispatchEvent(new Event(e,{bubbles:true})));
  }

  /* ================= Read current line items ================= */

  function getLineItems(){
    const rows = [...document.querySelectorAll('tr.lineItemRow[id^="row"], tr.inventoryRow')];
    return rows.map(tr=>{
      const rn = tr.getAttribute('data-row-num') || tr.id.replace('row','');
      const descEl =
        tr.querySelector('textarea[name*="comment"], textarea[name*="description"]') ||
        tr.querySelector('input[name*="comment"], input[name*="description"]');

      const desc = S(descEl?.value || descEl?.textContent || '');

      const snMatch = desc.match(/S\/N\s*:\s*([^\n\r]+)/i);
      const sns = snMatch ? parseList(snMatch[1]) : [];

      const prodName =
        S(tr.querySelector(`#productName${rn}`)?.textContent) ||
        S(tr.querySelector('input[id^="productName"]')?.value) ||
        `Position ${rn}`;

      const qtyEl = tr.querySelector('input[name^="qty"]');
      const qty = qtyEl ? Number(qtyEl.value || 0) : 0;

      return { tr, rn, descEl, desc, sns, prodName, qty, qtyEl };
    });
  }

  /* ================= UI Panel ================= */

  function addPanel(){
    if(document.getElementById('sn-reconcile-panel')) return;

    const p = document.createElement('div');
    p.id = 'sn-reconcile-panel';
    p.style.cssText = `
      position:fixed; bottom:16px; left:16px; z-index:2147483647;
      background:#111; color:#fff; padding:12px; border-radius:10px;
      box-shadow:0 6px 18px rgba(0,0,0,.35); width:340px;
      font:13px/1.35 system-ui,Segoe UI,Roboto,Arial;
    `;

    p.innerHTML = `
      <b>SN-Abgleich</b>
      <div style="margin-top:8px">
        <label>Behalten (Soll-Liste)</label>
        <textarea id="sn-keep" style="width:100%;height:60px"></textarea>
      </div>
      <div>
        <label>Entfernen</label>
        <textarea id="sn-remove" style="width:100%;height:60px"></textarea>
      </div>
      <div>
        <label>Hinzufügen</label>
        <textarea id="sn-add" style="width:100%;height:60px"></textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="sn-preview">Preview</button>
        <button id="sn-apply">Apply</button>
        <button id="sn-undo" disabled>Undo</button>
      </div>
      <div id="sn-msg" style="margin-top:8px;color:#ffd966"></div>
    `;

    p.querySelectorAll('button').forEach(b=>{
      b.style.cssText='flex:1;cursor:pointer';
    });

    document.body.appendChild(p);
  }

  addPanel();

  /* ================= Core Logic ================= */

  let SNAPSHOT = null;

  function snapshot(items){
    return items.map(it=>({
      rn: it.rn,
      desc: it.descEl?.value,
      qty: it.qtyEl?.value
    }));
  }

  function restore(snapshot){
    snapshot.forEach(s=>{
      const tr = document.getElementById('row'+s.rn) || document.querySelector(`tr[data-row-num="${s.rn}"]`);
      if(!tr) return;
      const d =
        tr.querySelector('textarea[name*="comment"], textarea[name*="description"]') ||
        tr.querySelector('input[name*="comment"], input[name*="description"]');
      const q = tr.querySelector('input[name^="qty"]');
      if(d){ d.value = s.desc; fire(d); }
      if(q){ q.value = s.qty; fire(q); }
    });
  }

  function buildIndex(items){
    const map = new Map();
    items.forEach(it=>{
      it.sns.forEach(sn=>{
        if(!map.has(sn)) map.set(sn,[]);
        map.get(sn).push(it);
      });
    });
    return map;
  }

  function showMsg(t){ document.getElementById('sn-msg').textContent = t; }

  /* ================= Preview ================= */

  document.getElementById('sn-preview').onclick = ()=>{
    const items = getLineItems();
    const idx = buildIndex(items);

    const keep = parseList(document.getElementById('sn-keep').value);
    const rem  = parseList(document.getElementById('sn-remove').value);
    const add  = parseList(document.getElementById('sn-add').value);

    const conflicts = keep.filter(sn=>rem.includes(sn) || add.includes(sn));
    const missingKeep = keep.filter(sn=>!idx.has(sn));
    const multi = [...idx.entries()].filter(([sn,arr])=>arr.length>1).map(([sn])=>sn);

    let msg = [];
    if(conflicts.length) msg.push(`Konflikt (Behalten vs Entfernen/Hinzufügen): ${conflicts.join(', ')}`);
    if(missingKeep.length) msg.push(`Soll-SN fehlen im Angebot: ${missingKeep.join(', ')}`);
    if(multi.length) msg.push(`SN mehrfach vorhanden: ${multi.join(', ')}`);

    if(!msg.length) msg.push('Preview OK – keine Konflikte erkannt.');
    showMsg(msg.join(' | '));
  };

  /* ================= Apply ================= */

  document.getElementById('sn-apply').onclick = ()=>{
    const items = getLineItems();
    const idx = buildIndex(items);

    const keep = parseList(document.getElementById('sn-keep').value);
    const rem  = parseList(document.getElementById('sn-remove').value);
    const add  = parseList(document.getElementById('sn-add').value);

    const conflicts = uniq([
      ...keep.filter(sn=>rem.includes(sn)),
      ...keep.filter(sn=>add.includes(sn))
    ]);

    // Block conflicting SNs
    const blocked = new Set(conflicts);

    SNAPSHOT = snapshot(items);
    document.getElementById('sn-undo').disabled = false;

    /* --- Entfernen: einzige Löschquelle --- */
    rem.forEach(sn=>{
      if(blocked.has(sn)) return;
      const rows = idx.get(sn);
      if(!rows) return;
      rows.forEach(it=>{
        it.sns = it.sns.filter(x=>x!==sn);
      });
    });

    /* --- Hinzufügen: Dialog erforderlich --- */
    const addCandidates = add.filter(sn=>!idx.has(sn) && !blocked.has(sn));
    if(addCandidates.length){
      alert(
        'Neue Seriennummern müssen zugeordnet werden:\n\n' +
        addCandidates.join('\n') +
        '\n\nBitte Produkt manuell hinzufügen und danach erneut ausführen.'
      );
    }

    /* --- Write back descriptions & qty --- */
    items.forEach(it=>{
      const snLine = it.sns.length ? `S/N: ${it.sns.join(', ')}` : '';
      let rest = it.desc
        .replace(/S\/N\s*:[^\n\r]+/i,'')
        .trim();

      let parts = [];
      if(snLine) parts.push(snLine);
      if(rest) parts.push(rest);

      it.descEl.value = parts.join('\n');
      fire(it.descEl);

      if(it.qtyEl){
        it.qtyEl.value = it.sns.length || 0;
        fire(it.qtyEl);
      }
    });

    showMsg('Apply abgeschlossen.');
  };

  /* ================= Undo ================= */

  document.getElementById('sn-undo').onclick = ()=>{
    if(!SNAPSHOT) return;
    restore(SNAPSHOT);
    showMsg('Undo durchgeführt.');
  };

})();
