# Private editorial administration

This is the first operational admin slice, not an activated production CMS.
The UI is at `/admin` and `/ru/admin`. The existing static Sites deployment does
not run the Node auth/admin service. A static preview deliberately reports that
administration is unavailable; it never substitutes browser storage for identity.

## Available workflows

- A verified email session and an ID-keyed administrator grant are both required.
- Skills, collections and journal articles have English/Russian content, draft,
  published and archived states, revision checks, source/category fields, and
  audited mutations. Collections reference existing skills.
- Published and archived records are read-only until explicitly moved to draft.
- User inspection is read-only. Role editing and hard deletion are not exposed.
- Authenticated, verified users can submit a skill through `POST /api/submissions`.
  Administrators can accept/reject it with a note. Acceptance never publishes it.
- The activity log records actor, operation, entity, revision and time, not bodies,
  session tokens or mail credentials.

Publication currently changes **editorial database state only**. The existing
public catalog, journal, collections and submission form have not been migrated
from their prototype data sources. `/api/content` is a published-only read API
for that next integration phase; it does not expose users or moderation notes.

## Explicit private staging setup

Use a non-root service owner and an existing private parent outside this checkout.
These are operator commands, not automatic server-start migrations:

```sh
node server/admin-manage.mjs init --directory /absolute/private/runtime --origin https://reporadars.com
node server/admin-manage.mjs grant --directory /absolute/private/runtime --email owner@example.com
node server/admin-manage.mjs status --directory /absolute/private/runtime --email owner@example.com
```

Initialization exclusively creates a new directory (0700), SQLite database,
cryptographic auth secret and metadata (0600). Existing directories are never
overwritten. A partial failed initialization is retained for inspection. Back up
the private runtime, not just the application checkout; do not commit it.

Grant bootstrap creates an unverified account if absent, preserves existing user
data, and creates a pending ID-keyed grant. It does not create a password, verified
flag, session or login token. After real email confirmation the next administrator
request activates that user's pending grant and audits the activation. A revoked
grant is not restored by bootstrap. Revocation is checked on every request.

Before deployment, provide private SMTP configuration owned by the service user
(see `docs/email-auth.md`) and a same-origin HTTPS reverse proxy. The service refuses
root, binds to loopback only, and requires explicit runtime migration beforehand.

```sh
AUTH_MODE=smtp ADMIN_RUNTIME_DIR=/absolute/private/runtime MAIL_CONFIG_FILE=/absolute/private/smtp.json ADMIN_PORT=4320 node server/admin-start.mjs
```

The default launcher serves API routes only. `ADMIN_SERVE_STATIC=yes` additionally
serves the latest locally built site from `dist/reporadars.worker.mjs`, allowing a
single same-origin upstream. Build with `npm run build` first. Do not proxy admin
API errors to the static site. Preserve cookies, no-store responses and the
canonical origin; do not expose the loopback port directly.

This change does not install a service, modify a reverse proxy, change DNS, copy
production mail secrets or deploy to the domain. Production activation, backup
and rollback wiring, branded live login emails and integration of public content
remain a separate release phase requiring authorization and verification.

## API and safety boundaries

All administration endpoints are under `/api/admin/`: `session`, `overview`,
`records`, `records/:id`, `records/:id/status`, `users`, `submissions` and `audit`.
Lists use bounded `page`, `pageSize` and supported filters. Mutations require JSON,
an exact same-origin `Origin`, a verified server-side session and a fresh grant.
Edit and moderation writes require the current `revision`; a stale edit returns
409 and is not overwritten. The UI retains unsaved edits when a conflict occurs.

Text is stored as text, never executed as HTML. Source URLs must be credential-free
HTTPS URLs and are not fetched by the service. Writes have bounded bodies and rate
limits. Administrative responses, including failures, use `Cache-Control: no-store`.
The admin HTML is also no-store and noindex; those headers are not authorization.

## Verification

Run a loopback static preview before the canonical suite:

```sh
PORT=4321 node scripts/admin-preview.mjs
BASE_URL=http://127.0.0.1:4321 make verify
```

Backend tests use isolated temporary SQLite databases and captured fake mail.
The real browser lifecycle test confirms an actual magic link, activates the
pending grant without manual promotion, creates and publishes content, verifies
persistence/audit, and rejects ordinary and revoked users. It does not access a
real inbox or silently verify the administrator's actual email.

No test-only mail transport or automatic verified-account shortcut is available
from the production launcher.
