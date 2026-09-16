# AI Project Instructions — Faiz E Aam School Platform

This file applies to the entire repository. Every AI agent or developer must follow it before planning, editing, testing, or deploying this project.

## Mandatory reading order

Before making any project change, read:

1. `PROJECT-BLUEPRINT.md` — canonical product scope, architecture, workflows, data model, permissions, quality gates, and delivery order.
2. `PROJECT-STATUS.md` — current implementation state, completed work, active phase, blockers, and unresolved decisions.
3. `plan.md` — active C0–C5 Supabase cutover order, entry conditions, exit criteria, and staging gate.
4. `FEATURE-INTEGRATION-SPEC.md` — canonical detailed relationships, role/scope rules, active student context, cross-module synchronization, feature contracts, and required integration tests.
5. `UI-COMPLETION-PLAN.md` — completed frontend integration reference and route-level acceptance evidence.
6. `design/UX-BLUEPRINT.md` — visual direction, component map, and user-experience rules for relevant UI work. The canonical design prototype is **`V15 Faiz E Aam School Platform.html`** (in the repository root); all design tokens, components, layout patterns, and screen compositions are derived from that file. `V14 Faiz E Aam School Platform.html` remains in the repository as the historical reference only.
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

## Active phase — Phase 11: complete the three-portal platform end to end

**Execution override (8 September 2026, latest user instruction):** follow the opening UI-first recovery sequence in `plan.md`: recovery checkpoint → **V15 UI acceptance** → local database workflow integration → whole-application acceptance → providers/release. Work on one slice at a time. During V15 implementation change presentation only and record domain defects for the integration phase. **V15 supersedes V14** (owner decision, 8 September 2026); where V15 itself has a responsive or accessibility weakness, fix beyond the prototype. The optional `/environment` and `/staff/facility/*` demonstrator stays deferred outside UI acceptance. `/administrator/guardians` is the guardian activation workspace (record email contact, send/resend/revoke activation; email channel only until SMS provider registration). The migration/provider paragraphs below are historical context, not authorization to apply or renumber migrations. Current evidence belongs only in the opening checkpoint of `PROJECT-STATUS.md`. Never install or use Docker.

The signed-in product has three portal experiences: **Administrator**
(`/administrator/*`), **Principal** (`/principal/*`), and **Guardian**
(`/portal/*`). The Teacher portal and Student portal are removed; teachers
remain non-login school records for timetable and subject attribution, and
students remain school records linked to guardians. Phase 11 completes the
platform end to end: canonical portal routing, teaching/timetable/results
cutover, real CSV imports, guardian activation, exports/documents, staging
acceptance, and production. All new database corrections start at `000100`.

### Migration ledger

- Remote Supabase has applied migrations `000001–000108` (ledger `000051`
  was repaired→reverted; the corrected function shipped as `000052`).
  Migrations `000066–000101` were applied to staging on 11 September 2026
  by explicit owner instruction (`000066–000088` through the Supabase MCP
  server; `000089–000101` through the guarded linked CLI); `000102` and
  `000103`, and `000104_school_documents_upload` (public register upload
  boundary) were applied through the guarded linked CLI on 11–12 September
  2026. Migrations `000105_jobs_public_intake`, `000106_document_public_
  visibility_owner_guard`, `000107_anonymous_rpc_grant_repairs`, and
  `000108_scale_hot_paths_and_register_retention`, `000109_results_read_model_
  scale`, `000110_hot_path_repairs`, `000111_support_intake_uuid_fix`,
  `000112_import_export_read_repairs`, `000113_timetable_override_teaching_
  assignment`, `000114_remaining_hot_paths`, `000115_timetable_override_
  legacy_column`, `000116_export_recovery_and_scope_boxes`,
  `000117_reference_entropy`, and `000118_notification_dismiss` were applied
  through the Supabase MCP server on 15 September 2026 (the linked CLI was
  unresponsive) and their ledger rows were repaired to the file versions,
  matching a `supabase db push` ledger. `000119_guardian_link_request_
  reference` and `000120_notice_published_timestamp` were already on the
  remote ledger on 16 September 2026; `000121_staff_invitation_lifecycle`,
  `000122_guardian_activation_operations`, `000123_school_configuration`, and
  `000124_delivery_operations`, `000125_page_sections_body`,
  `000126_published_page_body`, and `000127_content_author_directory` were
  applied through the Supabase MCP server on 16 September 2026 with ledger rows
  repaired to the file versions (remote now `000001–000127`). The next database
  correction starts at `000128`.
