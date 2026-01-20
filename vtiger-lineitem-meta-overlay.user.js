// ==UserScript==
// @name         VTiger LineItem Meta Overlay (Auto / Manual)
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.2.6
// @description  Show product number (PROxxxxx), audit maintenance descriptions and validate structure
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async function () {
  'use strict';

  /* ===============================
     MODE / MODULE DETECTION
     =============================== */

  const SUPPORTED_MODULES = [
    'Quotes',
    'SalesOrder',
    'Invoice',
    'PurchaseOrder',
    'Products'
  ];

  const isEdit =
    location.href.includes('view=Edit') &&
    new RegExp(`module=(${SUPPORTED_MODULES.join('|')})`).test(location.href);

  if (!isEdit) return;

  /* ===============================
     UTILITIES
     =============================== */

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  function getQuantity(tr, rn) {
    const q =
      tr.querySelector(`#qty${rn}`) ||
      tr.querySelector(`#quantity${rn}`) ||
      tr.querySelector(`input[name="qty${rn}"]`) ||
      tr.querySelector(`input[name="quantity${rn}"]`);
    const v = parseInt(q?.value, 10);
    return Number.isFinite(v) ? v : 0;
  }

  /* ===============================
     DESCRIPTION STRUCTURE ANALYSIS
     =============================== */

  const LABELS = {
    neutral: ["S/N:", "Service Start:"],
    de: ["inkl.:", "Standort:", "Service Ende:"],
    en: ["incl.:", "Location:", "Service End:"]
  };

  function analyzeDescription(desc) {
    const lines = desc.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let hasDE = false;
    let hasEN = false;
    const foundOrder = [];

    for (const l of lines) {
      for (const k of LABELS.de) if (l.startsWith(k)) { hasDE = true; foundOrder.push(k); }
      for (const k of LABELS.en) if (l.startsWith(k)) { hasEN = true; foundOrder.push(k); }
      for (const k of LABELS.neutral) if (l.startsWith(k)) foundOrder.push(k);
    }

    if (hasDE && hasEN) return { ok: false, reason: "Sprachmix" };

    const orderBase = hasEN
      ? ["S/N:", "incl.:", "Location:", "Service Start:", "Service End:"]
      : ["S/N:", "inkl.:", "Standort:", "Service Start:", "Service Ende:"];

    let lastIdx = -1;
    for (const f of foundOrder) {
      const idx = orderBase.indexOf(f);
      if (idx === -1 || idx < lastIdx) return { ok: false, reason: "Reihenfolge" };
      lastIdx = idx;
    }

    const hasStart = lines.some(l => l.startsWith("Service Start:"));
    const hasEnd = lines.some(l => l.startsWith("Service Ende:") || l.startsWith("Service End:"));

    if (!hasStart || !hasEnd) return { ok: false, reason: "Service-Daten fehlen" };

    return { ok: true };
  }

  /* ===============================
     AUDITOR
     =============================== */

  function extractSerials(desc) {
    const out = [];
    const re = /S\/N:\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(desc))) {
      m[1].split(/[,;\/]/).map(s => s.trim()).filter(Boolean).forEach(sn => out.push(sn));
    }
    return [...new Set(out)];
  }

  function auditMaintenance(desc, qty) {
    if (!desc) return "🔴 Wartung: Keine Beschreibung";

    const structure = analyzeDescription(desc);
    if (!structure.ok) return `🟡 Wartung: ${structure.reason}`;

    const serials = extractSerials(desc);
    if (!serials.length) return "🟡 Wartung: Keine S/N";
    if (serials.length !== qty) return `🟡 Wartung: Quantity (${qty}) ≠ S/N (${serials.length})`;

    return "🟢 Wartung: OK";
  }

  /* ===============================
     DESCRIPTION STANDARDIZER
     =============================== */

  function normalizeDescriptionLanguage(text, lang) {
    let t = text
      .replaceAll("Location:", "Standort:")
      .replaceAll("incl.:", "inkl.:")
      .replaceAll("Service End:", "Service Ende:");

    if (lang === "en") {
      t = t
        .replaceAll("Standort:", "Location:")
        .replaceAll("inkl.:", "incl.:")
        .replaceAll("Service Ende:", "Service End:");
    }
    return t;
  }

  function openStandardizer(tr, textarea) {
    const original = textarea.value;
    let lang = 'en';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:99999;display:flex;align-items:center;justify-content:center';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;padding:12px;width:800px;max-width:90%;font-size:12px';

    const origTA = document.createElement('textarea');
    origTA.readOnly = true;
    origTA.style.cssText = 'width:100%;height:140px';
    origTA.value = original;

    const prevTA = document.createElement('textarea');
    prevTA.readOnly = true;
    prevTA.style.cssText = 'width:100%;height:140px';

    const update = () => prevTA.value = normalizeDescriptionLanguage(original, lang);
    update();

    const switcher = document.createElement('div');
    switcher.innerHTML = '<button data-lang="de">DE</button><button data-lang="en">EN</button>';
    switcher.querySelectorAll('button').forEach(b => b.onclick = () => { lang = b.dataset.lang; update(); });

    const actions = document.createElement('div');
    actions.innerHTML = '<button id="apply">Apply</button><button id="cancel">Cancel</button>';
    actions.onclick = e => {
      if (e.target.id === 'apply') {
        textarea.value = prevTA.value;
        refreshBadge(tr);
      }
      overlay.remove();
    };

    box.append('Original', origTA, 'Vorschau', switcher, prevTA, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  /* ===============================
     RENDER
     =============================== */

  function ensureAuditor(tr) {
    let d = tr.querySelector('.hw24-auditor');
    if (!d) {
      d = document.createElement('div');
      d.className = 'hw24-auditor';
      d.style.cssText = 'margin-top:4px;font-size:11px;font-weight:bold';
      tr.appendChild(d);
    }
    return d;
  }

  function refreshBadge(tr) {
    const rn = tr.getAttribute('data-row-num') || tr.id.replace('row', '');
    const desc = tr.querySelector('textarea[name*="comment"]')?.value || '';
    const qty = getQuantity(tr, rn);
    ensureAuditor(tr).textContent = auditMaintenance(desc, qty);
  }

  function injectButtons(tr) {
    if (tr.querySelector('.hw24-desc-btn')) return;
    const ta = tr.querySelector('textarea[name*="comment"]');
    if (!ta) return;

    const std = document.createElement('button');
    std.textContent = 'Description standardisieren';
    std.onclick = e => { e.preventDefault(); openStandardizer(tr, ta); };

    const ref = document.createElement('button');
    ref.textContent = '↻ Badge prüfen';
    ref.style.marginLeft = '6px';
    ref.onclick = e => { e.preventDefault(); refreshBadge(tr); };

    ta.after(std, ref);
  }

  /* ===============================
     BOOTSTRAP
     =============================== */

  function process() {
    document.querySelectorAll('tr.lineItemRow[id^="row"],tr.inventoryRow').forEach(tr => {
      injectButtons(tr);
      refreshBadge(tr);
    });
  }

  process();
  const tbl = document.querySelector('#lineItemTab');
  if (tbl) new MutationObserver(debounce(process, 600)).observe(tbl, { childList: true, subtree: true });

})();
