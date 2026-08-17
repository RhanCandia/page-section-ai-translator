// Content script for Page Section AI Translator
// Handles: pick mode (section selection) + auto-translation on page load + token-efficient DOM text translation.

// ── State ────────────────────────────────────────────────────────────

let pickModeActive = false;
let hoveredEl = null;
const overlayId = 'ai-translator-overlay';
const toastId = 'ai-translator-toast';

// Per-section translation status, keyed by selector
// Values: 'translated' | 'failed' | 'not-found' | 'skipped'
const translationStatus = {};

// Cache original untranslated extraction data per element
const originalDataMap = new WeakMap();

// ── CSS injection ────────────────────────────────────────────────────

const STYLE_ID = 'ai-translator-styles';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ai-translator-highlight {
      outline: 3px solid #4285f4 !important;
      outline-offset: 2px !important;
      background-color: rgba(66, 133, 244, 0.08) !important;
    }
    .ai-translator-selected {
      outline: 3px solid #34a853 !important;
      outline-offset: 2px !important;
      background-color: rgba(52, 168, 83, 0.08) !important;
    }
    #${overlayId} {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 2147483647;
      background: #4285f4;
      color: #fff;
      font: 14px/1.5 system-ui, -apple-system, sans-serif;
      padding: 8px 16px;
      text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      pointer-events: none;
    }
    #${overlayId} span {
      pointer-events: auto;
      cursor: pointer;
      text-decoration: underline;
      margin-left: 12px;
    }
    #${toastId} {
      position: fixed;
      bottom: 24px; left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #34a853;
      color: #fff;
      font: 14px/1.5 system-ui, -apple-system, sans-serif;
      padding: 10px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      animation: ai-translator-fadein 0.3s ease;
      pointer-events: none;
    }
    #${toastId}.error {
      background: #ea4335;
    }
    @keyframes ai-translator-fadein {
      from { opacity: 0; transform: translateX(-50%) translateY(8px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    /* ── Multicolor Gemini-style pulsing border ── */
    .ai-translator-translating {
      border-radius: 8px;
      box-shadow: 0 0 0 2px rgba(66,133,244,0.5), 0 0 0 6px rgba(66,133,244,0.15);
      animation: ai-tr-multi 2.4s ease-in-out infinite;
    }
    @keyframes ai-tr-multi {
      0%   { box-shadow: 0 0 0 2px rgba(66,133,244,0.5),  0 0 0 6px rgba(66,133,244,0.15); }
      25%  { box-shadow: 0 0 0 2px rgba(154,93,252,0.5),  0 0 0 6px rgba(154,93,252,0.15); }
      50%  { box-shadow: 0 0 0 2px rgba(0,186,155,0.5),   0 0 0 6px rgba(0,186,155,0.15); }
      75%  { box-shadow: 0 0 0 2px rgba(66,133,244,0.5),  0 0 0 6px rgba(66,133,244,0.15); }
      100% { box-shadow: 0 0 0 2px rgba(66,133,244,0.5),  0 0 0 6px rgba(66,133,244,0.15); }
    }
    /* ── Stagger reveal for translated children ── */
    @keyframes ai-tr-reveal {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .ai-tr-stagger {
      animation: ai-tr-reveal 0.35s ease forwards;
    }
  `;
  document.head.appendChild(style);
}

// ── Overlay management ───────────────────────────────────────────────

function showOverlay(text) {
  removeOverlay();
  const div = document.createElement('div');
  div.id = overlayId;
  div.textContent = text;
  const cancel = document.createElement('span');
  cancel.textContent = 'Cancel (Esc)';
  cancel.addEventListener('click', exitPickMode);
  div.appendChild(cancel);
  document.documentElement.appendChild(div);
}

function removeOverlay() {
  document.getElementById(overlayId)?.remove();
}

function showToast(msg, isError = false) {
  const existing = document.getElementById(toastId);
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = toastId;
  div.textContent = msg;
  if (isError) div.classList.add('error');
  document.documentElement.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ── Selector generation ─────────────────────────────────────────────

function generateSelector(el) {
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return `#${CSS.escape(el.id)}`;
  }

  const parts = [];
  let current = el;

  while (current && current !== document.body && current !== document.documentElement) {
    let seg = current.tagName.toLowerCase();

    if (current.id && document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
      seg = `#${CSS.escape(current.id)}`;
      parts.unshift(seg);
      break;
    }

    const stableClasses = Array.from(current.classList).filter(
      c => !/^ai-translator-/.test(c) && !/^[a-z]+-[a-f0-9]{4,}$/i.test(c) && c.length > 1
    );
    if (stableClasses.length) {
      seg += '.' + stableClasses.map(c => CSS.escape(c)).join('.');
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        s => s.tagName === current.tagName
      );
      const allSiblings = Array.from(parent.children);
      const sameTagIndex = siblings.indexOf(current);
      if (sameTagIndex === -1) {
        const allIndex = allSiblings.indexOf(current);
        seg += `:nth-child(${allIndex + 1})`;
      } else if (siblings.length > 1) {
        const allIndex = allSiblings.indexOf(current);
        seg += `:nth-child(${allIndex + 1})`;
      }
    }

    parts.unshift(seg);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function validateSelector(selector) {
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1;
  } catch {
    return false;
  }
}

// ── Pick mode ────────────────────────────────────────────────────────

function enterPickMode() {
  if (pickModeActive) return;
  pickModeActive = true;
  injectStyles();
  showOverlay('Click any element to save it for translation');
  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown);
  document.body.style.cursor = 'crosshair';
}

function exitPickMode() {
  if (!pickModeActive) return;
  pickModeActive = false;
  removeOverlay();
  clearHighlight();
  document.removeEventListener('mouseover', onHover, true);
  document.removeEventListener('mouseout', onOut, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeyDown);
  document.body.style.cursor = '';
}

function clearHighlight() {
  if (hoveredEl) {
    hoveredEl.classList.remove('ai-translator-highlight');
    hoveredEl = null;
  }
}

function onHover(e) {
  if (!pickModeActive) return;
  clearHighlight();
  hoveredEl = e.target;
  hoveredEl.classList.add('ai-translator-highlight');
}

function onOut(e) {
  if (!pickModeActive) return;
  if (e.target === hoveredEl) {
    clearHighlight();
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    exitPickMode();
  }
}

async function onClick(e) {
  if (!pickModeActive) return;
  e.preventDefault();
  e.stopPropagation();

  const el = e.target;

  if (el.closest(`#${overlayId}`) || el.closest(`#${toastId}`)) return;

  el.classList.remove('ai-translator-highlight');

  const selector = generateSelector(el);
  const domain = window.location.hostname;
  const label = el.textContent?.trim()?.slice(0, 60) || selector;

  if (!validateSelector(selector)) {
    showToast('Could not generate a unique selector. Try a different element.', true);
    exitPickMode();
    return;
  }

  exitPickMode();

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      action: 'saveSection',
      section: { selector, domain, label },
    });
  } catch (err) {
    showToast(`Failed to save: ${err.message}`, true);
    return;
  }

  if (!response || response.error) {
    showToast(`Error saving section: ${response?.error || 'no response'}`, true);
    return;
  }

  el.classList.add('ai-translator-selected');
  showToast(`Section saved for "${domain}"`);
  setTimeout(() => el.classList.remove('ai-translator-selected'), 2000);
}

