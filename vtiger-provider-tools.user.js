// ==UserScript==
// @name         VTiger Provider Tools
// @namespace    hw24.vtiger.provider.tools
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-provider-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/HWW24-Office/vtiger-userscripts/main/vtiger-provider-tools.user.js
// @description  Provider-Anfragen: Vorbereitungs-Buttons für Provider-E-Mails auf Potentials
// @match        https://vtiger.hardwarewartung.com/index.php*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const HW24_VERSION = '1.0.0';

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
     ═══════════════════════════════════════════════════════════════════════════ */

  const PROVIDERS = [
    { key: 'TG',    label: 'Evernex',     to: 'R.Voelzke@technogroup.com',  cc: '',                              greeting: 'Hallo Ronny,',        style: 'du',  lang: 'de', status: 'angefragt TG' },
    { key: 'CC',    label: 'Axians',      to: 'Michael.kienzle@axians.de',  cc: 'niklas.spranz@axians.de',       greeting: 'Hallo Herr Kienzle,', style: 'sie', lang: 'de', status: 'angefragt CC',
                                                                                                                   greetingDu: 'Hallo Michael,',   hasDuToggle: true },
    { key: 'PP',    label: 'Park Place',  to: 'jchiaju@parkplacetech.com',  cc: 'partnersales@parkplacetech.com', greeting: 'Hallo Justine,',      style: 'du',  lang: 'de', status: 'angefragt PP' },
    { key: 'ITRIS', label: 'ITRIS',       to: 'kkroner@itris.de',           cc: '',                              greeting: 'Hallo Katrin,',       style: 'du',  lang: 'de', status: 'angefragt ITRIS' },
    { key: 'DIS',   label: 'DIS',         to: 'anfragen@dis-daten-it.de',   cc: '',                              greeting: 'Hallo Team,',         style: 'sie', lang: 'de', status: 'angefragt DIS' },
    { key: 'IDS',   label: 'IDS',         to: 'o.hermann@idsgmbh.com',      cc: '',                              greeting: 'Hallo Olga,',         style: 'du',  lang: 'de', status: 'angefragt IDS' },
    { key: 'Nordic', label: 'Nordic',     to: 'ksp@nordiccomputer.com',     cc: '',                              greeting: 'Hello Kevon,',        style: 'du',  lang: 'en', status: 'angefragt Nordic' },
    { key: 'TDS',   label: 'TD Synnex',   to: 'Sales.at@tdsynnex.com',      cc: '',                              greeting: 'Hallo Team,',         style: 'sie', lang: 'de', status: 'angefragt TD Synnex' },
  ];

  /* ═══════════════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  let pendingProvider = null;
  let axianPerDu = localStorage.getItem('hw24_provider_axians_perdu') === 'true';

  const DETAIL_TOOLBAR_ID = 'hw24-provider-toolbar';
  const COMPOSE_TOOLBAR_ID = 'hw24-provider-email-toolbar';

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
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Find the "Send Email with EMAILMaker" ACTION link (not the module navigation link).
   * The action link opens Popup 1 (recipient + template selection).
   * Module links (href="index.php?module=EMAILMaker&view=...") must be excluded.
   */
  function findSendEmailAction() {
    // Helper: is this a module-navigation link (NOT what we want)?
    const isModuleLink = (a) => {
      const href = a.getAttribute('href') || '';
      // Module links navigate to EMAILMaker module page — they contain view=List or view=Detail etc.
      return /module=EMAILMaker.*view=/i.test(href) && !/SendEmail|Compose|action/i.test(href);
    };

    // Strategy 1: Link whose TEXT contains "Send Email" + "EMAILMaker" (the action link)
    const allLinks = [...document.querySelectorAll('a')];
    let link = allLinks.find(a => /send\s*email.*emailmaker|emailmaker.*send\s*email/i.test(a.textContent) && !isModuleLink(a));
    if (link) {
      console.log('[HW24 Provider] Found "Send Email with EMAILMaker" via text match');
      return link;
    }

    // Strategy 2: Link with onclick that triggers EMAILMaker send (not navigation)
    link = allLinks.find(a => {
      const onclick = a.getAttribute('onclick') || '';
      return /EMAILMaker/i.test(onclick) && /send|compose|mass|action/i.test(onclick);
    });
    if (link) {
      console.log('[HW24 Provider] Found EMAILMaker action via onclick');
      return link;
    }

    // Strategy 3: Link with href pointing to EMAILMaker SendEmail/Compose action
    link = allLinks.find(a => {
      const href = a.getAttribute('href') || '';
      return /EMAILMaker/i.test(href) && /SendEmail|Compose|action=Send/i.test(href);
    });
    if (link) {
      console.log('[HW24 Provider] Found EMAILMaker action via href');
      return link;
    }

    // Strategy 4: Any link containing "Send Email" text (generic VTiger email action)
    link = allLinks.find(a => /^send\s*email/i.test(a.textContent.trim()));
    if (link) {
      console.log('[HW24 Provider] Found generic "Send Email" link');
      return link;
    }

    return null;
  }

  function triggerEMAILMakerCompose() {
    // Try finding the action link directly
    let link = findSendEmailAction();
    if (link) {
      link.click();
      return true;
    }

    // Strategy 5: Open "More" dropdown and search there
    const moreBtns = document.querySelectorAll('.btn-group .dropdown-toggle, button[data-toggle="dropdown"], .moreActionsBtn, [id*="moreActions"]');
    for (const moreBtn of moreBtns) {
      console.log('[HW24 Provider] Opening More dropdown to find EMAILMaker action');
      moreBtn.click();

      // Give dropdown a moment to open, then search
      setTimeout(() => {
        const actionLink = findSendEmailAction();
        if (actionLink) {
          console.log('[HW24 Provider] EMAILMaker action found in dropdown');
          actionLink.click();
        } else {
          console.warn('[HW24 Provider] EMAILMaker action not found in dropdown');
          alert('„Send Email with EMAILMaker"-Link nicht gefunden.\nBitte öffne den EMAILMaker manuell — die Felder werden dann automatisch befüllt.');
        }
      }, 300);
      return true;
    }

    console.warn('[HW24 Provider] EMAILMaker action link not found anywhere');
    alert('„Send Email with EMAILMaker"-Link nicht gefunden.\nBitte öffne den EMAILMaker manuell — die Felder werden dann automatisch befüllt.');
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
    // Strategy 1: CKEditor API
    const ckInstance = getCKEditorInstance();
    if (ckInstance) {
      try {
        const data = ckInstance.getData();
        if (data && data.length > 10) return { type: 'ckeditor', editor: ckInstance };
      } catch { /* editor not ready */ }
    }

    // Strategy 2: iframe
    const iframes = container.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc?.body && doc.body.innerHTML.length > 10) return { type: 'iframe', el: iframe, doc };
      } catch { /* cross-origin */ }
    }

    // Strategy 3: contenteditable div
    const editables = container.querySelectorAll('[contenteditable="true"]');
    for (const el of editables) {
      if (el.innerHTML.length > 10) return { type: 'contenteditable', el };
    }

    // Strategy 4: textarea
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
     MODULE 4: STEP 1 POPUP — RECIPIENT + TEMPLATE SELECTION
     ═══════════════════════════════════════════════════════════════════════════
     EMAILMaker opens a Step-1 popup first where the user picks:
       - To / CC / BCC recipients
       - Email template
       - Then clicks "Compose Email" to proceed to Step 2 (CKEditor)
     We automate all of that here.
     ═══════════════════════════════════════════════════════════════════════════ */

  /**
   * Find the Step-1 popup container.
   * This is the FIRST popup that appears after clicking "Send Email with EMAILMaker".
   * It contains recipient fields and a template selector, but NO CKEditor yet.
   */
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
      // Step 1 has recipient fields but NO CKEditor
      const hasRecipient = el.querySelector('input[name="to"], input[name="toemailids"], select[name="to"], [id*="to_email"], [class*="toField"], [data-fieldname="to"]');
      const hasCKEditor = el.querySelector('.cke, [id^="cke_"], .cke_editable');
      if (hasRecipient && !hasCKEditor) {
        return el;
      }
    }
    // Broader fallback: any modal/dialog that has email fields but no CKEditor
    const modals = document.querySelectorAll('.modal.in, .modal.show, .modelContainer, [role="dialog"]');
    for (const m of modals) {
      const hasEmail = m.querySelector('input[type="text"], select');
      const hasCKEditor = m.querySelector('.cke, [id^="cke_"], .cke_editable');
      const hasTemplate = m.querySelector('[id*="template" i], [name*="template" i], select');
      if (hasEmail && hasTemplate && !hasCKEditor) {
        return m;
      }
    }
    return null;
  }

  /**
   * Set recipient in Step 1 popup fields.
   */
  function setStep1Recipient(container, field, email) {
    if (!email) return;
    console.log('[HW24 Provider] Step1: Setting', field, 'to', email);

    // If field is 'cc', first make the CC field visible
    if (field === 'cc') {
      const addCcLink = container.querySelector('a[data-type="cc"], .addCc, [id*="addCc"], [onclick*="cc"], [id*="Cc"]');
      if (addCcLink) {
        addCcLink.click();
        console.log('[HW24 Provider] Step1: Clicked "Add Cc" link');
      }
      const ccRow = container.querySelector('[class*="cc"][style*="display: none"], [class*="cc"][style*="display:none"]');
      if (ccRow) ccRow.style.display = '';
    }

    // Small delay for CC field to appear
    setTimeout(() => _setRecipientField(container, field, email), field === 'cc' ? 300 : 50);
  }

  function _setRecipientField(container, field, email) {
    // Strategy 1: Select2 jQuery API
    try {
      const jq = window.jQuery || window.$;
      if (jq) {
        const selectors = [
          `select[name="${field}"]`,
          `select[name="${field}[]"]`,
          `select[name="${field}emailids"]`,
          `select[id*="${field}"]`,
          `[data-fieldname="${field}"] select`
        ];
        for (const sel of selectors) {
          const $select = jq(container).find(sel);
          if ($select.length && $select.data('select2')) {
            const opt = new Option(email, email, true, true);
            $select.append(opt).trigger('change');
            $select.trigger({ type: 'select2:select', params: { data: { id: email, text: email } } });
            console.log('[HW24 Provider] Set', field, 'via Select2 jQuery API:', sel);
            return;
          }
        }
        // Also try broader Select2 selectors within container
        const $allSelects = jq(container).find('select');
        $allSelects.each(function () {
          const $s = jq(this);
          const name = ($s.attr('name') || '').toLowerCase();
          const id = ($s.attr('id') || '').toLowerCase();
          if ((name.includes(field) || id.includes(field)) && $s.data('select2')) {
            const opt = new Option(email, email, true, true);
            $s.append(opt).trigger('change');
            $s.trigger({ type: 'select2:select', params: { data: { id: email, text: email } } });
            console.log('[HW24 Provider] Set', field, 'via Select2 broad match:', $s.attr('name') || $s.attr('id'));
            return false; // break jQuery each
          }
        });
      }
    } catch (e) {
      console.log('[HW24 Provider] Select2 strategy failed:', e.message);
    }

    // Strategy 2: Native input field
    const inputSelectors = [
      `input[name="${field}"]`,
      `input[name="${field}[]"]`,
      `input[name="${field}emailids"]`,
      `input[id*="${field}"]`,
      `[data-fieldname="${field}"] input`,
      `.${field}Field input`,
      `[class*="${field}"] input[type="text"]`
    ];
    for (const sel of inputSelectors) {
      const input = container.querySelector(sel);
      if (input && input.offsetParent !== null) {
        input.value = email;
        input.focus();
        fire(input);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        console.log('[HW24 Provider] Set', field, 'via native input:', sel);
        return;
      }
    }

    // Strategy 3: Select2 search input
    const searchInputs = container.querySelectorAll('.select2-search__field, .select2-search input, input.select2-input');
    for (const si of searchInputs) {
      const parentField = si.closest(`[data-fieldname="${field}"], .${field}Field, [class*="${field}"]`);
      if (parentField || searchInputs.length === 1 || (field === 'to' && si === searchInputs[0]) || (field === 'cc' && si === searchInputs[1])) {
        si.value = email;
        si.focus();
        fire(si);
        setTimeout(() => {
          si.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          si.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
        }, 200);
        console.log('[HW24 Provider] Set', field, 'via Select2 search input');
        return;
      }
    }

    console.warn('[HW24 Provider] Could not find', field, 'input field in container');
  }

  /**
   * Select the "Anfrage Händler" template in Step 1.
   * Looks for a <select>, dropdown, or clickable template list.
   */
  async function selectTemplateInStep1(container) {
    console.log('[HW24 Provider] Step1: Selecting template "Anfrage Händler"...');

    // Strategy 1: <select> element for templates
    const selects = container.querySelectorAll('select');
    for (const sel of selects) {
      const name = (sel.name || sel.id || '').toLowerCase();
      // Skip recipient selects
      if (/^(to|cc|bcc)/.test(name)) continue;
      // Check if any option contains "Anfrage Händler"
      const options = [...sel.options];
      const target = options.find(o => /Anfrage\s*H[äa]ndler/i.test(o.text));
      if (target) {
        sel.value = target.value;
        fire(sel);
        console.log('[HW24 Provider] Step1: Template selected via <select>:', target.text);
        return true;
      }
      // Even if no match, if this looks like a template select, log its options
      if (/template|vorlage/i.test(name) || options.some(o => /template|vorlage/i.test(o.text))) {
        console.log('[HW24 Provider] Step1: Template <select> found but "Anfrage Händler" not in options:', options.map(o => o.text).join(', '));
      }
    }

    // Strategy 2: Select2-wrapped template dropdown (jQuery)
    try {
      const jq = window.jQuery || window.$;
      if (jq) {
        const $selects = jq(container).find('select');
        let found = false;
        $selects.each(function () {
          const $s = jq(this);
          const name = ($s.attr('name') || $s.attr('id') || '').toLowerCase();
          if (/^(to|cc|bcc)/.test(name)) return; // skip recipient
          if ($s.data('select2')) {
            const options = this.options ? [...this.options] : [];
            const target = options.find(o => /Anfrage\s*H[äa]ndler/i.test(o.text));
            if (target) {
              $s.val(target.value).trigger('change');
              console.log('[HW24 Provider] Step1: Template selected via Select2:', target.text);
              found = true;
              return false;
            }
          }
        });
        if (found) return true;
      }
    } catch (e) {
      console.log('[HW24 Provider] Step1: Select2 template strategy failed:', e.message);
    }

    // Strategy 3: "Select Email Template" button → opens sub-popup with template list
    const allButtons = [...container.querySelectorAll('button, a.btn, input[type="button"], [role="button"]')];
    const templateBtn = allButtons.find(b => /select.*template|template.*select|vorlage|e-?mail.*template/i.test(b.textContent));
    if (templateBtn) {
      console.log('[HW24 Provider] Step1: Clicking template button:', templateBtn.textContent.trim().substring(0, 40));
      templateBtn.click();

      try {
        await sleep(500);
        const templateList = await waitFor(() => {
          const items = document.querySelectorAll('.listViewEntries tr, .modal .listViewEntries tr, [class*="template"] li, .modal-body tr, .modal-body li');
          return items.length > 0 ? items : null;
        }, 200, 5000);

        let targetRow = null;
        for (const item of templateList) {
          if (/Anfrage\s*H[äa]ndler/i.test(item.textContent)) {
            targetRow = item;
            break;
          }
        }
        if (targetRow) {
          const link = targetRow.querySelector('a') || targetRow;
          link.click();
          console.log('[HW24 Provider] Step1: Template "Anfrage Händler" selected from list');
          await sleep(300);
          return true;
        }
        console.warn('[HW24 Provider] Step1: "Anfrage Händler" not found in template list');
      } catch (err) {
        console.warn('[HW24 Provider] Step1: Template list timeout:', err.message);
      }
    }

    console.warn('[HW24 Provider] Step1: Template auto-selection failed');
    return false;
  }

  /**
   * Click the "Compose Email" / "Next" / "Send" button in Step 1 to proceed to Step 2.
   */
  function clickStep1ComposeButton(container) {
    // Look for a submit/compose button
    const allButtons = [...container.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn')];
    const composeBtn = allButtons.find(b => {
      const text = b.textContent.toLowerCase().trim();
      const val = (b.value || '').toLowerCase().trim();
      return /compose|verfassen|next|weiter|^send$|^senden$/i.test(text) || /compose|next|send/i.test(val);
    });
    if (composeBtn) {
      console.log('[HW24 Provider] Step1: Clicking compose button:', composeBtn.textContent.trim() || composeBtn.value);
      composeBtn.click();
      return true;
    }

    // Fallback: find submit button by type
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
     MODULE 6: EMAIL BODY FILLING
     ═══════════════════════════════════════════════════════════════════════════ */

  function resolveProviderConfig(provider) {
    // For Axians, check PerDu toggle
    if (provider.hasDuToggle && axianPerDu) {
      return {
        ...provider,
        greeting: provider.greetingDu || provider.greeting,
        style: 'du'
      };
    }
    return provider;
  }

  function replaceGreeting(html, provider) {
    // Patterns to match common greeting forms
    const greetingPatterns = [
      /Hallo[^,<\n]*,/,
      /Sehr geehrte[^,<\n]*,/,
      /Hello[^,<\n]*,/,
      /Dear[^,<\n]*,/,
      /Hi[^,<\n]*,/,
      /Guten Tag[^,<\n]*,/
    ];

    let replaced = false;
    for (const pattern of greetingPatterns) {
      if (pattern.test(html)) {
        html = html.replace(pattern, provider.greeting);
        replaced = true;
        console.log('[HW24 Provider] Greeting replaced with:', provider.greeting);
        break;
      }
    }

    if (!replaced) {
      console.log('[HW24 Provider] No greeting pattern found to replace');
    }

    return html;
  }

  function descriptionToHTML(text) {
    if (!text) return '';
    // Convert plain text to HTML paragraphs
    const lines = text.split('\n');
    const paragraphs = [];
    let currentParagraph = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (currentParagraph.length > 0) {
          paragraphs.push('<p>' + currentParagraph.join('<br>') + '</p>');
          currentParagraph = [];
        }
      } else {
        currentParagraph.push(trimmed);
      }
    }
    if (currentParagraph.length > 0) {
      paragraphs.push('<p>' + currentParagraph.join('<br>') + '</p>');
    }

    return paragraphs.join('');
  }

  function insertDescriptionIntoEmail(html, descriptionHTML) {
    if (!descriptionHTML) return html;

    // Find closing formula as an anchor point
    const closingPattern = /(<p[^>]*>(?:<[^>]*>)*\s*(?:Liebe Gr(?:ü|&uuml;)(?:ß|&szlig;)e|Mit freundlichen Gr(?:ü|&uuml;)(?:ß|&szlig;)en|Kind regards|Best regards)\b)/i;
    const closingMatch = html.match(closingPattern);

    if (closingMatch) {
      // Insert description before the closing formula paragraph
      const idx = html.indexOf(closingMatch[0]);
      const before = html.substring(0, idx);
      const after = html.substring(idx);
      console.log('[HW24 Provider] Description inserted before closing formula');
      return before + descriptionHTML + after;
    }

    // Fallback: find the greeting paragraph and insert after it
    const greetingEnd = html.match(/(Hallo[^<]*,|Hello[^<]*,|Sehr geehrte[^<]*,)(?:<\/[^>]*>)*(?:<br\s*\/?>|\s)*(?:<\/p>)?/i);
    if (greetingEnd) {
      const idx = html.indexOf(greetingEnd[0]) + greetingEnd[0].length;
      const before = html.substring(0, idx);
      const after = html.substring(idx);
      console.log('[HW24 Provider] Description inserted after greeting');
      return before + descriptionHTML + after;
    }

    // Last resort: append at the beginning of body
    console.log('[HW24 Provider] Description appended at start of email body');
    return descriptionHTML + html;
  }

  function extractUserFirstName(html) {
    // Words that are NOT person names
    const NOT_NAMES = ['Ihr', 'Dein', 'Das', 'Die', 'Der', 'Den', 'Dem', 'Ein', 'Eine', 'Mit',
      'Von', 'Und', 'Oder', 'Aber', 'Wenn', 'Wir', 'Uns', 'Unser', 'Service', 'Team', 'The',
      'Your', 'Our', 'Best', 'Kind', 'Dear', 'Sent', 'From', 'Tel', 'Fax', 'Web', 'Mob'];

    const closingRe = /(?:Mit freundlichen Gr(?:ü|&uuml;)(?:ß|&szlig;)en|Liebe Gr(?:ü|&uuml;)(?:ß|&szlig;)e|Kind regards)/i;
    const closingMatch = html.match(closingRe);
    if (!closingMatch) return '';

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

  function applyClosingFormula(html, provider) {
    const config = resolveProviderConfig(provider);
    const userFirstName = extractUserFirstName(html);

    if (config.style === 'du') {
      if (config.lang === 'en') {
        // English du: Kind regards + Vorname
        if (userFirstName) {
          html = html.replace(/(Kind regards|Best regards)/i, `$1<br>${userFirstName}`);
        }
      } else {
        // German du: Liebe Grüße + Vorname
        // Replace MfG → Liebe Grüße if present
        html = html.replace(/Mit freundlichen Gr(?:ü|&uuml;)(?:ß|&szlig;)en/g, 'Liebe Grüße');
        if (userFirstName) {
          html = html.replace(/(Liebe Gr(?:ü|&uuml;)(?:ß|&szlig;)e)/g, `$1<br>${userFirstName}`);
        }
      }
    }
    // style === 'sie': keep "Mit freundlichen Grüßen" or whatever is in the template, no Vorname

    return html;
  }

  async function fillEmail(provider) {
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Filling email for', config.label, '(' + config.key + ')', 'style:', config.style, 'lang:', config.lang);

    // Wait a bit for CKEditor to be fully ready
    await sleep(500);

    const data = readEmailHTML();
    if (!data) {
      console.warn('[HW24 Provider] Email body not found yet, retrying...');
      await sleep(1000);
      const retry = readEmailHTML();
      if (!retry) {
        console.error('[HW24 Provider] Email body not found after retry');
        return;
      }
      return _doFillEmail(retry, config);
    }
    return _doFillEmail(data, config);
  }

  function _doFillEmail(data, config) {
    const { body, html } = data;
    let result = html;

    // 1. Replace greeting
    result = replaceGreeting(result, config);

    // 2. Insert description text
    const descText = readDescriptionText();
    if (descText) {
      const descHTML = descriptionToHTML(descText);
      result = insertDescriptionIntoEmail(result, descHTML);
      console.log('[HW24 Provider] Description inserted, length:', descText.length);
    } else {
      console.log('[HW24 Provider] No description text found to insert');
    }

    // 3. Apply closing formula (Grußformel + Vorname)
    result = applyClosingFormula(result, config);

    // Write back
    writeEmailHTML(body, result);
    if (body.type === 'ckeditor') body.editor.fire('change');

    console.log('[HW24 Provider] Email body filled successfully');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 7: COMPOSE CONTAINER DETECTION (Step 2 — CKEditor popup)
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
      // Step 2 MUST have CKEditor or a subject field (distinguishes from Step 1)
      if (el.querySelector('.cke, [id^="cke_"], .cke_editable, textarea.ckEditorSource')) {
        return el;
      }
    }
    return null;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 8: PROVIDER INFO TOOLBAR IN COMPOSE DIALOG
     ═══════════════════════════════════════════════════════════════════════════ */

  function injectProviderEmailToolbar(container, provider) {
    if (document.getElementById(COMPOSE_TOOLBAR_ID)) {
      // Update existing toolbar status
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
    sep.textContent = ' — ';
    sep.style.color = '#7c3aed';
    toolbar.appendChild(sep);

    const status = document.createElement('span');
    status.className = 'hw24-provider-status';
    status.style.cssText = 'color:#6d28d9;font-style:italic;';
    status.textContent = '\u23F3 Wird vorbereitet...';
    toolbar.appendChild(status);

    // Insert ABOVE the existing lineitem-tools email toolbar (if present)
    const existingToolbar = container.querySelector('#hw24-email-toolbar');
    if (existingToolbar) {
      existingToolbar.parentNode.insertBefore(toolbar, existingToolbar);
    } else {
      // Insert at top of modal-body or before CKEditor
      const modalBody = container.querySelector('.modal-body');
      if (modalBody) {
        const editorWrap = modalBody.querySelector('.cke, .cke_inner, .cke_top, #cke_description, #cke_email_body');
        if (editorWrap) {
          editorWrap.parentNode.insertBefore(toolbar, editorWrap);
        } else {
          modalBody.insertBefore(toolbar, modalBody.firstChild);
        }
      } else {
        const editorWrap = container.querySelector('.cke, #cke_description, #cke_email_body');
        if (editorWrap) {
          editorWrap.parentNode.insertBefore(toolbar, editorWrap);
        } else {
          container.insertBefore(toolbar, container.firstChild);
        }
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
       2. POPUP 1 (Step 1): recipient + template selection
          → We auto-fill To/CC, select template, click "Compose Email"
       3. POPUP 2 (Step 2): CKEditor compose email
          → We fill greeting, description, closing formula
     ═══════════════════════════════════════════════════════════════════════════ */

  let step1Handled = false;

  /**
   * STEP 1: Handle the first popup (recipient + template selection)
   */
  async function handleStep1Detected(container) {
    if (!pendingProvider || step1Handled) return;
    step1Handled = true;

    const provider = pendingProvider;
    console.log('[HW24 Provider] Step 1 popup detected for:', provider.label);

    try {
      await sleep(300); // Let the popup fully render

      // Set To recipient
      setStep1Recipient(container, 'to', provider.to);
      await sleep(400);

      // Set CC recipient
      if (provider.cc) {
        setStep1Recipient(container, 'cc', provider.cc);
        await sleep(400);
      }

      // Select template "Anfrage Händler"
      await selectTemplateInStep1(container);
      await sleep(300);

      // Click "Compose Email" button to proceed to Step 2
      clickStep1ComposeButton(container);
      console.log('[HW24 Provider] Step 1 complete — waiting for Step 2 (compose popup)...');

    } catch (err) {
      console.error('[HW24 Provider] Step 1 error:', err);
      markDetailButton(provider.key, 'error');
    }
  }

  /**
   * STEP 2: Handle the second popup (CKEditor compose email)
   */
  async function handleStep2Detected(container) {
    if (!pendingProvider) return;

    const provider = pendingProvider;
    console.log('[HW24 Provider] Step 2 compose popup detected for:', provider.label);

    // Inject provider info toolbar
    injectProviderEmailToolbar(container, provider);

    try {
      // Wait for CKEditor content to load (template should be loading)
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

      // Fill email body (greeting, description, closing)
      updateProviderEmailToolbarStatus('\u23F3 E-Mail wird befüllt...');
      await fillEmail(provider);

      // Done
      updateProviderEmailToolbarStatus('\u2705 Fertig — bitte prüfen & senden');
      markDetailButton(provider.key, 'done');
      console.log('[HW24 Provider] Email preparation complete for', provider.label);

    } catch (err) {
      console.error('[HW24 Provider] Step 2 error:', err);
      updateProviderEmailToolbarStatus('\u274C Fehler: ' + err.message);
      markDetailButton(provider.key, 'error');
    }

    // Clear pending provider
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
      if (document.getElementById(COMPOSE_TOOLBAR_ID)) return; // Already handled
      const container = findComposeContainer();
      if (!container) return;
      handleStep2Detected(container);
    }

    function tryDetectAny() {
      // Try Step 2 first (if Step 1 was already handled or skipped)
      tryDetectStep2();
      // Then try Step 1
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
            || node.id === 'sendEmailFormStep1'
            || node.id === 'sendEmailFormStep2'
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

    // Fallback polling every 2s, stop after 10min
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
    // Resolve effective config (Axians PerDu check)
    const config = resolveProviderConfig(provider);
    console.log('[HW24 Provider] Provider clicked:', config.label, '| To:', config.to, '| CC:', config.cc, '| Style:', config.style);

    // Read description early (before navigate away from detail view)
    const descText = readDescriptionText();
    console.log('[HW24 Provider] Description pre-read, length:', descText.length);

    // Set pending provider + reset step tracking
    pendingProvider = { ...provider };
    step1Handled = false;

    // Mark button as loading
    markDetailButton(provider.key, 'loading');

    // Trigger EMAILMaker — this opens Popup 1 (Step 1)
    triggerEMAILMakerCompose();
  }

  function injectDetailToolbar() {
    if (document.getElementById(DETAIL_TOOLBAR_ID)) return;

    // Find placement target — near "+ Add Tag" area, which is below the record header
    // and above the tab bar (Summary, Details, Updates...)
    let target = null;
    let insertMode = 'after'; // 'after' or 'before'

    // Strategy 1: Find the "+ Add Tag" button/link and place toolbar next to it
    const addTag = document.querySelector('.addTag, [class*="addTag"], a[href*="addTag"], [id*="addTag"]');
    if (addTag) {
      target = addTag.closest('div, span, td') || addTag.parentElement;
      insertMode = 'after';
      console.log('[HW24 Provider] Placing toolbar near + Add Tag');
    }

    // Strategy 2: Place before the tab bar (Summary / Details / Updates...)
    if (!target) {
      const tabBar = document.querySelector('.detailViewInfo .related-tabs, .tabContainer, ul.nav-tabs, .detailview-tab, [class*="relatedTabs"]');
      if (tabBar) {
        target = tabBar;
        insertMode = 'before';
        console.log('[HW24 Provider] Placing toolbar before tab bar');
      }
    }

    // Strategy 3: Place after the record header block (below all header info)
    if (!target) {
      // The header block contains title, status badges, partner info etc.
      const headerBlock = document.querySelector('.detailViewInfo .recordDetails, .detailViewInfo > .row:first-child, .recordBasicInfo');
      if (headerBlock) {
        target = headerBlock;
        insertMode = 'after';
        console.log('[HW24 Provider] Placing toolbar after record header block');
      }
    }

    // Strategy 4: Fallback — after detailViewTitle
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

      // After Axians button: PerDu checkbox toggle
      if (provider.hasDuToggle) {
        const toggleWrap = document.createElement('label');
        toggleWrap.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#6d28d9;cursor:pointer;margin-left:-4px;margin-right:2px;user-select:none;';
        toggleWrap.title = 'Axians per Du ansprechen (gespeichert)';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = axianPerDu;
        checkbox.style.cssText = 'cursor:pointer;accent-color:#7c3aed;';
        checkbox.onchange = () => {
          axianPerDu = checkbox.checked;
          localStorage.setItem('hw24_provider_axians_perdu', axianPerDu ? 'true' : 'false');
          console.log('[HW24 Provider] Axians PerDu toggled:', axianPerDu);
        };

        const text = document.createTextNode('Du');
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
    // Inject detail toolbar (retry a few times in case DOM is still loading)
    injectDetailToolbar();
    if (!document.getElementById(DETAIL_TOOLBAR_ID)) {
      setTimeout(injectDetailToolbar, 500);
      setTimeout(injectDetailToolbar, 1500);
      setTimeout(injectDetailToolbar, 3000);
    }

    // Start compose observer
    initComposeObserver();
  }

  // Run on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
