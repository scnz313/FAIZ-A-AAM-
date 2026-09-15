# Faiz Aam School Platform

This repository is the design and engineering foundation for an integrated school website, applicant centre, family/student portal, and staff workspace.

## Read before implementation

Read [`AGENTS.md`](AGENTS.md) first for the mandatory sequence and change rules.
The canonical sequence is:

1. [`PROJECT-BLUEPRINT.md`](PROJECT-BLUEPRINT.md) — product scope, architecture, workflows, data, permissions, quality gates, and delivery order.
2. [`PROJECT-STATUS.md`](PROJECT-STATUS.md) — current implementation truth, blockers, and verified evidence.
3. [`plan.md`](plan.md) — active C0–C5 Supabase cutover order, entry conditions, exit criteria, and staging gate.
4. [`FEATURE-INTEGRATION-SPEC.md`](FEATURE-INTEGRATION-SPEC.md) — relationships, shared context, synchronization, feature contracts, and integration tests.
5. [`UI-COMPLETION-PLAN.md`](UI-COMPLETION-PLAN.md) — completed frontend reference and route-level acceptance evidence.
6. [`design/UX-BLUEPRINT.md`](design/UX-BLUEPRINT.md) — **canonical V15 design system**: colour tokens, typography, component specifications, responsive breakpoints, screen catalog, and implementation priority. The design prototype is `V15 Faiz Aam School Platform.html` (repository root; V14 remains as the historical reference).
7. [`design/RESEARCH-NOTES.md`](design/RESEARCH-NOTES.md) — implementation research for payments, privacy, disclosure, accessibility, authentication, and uploads.

## Current state

The active work is **UI-first recovery and V15 acceptance**, followed by local database integration in workflow-sized slices. Follow the opening execution sequence in [plan.md](plan.md) and the authoritative checkpoint/checklist in [PROJECT-STATUS.md](PROJECT-STATUS.md). The older C5 paragraph below is historical and does not authorize provider activation or establish current completion.

The repository contains a validated frontend and a locally verified Supabase/provider-ready implementation through migration `000030`. **C5 staging and provider activation is now the active gate.** Start with source-control review and staging-ledger reconciliation; do not start with Vercel or a provider credential. The runtime remains demo by default, and no remote migration, provider configuration, deployment, or production release is claimed. See [`PROJECT-STATUS.md`](PROJECT-STATUS.md) for evidence and blockers; only [`plan.md`](plan.md) defines the C5.0–C5.10 execution order.

## Architecture in one sentence

A modular TypeScript web application backed by PostgreSQL and private object storage, with strict role/scoped authorization and small provider adapters for payments and notifications.

## Primary modules

- Public website and CMS
- Authentication and guardian/student linking
- Student admissions
- Job vacancies and applications
- Fee schedules, invoices, payments, receipts, refunds, and reconciliation
- Results and report publication
- Class timetables and exam date sheets
- Notices and notifications
- Staff operations, configuration, support, and audit

The project deliberately avoids microservices and unrelated school-management features until a verified requirement exists. Campus environment monitoring is retained as an isolated optional demonstrator and is not part of the core launch scope.