// ── DOM Text Extraction & Mapping (Token Optimization) ────────────────

const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA',
  'DFN', 'EM', 'I', 'KBD', 'MARK', 'Q', 'RP', 'RT', 'RUBY',
  'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME',
  'U', 'VAR', 'WBR'
]);

const IGNORE_TAGS = new Set([
  'SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'CANVAS', 'VIDEO',
  'AUDIO', 'IFRAME', 'OBJECT', 'TEMPLATE'
]);

function isVisible(el) {
  if (el.nodeType === Node.ELEMENT_NODE) {
    if (IGNORE_TAGS.has(el.tagName)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

// Check if element has only phrasing / text children (no nested blocks)
function isPhrasingContainer(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (IGNORE_TAGS.has(el.tagName)) return false;

  for (const child of el.children) {
    if (IGNORE_TAGS.has(child.tagName)) continue;
    if (!INLINE_TAGS.has(child.tagName)) return false;
    if (!isPhrasingContainer(child)) return false;
  }
  return true;
}

// Build serialized placeholder string for a phrasing container
function serializePhrasingContainer(containerEl) {
  const inlineNodes = [];
  let nextId = 0;

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (IGNORE_TAGS.has(node.tagName) || !isVisible(node)) return '';
      const id = nextId++;
      inlineNodes[id] = node;
      let innerText = '';
      for (const child of node.childNodes) {
        innerText += walk(child);
      }
      return `[${id}]${innerText}[/${id}]`;
    }
    return '';
  }

  let text = '';
  for (const child of containerEl.childNodes) {
    text += walk(child);
  }

  return { text, inlineNodes };
}

// Extract all translatable units from an element tree
function extractTranslatableUnits(rootEl) {
  const units = [];

  function traverse(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (IGNORE_TAGS.has(node.tagName) || !isVisible(node)) return;

      // If it's a leaf block or phrasing container containing text
      if (isPhrasingContainer(node)) {
        const { text, inlineNodes } = serializePhrasingContainer(node);
        if (text.trim().length > 0) {
          units.push({
            type: 'phrasing',
            element: node,
            inlineNodes,
            originalText: text,
          });
          return;
        }
      }

      // Otherwise traverse children
      for (const child of node.childNodes) {
        traverse(child);
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue;
      if (text && text.trim().length > 0) {
        units.push({
          type: 'textNode',
          node,
          originalText: text,
        });
      }
    }
  }

  traverse(rootEl);
  return units;
}

// Safely reconstruct children of phrasing container using translated string & inline elements
function applyPhrasingTranslation(containerEl, inlineNodes, translatedStr) {
  if (!inlineNodes || inlineNodes.length === 0) {
    containerEl.textContent = translatedStr;
    return;
  }

  const tokenRegex = /\[(\d+)\]([\s\S]*?)\[\/\1\]/g;
  let lastIndex = 0;
  let match;
  const newFragment = document.createDocumentFragment();
  let matchedAll = true;

  try {
    while ((match = tokenRegex.exec(translatedStr)) !== null) {
      // Text before match
      if (match.index > lastIndex) {
        newFragment.appendChild(
          document.createTextNode(translatedStr.slice(lastIndex, match.index))
        );
      }

      const id = parseInt(match[1], 10);
      const innerText = match[2];
      const inlineEl = inlineNodes[id];

      if (inlineEl) {
        // Strip nested placeholders if any remain inside innerText
        inlineEl.textContent = innerText.replace(/\[\/?\d+\]/g, '');
        newFragment.appendChild(inlineEl);
      } else {
        newFragment.appendChild(document.createTextNode(innerText));
      }

      lastIndex = tokenRegex.lastIndex;
    }

    // Trailing text
    if (lastIndex < translatedStr.length) {
      newFragment.appendChild(
        document.createTextNode(translatedStr.slice(lastIndex))
      );
    }

    containerEl.replaceChildren(newFragment);
  } catch (err) {
    // Graceful fallback if placeholder parsing encounters unexpected issue
    console.warn('[AI Translator] Fallback phrasing text replacement:', err);
    containerEl.textContent = translatedStr.replace(/\[\/?\d+\]/g, '');
  }
}

function applyTranslationsToUnits(units, translatedSegments) {
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const translated = translatedSegments[i];
    if (translated === undefined || translated === null) continue;

    if (unit.type === 'textNode') {
      if (unit.node && unit.node.parentNode) {
        unit.node.nodeValue = translated;
      }
    } else if (unit.type === 'phrasing') {
      if (unit.element && unit.element.parentNode) {
        applyPhrasingTranslation(unit.element, unit.inlineNodes, translated);
      }
    }
  }
}

