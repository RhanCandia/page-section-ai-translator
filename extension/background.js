// Background service worker for Page Section AI Translator
// Proxies API calls (Gemini / OpenCode Zen), caching, and storage for content scripts.

const DEFAULT_SETTINGS = {
  provider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openCodeZenApiKey: '',
  openCodeZenModel: 'deepseek-v4-flash-free',
  targetLanguage: 'English',
  autoTranslate: true,
  cacheEnabled: true,
};

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  SECTIONS: 'savedSections',
  DOMAIN_PROMPTS: 'domainPrompts',
  DOMAIN_CONFIGS: 'domainConfigs',
  CACHE: 'translationCache',
};

const MAX_CACHE_ENTRIES = 500;

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

// ── Domain Configs (Overrides & Prompts) ──────────────────────────────

async function getDomainConfigs() {
  const {
    [STORAGE_KEYS.DOMAIN_CONFIGS]: domainConfigs = {},
    [STORAGE_KEYS.DOMAIN_PROMPTS]: domainPrompts = {},
  } = await chrome.storage.local.get([STORAGE_KEYS.DOMAIN_CONFIGS, STORAGE_KEYS.DOMAIN_PROMPTS]);

  // Backward-compatible merge with legacy domainPrompts
  const merged = { ...domainConfigs };
  for (const [dom, prompt] of Object.entries(domainPrompts)) {
    if (!merged[dom]) {
      merged[dom] = { prompt, provider: 'default', model: '' };
    } else if (!merged[dom].prompt && prompt) {
      merged[dom].prompt = prompt;
    }
  }
  return merged;
}

async function setDomainConfig({ domain, config }) {
  const domainConfigs = await getDomainConfigs();
  domainConfigs[domain] = {
    provider: config.provider || 'default',
    model: (config.model || '').trim(),
    prompt: (config.prompt || '').trim(),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_CONFIGS]: domainConfigs });

  // Sync with domainPrompts for compatibility
  const { domainPrompts = {} } = await chrome.storage.local.get(STORAGE_KEYS.DOMAIN_PROMPTS);
  domainPrompts[domain] = domainConfigs[domain].prompt;
  await chrome.storage.local.set({ [STORAGE_KEYS.DOMAIN_PROMPTS]: domainPrompts });

  return { domainConfigs };
}

async function getActiveConfigForDomain({ domain }) {
  const settings = await getSettings();
  const domainConfigs = await getDomainConfigs();
  const dc = domainConfigs[domain] || {};

  const effectiveProvider = (dc.provider && dc.provider !== 'default') ? dc.provider : settings.provider;
  const isProviderOverridden = Boolean(dc.provider && dc.provider !== 'default');

  const defaultModelForProvider = effectiveProvider === 'opencode-zen' ? settings.openCodeZenModel : settings.geminiModel;
  const effectiveModel = dc.model?.trim() || defaultModelForProvider;
  const isModelOverridden = Boolean(dc.model?.trim());

  const userPrompt = dc.prompt || '';

  return {
    effectiveProvider,
    effectiveModel,
    isProviderOverridden,
    isModelOverridden,
    userPrompt,
  };
}

// ── Cache helpers ────────────────────────────────────────────────────

async function getCache() {
  const { [STORAGE_KEYS.CACHE]: cache = {} } = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
  return cache;
}

async function hashKey(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function makeCacheKey(text, targetLang, provider, model, prompt = '') {
  const raw = `${text}::${targetLang}::${provider}::${model}::${prompt.trim()}`;
  return hashKey(raw);
}

async function getCachedTranslations(segments, targetLang, provider, model, prompt = '') {
  const cache = await getCache();
  const results = new Array(segments.length).fill(null);
  const missingIndices = [];
  const missingKeys = [];

  for (let i = 0; i < segments.length; i++) {
    const text = segments[i];
    if (!text || !text.trim()) {
      results[i] = text;
      continue;
    }
    const key = await makeCacheKey(text, targetLang, provider, model, prompt);
    if (cache[key] && typeof cache[key].translated === 'string') {
      results[i] = cache[key].translated;
      cache[key].lastAccessed = Date.now();
    } else {
      missingIndices.push(i);
      missingKeys.push(key);
    }
  }

  return { results, missingIndices, missingKeys, cache };
}

async function saveToCache(entries) {
  if (!entries || entries.length === 0) return;
  const cache = await getCache();

  for (const { key, original, translated } of entries) {
    cache[key] = {
      original,
      translated,
      lastAccessed: Date.now(),
    };
  }

  // LRU Eviction if cache exceeds capacity
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    keys.sort((a, b) => (cache[a].lastAccessed || 0) - (cache[b].lastAccessed || 0));
    const excess = keys.length - MAX_CACHE_ENTRIES;
    for (let i = 0; i < excess; i++) {
      delete cache[keys[i]];
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: cache });
}

