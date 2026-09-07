# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

The selected homepage and the three library, skill-detail, and profile screenshots supplied on 2026-09-07 are the visual targets. Preserve their paper/forest-green/lime editorial design, condensed headings, thin rules and dense tables. Match their layout, but do not turn sample profile identities, dates, compatibility counts or vetted claims into invented production facts.

The subsequent login, lost-signal 404, journal and article screenshots are also visual targets. The whole interface must support English and Russian, with readable self-hosted Cyrillic typography and locale-preserving navigation. Use unprefixed English URLs and /ru Russian counterparts; never translate command IDs, code syntax or user-entered profile text. Sample release stories and unavailable login providers must be labeled truthfully.

Collections is a dedicated skill-collections page at /collections (Russian /ru/collections), not a homepage popup. Keep How it works out of shared navigation in both languages, including the footer. Reuse the existing catalog's editorial design for the collections page.
