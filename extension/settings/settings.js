// Settings page for Page Section AI Translator

document.addEventListener('DOMContentLoaded', async () => {
  // ── DOM refs ──────────────────────────────────────────────────────

  const providerSelect = document.getElementById('provider');
  const geminiModelInput = document.getElementById('gemini-model');
  const ocZenModelInput = document.getElementById('oc-zen-model');
  const geminiApiKeyInput = document.getElementById('gemini-api-key');
  const ocZenApiKeyInput = document.getElementById('oc-zen-api-key');
  const toggleGeminiKeyBtn = document.getElementById('toggle-gemini-key');
  const toggleOcZenKeyBtn = document.getElementById('toggle-oc-zen-key');
  const testGeminiBtn = document.getElementById('test-gemini-btn');
  const testGeminiStatus = document.getElementById('test-gemini-status');
  const testOcZenBtn = document.getElementById('test-oc-zen-btn');
  const testOcZenStatus = document.getElementById('test-oc-zen-status');
  const targetLangInput = document.getElementById('target-lang');
  const autoTranslateCheck = document.getElementById('auto-translate');
  const cacheEnabledCheck = document.getElementById('cache-enabled');
  const cacheStatsLabel = document.getElementById('cache-stats-label');
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  const cacheStatus = document.getElementById('cache-status');
  const saveBtn = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');
  const allSectionsList = document.getElementById('all-sections-list');

  let currentSettings = {};
  let domainConfigsCache = {};

  // ── Load settings ─────────────────────────────────────────────────

  async function loadSettings() {
    const { settings } = await chrome.runtime.sendMessage({ action: 'getSettings' });
    if (!settings) return;
    currentSettings = settings;

    providerSelect.value = settings.provider || 'gemini';
    geminiModelInput.value = settings.geminiModel || 'gemini-2.5-flash';
    ocZenModelInput.value = settings.openCodeZenModel || 'deepseek-v4-flash-free';
    geminiApiKeyInput.value = settings.geminiApiKey || '';
    ocZenApiKeyInput.value = settings.openCodeZenApiKey || '';
    targetLangInput.value = settings.targetLanguage || 'English';
    autoTranslateCheck.checked = settings.autoTranslate !== false;
    cacheEnabledCheck.checked = settings.cacheEnabled !== false;
  }

  // ── Cache Stats & Clearing ────────────────────────────────────────

  async function loadCacheStats() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getCacheStats' });
      if (resp && typeof resp.count === 'number') {
        const kb = (resp.bytes / 1024).toFixed(1);
        cacheStatsLabel.textContent = `${resp.count} cached item${resp.count !== 1 ? 's' : ''} (~${kb} KB)`;
      } else {
        cacheStatsLabel.textContent = 'Cache stats unavailable';
      }
    } catch {
      cacheStatsLabel.textContent = '0 cached items';
    }
  }

  clearCacheBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear all cached translations?')) return;
    clearCacheBtn.disabled = true;
    cacheStatus.textContent = 'Clearing...';
    cacheStatus.className = 'cache-status';

    try {
      await chrome.runtime.sendMessage({ action: 'clearCache' });
      cacheStatus.textContent = 'Cache cleared!';
      cacheStatus.className = 'cache-status success';
      await loadCacheStats();
    } catch (err) {
      cacheStatus.textContent = `Error: ${err.message}`;
      cacheStatus.className = 'cache-status error';
    } finally {
      clearCacheBtn.disabled = false;
      setTimeout(() => {
        cacheStatus.textContent = '';
        cacheStatus.className = 'cache-status';
      }, 3000);
    }
  });

  // ── Load domain configs ───────────────────────────────────────────

  async function loadDomainConfigs() {
    const { domainConfigs } = await chrome.runtime.sendMessage({ action: 'getDomainConfigs' });
    domainConfigsCache = domainConfigs || {};
    return domainConfigsCache;
  }

  async function saveDomainConfig(domain, config) {
    domainConfigsCache[domain] = config;
    const { domainConfigs } = await chrome.runtime.sendMessage({
      action: 'setDomainConfig',
      domain,
      config,
    });
    domainConfigsCache = domainConfigs;
  }

  // ── Load sections (grouped by domain) ─────────────────────────────

  async function loadAllSections() {
    const [savedSections, domainConfigs] = await Promise.all([
      chrome.storage.local.get('savedSections').then(r => r.savedSections || []),
      loadDomainConfigs(),
    ]);

    allSectionsList.innerHTML = '';

    if (savedSections.length === 0) {
      allSectionsList.innerHTML =
        '<p class="empty-state">No sections saved yet. Open a page and use "Pick Section" from the extension popup.</p>';
      return;
    }

    // Group by domain, sort alphabetically
    const byDomain = {};
    for (const s of savedSections) {
      if (!byDomain[s.domain]) byDomain[s.domain] = [];
      byDomain[s.domain].push(s);
    }

    const domains = Object.keys(byDomain).sort();

    for (const domain of domains) {
      const card = buildDomainCard(domain, byDomain[domain], domainConfigs[domain] || {});
      allSectionsList.appendChild(card);
    }
  }

  function getGlobalProviderLabel() {
    return providerSelect.value === 'opencode-zen' ? 'OpenCode Zen' : 'Google Gemini';
  }

  function getDefaultModelForProvider(provider) {
    if (provider === 'opencode-zen') {
      return ocZenModelInput.value.trim() || 'deepseek-v4-flash-free';
    }
    return geminiModelInput.value.trim() || 'gemini-2.5-flash';
  }

  function hasKeyForProvider(provider) {
    if (provider === 'opencode-zen') {
      return Boolean(ocZenApiKeyInput.value.trim());
    }
    return Boolean(geminiApiKeyInput.value.trim());
  }

  function buildDomainCard(domain, sections, currentConfig) {
    const card = document.createElement('div');
    card.className = 'domain-card';

    // ── Domain header ─────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'domain-card-header';

    const title = document.createElement('div');
    title.className = 'domain-card-title';
    title.textContent = domain;

    const count = document.createElement('span');
    count.className = 'domain-card-count';
    count.textContent = `${sections.length} section${sections.length !== 1 ? 's' : ''}`;
    title.appendChild(count);

    header.appendChild(title);
    card.appendChild(header);

    // ── Sections list ─────────────────────────────────────────────
    const list = document.createElement('div');
    list.className = 'domain-card-sections';

    for (const section of sections) {
      const item = document.createElement('div');
      item.className = 'section-item';
      item.dataset.id = section.id;

      const info = document.createElement('div');
      info.className = 'section-info';

      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = section.label || '(no label)';
      info.appendChild(label);

      const selector = document.createElement('div');
      selector.className = 'section-selector';
      selector.textContent = section.selector;
      info.appendChild(selector);

      const delBtn = document.createElement('button');
      delBtn.className = 'section-delete';
      delBtn.textContent = '✕';
      delBtn.title = 'Remove section';
      delBtn.addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ action: 'deleteSection', id: section.id });
        await loadAllSections();
      });

      item.appendChild(info);
      item.appendChild(delBtn);
      list.appendChild(item);
    }

    card.appendChild(list);

    // ── Domain Overrides Block ─────────────────────────────────────
    const overridesBlock = document.createElement('div');
    overridesBlock.className = 'domain-overrides-block';

    const overrideGrid = document.createElement('div');
    overrideGrid.className = 'domain-override-grid';

    // Provider override select
    const providerItem = document.createElement('div');
    providerItem.className = 'domain-override-item';
    const providerLabel = document.createElement('label');
    providerLabel.textContent = 'Provider Override';
    const domainProviderSelect = document.createElement('select');

    const optDefault = document.createElement('option');
    optDefault.value = 'default';
    optDefault.textContent = `Default (${getGlobalProviderLabel()})`;

    const optGemini = document.createElement('option');
    optGemini.value = 'gemini';
    optGemini.textContent = 'Google Gemini';

    const optZen = document.createElement('option');
    optZen.value = 'opencode-zen';
    optZen.textContent = 'OpenCode Zen';

    domainProviderSelect.appendChild(optDefault);
    domainProviderSelect.appendChild(optGemini);
    domainProviderSelect.appendChild(optZen);
    domainProviderSelect.value = currentConfig.provider || 'default';

    providerItem.appendChild(providerLabel);
    providerItem.appendChild(domainProviderSelect);
    overrideGrid.appendChild(providerItem);

    // Model override input
    const modelItem = document.createElement('div');
    modelItem.className = 'domain-override-item';
    const modelLabel = document.createElement('label');
    modelLabel.textContent = 'Model Override';
    const domainModelInput = document.createElement('input');
    domainModelInput.type = 'text';
    domainModelInput.value = currentConfig.model || '';
    modelItem.appendChild(modelLabel);
    modelItem.appendChild(domainModelInput);
    overrideGrid.appendChild(modelItem);

    overridesBlock.appendChild(overrideGrid);

    // Key warning badge
    const warningBadge = document.createElement('div');
    warningBadge.className = 'key-warning-badge';
    warningBadge.style.display = 'none';
    overridesBlock.appendChild(warningBadge);

    function updateModelFieldState() {
      const selectedProv = domainProviderSelect.value;
      const effectiveProv = selectedProv === 'default' ? providerSelect.value : selectedProv;
      const defaultModel = getDefaultModelForProvider(effectiveProv);

      domainModelInput.placeholder = `Default (${defaultModel})`;
      domainModelInput.setAttribute(
        'list',
        effectiveProv === 'opencode-zen' ? 'oc-zen-model-suggestions' : 'gemini-model-suggestions'
      );

      // Check key presence
      if (!hasKeyForProvider(effectiveProv)) {
        const provName = effectiveProv === 'opencode-zen' ? 'OpenCode Zen' : 'Google Gemini';
        warningBadge.innerHTML = `⚠️ <span>${provName} API key is not configured in the API Keys section above.</span>`;
        warningBadge.style.display = 'flex';
      } else {
        warningBadge.style.display = 'none';
      }
    }

    domainProviderSelect.addEventListener('change', updateModelFieldState);
    updateModelFieldState();

    // ── Prompt editor ─────────────────────────────────────────────
    const promptLabel = document.createElement('label');
    promptLabel.className = 'domain-prompt-label';
    promptLabel.textContent = 'Custom Instructions';
    overridesBlock.appendChild(promptLabel);

    const textarea = document.createElement('textarea');
    textarea.className = 'domain-prompt-input';
    textarea.placeholder = 'e.g. Use formal tone, keep proper nouns untranslated, preserve technical terms in English...';
    textarea.value = currentConfig.prompt || '';
    overridesBlock.appendChild(textarea);

    // ── Save row ───────────────────────────────────────────────────
    const footerRow = document.createElement('div');
    footerRow.className = 'domain-footer-row';

    const promptStatus = document.createElement('span');
    promptStatus.className = 'prompt-status';
    footerRow.appendChild(promptStatus);

    const saveDomainBtn = document.createElement('button');
    saveDomainBtn.className = 'prompt-save-btn';
    saveDomainBtn.textContent = 'Save Domain Settings';
    footerRow.appendChild(saveDomainBtn);

    overridesBlock.appendChild(footerRow);

    saveDomainBtn.addEventListener('click', async () => {
      const config = {
        provider: domainProviderSelect.value,
        model: domainModelInput.value.trim(),
        prompt: textarea.value.trim(),
      };
      try {
        await saveDomainConfig(domain, config);
        promptStatus.textContent = 'Saved!';
        promptStatus.className = 'prompt-status success';
      } catch (err) {
        promptStatus.textContent = `Error: ${err.message}`;
        promptStatus.className = 'prompt-status error';
      }
      setTimeout(() => {
        promptStatus.textContent = '';
        promptStatus.className = 'prompt-status';
      }, 2500);
    });

    card.appendChild(overridesBlock);
    return card;
  }

  // ── Save Global Settings ─────────────────────────────────────────

  saveBtn.addEventListener('click', async () => {
    const settings = {
      provider: providerSelect.value,
      geminiApiKey: geminiApiKeyInput.value.trim(),
      geminiModel: geminiModelInput.value.trim() || 'gemini-2.5-flash',
      openCodeZenApiKey: ocZenApiKeyInput.value.trim(),
      openCodeZenModel: ocZenModelInput.value.trim() || 'deepseek-v4-flash-free',
      targetLanguage: targetLangInput.value.trim() || 'English',
      autoTranslate: autoTranslateCheck.checked,
      cacheEnabled: cacheEnabledCheck.checked,
    };

    try {
      const { settings: saved } = await chrome.runtime.sendMessage({
        action: 'updateSettings',
        settings,
      });

      if (saved) {
        currentSettings = saved;
        saveStatus.textContent = 'Saved!';
        saveStatus.className = 'success';
        await loadAllSections(); // refresh domain cards with updated defaults
      }
    } catch (err) {
      saveStatus.textContent = `Error: ${err.message}`;
      saveStatus.className = 'error';
    }

    setTimeout(() => {
      saveStatus.textContent = '';
      saveStatus.className = '';
    }, 2500);
  });

  // ── Test API Keys ─────────────────────────────────────────────────

  testGeminiBtn.addEventListener('click', async () => {
    const apiKey = geminiApiKeyInput.value.trim();
    if (!apiKey) {
      testGeminiStatus.textContent = 'Enter a Gemini API key first.';
      testGeminiStatus.className = 'test-key-status error';
      return;
    }
    const model = geminiModelInput.value.trim() || 'gemini-2.5-flash';
    testGeminiStatus.textContent = 'Testing Gemini key...';
    testGeminiStatus.className = 'test-key-status';

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: 'Reply with exactly the word: OK' }],
            }],
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        testGeminiStatus.textContent = `Gemini error (${response.status}): ${err.slice(0, 150)}`;
        testGeminiStatus.className = 'test-key-status error';
        return;
      }

      testGeminiStatus.textContent = 'Gemini API key works!';
      testGeminiStatus.className = 'test-key-status success';
    } catch (err) {
      testGeminiStatus.textContent = `Network error: ${err.message}`;
      testGeminiStatus.className = 'test-key-status error';
    }

    setTimeout(() => {
      testGeminiStatus.textContent = '';
      testGeminiStatus.className = 'test-key-status';
    }, 4000);
  });

  testOcZenBtn.addEventListener('click', async () => {
    const apiKey = ocZenApiKeyInput.value.trim();
    if (!apiKey) {
      testOcZenStatus.textContent = 'Enter an OpenCode Zen API key first.';
      testOcZenStatus.className = 'test-key-status error';
      return;
    }
    const model = ocZenModelInput.value.trim() || 'deepseek-v4-flash-free';
    testOcZenStatus.textContent = 'Testing OpenCode Zen key...';
    testOcZenStatus.className = 'test-key-status';

    try {
      const response = await fetch('https://opencode.ai/zen/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'user', content: 'Reply with exactly the word: OK' },
          ],
          max_tokens: 10,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        testOcZenStatus.textContent = `OpenCode Zen error (${response.status}): ${err.slice(0, 150)}`;
        testOcZenStatus.className = 'test-key-status error';
        return;
      }

      testOcZenStatus.textContent = 'OpenCode Zen API key works!';
      testOcZenStatus.className = 'test-key-status success';
    } catch (err) {
      testOcZenStatus.textContent = `Network error: ${err.message}`;
      testOcZenStatus.className = 'test-key-status error';
    }

    setTimeout(() => {
      testOcZenStatus.textContent = '';
      testOcZenStatus.className = 'test-key-status';
    }, 4000);
  });

  // ── Toggle key visibility ─────────────────────────────────────────

  function toggleInput(btn, input) {
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '\u{1F441}';
    } else {
      input.type = 'password';
      btn.textContent = '\u{1F441}';
    }
  }

  toggleGeminiKeyBtn.addEventListener('click', () => toggleInput(toggleGeminiKeyBtn, geminiApiKeyInput));
  toggleOcZenKeyBtn.addEventListener('click', () => toggleInput(toggleOcZenKeyBtn, ocZenApiKeyInput));

  // ── Support Link ──────────────────────────────────────────────────

  const kofiSettingsLink = document.getElementById('kofi-settings-link');
  if (kofiSettingsLink) {
    kofiSettingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://ko-fi.com/rhncnd' });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────

  await loadSettings();
  await loadCacheStats();
  await loadAllSections();
});
