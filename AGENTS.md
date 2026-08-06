# AI Project Instructions — Faiz Aam School Platform

This file applies to the entire repository. Every AI agent or developer must follow it before planning, editing, testing, or deploying this project.

## Mandatory reading order

Before making any project change, read:

1. `PROJECT-BLUEPRINT.md` — canonical product scope, architecture, workflows, data model, permissions, quality gates, and delivery order.
2. `PROJECT-STATUS.md` — current implementation state, completed work, active phase, blockers, and unresolved decisions.
3. `FEATURE-INTEGRATION-SPEC.md` — canonical detailed relationships, role/scope rules, active student context, cross-module synchronization, feature contracts, and required integration tests.
4. `UI-COMPLETION-PLAN.md` — current frontend integration sequence, route-level acceptance criteria, and backend handoff gate.
5. `design/UX-BLUEPRINT.md` — visual direction, component map, and user-experience rules for relevant UI work.
6. `design/RESEARCH-NOTES.md` — regulatory and implementation research when working on payments, privacy, disclosure, accessibility, authentication, or uploads.

Do not begin implementation from a user prompt alone. Reconcile the request with these files first.

## Source-of-truth precedence

When instructions disagree, use this order:

1. The user’s latest explicit instruction.
2. `PROJECT-BLUEPRINT.md`.
3. `FEATURE-INTEGRATION-SPEC.md` for detailed feature, relationship, context, and synchronization behavior.
4. `PROJECT-STATUS.md` for facts about what is currently implemented.
5. `UI-COMPLETION-PLAN.md` for the active frontend sequence and acceptance criteria.
6. `design/UX-BLUEPRINT.md` for visual and interaction decisions.
7. Existing code and tests.

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
