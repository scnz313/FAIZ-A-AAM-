# Vercel readiness (local configuration contract)

This repository is not deployed by Slice 6. The checked-in `vercel.json`
declares one bounded cron invocation: Vercel calls `GET /api/outbox` and the
route accepts only `Authorization: Bearer $CRON_SECRET`.

Use separate Vercel environments:

- Preview: `FASS_DATA_ADAPTER=supabase`, `NEXT_PUBLIC_FASS_DATA_ADAPTER=supabase`,
  and `NEXT_PUBLIC_SUPABASE_*` values for the synthetic FASS staging project.
- Production: the same names, but values for the separately owned production
  project. Never copy staging identities or provider secrets into production.
- Local/demo: both adapter variables remain `demo`; no provider credentials are
  needed for the UI demo.

`NEXT_PUBLIC_*` values are embedded at build time and are safe only when they
are public configuration (URL, publishable key, adapter mirror). `SUPABASE_SECRET_KEY`,
`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `CRON_SECRET`, and document scanner/
storage secrets are server-only runtime bindings and must not use the
`NEXT_PUBLIC_` prefix.

The Node runtime is pinned to 22 by `.nvmrc` and the root `engines` field. The
`/api/health` response exposes readiness names, migration probe state, and
worker freshness without returning environment values or secrets. A `503` is
expected until the named provider configuration and migration ledger are
actually available.

## C5.9 readiness assessment (2026-08-29)

**Status: BLOCKED** — entry conditions not met.

### Entry condition check

| Gate | Status | Blocker |
|------|--------|---------|
| C5.7 | PARTIAL | Health endpoint reports `degraded` — 4 missing provider secrets |
| C5.8 | PARTIAL | DB state verified; restore rehearsal blocked by Docker requirement |

### Configuration readiness

| Item | State |
|------|-------|
| `vercel.json` cron | Configured (`GET /api/outbox`, `* * * * *`) |
| Node 22 pin | `.nvmrc` + `engines.node` |
| Vercel CLI | 50.1.3, authenticated as `trashbin2605-1350` |
| Project link | NOT LINKED (no `.vercel/project.json`) |

### Environment variables

| Variable | State |
|----------|-------|
| `FASS_DATA_ADAPTER` | configured |
| `NEXT_PUBLIC_FASS_DATA_ADAPTER` | configured |
| `NEXT_PUBLIC_SUPABASE_URL` | configured |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | configured |
| `SUPABASE_SECRET_KEY` | configured |
| `APP_URL` | configured |
| `RESEND_API_KEY` | configured |
| `EMAIL_FROM` | configured |
| `CRON_SECRET` | **MISSING** — `/api/outbox` returns 503; scheduled email/PDF work never runs |
| `RESEND_WEBHOOK_SECRET` | **MISSING** — `/api/email/webhook` cannot verify Svix signatures; bounce/suppression events are not processed |
| `DOCUMENT_SCANNER_PROVIDER` | unset — defaults to `manual`; no environment change required |
| `DOCUMENT_SCANNER_SECRET` | **MISSING** — the manual callback (`POST /api/documents/[ref]/scan`) rejects service auth, so a document can never leave `pending_scan` |
| `DOCUMENT_SCANNER_URL` | only required by `provider=http` (and optional as a manual trigger stub) |
| `DOCUMENT_SCANNER_CLAMAV_HOST` | only required by `provider=clamav` (port defaults to 3310) |

### Document scanning provider contract

`DOCUMENT_SCANNER_PROVIDER` selects one of three provider boundaries; the
callback route and the `pending_scan` → `ready`/`quarantined`/`failed` states
are unchanged for all of them.

- **`manual` (default).** The worker performs no scan. Uploads stay
  `pending_scan`; an external scanner or operator reports the result to
  `POST /api/documents/[ref]/scan` with `Authorization: Bearer
  $DOCUMENT_SCANNER_SECRET` (constant-time comparison, 16+ character
  minimum). If `DOCUMENT_SCANNER_URL` is set, the worker POSTs a metadata-only
  trigger (no file bytes) to that stub and records the handoff as delivered
  without applying a result. Nothing in this path can mark a document `ready`
  without the authenticated callback.
- **`http`.** The worker POSTs the stored bytes to `DOCUMENT_SCANNER_URL`
  (`Authorization: Bearer`, `Content-Type: application/octet-stream`,
  `X-FASS-Document-*` metadata headers) and expects bounded JSON
  `{ "status": "ready" | "quarantined" | "failed", "detail"?: string }`.
  Non-2xx, timeout, malformed, invalid-state, or oversized responses are
  transient failures: the document stays `pending_scan` and the outbox
  retries with backoff.
- **`clamav`.** The worker streams the stored bytes to
  `DOCUMENT_SCANNER_CLAMAV_HOST:DOCUMENT_SCANNER_CLAMAV_PORT` (default 3310)
  using the `clamd` INSTREAM protocol. `stream: OK` becomes `ready`;
  `stream: <signature> FOUND` becomes `quarantined`; connection, timeout,
  oversized, or protocol failures are transient and retried.

What an operator must configure for a real scanner:

- `manual`: a scanner process or operator that can reach the deployed app and
  set `DOCUMENT_SCANNER_SECRET` in the app environment and in the caller.
- `http`: a scanning service URL plus a shared bearer secret
  (`DOCUMENT_SCANNER_URL`, `DOCUMENT_SCANNER_SECRET`). The service must accept
  raw bytes and return the JSON contract above.
- `clamav`: a reachable `clamd` TCP endpoint (`DOCUMENT_SCANNER_CLAMAV_HOST`,
  optional `DOCUMENT_SCANNER_CLAMAV_PORT`). `clamd` is typically a sidecar or
  internal service, never a public endpoint.

Scanner secret hygiene: the callback route compares the bearer token with
`timingSafeEqual`, HTTP provider responses are read with a hard size bound
(8 KiB), `clamd` responses are read with a 4 KiB bound, every provider call is
bounded by `DOCUMENT_SCANNER_TIMEOUT_MS` (1000–120000 ms, default 15000), and
no provider response body, file byte, or secret is written to application
logs or returned to the caller.

**Honest current staging state:** the scanner is a local manual callback stub.
Staging has no `DOCUMENT_SCANNER_SECRET`, so uploaded documents stop at
`pending_scan`; `/administrator/data/imports` states that scanning is not
configured and offers refresh/replace instead of polling forever. No provider
scan has run against staging. Selecting `http` or `clamav` requires the
provider endpoint above and fresh staging acceptance before production.

### Degradation contract (no secret is ever required for the UI to be honest)

- `/api/health` always probes the migration surface and reports
  `readiness.migration` independently of missing provider variables.
- Settings, content, finance, results, timetable, users, audit, exports and
  the portal remain fully usable without provider secrets.
- Imports: upload + private-store finalize succeed; the batch stays
  `uploaded` and the workspace explains the operator action instead of
  polling forever. Setting the scanner variables and pressing **Refresh scan
  status** continues the same batch.
- Email: the outbox records events; nothing is delivered until both
  `RESEND_API_KEY`/`EMAIL_FROM` (present) and a scheduler calling
  `/api/outbox` with `CRON_SECRET` exist. The worker never burns attempts
  while email configuration is absent.

### Approval boundary

Per `plan.md` §C5.9 entry: "C5.7 and C5.8 pass; the repository candidate is
committed."  Per `AGENTS.md` rule 8: "Do not create production or deploy Vercel
until staging is verified."

**The Vercel Preview deployment is BLOCKED until:**

1. The 4 missing provider secrets are configured (`CRON_SECRET`,
   `RESEND_WEBHOOK_SECRET`, `DOCUMENT_SCANNER_SECRET`, plus either
   `DOCUMENT_SCANNER_URL` for `provider=http` or
   `DOCUMENT_SCANNER_CLAMAV_HOST` for `provider=clamav`).
2. The Resend sender domain is verified (C5.5 blocker).
3. The Supabase project region is reconciled to `ap-south-1` or the plan is
   amended (C5.1 blocker — current project is `eu-west-1`).
4. A backup/restore rehearsal completes with an isolated restore target (C5.8
   blocker — requires database password or Docker).
5. The `/api/health` endpoint returns `ready` with all configuration present.

Once these are resolved, the deployment procedure is:
1. `vercel link` (create or link the Vercel project)
2. Configure Preview environment variables in the Vercel dashboard
3. `vercel --prod=false` to deploy a Preview build
4. Run the complete staging browser and provider gate on the preview URL
5. Verify cron, webhook, safe logs, function timeouts, worker freshness, and
   no secret exposure in browser bundles
