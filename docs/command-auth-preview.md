# Command authentication — Preview setup

This PR is fail-closed. Until the two Preview values below exist, `/command/` returns a configuration error and nobody can enter the prototype.

## Preview-only environment values

- `SUPABASE_URL` — the Project URL.
- `SUPABASE_PUBLISHABLE_KEY` — an active publishable key only. Never use a service-role, secret, management token, or key in source control.

Set these only for **Preview**.

## Invited Owner/Admin test flow

The auth foundation is applied to the existing Zero Trace Solutions Supabase project. It includes only `profiles`, `command_roles`, the role enum, RLS policies, and the new-Auth-user profile trigger—no customer, job, booking, or operational tables.

1. In **Authentication → URL Configuration**, add this exact Redirect URL:
   `https://zero-trace-solutions-git-feat-c-190042-eric2busy-5760s-projects.vercel.app/command/login/`
2. Make sure that Preview deployment has finished before inviting anyone.
3. In **Authentication → Users**, select **Add user → Send invitation** and invite the intended account. Do not send a general registration link.
4. Before the recipient opens the email link, use **SQL Editor** to grant the role in both approved stores. Replace the email literal and choose either `owner` or `admin`:

```sql
with selected_user as (
  update auth.users
  set raw_app_meta_data =
    coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('command_role', 'owner')
  where email = 'REPLACE_WITH_INVITED_EMAIL'
  returning id
)
insert into public.command_roles (user_id, role, assigned_by)
select id, 'owner'::public.command_role, null
from selected_user
on conflict (user_id) do update
set role = excluded.role, assigned_at = now(), assigned_by = null;
```

5. Confirm the provisioning only with:

```sql
select u.email, u.raw_app_meta_data ->> 'command_role' as app_role, r.role
from auth.users u
join public.command_roles r on r.user_id = u.id
where u.email = 'REPLACE_WITH_INVITED_EMAIL';
```

6. The recipient opens the invite link. It lands at Preview `/command/login/`, removes the one-time token fragment from browser history, lets the recipient set a 12+ character password, then exchanges the temporary tokens for Secure, HttpOnly session cookies.
7. Verify sign in, sign out, a new browser session, and that a user without an allowed `app_metadata.command_role` is redirected or denied.

Never place a role in `user_metadata`; a user can edit it. The interactive UI permits only `owner`, `admin`, `operator`, and `technician`. `ai_service` is intentionally denied interactive login.

## Boundaries

- Security advisor: clean after the applied auth DDL hardening.
- Performance advisor: only the expected informational unused-index notice while `command_roles` is empty.
- No production application deploy or merge is authorized by this document.