// ── Auto-translate on page load ──────────────────────────────────────

async function autoTranslate(force = false) {
  const domain = window.location.hostname;
  if (!domain) return;

  let sections, settings;

  try {
    const secResp = await chrome.runtime.sendMessage({
      action: 'getSectionsForDomain',
      domain,
    });
    sections = secResp?.sections;

    const setResp = await chrome.runtime.sendMessage({ action: 'getSettings' });
    settings = setResp?.settings;
  } catch (err) {
    console.error('[AI Translator] Failed to contact background:', err);
    return;
  }

  if (!sections || sections.length === 0) {
    console.log('[AI Translator] No saved sections for', domain);
    return;
  }
  if (!force && !settings?.autoTranslate) {
    console.log('[AI Translator] Auto-translate disabled in settings');
    return;
  }

  // Translate sections sequentially to prevent API concurrency rate limits
  const BATCH = 1;
  let translated = 0;

  const eligible = [];
  for (const section of sections) {
    const sel = section.selector;
    const el = findElementSafe(sel);
    if (!el) {
      translationStatus[sel] = 'not-found';
      continue;
    }
    if (!force && el.dataset.aiTranslated) {
      translationStatus[sel] = 'translated';
      continue;
    }
    el.dataset.aiTranslated = 'in-progress';

    const tag = el.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') {
      translationStatus[sel] = 'skipped';
      continue;
    }
    eligible.push(el);
  }

  const selByEl = new Map();
  for (const section of sections) {
    const el = findElementSafe(section.selector);
    if (el && eligible.includes(el)) {
      selByEl.set(el, section.selector);
    }
  }

  for (let i = 0; i < eligible.length; i += BATCH) {
    const batch = eligible.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(el => translateElement(el, settings, force))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const el = batch[j];
      const sel = selByEl.get(el);

      if (el.dataset.aiTranslated === settings.targetLanguage) {
        translationStatus[sel] = 'translated';
        translated++;
      } else {
        translationStatus[sel] = 'failed';
        if (r.status === 'rejected') {
          console.error('[AI Translator] Translation error:', r.reason);
          const errorMsg = r.reason?.message || 'Translation failed';
          showToast(errorMsg, true);
        }
      }
    }
  }

  if (translated > 0) {
    showToast(`${force ? 'Re-translated' : 'Translated'} ${translated} section(s) on ${domain}`);
  }
}