async function clearCache() {
  await chrome.storage.local.remove(STORAGE_KEYS.CACHE);
  return { success: true };
}

async function getCacheStats() {
  const cache = await getCache();
  const count = Object.keys(cache).length;
  const bytes = new Blob([JSON.stringify(cache)]).size;
  return { count, bytes };
}

// ── JSON Response Extraction Helper ─────────────────────────────────

function parseJSONSafely(text) {
  let cleaned = text.trim();
  // Strip markdown code fences e.g. ```json ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // 1. Direct JSON.parse
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {}

  // 2. Substring between [ and ]
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const substr = cleaned.slice(firstBracket, lastBracket + 1);
    try {
      const parsed = JSON.parse(substr);
      if (Array.isArray(parsed)) return parsed;
    } catch {}

    // 3. Remove trailing commas
    try {
      const noTrailing = substr.replace(/,\s*([\]}])/g, '$1');
      const parsed = JSON.parse(noTrailing);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // 4. Regex string extractor (handles unescaped newlines, trailing commas, truncated arrays)
  if (firstBracket !== -1) {
    const arrayContent = cleaned.slice(firstBracket + 1);
    const results = [];
    const strRegex = /"((?:\\.|[^"\\])*)"/gs;
    let match;
    while ((match = strRegex.exec(arrayContent)) !== null) {
      try {
        const sanitized = match[1]
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        results.push(JSON.parse('"' + sanitized + '"'));
      } catch {
        results.push(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
      }
    }
    if (results.length > 0) return results;
  }

  // 5. Line by line fallback if returned as a list
  const lines = cleaned.split('\n')
    .map(l => l.replace(/^[-*•\d+.]\s*/, '').replace(/^"|"$/g, '').trim())
    .filter(l => l.length > 0 && l !== '[' && l !== ']');
  if (lines.length > 0) return lines;

  throw new Error(`Failed to parse translated text as JSON array: ${text.slice(0, 150)}...`);
}

// ── HTTP Fetch with Automatic Retry on Rate Limits (429 / 503) ───────

async function fetchWithRetry(url, options, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3 min

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // If rate limited or server temporarily overloaded, back off and retry
      if (response.status === 429 || response.status === 503 || response.status === 529) {
        if (attempt < maxRetries) {
          attempt++;
          const delayMs = attempt * 2500; // 2.5s, 5.0s
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      }
      return response;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt < maxRetries && err.name !== 'AbortError') {
        attempt++;
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }
      throw err;
    }
  }
}

// ── Gemini API (Segments) ────────────────────────────────────────────

const CHUNK_SIZE = 25;

async function translateSegmentsBatchGemini(segments, apiKey, model, targetLanguage, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let prompt = `You are a precise translator. Translate the following list of web text segments into ${targetLanguage}.

CRITICAL INSTRUCTIONS:
- You are provided a JSON array of strings to translate.
- Return ONLY a valid JSON array of strings with the EXACT same length and order as the input.
- Keep any inline placeholder tokens like [0], [/0], [1], [/1], etc. EXACTLY intact in their natural translated positions.
- Do NOT add any extra markdown formatting or explanations, ONLY return the raw JSON array.`;

  if (userPrompt && userPrompt.trim()) {
    prompt += `\n\nADDITIONAL USER INSTRUCTIONS:\n${userPrompt.trim()}`;
  }

  prompt += `\n\nJSON array to translate:\n${JSON.stringify(segments)}`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    if (response.status === 429 || errBody.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('Gemini rate limit exceeded. Please wait a moment before trying again.');
    }
    throw new Error(`Gemini API error ${response.status}: ${errBody.slice(0, 180)}`);
  }

  const data = await response.json();

  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    const ratings = data?.promptFeedback?.safetyRatings || [];
    const blocked = ratings.filter(r => r.blocked).map(r => `${r.category}=${r.probability}`).join(', ');
    throw new Error(`Prompt blocked by Gemini (${blockReason}): ${blocked}`);
  }

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

  return parseJSONSafely(text);
}

async function translateSegmentsWithGemini(segments, apiKey, model, targetLanguage, userPrompt) {
  if (segments.length <= CHUNK_SIZE) {
    return translateSegmentsBatchGemini(segments, apiKey, model, targetLanguage, userPrompt);
  }

  const results = [];
  for (let i = 0; i < segments.length; i += CHUNK_SIZE) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, 400));
    }
    const chunk = segments.slice(i, i + CHUNK_SIZE);
    const chunkResults = await translateSegmentsBatchGemini(chunk, apiKey, model, targetLanguage, userPrompt);
    results.push(...chunkResults);
  }
  return results;
}

