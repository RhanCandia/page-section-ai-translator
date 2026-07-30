// Settings page for Page Section AI Translator

document.addEventListener('DOMContentLoaded', async () => {
  // ── DOM refs ──────────────────────────────────────────────────────

  const providerSelect = document.getElementById('provider');
  const geminiApiKeyInput = document.getElementById('gemini-api-key');
  const geminiModelInput = document.getElementById('gemini-model');
  const toggleGeminiKeyBtn = document.getElementById('toggle-gemini-key');
  const ocZenApiKeyInput = document.getElementById('oc-zen-api-key');
  const ocZenModelInput = document.getElementById('oc-zen-model');
  const toggleOcZenKeyBtn = document.getElementById('toggle-oc-zen-key');
  const targetLangInput = document.getElementById('target-lang');
  const autoTranslateCheck = document.getElementById('auto-translate');
  const saveBtn = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');
  const testBtn = document.getElementById('test-btn');
  const testStatus = document.getElementById('test-status');
  const allSectionsList = document.getElementById('all-sections-list');

  // ── Show/hide provider sections ──────────────────────────────────

  function toggleProviderSections(provider) {
    document.querySelectorAll('.provider-section').forEach(el => {
      el.style.display = el.dataset.provider === provider ? '' : 'none';
    });
  }

  // ── Load settings ─────────────────────────────────────────────────

  async function loadSettings() {
    const { settings } = await chrome.runtime.sendMessage({ action: 'getSettings' });
    if (!settings) return;

    providerSelect.value = settings.provider || 'gemini';
    toggleProviderSections(providerSelect.value);

    geminiApiKeyInput.value = settings.geminiApiKey || '';
    geminiModelInput.value = settings.geminiModel || 'gemini-2.0-flash';
    ocZenApiKeyInput.value = settings.openCodeZenApiKey || '';
    ocZenModelInput.value = settings.openCodeZenModel || 'deepseek-v4-flash-free';
    targetLangInput.value = settings.targetLanguage || 'Spanish';
    autoTranslateCheck.checked = settings.autoTranslate !== false;
  }

  // ── Load domain prompts ───────────────────────────────────────────

  let domainPromptsCache = {};

  async function loadDomainPrompts() {
    const { domainPrompts } = await chrome.runtime.sendMessage({ action: 'getDomainPrompts' });
    domainPromptsCache = domainPrompts || {};
    return domainPromptsCache;
  }

  async function saveDomainPrompt(domain, prompt) {
    domainPromptsCache[domain] = prompt;
    const { domainPrompts } = await chrome.runtime.sendMessage({
      action: 'setDomainPrompt',
      domain,
      prompt,
    });
    domainPromptsCache = domainPrompts;
  }

  // ── Load sections (grouped by domain) ─────────────────────────────

  async function loadAllSections() {
    const [savedSections, domainPrompts] = await Promise.all([
      chrome.storage.local.get('savedSections').then(r => r.savedSections || []),
      loadDomainPrompts(),
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
      const card = buildDomainCard(domain, byDomain[domain], domainPrompts[domain] || '');
      allSectionsList.appendChild(card);
    }
  }

  function buildDomainCard(domain, sections, currentPrompt) {
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

    // ── Prompt editor ─────────────────────────────────────────────
    const promptGroup = document.createElement('div');
    promptGroup.className = 'domain-prompt-group';

    const promptLabel = document.createElement('label');
    promptLabel.className = 'domain-prompt-label';
    promptLabel.textContent = 'Custom instructions for this domain';
    promptGroup.appendChild(promptLabel);

    const promptRow = document.createElement('div');
    promptRow.className = 'domain-prompt-row';

    const textarea = document.createElement('textarea');
    textarea.className = 'domain-prompt-input';
    textarea.placeholder = 'e.g. Use formal tone, keep proper nouns untranslated, preserve technical terms in English...';
    textarea.value = currentPrompt;
    promptRow.appendChild(textarea);

    const savePromptBtn = document.createElement('button');
    savePromptBtn.className = 'small-btn prompt-save-btn';
    savePromptBtn.textContent = 'Save';
    promptRow.appendChild(savePromptBtn);

    const promptStatus = document.createElement('span');
    promptStatus.className = 'prompt-status';
    promptRow.appendChild(promptStatus);

    promptGroup.appendChild(promptRow);

    savePromptBtn.addEventListener('click', async () => {
      const val = textarea.value;
      try {
        await saveDomainPrompt(domain, val);
        promptStatus.textContent = 'Saved';
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

    card.appendChild(promptGroup);
    return card;
  }

  // ── Save settings ─────────────────────────────────────────────────

  saveBtn.addEventListener('click', async () => {
    const settings = {
      provider: providerSelect.value,
      geminiApiKey: geminiApiKeyInput.value.trim(),
      geminiModel: geminiModelInput.value || 'gemini-2.0-flash',
      openCodeZenApiKey: ocZenApiKeyInput.value.trim(),
      openCodeZenModel: ocZenModelInput.value || 'deepseek-v4-flash-free',
      targetLanguage: targetLangInput.value.trim() || 'Spanish',
      autoTranslate: autoTranslateCheck.checked,
    };

    try {
      const { settings: saved } = await chrome.runtime.sendMessage({
        action: 'updateSettings',
        settings,
      });

      if (saved) {
        saveStatus.textContent = 'Saved!';
        saveStatus.className = 'success';
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

  // ── Test API key ──────────────────────────────────────────────────

  async function testProvider() {
    const provider = providerSelect.value;

    if (provider === 'gemini') {
      const apiKey = geminiApiKeyInput.value.trim();
      if (!apiKey) {
        testStatus.textContent = 'Enter a Gemini API key first.';
        testStatus.className = 'error';
        return;
      }
      const model = geminiModelInput.value || 'gemini-2.0-flash';
      testStatus.textContent = 'Testing Gemini key...';
      testStatus.className = '';

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
          testStatus.textContent = `Gemini error (${response.status}): ${err.slice(0, 200)}`;
          testStatus.className = 'error';
          return;
        }

        testStatus.textContent = 'Gemini API key works!';
        testStatus.className = 'success';
      } catch (err) {
        testStatus.textContent = `Network error: ${err.message}`;
        testStatus.className = 'error';
      }
    } else {
      // OpenCode Zen
      const apiKey = ocZenApiKeyInput.value.trim();
      if (!apiKey) {
        testStatus.textContent = 'Enter an OpenCode Zen API key first.';
        testStatus.className = 'error';
        return;
      }
      const model = ocZenModelInput.value || 'deepseek-v4-flash-free';
      testStatus.textContent = 'Testing OpenCode Zen key...';
      testStatus.className = '';

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
          testStatus.textContent = `OpenCode Zen error (${response.status}): ${err.slice(0, 200)}`;
          testStatus.className = 'error';
          return;
        }

        testStatus.textContent = 'OpenCode Zen API key works!';
        testStatus.className = 'success';
      } catch (err) {
        testStatus.textContent = `Network error: ${err.message}`;
        testStatus.className = 'error';
      }
    }

    setTimeout(() => {
      testStatus.textContent = '';
      testStatus.className = '';
    }, 4000);
  }

  testBtn.addEventListener('click', testProvider);

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

  // ── Provider switch ───────────────────────────────────────────────

  providerSelect.addEventListener('change', () => {
    toggleProviderSections(providerSelect.value);
  });

  // ── Init ──────────────────────────────────────────────────────────

  await loadSettings();
  await loadAllSections();
});
