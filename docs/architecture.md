# Architecture

## Purpose and boundary

Reporadars is a static, bilingual editorial application. It presents a small registry of draft skills and their reference links; it is not a package registry or synchronization backend. A separate, locally tested email authentication service is being developed in `server/`; it is not activated by the static website deployment. See [email authentication](email-auth.md) for its contract and security boundary.

## Application flow

This flow describes the custom Cloudflare Worker artifact, not the separate Sites adapter.

```text
content registry + Next.js routes
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

`src/data/skills.js` is the English skill registry; `src/data/skills-ru.js` carries its Russian presentation. Collections, journal samples, and explicit cross-links live beside them in `src/data/`. Next.js statically generated routes render the library, collections, skill details, journal, account, and login-preview pages. Downloadable `SKILL.md` pages are generated from the original draft content.

Locale selection is URL-based: English uses unprefixed routes and Russian uses `/ru` equivalents. This permits direct loading, sharing, and navigation without storing the active locale in the workspace.

### Static rendering

Next.js Pages Router lives in `src/pages/`; screen components live in `src/views/`. `getStaticPaths` uses the bilingual content registry. Internal links use the Next.js router with the shared reduced-motion-safe transition. `scripts/next-export.mjs` adapts the generated HTML to the existing Sites directory layout. `npm run dev` runs a loopback-only Next.js server and retains the optional local authentication proxy.

`npm run build` invokes Next.js static export and the project packaging scripts, producing two distinct handoffs:

- **Custom Cloudflare Worker:** Next.js prerenders pages and localized variants; `scripts/homepage-build.mjs` then embeds the owned pages, assets, and downloads into `dist/reporadars.worker.mjs`. It also writes `dist/homepage-manifest.json` as a release inventory. `node scripts/homepage-preview.mjs` serves this Worker locally; it does not deploy anything.
- **Sites adapter:** `scripts/prepare-sites-build.mjs` copies `worker/index.js` to `dist/server/index.js` and the hosting configuration to `dist/.openai/hosting.json`. This handoff uses the Next.js export in `dist/client/` through the platform-provided `env.ASSETS` binding. It does not use the custom Worker's embedded route registry or origin fallback.

Choose the handoff for the intended host explicitly; these artifacts do not have equivalent routing semantics.

### Worker and origin behavior

The **custom Cloudflare Worker**, implemented in `scripts/homepage-worker.mjs` and emitted as `dist/reporadars.worker.mjs`, serves known, read-only Reporadars pages, downloads, and owned assets. Its fallback is intentionally bounded: unknown application navigation may receive the localized static 404 only when the origin returned an HTML 404. APIs, write requests, assets, successful origin responses, and non-HTML responses pass through to the origin unchanged. This lets the application coexist with an existing origin without claiming ownership of it.

The **Sites adapter**, implemented in `worker/index.js` and copied to `dist/server/index.js`, instead asks `env.ASSETS` for the request. If that binding returns a 404 for a GET/HEAD request accepting HTML, it requests `/index.html` from the same binding. Other responses pass through from `env.ASSETS`; it has no equivalent custom origin-forwarding or localized static-404 layer. Do not assume the custom Worker's boundaries apply to this adapter.

### Browser workspace

Saved skills and profile edits are stored only in the current browser under the `reporadars.workspace.v1` localStorage key. The separate email-auth development service uses verified email identities and HttpOnly cookie-backed sessions, but does not upload or relabel this local workspace. Server-side profiles and cloud synchronization are not implemented. Without an explicitly configured backend, the login page does not simulate successful authentication or email delivery.

## Operational constraints

- Cloudflare delivery is a deployment target, not an automatic deployment configured by this repository.
- The current CLI is a preview concept and is not published from this codebase.
- Sample journal posts are illustrative editorial content, not release records.
- Public documentation must not include deployment machine paths, origin addresses, account identifiers, or secrets.

For contribution workflow and verification, see [CONTRIBUTING.md](../CONTRIBUTING.md).
