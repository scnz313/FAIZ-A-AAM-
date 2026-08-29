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
| `CRON_SECRET` | **MISSING** |
| `RESEND_WEBHOOK_SECRET` | **MISSING** |
| `DOCUMENT_SCANNER_URL` | **MISSING** |
| `DOCUMENT_SCANNER_SECRET` | **MISSING** |

### Approval boundary

Per `plan.md` §C5.9 entry: "C5.7 and C5.8 pass; the repository candidate is
committed."  Per `AGENTS.md` rule 8: "Do not create production or deploy Vercel
until staging is verified."

**The Vercel Preview deployment is BLOCKED until:**

1. The 4 missing provider secrets are configured (`CRON_SECRET`,
   `RESEND_WEBHOOK_SECRET`, `DOCUMENT_SCANNER_URL`, `DOCUMENT_SCANNER_SECRET`).
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
