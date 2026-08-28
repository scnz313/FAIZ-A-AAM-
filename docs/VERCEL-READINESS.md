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

