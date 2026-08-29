# Command operational schema foundation

This is the Issue #23 implementation of Phase 1 in the Command architecture and ADR-001. It is a prepared, review-only migration; applying it to any Supabase project requires separate owner approval.

## Scope and boundaries

The migration creates only four control-plane primitives:

- `actors` provides durable attribution for humans, agents, and server-side integrations. It is not an authorization source; existing `command_roles` and `auth.users.raw_app_meta_data` remain authoritative.
- `activity_events` is an append-only ledger for meaningful outcomes. Database triggers reject updates and deletes.
- `approvals` represents Yellow-action requests and a single immutable decision. A matching immutable `activity_events` entry is required by the future application service when a decision is made.
- `integration_outbox` stores idempotent integration work for Notion, Google Calendar, and Resend. This migration creates no worker and sends nothing.

No customer, organization, lead, conversation, booking, job, quote, invoice, payment, Notion mirror, or runtime/API table is included. Existing auth/profile behavior, `command_roles`, website traffic, Notion, Calendar, and Resend behavior are unchanged.

## Security model

All four tables enable RLS, revoke every table privilege from `anon` and `authenticated`, and have a restrictive deny policy for authenticated browser sessions. A future server-only operations API may use a server-held service credential after its own scoped review; no browser credential, role claim, or policy is added here.

The immutable activity ledger and approval decision guard are database triggers, so a future application bug cannot silently alter audit history through ordinary SQL. New operational write paths must record safe metadata only—never secrets, raw provider payloads, or hidden model reasoning.

## Validation

Run the repository suite:

```text
npm test
npm run check
git diff --check
```

For a non-Production Supabase database after explicit owner approval to test there, apply migrations in order and execute:

```text
supabase test db --file supabase/tests/command_auth_roles_rls.sql
supabase test db --file supabase/tests/command_operational_foundation.sql
```

The foundation test confirms the four tables, primary keys, required idempotency/correlation columns, RLS, deny policies, revoked browser privileges, and critical indexes. No connected Supabase project was used for this PR.

## Rollback and recovery

The safe production rollback is forward-only: stop any future writer/worker, retain the activity and outbox records, and return the application to the existing Notion/Calendar/Resend paths. Because the tables may contain audit or pending recovery evidence, do not drop them in a Production rollback.

If the migration has been applied only to an empty, non-Production review database, an owner-approved operator may drop the four tables and six enum types in dependency order. That destructive development-only reversal is intentionally not automated in this repository. Once records exist, use a reviewed forward migration rather than deleting audit/outbox data.

## Owner decision before application

Before applying this migration, the owner must separately approve the exact target Supabase project, backup/restore posture, maintenance window if applicable, and the server-side operations API credential boundary. This PR neither grants that approval nor changes Production.
