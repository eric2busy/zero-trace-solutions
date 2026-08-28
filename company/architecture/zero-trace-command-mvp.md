# Zero Trace Command — MVP Architecture and Product Contract

**Status:** Proposed for owner review  
**Parent:** Issue #22  
**Depends on:** ADR-001 / Issue #7  
**Related:** Issue #10 Operations Automation v1

## Purpose

Zero Trace Command is the private owner/operator control center for Zero Trace Solutions. It is not a replacement for the public customer website. It is the operational interface used by the owner and authorized AI workers to understand the business, act on routine work, request approvals for consequential work, and maintain a complete audit trail.

The design goal is exception-based operations: the owner should spend time on service delivery and consequential decisions, not routine administration.

## Architectural principles

1. **Supabase Postgres is canonical business state.** Follow ADR-001. Notion remains a human-readable operational mirror and task/documentation workspace.
2. **Command is an interface, not a second database.** It reads and writes through the application service layer against canonical records.
3. **AI agents never receive unrestricted database authority.** Agents use narrow, named business tools with scoped permissions and explicit authority levels.
4. **Consequential actions are approval-gated.** Yellow actions create approval requests; Red actions are prohibited or require a separate owner-controlled process.
5. **Every meaningful mutation is auditable.** Record actor, action, target, correlation ID, safe metadata, outcome, and approval reference when applicable. Never store hidden chain-of-thought.
6. **Migration is incremental.** Existing lead, booking, Notion, Calendar, email, concierge, and public website behavior remain stable until each cutover is independently verified.
7. **Mobile first.** The owner must be able to operate the business from a phone without relying on desktop-only workflows.

## System boundaries

| System | Primary responsibility |
| --- | --- |
| Supabase Postgres | Canonical customers, organizations, leads, opportunities, conversations, bookings, jobs, quotes, invoices, payments, approvals, AI activity, sync state |
| Zero Trace Command | Private operational UX and owner approval surface |
| Public website | Customer acquisition, concierge, lead capture, booking |
| Notion | Human-readable operations mirror, task tracker, documentation |
| Google Calendar | Availability and confirmed schedule events |
| Resend | Transactional email transport |
| GitHub | Engineering source of truth, issues, PRs, release history |
| Vercel | Application/API runtime and deployments |

## MVP information architecture

### 1. Today

The default landing surface answers: **What needs my attention right now?**

Show:
- today's walkthroughs and jobs;
- upcoming schedule within a short horizon;
- approvals awaiting owner action;
- failed or delayed integrations requiring intervention;
- follow-ups due;
- high-priority new leads;
- concise operational metrics relevant to the current day.

Do not overload the home screen with historical analytics.

### 2. Schedule

Mobile-friendly calendar/list hybrid for walkthroughs and jobs.

Each scheduled item should expose:
- customer and organization;
- service location;
- confirmed time and timezone;
- job/walkthrough status;
- request/scope summary;
- contact details;
- flags/restrictions;
- linked Google Calendar event;
- owner job brief;
- reschedule/cancel controls subject to authority rules.

Google Calendar remains the external schedule surface during migration. Calendar event IDs are stored canonically.

### 3. Leads / Customers

Provide a unified operational record rather than separate disconnected views.

Customer detail should eventually include:
- identity and organization;
- contact methods and consent/preferences;
- lead source and qualification;
- conversation history;
- walkthroughs and bookings;
- jobs and completion history;
- quotes, invoices, payments when introduced;
- approvals/exceptions;
- safe activity timeline;
- Notion mirror status.

### 4. Jobs

Jobs represent service execution after a confirmed booking/walkthrough transition.

MVP job record:
- customer/site;
- linked booking;
- requested scope;
- owner brief;
- status;
- scheduled time;
- completion status;
- owner notes;
- follow-up required flag;
- exception/incident flags;
- recurring opportunity flag.

### 5. Approvals

Approvals are first-class canonical records, not chat messages.

Required fields:
- requested action type;
- requester actor/agent;
- target entity IDs;
- plain-language rationale;
- policy/authority basis;
- safe proposed payload summary;
- consequence level;
- requested_at / decided_at;
- approver;
- decision: approved / rejected / modified / expired / cancelled;
- optional owner modification;
- immutable decision event.

Command must support **Approve, Reject, Modify**. Approval does not erase the original request.

### 6. AI Activity

Human-readable audit feed showing meaningful agent actions and system outcomes.

Record:
- agent/actor identity;
- action name;
- target record(s);
- timestamp;
- correlation ID;
- authority class;
- approval reference if any;
- status/outcome;
- safe error class when failed.

Do not expose or persist hidden reasoning, secrets, raw provider payloads, or unnecessary customer PII.

### 7. System Health

Owner-focused integration health, not developer telemetry noise.

Surface:
- Vercel/runtime failures that affect business flows;
- transactional email delivery failures;
- Notion mirror backlog/drift;
- Calendar sync failures;
- Supabase migration/schema health once active;
- stale automation jobs;
- approval queue backlog;
- last successful reconciliation timestamps.

## Navigation

Mobile bottom navigation for the highest-frequency surfaces:

- Today
- Schedule
- Customers
- Jobs
- More

`More` contains Approvals, AI Activity, System Health, Business Metrics, Settings/Access.

