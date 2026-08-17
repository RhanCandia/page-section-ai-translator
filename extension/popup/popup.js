// Popup script for Page Section AI Translator

document.addEventListener('DOMContentLoaded', async () => {
  const domainLabel = document.getElementById('domain-label');
  const pickBtn = document.getElementById('pick-section');
  const retranslateBtn = document.getElementById('retranslate-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const sectionsList = document.getElementById('sections-list');
  const statusEl = document.getElementById('status');

  // ── Get current tab info ────────────────────────────────────────

  let currentDomain = '';
  let tabId = null;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const url = new URL(tab.url);
      currentDomain = url.hostname;
      domainLabel.textContent = currentDomain;
      tabId = tab.id;
    } else {
      domainLabel.textContent = 'No active page';
      pickBtn.disabled = true;
      if (retranslateBtn) retranslateBtn.disabled = true;
      return;
    }
  } catch (err) {
    domainLabel.textContent = 'Error reading page';
    setStatus('Cannot access this page', 'error');
    return;
  }

  // ── Load sections for domain ────────────────────────────────────

  async function loadSections() {
    const { savedSections = [] } = await chrome.storage.local.get('savedSections');
    const domainSections = savedSections.filter(s => s.domain === currentDomain);

    sectionsList.innerHTML = '';

    if (domainSections.length === 0) {
      sectionsList.innerHTML = '<p class="empty-state">No sections saved for this domain.</p>';
      if (retranslateBtn) retranslateBtn.disabled = true;
      return;
    }

    if (retranslateBtn) retranslateBtn.disabled = false;

    // Query content script for per-section translation status
    let statusMap = {};
    if (tabId) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'getTranslationStatus' });
        if (response?.status) statusMap = response.status;
      } catch {
        // Content script not injected or not reachable — no status available
      }
    }

    domainSections.forEach(section => {
      const item = document.createElement('div');
      item.className = 'section-item';
      item.dataset.id = section.id;

      // Apply status indicator class
      const status = statusMap[section.selector];
      if (status === 'translated') item.classList.add('status-translated');
      else if (status === 'failed') item.classList.add('status-failed');
      else if (status === 'not-found') item.classList.add('status-not-found');

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
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.runtime.sendMessage({ action: 'deleteSection', id: section.id });
        await loadSections();
        setStatus('Section removed', 'success');
      });

      item.appendChild(info);
      item.appendChild(delBtn);
      sectionsList.appendChild(item);
    });
  }

  await loadSections();

  // ── Pick section ────────────────────────────────────────────────

  pickBtn.addEventListener('click', async () => {
    if (!tabId) return;

    try {
      await chrome.tabs.sendMessage(tabId, { action: 'enterPickMode' });
      window.close();
    } catch (err) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        await chrome.tabs.sendMessage(tabId, { action: 'enterPickMode' });
        window.close();
      } catch (injectErr) {
        setStatus(`Cannot access this page: ${injectErr.message}`, 'error');
      }
    }
  });

  // ── Force Re-translate ──────────────────────────────────────────

  if (retranslateBtn) {
    retranslateBtn.addEventListener('click', async () => {
      if (!tabId) return;
      retranslateBtn.disabled = true;
      setStatus('Re-translating...');

      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'forceReTranslate' });
        if (response?.error) {
          setStatus(`Error: ${response.error}`, 'error');
        } else {
          setStatus('Re-translation started', 'success');
          setTimeout(async () => {
            await loadSections();
          }, 1000);
        }
      } catch (err) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
          });
          const response = await chrome.tabs.sendMessage(tabId, { action: 'forceReTranslate' });
          if (response?.error) {
            setStatus(`Error: ${response.error}`, 'error');
          } else {
            setStatus('Re-translation started', 'success');
            setTimeout(async () => {
              await loadSections();
            }, 1000);
          }
        } catch (injectErr) {
          setStatus(`Failed to communicate with tab: ${injectErr.message}`, 'error');
        }
      } finally {
        retranslateBtn.disabled = false;
      }
    });
  }

  // ── Settings & Links ────────────────────────────────────────────

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  const kofiLink = document.getElementById('kofi-link');
  if (kofiLink) {
    kofiLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://ko-fi.com/rhncnd' });
    });
  }

  // ── Utilities ───────────────────────────────────────────────────

  function setStatus(msg, type = '') {
    statusEl.textContent = msg;
    statusEl.className = type;
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = '';
    }, 3000);
  }
});
