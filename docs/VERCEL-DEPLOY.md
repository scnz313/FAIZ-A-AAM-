# Vercel deployment — client demo preparation

This document is the exact deployment procedure for the FASS platform client
demo. It was prepared without linking a Vercel project, without deploying, and
without running any migration. The central deployer runs `vercel link` and the
deploy commands.

- Configuration prepared: `vercel.json` at the repository root.
- Env sync helper: `scripts/vercel-env-sync.mjs` (dry-run by default).
- Do not commit `.env.local` or any secret. Vercel environment variables are
  the only place deployed values live.

## 1. What Vercel will do with this repository

The recommended project configuration keeps the Vercel **Root Directory** at
the repository root and lets the root `vercel.json` fully describe the build:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "npm install",
  "buildCommand": "npm run build -w apps/web",
  "outputDirectory": "apps/web/.next",
  "crons": [{ "path": "/api/outbox", "schedule": "* * * * *" }]
}
```

| Setting | Value | Why |
| --- | --- | --- |
| `framework` | `nextjs` | Explicit Next.js preset; no dashboard detection needed |
| `installCommand` | `npm install` | Runs at the repo root, so npm workspaces links `@fass/contracts` and `apps/web` correctly |
| `buildCommand` | `npm run build -w apps/web` | Root script alias for `next build` in `apps/web` |
| `outputDirectory` | `apps/web/.next` | Next.js production output (root `next.config.mjs` pins `distDir` to `.next` outside `next dev`) |
| `crons` | `GET /api/outbox` every minute | Protected outbox dispatcher; route accepts only `Authorization: Bearer $CRON_SECRET` |

Node version: root `engines.node` is `22.x` and `.nvmrc` is `22`, so the
Vercel build uses Node 22.

### Why this option over Root Directory = `apps/web`

The alternative is to set the project **Root Directory** to `apps/web` with
the **"Include source files outside of the Root Directory in the Build Step"**
toggle enabled. That works, but it has two costs for this repository:

1. `vercel.json` is read from the project Root Directory. The cron entry would
   have to move to `apps/web/vercel.json` (and the root file would be ignored
   silently), duplicating the contract that `apps/web/test/provider-routes.test.ts`
   asserts against root `vercel.json`.
2. It adds a dashboard-only toggle, so the build is no longer fully described
   by version-controlled configuration.

The root configuration is recommended: one `vercel.json`, no dashboard
toggles, and `npm install` at the root resolves the workspace dependency
graph without extra settings. If the Next.js builder ever fails to read the
`apps/web/.next` output, switch to the Root Directory alternative and move the
cron entry into `apps/web/vercel.json`.

## 2. Cron strategy: Hobby vs Pro

Vercel plan limits (confirmed against Vercel docs, 2026):

| Plan | Minimum cron interval | Scheduling precision | Behavior for `* * * * *` |
| --- | --- | --- | --- |
| Hobby | Once per day | Per-hour (±59 min) | **Deployment fails** with "Hobby accounts are limited to daily cron jobs" |
| Pro | Once per minute | Per-minute | Supported |

**If the project is on Pro:** keep the committed `* * * * *` schedule. The
outbox worker runs every minute and `/api/health` can report `worker.fresh`.

**If the project is on Hobby:** choose one of these before deploying.

1. Daily cron fallback: change the root `vercel.json` schedule to `0 0 * * *`
   (daily at 00:00 UTC, triggered between 00:00 and 00:59 UTC = 05:30–06:29
   IST). Also update the expectation in
   `apps/web/test/provider-routes.test.ts` (it currently asserts
   `"schedule": "* * * * *"`). The outbox then processes queued email/PDF work
   once a day.
2. Remove the `crons` entry entirely and trigger the worker manually:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<deployed-url>/api/outbox`
   or `vercel crons run /api/outbox` (the CLI trigger targets the production
   deployment).

Demo consequence of Hobby: `/api/health` treats an outbox run older than
5 minutes as stale and returns HTTP `503` with `status: "degraded"` (even when
all configuration is present). Run the manual outbox trigger immediately
before showing the health check, and expect `status: "ready"`,
`worker.fresh: true` for the following 5 minutes. Public pages, sign-in, and
the portals are unaffected by the degraded health response.

Preview deployments do not execute crons at all; only the production
deployment does. If the demo runs on a preview URL, trigger `/api/outbox`
manually.

## 3. Prerequisites

- Node 22 for local commands (`nvm use 22`); the Vercel build enforces it via
  `engines.node`.
- Vercel CLI authenticated: `vercel --version` (observed during preparation:
  59.17.0) and `vercel whoami`.
- A decision on plan (Hobby vs Pro) from section 2.
- The Supabase staging project values, Resend values, and adapter flags are in
  the repository-root `.env.local` (gitignored). They are never printed by the
  helper script.