// ── OpenCode Zen API (Segments) ──────────────────────────────────────

async function translateSegmentsBatchOpenCodeZen(segments, apiKey, model, targetLanguage, userPrompt) {
  const url = 'https://opencode.ai/zen/v1/chat/completions';

  const messages = [
    {
      role: 'system',
      content: `You are a precise translator. Translate the following list of web text segments into ${targetLanguage}.

CRITICAL INSTRUCTIONS:
- You are provided a JSON array of strings to translate.
- Return ONLY a valid JSON array of strings with the EXACT same length and order as the input.
- Keep any inline placeholder tokens like [0], [/0], [1], [/1], etc. EXACTLY intact in their natural translated positions.
- Do NOT add any extra markdown formatting or explanations, ONLY return the raw JSON array.`,
    },
  ];

  if (userPrompt && userPrompt.trim()) {
    messages.push({
      role: 'user',
      content: `ADDITIONAL INSTRUCTIONS:\n${userPrompt.trim()}`,
    });
    messages.push({
      role: 'assistant',
      content: 'Understood. I will follow those instructions.',
    });
  }

  messages.push({
    role: 'user',
    content: `Translate this JSON array to ${targetLanguage}:\n${JSON.stringify(segments)}`,
  });

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 16384,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    if (response.status === 429 || errBody.includes('FreeUsageLimitError') || errBody.includes('Rate limit')) {
      throw new Error('OpenCode Zen free rate limit reached. Please wait a few moments, or switch to Google Gemini (higher free limits) in settings.');
    }
    throw new Error(`OpenCode Zen API error ${response.status}: ${errBody.slice(0, 180)}`);
  }

  const data = await response.json();
  let text = data?.choices?.[0]?.message?.content;
  if (text === undefined || text === null) {
    throw new Error('OpenCode Zen returned no translation text');
  }

  return parseJSONSafely(text);
}

async function translateSegmentsWithOpenCodeZen(segments, apiKey, model, targetLanguage, userPrompt) {
  if (segments.length <= CHUNK_SIZE) {
    return translateSegmentsBatchOpenCodeZen(segments, apiKey, model, targetLanguage, userPrompt);
  }

  const results = [];
  for (let i = 0; i < segments.length; i += CHUNK_SIZE) {
    if (i > 0) {
      await new Promise(r => setTimeout(r, 600)); // pace free tier requests
    }
    const chunk = segments.slice(i, i + CHUNK_SIZE);
    const chunkResults = await translateSegmentsBatchOpenCodeZen(chunk, apiKey, model, targetLanguage, userPrompt);
    results.push(...chunkResults);
  }
  return results;
}

// ── Legacy HTML Translation Fallbacks ────────────────────────────────

async function translateHtmlWithGemini(html, apiKey, model, targetLanguage, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let prompt = `You are a precise translator. Translate the following HTML content to ${targetLanguage}.
IMPORTANT RULES:
- Preserve ALL HTML tags, attributes, class names, and structure EXACTLY as they are.
- Only translate the visible text content between tags.
- Return ONLY the translated HTML, no explanations or extra text.`;

  if (userPrompt && userPrompt.trim()) {
    prompt += `\n\nADDITIONAL INSTRUCTIONS:\n${userPrompt.trim()}`;
  }
  prompt += `\n\nHTML to translate:\n${html}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errBody}`);
  }
  const data = await response.json();
  let text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty translation');
  return text.replace(/^```(?:html)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

async function translateHtmlWithOpenCodeZen(html, apiKey, model, targetLanguage, userPrompt) {
  const url = 'https://opencode.ai/zen/v1/chat/completions';
  const messages = [
    {
      role: 'system',
      content: `You are a precise translator. Translate the following HTML content to ${targetLanguage}. Preserve all tags and attributes. Return ONLY translated HTML.`,
    },
  ];
  if (userPrompt && userPrompt.trim()) {
    messages.push({ role: 'user', content: userPrompt.trim() });
    messages.push({ role: 'assistant', content: 'Understood.' });
  }
  messages.push({ role: 'user', content: html });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 16384 }),
  });
  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`OpenCode Zen API error ${response.status}: ${errBody}`);
  }
  const data = await response.json();
  let text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenCode Zen returned empty translation');
  return text.replace(/^```(?:html)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
}

// ── Translation Handler ─────────────────────────────────────────────

