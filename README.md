# Page Section AI Translator

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Development-FF5E5B?style=flat&logo=kofi&logoColor=white)](https://ko-fi.com/rhncnd)

A Chrome extension that lets you pick any section of a webpage, save it by domain, and auto-translate it via an AI provider (Google Gemini or OpenCode Zen) on every subsequent page load.

## Features

**Pick a section** — Click the extension popup, hit "Pick Section", then click any element on the page. The extension generates a unique CSS selector and saves it with the current domain.

**Auto-translate on page load** — Every time you visit a saved domain, matching sections are automatically translated via your chosen provider. Original content stays visible during the API call.

**Token-Efficient Translation** — Extracts and sends only visible text segments with compact inline placeholders (`[0]...[/0]`) instead of raw HTML with nested tags, attributes, class names, styles, and SVGs. This cuts token consumption by 70–90% and keeps styles and event listeners completely intact.

**Per-Domain Provider & Model Overrides** — Use Gemini globally while overriding specific domains to OpenCode Zen (or vice versa), and set custom model IDs per domain (e.g. `gemini-3.7-flash` or `qwen3.7-plus`).

**Dedicated API Keys Section** — Enter and test API keys for Google Gemini and OpenCode Zen independently in Settings.

**Local Response Caching** — Stores translated strings locally in `chrome.storage.local`. Repeated page loads or visits to the same page fetch translations instantly with **0 API tokens used**.

**Force Re-translate** — Click the "Re-translate" button in the popup to bypass the cache on demand and fetch a fresh translation from the AI provider.

**Cache Management** — View cache size and entry statistics in Settings, with one-click cache clearing.

**Progress indicator** — While translating, the section gets a multicolor pulsing border (blue -> purple -> teal). When the translation arrives, child elements stagger-fade in one by one.

**Per-domain custom instructions** — Set translation style, tone, or rules per domain in Settings. Prompts are injected into the API call alongside the text. Ideal for controlling honorifics, censorship, terminology, or formality.

**Status & Active Model Badge** — The popup displays the active provider and model for the page (highlighting domain overrides) and per-section status indicators.

## How to install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` directory

The extension icon appears in the toolbar.

## How to use

### 1. Set up an API key

Right-click the extension icon -> **Options** (or click the gear icon in the popup).

- **Default Provider & Models**: Choose your global default provider and default models.
- **API Keys**: Enter your API key for Google Gemini ([Google AI Studio](https://aistudio.google.com/apikey)) and/or OpenCode Zen ([opencode.ai/auth](https://opencode.ai/auth)). Click **Test Key** to verify.

### 2. Pick a section

Navigate to any page, click the extension icon, then **Pick Section**. Hover over elements (they highlight blue) and click the one you want to translate. A confirmation toast appears.

### 3. Done

Reload the page. The section gets a pulsing border while the AI translates it, then the translated content fades in. Subsequent visits load instantly from cache!

### 4. Per-domain overrides & custom instructions (optional)

In Settings -> Domains & Overrides, each domain card allows:
- Overriding the **AI Provider** (e.g. switch to OpenCode Zen for this domain).
- Overriding the **AI Model** (e.g. use `gemini-3.7-flash` or `deepseek-v4-flash-free`).
- Adding custom translation instructions (e.g. `Use formal tone, keep proper nouns untranslated`).

## Architecture

```
extension/
  manifest.json        # MV3 manifest
  background.js        # Service worker: message router, AI API proxy, response caching, domain configs
  content.js           # Injected script: pick mode, DOM text extraction, auto-translate, stagger reveal
  popup/
    popup.html/.js/.css    # Quick actions: Pick Section, Re-translate, active model badge, saved sections
  settings/
    settings.html/.js/.css # Provider defaults, API keys, language, domain overrides & prompts, cache management
  icons/
```

### Data model

Storage keys in `chrome.storage.local`:

- `settings` — Global provider, API keys, default models, target language, auto-translate toggle, cacheEnabled
- `savedSections` — Array of `{ id, domain, selector, label, createdAt }`
- `domainConfigs` — Object mapping `domain -> { provider, model, prompt }`
- `translationCache` — Object mapping hash keys to `{ original, translated, lastAccessed }`

## Supported providers

| Provider | API format | Endpoint |
|---|---|---|
| Google Gemini | `generateContent` | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` |
| OpenCode Zen | OpenAI-compatible chat completions | `https://opencode.ai/zen/v1/chat/completions` |

### Free OpenCode Zen models

- `deepseek-v4-flash-free` — DeepSeek V4 Flash (limited time)
- `big-pickle` — Free, no billing needed
- `mimo-v2.5-free`, `ling-3.0-flash-free`, `nemotron-3-ultra-free`

## Support & Donation

If you enjoy using **Page Section AI Translator** or it saves you time, consider supporting future development:

<a href="https://ko-fi.com/rhncnd" target="_blank"><img src="https://storage.ko-fi.com/cdn/kofi3.png?v=3" height="36" style="border:0px;height:36px;" alt="Buy Me a Coffee at ko-fi.com" /></a>

## Privacy Policy

Page Section AI Translator stores all API keys and preferences locally on your device and does not collect or track user data. Read our full [Privacy Policy](PRIVACY.md).

## Contributing

1. Create a feature branch from `master`
2. Make changes
3. Commit and push
4. Create a PR

No build step required — the extension is plain JS/CSS/HTML.
