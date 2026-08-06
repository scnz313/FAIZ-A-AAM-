# Faiz Aam School Platform

This repository is the design and engineering foundation for an integrated school website, applicant centre, family/student portal, and staff workspace.

## Read before implementation

1. [`AGENTS.md`](AGENTS.md) — persistent instructions for every AI agent and developer.
2. [`PROJECT-BLUEPRINT.md`](PROJECT-BLUEPRINT.md) — canonical feature, workflow, architecture, data, security, test, and delivery plan.
3. [`PROJECT-STATUS.md`](PROJECT-STATUS.md) — current implementation truth, blockers, and next phase.
4. [`FEATURE-INTEGRATION-SPEC.md`](FEATURE-INTEGRATION-SPEC.md) — detailed user relationships, shared context, feature connections, synchronization, and integration tests.
5. [`UI-COMPLETION-PLAN.md`](UI-COMPLETION-PLAN.md) — active frontend integration sequence and acceptance criteria.
6. [`plan.md`](plan.md) — ordered execution plan for the current completion phases (pointer index only).
7. [`design/UX-BLUEPRINT.md`](design/UX-BLUEPRINT.md) — visual and interaction direction.

## Current state

The repository contains a broad, validated frontend prototype for the public site, applicant journeys, family portal, and staff workspace, plus an optional campus-environment demonstrator excluded from core navigation and launch checks. The active phase is **frontend completion and integration per `plan.md`**: role/scope authorization, workflow integrity, cross-module event propagation, contract freeze, and the full handoff gate — all with deterministic demo adapters. The shared guardian/student context spine, service boundaries, admission→fee→enrollment conversion, and staff role scoping are implemented and tested; the canonical grant model (maker/checker splits), remaining workflow repairs, and the contract freeze are in progress. No backend, database, real authorization, or production deployment exists. See `PROJECT-STATUS.md` for evidence, `plan.md` for the ordered execution plan, and `FEATURE-INTEGRATION-SPEC.md` for the target behavior.

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
