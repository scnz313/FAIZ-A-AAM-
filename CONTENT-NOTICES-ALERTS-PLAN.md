# Content, Notices, Notifications, Alerts and Landing-Page Plan

Owner-facing build plan for the public content surface and its staff CRUD:
notices, in-app notifications, alerts, the landing page, policies, disclosure,
and the downloads register. Reconciled with `PROJECT-BLUEPRINT.md` (product
scope), `FEATURE-INTEGRATION-SPEC.md` (relationships/sync), `plan.md` (UI-first
execution order), `design/UX-BLUEPRINT.md` (V15 system), and the 10 September
2026 code audit.

Status of this file: **plan, not evidence.** Nothing here is VERIFIED until
built and gated. All database corrections are forward migrations from `000079`
onwards; remote mutations remain frozen and the owner applies SQL.

Constraint from the owner: no new complexity. Reuse the existing content
service, RPCs, outbox, and V15 components; add tables only where a concept is
genuinely missing.

## 0. Conventions every slice follows

- Domain rules live in `apps/web/modules/services/content.ts`,
  `notifications.ts`, and the RPCs; components render and call services.
- Money/dates: UTC storage, `Asia/Kolkata` display.
- Every mutation: server authorization (`content_editor` maker,
  `content_publisher` publisher, no self-approval), optimistic version,
  idempotency key on retries, append-only audit, outbox for fan-out.
- UI: V15 tokens/components, four async states, 320/390/768/1023/1440/1920,
  WCAG 2.2 AA, anti-slop rules.
- Acceptance per feature: happy path + denial + validation + retry +
  cross-module projection, with tests.

## 1. What exists today (audit summary)

| Area | State |
|---|---|
| Notice/page draft, review, approve, publish, schedule, unpublish | Built: `content_save_draft_v2` … `content_unpublish_v2`, service + `NoticePublisher` + `/staff/content` |
| Notice audiences (`notice_audiences`) | **No writer anywhere.** A UI-created notice never gets a public row, so anonymous readers can never see it |
| Anonymous notice reads | **Broken:** the only anon `content_items` policy is `kind='page'`; `contentListPublic` selects notices from `content_items` |
| Public `/notices` page | Client component calling the authenticated `/api/adapter`; anonymous visitors get 401 |
| Scheduled publish | `content_publish_due` exists and the worker can dispatch `content.publish`, but nothing ever enqueues it |
| Expiry | `content_expire_due` exists (service role) but no worker handler; 000037 removed its outbox event; unswept expired notices stay readable |
| Pinned / review-due | `pinned` is demo-only (no column); `review_due` is never written |
| Downloads register | `listDownloads` always returns `[]`; public list labels it "Authoritative register" |
| Notifications | Projection v2 + bell + read state work; no pagination/unread count, no preferences, silent failures, unknown kinds fall back to "Security" |
| Alerts | Urgent notices render badges only; facility alerts are an in-memory demonstrator (deferred); no sitewide alert entity |
| Landing page | Only the latest-notice strip is authoritative. Hero, service rail, story, school life, upcoming dates, CTA are static fixtures; `UpcomingDates` holds local hardcoded dates |
| Policies / disclosure | Static fixtures |

## 2. Features to build, in slice order

### C1 — Public notice reads work end to end (blocker) · SQL + loaders

- Forward migration `000079_public_notice_audiences.sql`:
  - `content_save_draft_v2` (and the publish command) writes the requested
    audience rows idempotently: `notice_audiences(notice_id, audience)` at
    least `public` or `role`/`grade_section` when the composer selects them.
  - Add an anon SELECT policy for published notice `content_items` (mirroring
    the published-page policy) so the public loader can read them.
  - Backfill: give existing published notices a `public` audience when the
    composer's audience metadata says public (or when none exists and the
    notice was published as public).
- App: public `/notices` and `/notices/[slug]` read through a server loader
  (`contentListPublic`), not the authenticated adapter; keep the demo service
  for demo mode. Errors render the existing error panel, not a 401 page.
- Audience selector in `NoticePublisher` (public, role, class section) is
  wired to the service's `audience` field (already in the contract).
- Tests: SQL audience write + anon read; service contract for the audience
  payload; a page test for anonymous render/empty/error.

### C2 — Scheduling and expiry actually run · SQL + worker

- Migration `000080_content_schedule_expiry_jobs.sql`:
  - Restore/define outbox (or provider-job) enqueue on publish-scheduled and
    on publish-with-expiry: `content.publish:<ref>:<version>` and
    `content.expire:<ref>:<version>`.
  - Grant/handler contract: the worker calls `content_publish_due()` and a new
    `content_expire_due()` that also enqueues a `content.expired` audit/outbox
    event (restoring the 000029 behavior 000037 removed).
- Worker (`outbox-worker.ts`): handle `content.publish` (exists) and add
  `content.expire`; keep failures retryable with backoff; no silent success.
- UI: `NoticePublisher` already sends a schedule date; show Scheduled state
  with the exact time and a "Publish now" action; expiry is optional.
- Tests: fake-clock SQL schedule→publish and expiry; worker dispatch test.

### C3 — Downloads register (public + staff) · SQL + UI

- Public projection: `listDownloads` reads `documents` +
  `content_documents` where `visibility='public_approved'` and scan clean,
  returning safe metadata only; delivery stays on the audited document route.
- Staff: reuse the existing documents workspace to upload/approve public
  documents and link them to notices/pages; no new upload pipeline.
