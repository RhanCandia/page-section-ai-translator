# Page Section AI Translator

A Chrome extension that lets you pick any section of a webpage, save it by domain, and auto-translate it using Google Gemini on every subsequent page load.

## Features

**Pick a section** — Click the extension popup, hit "Pick Section", then click any element on the page. The extension generates a unique CSS selector and saves it with the current domain.

**Auto-translate on page load** — Every time you visit a saved domain, matching sections are automatically translated via Gemini. Original content stays visible during the API call.

**Progress indicator** — While translating, the section gets a multicolor pulsing border (blue -> purple -> teal). When the translation arrives, child elements stagger-fade in one by one.

**Per-domain custom instructions** — Set translation style, tone, or rules per domain in Settings. Prompts are injected into the Gemini call alongside the text. Ideal for controlling honorifics, censorship, terminology, or formality.

**Multiple models** — Model name is a free-text field with suggestions. Any Gemini model ID works.

## How to install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` directory

The extension icon appears in the toolbar.

## How to use

### 1. Set up your API key

Right-click the extension icon -> **Options** (or click the gear icon in the popup). Enter your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and select a model. Click **Test API Key** to verify.

### 2. Pick a section

Navigate to any page, click the extension icon, then **Pick Section**. Hover over elements (they highlight blue) and click the one you want to translate. A confirmation toast appears.

### 3. Done

Reload the page. The section gets a pulsing border while Gemini translates it, then the translated content fades in.

### 4. Custom instructions per domain (optional)

In Settings -> Domains & Custom Instructions, each domain with saved sections has a textarea. Add instructions like:

> Use formal tone, keep proper nouns untranslated, retain Japanese honorifics (-san, -kun, -chan) as-is. Do not censor any content.

Click **Save**. All future translations for that domain will include your prompt.

## Architecture

```
extension/
  manifest.json        # MV3 manifest
  background.js        # Service worker: message router, Gemini API proxy, storage
  content.js           # Injected script: pick mode, auto-translate, stagger reveal
  popup/
    popup.html/.js/.css    # Quick actions: Pick Section, list saved for domain
  settings/
    settings.html/.js/.css # API key, model, language, domain prompts, manage sections
  icons/
```

### Flow

```
Page loads -> content.js checks storage for matching domain sections
           -> background.js builds prompt (rules + custom instructions if set)
           -> Gemini API called with full innerHTML (preserves HTML structure)
           -> Translated HTML replaces original, children stagger-reveal with fade-in
           -> On error, original content is untouched (never removed)
```

### Data model

Storage keys in `chrome.storage.local`:

- `settings` — API key, model, target language, auto-translate toggle
- `savedSections` — Array of `{ id, domain, selector, label, createdAt }`
- `domainPrompts` — Object mapping `domain -> custom instruction string`

## Supported providers

Currently **Google Gemini** only. The background.js message dispatcher is structured to add new providers by adding a case + a `translateWithXxx` function.

## Contributing

1. Create a feature branch from `master`
2. Make changes
3. Commit and push
4. Create a PR

No build step required — the extension is plain JS/CSS/HTML.
