# Email/admin production activation — 2026-09-07

Historical activation record. For the current Next.js origin, staging and
remaining launch gates, read [production-status.md](production-status.md).

The owner explicitly authorized activation after the private editorial/auth
implementation review. Email authentication and the private editorial API are
now available at the canonical HTTPS origin. This is not yet a migration of the
public catalog to the editorial database.

## Live topology and release

- Public UI: Cloudflare Worker `reporadars-homepage`, release `c18190ddc3eb`.
- Active Worker version: `1b4d7680-5e58-43c2-ae3d-6fdce98ac03c`.
- Deployment: `219a07b7-f09e-4a89-8f98-1ba966524941`.
- Worker SHA256: `40d5dd95d444487694144c63e614c8724b9aa699b13c0a4f4dcd3aa1203abf80`.
- Root-owned application release: `/opt/reporadars/releases/20260907-email-admin-v1`.
- Active application link: `/opt/reporadars/current`.
- Exact-domain origin vhost: `/etc/nginx/conf.d/reporadars.conf`.
- API service: `reporadars.service`, dedicated non-login `reporadars` user,
  listening only on `127.0.0.1:4320`.
- Runtime: `/var/lib/reporadars/runtime`, directory 0700, private files 0600.
- SMTP configuration: `/var/lib/reporadars/smtp.json`, service-owned 0600.

The existing apex/www DNS records and mail records were retained. The existing
Let's Encrypt certificate covers both hosts and was verified directly without
disabling certificate verification. Cloudflare SSL mode is Full (strict), API
value `strict`. The previous value was `full`; only apex and www are proxied in
this zone's verified DNS inventory.

Cloudflare serves the site's explicit static routes. API requests retain their
method, body and cookies and pass to the origin; nginx forwards only `/api` paths
to Node. Unknown origin page paths return 404. Never enable the Node static
fallback behind this topology: its origin forwarding would recurse.

The nginx vhost trusts only published Cloudflare IP ranges for the visitor IP,
overwrites the private upstream identity header, and removes other forwarded-IP
headers. The Node adapter accepts that header only from its loopback proxy.
API responses and failures are no-store; login/admin HTML is private/no-store.
The domain's access log omits query strings, bodies, cookies and email addresses.

## Installed unit provenance

During the real installed startup check, Node's resolved module path did not
match the absolute `current` symlink in the CLI guard, causing a silent exit.
The corrected units use `WorkingDirectory=/opt/reporadars/current` and a relative
entrypoint. A subprocess regression covers this case. The immutable application
code did not change; its original unit templates predate this operational fix.

**Do not reinstall unit templates from the immutable application release.** Use
the corrected repository `ops/reporadars/` files or their root-owned deployed
copies in `/opt/reporadars/operations/20260907-email-admin-v1/`.

Installed artifact SHA256 values:

| Artifact | SHA256 |
| --- | --- |
| `reporadars.service` | `8bee0a7e5a13599b10d2af14f2818619a4f1bbb238674ff557d36d2099d4712f` |
| `reporadars-backup.service` | `23059bb5fcefe39c370f070c246c17afb969cd6f55b958d1383e54a63481c1f9` |
| `reporadars-backup.timer` | `502e134ed4659f62db59c8b5afd34ff9a42293559a3095c55de88c6586e3577e` |
| `nginx.conf` | `eb1fc3e73f76ced9091a2a4f7f70033d002e0dceda22f5051398422863713478` |

The API service and daily backup timer are enabled. The backup timer runs near
03:40 UTC with up to ten minutes of jitter. Its first scheduled run is not a
claim of completion; the backup service was separately run and verified during
activation. Monitor its exit status and available disk space.

## Backup and recovery evidence

- Pre-activation consistent SQLite backup:
  `/var/backups/reporadars/before-activation-20260907`.
- Verified backup with the live application's WAL open:
  `/var/backups/reporadars/2026-09-07T19-49-25.139Z`.