**Identity discrepancy to resolve first:** earlier project documentation
recorded the CLI session as `trashbin2605-1350`; at preparation time
`vercel whoami` returned `scnz141-9173`. Confirm the intended team with
`vercel teams ls` before linking so the project lands under the right account.

## 4. Link the project

From the repository root:

```bash
# Create the project once (skip if it already exists in the scope):
vercel project add fass

# Link this checkout to it (non-interactive):
vercel link --yes --project fass
```

Suggested project name: `fass`. Linking writes `.vercel/project.json`
(an untracked, non-secret project identifier). Do not commit it; the Vercel
CLI normally adds `.vercel` to `.gitignore`.

Optional check:

```bash
vercel project inspect fass --non-interactive
```

## 5. Environment variables

Set these for **Preview and Production**. `NEXT_PUBLIC_*` values are embedded
at build time, so changing one requires a redeploy. Server secrets should be
marked **Sensitive** (unreadable after creation).

| Name | Kind | Source | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | config | `.env.local` | Staging project URL; browser-visible |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | config | `.env.local` | Browser-visible publishable key |
| `SUPABASE_SECRET_KEY` | sensitive | `.env.local` | Server-only; bypasses RLS |
| `APP_URL` | config | deployed URL | Must be the deployed URL (email/confirmation links). Preview and Production differ; see below |
| `CRON_SECRET` | sensitive | `.env.local` | Required by `GET /api/outbox`; `vercel crons` sends it automatically for native crons |
| `RESEND_API_KEY` | sensitive | `.env.local` | Outbox email provider |
| `EMAIL_FROM` | config | `.env.local` | Currently a Resend sandbox sender; sandbox only delivers to the Resend account owner |
| `RESEND_WEBHOOK_SECRET` | sensitive | `.env.local` | Svix signing secret including the `whsec_` prefix |
| `DOCUMENT_SCANNER_PROVIDER` | config | `manual` | Optional; defaults to `manual` when unset |
| `DOCUMENT_SCANNER_SECRET` | sensitive | `.env.local` | Manual scan callback bearer secret (16+ chars) |
| `FASS_DATA_ADAPTER` | config | `supabase` | Server runtime adapter |
| `NEXT_PUBLIC_FASS_DATA_ADAPTER` | config | `supabase` | Browser mirror; must match the server value exactly |

Do **not** copy these local-only names from `.env.local` into Vercel:
`DOCUMENT_SCANNER_URL` (points at a localhost stub),
`FASS_DEV_AUTH_BYPASS`, `FASS_DEV_TEST_PASSWORD`, `FASS_TOTP_REQUIRED`,
`FASS_IOT_*`, `FASS_STAGING_CONFIRMED`, `DATABASE_URL`, `TEST_DATABASE_URL`.

### Automated first pass

```bash
# 1. Dry run: prints names/targets only, never values.
node scripts/vercel-env-sync.mjs

# 2. Write to Preview + Production (values from .env.local, secrets as Sensitive).
node scripts/vercel-env-sync.mjs --execute --app-url https://<deployed-url>

# 3. Without --app-url the script refuses to push a localhost APP_URL.
#    For preview/production APP_URL differences, correct the Preview value in the
#    dashboard afterwards (the override applies one URL to both targets).
```

The script refuses to run when the repository is not linked or a required
value is missing, pipes values to `vercel env add` over stdin (never argv),
and sets each name with the CLI in one call:
`vercel env add <NAME> preview,production --force [--sensitive]`.

### Dashboard alternative

Project → Settings → Environment Variables → add each row from the table for
the Preview and Production targets. Use the **Sensitive** toggle for the
sensitive rows.

### Resend and scanner follow-ups

- Register the Resend webhook for `https://<deployed-domain>/api/email/webhook`
  and use the signing secret as `RESEND_WEBHOOK_SECRET`.
- Client demos should not depend on document scanning: with
  `DOCUMENT_SCANNER_PROVIDER=manual` the upload works and the batch stays
  `pending_scan` until an operator callback, which is the documented
  degradation contract.

## 6. Deploy

```bash
# Preview deployment (creates a per-deployment URL):
vercel deploy

# Production deployment (public production URL):
vercel deploy --prod
```

The deployer should prefer a **production** deployment for the client demo:
preview URLs are covered by Deployment Protection (Vercel Authentication)
depending on team defaults, while production domains are public under Standard
Protection. If the demo must run on a preview URL, check Project Settings →
Deployment Protection and use a shareable link if protection is on.

## 7. URLs, aliasing, and domains

- A production deploy receives the project's generated production domain. If
  `fass.vercel.app` is free in the scope, Vercel assigns it; if it is already
  taken, the generated alias is scope-suffixed (for example
  `fass-<scope>.vercel.app`). Availability is decided server-side at deploy
  time; there is no local pre-check.
- Preview deployments receive per-deployment URLs like
  `https://fass-<hash>-<scope>.vercel.app`.
