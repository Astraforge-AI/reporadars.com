# Contributing to Reporadars

Thanks for helping make the library clearer and more useful. Reporadars is reference-led: changes should make the source, scope, and current status easier to understand.

## Good contributions

- Correct or add a primary reference for a draft skill.
- Improve a draft's instructions, limits, or prerequisites without overstating what it has been tested against.
- Improve English or Russian copy while preserving command IDs, URLs, and user-entered profile text.
- Report a route, rendering, accessibility, or localization issue with reproducible steps.

The library currently contains drafts. Do not describe a draft as vetted, endorsed, production-ready, compatible with a particular tool, or installable unless the repository provides evidence for that statement. Journal content is sample editorial material, not a product changelog.

## Local setup

Use Node.js 22 or later. A local run needs no `.env` file.

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

Before proposing a change, run the repository's canonical check:

```sh
make verify
```

Browser tests use `/usr/bin/chromium` when present, or `CHROMIUM_PATH`. On another platform, install Playwright's Chromium with `npx playwright install chromium`, then set `CHROMIUM_PATH` to its `chromium.executablePath()` value.

## Content and privacy rules

- Keep source URLs accurate and distinguish original project material from commentary.
- Keep availability truthful: login providers, accounts, cloud sync, and the CLI are not configured or published by this repository.
- Do not commit secrets, tokens, personal data, private screenshots, or local deployment records.
- Do not rely on local server paths, account IDs, or origin addresses in public documentation or examples.

## Screenshots and visual changes

Screenshots are optional supporting evidence, not a requirement for ordinary copy fixes. Capture helpers can take their reference inputs from `REFERENCE_DIR`; keep any local reference material outside the public repository unless its publication has been explicitly approved.

## Pull requests

Keep a change focused, explain the user-visible effect, and include the checks you ran. Avoid unrelated formatting or generated-file churn. If your work changes routes, static rendering, or the Worker boundary, update [the architecture note](docs/architecture.md) in the same change.

## По-русски

Приветствуются исправления первоисточников, понятности черновиков и перевода. Не публикуйте секреты, личные данные, приватные скриншоты или локальные данные развёртывания. Не приписывайте черновикам проверку, совместимость или готовность к установке без подтверждения в репозитории. Перед PR выполните `make verify`.
