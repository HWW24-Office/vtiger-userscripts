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

  function triggerEMAILMakerCompose() {
    // Strategy 1: Direct link with onclick containing EMAILMaker
    let link = document.querySelector('a[onclick*="EMAILMaker"]');
    if (link) {
      console.log('[HW24 Provider] EMAILMaker link found via onclick');
      link.click();
      return true;
    }

    // Strategy 2: Link with href containing EMAILMaker
    link = document.querySelector('a[href*="EMAILMaker"]');
    if (link) {
      console.log('[HW24 Provider] EMAILMaker link found via href');
      link.click();
      return true;
    }

    // Strategy 3: Search all links for EMAILMaker text
    const allLinks = [...document.querySelectorAll('a')];
    link = allLinks.find(a => /emailmaker/i.test(a.textContent) || /emailmaker/i.test(a.getAttribute('onclick') || '') || /emailmaker/i.test(a.getAttribute('href') || ''));
    if (link) {
      console.log('[HW24 Provider] EMAILMaker link found via text search');
      link.click();
      return true;
    }

    // Strategy 4: Open "More" dropdown and search there
    const moreBtn = document.querySelector('.btn-group .dropdown-toggle, button[data-toggle="dropdown"], .moreActionsBtn, [id*="moreActions"]');
    if (moreBtn) {
      console.log('[HW24 Provider] Opening More dropdown to find EMAILMaker');
      moreBtn.click();
      // Wait a moment for dropdown to open
      setTimeout(() => {
        const dropdownLinks = [...document.querySelectorAll('.dropdown-menu a, .open a, .show a')];
        const emLink = dropdownLinks.find(a => /emailmaker/i.test(a.textContent) || /emailmaker/i.test(a.getAttribute('onclick') || '') || /emailmaker/i.test(a.getAttribute('href') || ''));
        if (emLink) {
          console.log('[HW24 Provider] EMAILMaker link found in More dropdown');
          emLink.click();
        } else {
          // Also try "Send Email" generic link which may use EMAILMaker
          const sendEmail = dropdownLinks.find(a => /send.*email|e-mail.*senden/i.test(a.textContent));
          if (sendEmail) {
            console.log('[HW24 Provider] "Send Email" link found in More dropdown');
            sendEmail.click();
          } else {
            console.warn('[HW24 Provider] EMAILMaker not found in More dropdown');
            alert('EMAILMaker-Link nicht gefunden.\nBitte öffne den EMAILMaker manuell — die Felder werden dann automatisch befüllt.');
          }
        }
      }, 300);
      return true;
    }

    console.warn('[HW24 Provider] EMAILMaker link not found anywhere');
    alert('EMAILMaker-Link nicht gefunden.\nBitte öffne den EMAILMaker manuell — die Felder werden dann automatisch befüllt.');
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
     MODULE 4: TEMPLATE SELECTION
     ═══════════════════════════════════════════════════════════════════════════ */

  async function selectTemplate(container) {
    console.log('[HW24 Provider] Starting template selection...');

    // Find "Select Email Template" button — text-based search
    const allButtons = [...container.querySelectorAll('button, a.btn, input[type="button"], [role="button"]')];
    let templateBtn = allButtons.find(b => /select.*template|template.*select|vorlage.*wählen|e-?mail.*template/i.test(b.textContent));

    // Also try select/dropdown that might contain templates
    if (!templateBtn) {
      templateBtn = container.querySelector('[id*="template" i], [name*="template" i], [data-template], .emailTemplateBtn, #selectEmailTemplate');
    }

    if (!templateBtn) {
      console.warn('[HW24 Provider] Template select button not found, trying broader search...');
      // Try finding any element with "template" in text within the compose area
      const spans = [...container.querySelectorAll('span, label, div')];
      const templateSpan = spans.find(s => /template|vorlage/i.test(s.textContent) && s.textContent.length < 50);
      if (templateSpan) {
        const clickable = templateSpan.closest('button, a, [role="button"]') || templateSpan;
        templateBtn = clickable;
      }
    }

    if (!templateBtn) {
      console.warn('[HW24 Provider] Template button not found — skipping auto-selection');
      return false;
    }

    console.log('[HW24 Provider] Clicking template button:', templateBtn.textContent.trim().substring(0, 40));
    templateBtn.click();

    // Wait for template list to appear
    try {
      await sleep(500);
      const templateList = await waitFor(() => {
        // Look for template list items
        const items = document.querySelectorAll('.listViewEntries tr, .modal .listViewEntries tr, [class*="template"] li, .modal-body tr, .modal-body li');
        if (items.length > 0) return items;
        // Also try a popup/modal that just appeared
        const modals = document.querySelectorAll('.modal.in, .modal.show, [role="dialog"]');
        for (const m of modals) {
          const rows = m.querySelectorAll('tr, li');
          if (rows.length > 1) return rows;
        }
        return null;
      }, 200, 5000);

      // Find "Anfrage Händler" in the template list
      let targetRow = null;
      for (const item of templateList) {
        if (/Anfrage\s*H[äa]ndler/i.test(item.textContent)) {
          targetRow = item;
          break;
        }
      }

      if (!targetRow) {
        console.warn('[HW24 Provider] Template "Anfrage Händler" not found in list');
        return false;
      }

      console.log('[HW24 Provider] Found "Anfrage Händler" template, clicking...');
      // Click the row or a link within it
      const link = targetRow.querySelector('a') || targetRow;
      link.click();

      // Wait for CKEditor content to load
      await waitFor(() => {
        const ck = getCKEditorInstance();
        if (!ck) return false;
        try {
          const data = ck.getData();
          return data && data.length > 50;
        } catch { return false; }
      }, 300, 8000);

      console.log('[HW24 Provider] Template loaded successfully');
      return true;

    } catch (err) {
      console.warn('[HW24 Provider] Template selection timeout:', err.message);
      return false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODULE 5: EMAIL RECIPIENT SETTING
     ═══════════════════════════════════════════════════════════════════════════ */

  function setEmailRecipient(field, email) {
    if (!email) return;
    console.log('[HW24 Provider] Setting', field, 'to', email);

    const container = findComposeContainer() || document.body;

    // If field is 'cc', first make the CC field visible
    if (field === 'cc') {
      const addCcLink = container.querySelector('a[data-type="cc"], .addCc, [id*="addCc"], [onclick*="cc"]');
      if (addCcLink) {
        addCcLink.click();
        console.log('[HW24 Provider] Clicked "Add Cc" link');
      }
      // Also try to show hidden CC row
      const ccRow = container.querySelector('[class*="cc"][style*="display: none"], [class*="cc"][style*="display:none"], .ccContainer[style*="none"]');
      if (ccRow) {
        ccRow.style.display = '';
      }
    }

    // Small delay to let CC field appear
    setTimeout(() => {
      _setRecipientField(container, field, email);
    }, field === 'cc' ? 300 : 50);
  }

  function _setRecipientField(container, field, email) {
    // Strategy 1: Select2 jQuery API
    try {
      const jq = window.jQuery || window.$;
      if (jq) {
        const selectors = [
          `select[name="${field}"]`,
          `select[name="${field}[]"]`,
          `select[id*="${field}"]`,
          `[data-fieldname="${field}"] select`
        ];
        for (const sel of selectors) {
          const $select = jq(sel);
          if ($select.length && $select.data('select2')) {
            const opt = new Option(email, email, true, true);
            $select.append(opt).trigger('change');
            $select.trigger({ type: 'select2:select', params: { data: { id: email, text: email } } });
            console.log('[HW24 Provider] Set', field, 'via Select2 jQuery API');
            return;
          }
        }
      }
    } catch (e) {
      console.log('[HW24 Provider] Select2 jQuery strategy failed:', e.message);
    }

    // Strategy 2: Native input field
    const inputSelectors = [
      `input[name="${field}"]`,
      `input[name="${field}[]"]`,
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
        // Simulate Enter key to confirm the email
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
      // Check if this search input belongs to the right field
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

    console.warn('[HW24 Provider] Could not find', field, 'input field');
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
     MODULE 7: COMPOSE CONTAINER DETECTION
     ═══════════════════════════════════════════════════════════════════════════ */

  function findComposeContainer() {
    const selectors = [
      '#composeEmailContainer',
      '.SendEmailFormStep2',
      '.modelContainer',
      '.modal.in',
      '.modal.show',
      '[role="dialog"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.querySelector('input[name="subject"], .cke, [id^="cke_"], textarea.ckEditorSource, .cke_editable')) {
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
     MODULE 9: MUTATION OBSERVER ORCHESTRATION
     ═══════════════════════════════════════════════════════════════════════════ */

  async function handleComposeDetected(container) {
    if (!pendingProvider) return;

    const provider = pendingProvider;
    console.log('[HW24 Provider] Compose dialog detected for provider:', provider.label);

    // Inject provider info toolbar
    injectProviderEmailToolbar(container, provider);

    try {
      // Step 1: Select template
      updateProviderEmailToolbarStatus('\u23F3 Template wird geladen...');
      const templateSelected = await selectTemplate(container);
      if (templateSelected) {
        console.log('[HW24 Provider] Template selected, waiting for content...');
        await sleep(500);
      } else {
        console.log('[HW24 Provider] Template not auto-selected, waiting for manual selection or existing content...');
        // Wait for user to select template or for content to appear
        try {
          await waitFor(() => {
            const ck = getCKEditorInstance();
            if (!ck) return false;
            try { return ck.getData().length > 50; } catch { return false; }
          }, 500, 30000);
        } catch {
          console.warn('[HW24 Provider] Timeout waiting for email content');
        }
      }

      // Step 2: Set To/CC
      updateProviderEmailToolbarStatus('\u23F3 Empfänger werden gesetzt...');
      setEmailRecipient('to', provider.to);
      if (provider.cc) {
        setTimeout(() => setEmailRecipient('cc', provider.cc), 500);
      }

      // Step 3: Fill email body
      await sleep(provider.cc ? 1000 : 300);
      updateProviderEmailToolbarStatus('\u23F3 E-Mail wird befüllt...');
      await fillEmail(provider);

      // Done
      updateProviderEmailToolbarStatus('\u2705 Fertig — bitte prüfen & senden');
      markDetailButton(provider.key, 'done');
      console.log('[HW24 Provider] Email preparation complete for', provider.label);

    } catch (err) {
      console.error('[HW24 Provider] Error during email preparation:', err);
      updateProviderEmailToolbarStatus('\u274C Fehler: ' + err.message);
      markDetailButton(provider.key, 'error');
    }

    // Clear pending provider
    pendingProvider = null;
  }

  function initComposeObserver() {
    function tryDetect() {
      if (!pendingProvider) return;
      if (document.getElementById(COMPOSE_TOOLBAR_ID)) return; // Already handled

      const container = findComposeContainer();
      if (!container) return;

      handleComposeDetected(container);
    }

    const scheduleRetries = () => {
      setTimeout(tryDetect, 300);
      setTimeout(tryDetect, 800);
      setTimeout(tryDetect, 1500);
      setTimeout(tryDetect, 3000);
      setTimeout(tryDetect, 5000);
    };

    const observer = new MutationObserver(mutations => {
      if (!pendingProvider) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const isCompose = node.id === 'composeEmailContainer'
            || node.classList?.contains('SendEmailFormStep2')
            || node.classList?.contains('modelContainer')
            || node.matches?.('.modal, [role="dialog"]');

          const hasCompose = !isCompose && (
            node.querySelector?.('#composeEmailContainer, .SendEmailFormStep2, .cke, [id^="cke_"]')
          );

          if (isCompose || hasCompose) {
            scheduleRetries();
          }
        }

        if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
          const t = mutation.target;
          if (t.id === 'composeEmailContainer' || t.classList?.contains('SendEmailFormStep2')
            || t.classList?.contains('modal') || t.classList?.contains('modelContainer')) {
            scheduleRetries();
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

    // Fallback polling every 2s, stop after 10min
    const poll = setInterval(() => {
      if (!pendingProvider) return;
      if (document.getElementById(COMPOSE_TOOLBAR_ID)) return;
      tryDetect();
    }, 2000);
    setTimeout(() => clearInterval(poll), 600000);

    console.log('[HW24 Provider] Compose observer initialized');
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

    // Set pending provider
    pendingProvider = { ...provider };

    // Mark button as loading
    markDetailButton(provider.key, 'loading');

    // Trigger EMAILMaker
    triggerEMAILMakerCompose();
  }

  function injectDetailToolbar() {
    if (document.getElementById(DETAIL_TOOLBAR_ID)) return;

    // Find placement target
    const target = document.querySelector('.detailViewTitle, .recordBasicInfo, .detailViewInfo, .details .contents');
    if (!target) {
      console.warn('[HW24 Provider] Detail view target element not found');
      return;
    }

    console.log('[HW24 Provider] Injecting provider toolbar after', target.className || target.tagName);

    const toolbar = document.createElement('div');
    toolbar.id = DETAIL_TOOLBAR_ID;
    toolbar.style.cssText = 'padding:10px 15px;background:linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%);border:1px solid #c4b5fd;border-radius:6px;margin:10px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;font-family:system-ui,-apple-system,sans-serif;';

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

    // Insert after the target element
    if (target.nextSibling) {
      target.parentNode.insertBefore(toolbar, target.nextSibling);
    } else {
      target.parentNode.appendChild(toolbar);
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
