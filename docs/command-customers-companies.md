# Command customers, companies, locations, and contacts

## Scope and source of truth

This prepared migration is the first CRM slice for Issue #25. It defines canonical organization, customer, contact, and service-location records only. It does not create leads, conversations, bookings, jobs, notes, payments, a sync worker, an API writer, or a production cutover. The current Notion, Google Calendar, email, website, and booking paths are unchanged.

Supabase will become the canonical store only after a separately approved application. Notion remains the readable operational mirror; Calendar remains the scheduling authority. The new `notion_page_id` fields are placeholders for a future idempotent mirror, not an active integration.

## Model

- An organization is optional; individual customers do not require one.
- A customer may belong to one organization.
- A contact belongs to exactly one customer or organization and is typed as email, phone, or other. It carries raw and normalized values so future writes can deduplicate without using mutable user metadata.
- A service location belongs to a customer, an organization, or both. It stores a business address and optional IANA timezone; it does not create or change a Calendar event.
- Each mutable entity has attribution, timestamps, and optimistic versioning through the existing touch trigger.

## Access and API boundary

All four tables enable RLS, revoke `anon` and `authenticated` grants, and have restrictive deny policies. The Command browser receives no direct table access. Future server-only, narrow operations APIs must validate the authenticated actor and role from trusted app metadata/`command_roles`, apply idempotency and expected-version checks, append an `activity_events` record, and enqueue a Notion item atomically when the mirror is introduced.

## Owner-facing Command UX

The Command Customers surface remains a polished, fixture-only mobile-first view. It supports search, succinct relationship/status/location cues, an empty state, and a clear notice that no real records or writes are connected. A record detail drawer/API is deliberately deferred until the server-side read contract, audit path, and live-data authorization are approved.

## Acceptance criteria and validation

- Schema represents customers, optional companies, typed contacts, and service locations with primary keys, attribution, timestamps, versions, and relational constraints.
- Browser roles have no grants or usable RLS policy for any new table.
- Primary contact uniqueness and common lookup indexes exist.
- Existing production flows are untouched; no seed or customer data is included.
- Static tests and pgTAP coverage assert scope, RLS, grants, policies, and indexes.

Run `npm test` and `npm run check`. When a local Postgres/Supabase environment is available, apply migrations in timestamp order to a clean database and run `supabase test db` (or the `supabase/tests/*.sql` suites). Do not use any Supabase project for this verification.

## Database application and rollback

**Code preparation (this PR):** migration, tests, documentation, and fixture-only UX only.

**Database application (separate owner approval):** verify clean local execution, approve the exact migration head and target project/window, confirm backup/restore posture and no active writers, then apply once and run read-only schema/RLS/index checks. Do not add real data during the application.

Rollback is forward-only: disable any future writer/read path, retain rows and audit evidence, and use a reviewed follow-up migration for a specific defect. Do not drop CRM tables or delete customer information as a rollback shortcut.