- **Phase 11 is active.** The prior "Phase 10 complete" claim is retracted:
  green local gates do not prove end-to-end completion.
- All database corrections must be **forward migrations from `000100`**.
  Never edit live migrations `000001–000099`.
- The Supabase CLI login role database password was exposed in a terminal
  session and must still be rotated in the dashboard. MCP-mediated changes
  are separately authorized by the owner; the CLI secret remains unsafe.
- No Vercel/production action. Teacher-grant retirement requires a fresh
  masked inventory and explicit owner confirmation naming
  `ROLE-2026-5CB9B7` and `ROLE-2026-846E6C`.
- Remote scripts must guard on the exact project ref and an explicit
  `FASS_STAGING_CONFIRMED=true` environment confirmation; no committed
  fallback passwords are permitted anywhere.

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

- The canonical design system is **V15** (`V15 Faiz E Aam School Platform.html`, repository root). All UI work must use the V15 design tokens, component classes, and layout patterns documented in `design/UX-BLUEPRINT.md` sections 2 (visual system tokens), 12.1 (component specifications), 16 (responsive breakpoints), 17 (screen catalog), and 18–20 (role matrix, nav structure, implementation priority). V15 inherits the V14 palette/typography/breakpoints and adds richer page composition, the `q-head5`/`q-row5` five-column result queue, secondary evidence panels, and improved applicant-shell mobile behavior.
- **V15 design tokens (CSS custom properties):** ink `#0B1C2A`, paper `#F4EFE5`, saffron `#B96832`, willow `#536D57`, chalk `#FFFDF8`, madder `#A33B2E`, plus their soft/ink/line variants. Fonts: Source Serif 4 (serif), Public Sans (sans), Noto Nastaliq Urdu (Urdu). Radii: 4px (default), 3px (small), 999px (pill). Max widths: 1240px (public), 920px (narrow), 1160px (portal). See `design/UX-BLUEPRINT.md` §2 for the complete token table.
- **V15 components:** buttons (primary/accent/ghost/quiet/danger), status badges (5 semantic tones with one dot indicator), chips, ledger tables, panels (zero outer padding — `.pn-head`/`.pn-body`), forms (inputs/selects/textareas/OTP/validation), layout primitives (wrap/stack/row/grid/g32/g34/g23/kv/leader/facts-ledger/record-card), public components (ribbon/header/hero/sections/service-rail/notice-strip/story-grid/stages/life-index/dates-ledger/cta-band/footer), portal shell (sidebar/ctx-bar/page/page-head), workflow components (queue/q-row/q-head5/q-row5/timeline/wizard/modal/callouts/upload-slots/payment-states), and brand SVG motifs (eight-point emblem/star/contours/stamp). See `design/UX-BLUEPRINT.md` §12.1 for exact specifications.
- **V15 responsive breakpoints:** 1920px (wider wrap), 1180px (nav shrinks), 1120px (burger), 1023px (sidebar drawer, grids collapse), 719px (tables scroll, forms collapse, `q-row`/`q-row5` grid-areas), 479px (brand shrinks, full-width CTAs). See `design/UX-BLUEPRINT.md` §16. Where V15's own reflow is weak, improve beyond the prototype (owner decision).
- Copy V15 **layout only, never its illustrative data, counts, actor names, or client-only authorization behavior**; application values come from authoritative services.
- Preserve the editorial, institutional visual system: paper-and-ink editorial language, literary typography, fine rules, measured grids, precise institutional information design.
- The interface is UI-led and must not depend on generated school photography. Brand-derived SVG motifs only (eight-point star, contour lines, stamp).
- Meet WCAG 2.2 AA, keyboard navigation, visible focus (2px saffron-ink outline), clear form errors, reduced motion, and mobile usability.
- Use fictional data only in demos, fixtures, screenshots, and tests. Clearly mark it as such.
- **When implementing V15 UI changes, do not change the database, domain services, or backend logic.** Only update UI components, CSS modules, layouts, and page rendering.

### Anti-slop rules (mandatory, owner-approved 8 September 2026)

The following generic "AI-designed" patterns are **forbidden** in this project. These rules apply to every surface — public pages, portals, staff workspaces, forms, and marketing copy. They are codified here so all future development inherits them.

**Never do these:**

