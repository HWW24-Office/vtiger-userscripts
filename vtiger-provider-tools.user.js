// ==UserScript==
// @name         VTiger Provider Tools
// @namespace    hw24.vtiger.provider.tools
// @version      1.5.3
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-provider-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-provider-tools.user.js
// @description  Provider- & Händler-Anfragen: Vorbereitungs-Buttons für E-Mails auf Potentials
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const HW24_VERSION = '1.5.3';

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE / VIEW GUARD
     ═══════════════════════════════════════════════════════════════════════════ */

  const currentModule = (location.href.match(/module=(\w+)/) || [])[1] || '';
  const isDetail = location.href.includes('view=Detail');
  if (currentModule !== 'Potentials' || !isDetail) return;

  console.log('%c[HW24] vtiger-provider-tools v' + HW24_VERSION + ' loaded', 'color:#7c3aed;font-weight:bold;font-size:14px');

  /* ═══════════════════════════════════════════════════════════════════════════
     SHARED UTILITIES
     ═══════════════════════════════════════════════════════════════════════════ */

  function fire(el) {
    el && ['input', 'change', 'blur'].forEach(e =>
      el.dispatchEvent(new Event(e, { bubbles: true }))
    );
  }

  function waitFor(predicate, interval, timeout) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const result = predicate();
        if (result) return resolve(result);
        if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
        setTimeout(check, interval);
      };
      check();
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PROVIDER CONFIGURATION
     ═══════════════════════════════════════════════════════════════════════════
     All providers default to PerDu style.
     Axians, DIS, TD Synnex have a "Sie" toggle (default = du, checkbox flips to formal).
     ═══════════════════════════════════════════════════════════════════════════ */

  const PROVIDERS = [
    { key: 'TG',    label: 'Evernex',    to: 'R.Voelzke@technogroup.com',  cc: '',                               greeting: 'Hallo Ronny,',       style: 'du',  lang: 'de' },
    { key: 'CC',    label: 'Axians',     to: 'Michael.kienzle@axians.de',  cc: 'niklas.spranz@axians.de',        greeting: 'Hallo Michael,',     style: 'du',  lang: 'de',
                                                                                                                   greetingSie: 'Hallo Herr Kienzle,', hasSieToggle: true },
    { key: 'PP',    label: 'Park Place', to: 'jchiaju@parkplacetech.com',  cc: 'partnersales@parkplacetech.com', greeting: 'Hallo Justine,',     style: 'du',  lang: 'de' },
    { key: 'ITRIS', label: 'ITRIS',      to: 'kkroner@itris.de',           cc: '',                               greeting: 'Hallo Katrin,',      style: 'du',  lang: 'de' },
    { key: 'DIS',   label: 'DIS',        to: 'anfragen@dis-daten-it.de',   cc: '',                               greeting: 'Hallo Team,',        style: 'du',  lang: 'de',
                                                                                                                   greetingSie: 'Hallo Team,', hasSieToggle: true },
    { key: 'IDS',   label: 'IDS',        to: 'o.hermann@idsgmbh.com',      cc: '',                               greeting: 'Hallo Olga,',        style: 'du',  lang: 'de' },
    { key: 'Nordic', label: 'Nordic',    to: 'ksp@nordiccomputer.com',     cc: '',                               greeting: 'Hello Kevon,',       style: 'du',  lang: 'en' },
    { key: 'TDS',   label: 'TD Synnex',  to: 'Sales.at@tdsynnex.com',      cc: '',                               greeting: 'Hallo Team,',        style: 'du',  lang: 'de',
                                                                                                                   greetingSie: 'Hallo Team,', hasSieToggle: true },
  ];

  /* ═══════════════════════════════════════════════════════════════════════════
     DEALER CONFIGURATION (Hardware-Händler)
     ═══════════════════════════════════════════════════════════════════════════
     Dealers use comment posting instead of status field updates.
     ═══════════════════════════════════════════════════════════════════════════ */

  const DEALERS = [
    { key: 'Nordic',    label: 'Nordic',     to: 'ksp@nordiccomputer.com',                   cc: '',                greeting: 'Hello Kevon,',           style: 'du',  lang: 'en' },
    { key: 'Epoka',     label: 'Epoka',      to: 'aly@epoka.com',                            cc: 'Sales@epoka.com', greeting: 'Hallo Andrej,',          style: 'du',  lang: 'de' },
    { key: 'Techbuyer', label: 'Techbuyer',  to: 'n.sinatra@techbuyer.com',                  cc: '',                greeting: 'Hallo Nino,',            style: 'du',  lang: 'de' },
    { key: 'FlexIT',    label: 'FlexIT',     to: 'silvia.zeljenkova@flexitdistribution.com', cc: '',                greeting: 'Hallo Frau Zeljenkova,', style: 'sie', lang: 'de' },
    { key: 'Renewtech', label: 'Renewtech',  to: 'mimo@renewtech.com',                       cc: '',                greeting: 'Hello Mikkel,',          style: 'du',  lang: 'en' },
  ];

  /* ═══════════════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  let pendingProvider = null;
  let pendingDescriptionText = '';  // cached from detail view before popup opens
  let pendingType = null;            // 'provider' or 'dealer'
  let step1Handled = false;

  // Per-provider "Sie" toggle: true = formal/Sie, false = du (default)
  // Each provider with hasSieToggle gets its own localStorage key
  function getSieToggle(providerKey) {
    return localStorage.getItem('hw24_provider_' + providerKey.toLowerCase() + '_sie') === 'true';
  }
  function setSieToggle(providerKey, value) {
    localStorage.setItem('hw24_provider_' + providerKey.toLowerCase() + '_sie', value ? 'true' : 'false');
  }

  const DETAIL_TOOLBAR_ID = 'hw24-provider-toolbar';
  const DEALER_TOOLBAR_ID = 'hw24-dealer-toolbar';
  const COMPOSE_TOOLBAR_ID = 'hw24-provider-email-toolbar';

  /* ═══════════════════════════════════════════════════════════════════════════
     PROVIDER CONFIG RESOLUTION
     ═══════════════════════════════════════════════════════════════════════════ */

  function resolveProviderConfig(provider) {
    if (provider.hasSieToggle && getSieToggle(provider.key)) {
      return {
        ...provider,
        greeting: provider.greetingSie || provider.greeting,
        style: 'sie'
      };
    }
    return provider;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 1: DESCRIPTION READER
     ═══════════════════════════════════════════════════════════════════════════ */

  function readDescriptionText() {
    // Strategy 1: Direct ID
    const direct = document.getElementById('Potentials_detailView_fieldValue_description');
    if (direct) {
      const text = direct.textContent.trim();
      if (text) {
        console.log('[HW24 Provider] Description found via direct ID, length:', text.length);
        return text;
      }
    }

    // Strategy 2: Label-based ID derivation
    const labels = [...document.querySelectorAll('[id*="_detailView_fieldLabel_"]')];
    for (const lbl of labels) {
      const t = lbl.textContent.toLowerCase().trim();
      if (t === 'description' || t === 'beschreibung') {
        const valueId = lbl.id.replace('fieldLabel', 'fieldValue');
        const valueEl = document.getElementById(valueId);
        if (valueEl) {
          const text = valueEl.textContent.trim();
          if (text) {
            console.log('[HW24 Provider] Description found via label ID derivation, length:', text.length);
            return text;
          }
        }
      }
    }

    // Strategy 3: CSS class fieldLabel with sibling lookup
    const allLabels = [...document.querySelectorAll('td.fieldLabel, .fieldLabel, label')];
    for (const el of allLabels) {
      const t = el.textContent.toLowerCase().trim();
      if (t === 'description' || t === 'beschreibung') {
        const sibling = el.nextElementSibling;
        if (sibling) {
          const text = sibling.textContent.trim();
          if (text) {
            console.log('[HW24 Provider] Description found via CSS sibling, length:', text.length);
            return text;
          }
        }
      }
    }

    console.warn('[HW24 Provider] Description field not found');
    return '';
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 1b: RECORD COMMENT — POST VIA ModComments SaveAjax
     ═══════════════════════════════════════════════════════════════════════════
     Both providers and dealers post a comment on the Potentials record
     to document who was contacted.
     ═══════════════════════════════════════════════════════════════════════════ */

  function _getRecordId() {
    return (location.href.match(/record=(\d+)/) || [])[1] || '';
  }

  function _getCsrfToken() {
    if (typeof csrfMagicToken !== 'undefined') return csrfMagicToken;
    const input = document.querySelector('input[name="__vtrftk"]');
    if (input) return input.value;
    const meta = document.querySelector('meta[name="__vtrftk"], meta[name="csrf-token"]');
    if (meta) return meta.content;
    return '';
  }

  async function postRecordComment(commentText) {
    const recordId = _getRecordId();
    if (!recordId) {
      console.warn('[HW24] Record ID not found — cannot post comment');
      return false;
    }

    console.log('[HW24] Posting comment:', commentText);

    const saveParams = {
      module: 'ModComments',
      action: 'SaveAjax',
      related_to: recordId,
      commentcontent: commentText
    };

    // Strategy 1: VTiger AppConnector
    if (typeof AppConnector !== 'undefined' && AppConnector.request) {
      try {
        const result = await new Promise((resolve, reject) => {
          AppConnector.request(saveParams).then(resolve, reject);
        });
        console.log('[HW24] Comment posted via AppConnector:', result);
        return true;
      } catch (e) {
        console.log('[HW24] AppConnector failed:', e, '— trying jQuery');
      }
    }

    // Strategy 2: VTiger app.request
    if (typeof app !== 'undefined' && app.request && app.request.post) {
      try {
        const result = await app.request.post({ data: saveParams });
        console.log('[HW24] Comment posted via app.request:', result);
        return true;
      } catch (e) {
        console.log('[HW24] app.request failed:', e, '— trying jQuery');
      }
    }

    // Strategy 3: jQuery AJAX with CSRF token
    const jq = window.jQuery || window.$;
    const csrfToken = _getCsrfToken();
    if (jq) {
      const ajaxParams = { ...saveParams };
      if (csrfToken) ajaxParams.__vtrftk = csrfToken;
      try {
        const result = await new Promise((resolve, reject) => {
          jq.ajax({
            url: 'index.php',
            type: 'POST',
            data: ajaxParams,
            success: resolve,
            error: reject
          });
        });
        console.log('[HW24] Comment posted via jQuery AJAX:', result);
        return true;
      } catch (e) {
        console.log('[HW24] jQuery AJAX failed:', e, '— trying fetch');
      }
    }

    // Strategy 4: Plain fetch
    try {
      const params = new URLSearchParams();
      params.append('module', 'ModComments');
      params.append('action', 'SaveAjax');
      params.append('related_to', recordId);
      params.append('commentcontent', commentText);
      if (csrfToken) params.append('__vtrftk', csrfToken);

      const response = await fetch('index.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (response.ok) {
        const result = await response.json().catch(() => null);
        console.log('[HW24] Comment posted via fetch:', result);
        return true;
      } else {
        console.error('[HW24] Comment post failed: HTTP', response.status);
      }
    } catch (e) {
      console.error('[HW24] All comment strategies failed:', e);
    }
    return false;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 2: EMAILMAKER COMPOSE TRIGGER
     ═══════════════════════════════════════════════════════════════════════════
     The "Send Email with EMAILMaker" is a <button> element:
       <button class="btn btn-default selectEMAILTemplates">
         <i class="fa fa-envelope-o" title="Send Email with EMAILMaker">
         Send Email with EMAILMaker
       </button>
     It is inside: #EMAILMakerContentDiv → .btn-group.pull-right
     ═══════════════════════════════════════════════════════════════════════════ */

  function findSendEmailButton() {
    // Strategy 1: Direct class selector (from DOM inspection)
    let btn = document.querySelector('button.selectEMAILTemplates');
    if (btn) {
      console.log('[HW24 Provider] Found button.selectEMAILTemplates');
      return btn;
    }

    // Strategy 2: Button inside #EMAILMakerContentDiv
    const emDiv = document.getElementById('EMAILMakerContentDiv');
    if (emDiv) {
      btn = emDiv.querySelector('button');
      if (btn) {
        console.log('[HW24 Provider] Found button inside #EMAILMakerContentDiv');
        return btn;
      }
    }

    // Strategy 3: Any button/link with text "Send Email with EMAILMaker"
    const allClickables = [...document.querySelectorAll('button, a')];
    btn = allClickables.find(el => /send\s*email.*emailmaker/i.test(el.textContent));
    if (btn) {
      console.log('[HW24 Provider] Found "Send Email with EMAILMaker" via text');
      return btn;
    }

    // Strategy 4: Button with title containing EMAILMaker
    btn = document.querySelector('button[title*="EMAILMaker"], a[title*="EMAILMaker"]');
    if (btn) {
      console.log('[HW24 Provider] Found EMAILMaker via title attribute');
      return btn;
    }

    // Strategy 5: Icon with title
    const icon = document.querySelector('i[title*="EMAILMaker"]');
    if (icon) {
      const parent = icon.closest('button, a');
      if (parent) {
        console.log('[HW24 Provider] Found EMAILMaker via icon title');
        return parent;
      }
    }

    return null;
  }

  function triggerEMAILMakerCompose() {
    const btn = findSendEmailButton();
    if (btn) {
      console.log('[HW24 Provider] Clicking "Send Email with EMAILMaker"');
      btn.click();
      return true;
    }

    console.warn('[HW24 Provider] "Send Email with EMAILMaker" button not found');
    alert('„Send Email with EMAILMaker"-Button nicht gefunden.\nBitte öffne den EMAILMaker manuell — die Felder werden dann automatisch befüllt.');
    return false;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 3: CKEDITOR UTILITIES (adapted from lineitem-tools)
     ═══════════════════════════════════════════════════════════════════════════ */

  function getCKEditorInstance() {
    if (typeof CKEDITOR === 'undefined' || !CKEDITOR.instances) return null;
    for (const name of ['description', 'email_body', 'body']) {
      if (CKEDITOR.instances[name]) return CKEDITOR.instances[name];
    }
    const keys = Object.keys(CKEDITOR.instances);
    return keys.length ? CKEDITOR.instances[keys[keys.length - 1]] : null;
  }

  function findEmailBody(container) {
    const ckInstance = getCKEditorInstance();
    if (ckInstance) {
      try {
        const data = ckInstance.getData();
        if (data && data.length > 10) return { type: 'ckeditor', editor: ckInstance };
      } catch { /* editor not ready */ }
    }
    const iframes = container.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc?.body && doc.body.innerHTML.length > 10) return { type: 'iframe', el: iframe, doc };
      } catch { /* cross-origin */ }
    }
    const editables = container.querySelectorAll('[contenteditable="true"]');
    for (const el of editables) {
      if (el.innerHTML.length > 10) return { type: 'contenteditable', el };
    }
    const textareas = container.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.value.length > 10 && !ta.classList.contains('cke_source')) return { type: 'textarea', el: ta };
    }
    return null;
  }

  function readEmailHTML() {
    const container = findComposeContainer() || document.body;
    const body = findEmailBody(container);
    if (!body) return null;
    let html;
    if (body.type === 'ckeditor') html = body.editor.getData();
    else if (body.type === 'iframe') html = body.doc.body.innerHTML;
    else if (body.type === 'contenteditable') html = body.el.innerHTML;
    else html = body.el.value;
    return { body, html };
  }

  function writeEmailHTML(body, html) {
    if (body.type === 'ckeditor') {
      body.editor.setData(html);
    } else if (body.type === 'textarea') {
      body.el.value = html;
      fire(body.el);
    } else if (body.type === 'iframe') {
      body.doc.body.innerHTML = html;
    } else {
      body.el.innerHTML = html;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 4: STEP 1 POPUP — TEMPLATE + LANGUAGE + RECIPIENT RESET
     ═══════════════════════════════════════════════════════════════════════════
     The first popup has: To, CC, BCC, Template selector, Language selector.
     We now clear customer recipients already in Step 1 and prefill provider To.
     Step 2 still re-applies recipients and verifies them.
     ═══════════════════════════════════════════════════════════════════════════ */

  function findStep1Container() {
    const selectors = [
      '.SendEmailFormStep1',
      '#sendEmailFormStep1',
      '.modelContainer',
      '.modal.in',
      '.modal.show',
      '[role="dialog"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      // Step 1: has template/recipient fields but NO CKEditor
      const hasCKEditor = el.querySelector('.cke, [id^="cke_"], .cke_editable');
      if (!hasCKEditor && el.querySelector('select, input, button')) {
        return el;
      }
    }
    return null;
  }

  async function selectTemplateInStep1(container) {
    console.log('[HW24 Provider] Step1: Selecting template...');

    // Strategy 1: <select> element for templates
    const selects = container.querySelectorAll('select');
    for (const sel of selects) {
      const name = (sel.name || sel.id || '').toLowerCase();
      if (/^(to|cc|bcc|from)/.test(name)) continue;
      const options = [...sel.options];
      const target = options.find(o => /Anfrage\s*H[äa]ndler/i.test(o.text));
      if (target) {
        sel.value = target.value;
        fire(sel);
        // Also trigger via jQuery if available
        try {
          const jq = window.jQuery || window.$;
          if (jq) jq(sel).val(target.value).trigger('change');
        } catch { /* ok */ }
        console.log('[HW24 Provider] Step1: Template selected:', target.text);
        return true;
      }
      if (options.length > 2) {
        console.log('[HW24 Provider] Step1: Select options:', options.map(o => o.text.substring(0, 40)).join(' | '));
      }
    }

    // Strategy 2: Select2-wrapped dropdown
    try {
      const jq = window.jQuery || window.$;
      if (jq) {
        let found = false;
        jq(container).find('select').each(function () {
          const $s = jq(this);
          const name = ($s.attr('name') || $s.attr('id') || '').toLowerCase();
          if (/^(to|cc|bcc|from)/.test(name)) return;
          const options = this.options ? [...this.options] : [];
          const target = options.find(o => /Anfrage\s*H[äa]ndler/i.test(o.text));
          if (target) {
            $s.val(target.value).trigger('change');
            console.log('[HW24 Provider] Step1: Template selected via Select2:', target.text);
            found = true;
            return false;
          }
        });
        if (found) return true;
      }
    } catch (e) {
      console.log('[HW24 Provider] Step1: Select2 strategy failed:', e.message);
    }

    console.warn('[HW24 Provider] Step1: Template auto-selection failed');
    return false;
  }

  function setLanguageInStep1(container, lang) {
    console.log('[HW24 Provider] Step1: Setting language to', lang);
    const selects = container.querySelectorAll('select');
    for (const sel of selects) {
      const name = (sel.name || sel.id || '').toLowerCase();
      if (!/lang/i.test(name)) continue;
      const options = [...sel.options];
      // Find the right language option
      const langMap = { de: /de|deutsch|german/i, en: /en|english|englisch/i };
      const target = options.find(o => langMap[lang]?.test(o.text) || o.value.toLowerCase() === lang);
      if (target) {
        sel.value = target.value;
        fire(sel);
        try {
          const jq = window.jQuery || window.$;
          if (jq) jq(sel).val(target.value).trigger('change');
        } catch { /* ok */ }
        console.log('[HW24 Provider] Step1: Language set to', target.text);
        return;
      }
    }
    // Broader search: any select whose options include de/en
    for (const sel of selects) {
      const options = [...sel.options];
      if (options.some(o => /deutsch|german/i.test(o.text)) && options.some(o => /english|englisch/i.test(o.text))) {
        const target = options.find(o => lang === 'en' ? /en|english|englisch/i.test(o.text) : /de|deutsch|german/i.test(o.text));
        if (target) {
          sel.value = target.value;
          fire(sel);
          try { const jq = window.jQuery || window.$; if (jq) jq(sel).val(target.value).trigger('change'); } catch {}
          console.log('[HW24 Provider] Step1: Language set via broad match:', target.text);
          return;
        }
      }
    }
    console.log('[HW24 Provider] Step1: Language selector not found');
  }

  function setRecipientsInStep1(container, provider) {
    console.log('[HW24 Provider] Step1: Clearing recipients and prefilling provider To');

    const jq = window.jQuery || window.$;
    const toLower = (provider?.to || '').toLowerCase();
    const ccLower = (provider?.cc || '').toLowerCase();

    const isToKey = (key) => /(^|_)(to|toemail|toemailids|to_email|emailfield)(_|$)/.test(key) && !/(cc|bcc)/.test(key);
    const isCcKey = (key) => /(^|_)(cc|ccemail|ccemailids|cc_email|ccemailfield)(_|$)/.test(key);
    const isBccKey = (key) => /(^|_)(bcc|bccemail|bccemailids|bcc_email|bccemailfield)(_|$)/.test(key);

    // 1) Clear recipient selects in Step 1
    const selects = container.querySelectorAll('select');
    for (const sel of selects) {
      const key = ((sel.name || '') + ' ' + (sel.id || '')).toLowerCase();
      const recipientSelect = isToKey(key) || isCcKey(key) || isBccKey(key);
      if (!recipientSelect) continue;
      if (sel.multiple) {
        [...sel.options].forEach(o => { o.selected = false; });
      } else {
        sel.value = '';
      }
      fire(sel);
      if (jq) {
        try { jq(sel).val(sel.multiple ? [] : '').trigger('change'); } catch { /* ignore */ }
      }
    }

    // 2) Clear recipient inputs in Step 1
    const inputs = container.querySelectorAll('input[type="hidden"], input[type="text"], input:not([type])');
    const toCandidates = [];
    const ccCandidates = [];
    for (const input of inputs) {
      const key = ((input.name || '') + ' ' + (input.id || '')).toLowerCase();
      if (isToKey(key)) {
        input.value = '';
        fire(input);
        toCandidates.push(input);
      } else if (isCcKey(key) || isBccKey(key)) {
        input.value = '';
        fire(input);
        ccCandidates.push(input);
      }
    }

    // 3) Remove visible Select2 recipient tags if present
    const closeButtons = container.querySelectorAll('.select2-search-choice-close');
    for (const btn of closeButtons) {
      btn.click();
    }

    // 4) Prefill To with provider email
    for (const input of toCandidates) {
      input.value = provider.to;
      fire(input);
      if (jq) {
        try {
          const $input = jq(input);
          if ($input.data('select2')) {
            $input.select2('data', [{ id: provider.to, text: provider.to }]);
          } else {
            $input.val(provider.to).trigger('change');
          }
        } catch { /* ignore */ }
      }
    }

    // 5) Prefill CC if configured; otherwise keep CC empty
    for (const input of ccCandidates) {
      input.value = ccLower ? provider.cc : '';
      fire(input);
      if (jq) {
        try {
          const $input = jq(input);
          if ($input.data('select2')) {
            $input.select2('data', ccLower ? [{ id: provider.cc, text: provider.cc }] : []);
          } else {
            $input.val(ccLower ? provider.cc : '').trigger('change');
          }
        } catch { /* ignore */ }
      }
    }

    console.log('[HW24 Provider] Step1: Recipient reset/prefill complete', {
      expectedTo: toLower,
      expectedCc: ccLower || '(none)',
      toCandidates: toCandidates.length,
      ccOrBccCandidates: ccCandidates.length
    });
  }

  function clickStep1ComposeButton(container) {
    const allButtons = [...container.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn')];
    const composeBtn = allButtons.find(b => {
      const text = (b.textContent || b.value || '').toLowerCase().trim();
      return /compose|verfassen|next|weiter|^send$|^senden$|e-?mail/i.test(text);
    });
    if (composeBtn) {
      console.log('[HW24 Provider] Step1: Clicking compose button:', (composeBtn.textContent || composeBtn.value).trim().substring(0, 30));
      composeBtn.click();
      return true;
    }
    const submitBtn = container.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      console.log('[HW24 Provider] Step1: Clicking submit button');
      submitBtn.click();
      return true;
    }
    console.warn('[HW24 Provider] Step1: Compose/submit button not found');
    return false;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 5: STEP 2 — COMPOSE EMAIL CONTAINER DETECTION
     ═══════════════════════════════════════════════════════════════════════════ */

  function findComposeContainer() {
    const selectors = [
      '#composeEmailContainer',
      '.SendEmailFormStep2',
      '#sendEmailFormStep2',
      '.modelContainer',
      '.modal.in',
      '.modal.show',
      '[role="dialog"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.querySelector('.cke, [id^="cke_"], .cke_editable, textarea.ckEditorSource')) {
        return el;
      }
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 6: STEP 2 — RECIPIENT SETTING (From, To, CC)
     ═══════════════════════════════════════════════════════════════════════════
     1. Set From to office@hardwarewartung.com
     2. Clear existing To (customer email — would go to wrong person!)
     3. Set To to provider email
     4. Set CC to provider CC (if any)
     ═══════════════════════════════════════════════════════════════════════════ */

  function _debugLogAllSelects(container) {
    const allSelects = container.querySelectorAll('select');
    console.log('[HW24 Provider] Debug: All selects in compose (' + allSelects.length + '):');
    for (const s of allSelects) {
      const opts = [...s.options].map(o => o.text.substring(0, 40));
      console.log('  name="' + s.name + '" id="' + s.id + '" multiple=' + s.multiple + ' opts(' + s.options.length + '):', opts.join(' | '));
    }
  }

  function setFromEmail(container) {
    console.log('[HW24 Provider] Step2: Setting From to office@hardwarewartung.com');
    const jq = window.jQuery || window.$;
    const TARGET = 'office@hardwarewartung.com';

    const allSelects = container.querySelectorAll('select');
    _debugLogAllSelects(container);

    // Strategy 1: Select with name containing "from" (not starting with to/cc/bcc)
    for (const sel of allSelects) {
      const name = (sel.name || '').toLowerCase();
      const id = (sel.id || '').toLowerCase();
      if (name.startsWith('to') || name.startsWith('cc') || name.startsWith('bcc')) continue;
      if (!(name.includes('from') || id.includes('from'))) continue;
      const options = [...sel.options];
      const officeOpt = options.find(o => o.text.includes(TARGET) || o.value.includes(TARGET));
      if (officeOpt) {
        sel.value = officeOpt.value;
        fire(sel);
        if (jq) { try { jq(sel).val(officeOpt.value).trigger('change'); } catch (e) { /* ok */ } }
        console.log('[HW24 Provider] Step2: From set to', TARGET, 'via select name=' + sel.name);
        return true;
      }
      console.log('[HW24 Provider] Step2: From select found (name=' + sel.name + ') but no office@ option. Options:',
        options.map(o => o.text.substring(0, 50)).join(' | '));
    }

    // Strategy 2: Any single-select (not multiple) where an option contains "office@"
    for (const sel of allSelects) {
      if (sel.multiple) continue; // From is always single-select
      const name = (sel.name || '').toLowerCase();
      if (name.startsWith('to') || name.startsWith('cc') || name.startsWith('bcc')) continue;
      const options = [...sel.options];
      const officeOpt = options.find(o => o.text.includes(TARGET) || o.value.includes(TARGET));
      if (officeOpt) {
        sel.value = officeOpt.value;
        fire(sel);
        if (jq) { try { jq(sel).val(officeOpt.value).trigger('change'); } catch (e) { /* ok */ } }
        console.log('[HW24 Provider] Step2: From set via option scan on select name=' + sel.name);
        return true;
      }
    }

    // Strategy 3: Look for a label "From" and find the associated select
    const labels = container.querySelectorAll('label, .fieldLabel, td, .control-label');
    for (const label of labels) {
      const text = label.textContent.trim().toLowerCase();
      if (text === 'from' || text === 'from:' || text === 'von' || text === 'von:' || text === 'absender') {
        const row = label.closest('.row, tr, .form-group, .control-group') || label.parentElement;
        const sel = row?.querySelector('select');
        if (sel) {
          const options = [...sel.options];
          const officeOpt = options.find(o => o.text.includes(TARGET) || o.value.includes(TARGET));
          if (officeOpt) {
            sel.value = officeOpt.value;
            fire(sel);
            if (jq) { try { jq(sel).val(officeOpt.value).trigger('change'); } catch (e) { /* ok */ } }
            console.log('[HW24 Provider] Step2: From set via label "' + text + '"');
            return true;
          }
        }
      }
    }

    console.warn('[HW24 Provider] Step2: Could not set From email — no select with office@ option found');
    return false;
  }

  function setComposeRecipients(container, provider) {
    console.log('[HW24 Provider] Step2: Setting recipients...');

    const jq = window.jQuery || window.$;

    // --- FROM: Set to office@hardwarewartung.com ---
    setFromEmail(container);

    // --- TO: Clear existing customer email, then set provider.to ---
    _clearAndSetToField(container, jq, provider.to);

    // --- CC: Set if provider has CC ---
    if (provider.cc) {
      setTimeout(() => {
        // Make CC visible first — find "Add Cc" link/button
        const allClickables = [...container.querySelectorAll('a, button, span')];
        for (const el of allClickables) {
          if (/add\s*cc|cc\s*hinzu/i.test(el.textContent.trim())) {
            el.click();
            console.log('[HW24 Provider] Step2: Clicked "Add Cc"');
            break;
          }
        }
        setTimeout(() => {
          _addEmailToField(container, jq, 'cc', provider.cc);
        }, 400);
      }, 600);
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     EMAILMaker uses Select2 v3.x on <input> elements (NOT <select>):

     To field DOM structure:
       <input id="emailField" name="toEmail" class="autoComplete sourceField select2 select2-offscreen">
       <div id="s2id_emailField" class="select2-container select2-container-multi">
         <ul class="select2-choices ui-sortable">
           <li class="select2-search-choice">
             <div>Customer Name (email@example.com)</div>
             <a class="select2-search-choice-close" href="#" tabindex="-1"></a>
           </li>
           <li class="select2-search-field ui-sortable-handle">
             <input class="select2-input" placeholder="Type and Search">
           </li>
         </ul>
       </div>

     CC field: similar, inside <div class="row hide ccContainer ccEmailField">
     ───────────────────────────────────────────────────────────────────────── */

  /**
   * Find the email input for a recipient field (To or CC).
   * EMAILMaker uses <input> with Select2, not <select>.
   */
  function _findEmailInput(container, field) {
    // To field: input#emailField, name="toEmail"
    // CC field: likely inside .ccContainer, name containing "cc"
    const nameVariants = {
      to: ['toEmail', 'toemail', 'to', 'toemailids', 'to_email'],
      cc: ['ccEmail', 'ccemail', 'cc', 'ccemailids', 'cc_email']
    };
    const variants = nameVariants[field] || [field, field + 'Email', field + 'email'];

    for (const name of variants) {
      const input = container.querySelector('input[name="' + name + '"]');
      if (input) {
        console.log('[HW24 Provider] Found ' + field + ' input via name="' + name + '" id="' + input.id + '"');
        return input;
      }
    }

    // ID-based: emailField for To, ccEmailField for CC
    const idVariants = {
      to: ['emailField', 'toEmailField'],
      cc: ['ccEmailField', 'ccemailField']
    };
    const ids = idVariants[field] || [];
    for (const id of ids) {
      const input = container.querySelector('#' + id);
      if (input) {
        console.log('[HW24 Provider] Found ' + field + ' input via id="' + id + '"');
        return input;
      }
    }

    // Row-based: find by container class
    if (field === 'cc') {
      const ccRow = container.querySelector('.ccContainer, .ccEmailField, [class*="ccContainer"]');
      if (ccRow) {
        const input = ccRow.querySelector('input.select2-offscreen, input[type="text"]');
        if (input) {
          console.log('[HW24 Provider] Found cc input inside .ccContainer');
          return input;
        }
      }
    }

    console.warn('[HW24 Provider] Could not find ' + field + ' input element');
    return null;
  }

  /**
   * Find the Select2 container for a given input element.
   * Select2 v3.x creates: <div id="s2id_{inputId}" class="select2-container">
   */
  function _findSelect2Container(input) {
    if (input.id) {
      const s2c = document.getElementById('s2id_' + input.id);
      if (s2c) return s2c;
    }
    // Fallback: the Select2 container is the next sibling or previous sibling
    const sibling = input.previousElementSibling || input.nextElementSibling;
    if (sibling && sibling.classList?.contains('select2-container')) return sibling;
    // Or find it in the same parent
    const parent = input.parentElement;
    if (parent) {
      const s2c = parent.querySelector('.select2-container');
      if (s2c) return s2c;
    }
    return null;
  }

  function _clearAndSetToField(container, jq, email) {
    console.log('[HW24 Provider] Step2: Clearing To and setting to', email);

    const toInput = _findEmailInput(container, 'to');

    // Hard reset of likely To backing fields before Select2 operations
    const toBackingInputs = container.querySelectorAll('input[type="hidden"], input[type="text"]');
    for (const el of toBackingInputs) {
      const key = (el.name || el.id || '').toLowerCase();
      if (!/(^|_)(to|toemail|toemailids)(_|$)/.test(key)) continue;
      el.value = '';
      fire(el);
    }

    // Strategy 1: Select2 v3.x jQuery API on the input
    if (toInput && jq) {
      const $input = jq(toInput);
      try {
        // Check if Select2 is initialized on this input
        const hasSelect2 = $input.data('select2');
        if (hasSelect2) {
          // Clear existing data
          $input.select2('data', []);
          console.log('[HW24 Provider] Step2: Cleared To via select2("data", [])');
          // Set new email
          $input.select2('data', [{ id: email, text: email }]);
          toInput.value = email;
          fire(toInput);
          console.log('[HW24 Provider] Step2: To set to', email, 'via select2("data")');
          return;
        }
      } catch (e) {
        console.log('[HW24 Provider] Step2: select2() API failed:', e.message, '— trying fallbacks');
      }
    }

    // Strategy 2: Click close buttons on existing Select2 tags, then type email
    if (toInput) {
      const s2container = _findSelect2Container(toInput);
      if (s2container) {
        // Click all "x" close buttons to remove existing recipients
        const closeBtns = s2container.querySelectorAll('.select2-search-choice-close');
        for (const btn of closeBtns) {
          btn.click();
          console.log('[HW24 Provider] Step2: Clicked select2-search-choice-close');
        }

        // Type into the Select2 search input
        setTimeout(() => {
          const searchInput = s2container.querySelector('.select2-search-field input, .select2-input, input.select2-input');
          if (searchInput) {
            searchInput.value = email;
            searchInput.focus();
            fire(searchInput);
            // Trigger Select2's internal search mechanism
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            // Wait briefly then press Enter to confirm the typed email
            setTimeout(() => {
              searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              console.log('[HW24 Provider] Step2: To typed + Enter in Select2 search');
            }, 400);
          } else {
            console.warn('[HW24 Provider] Step2: Select2 search input not found in container');
          }
        }, 300);
        return;
      }
    }

    // Strategy 3: Brute force — find ANY select2-search-choice-close not in CC/BCC row
    console.log('[HW24 Provider] Step2: Brute force — clicking close buttons outside CC/BCC');
    const allCloseBtns = container.querySelectorAll('.select2-search-choice-close');
    for (const btn of allCloseBtns) {
      const row = btn.closest('.row, .form-group');
      if (row && (row.classList.contains('ccContainer') || row.classList.contains('bccContainer')
        || row.classList.contains('ccEmailField') || row.classList.contains('bccEmailField'))) continue;
      btn.click();
      console.log('[HW24 Provider] Step2: Brute force removed a Select2 tag');
    }

    // Then find any select2 search field to type into
    setTimeout(() => {
      const searchInputs = container.querySelectorAll('.select2-search-field input, input.select2-input');
      for (const input of searchInputs) {
        const row = input.closest('.row, .form-group');
        if (row && (row.classList.contains('ccContainer') || row.classList.contains('bccContainer'))) continue;
        input.value = email;
        input.focus();
        fire(input);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }, 400);
        console.log('[HW24 Provider] Step2: Brute force typed email into first search input');
        break;
      }
    }, 300);
  }

  function _addEmailToField(container, jq, field, email) {
    console.log('[HW24 Provider] Step2: Adding', field, '=', email);

    const input = _findEmailInput(container, field);

    // Strategy 1: Select2 v3.x API
    if (input && jq) {
      const $input = jq(input);
      try {
        const hasSelect2 = $input.data('select2');
        if (hasSelect2) {
          const existing = $input.select2('data') || [];
          existing.push({ id: email, text: email });
          $input.select2('data', existing);
          console.log('[HW24 Provider] Step2:', field, 'added via select2("data")');
          return;
        }
      } catch (e) {
        console.log('[HW24 Provider] Step2: select2() API failed for', field, ':', e.message);
      }
    }

    // Strategy 2: Type into Select2 search input
    if (input) {
      const s2container = _findSelect2Container(input);
      if (s2container) {
        const searchInput = s2container.querySelector('.select2-search-field input, .select2-input');
        if (searchInput) {
          searchInput.value = email;
          searchInput.focus();
          fire(searchInput);
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => {
            searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }, 400);
          console.log('[HW24 Provider] Step2:', field, 'typed + Enter in Select2 search');
          return;
        }
      }
    }

    console.warn('[HW24 Provider] Step2: Could not add', field, '=', email);
  }

  async function ensureToRecipient(container, provider, maxAttempts = 3) {
    const jq = window.jQuery || window.$;
    const expectedTo = provider.to.toLowerCase();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      _clearAndSetToField(container, jq, provider.to);
      await sleep(900);

      const toEmails = getToEmailsFromCompose(container);
      const hasExpected = toEmails.includes(expectedTo);
      const extras = toEmails.filter(e => e !== expectedTo);

      console.log('[HW24 Provider] To verification attempt', attempt, {
        expectedTo,
        actualTo: toEmails
      });

      if (hasExpected && extras.length === 0) {
        return true;
      }
    }

    return false;
  }

  function extractEmails(text) {
    if (!text) return [];
    const matches = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const seen = new Set();
    const out = [];
    for (const m of matches) {
      const e = m.trim().toLowerCase();
      if (!seen.has(e)) {
        seen.add(e);
        out.push(e);
      }
    }
    return out;
  }

  function getToEmailsFromCompose(container) {
    const jq = window.jQuery || window.$;
    const emails = new Set();

    const toInput = _findEmailInput(container, 'to');
    if (toInput) {
      extractEmails(toInput.value).forEach(e => emails.add(e));

      const s2container = _findSelect2Container(toInput);
      if (s2container) {
        const tagTexts = s2container.querySelectorAll('.select2-search-choice div, .select2-chosen');
        for (const el of tagTexts) {
          extractEmails(el.textContent).forEach(e => emails.add(e));
        }
      }

      if (jq) {
        try {
          const data = jq(toInput).select2('data') || [];
          const arr = Array.isArray(data) ? data : [data];
          for (const item of arr) {
            extractEmails(item?.id || '').forEach(e => emails.add(e));
            extractEmails(item?.text || '').forEach(e => emails.add(e));
          }
        } catch { /* select2 data not available */ }
      }
    }

    // Additional safety: look for hidden inputs often used for submit values
    const hiddenCandidates = container.querySelectorAll('input[type="hidden"], input[type="text"]');
    for (const el of hiddenCandidates) {
      const n = (el.name || el.id || '').toLowerCase();
      if (!/(^|_)(to|toemail|toemailids)(_|$)/.test(n)) continue;
      extractEmails(el.value).forEach(e => emails.add(e));
    }

    return [...emails];
  }

  function isSendActionControl(el) {
    if (!el) return false;
    const ctrl = el.closest('button, input[type="submit"], input[type="button"], a.btn, a');
    if (!ctrl) return false;
    const text = (ctrl.textContent || ctrl.value || ctrl.getAttribute('title') || '').toLowerCase().trim();
    if (!text) return false;
    if (!/\b(send|senden)\b/.test(text)) return false;
    if (/compose|emailmaker|template|weiter|next|abbrechen|cancel|close|schlie/.test(text)) return false;
    return true;
  }

  function installSendSafetyGuard(container, provider) {
    if (!container || !provider?.to) return;

    // Keep expected recipient up-to-date for this compose instance
    container.__hw24ExpectedTo = provider.to.toLowerCase();
    container.__hw24ExpectedLabel = provider.label || provider.to;

    if (container.__hw24SendGuardInstalled) return;
    container.__hw24SendGuardInstalled = true;

    const validateAndBlockIfNeeded = (event) => {
      const expectedTo = container.__hw24ExpectedTo;
      if (!expectedTo) return true;

      const toEmails = getToEmailsFromCompose(container);
      const hasExpected = toEmails.includes(expectedTo);
      const invalidExtras = toEmails.filter(e => e !== expectedTo);

      if (!hasExpected || invalidExtras.length > 0) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();

        console.error('[HW24 Provider] SEND BLOCKED: recipient safety check failed', {
          expectedTo,
          actualTo: toEmails,
          provider: container.__hw24ExpectedLabel
        });

        alert(
          'Senden wurde aus Sicherheitsgründen blockiert.\n\n' +
          'Erwarteter Empfänger (To): ' + expectedTo + '\n' +
          'Gefundene Empfänger (To): ' + (toEmails.length ? toEmails.join(', ') : '(leer)') + '\n\n' +
          'Bitte To-Feld korrigieren und erneut senden.'
        );
        return false;
      }

      console.log('[HW24 Provider] Recipient safety check passed', {
        expectedTo,
        actualTo: toEmails
      });
      return true;
    };

    // Guard click on send buttons/links (capture phase to run first)
    container.addEventListener('click', (e) => {
      if (!isSendActionControl(e.target)) return;
      validateAndBlockIfNeeded(e);
    }, true);

    // Guard form submit as second line of defense
    const forms = container.querySelectorAll('form');
    forms.forEach(form => {
      form.addEventListener('submit', (e) => {
        validateAndBlockIfNeeded(e);
      }, true);
    });

    console.log('[HW24 Provider] Send safety guard installed for expected To:', container.__hw24ExpectedTo);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 7: STEP 2 — EMAIL BODY FILLING
     ═══════════════════════════════════════════════════════════════════════════
     The template "Anfrage Händler" already generates:
       - Greeting (with placeholder name)
       - Intro line "bitte um ein Angebot für folgende Anfrage:"
       - Description text (from template variable $potential_description$)
       - Closing formula (Liebe Grüße / Mit freundlichen Grüßen)
       - Signature (if "Include Signature" is checked)

     So we only need to:
       1. Click "Include Signature" (so signature + Vorname are available)
       2. Replace greeting with provider-specific greeting
       3. Insert description ONLY if the template doesn't already have it
       4. Adjust closing formula (Grüße + Vorname for PerDu)
     ═══════════════════════════════════════════════════════════════════════════ */

  function replaceGreeting(html, provider) {
    const patterns = [
      /Hallo[^,<\n]*,/,
      /Sehr geehrte[^,<\n]*,/,
      /Hello[^,<\n]*,/,
      /Dear[^,<\n]*,/,
      /Hi[^,<\n]*,/,
      /Guten Tag[^,<\n]*,/
    ];
    for (const pattern of patterns) {
      if (pattern.test(html)) {
        html = html.replace(pattern, provider.greeting);
        console.log('[HW24 Provider] Greeting replaced with:', provider.greeting);
        return html;
      }
    }
    console.log('[HW24 Provider] No greeting pattern found to replace');
    return html;
  }

  function extractUserFirstName(html) {
    const NOT_NAMES = ['Ihr', 'Dein', 'Das', 'Die', 'Der', 'Den', 'Dem', 'Ein', 'Eine', 'Mit',
      'Von', 'Und', 'Oder', 'Aber', 'Wenn', 'Wir', 'Uns', 'Unser', 'Service', 'Team', 'The',
      'Your', 'Our', 'Best', 'Kind', 'Dear', 'Sent', 'From', 'Tel', 'Fax', 'Web', 'Mob',
      'Liebe', 'Viele'];

    const closingRe = /(?:Mit freundlichen Gr(?:ü|&uuml;)(?:ß|&szlig;|ss)en|Liebe Gr(?:ü|&uuml;)(?:ß|&szlig;|ss)e|Kind regards|Best regards)/i;
    const closingMatch = html.match(closingRe);
    if (!closingMatch) {
      console.log('[HW24 Provider] No closing formula found for name extraction');
      return '';
    }

    const afterClosing = html.substring(closingMatch.index + closingMatch[0].length);

    // Strategy 1: bold/strong tag
    const boldMatch = afterClosing.match(/<(?:b|strong|span)[^>]*>\s*([A-Z\u00C0-\u017E][a-z\u00E0-\u017E]+)(?:\s+[A-Z\u00C0-\u017E][\w\u00C0-\u024F]*)?/);
    if (boldMatch && !NOT_NAMES.includes(boldMatch[1])) {
      console.log('[HW24 Provider] User first name from bold:', boldMatch[1]);
      return boldMatch[1];
    }

    // Strategy 2: name after <br> or </p><p>
    const brMatch = afterClosing.match(/(?:<br\s*\/?>[\s]*(?:<br\s*\/?>)?|<\/p>\s*<p[^>]*>)\s*(?:<[^>]*>)*\s*([A-Z\u00C0-\u017E][a-z\u00E0-\u017E]+)(?:\s+[A-Z\u00C0-\u017E][\w\u00C0-\u024F]*)?/);
    if (brMatch && !NOT_NAMES.includes(brMatch[1])) {
      console.log('[HW24 Provider] User first name from br:', brMatch[1]);
      return brMatch[1];
    }

    console.log('[HW24 Provider] User first name not found in signature');
    return '';
  }

  /**
   * Click the "Include Signature" checkbox/button to load the email signature.
   * IMPORTANT: Must move CKEditor cursor to end FIRST, otherwise signature
   * gets inserted at position 0 (top of email) instead of at the bottom.
   */
  function clickIncludeSignature(container) {
    // Strategy 1: Checkbox (most common in EMAILMaker)
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    for (const cb of checkboxes) {
      const wrapper = cb.closest('label, div, span') || cb.parentElement;
      const wrapperText = wrapper?.textContent || '';
      const cbName = (cb.name || cb.id || '').toLowerCase();
      if (/include.*signature|signatur/i.test(wrapperText) || /signature|signatur/i.test(cbName)) {
        if (!cb.checked) {
          cb.click();
          console.log('[HW24 Provider] Checked "Include Signature" checkbox');
        } else {
          console.log('[HW24 Provider] "Include Signature" already checked');
        }
        return true;
      }
    }

    // Strategy 2: Button/link
    const allClickables = [...container.querySelectorAll('button, a, input[type="button"]')];
    const sigBtn = allClickables.find(el => /include.*signature|signatur.*einf/i.test(el.textContent));
    if (sigBtn) {
      sigBtn.click();
      console.log('[HW24 Provider] Clicked "Include Signature" button');
      return true;
    }

    console.log('[HW24 Provider] "Include Signature" button/checkbox not found');
    return false;
  }

  /**
   * Check if the description text is already present in the email body.
   * The template "Anfrage Händler" includes it via $potential_description$.
   * Uses aggressive normalization to handle HTML entities vs plain text mismatches.
   */
  function descriptionAlreadyInBody(html, descText) {
    if (!descText) return true; // nothing to insert

    const normalize = s => s
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
      .replace(/&auml;/gi, '\u00e4').replace(/&ouml;/gi, '\u00f6').replace(/&uuml;/gi, '\u00fc')
      .replace(/&Auml;/gi, '\u00c4').replace(/&Ouml;/gi, '\u00d6').replace(/&Uuml;/gi, '\u00dc')
      .replace(/&szlig;/gi, '\u00df').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/\s+/g, ' ').trim().toLowerCase();

    const plainBody = normalize(html);

    // Check individual lines of the raw description
    const lines = descText.split('\n').map(l => l.trim()).filter(l => l.length > 10);
    for (const line of lines.slice(0, 5)) {
      const normalizedLine = normalize(line);
      if (normalizedLine.length > 10 && plainBody.includes(normalizedLine)) return true;
    }

    // Fallback: check first 40 chars of the full normalized description
    const plainDesc = normalize(descText);
    if (plainDesc.length > 20) {
      const snippet = plainDesc.substring(0, 40);
      if (plainBody.includes(snippet)) return true;
    }

    return false;
  }

  async function fillEmailBody(provider) {
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Filling email for', config.label, '| style:', config.style, '| lang:', config.lang);

    const composeContainer = findComposeContainer() || document.body;

    // Step A: Move CKEditor cursor to END of document before inserting signature.
    // Without this, "Include Signature" inserts at position 0 (top of email).
    const ck = getCKEditorInstance();
    if (ck) {
      try {
        const range = ck.createRange();
        range.moveToElementEditEnd(ck.editable());
        ck.getSelection().selectRanges([range]);
        console.log('[HW24 Provider] Cursor moved to end of CKEditor');
      } catch (e) {
        console.warn('[HW24 Provider] Could not move cursor to end:', e.message);
        // Fallback: try via native selection on the iframe
        try {
          const iframe = composeContainer.querySelector('iframe.cke_wysiwyg_frame');
          if (iframe && iframe.contentWindow) {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const sel = iframe.contentWindow.getSelection();
            sel.selectAllChildren(iframeDoc.body);
            sel.collapseToEnd();
            console.log('[HW24 Provider] Cursor moved to end via iframe selection');
          }
        } catch (e2) {
          console.warn('[HW24 Provider] Iframe fallback also failed:', e2.message);
        }
      }
    }

    // Step B: Click "Include Signature" — now inserts at END (correct position)
    clickIncludeSignature(composeContainer);
    await sleep(1000); // Wait for signature to be inserted into CKEditor

    let data = readEmailHTML();
    if (!data) {
      console.warn('[HW24 Provider] Email body not found, retrying...');
      await sleep(1500);
      data = readEmailHTML();
      if (!data) {
        console.error('[HW24 Provider] Email body not found after retry');
        return;
      }
    }

    const { body, html } = data;
    let result = html;
    console.log('[HW24 Provider] Email body length:', result.length);

    // Extract user first name from signature BEFORE modifications
    const userFirstName = extractUserFirstName(result);

    // 1. Replace greeting with provider-specific greeting
    result = replaceGreeting(result, config);

    // 2. Check if description text is already in the body (from template variable)
    //    If yes → template handled it, don't insert again
    //    If no → we need to insert it
    const descAlready = descriptionAlreadyInBody(result, pendingDescriptionText);
    if (descAlready) {
      console.log('[HW24 Provider] Description already in template — skipping insertion');
    } else {
      console.log('[HW24 Provider] Description NOT in template — inserting');
      // Insert after greeting: intro line + description
      const introLine = config.lang === 'en'
        ? 'please provide a quote for the following request:'
        : 'bitte um ein Angebot für folgende Anfrage:';

      // Build a simple text block
      let insertText = introLine + '\n\n' + pendingDescriptionText;
      let insertHTML = '<p>' + insertText.split('\n').join('<br>') + '</p>';

      // Try to insert after greeting
      const closingRe = /(<p[^>]*>(?:<[^>]*>)*\s*(?:Liebe Gr(?:ü|&uuml;)(?:ß|&szlig;|ss)e|Mit freundlichen Gr(?:ü|&uuml;)(?:ß|&szlig;|ss)en|Kind regards|Best regards)\b)/i;
      const closingMatch = result.match(closingRe);
      if (closingMatch) {
        const idx = result.indexOf(closingMatch[0]);
        result = result.substring(0, idx) + insertHTML + result.substring(idx);
      } else {
        // Don't append at end — would land after the signature.
        // If closing formula not found, template likely already has the description.
        console.log('[HW24 Provider] Closing formula not found — skipping description insertion to avoid duplication after signature');
      }
    }

    // 3. Apply closing formula (Grüße + Vorname for PerDu)
    if (config.style === 'du') {
      // Replace MfG → Liebe Grüße
      result = result.replace(/Mit freundlichen Gr(?:ü|&uuml;)(?:ß|&szlig;|ss)en/g, 'Liebe Grüße');
      if (userFirstName) {
        if (config.lang === 'en') {
          // English: Kind regards + Vorname
          result = result.replace(/(Kind regards|Best regards)/i, `$1<br>${userFirstName}`);
        } else {
          // German: Liebe Grüße + Vorname
          result = result.replace(/(Liebe Gr(?:ü|&uuml;)(?:ß|&szlig;|ss)e)(?!<br>)/g, `$1<br>${userFirstName}`);
        }
        console.log('[HW24 Provider] Closing formula + Vorname:', userFirstName);
      } else {
        console.log('[HW24 Provider] Closing formula: Liebe Grüße (no Vorname found)');
      }
    }
    // style === 'sie': keep "Mit freundlichen Grüßen", no extra Vorname

    // Write back
    writeEmailHTML(body, result);
    if (body.type === 'ckeditor') body.editor.fire('change');

    console.log('[HW24 Provider] Email body filled successfully');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 8: PROVIDER INFO TOOLBAR IN COMPOSE DIALOG
     ═══════════════════════════════════════════════════════════════════════════ */

  function injectProviderEmailToolbar(container, provider) {
    if (document.getElementById(COMPOSE_TOOLBAR_ID)) {
      const statusEl = document.querySelector(`#${COMPOSE_TOOLBAR_ID} .hw24-provider-status`);
      if (statusEl) statusEl.textContent = '\u2705 Fertig';
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.id = COMPOSE_TOOLBAR_ID;
    const isDealer = pendingType === 'dealer';
    toolbar.style.cssText = 'padding:8px 12px;background:' + (isDealer ? 'linear-gradient(135deg,#e0f2fe 0%,#bae6fd 100%)' : 'linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%)') + ';border-bottom:1px solid ' + (isDealer ? '#0284c7' : '#8b5cf6') + ';display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;font-family:system-ui,-apple-system,sans-serif;z-index:1001;';

    const label = document.createElement('span');
    label.style.cssText = 'font-weight:600;color:' + (isDealer ? '#075985' : '#5b21b6') + ';';
    label.textContent = (isDealer ? '\uD83D\uDED2 H\u00e4ndler: ' : '\uD83D\uDCE8 Provider: ') + provider.label + ' (' + provider.key + ')';
    toolbar.appendChild(label);

    const sep = document.createElement('span');
    sep.textContent = ' \u2014 ';
    sep.style.color = isDealer ? '#0369a1' : '#7c3aed';
    toolbar.appendChild(sep);

    const status = document.createElement('span');
    status.className = 'hw24-provider-status';
    status.style.cssText = 'color:' + (isDealer ? '#0c4a6e' : '#6d28d9') + ';font-style:italic;';
    status.textContent = '\u23F3 Wird vorbereitet...';
    toolbar.appendChild(status);

    // Insert above existing lineitem-tools toolbar, or at top of compose area
    const existingToolbar = container.querySelector('#hw24-email-toolbar');
    if (existingToolbar) {
      existingToolbar.parentNode.insertBefore(toolbar, existingToolbar);
    } else {
      const modalBody = container.querySelector('.modal-body');
      if (modalBody) {
        const editorWrap = modalBody.querySelector('.cke, .cke_inner, .cke_top, #cke_description, #cke_email_body');
        if (editorWrap) {
          editorWrap.parentNode.insertBefore(toolbar, editorWrap);
        } else {
          modalBody.insertBefore(toolbar, modalBody.firstChild);
        }
      } else {
        container.insertBefore(toolbar, container.firstChild);
      }
    }
  }

  function updateProviderEmailToolbarStatus(text) {
    const statusEl = document.querySelector(`#${COMPOSE_TOOLBAR_ID} .hw24-provider-status`);
    if (statusEl) statusEl.textContent = text;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 9: MUTATION OBSERVER — TWO-POPUP ORCHESTRATION
     ═══════════════════════════════════════════════════════════════════════════
     Flow:
       1. User clicks provider button → triggerEMAILMakerCompose()
       2. POPUP 1 (Step 1): select template + language, click "Compose Email"
       3. POPUP 2 (Step 2): clear To, set From/To/CC, fill email body
     ═══════════════════════════════════════════════════════════════════════════ */

  async function handleStep1Detected(container) {
    if (!pendingProvider || step1Handled) return;
    step1Handled = true;

    const provider = pendingProvider;
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Step 1 popup detected for:', provider.label);

    try {
      await sleep(500); // Let the popup fully render

      // Select template "Anfrage Händler"
      await selectTemplateInStep1(container);
      await sleep(300);

      // Set language
      setLanguageInStep1(container, config.lang);
      await sleep(300);

      // Safety-critical: clear end-customer recipients already in Step 1
      setRecipientsInStep1(container, config);
      await sleep(300);

      // Click "Compose Email" to proceed to Step 2
      clickStep1ComposeButton(container);
      console.log('[HW24 Provider] Step 1 complete — waiting for Step 2...');

    } catch (err) {
      console.error('[HW24 Provider] Step 1 error:', err);
      markCurrentButton(provider.key, 'error');
    }
  }

  async function handleStep2Detected(container) {
    if (!pendingProvider) return;

    const provider = pendingProvider;
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Step 2 compose popup detected for:', provider.label);

    injectProviderEmailToolbar(container, config);
    installSendSafetyGuard(container, config);

    try {
      // Wait for CKEditor content to load
      updateProviderEmailToolbarStatus('\u23F3 Template wird geladen...');
      try {
        await waitFor(() => {
          const ck = getCKEditorInstance();
          if (!ck) return false;
          try { return ck.getData().length > 50; } catch { return false; }
        }, 300, 15000);
      } catch {
        console.warn('[HW24 Provider] Timeout waiting for CKEditor content — proceeding anyway');
      }

      // Set recipients (clear To first, then set From/To/CC)
      updateProviderEmailToolbarStatus('\u23F3 Empfänger werden gesetzt...');
      setComposeRecipients(container, config);
      await sleep(config.cc ? 1500 : 500);

      // Hard verify To recipient and retry if needed
      updateProviderEmailToolbarStatus('\u23F3 Empfänger werden verifiziert...');
      const toOk = await ensureToRecipient(container, config, 4);
      if (!toOk) {
        const toEmails = getToEmailsFromCompose(container);
        throw new Error('To-Empfänger konnte nicht sicher gesetzt werden. Erwartet: ' + config.to + ' | Aktuell: ' + (toEmails.join(', ') || '(leer)'));
      }

      // Fill email body
      updateProviderEmailToolbarStatus('\u23F3 E-Mail wird befüllt...');
      await fillEmailBody(provider);

      // Done
      updateProviderEmailToolbarStatus('\u2705 Fertig — bitte prüfen & senden');
      markCurrentButton(provider.key, 'done');
      console.log('[HW24 Provider] Email preparation complete for', provider.label);

    } catch (err) {
      console.error('[HW24 Provider] Step 2 error:', err);
      updateProviderEmailToolbarStatus('\u274C Fehler: ' + err.message);
      markCurrentButton(provider.key, 'error');
    }

    pendingProvider = null;
    pendingType = null;
    step1Handled = false;
  }

  function initComposeObserver() {
    function tryDetectStep1() {
      if (!pendingProvider || step1Handled) return;
      const container = findStep1Container();
      if (!container) return;
      handleStep1Detected(container);
    }

    function tryDetectStep2() {
      if (!pendingProvider) return;
      if (document.getElementById(COMPOSE_TOOLBAR_ID)) return;
      const container = findComposeContainer();
      if (!container) return;
      handleStep2Detected(container);
    }

    function tryDetectAny() {
      tryDetectStep2();
      tryDetectStep1();
    }

    const scheduleRetries = () => {
      setTimeout(tryDetectAny, 300);
      setTimeout(tryDetectAny, 800);
      setTimeout(tryDetectAny, 1500);
      setTimeout(tryDetectAny, 3000);
      setTimeout(tryDetectAny, 5000);
    };

    const observer = new MutationObserver(mutations => {
      if (!pendingProvider) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const isDialog = node.classList?.contains('SendEmailFormStep1')
            || node.classList?.contains('SendEmailFormStep2')
            || node.id === 'composeEmailContainer'
            || node.classList?.contains('modelContainer')
            || node.matches?.('.modal, [role="dialog"]');

          const hasDialog = !isDialog && (
            node.querySelector?.('.SendEmailFormStep1, .SendEmailFormStep2, #composeEmailContainer, .cke, [id^="cke_"]')
          );

          if (isDialog || hasDialog) {
            scheduleRetries();
          }
        }

        if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
          const t = mutation.target;
          if (t.classList?.contains('SendEmailFormStep1') || t.classList?.contains('SendEmailFormStep2')
            || t.id === 'composeEmailContainer' || t.classList?.contains('modal')
            || t.classList?.contains('modelContainer')) {
            scheduleRetries();
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

    // Fallback polling
    const poll = setInterval(() => {
      if (!pendingProvider) return;
      tryDetectAny();
    }, 2000);
    setTimeout(() => clearInterval(poll), 600000);

    console.log('[HW24 Provider] Two-popup observer initialized');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 10: DETAIL VIEW TOOLBAR (Provider Buttons)
     ═══════════════════════════════════════════════════════════════════════════ */

  function markDetailButton(providerKey, state) {
    const btn = document.getElementById('hw24-provider-btn-' + providerKey);
    if (!btn) return;
    if (state === 'loading') {
      btn.disabled = true;
      btn.dataset.origLabel = btn.textContent;
      btn.textContent = '\u23F3 läuft...';
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';
    } else if (state === 'done') {
      btn.disabled = true;
      btn.textContent = '\u2705 ' + (btn.dataset.origLabel || btn.textContent);
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.style.background = '#d1fae5';
      btn.style.borderColor = '#059669';
    } else if (state === 'error') {
      btn.disabled = false;
      btn.textContent = '\u274C ' + (btn.dataset.origLabel || btn.textContent);
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.style.background = '#fee2e2';
      btn.style.borderColor = '#dc2626';
    }
  }

  function markDealerButton(dealerKey, state) {
    const btn = document.getElementById('hw24-dealer-btn-' + dealerKey);
    if (!btn) return;
    if (state === 'loading') {
      btn.disabled = true;
      btn.dataset.origLabel = btn.textContent;
      btn.textContent = '\u23F3 l\u00e4uft...';
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';
    } else if (state === 'done') {
      btn.disabled = true;
      btn.textContent = '\u2705 ' + (btn.dataset.origLabel || btn.textContent);
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.style.background = '#d1fae5';
      btn.style.borderColor = '#059669';
    } else if (state === 'error') {
      btn.disabled = false;
      btn.textContent = '\u274C ' + (btn.dataset.origLabel || btn.textContent);
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.style.background = '#fee2e2';
      btn.style.borderColor = '#dc2626';
    }
  }

  function markCurrentButton(key, state) {
    if (pendingType === 'dealer') markDealerButton(key, state);
    else markDetailButton(key, state);
  }

  function handleProviderClick(provider) {
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Provider clicked:', config.label, '| To:', config.to, '| CC:', config.cc, '| Style:', config.style, '| Lang:', config.lang);

    // Cache description from detail view BEFORE opening popup
    pendingDescriptionText = readDescriptionText();
    console.log('[HW24 Provider] Description cached, length:', pendingDescriptionText.length);

    // Set pending provider + reset step tracking
    pendingProvider = { ...provider };
    pendingType = 'provider';
    step1Handled = false;

    // Mark button as loading
    markCurrentButton(provider.key, 'loading');

    // Post comment on the record (async, don't block)
    postRecordComment('Provider-Anfrage: ' + config.label + ' angefragt').then(ok => {
      if (ok) console.log('[HW24 Provider] Comment posted for', config.label);
      else console.warn('[HW24 Provider] Comment could not be posted');
    });

    // Trigger EMAILMaker — opens Popup 1 (Step 1)
    triggerEMAILMakerCompose();
  }

  function handleDealerClick(dealer) {
    console.log('[HW24 Dealer] Dealer clicked:', dealer.label, '| To:', dealer.to, '| CC:', dealer.cc, '| Style:', dealer.style, '| Lang:', dealer.lang);

    // Cache description from detail view BEFORE opening popup
    pendingDescriptionText = readDescriptionText();
    console.log('[HW24 Dealer] Description cached, length:', pendingDescriptionText.length);

    // Set pending provider (reuse same flow) + type
    pendingProvider = { ...dealer };
    pendingType = 'dealer';
    step1Handled = false;

    // Mark button as loading
    markCurrentButton(dealer.key, 'loading');

    // Post comment on the record (async, don't block)
    postRecordComment('H\u00e4ndler-Anfrage: ' + dealer.label + ' angefragt').then(ok => {
      if (ok) console.log('[HW24 Dealer] Comment posted for', dealer.label);
      else console.warn('[HW24 Dealer] Comment could not be posted');
    });

    // Trigger EMAILMaker — opens Popup 1 (Step 1)
    triggerEMAILMakerCompose();
  }

  function injectDetailToolbar() {
    if (document.getElementById(DETAIL_TOOLBAR_ID)) return;

    // Find placement target — near "+ Add Tag" area
    let target = null;
    let insertMode = 'after';

    // Strategy 1: Find the "+ Add Tag" button/link
    const addTag = document.querySelector('.addTag, [class*="addTag"], a[href*="addTag"], [id*="addTag"]');
    if (addTag) {
      target = addTag.closest('div, span, td') || addTag.parentElement;
      insertMode = 'after';
      console.log('[HW24 Provider] Placing toolbar near + Add Tag');
    }

    // Strategy 2: Before the tab bar
    if (!target) {
      const tabBar = document.querySelector('.detailViewInfo .related-tabs, .tabContainer, ul.nav-tabs, .detailview-tab, [class*="relatedTabs"]');
      if (tabBar) {
        target = tabBar;
        insertMode = 'before';
        console.log('[HW24 Provider] Placing toolbar before tab bar');
      }
    }

    // Strategy 3: After record header block
    if (!target) {
      const headerBlock = document.querySelector('.detailViewInfo .recordDetails, .detailViewInfo > .row:first-child, .recordBasicInfo');
      if (headerBlock) {
        target = headerBlock;
        insertMode = 'after';
      }
    }

    // Strategy 4: Fallback
    if (!target) {
      target = document.querySelector('.detailViewTitle, .detailViewInfo');
      insertMode = 'after';
    }

    if (!target) {
      console.warn('[HW24 Provider] Detail view target element not found');
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.id = DETAIL_TOOLBAR_ID;
    toolbar.style.cssText = 'padding:8px 15px;background:linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%);border:1px solid #c4b5fd;border-radius:6px;margin:8px 15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;font-family:system-ui,-apple-system,sans-serif;';

    // Label
    const label = document.createElement('span');
    label.style.cssText = 'font-weight:700;color:#5b21b6;margin-right:4px;white-space:nowrap;';
    label.textContent = '\uD83D\uDCE8 Provider-Anfrage:';
    toolbar.appendChild(label);

    // Provider buttons
    for (const provider of PROVIDERS) {
      const btn = document.createElement('button');
      btn.id = 'hw24-provider-btn-' + provider.key;
      btn.type = 'button';
      btn.textContent = provider.label;
      btn.title = `E-Mail an ${provider.label} vorbereiten (${provider.to})`;
      btn.style.cssText = 'padding:5px 12px;font-size:12px;background:#fff;color:#1e293b;border:1px solid #8b5cf6;border-radius:4px;cursor:pointer;font-weight:500;transition:background 0.2s,border-color 0.2s;';
      btn.onmouseenter = () => { if (!btn.disabled) { btn.style.background = '#f5f3ff'; btn.style.borderColor = '#6d28d9'; } };
      btn.onmouseleave = () => { if (!btn.disabled) { btn.style.background = '#fff'; btn.style.borderColor = '#8b5cf6'; } };
      btn.onclick = () => handleProviderClick(provider);
      toolbar.appendChild(btn);

      // "Sie" checkbox toggle (unchecked = du/default, checked = Sie/formal)
      if (provider.hasSieToggle) {
        const pKey = provider.key;
        const toggleWrap = document.createElement('label');
        toggleWrap.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#6d28d9;cursor:pointer;margin-left:-4px;margin-right:2px;user-select:none;';
        toggleWrap.title = provider.label + ' formell (Sie) ansprechen (gespeichert)';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = getSieToggle(pKey);
        checkbox.style.cssText = 'cursor:pointer;accent-color:#7c3aed;';
        checkbox.onchange = () => {
          setSieToggle(pKey, checkbox.checked);
          console.log('[HW24 Provider]', provider.label, 'Sie toggled:', checkbox.checked);
        };

        const text = document.createTextNode('Sie');
        toggleWrap.appendChild(checkbox);
        toggleWrap.appendChild(text);
        toolbar.appendChild(toggleWrap);
      }
    }

    // Insert toolbar
    if (insertMode === 'before') {
      target.parentNode.insertBefore(toolbar, target);
    } else {
      if (target.nextSibling) {
        target.parentNode.insertBefore(toolbar, target.nextSibling);
      } else {
        target.parentNode.appendChild(toolbar);
      }
    }

    console.log('[HW24 Provider] Provider toolbar injected with', PROVIDERS.length, 'buttons');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 10b: DETAIL VIEW TOOLBAR (Dealer / Händler Buttons)
     ═══════════════════════════════════════════════════════════════════════════ */

  function injectDealerToolbar() {
    if (document.getElementById(DEALER_TOOLBAR_ID)) return;

    // Place directly after the provider toolbar if it exists, otherwise same strategy
    let target = document.getElementById(DETAIL_TOOLBAR_ID);
    let insertMode = 'after';

    if (!target) {
      const addTag = document.querySelector('.addTag, [class*="addTag"], a[href*="addTag"], [id*="addTag"]');
      if (addTag) {
        target = addTag.closest('div, span, td') || addTag.parentElement;
        insertMode = 'after';
      }
    }

    if (!target) {
      const tabBar = document.querySelector('.detailViewInfo .related-tabs, .tabContainer, ul.nav-tabs, .detailview-tab, [class*="relatedTabs"]');
      if (tabBar) {
        target = tabBar;
        insertMode = 'before';
      }
    }

    if (!target) {
      const headerBlock = document.querySelector('.detailViewInfo .recordDetails, .detailViewInfo > .row:first-child, .recordBasicInfo');
      if (headerBlock) {
        target = headerBlock;
        insertMode = 'after';
      }
    }

    if (!target) {
      target = document.querySelector('.detailViewTitle, .detailViewInfo');
      insertMode = 'after';
    }

    if (!target) {
      console.warn('[HW24 Dealer] Detail view target element not found');
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.id = DEALER_TOOLBAR_ID;
    toolbar.style.cssText = 'padding:8px 15px;background:linear-gradient(135deg,#e0f2fe 0%,#bae6fd 100%);border:1px solid #7dd3fc;border-radius:6px;margin:4px 15px 8px 15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;font-family:system-ui,-apple-system,sans-serif;';

    // Label
    const label = document.createElement('span');
    label.style.cssText = 'font-weight:700;color:#075985;margin-right:4px;white-space:nowrap;';
    label.textContent = '\uD83D\uDED2 H\u00e4ndler-Anfrage:';
    toolbar.appendChild(label);

    // Dealer buttons
    for (const dealer of DEALERS) {
      const btn = document.createElement('button');
      btn.id = 'hw24-dealer-btn-' + dealer.key;
      btn.type = 'button';
      btn.textContent = dealer.label;
      btn.title = 'E-Mail an ' + dealer.label + ' vorbereiten (' + dealer.to + ')';
      btn.style.cssText = 'padding:5px 12px;font-size:12px;background:#fff;color:#1e293b;border:1px solid #0284c7;border-radius:4px;cursor:pointer;font-weight:500;transition:background 0.2s,border-color 0.2s;';
      btn.onmouseenter = () => { if (!btn.disabled) { btn.style.background = '#e0f2fe'; btn.style.borderColor = '#0369a1'; } };
      btn.onmouseleave = () => { if (!btn.disabled) { btn.style.background = '#fff'; btn.style.borderColor = '#0284c7'; } };
      btn.onclick = () => handleDealerClick(dealer);
      toolbar.appendChild(btn);
    }

    // Insert toolbar
    if (insertMode === 'before') {
      target.parentNode.insertBefore(toolbar, target);
    } else {
      if (target.nextSibling) {
        target.parentNode.insertBefore(toolbar, target.nextSibling);
      } else {
        target.parentNode.appendChild(toolbar);
      }
    }

    console.log('[HW24 Dealer] Dealer toolbar injected with', DEALERS.length, 'buttons');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     INITIALIZATION
     ═══════════════════════════════════════════════════════════════════════════ */

  function init() {
    injectDetailToolbar();
    injectDealerToolbar();
    if (!document.getElementById(DETAIL_TOOLBAR_ID)) {
      setTimeout(injectDetailToolbar, 500);
      setTimeout(injectDetailToolbar, 1500);
      setTimeout(injectDetailToolbar, 3000);
    }
    if (!document.getElementById(DEALER_TOOLBAR_ID)) {
      setTimeout(injectDealerToolbar, 500);
      setTimeout(injectDealerToolbar, 1500);
      setTimeout(injectDealerToolbar, 3000);
    }
    initComposeObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
