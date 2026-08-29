# Command authentication — Preview setup

This PR is fail-closed. Until the two Preview values below exist, `/command/` returns a configuration error and nobody can enter the prototype.

## Preview-only environment values

- `SUPABASE_URL` — the project URL.
- `SUPABASE_PUBLISHABLE_KEY` — an active publishable key only. Never use a service-role, secret, management token, or key in source control.

Set these only for **Preview**.

## Invite-only Owner/Admin provisioning

1. Disable new-user signups in Supabase Auth settings; add the approved Preview redirect URL.
2. Invite the initial Owner/Admin through the Supabase dashboard. Do not add an open registration path.
3. In the trusted provisioning action, set `command_role` in `auth.users.raw_app_meta_data` and record the matching role in `public.command_roles` after this migration is safely applied to a disposable branch.
4. Never put roles in `user_metadata`; users can edit it.

`owner`, `admin`, `operator`, and `technician` can use the interactive UI. `ai_service` is intentionally denied interactive login and must use future scoped server tools.

## Boundaries

- This migration has not been applied to production.
- It creates no customer, job, booking, or operational-data tables.
- Production schema/RLS deployment needs separate owner approval.
