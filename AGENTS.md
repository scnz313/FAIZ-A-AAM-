# AI Project Instructions — Faiz Aam School Platform

This file applies to the entire repository. Every AI agent or developer must follow it before planning, editing, testing, or deploying this project.

## Mandatory reading order

Before making any project change, read:

1. `PROJECT-BLUEPRINT.md` — canonical product scope, architecture, workflows, data model, permissions, quality gates, and delivery order.
2. `PROJECT-STATUS.md` — current implementation state, completed work, active phase, blockers, and unresolved decisions.
3. `plan.md` — active C0–C5 Supabase cutover order, entry conditions, exit criteria, and staging gate.
4. `FEATURE-INTEGRATION-SPEC.md` — canonical detailed relationships, role/scope rules, active student context, cross-module synchronization, feature contracts, and required integration tests.
5. `UI-COMPLETION-PLAN.md` — completed frontend integration reference and route-level acceptance evidence.
6. `design/UX-BLUEPRINT.md` — visual direction, component map, and user-experience rules for relevant UI work.
7. `design/RESEARCH-NOTES.md` — regulatory and implementation research when working on payments, privacy, disclosure, accessibility, authentication, or uploads.

Do not begin implementation from a user prompt alone. Reconcile the request with these files first.

## Source-of-truth precedence

When instructions disagree, use this order:

1. The user’s latest explicit instruction.
2. `PROJECT-BLUEPRINT.md`.
3. `FEATURE-INTEGRATION-SPEC.md` for detailed feature, relationship, context, and synchronization behavior.
4. `PROJECT-STATUS.md` for facts about what is currently implemented.
5. `plan.md` for active backend execution order and cutover gates.
6. `UI-COMPLETION-PLAN.md` for completed frontend evidence.
7. `design/UX-BLUEPRINT.md` for visual and interaction decisions.
8. Existing code and tests.

If code disagrees with the blueprint, do not silently copy the inconsistency. Report it and either align the code or update the blueprint when the user has changed the intended behavior.

## Architectural guardrails

- Build a **modular monolith**, not microservices.
- Use one web application, one PostgreSQL database, one private object store, and a small database-backed outbox for asynchronous work.
- Keep public pages, applicant journeys, parent/student portals, and staff operations in the same codebase with strict route and permission boundaries.
- Put business rules in domain services, not React components, route handlers, database triggers alone, or payment callbacks.
- Enforce authorization on the server for every protected read and write.
- Use provider adapters for payment, email/SMS, storage, PDF generation, and optional identity services.
- Do not store raw card details, UPI credentials, OTPs, passwords, or provider secrets in application tables or client storage.
- Store money as integer paise and timestamps in UTC. Present dates/times in `Asia/Kolkata` unless the verified school policy says otherwise.
- Financial entries, submitted applications, published results, and audit events are append-only or versioned. Never silently overwrite their history.
- Do not add Redis, GraphQL, Kafka, a second backend, a mobile app, an LMS, transport tracking, attendance, payroll, or chat unless the blueprint is explicitly expanded.
- Do not expose student results, documents, application data, or fee records through public search or predictable identifiers.

## Active phase — three-portal consolidation (Administrator, Principal, Guardian)

The signed-in product is being consolidated into exactly three portal
experiences: **Administrator** (`/administrator/*`), **Principal**
(`/principal/*`), and **Guardian** (`/portal/*`). The Teacher portal and
Student portal are removed; teachers remain non-login school records for
timetable and subject attribution, and students remain school records linked
to guardians. The previous C5 staging sequence is paused while this
consolidation lands; do not resume C5 staging migrations or Vercel work until
the two-profile migration and local gates pass.

### Migration ledger divergence

- Remote Supabase has applied migrations `000001–000039`.
- Local `000040` and `000041` are committed but not live.
- Local `000042_staff_access_profiles.sql` is untracked and is being
  redesigned for the two-profile (administrator/principal) model before any
  apply. Do not treat the old three-profile version as authoritative.
- No remote write, migration apply, account/grant cleanup, or Vercel deploy
  is authorized by this phase. The two live remote teacher grants require a
  masked dependency report and explicit owner confirmation before retirement.

### Consolidation rules

1. Preserve all dirty-worktree changes; do not reset or discard user work.
2. A portal profile is a provisioning/routing concept only — server
   authorization still evaluates active granular grants, AAL2, scope, and
   maker/checker actor identity.
3. One staff account has exactly one active portal profile
   (`administrator` or `principal`). Internal grants are not user choices.