1. **Checkmark bullets** — no `✓` or check icons as list-item decoration. Lists use ruled rows, numbered steps, or plain text.
2. **Three pricing tiers** — no 3-column pricing card layouts. Fee information uses ledger tables and policy pages.
3. **Soft corner radius** — no border-radius above the 4px system (`--r`). Only `--r` (4px), `--r-s` (3px), `--r-pill` (999px), and 50% (circles) are permitted.
4. **Purple and black** — the palette is ink navy, paper, saffron, willow, chalk, madder. No purple.
5. **Radial orbs** — no gradient blob/orb backgrounds of any kind.
6. **Dot grids** — no dot-grid background patterns.
7. **Sparkle icons** — no `auto_awesome`, `star`, `sparkle`, or "magic" iconography.
8. **Animated arrows** — arrows (`→`) are static text; no bounce, slide, or pulse animation on them.
9. **Hover animations** — hover states are quiet background/border colour changes at 0.15s ease. No scale, bounce, rotate, lift, or morph effects.
10. **Neon colors** — no saturated electric/neon hues. Only the approved palette tokens.
11. **Basic pastel palette** — the palette is warm paper and deep ink, not washed-out pastels.
12. **Harsh gradients** — no linear/radial gradients except the fixed noise texture overlay at 5% opacity.
13. **Lucide icons** — the only icon system is Material Symbols Rounded (self-hosted subset). Never swap to Lucide, Heroicons, or any other set.
14. **Pure white background** — the page ground is `--paper` (#F4EFE5), never `#FFFFFF`.
15. **Rainbow coloring** — no multi-hue accent schemes. One saffron accent.
16. **Drop shadows** — no decorative `box-shadow`. Only inset focus rings (`inset 0 0 0 1px`) and print border fallbacks are permitted.
17. **Three feature cards in a row** — the service rail is a 4-column bordered grid, not floating feature cards. Never restructure to 3-card marketing rows.
18. **Emojis in UI** — no emoji anywhere in the interface. Use Material Symbols or text.
19. **Liquid glass / glassmorphism** — no backdrop-filter, frosted panels, or translucent card overlays.
20. **Em dashes as sentence punctuation** — use the V15 `·` (middle dot) separator or restructure the sentence. En dashes (`–`) are permitted only for numeric ranges (times, grades, dates).
21. **Inter/Geist/Space Grotesk** — the type system is Source Serif 4 + Public Sans + Noto Nastaliq Urdu. No substitutions.
22. **Colored left stripe** — no decorative colored border-left on any element, including active navigation items. Active states use background + text color changes only; accent callouts use full borders or top borders, never a left stripe.
23. **Fake testimonials** — no quoted praise, star ratings, or invented endorsements. Trust is earned through the record card, disclosure, and honest copy.
24. **Bento grids** — no mosaic/brick-layout card grids. Layouts are measured editorial grids (`g32`, `g34`, `g23`) or ruled ledgers.
25. **Terminal window** — no dark code-block/terminal aesthetic.
26. **"It's not X, it's Y" copy** — never use this comparison formula in headings or body copy.

**Must have these (their absence is slop):**

27. **Real product demos** — every surface shows a working flow with honest demo data, not a static screenshot or lorem ipsum.
28. **Terms of Service** — `/policies/terms` exists and is linked from the footer.
29. **Privacy Policy** — `/policies/privacy` exists and is linked from the footer.
30. **Skeleton loaders** — every data surface has a layout-matched loading state using the editorial skeleton bars, not a blank flash or generic gray pulse.

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
role_grants → staff_member). It is idempotent and safe to re-run; accounts are
keyed by `test.<profile>@faizaam.example`. The shared password MUST come from
the `TEST_ACCOUNT_PASSWORD` environment value — no committed fallback exists,
and the script refuses empty/short values. First sign-in at `/sign-in/staff`
still enrolls TOTP (plan.md §4). Legacy per-role accounts are DB-only denial
fixtures, not portal personas. Never use these accounts in production or with
real data.

## Local performance workflow

Use Node 22 (`nvm use 22`) and start development with `npm run dev`. Development
uses Turbopack and `.next-dev`; production builds use `.next`, so a dev compiler
cannot corrupt a running production build. Run only one development server per
checkout. First visits in development include route compilation and are not a
production performance measurement; benchmark a warm route or a Node 22
`npm run build` + `npm start` run. Supabase adapter mode still contacts the
configured remote project—it is not a local database.
