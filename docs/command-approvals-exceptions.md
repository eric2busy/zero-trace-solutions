# Command Approval & Exceptions Center

Status: prepared repository foundation for Issue #27. No Supabase migration has been applied and no live approval action is connected.

## Purpose

The Approval Center is the owner-control boundary for consequential Yellow actions. Green work may continue only where company policy already allows it. Red actions remain prohibited or human-only. A Yellow action must stop until the exact action, target, and payload have a valid approval that can be verified server-side.

## Record model

The existing `approvals` table is the current-state request record. It captures requester identity, action and target, Yellow authority level, policy basis, rationale, proposed payload summary, correlation/idempotency identity, optional expiry, and terminal status.

Issue #27 adds `approval_decisions` as an append-only terminal receipt. Each approval can have exactly one terminal decision receipt. The receipt records the deciding actor, approved/rejected/modified/expired/cancelled decision, authority basis, owner-facing rationale, effective payload summary, and correlation identity. Historical receipts cannot be edited or deleted; a changed decision requires a new approval request. A database insert guard rejects any decision receipt whose terminal state, deciding actor, or correlation identity contradicts the approval record.

## Fail-closed execution seam

`command_approval_allows_action(...)` is a prepared server-only validation seam. It returns true only when all of these are true:

- the approval exists and is Yellow;
- status is `approved` or `modified`;
- action type matches exactly;
- target type and target id match exactly;
- the caller supplies an object payload summary;
- for `approved`, that payload exactly matches the original proposed payload summary;
- for `modified`, that payload exactly matches the immutable decision receipt's effective payload summary;
- the approval has not expired;
- an immutable decision receipt exists;
- the receipt decision, deciding actor, and correlation id match the approval projection.

The function does not execute anything. Browser roles are denied access to the underlying records and helper. A future operations API must perform authorization separately using trusted `app_metadata` / `command_roles`, derive the summary from the exact action it intends to execute, call the validation seam, execute at most that verified payload, and append an `activity_events` receipt.

Missing, expired, cancelled, rejected, mismatched, payload-divergent, or unverifiable approvals fail closed.

## Modify semantics

`modified` is a terminal approval decision for a narrowed or changed effective payload. The original proposal is not authorized. The validation seam accepts a modified approval only when the proposed execution summary exactly matches the decision receipt's effective payload summary. This prevents a later executor from treating a modified approval as authorization for the original proposal.

## Expiry and cancellation

Expiry and cancellation are terminal states. They do not authorize execution. If an action is still needed after expiry/cancellation, create a new approval request with a new idempotency identity rather than reopening or rewriting the historical request.

No automatic expiry worker is introduced by this milestone. A future reviewed worker may mark expired records and append its decision/activity receipt under a tightly scoped service identity.

## Command UI

`/command/approvals.html` is a fixture-only mobile-first Approval Center Preview. It demonstrates:

- Pending, Decided, and Expired views;
- actor identity and request age/expiry;
- authority basis and exact target;
- proposed action summary and blocked external-effect state;
- Approve, Modify, Reject interaction;
- owner rationale capture;
- immutable-decision receipt presentation.

All interactions are local DOM changes. The page contains no Supabase client, API call, Calendar connection, Notion write, email send, or customer data.

## Production/application boundary

This milestone prepares repository artifacts only. Do not apply `20260830022000_approvals_exceptions_command.sql` to Supabase Production without separate explicit owner approval. Do not connect Approval Center buttons to live actions until a separately reviewed server-only operations API exists.

Because `main` currently triggers Vercel Production, merging the PR is itself the Production release gate and requires exact-head owner approval under the repository contract.

## Verification

Repository checks:

- `npm test`
- `npm run check`
- `git diff --check`

Database behavior when a permitted local PostgreSQL/Supabase runtime is available:

- apply migrations through `20260830022000_approvals_exceptions_command.sql` to a disposable local database;
- run `supabase/tests/approvals_exceptions_command.sql` with pgTAP;
- confirm matching approved action/target/payload validates true;
- confirm modified approvals validate only the owner-selected effective payload;
- confirm mismatched action/target/payload, expired/rejected/cancelled/missing approvals validate false;
- confirm contradictory decision insert, receipt update/delete, and duplicate terminal receipt attempts fail.

## Rollback posture

Before Production application, rollback is deleting/revising the prepared migration in a reviewed PR. After any future Production application, use a reviewed forward migration. Do not drop audit/decision evidence once real approval records exist.
