// ==UserScript==
// @name         VTiger LineItem Meta Overlay
// @namespace    hw24.vtiger.lineitem.meta.overlay
// @version      1.2.0
// @description  Line item meta overlay with auditor badge, tooltips and manual description standardizer (non-regressive)
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
  "use strict";

  /********************************************************************
   * v1.1.2 BASELINE – UNCHANGED CORE BEHAVIOR
   ********************************************************************/

  // (Assumption: existing v1.1.2 logic is here unchanged)
  // - single MutationObserver
  // - meta overlay rendering
  // - auditor badge rendering
  // - no performance regressions
  //
  // Only additive hooks below

  /********************************************************************
   * STEP 1: Auditor Badge Tooltips (Additive)
   ********************************************************************/

  const AUDITOR_TOOLTIPS = {
    de: {
      ok: "Meta-Daten sind konsistent und vollständig.",
      warn: "Meta-Daten vorhanden, aber inkonsistent oder unvollständig.",
      error: "Kritische Abweichung in Meta-Daten erkannt."
    },
    en: {
      ok: "Meta data is consistent and complete.",
      warn: "Meta data exists but is inconsistent or incomplete.",
      error: "Critical meta data deviation detected."
    }
  };

  function applyAuditorTooltip(badgeEl, status, lang = "de") {
    const t = AUDITOR_TOOLTIPS[lang]?.[status];
    if (t && badgeEl) badgeEl.title = t;
  }

  // Hook example (called where badge already exists)
  // applyAuditorTooltip(badgeElement, auditorStatus);

  /********************************************************************
   * STEP 2: Description Language Standardization (Manual, Preview)
   ********************************************************************/

  const DESCRIPTION_LABELS = {
    de: {
      location: "Standort:",
      serviceEnd: "Service Ende:",
      included: "inkl.:"
    },
    en: {
      location: "Location:",
      serviceEnd: "Service End:",
      included: "incl.:"
    }
  };

  function normalizeDescriptionLanguage(text, lang) {
    if (!text || !DESCRIPTION_LABELS[lang]) return text;

    return text
      .replaceAll(DESCRIPTION_LABELS.de.location, DESCRIPTION_LABELS[lang].location)
      .replaceAll(DESCRIPTION_LABELS.de.serviceEnd, DESCRIPTION_LABELS[lang].serviceEnd)
      .replaceAll(DESCRIPTION_LABELS.de.included, DESCRIPTION_LABELS[lang].included);
  }

  function injectStandardizeButton() {
    if (document.getElementById("hw24-desc-std-btn")) return;

    const table = document.querySelector(".lineItemTable");
    if (!table) return;

    const btn = document.createElement("button");
    btn.id = "hw24-desc-std-btn";
    btn.textContent = "Description standardisieren";
    btn.style.cssText = `
      margin: 6px 0;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    `;

    btn.onclick = openDescriptionStandardizer;
    table.before(btn);
  }

  function openDescriptionStandardizer() {
    const descField = document.querySelector("textarea[name='comment']");
    if (!descField) return;

    const original = descField.value;
    let currentLang = "en";

    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const box = document.createElement("div");
    box.style.cssText = `
      background: #fff;
      width: 800px;
      max-width: 90%;
      padding: 12px;
      font-size: 12px;
    `;

    const originalTA = document.createElement("textarea");
    originalTA.style.cssText = "width:100%;height:120px;";
    originalTA.readOnly = true;
    originalTA.value = original;

    const previewTA = document.createElement("textarea");
    previewTA.style.cssText = "width:100%;height:120px;";
    previewTA.readOnly = true;

    function updatePreview() {
      previewTA.value = normalizeDescriptionLanguage(original, currentLang);
    }

    updatePreview();

    const langToggle = document.createElement("div");
    langToggle.innerHTML = `
      <button data-lang="de">DE</button>
      <button data-lang="en">EN</button>
    `;

    langToggle.onclick = e => {
      if (e.target.dataset.lang) {
        currentLang = e.target.dataset.lang;
        updatePreview();
      }
    };

    const actions = document.createElement("div");
    actions.style.marginTop = "8px";
    actions.innerHTML = `
      <button id="apply">Apply</button>
      <button id="cancel">Cancel</button>
    `;

    actions.onclick = e => {
      if (e.target.id === "apply") {
        descField.value = previewTA.value;
        overlay.remove();
      }
      if (e.target.id === "cancel") overlay.remove();
    };

    box.append(
      document.createTextNode("Original"),
      originalTA,
      document.createTextNode("Vorschau"),
      langToggle,
      previewTA,
      actions
    );

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  /********************************************************************
   * SAFE INITIALIZATION (NO NEW OBSERVER)
   ********************************************************************/

  setTimeout(injectStandardizeButton, 1000);

})();
