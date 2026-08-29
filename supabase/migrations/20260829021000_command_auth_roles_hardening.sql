-- Hardening follow-up for command_auth_roles. This table is a trusted
-- authorization record, not a browser-accessible resource.

revoke all on function public.handle_new_command_user() from anon, authenticated;

create policy "No direct command role access"
  on public.command_roles
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create index command_roles_assigned_by_idx
  on public.command_roles (assigned_by)
  where assigned_by is not null;
