# Privacy Policy for Page Section AI Translator

**Last Updated:** August 17, 2026

**Page Section AI Translator** is committed to protecting your privacy. This privacy policy explains how data is handled when you use the Chrome extension.

---

## 1. Data Collection and Usage

**Page Section AI Translator does not collect, store, track, sell, or transmit any personally identifiable information (PII) to the developer or third-party tracking services.**

### What data the extension processes:
1. **API Keys:**
   * Your Google Gemini or OpenCode Zen API keys are stored solely on your local device using Chrome's local storage (`chrome.storage.local`).
   * API keys are never sent to the extension developer or any analytics server.
2. **Translation Content:**
   * When you select a section of a webpage to translate, the inner HTML/text content of that specific element is sent directly from your browser to your selected AI provider's official API endpoint (Google Gemini or OpenCode Zen) using your provided API key.
   * No other tabs, browsing history, cookies, credentials, or unrelated webpage content are read or transmitted.
3. **User Preferences & Saved Selectors:**
   * Saved section CSS selectors, target languages, auto-translate toggles, and per-domain custom instructions are stored exclusively in your browser's local storage (`chrome.storage.local`).

---

## 2. Third-Party Services

The extension communicates only with the AI service provider you configure in Settings:
* **Google Gemini API:** Subject to [Google Privacy Policy](https://policies.google.com/privacy) and [Google AI Terms of Service](https://ai.google.dev/terms).
* **OpenCode Zen API:** Subject to OpenCode's Privacy Policy and Terms of Service.
* **Ko-fi (Optional):** Clicking the donation/support link opens Ko-fi in a new browser tab subject to [Ko-fi Privacy Policy](https://more.ko-fi.com/privacy).

---

## 3. Data Retention and Deletion

All stored data (API keys, preferences, and saved domain sections) remains on your local machine until:
* You delete saved sections or clear settings in the extension Options page.
* You uninstall the extension from `chrome://extensions`.

---

## 4. Changes to This Privacy Policy

If any changes are made to this privacy policy, the updated version will be posted in this repository with a revised "Last Updated" date.

---

## 5. Contact & Support

If you have questions about this privacy policy or the extension, please open an issue on GitHub:
* **GitHub Repository:** [https://github.com/RhanCandia/page-section-ai-translator](https://github.com/RhanCandia/page-section-ai-translator)
