# Command jobs and scheduling

## Scope and source of truth

This Issue #26 slice prepares a canonical, private schema and a fixture-only Command experience for walkthroughs and service visits. It neither applies SQL nor reads/writes a connected Supabase project. It does not create a Google Calendar client, worker, webhook, API writer, or real job record. Google Calendar remains scheduling authority until an owner approves a narrowly scoped reconciliation/cutover design.

## Canonical model

- `jobs` is the operational aggregate. It requires a customer or organization. When both are supplied, the customer must belong to that organization even without a service location; any supplied service location is separately required to match both owners.
- `kind` is `walkthrough` or `service_visit`. `status` is `draft → scheduled → en_route → in_progress → completed`, with `cancelled` as a terminal exception. A future operations API must prevent invalid transitions and append `activity_events`; this migration intentionally avoids policy invention or an unsafe database-side transition API.
- Appointment instants use only `scheduled_start_at`/`scheduled_end_at` (`timestamptz`) and retain the communication timezone in `scheduled_timezone`, validated against installed IANA data. Scheduled, en-route, in-progress, and completed jobs require a schedule. Completion and cancellation carry their own audit timestamps. Calendar remains responsible for detecting schedule conflicts and overlap; this migration deliberately does not impose an overlap policy.
- `job_assignments` points to the existing `actors` table for lead, technician, or observer planning. It is not authorization; trusted app metadata and `command_roles` remain the authorization boundary.
- `job_notes` captures internal, completion, and exception notes as append-only records. The existing `activity_events` ledger remains the audit surface for meaningful actions and approval decisions.
- `service_details` is structured JSON for approved future service fields. It must not contain secrets, raw provider payloads, or hidden reasoning.
- `source_system`, `source_record_id`, `calendar_event_id`, `correlation_id`, and idempotency keys form the future reconciliation seam. A non-null `source_record_id` is unique within its `source_system`, preventing duplicate canonical jobs during a future Calendar or Notion reconciliation. `calendar_event_id` is a unique placeholder only: no Calendar read, write, or promise is made here.

## Access boundary

All new tables use RLS, revoke every `anon` and `authenticated` privilege, and include restrictive deny policies. The Command browser cannot query or mutate them. Future server-only endpoints must authenticate the actor, authorize with trusted app metadata/`command_roles` (never editable user metadata), enforce expected version and idempotency, write safe activity events, and enqueue any Calendar work in `integration_outbox` atomically. Reschedule/cancel behavior remains Yellow until the owner approves the operational policy; no UI control attempts either action.

## Fixture-only Command views

The Schedule and Jobs sections use invented sample records only. They show filterable upcoming/scheduled/completed/cancelled states, a calendar-style week strip, active state treatment, a static job-detail sheet, service details, assignments, notes, and a clear prototype notice. The sheet's buttons only explain the future approval boundary; they do not make a request or touch an API.

## Controlled operational editing (Issue #60)

The first live Command write slice is deliberately narrower than the schema. Authenticated Owner and Admin users may edit a job title and move a currently scheduled job forward to `en_route`, `in_progress`, or `completed` (with a completion timestamp). Draft jobs may receive title-only corrections. Operator is read-only and Technician has no Command data access. Every request is server-only, strictly allowlisted, expected-version checked, attributed to the authenticated human actor, and appended to `activity_events`. If appending the audit event fails, the job write is compensated with an expected-version rollback; a failed rollback is surfaced as a partial-mutation failure rather than being hidden.

Calendar-backed scheduling fields (`scheduled_start_at`, `scheduled_end_at`, `scheduled_timezone`, `calendar_event_id`), source/reconciliation fields, assignments, notes, and cancellation are not editable in this slice. Rescheduling or cancelling a Calendar-backed booking requires a separately approved synchronization and rollback design.

## Validation

Run `npm test`, `npm run check`, and `git diff --check`. With an owner-approved clean local database only, apply migrations in timestamp order and run `supabase test db --file supabase/tests/jobs_scheduling_command.sql`. Do not use a connected Supabase project for this feature.

## Calendar operation receipts (Issue #29 prerequisite)

Calendar reschedule and cancellation remain unavailable to Command. The prepared-only receipt migration adds a private `job_operation_receipts` table, uniquely keyed by `(job_id, idempotency_key)`. It records the requested `reschedule` or `cancel` operation, authenticated server actor, correlation ID, expected job version, safe metadata, timestamps, and one of `calendar_pending`, `succeeded`, or `reconciliation_needed`.

Only two security-invoker functions are executable by `service_role`: reserve an operation (including its immutable activity event) and finish it as succeeded or reconciliation-needed (including its activity event). Matching retries return the original receipt; a changed operation, actor, correlation ID, version, or metadata under the same key fails closed. A Calendar rollback failure must use `reconciliation_needed`; it is durable, timestamped, error-coded, and queued for human reconciliation. No browser role can call the table or functions directly, and no Calendar mutation or worker is introduced.

Validate this prerequisite on a clean local database with `supabase test db --file supabase/tests/calendar_operation_receipts.sql`, in addition to the existing suite. Production application, any Calendar worker, and a reschedule/cancel endpoint all require separate owner approval.

## Application and forward-only rollback

Before any application, the owner must approve the exact migration head, target, backup/restore posture, and maintenance window; verify no writers or Calendar sync worker exists; apply once to a clean non-Production target; then run the pgTAP suite and read-only schema/RLS/grant/index checks. A later live rollout must be separately approved and add only narrow server-side operations with reconciliation and activity logging.

Rollback is forward-only: immediately disable any future writer/worker, preserve jobs, notes, assignments, activity events, and outbox evidence, and return the application to the existing Calendar/Notion flow. Correct defects with a reviewed follow-up migration; never drop tables or delete job/audit data as a production rollback shortcut.