async function handleTranslate({ segments, html, domain, targetLanguage, forceReTranslate = false }) {
  try {
    const settings = await getSettings();
    const lang = targetLanguage || settings.targetLanguage;
    const useCache = settings.cacheEnabled !== false && !forceReTranslate;

    // Resolve per-domain overrides & prompt
    const {
      effectiveProvider,
      effectiveModel,
      userPrompt,
    } = await getActiveConfigForDomain({ domain });

    // Validate provider API key
    if (effectiveProvider === 'opencode-zen') {
      if (!settings.openCodeZenApiKey) {
        return { error: `OpenCode Zen API key not configured for ${domain || 'this page'}. Open extension settings to add it.` };
      }
    } else {
      if (!settings.geminiApiKey) {
        return { error: `Gemini API key not configured for ${domain || 'this page'}. Open extension settings to add it.` };
      }
    }

    // Modern Segment-based Translation
    if (Array.isArray(segments)) {
      if (segments.length === 0) {
        return { translatedSegments: [], fromCache: true };
      }

      let results = new Array(segments.length).fill(null);
      let missingIndices = [];
      let missingKeys = [];

      if (useCache) {
        const cacheLookup = await getCachedTranslations(segments, lang, effectiveProvider, effectiveModel, userPrompt);
        results = cacheLookup.results;
        missingIndices = cacheLookup.missingIndices;
        missingKeys = cacheLookup.missingKeys;
      } else {
        missingIndices = segments.map((_, i) => i);
        missingKeys = await Promise.all(
          segments.map(s => makeCacheKey(s, lang, effectiveProvider, effectiveModel, userPrompt))
        );
      }

      // If all segments are cached
      if (missingIndices.length === 0) {
        return { translatedSegments: results, fromCache: true };
      }

      const missingSegments = missingIndices.map(i => segments[i]);

      let translatedBatch;
      if (effectiveProvider === 'opencode-zen') {
        translatedBatch = await translateSegmentsWithOpenCodeZen(
          missingSegments,
          settings.openCodeZenApiKey,
          effectiveModel,
          lang,
          userPrompt
        );
      } else {
        translatedBatch = await translateSegmentsWithGemini(
          missingSegments,
          settings.geminiApiKey,
          effectiveModel,
          lang,
          userPrompt
        );
      }

      // Map back to results & prepare cache entries
      const cacheEntries = [];
      for (let j = 0; j < missingIndices.length; j++) {
        const origIdx = missingIndices[j];
        const translatedStr = (translatedBatch && translatedBatch[j] !== undefined)
          ? String(translatedBatch[j])
          : segments[origIdx];
        results[origIdx] = translatedStr;
        cacheEntries.push({
          key: missingKeys[j],
          original: segments[origIdx],
          translated: translatedStr,
        });
      }

      if (settings.cacheEnabled !== false) {
        await saveToCache(cacheEntries);
      }

      return { translatedSegments: results, fromCache: false };
    }

    // Legacy HTML Translation (Fallback)
    if (typeof html === 'string') {
      const key = await makeCacheKey(html, lang, effectiveProvider, effectiveModel, userPrompt);

      if (useCache) {
        const cache = await getCache();
        if (cache[key]?.translated) {
          return { translated: cache[key].translated, fromCache: true };
        }
      }

      let translated;
      if (effectiveProvider === 'opencode-zen') {
        translated = await translateHtmlWithOpenCodeZen(
          html,
          settings.openCodeZenApiKey,
          effectiveModel,
          lang,
          userPrompt
        );
      } else {
        translated = await translateHtmlWithGemini(
          html,
          settings.geminiApiKey,
          effectiveModel,
          lang,
          userPrompt
        );
      }

      if (settings.cacheEnabled !== false) {
        await saveToCache([{ key, original: html, translated }]);
      }

      return { translated, fromCache: false };
    }

    return { error: 'No content provided for translation.' };
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'API request timed out after 5 minutes. Try a smaller section or a different model.'
      : err.message;
    return { error: msg };
  }
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
    case 'getDomainConfigs':
      getDomainConfigs().then(domainConfigs => respond({ domainConfigs }), fail);
      return true;
    case 'setDomainConfig':
      setDomainConfig(request).then(respond, fail);
      return true;
    case 'getActiveConfigForDomain':
      getActiveConfigForDomain(request).then(respond, fail);
      return true;
    case 'clearCache':
      clearCache().then(respond, fail);
      return true;
    case 'getCacheStats':
      getCacheStats().then(respond, fail);
      return true;
    default:
      return false;
  }
});

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
  const domainConfigs = await getDomainConfigs();
  const domainPrompts = {};
  for (const [dom, cfg] of Object.entries(domainConfigs)) {
    domainPrompts[dom] = cfg.prompt || '';
  }
  return { domainPrompts };
}

async function handleSetDomainPrompt({ domain, prompt }) {
  const domainConfigs = await getDomainConfigs();
  const existing = domainConfigs[domain] || { provider: 'default', model: '' };
  existing.prompt = prompt;
  return setDomainConfig({ domain, config: existing });
}