4. Principals perform daily maker/operational work; Administrators manage
   access/configuration and independently approve consequential work. No
   account may approve its own originating work.
5. Teachers are non-login school records. Add `teaching_assignments`
   independent of `role_grants` so timetable/conflict logic works without
   teacher credentials.
6. Guardian onboarding is school-first: import students/guardians, then
   invite via mobile OTP (email fallback) bound to the exact guardian and
   approved link set. A student number, name, DOB, or phone alone never
   activates access.
7. Update `PROJECT-STATUS.md` only after current-environment evidence passes.
8. Do not create production or deploy Vercel until staging is verified.
9. Run local gates (`npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build`, `sh scripts/validate-db-local.sh`) before any staging
   activation.

### Supabase completion rules

- Server Components use direct server loaders or the request-aware server adapter boundary.
- Client Components use the same-origin `/api/adapter` gateway.
- Protected records never use an unauthenticated relative server fetch.
- Supabase mode never reads operational `sessionStorage` or silently falls back to fixtures.
- A facade is complete only when its demo and Supabase contract tests agree and its affected projections are verified.

## UI guardrails

- Preserve the editorial, institutional visual system in `design/UX-BLUEPRINT.md`.
- The interface is UI-led and must not depend on generated school photography.
- Avoid generic SaaS dashboards, bento-card mosaics, crypto gradients, glass effects, pill-heavy navigation, and decorative 3D.
- Public pages may be expressive; operational portals must prioritize status, action, and readable tables/forms.
- Meet WCAG 2.2 AA, keyboard navigation, visible focus, clear form errors, reduced motion, and mobile usability.
- Use fictional data only in demos, fixtures, screenshots, and tests. Clearly mark it as such.

## Change workflow

For every feature or fix:

1. Identify the relevant blueprint module and acceptance criteria.
2. Identify the relationships and synchronization rules in `FEATURE-INTEGRATION-SPEC.md`.
3. Inspect the complete existing route → service → persistence → authorization → UI flow.
4. Make the smallest cohesive change that preserves module boundaries.
5. Add or update migrations, validation, authorization, audit events, and tests together when the data flow changes.
6. Test the happy path, permission denial, validation failure, retry/idempotency behavior, the most important recovery path, and affected cross-module projections.
7. Update `PROJECT-STATUS.md` only after validation proves the new state.
8. Update `PROJECT-BLUEPRINT.md` and `FEATURE-INTEGRATION-SPEC.md` when the approved product or integration contract changes.

## Definition of done

A feature is not complete because a screen renders or an API returns `200`. It is complete only when:

- The intended user can complete the end-to-end workflow.
- Other roles are denied correctly.
- Validation and state transitions are enforced server-side.
- Persistence and audit behavior are verified.
- Retries do not create duplicates.
- Errors give the user a recoverable next step.
- Relevant unit, integration, and end-to-end tests pass.
- Accessibility and responsive behavior are checked.
- `PROJECT-STATUS.md` accurately records the result and remaining limitations.

## Status language

Use these exact meanings in `PROJECT-STATUS.md`:

- `NOT STARTED` — no implementation exists.
- `IN PROGRESS` — implementation exists but the blueprint acceptance criteria are not all verified.
- `BLOCKED` — an external decision, credential, approval, or service is required.
- `VERIFIED` — acceptance criteria and relevant tests pass in the current environment.
- `RELEASED` — verified work is deployed to the named environment and post-deploy checks passed.

Never describe `VERIFIED` work as `RELEASED` without deployment evidence.

## Test staff accounts (synthetic, staging only)

`scripts/seed-test-accounts.mjs` creates profile-based synthetic staff
accounts — one Administrator and one Principal, matching the two portal
profiles — in the linked Supabase project (auth user → person → user_account →
role_grant → staff_member). It is idempotent and safe to re-run; accounts are
keyed by `test.<profile>@faizaam.example`. The shared password is printed by
the script. First sign-in at `/sign-in/staff` still enrolls TOTP (plan.md §4).
Legacy per-role accounts are DB-only denial fixtures, not portal personas.
Never use these accounts in production or with real data.

## Local performance workflow

Use Node 22 (`nvm use 22`) and start development with `npm run dev`. Development
uses Turbopack and `.next-dev`; production builds use `.next`, so a dev compiler
cannot corrupt a running production build. Run only one development server per
checkout. First visits in development include route compilation and are not a
production performance measurement; benchmark a warm route or a Node 22
`npm run build` + `npm start` run. Supabase adapter mode still contacts the
configured remote project—it is not a local database.
