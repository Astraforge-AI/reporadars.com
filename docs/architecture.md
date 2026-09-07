# Architecture

## Purpose and boundary

Reporadars is a static, bilingual editorial application. It presents a small registry of draft skills and their reference links; it is not a package registry, authentication service, or synchronization backend.

## Application flow

This flow describes the custom Cloudflare Worker artifact, not the separate Sites adapter.

```text
content registry + React routes
            │
            ▼
build-time static rendering ──► generated HTML/assets + Worker manifest
                                             │
                                             ▼
                                  Cloudflare Worker / origin boundary
                                             │
                                             ▼
                                           browser
                                             │
                                             ▼
                         localStorage workspace (current browser only)
```

### Content registry and routes

`src/data/skills.js` is the English skill registry; `src/data/skills-ru.js` carries its Russian presentation. Collections, journal samples, and explicit cross-links live beside them in `src/data/`. React routes render the library, collections, skill details, journal, account, and login-preview pages. Downloadable `SKILL.md` pages are generated from the original draft content.

Locale selection is URL-based: English uses unprefixed routes and Russian uses `/ru` equivalents. This permits direct loading, sharing, and navigation without storing the active locale in the workspace.

### Static rendering

`npm run build` invokes Vite and the project rendering scripts, producing two distinct handoffs:

- **Custom Cloudflare Worker:** `scripts/homepage-build.mjs` prerenders pages and localized variants, then embeds the owned pages, assets, and downloads into `dist/reporadars.worker.mjs`. It also writes `dist/homepage-manifest.json` as a release inventory. `node scripts/homepage-preview.mjs` serves this Worker locally; it does not deploy anything.
- **Sites adapter:** `scripts/prepare-sites-build.mjs` copies `worker/index.js` to `dist/server/index.js` and the hosting configuration to `dist/.openai/hosting.json`. This handoff uses the Vite output in `dist/client/` through the platform-provided `env.ASSETS` binding. It does not use the custom Worker's embedded route registry or origin fallback.

Choose the handoff for the intended host explicitly; these artifacts do not have equivalent routing semantics.

### Worker and origin behavior

The **custom Cloudflare Worker**, implemented in `scripts/homepage-worker.mjs` and emitted as `dist/reporadars.worker.mjs`, serves known, read-only Reporadars pages, downloads, and owned assets. Its fallback is intentionally bounded: unknown application navigation may receive the localized static 404 only when the origin returned an HTML 404. APIs, write requests, assets, successful origin responses, and non-HTML responses pass through to the origin unchanged. This lets the application coexist with an existing origin without claiming ownership of it.

The **Sites adapter**, implemented in `worker/index.js` and copied to `dist/server/index.js`, instead asks `env.ASSETS` for the request. If that binding returns a 404 for a GET/HEAD request accepting HTML, it requests `/index.html` from the same binding. Other responses pass through from `env.ASSETS`; it has no equivalent custom origin-forwarding or localized static-404 layer. Do not assume the custom Worker's boundaries apply to this adapter.

### Browser workspace

Saved skills and profile edits are stored only in the current browser under the `reporadars.workspace.v1` localStorage key. No account, cookie-backed session, server-side profile, or cloud synchronization is implemented. The login page therefore communicates provider unavailability rather than simulating a successful sign-in.

## Operational constraints

- Cloudflare delivery is a deployment target, not an automatic deployment configured by this repository.
- The current CLI is a preview concept and is not published from this codebase.
- Sample journal posts are illustrative editorial content, not release records.
- Public documentation must not include deployment machine paths, origin addresses, account identifiers, or secrets.

For contribution workflow and verification, see [CONTRIBUTING.md](../CONTRIBUTING.md).
