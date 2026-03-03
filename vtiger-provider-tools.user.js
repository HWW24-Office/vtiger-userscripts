// ==UserScript==
// @name         VTiger Provider Tools
// @namespace    hw24.vtiger.provider.tools
// @version      1.1.0
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-provider-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-provider-tools.user.js
// @description  Provider-Anfragen: Vorbereitungs-Buttons für Provider-E-Mails auf Potentials
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const HW24_VERSION = '1.1.0';

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
     Axians has a "Sie" toggle (default = du, checkbox flips to formal).
     ═══════════════════════════════════════════════════════════════════════════ */

  const PROVIDERS = [
    { key: 'TG',    label: 'Evernex',    to: 'R.Voelzke@technogroup.com',  cc: '',                               greeting: 'Hallo Ronny,',       style: 'du',  lang: 'de', status: 'angefragt TG' },
    { key: 'CC',    label: 'Axians',     to: 'Michael.kienzle@axians.de',  cc: 'niklas.spranz@axians.de',        greeting: 'Hallo Michael,',     style: 'du',  lang: 'de', status: 'angefragt CC',
                                                                                                                   greetingSie: 'Hallo Herr Kienzle,', hasSieToggle: true },
    { key: 'PP',    label: 'Park Place', to: 'jchiaju@parkplacetech.com',  cc: 'partnersales@parkplacetech.com', greeting: 'Hallo Justine,',     style: 'du',  lang: 'de', status: 'angefragt PP' },
    { key: 'ITRIS', label: 'ITRIS',      to: 'kkroner@itris.de',           cc: '',                               greeting: 'Hallo Katrin,',      style: 'du',  lang: 'de', status: 'angefragt ITRIS' },
    { key: 'DIS',   label: 'DIS',        to: 'anfragen@dis-daten-it.de',   cc: '',                               greeting: 'Hallo Team,',        style: 'du',  lang: 'de', status: 'angefragt DIS' },
    { key: 'IDS',   label: 'IDS',        to: 'o.hermann@idsgmbh.com',      cc: '',                               greeting: 'Hallo Olga,',        style: 'du',  lang: 'de', status: 'angefragt IDS' },
    { key: 'Nordic', label: 'Nordic',    to: 'ksp@nordiccomputer.com',     cc: '',                               greeting: 'Hello Kevon,',       style: 'du',  lang: 'en', status: 'angefragt Nordic' },
    { key: 'TDS',   label: 'TD Synnex',  to: 'Sales.at@tdsynnex.com',      cc: '',                               greeting: 'Hallo Team,',        style: 'du',  lang: 'de', status: 'angefragt TD Synnex' },
  ];

  /* ═══════════════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  let pendingProvider = null;
  let pendingDescriptionText = '';  // cached from detail view before popup opens
  let step1Handled = false;

  // Axians "Sie" toggle: true = formal/Sie, false = du (default)
  let axiansSie = localStorage.getItem('hw24_provider_axians_sie') === 'true';

  const DETAIL_TOOLBAR_ID = 'hw24-provider-toolbar';
  const COMPOSE_TOOLBAR_ID = 'hw24-provider-email-toolbar';

  /* ═══════════════════════════════════════════════════════════════════════════
     PROVIDER CONFIG RESOLUTION
     ═══════════════════════════════════════════════════════════════════════════ */

  function resolveProviderConfig(provider) {
    if (provider.hasSieToggle && axiansSie) {
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
     MODULE 4: STEP 1 POPUP — TEMPLATE + LANGUAGE ONLY
     ═══════════════════════════════════════════════════════════════════════════
     The first popup has: To, CC, BCC, Template selector, Language selector.
     We ONLY set the template and language here.
     To/CC will be handled in Step 2 (compose popup).
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
     MODULE 6: STEP 2 — RECIPIENT SETTING (To, CC)
     ═══════════════════════════════════════════════════════════════════════════
     From is already set to office@hardwarewartung.com by default — don't touch.
     1. Clear existing To (customer email — would go to wrong person!)
     2. Set To to provider email
     3. Set CC to provider CC (if any)

     IMPORTANT: select[id*="to"] can accidentally match "from" selects too
     (e.g. id="fromto..." or similar). We use exact name-based selectors only.
     ═══════════════════════════════════════════════════════════════════════════ */

  function setComposeRecipients(container, provider) {
    console.log('[HW24 Provider] Step2: Setting recipients...');

    const jq = window.jQuery || window.$;

    // --- TO: Clear existing customer email, then set provider.to ---
    _clearAndSetToField(container, jq, provider.to);

    // --- CC: Set if provider has CC ---
    if (provider.cc) {
      setTimeout(() => {
        // Make CC visible first — find "Add Cc" link
        const addCcLinks = container.querySelectorAll('a');
        for (const a of addCcLinks) {
          if (/add\s*cc/i.test(a.textContent)) {
            a.click();
            console.log('[HW24 Provider] Step2: Clicked "Add Cc" link');
            break;
          }
        }
        setTimeout(() => {
          _addEmailToField(container, jq, 'cc', provider.cc);
        }, 400);
      }, 600);
    }
  }

  function _findSelectForField(container, jq, field) {
    if (!jq) return null;
    // Use EXACT name matching to avoid cross-matching (e.g. "to" matching "from")
    const exactSelectors = [
      `select[name="${field}"]`,
      `select[name="${field}[]"]`,
      `select[name="${field}emailids"]`,
      `select[name="${field}emailids[]"]`
    ];
    for (const sel of exactSelectors) {
      const $select = jq(container).find(sel);
      if ($select.length) return $select;
    }
    return null;
  }

  function _clearAndSetToField(container, jq, email) {
    console.log('[HW24 Provider] Step2: Clearing To and setting to', email);

    // Strategy 1: Click all "x" remove buttons on existing Select2 tags
    const removeButtons = container.querySelectorAll('.select2-selection__choice__remove');
    let removedAny = false;
    for (const btn of removeButtons) {
      // Only remove from the To row — check parent context
      const row = btn.closest('.row, tr, .form-group, [class*="to"]');
      // In the compose form, To is the first recipient row
      // Also check if this is NOT in a CC/BCC row
      const label = row?.querySelector('label, .fieldLabel, td:first-child');
      const labelText = label?.textContent?.toLowerCase() || '';
      if (labelText.includes('cc') || labelText.includes('bcc')) continue;
      btn.click();
      removedAny = true;
      console.log('[HW24 Provider] Step2: Clicked x to remove existing To recipient');
    }

    // Strategy 2: Clear via Select2 jQuery API
    const $toSelect = _findSelectForField(container, jq, 'to');
    if ($toSelect) {
      if (!removedAny) {
        $toSelect.val(null).trigger('change');
        $toSelect.find('option').remove();
      }
      // Add provider email
      const opt = new Option(email, email, true, true);
      $toSelect.append(opt).trigger('change');
      $toSelect.trigger({ type: 'select2:select', params: { data: { id: email, text: email } } });
      console.log('[HW24 Provider] Step2: To set via Select2');
      return;
    }

    // Fallback: native input
    _setNativeInput(container, 'to', email);
  }

  function _addEmailToField(container, jq, field, email) {
    console.log('[HW24 Provider] Step2: Adding', field, '=', email);

    const $select = _findSelectForField(container, jq, field);
    if ($select) {
      const opt = new Option(email, email, true, true);
      $select.append(opt).trigger('change');
      $select.trigger({ type: 'select2:select', params: { data: { id: email, text: email } } });
      console.log('[HW24 Provider] Step2:', field, 'added via Select2');
      return;
    }

    _setNativeInput(container, field, email);
  }

  function _setNativeInput(container, field, email) {
    const inputSelectors = [
      `input[name="${field}"]`, `input[name="${field}[]"]`,
      `input[name="${field}emailids"]`
    ];
    for (const sel of inputSelectors) {
      const input = container.querySelector(sel);
      if (input && input.offsetParent !== null) {
        input.value = email;
        input.focus();
        fire(input);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        console.log('[HW24 Provider] Step2:', field, 'set via native input');
        return;
      }
    }
    console.warn('[HW24 Provider] Step2: Could not find', field, 'input');
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
   * Click the "Include Signature" button to load the email signature.
   * This must happen BEFORE we read the email body.
   */
  function clickIncludeSignature(container) {
    // Look for "Include Signature" button/link
    const allClickables = [...container.querySelectorAll('button, a, input[type="button"]')];
    const sigBtn = allClickables.find(el => /include.*signature|signatur.*einf/i.test(el.textContent));
    if (sigBtn) {
      sigBtn.click();
      console.log('[HW24 Provider] Clicked "Include Signature"');
      return true;
    }
    console.log('[HW24 Provider] "Include Signature" button not found');
    return false;
  }

  /**
   * Check if the description text is already present in the email body.
   * The template "Anfrage Händler" likely includes it via a template variable.
   */
  function descriptionAlreadyInBody(html, descText) {
    if (!descText) return true; // nothing to insert
    // Get the first significant line of the description (skip empty/short lines)
    const lines = descText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    if (lines.length === 0) return true;
    // Strip HTML tags from body for text comparison
    const plainBody = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
    // Check if the first line of description appears in the body
    return plainBody.includes(lines[0]);
  }

  async function fillEmailBody(provider) {
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Filling email for', config.label, '| style:', config.style, '| lang:', config.lang);

    // Step A: Click "Include Signature" to load signature into the editor
    const composeContainer = findComposeContainer() || document.body;
    clickIncludeSignature(composeContainer);
    await sleep(800); // Wait for signature to be inserted into CKEditor

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
        result = result + insertHTML;
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
    toolbar.style.cssText = 'padding:8px 12px;background:linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%);border-bottom:1px solid #8b5cf6;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;font-family:system-ui,-apple-system,sans-serif;z-index:1001;';

    const label = document.createElement('span');
    label.style.cssText = 'font-weight:600;color:#5b21b6;';
    label.textContent = '\uD83D\uDCE8 Provider: ' + provider.label + ' (' + provider.key + ')';
    toolbar.appendChild(label);

    const sep = document.createElement('span');
    sep.textContent = ' \u2014 ';
    sep.style.color = '#7c3aed';
    toolbar.appendChild(sep);

    const status = document.createElement('span');
    status.className = 'hw24-provider-status';
    status.style.cssText = 'color:#6d28d9;font-style:italic;';
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

      // Click "Compose Email" to proceed to Step 2
      clickStep1ComposeButton(container);
      console.log('[HW24 Provider] Step 1 complete — waiting for Step 2...');

    } catch (err) {
      console.error('[HW24 Provider] Step 1 error:', err);
      markDetailButton(provider.key, 'error');
    }
  }

  async function handleStep2Detected(container) {
    if (!pendingProvider) return;

    const provider = pendingProvider;
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Step 2 compose popup detected for:', provider.label);

    injectProviderEmailToolbar(container, config);

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

      // Fill email body
      updateProviderEmailToolbarStatus('\u23F3 E-Mail wird befüllt...');
      await fillEmailBody(provider);

      // Done
      updateProviderEmailToolbarStatus('\u2705 Fertig — bitte prüfen & senden');
      markDetailButton(provider.key, 'done');
      console.log('[HW24 Provider] Email preparation complete for', provider.label);

    } catch (err) {
      console.error('[HW24 Provider] Step 2 error:', err);
      updateProviderEmailToolbarStatus('\u274C Fehler: ' + err.message);
      markDetailButton(provider.key, 'error');
    }

    pendingProvider = null;
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

  function handleProviderClick(provider) {
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Provider clicked:', config.label, '| To:', config.to, '| CC:', config.cc, '| Style:', config.style, '| Lang:', config.lang);

    // Cache description from detail view BEFORE opening popup
    pendingDescriptionText = readDescriptionText();
    console.log('[HW24 Provider] Description cached, length:', pendingDescriptionText.length);

    // Set pending provider + reset step tracking
    pendingProvider = { ...provider };
    step1Handled = false;

    // Mark button as loading
    markDetailButton(provider.key, 'loading');

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

      // After Axians button: "Sie" checkbox toggle (unchecked = du, checked = Sie/formal)
      if (provider.hasSieToggle) {
        const toggleWrap = document.createElement('label');
        toggleWrap.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#6d28d9;cursor:pointer;margin-left:-4px;margin-right:2px;user-select:none;';
        toggleWrap.title = 'Axians formell (Sie) ansprechen (gespeichert)';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = axiansSie;
        checkbox.style.cssText = 'cursor:pointer;accent-color:#7c3aed;';
        checkbox.onchange = () => {
          axiansSie = checkbox.checked;
          localStorage.setItem('hw24_provider_axians_sie', axiansSie ? 'true' : 'false');
          console.log('[HW24 Provider] Axians Sie toggled:', axiansSie);
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
     INITIALIZATION
     ═══════════════════════════════════════════════════════════════════════════ */

  function init() {
    injectDetailToolbar();
    if (!document.getElementById(DETAIL_TOOLBAR_ID)) {
      setTimeout(injectDetailToolbar, 500);
      setTimeout(injectDetailToolbar, 1500);
      setTimeout(injectDetailToolbar, 3000);
    }
    initComposeObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
