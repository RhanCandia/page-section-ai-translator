// Content script for Page Section AI Translator
// Handles: pick mode (section selection) + auto-translation on page load.

// ── State ────────────────────────────────────────────────────────────

let pickModeActive = false;
let hoveredEl = null;
const overlayId = 'ai-translator-overlay';
const toastId = 'ai-translator-toast';

// Per-section translation status, keyed by selector
// Values: 'translated' | 'failed' | 'not-found' | 'skipped'
const translationStatus = {};

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
  // Use ID if available — globally unique
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return `#${CSS.escape(el.id)}`;
  }

  const parts = [];
  let current = el;

  while (current && current !== document.body && current !== document.documentElement) {
    let seg = current.tagName.toLowerCase();

    // ID is unique — anchor here
    if (current.id && document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
      seg = `#${CSS.escape(current.id)}`;
      parts.unshift(seg);
      break;
    }

    // Add relevant classes (skip auto-generated/injected ones)
    const stableClasses = Array.from(current.classList).filter(
      c => !/^ai-translator-/.test(c) && !/^[a-z]+-[a-f0-9]{4,}$/i.test(c) && c.length > 1
    );
    if (stableClasses.length) {
      seg += '.' + stableClasses.map(c => CSS.escape(c)).join('.');
    }

    // nth-child disambiguation only when needed
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        s => s.tagName === current.tagName
      );
      const allSiblings = Array.from(parent.children);
      const sameTagIndex = siblings.indexOf(current);
      if (sameTagIndex === -1) {
        // Shouldn't happen, fallback to all-children index
        const allIndex = allSiblings.indexOf(current);
        seg += `:nth-child(${allIndex + 1})`;
      } else if (siblings.length > 1) {
        // Use nth-child with all-children index for accuracy
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

  // Don't pick the overlay/toast elements
  if (el.closest(`#${overlayId}`) || el.closest(`#${toastId}`)) return;

  // Remove hover highlight so it doesn't get baked into the saved selector
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

  // Save section via background
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

  // Visual confirmation
  el.classList.add('ai-translator-selected');
  showToast(`Section saved for "${domain}"`);
  setTimeout(() => el.classList.remove('ai-translator-selected'), 2000);
}

// ── Auto-translate on page load ──────────────────────────────────────

async function autoTranslate() {
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
  if (!settings?.autoTranslate) {
    console.log('[AI Translator] Auto-translate disabled in settings');
    return;
  }

  // Translate sections in parallel batches of 3
  const BATCH = 3;
  let translated = 0;

  const eligible = [];
  for (const section of sections) {
    const sel = section.selector;
    const el = findElementSafe(sel);
    if (!el) {
      translationStatus[sel] = 'not-found';
      continue;
    }
    if (el.dataset.aiTranslated) {
      translationStatus[sel] = 'translated';
      continue;
    }
    el.dataset.aiTranslated = 'true';

    const tag = el.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') {
      translationStatus[sel] = 'skipped';
      continue;
    }
    eligible.push(el);
  }

  // Map eligible elements back to their selectors
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
      batch.map(el => translateElement(el, settings))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const sel = selByEl.get(batch[j]);
      if (r.status === 'fulfilled') {
        translationStatus[sel] = 'translated';
        translated++;
      } else {
        translationStatus[sel] = 'failed';
        console.error('[AI Translator] Translation error:', r.reason);
        showToast('Translation failed: check console for details', true);
      }
    }
  }

  if (translated > 0) {
    showToast(`Translated ${translated} section(s) on ${domain}`);
  }
}

function findElementSafe(selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

async function translateElement(el, settings) {
  let originalHtml = el.innerHTML;
  if (!originalHtml.trim()) return;

  // Cap HTML size to avoid slow API calls and message size limits
  const MAX_HTML_SIZE = 50000;
  if (originalHtml.length > MAX_HTML_SIZE) {
    console.warn(
      `[AI Translator] Section HTML is ${originalHtml.length} chars, truncating to ~${MAX_HTML_SIZE}`
    );
    // Truncate at the last closing angle bracket before the limit
    const truncated = originalHtml.slice(0, MAX_HTML_SIZE);
    const lastClose = truncated.lastIndexOf('>');
    originalHtml = lastClose > MAX_HTML_SIZE * 0.8
      ? truncated.slice(0, lastClose + 1)
      : truncated;
  }

  // Show thin progress bar at top of element while waiting
  el.classList.add('ai-translator-translating');

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      action: 'translate',
      html: originalHtml,
      domain: window.location.hostname,
      targetLanguage: settings.targetLanguage,
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

  if (!response?.translated || response.translated === originalHtml) {
    return; // nothing changed, keep original
  }

  // Replace all content at once, then stagger-reveal children
  el.innerHTML = response.translated;
  el.dataset.aiTranslated = settings.targetLanguage;

  staggerRevealChildren(el);
}

function staggerRevealChildren(el) {
  const children = el.children;
  if (!children.length) return;

  // Set all children invisible first so they don't flash before animation kicks in
  for (let i = 0; i < children.length; i++) {
    children[i].style.opacity = '0';
  }

  // Start stagger on the next frame so opacity:0 renders before animation begins
  requestAnimationFrame(() => {
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      child.classList.add('ai-tr-stagger');
      child.style.animationDelay = `${i * 120}ms`;
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
  } else {
    return false; // not handled
  }
  return true; // keep channel open for sendResponse
});

// ── Initialization ──────────────────────────────────────────────────

injectStyles();

// Run auto-translate after a short delay to let page fully render
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(autoTranslate, 500);
  });
} else {
  setTimeout(autoTranslate, 500);
}