- Assign or move a stable alias explicitly:

```bash
vercel alias list
vercel alias set <deployment-url> fass.vercel.app
vercel alias remove fass.vercel.app
```

- Custom domain: Project → Settings → Domains → add the domain and follow the
  DNS instructions (A record or CNAME for `www`); TLS is provisioned
  automatically. Nothing in this repository needs to change.
- After the final URL is known, set `APP_URL` (both targets) to that URL and
  redeploy if a build-time consumer needs it. `APP_URL` is runtime-read, but a
  redeploy keeps the environment snapshot consistent.

## 8. Post-deploy checks

```bash
# Read the cron secret without printing it:
CRON_SECRET="$(grep -E '^CRON_SECRET=' .env.local | cut -d= -f2-)"
BASE="https://<deployed-url>"

# 1. Health: names/states only; 200 "ready" once env and worker are current.
curl -sS "$BASE/api/health" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(d))"

# 2. Outbox worker with the exact Bearer secret:
curl -sS -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/outbox"

# 3. Re-check health inside 5 minutes of a successful outbox run:
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/api/health"

# 4. Sign-in smoke (synthetic staging accounts, TOTP enrolled on first login):
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE/sign-in/staff"
#    then sign in with test.administrator@faizaam.example / test.principal@faizaam.example
#    (TEST_ACCOUNT_PASSWORD from the deploy environment; never real people)

# 5. One email send: trigger a workflow that queues email (for example an
#    applicant registration or password recovery), call /api/outbox again, and
#    confirm the message in the Resend dashboard. Sandbox EMAIL_FROM only
#    delivers to the Resend account owner's address.
```

Expected states:

- `/api/health` returns `503` until every required name is set, migrations
  probe, and the outbox ran within 5 minutes. A `503` with
  `ok: true` means configuration is complete but the worker is stale: run
  check 2 again.
- `/api/outbox` returns `401` without the Bearer secret and `503` when
  `CRON_SECRET` is not configured. That is correct behavior, not a bug.
- `vercel crons list` shows the `/api/outbox` entry only after a production
  deployment; `vercel crons run /api/outbox` triggers it manually.

## 9. Rollback

```bash
vercel rollback <previous-deployment-url-or-id>   # repoint production
vercel rollback status                            # confirm completion
```

- The dashboard also allows promoting a previous deployment
  (Deployments → ⋯ → Promote to Production).
- Environment variable changes are **not** covered by rollback; they apply to
  subsequent deployments. If a bad variable caused the incident, fix it in the
  dashboard and redeploy.
- Re-running `vercel deploy --prod` on a previously verified commit is the
  fallback when no suitable deployment remains.

## 10. Decisions for the central deployer

1. **Plan:** Pro keeps the minutely outbox cron and fresh health; Hobby
   requires the daily-cron fallback or manual triggers (section 2).
2. **Project name and scope:** suggested `fass`; confirm the team first
   (identity discrepancy in section 3).
3. **Alias:** `fass.vercel.app` if free, otherwise accept the scope-suffixed
   generated URL or add a custom domain.
4. **`APP_URL`:** set to the final demo URL for both targets.
5. **Preview vs production demo:** production is public; previews may require
   Vercel Authentication.
6. **Function region:** default is `iad1`; consider `bom1` (Mumbai) for a
   Mumbai-region Supabase project. Not set in `vercel.json` because it is an
   owner decision.
7. **Resend:** the sender domain and demo recipient (sandbox limits in
   section 8).

## 11. Preparation verification (15 September 2026)

All commands were run from the repository root; no Vercel project was linked
and no deployment was created.

| Check | Command | Result |
| --- | --- | --- |
| Clean production build | `rm -rf apps/web/.next && npm run build` | Next.js 15.5.25, compiled in 12.4s, 86/86 static pages generated, `apps/web/.next/BUILD_ID` written |
| Production server smoke | `PORT=4321 npm start` | Ready in 170ms; `/` 200, `/sign-in/staff` 200, `/policies/terms` 200, `/api/health` 503 (worker stale, expected) |
| Health body | `curl /api/health` | `ok: true`, `adapter: "supabase"`, `readiness.missing: []`, `worker.fresh: false` (last run 17:28 UTC) |
| Icon inventory | `npm run check:icons` | "Material Symbols subset manifest matches 69 source icons" |
| Cron contract test | `npm test -w apps/web -- test/provider-routes.test.ts` | 11/11 passed (asserts root `vercel.json` still declares `/api/outbox` at `* * * * *`) |
| Env sync dry run | `node scripts/vercel-env-sync.mjs` | Refuses when unlinked; dry-run lists 12 names for preview+production; missing-value and localhost-`APP_URL` refusals verified in a scratch copy |

Local Node was 24.5.0; Vercel builds with Node 22 per `engines.node`.