function findElementSafe(selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

async function translateElement(el, settings, force = false) {
  let unitsData = originalDataMap.get(el);

  // Extract units if not previously cached or if forced from fresh DOM
  if (!unitsData || (!force && !el.dataset.aiTranslated)) {
    const units = extractTranslatableUnits(el);
    const segments = units.map(u => u.originalText);
    unitsData = { units, segments };
    originalDataMap.set(el, unitsData);
  }

  const { units, segments } = unitsData;
  if (!segments || segments.length === 0) return;

  el.classList.add('ai-translator-translating');

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      action: 'translate',
      segments,
      domain: window.location.hostname,
      targetLanguage: settings.targetLanguage,
      forceReTranslate: force,
    });
  } catch (err) {
    console.error('[AI Translator] Translation request failed:', err);
    el.classList.remove('ai-translator-translating');
    throw err;
  }

  el.classList.remove('ai-translator-translating');

  if (response?.error) {
    console.error('[AI Translator] Translation failed:', response.error);
    throw new Error(response.error);
  }

  const translatedSegments = response?.translatedSegments;
  if (!Array.isArray(translatedSegments) || translatedSegments.length === 0) {
    return;
  }

  // Apply translations directly onto DOM text units
  applyTranslationsToUnits(units, translatedSegments);
  el.dataset.aiTranslated = settings.targetLanguage;

  staggerRevealChildren(el);
}

function staggerRevealChildren(el) {
  const children = el.children;
  if (!children.length) return;

  for (let i = 0; i < children.length; i++) {
    children[i].style.opacity = '0';
  }

  requestAnimationFrame(() => {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      child.classList.add('ai-tr-stagger');
      child.style.animationDelay = `${i * 80}ms`;
    }
  });
}

// ── Message listener (from popup / background) ───────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'enterPickMode') {
    enterPickMode();
    sendResponse({ ok: true });
  } else if (request.action === 'exitPickMode') {
    exitPickMode();
    sendResponse({ ok: true });
  } else if (request.action === 'getTranslationStatus') {
    sendResponse({ status: { ...translationStatus } });
  } else if (request.action === 'forceReTranslate') {
    autoTranslate(true).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  } else {
    return false;
  }
  return true;
});

// ── Initialization ──────────────────────────────────────────────────

injectStyles();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => autoTranslate(false), 500);
  });
} else {
  setTimeout(() => autoTranslate(false), 500);
}
