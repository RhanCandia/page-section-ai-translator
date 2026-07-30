// Settings page for Page Section AI Translator

document.addEventListener('DOMContentLoaded', async () => {
  // ── DOM refs ──────────────────────────────────────────────────────

  const apiKeyInput = document.getElementById('api-key');
  const toggleKeyBtn = document.getElementById('toggle-key-visibility');
  const modelInput = document.getElementById('model');
  const targetLangInput = document.getElementById('target-lang');
  const autoTranslateCheck = document.getElementById('auto-translate');
  const saveBtn = document.getElementById('save-btn');
  const saveStatus = document.getElementById('save-status');
  const testBtn = document.getElementById('test-btn');
  const testStatus = document.getElementById('test-status');
  const allSectionsList = document.getElementById('all-sections-list');

  // ── Load settings ─────────────────────────────────────────────────

  async function loadSettings() {
    const { settings } = await chrome.runtime.sendMessage({ action: 'getSettings' });
    if (!settings) return;

    apiKeyInput.value = settings.geminiApiKey || '';
    modelInput.value = settings.geminiModel || 'gemini-2.0-flash';
    targetLangInput.value = settings.targetLanguage || 'Spanish';
    autoTranslateCheck.checked = settings.autoTranslate !== false;
  }

  // ── Load sections ─────────────────────────────────────────────────

  async function loadAllSections() {
    const { savedSections = [] } = await chrome.storage.local.get('savedSections');

    allSectionsList.innerHTML = '';

    if (savedSections.length === 0) {
      allSectionsList.innerHTML =
        '<p class="empty-state">No sections saved yet. Open a page and use "Pick Section" from the extension popup.</p>';
      return;
    }

    // Sort by domain then date
    savedSections.sort((a, b) => a.domain.localeCompare(b.domain) || (b.createdAt || 0) - (a.createdAt || 0));

    for (const section of savedSections) {
      const item = document.createElement('div');
      item.className = 'section-item';
      item.dataset.id = section.id;

      const info = document.createElement('div');
      info.className = 'section-info';

      const domain = document.createElement('div');
      domain.className = 'section-domain';
      domain.textContent = section.domain;
      info.appendChild(domain);

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
      allSectionsList.appendChild(item);
    }
  }

  // ── Save settings ─────────────────────────────────────────────────

  saveBtn.addEventListener('click', async () => {
    const settings = {
      geminiApiKey: apiKeyInput.value.trim(),
      geminiModel: modelInput.value,
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

  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      testStatus.textContent = 'Enter an API key first.';
      testStatus.className = 'error';
      return;
    }

    const model = modelInput.value;
    testStatus.textContent = 'Testing...';
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
        testStatus.textContent = `API error (${response.status}): ${err.slice(0, 200)}`;
        testStatus.className = 'error';
        return;
      }

      testStatus.textContent = 'API key works!';
      testStatus.className = 'success';
    } catch (err) {
      testStatus.textContent = `Network error: ${err.message}`;
      testStatus.className = 'error';
    }

    setTimeout(() => {
      testStatus.textContent = '';
      testStatus.className = '';
    }, 4000);
  });

  // ── Toggle key visibility ─────────────────────────────────────────

  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '\u{1F441}'; // eye emoji (or use a text alternative)
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '\u{1F441}';
    }
  });

  // ── Init ──────────────────────────────────────────────────────────

  await loadSettings();
  await loadAllSections();
});