- UI: public notices page lists only real, ready downloads; empty state is
  honest; remove the "Authoritative register" claim when empty.
- Tests: projection contract, quarantine/expired denial, empty honesty.

### C4 — Notifications depth · app + SQL (small)

- Pagination + unread count: add `limit/cursor` and a count to
  `notificationsList`; the bell requests the first page and shows the true
  unread count.
- Non-silent errors: bell load/mark-read/mark-all failures surface a small
  inline retry, never a silent catch.
- Kind mapping: unknown `target_type` renders a neutral "Update" instead of
  "Security"; add the notice/content kind copy.
- Preferences (owner decision): decide whether per-kind email/in-app mute is
  in scope; if yes, one `notification_preferences` table and a settings panel;
  if no, record the decision.
- Public-notice fan-out (owner decision): in-app notification to "everyone" is
  not modelled; recommended answer is no in-app fan-out, only the public
  notice surface, to avoid duplicating audience logic.
- Tests: pagination, unread count, failed mark read with retry, kind fallback.

### C5 — Alerts model (owner decision, then small build)

- Definition to confirm: an "alert" is an **urgent published notice** with a
  sitewide strip on the public home and portal home until it expires or is
  unpublished.
- If confirmed: (a) add the `pinned` column (version metadata) so "pinned"
  stops being demo-only; (b) add a sitewide `AlertStrip` that reads the latest
  urgent, non-expired public notice; (c) show the same strip on the portal home
  for family-audience notices; (d) acknowledgement is out of scope.
- Facility/environment alerts stay an isolated demonstrator exactly as AGENTS
  states; nothing here connects them to real data.
- Tests: urgent strip selection (latest, unexpired), expiry hides it, no
  fabricated copy when none exists.

### C6 — Landing-page content becomes managed, not fixture

Decision needed: manage these through the existing content service (kind
`page`/`notice` or a new `home` kind) rather than new tables.

- **Upcoming dates:** replace the hardcoded `DATES` with published notices
  carrying a date, or school-configuration dates where they exist; the section
  renders nothing honest when empty (no fixture).
- **Hero, service rail, school story, school life:** move to content pages
  (`kind='page'`, slugs `home-hero`, `home-services`, `home-story`,
  `home-life`) with the existing save/review/publish flow and fallbacks that
  say "content is being prepared" instead of fictional copy. One page per
  section keeps the composer UI unchanged.
- **Policies (`/policies/*`):** render published content pages when present,
  fall back to the current text only while unpublished, and surface a
  "review due" from `review_due`.
- **Disclosure:** move the `DISCLOSURES` array into a content page (or a
  small `disclosures` content kind) with document links; keep the
  "pending verification" honesty.
- Tests: each section renders server content, empty state when unpublished,
  and never fiction in Supabase mode.

### C7 — Staff CRUD completeness and robustness

- `pinned` and `review_due` stored and editable; audience UI covers
  role/section; page scheduling UI (service supports it today).
- Pubic page route rendering: only `/about` consumes managed page bodies
  today; wire the C6 sections and policies.
- No hard delete anywhere: archiving is the terminal state; document it in the
  UI copy.
- Stale-version and retry coverage for unpublish (add an idempotency key).
- Empty/error/retry states on every staff list (notices, content, downloads).

## 3. Owner decisions required before their slice

1. **C4 preferences:** per-kind notification mute in scope, or not?
2. **C4 public fan-out:** confirm no in-app notification for public notices.
3. **C5 alerts:** confirm "urgent notice = sitewide alert strip", no
   acknowledgement; facility alerts stay a demonstrator.
4. **C6 scope:** confirm which landing sections are managed first (recommended
   order: upcoming dates → policies → disclosure → hero/services/story/life).
5. **Downloads:** confirm public documents are limited to
   `visibility='public_approved'` (no notice attachments without approval).

## 4. Slice order and exit criteria

| Slice | Order | Exit criteria |
|---|---|---|
| C1 | first (blocker) | Anonymous `/notices` and `/notices/[slug]` show real published notices; audience rows written and readable; no fixture fallback in Supabase mode |
| C2 | next | A scheduled notice publishes within the worker window; an expired notice disappears from every projection; failures retry |
| C3 | then | Public downloads list real approved documents only; quarantined/expired denied; staff can publish a document and see it appear |
| C4 | then | Bell paginates, shows the true unread count, and surfaces failures with retry; kind mapping honest |
| C5 | after decisions | Urgent notice surfaces as the sitewide strip until expiry/unpublish; no fabricated alert; facility stays isolated |
| C6 | then | Every landing/policy section reads published content or an honest empty state; no fixtures in Supabase mode |
| C7 | continuous | CRUD matrix complete with tests, no dead controls, audit/outbox on every consequential step |

## 5. Connections to respect

- Publishing a notice updates the public board, the portal board, the home
  strip (C5), and (when audience includes family) the in-app notifications
  projection; expiry reverses all of them.
- Public pages and notices share one content record; the S3 preview renders
  the real public template without publishing.
- Downloads are documents: scan state, retention, signed delivery, and audit
  stay on the existing document path; content only links them.
- Every build slice ends with `typecheck`, `lint`, `test`, `build`,
  `git diff --check`, and `sh scripts/validate-db-local.sh`; evidence goes to
  the opening checkpoint of `PROJECT-STATUS.md`, never into this plan.
