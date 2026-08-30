# Command Calendar reschedule/cancel synchronization contract

## Decision and non-goals

Google Calendar is the scheduling authority for a Calendar-backed job. Command
may request a reschedule or cancellation only through a server-only operation;
it never writes provider fields directly from the browser. This contract covers
one job at a time. It does not change website booking, Notion, Resend, roles,
or migrate existing records.

Only authenticated `owner` and `admin` roles may invoke the operation.
`operator` is read-only and `technician` is denied. The server resolves the
human actor from `actors.auth_user_id`; no browser-supplied actor, provider
credential, or Supabase service credential is accepted.

## Request and validation

The browser submits an opaque idempotency key, job UUID, expected job version,
operation (`reschedule` or `cancel`), and, for a reschedule, start, end, and
IANA timezone. The server validates a canonical RFC 3339 instant, a known IANA
zone, `end > start`, and that rendering each instant in the supplied zone is
the requested local appointment. It rejects a missing `calendar_event_id`, a
non-scheduled job, stale version, malformed request, or conflicting idempotency
record before a provider call.

Before updating an event, the server reads the Calendar event and checks
availability with the requested interval (excluding the same event) and the
configured buffer. It retains a minimal rollback snapshot: event id, prior
start/end/timezone, and cancellation state. Raw provider payloads and customer
details are never stored in activity metadata or logs.

## Durable operation receipt (required)

Each operation needs a server-only durable receipt keyed uniquely by
`(job_id, idempotency_key)`, with the expected version, requested operation,
correlation ID, provider event ID, provider-before snapshot, state, and safe
error code. A receipt is created/claimed before Calendar mutation. Reusing the
same key returns the saved terminal result; the same key with different intent
is rejected. This prevents duplicate Calendar calls and duplicate job/audit
mutations across retries and process loss.

The current schema does not provide this. `jobs.idempotency_key` belongs to the
source-record creation seam, `activity_events.idempotency_key` is not unique,
and `integration_outbox` has neither a job-operation receipt nor an atomic
Calendar/Job/Audit transaction. A narrow approved migration and transactional
server operation are therefore prerequisites; no live mutation is implemented
on this branch.

## Ordering, compensation, and final states

1. Authenticate/authorize, validate, atomically claim the receipt, and read
   the expected job version.
2. Read/validate Calendar availability, then update (reschedule) or cancel
   (cancellation) the Calendar event with a provider request identity.
3. Atomically write the canonical job with the expected version, append an
   `activity_events` entry with actor and correlation IDs, and complete the
   receipt. Reschedule retains `scheduled`; cancellation sets `status` to
   `cancelled` and `cancelled_at` together, preserving calendar identity.
4. If step 3 fails after Calendar succeeds, restore the provider snapshot.
   On successful restore, record a safe failed receipt and return a recoverable
   provider/sync failure. On rollback failure, record `reconciliation_needed`,
   a safe error code and correlation ID, return a loud 502/409-style response,
   and do not claim success.

All audit entries use the authenticated human actor, `target_type: job`, an
operation-specific action, correlation ID, outcome, and non-PII metadata such
as operation and version. The UI never reports success until the canonical
job, audit event, and receipt are durable.

## UI behavior

The mobile-first job sheet exposes Reschedule and Cancel only for Owner/Admin
and Calendar-backed scheduled jobs. Both start with a confirmation. Reschedule
shows time/timezone validation and availability conflicts. While saving,
controls are disabled. It has distinct messages for conflict, Calendar failure
before canonical mutation, canonical/audit failure with successful rollback,
and a reconciliation-required warning containing a support-safe correlation ID.
Operator remains read-only; Technician receives no data/control.

## Required verification after the prerequisite is approved

- role enforcement; malformed time/timezone; stale job version; and
  availability conflict;
- Calendar failure before any Supabase write;
- Supabase/audit failure after Calendar success with provider rollback;
- rollback failure yields `reconciliation_needed` with no PII;
- same idempotency key retries return the original result with no duplicate
  Calendar event/job mutation/audit entry;
- audit attribution and correlation ID persist; cancellation satisfies
  `status=cancelled` plus `cancelled_at`;
- mocked/synthetic Preview-only tests, `npm test`, `npm run check`, and
  `git diff --check`.

## Forward-only rollback

Disable the operation endpoint/feature flag. Preserve job, receipt, activity,
and reconciliation evidence. Do not delete records or silently change Calendar
authority; resolve any `reconciliation_needed` receipt manually against
Calendar before re-enabling the writer.
