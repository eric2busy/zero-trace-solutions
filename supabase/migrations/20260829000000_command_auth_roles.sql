-- PREPARED ONLY: do not apply this migration to the production project without
-- explicit owner approval. It establishes the least-privilege Command identity
-- foundation; operational/customer tables are deliberately out of scope.

create type public.command_role as enum ('owner', 'admin', 'operator', 'technician', 'ai_service');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trusted authorization record. It is deliberately inaccessible through the
-- browser Data API. Keep the matching JWT claim in raw_app_meta_data only.
create table public.command_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.command_role not null,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null
);

alter table public.profiles enable row level security;
alter table public.command_roles enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.command_roles from anon, authenticated;
grant select, update (display_name) on table public.profiles to authenticated;

create policy "Command users can read their own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Command users can update their own display name" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- This trigger provisions an empty profile only. It never reads a role from
-- user-controlled metadata; trusted provisioning assigns app_metadata later.
create function public.handle_new_command_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_command_user() from public;
create trigger on_auth_user_created_command_profile after insert on auth.users
  for each row execute procedure public.handle_new_command_user();

comment on table public.command_roles is
  'Trusted authorization record. Roles belong in auth.users.raw_app_meta_data, never user_metadata.';