- Both database integrity and exact private metadata copies were checked.
- An isolated copy at `/var/lib/reporadars/restore-check-20260907` was actually
  opened by the production launcher on loopback port 4322. Session inspection,
  administrator denial and foreign-Origin denial passed. The owner ID and
  pending grant matched. That test process was stopped; the private recovery
  fixture is retained, not used by the live service.
- A live service restart retained the existing pending owner account.

Use the SQLite backup API, not a raw copy of the main database while WAL is
active. The auth secret and runtime metadata must travel with the database.
Backups are root-private and local to this host; off-host backup and a retention
policy are still follow-up work. This phase does not automatically delete them.

To inspect the account without revealing secrets, use the physical release path
(not an absolute path through the `current` symlink):

```sh
sudo -u reporadars node /opt/reporadars/releases/20260907-email-admin-v1/server/admin-manage.mjs status --directory /var/lib/reporadars/runtime --email owner@example.com
```

## Rollback

Rollback has two parts. Reverting the Worker alone does **not** disable API access.

1. Stop/disable `reporadars.service` to close authentication and editorial writes.
   Keep the exact nginx API location so failures remain JSON 503/no-store.
2. Deploy the retained previous Worker version at 100%:
   `e76a370a-adec-4043-96c8-e9704b8f627b` (UI release `c75e3e935ba9`).
   This version was confirmed available immediately before activation.

Cloudflare rollback request, through an authenticated operator tool:

```text
POST /accounts/{account_id}/workers/scripts/reporadars-homepage/deployments
{
  "strategy": "percentage",
  "versions": [{
    "version_id": "e76a370a-adec-4043-96c8-e9704b8f627b",
    "percentage": 100
  }],
  "annotations": {"workers/message": "Rollback email/admin activation"}
}
```

Verify the old UI release header and API 503 afterwards. Keep the live database,
all backups, TLS certificate and private SMTP configuration. Do not restore an
older database automatically: that would discard later accounts/content. Database
restoration requires a stopped service, a fresh consistent backup, explicit data
loss approval if applicable, and a separate checked directory with service-owned
0700/0600 permissions before switching the configured runtime path. TLS strict
mode can remain enabled; do not weaken certificate verification as a rollback.

The retained Worker target was checked, but a public rollback/redeploy cycle was
not performed. Application restart and isolated backup restoration were tested.

## Verification and remaining boundaries

Canonical `BASE_URL=http://127.0.0.1:4321 make verify` passed: 54 Node tests and 68
browser tests, including real isolated email-link/session/admin lifecycles,
ordinary/revoked-user denial, conflict handling and RU/EN navigation. Production
dependency audit reported no vulnerabilities. Independent critical-risk review
approved the final activation configuration. Nginx and unit validation passed;
unrelated pre-existing host unit warnings were not modified.

Public checks confirmed the new release on `/ru/login` and `/ru/admin`, anonymous
session 200 with `user: null`, admin API 401 and no-store responses. A temporary
static-only Worker upload location was removed and checked to return 404. The
uploader passed the locally read artifact directly to Cloudflare and checked its
SHA256; the connector's general fetch restriction was not bypassed.

An administrator grant is keyed to the owner's existing user ID. It remains
pending until the owner genuinely confirms email and accesses an admin endpoint.
No password, fabricated verified flag or owner session was created. The owner
must request the link from their browser, open it in that same browser, and
explicitly confirm; links are short-lived and browser-bound. The application
returns a neutral send response, so UI success alone is not proof of delivery.

Actual owner email delivery and login are still awaiting owner verification.
Live login mail currently uses the existing plain-text SMTP transport; the prior
branded test email is not evidence of a branded live login template. Editorial
publication changes the private database only; integration with the public
catalog, journal and collections remains a separate phase. See
`admin-panel.md` and `email-auth.md` for the implementation contracts; their
pre-activation operational notes are superseded by this activation record.

No commit or push was performed as part of activation. Existing checkout edits
and the protected Sites adapter files were preserved.
