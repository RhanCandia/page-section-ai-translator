// Background service worker for Page Section AI Translator
// Proxies API calls (Gemini) and storage for content scripts.

const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.0-flash',
  targetLanguage: 'Spanish',
  autoTranslate: true,
};

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  SECTIONS: 'savedSections',
  DOMAIN_PROMPTS: 'domainPrompts',
};

// ── Storage helpers ──────────────────────────────────────────────────

async function getSettings() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function getSections() {
  const { savedSections = [] } = await chrome.storage.local.get(STORAGE_KEYS.SECTIONS);
  return savedSections;
}

async function saveSection(section) {
  const sections = await getSections();
  sections.push({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...section,
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.SECTIONS]: sections });
  return sections;
}

async function deleteSection(id) {
  const sections = await getSections();
  const filtered = sections.filter(s => s.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.SECTIONS]: filtered });
  return filtered;
}

// ── Gemini API ───────────────────────────────────────────────────────

async function translateWithGemini(html, apiKey, model, targetLanguage, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let prompt = `You are a precise translator. Translate the following HTML content to ${targetLanguage}.

IMPORTANT RULES:
- Preserve ALL HTML tags, attributes, class names, and structure EXACTLY as they are.
- Only translate the visible text content between tags.
- Do NOT modify tag names, attribute values, class names, or IDs.
- Keep the exact same HTML structure.
- Return ONLY the translated HTML, no explanations or extra text.`;

  if (userPrompt && userPrompt.trim()) {
    prompt += `\n\nADDITIONAL INSTRUCTIONS FROM THE USER:\n${userPrompt.trim()}`;
  }

  prompt += `\n\nHTML to translate:\n${html}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }],
      }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();

  // Check for prompt-level blocking (content flagged before generation)
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    const ratings = data?.promptFeedback?.safetyRatings || [];
    const blocked = ratings.filter(r => r.blocked).map(r => `${r.category}=${r.probability}`).join(', ');
    throw new Error(`Prompt blocked by Gemini (${blockReason}): ${blocked}`);
  }

  // Check candidate-level blocking
  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    const safetyRatings = candidate?.safetyRatings || [];
    const details = safetyRatings.map(r => `${r.category}=${r.probability}`).join(', ');
    throw new Error(`Gemini stopped: ${finishReason} (${details})`);
  }

  let text = candidate?.content?.parts?.[0]?.text;
  if (text === undefined || text === null) {
    throw new Error('Gemini returned no translation text');
  }
  // Strip possible markdown code fences that some models wrap responses in
  text = text.replace(/^```(?:html)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
  return text;
}

// ── Message dispatcher ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const respond = (result) => sendResponse(result);
  const fail = (err) => { sendResponse({ error: err?.message || String(err) }); };

  switch (request.action) {
    case 'translate':
      handleTranslate(request).then(respond, fail);
      return true;
    case 'getSectionsForDomain':
      handleGetSectionsForDomain(request).then(respond, fail);
      return true;
    case 'saveSection':
      handleSaveSection(request).then(respond, fail);
      return true;
    case 'deleteSection':
      handleDeleteSection(request).then(respond, fail);
      return true;
    case 'getSettings':
      handleGetSettings().then(respond, fail);
      return true;
    case 'updateSettings':
      handleUpdateSettings(request.settings).then(respond, fail);
      return true;
    case 'getDomainPrompts':
      handleGetDomainPrompts().then(respond, fail);
      return true;
    case 'setDomainPrompt':
      handleSetDomainPrompt(request).then(respond, fail);
      return true;
    default:
      return false;
  }
});

async function handleTranslate({ html, domain, selector, targetLanguage }) {
  try {
    const settings = await getSettings();
    const lang = targetLanguage || settings.targetLanguage;

    if (!settings.geminiApiKey) {
      return { error: 'Gemini API key not configured. Open extension settings.' };
    }

    // Look up per-domain custom instructions
    const { domainPrompts = {} } = await chrome.storage.local.get(STORAGE_KEYS.DOMAIN_PROMPTS);
    const userPrompt = domainPrompts[domain] || '';

    const translated = await translateWithGemini(
      html,
      settings.geminiApiKey,
      settings.geminiModel,
      lang,
      userPrompt,
    );

    return { translated };
  } catch (err) {
    return { error: err.message };
  }
}

async function handleGetSectionsForDomain({ domain }) {
  const sections = await getSections();
  return { sections: sections.filter(s => s.domain === domain) };
}

async function handleSaveSection({ section }) {
  const all = await saveSection(section);
  return { sections: all };
}

async function handleDeleteSection({ id }) {
  const all = await deleteSection(id);
  return { sections: all };
}

async function handleGetSettings() {
  const settings = await getSettings();
  return { settings };
}

async function handleUpdateSettings(newSettings) {
  const current = await getSettings();
  const merged = { ...current, ...newSettings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return { settings: merged };
}

async function handleGetDomainPrompts() {
  const { domainPrompts = {} } = await chrome.storage.local.get(STORAGE_KEYS.DOMAIN_PROMPTS);
  return { domainPrompts };
}

async function handleSetDomainPrompt({ domain, prompt }) {
  const { domainPrompts = {} } = await chrome.storage.local.get(STORAGE_KEYS.DOMAIN_PROMPTS);
  domainPrompts[domain] = prompt;
  await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_PROMPTS]: domainPrompts });
  return { domainPrompts };
}
