# ADR-001: Durable business data with a reconciled Notion operations mirror

**Status:** Proposed

## Decision

Use Supabase Postgres as the future durable application database. Keep Notion as the human-readable operations workspace, not the transactional application database. Google Calendar remains the scheduling system for confirmed events; Resend remains the email delivery provider.

Do not provision Supabase or change the current runtime in this decision. The current direct Notion lead flow remains in place until the migration stages below are approved and implemented.

## Why this is the right next step

Notion is working well for the current small workflow, but it is not designed to be the durable transactional store for customer identity, concurrent booking decisions, retries, audit records, or a future customer portal. Postgres supplies relational integrity, durable writes, indexes, transactions, and a clean application API. Supabase is recommended because it provides managed Postgres, migrations, server-side access controls, and a straightforward fit with the existing Vercel/Node deployment.

Other viable choices are Neon Postgres and Vercel Postgres. They solve the database portion, but would require separately assembling more of the operational tooling. Supabase is the preferred path provided its region, pricing, access controls, and backup policy are accepted before provisioning.

## Customer-information guarantee

The target guarantee is: **no accepted customer information is lost, and Notion is a continuously reconciled operational mirror.**

It is not technically honest to promise an instantaneous Notion update during a Notion outage. Instead, every accepted application write must create a durable outbox record in the same database transaction. A worker delivers that record to Notion using stable external IDs and idempotent upserts. Failures are retried with bounded backoff; an unresolved item is visible to the owner and a reconciliation process repairs drift. A record is never silently discarded.

For workflow phases that require Notion to be current before an action may proceed, the API must wait for the Notion write and fail safely if it cannot be confirmed. For other phases, the application may succeed only after its database write and durable outbox record succeed; the response and activity ledger must declare the Notion mirror as pending. The exact rule is selected per action in implementation issues.

## Source-of-truth boundaries

| System | Owns | Does not own |
| --- | --- | --- |
| Supabase Postgres | Canonical customer, organization, lead, conversation, opportunity, booking, job, approval, activity, idempotency, and sync state | Calendar availability/event identity, email transport delivery, source code |
| Notion | Human-operable customer/lead/job views derived from canonical records | Canonical transactional state after migration |
| Google Calendar | Confirmed schedule event and availability | CRM/customer history, quote or payment state |
| Resend | Email transport outcome and provider message ID | Customer record or business workflow state |
| GitHub | Source code, issues, and engineering history | Customer and operations records |

Calendar event IDs and Resend provider IDs are stored in the canonical database and mirrored to Notion only where useful to operations. Calendar availability must still be rechecked immediately before creating a confirmed event.

## Canonical model

All primary identifiers are UUIDs. Every mutable table has `created_at`, `updated_at`, `created_by`, `updated_by`, and an optimistic-concurrency/version field where a user or worker may edit it. External references are unique where present.

| Entity | Key fields and lifecycle |
| --- | --- |
| Organization | Name, service location(s), contacts; optional for an individual customer |
| Customer | Organization link, name, email, phone, normalized contact keys, consent/preferences, Notion page ID |
| Lead | Customer and organization links, source, service location, request details, `new → qualified → scheduling → scheduled → closed/lost`, Notion page ID |
| Opportunity | Lead link, requested scope, qualification, owner, pipeline status; no invented price or commitment |
| Conversation / Session | Customer/lead link, channel, consent, message references and summary; never hidden model reasoning |
| Booking | Lead/customer link, requested and confirmed time, IANA timezone, Calendar event ID, status, idempotency key |
| Job | Booking link, service execution status, owner brief, completion record |
| Quote / Invoice / Payment | Links to the relevant entity, amounts/currency/statuses and provider IDs; introduced only in separately approved work |
| Approval / Exception | Requested action, policy basis, approver, decision, timestamps, immutable decision record |
| Activity ledger | Actor type, action, target IDs, safe metadata, correlation ID, outcome; append-only |
| Integration outbox | Event type, aggregate ID/version, destination, idempotency key, attempt count, next attempt, terminal status |
| Notion mirror | Canonical entity ID, Notion page ID, source version, last synchronized time/status/error class |

Email addresses and phone numbers are sensitive fields. Store normalized values only when needed for deduplication and protect raw values under database access controls. Do not store API keys, provider request bodies, hidden prompts, chain-of-thought, or unnecessary payment-card data.

## Write and synchronization flow

1. Validate the request and require an idempotency key for any externally visible create/update action.
2. In one database transaction, update the canonical entity, append the activity event, and insert an outbox item for Notion when its operational view changes.
3. Commit once. Retried requests with the same key return the prior result and do not create duplicate leads, bookings, emails, or Notion pages.
4. A worker processes the outbox. It creates or updates the Notion page by canonical external ID, records the returned page ID/version, and marks the outbox item delivered.
5. Temporary Notion failures retry with exponential backoff and a bounded attempt policy. Permanent/schema failures enter `needs_attention`, alert the owner, and retain enough safe diagnostic metadata to repair the mapping.
6. A scheduled reconciler compares canonical versions with Notion mirror versions and re-enqueues missing or stale records. It never overwrites canonical state from Notion automatically.

Notion edits made by an operator are permitted only in fields explicitly designated as operator-owned. Other Notion edits are treated as display/view changes unless an approved inbound-sync workflow is added. This avoids accidental overwrites and ambiguity about which system owns a field.

## Migration stages

1. **Architecture approval:** approve this ADR and decide the operator-owned Notion fields and acceptable mirror lag/alert threshold.
2. **Foundation:** provision Supabase only with owner approval; add migrations, server-only credentials, database backups, and an outbox/ledger schema. No production traffic moves yet.
3. **Shadow mirror:** keep the current Notion-first lead path while writing approved test/shadow records through the database integration. Reconcile and measure drift without using production customer submissions as tests.
4. **Lead cutover:** make Postgres canonical for new leads; deliver Notion pages through the outbox. Maintain the existing customer response shape and visible booking flow.
5. **Booking cutover:** preserve the immediate Calendar availability recheck, Calendar rollback if Notion-required persistence fails, and current timezone serialization. Store the confirmed booking and integration references canonically.
6. **Operations expansion:** add conversations, approvals, jobs, quotes, invoices, and payments only as separate scoped issues.

Each stage requires a rollback path: disable the new writer, retain the immutable activity/outbox records, reconcile outstanding Notion items, and return to the last approved workflow. No bulk migration or destructive deletion occurs without owner approval.

## Security, privacy, and retention

- Use server-only service access; never expose database credentials in browser code.
- Apply least-privilege roles and row-level security before any customer-facing read path exists.
- Encrypt in transit, retain backups, and test restoration before declaring the database operational.
- Separate PII from event metadata where practical; redact logs and error records.
- Define retention/deletion rules with the owner before collecting conversations, invoices, or payment data.
- Record only approved model inputs/outputs needed for operations; never store hidden reasoning.

## Follow-up work packets

1. Provisioning decision and security baseline for Supabase (owner approval required).
2. Canonical schema, migrations, and database access layer.
3. Outbox worker, Notion mapper, retry/alert policy, and reconciliation report.
4. Lead-flow migration with idempotency and Notion mirror verification.
5. Booking-flow migration preserving Calendar and timezone/rollback semantics.
6. Customer/operations activity ledger and approval queue.
