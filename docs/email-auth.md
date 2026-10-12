# Email authentication: local first slice

The login page supports email-link requests, explicit confirmation, session status
and logout in English and Russian. This is a local development implementation,
not an activated production login service. Building or publishing the static site
does not start the authentication server.

## Security boundary

- Better Auth manages verified users and sessions in SQLite. Magic-link tokens
  are stored hashed and expire after ten minutes.
- A separate HttpOnly browser nonce binds the link to the browser that requested
  it. Cross-browser links are intentionally unsupported in this first slice.
- The email opens an inert `/login#email-token=...` or `/ru/login#email-token=...`
  page. The fragment is removed from browser history and held in memory only.
  The user must press **Confirm sign-in**; link scanners cannot sign in via GET.
- Only the application endpoints below are exposed. Better Auth's stock GET
  verification endpoint is never mounted publicly.
- State-changing requests require JSON and the exact configured Origin.
  Tokens and session cookies are never returned as JavaScript credentials or
  stored in localStorage. HTTPS sessions use Secure, HttpOnly cookies.
- Requests and redemption have persistent abuse limits. SMTP has bounded
  concurrency and a total cancellation deadline. Tokens and mail bodies are not
  logged.

The browser-local workspace remains separate. Signing in does not upload saved
skills, verify a local profile, enable publishing, or turn it into cloud storage.
GitHub login is still unavailable.

## API contract

| Endpoint                                               | Success                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `GET /api/auth/session`                                | `200 { "user": null }` or a minimal `{ id, email }` user                      |
| `POST /api/auth/request-link` with `{ email, locale }` | `202 { "ok": true }`                                                          |
| `POST /api/auth/confirm` with `{ token }`              | `200 { "ok": true, "user": { "id": "…", "email": "…" } }` plus session cookie |
| `POST /api/auth/sign-out`                              | `200 { "ok": true }` and cookie expiry                                        |

Errors use `{ "error": { "code": "…" } }`: `INVALID_EMAIL`, `INVALID_LINK`,
`FORBIDDEN`, `ALREADY_SIGNED_IN`, `RATE_LIMITED`, or `UNAVAILABLE`. A failed or
timed-out email request is not proof that a message was never accepted by SMTP.
An existing session must be signed out before requesting a different identity.

## Local configuration

See [the environment template](../.env.example). No credentials are committed.
Use a private runtime directory outside the checkout: directory mode `0700`,
credential/database files `0600`, owned by the service user. WAL and SHM files
must remain in that private directory. A dedicated deployment service user is
required before any production activation; do not run the application as root.

`MAIL_CONFIG_FILE` points to private JSON in this shape:

```json
{
  "host": "smtp.example.com",
  "port": 465,
  "secure": true,
  "authMethod": "LOGIN",
  "user": "noreply@reporadars.com",
  "password": "SET_ONLY_IN_THE_PRIVATE_FILE",
  "from": "Reporadars <noreply@reporadars.com>"
}
```

The SMTP adapter requires verified TLS and never logs credentials or delivery
URLs. `AUTH_MODE=smtp` is an explicit opt-in. Without full configuration the
service fails closed; there is no development backdoor or console-printed link.
Tests inject a fake transport into isolated databases instead.

For a configured backend, `npm run auth:dev` binds to loopback only. SMTP mode
requires a clean HTTPS browser-facing origin. Set `AUTH_MIGRATE=yes` only on the
first explicit initialization of a new database; omit it for normal startup.
Serving validates the schema and does not silently migrate existing databases.
The Next.js/built preview can opt into `AUTH_PREVIEW_API_ORIGIN`, restricted to an
HTTP `127.0.0.1` origin. Set `AUTH_BASE_URL` to the exact browser-facing preview
origin (an HTTPS frontend is required when using real SMTP; automated tests use
isolated HTTP loopback plus fake mail). Neither preview trusts forwarded IP headers. Do not expose this local
proxy configuration publicly. Without opt-in, the preview reports an anonymous,
unconfigured session (`available: false`), and write requests return unavailable
instead of reaching the production origin.

## Verification and activation boundary

`npm run test:auth` exercises isolated SQLite and injected mail transport;
`make verify` includes it plus Worker, workspace, locale and browser regression
checks. Unit/fake-transport tests do not establish external email deliverability.

Before a separate production release: complete the security review, configure a
dedicated origin service and exact trusted proxy boundary, provision private
runtime storage and explicit migrations/backups, verify outgoing SPF/DKIM and
actual delivery to an authorized external recipient, and perform a real browser
login/logout check. Keep auth responses uncacheable and avoid logging URL
fragments, bodies, cookies or tokens. The protected Sites ASSETS adapter remains
static and is not itself an authentication origin.

Upstream references: [Better Auth magic links](https://better-auth.com/docs/plugins/magic-link),
[server-side rate-limit caveat](https://better-auth.com/docs/concepts/rate-limit),
and [database migrations](https://better-auth.com/docs/concepts/database).