On desktop, the same hierarchy can become a persistent left rail. Do not create separate mobile and desktop information architectures.

## Authentication and roles

### Owner

Full business-level access, including approval decisions and operator-owned edits. Production deployment, destructive database work, credential changes, refunds/financial commitments, and policy changes remain separately consequential even when initiated from Command.

### AI Worker

No interactive owner UI account is assumed by default. Agents access a server-side tool/API layer with scoped service identity and explicit permissions.

### Future Staff

Design for future roles but do not build role complexity before required. Likely future scopes: scheduler/operator, technician, finance/admin, read-only auditor.

## AI authority model

### Green — autonomous routine actions

Examples when policy and preconditions are explicit:
- read customer/job/schedule information;
- prepare owner job brief;
- update non-consequential workflow status;
- send approved-template routine reminders;
- create follow-up tasks;
- reconcile Notion mirror state;
- log activity and health events.

Every Green mutation is still audited and idempotent.

### Yellow — owner approval required

Examples:
- unusual or policy-sensitive customer communication;
- pricing/discount exceptions;
- refunds or financial commitments;
- schedule changes outside defined self-service policy;
- cancellation exceptions;
- destructive or irreversible record changes;
- changes affecting customer promises, policy, or material business risk.

AI creates an Approval record and stops. Execution requires a valid approved decision tied to the proposed action/version.

### Red — prohibited/high-risk

Examples:
- exposing secrets;
- bypassing owner approval controls;
- deleting audit history;
- silently changing company policy;
- destructive production database operations without a separately approved migration/rollback plan;
- impersonating owner authorization.

## Agent operations API pattern

Agents should call narrow business functions rather than SQL or generic database mutation tools.

Initial candidate contracts:
- `get_customer(customer_id)`
- `search_customers(query)`
- `get_schedule(range)`
- `get_job(job_id)`
- `prepare_job_brief(job_id)`
- `create_followup(target_id, type, due_at)`
- `update_job_status(job_id, expected_version, status)`
- `prepare_quote(opportunity_id, scope)`
- `request_approval(action_type, target_ids, proposed_payload_summary)`
- `execute_approved_action(approval_id)`
- `record_completion(job_id, completion_payload)`

Requirements for every mutating tool:
- authenticated actor identity;
- authorization check;
- authority classification;
- idempotency key;
- expected version / conflict handling where applicable;
- activity ledger event;
- approval reference for Yellow actions;
- safe structured error response.

## Data and synchronization rules

Follow ADR-001's canonical write + activity + outbox pattern.

For business mutations after database cutover:
1. validate request and authority;
2. write canonical entity + activity + required outbox events atomically;
3. commit once;
4. deliver Notion/Calendar/email integration effects idempotently;
5. record provider references and outcomes;
6. surface unresolved integration failures in System Health/Today;
7. reconcile drift without silently overwriting canonical state.

## Implementation sequence

### Phase 0 — Command product contract

This document and follow-up issues. No runtime changes.

### Phase 1 — Canonical data/security foundation

- schema migrations in-repo;
- actor/activity/approval/outbox primitives;
- RLS/service-role boundaries;
- migration rollback plan;
- no production traffic cutover until separately approved.

### Phase 2 — Private authenticated Command shell

- owner auth;
- `/command` private route/app shell;
- Today/Schedule/Customers/Jobs/More navigation;
- read-only fixture or safe development data initially.

### Phase 3 — Core operational records

- customer/company/lead read model;
- booking/job views;
- approval center;
- AI activity feed;
- system health feed.

### Phase 4 — Controlled integration migration

- new lead canonical write + Notion mirror;
- booking canonical write preserving Calendar semantics;
- conversation/session migration;
- email provider references and observability.

Migrate one workflow at a time with rollback.

### Phase 5 — AI operations tools

- scoped agent identities;
- Green tools;
- Yellow approval request/execution flow;
- policy tests and audit verification.

### Phase 6 — Operations Automation v1

Implement Issue #10 through Command and canonical records: reminders, owner briefs, reschedule/cancel, completion capture, post-service follow-up.

### Phase 7 — Business metrics and finance expansion

Introduce quotes/invoices/payments and richer KPIs only through separate approved work.

## First Supabase mutation proposed for later approval

Do **not** execute yet.

The safest first migration should create only foundational tables and policies needed by later work, with no current production flow redirected:
- `actors`
- `activity_events`
- `approvals`
- `integration_outbox`
- migration metadata/versioning as required by the chosen migration framework

Before execution, the PR must include:
- forward migration;
- explicit rollback migration or documented safe reversal;
- RLS/service access policy;
- indexes/constraints;
- idempotency/correlation identifiers;
- no browser-exposed service credentials;
- verification SQL/tests;
- confirmation that no existing production traffic reads/writes these tables yet.

The owner must separately approve applying that migration to the connected Supabase project.

## Release and approval boundary

Command development follows the owner-controlled release gate:
- workers may branch, implement, test, open PRs, and produce Vercel Previews;
- owner approval is required before merge;
- merging to `main` is treated as authorization for the repository's automatic Vercel Production deployment when that integration is enabled;
- Supabase migrations, secrets/config changes, destructive actions, live-data migration, and consequential business actions require explicit approval at the action boundary.
