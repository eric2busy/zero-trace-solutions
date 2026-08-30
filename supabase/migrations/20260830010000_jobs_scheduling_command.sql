-- PREPARED ONLY: do not apply this migration to any Supabase project without
-- explicit owner approval. It creates no writer, reader, sync worker, or data.
-- Google Calendar remains scheduling authority until a separately approved cutover.

create type public.command_job_kind as enum ('walkthrough', 'service_visit');
create type public.command_job_status as enum ('draft', 'scheduled', 'en_route', 'in_progress', 'completed', 'cancelled');
create type public.command_job_assignment_role as enum ('lead', 'technician', 'observer');
create type public.command_job_note_kind as enum ('internal', 'completion', 'exception');

-- A job is the canonical operational record. Its schedule is stored as an
-- instant plus the IANA timezone used to communicate the appointment locally.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind public.command_job_kind not null,
  status public.command_job_status not null default 'draft',
  customer_id uuid references public.customers(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete restrict,
  service_location_id uuid references public.service_locations(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  service_details jsonb not null default '{}'::jsonb check (jsonb_typeof(service_details) = 'object'),
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  scheduled_timezone text check (scheduled_timezone is null or public.command_is_iana_timezone(scheduled_timezone)),
  source_system text not null default 'manual' check (source_system in ('manual', 'website', 'notion', 'google_calendar')),
  source_record_id text check (source_record_id is null or char_length(source_record_id) between 1 and 240),
  calendar_event_id text unique,
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  scheduled_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.actors(id) on delete restrict,
  updated_by uuid references public.actors(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  check ((customer_id is not null) or (organization_id is not null)),
  check ((scheduled_start_at is null) = (scheduled_end_at is null)),
  check ((scheduled_start_at is null) = (scheduled_timezone is null)),
  check (scheduled_end_at is null or scheduled_end_at > scheduled_start_at),
  check ((status in ('scheduled', 'en_route', 'in_progress', 'completed')) = (scheduled_start_at is not null)),
  check ((status = 'completed') = (completed_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (source_record_id is not null or idempotency_key is null)
);

-- Assignment is independent from authorization. Actors remain attribution
-- identities; a future server-only operations API must authorize separately
-- through trusted app_metadata/command_roles, never editable user metadata.
create table public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  actor_id uuid not null references public.actors(id) on delete restrict,
  assignment_role public.command_job_assignment_role not null,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.actors(id) on delete restrict,
  updated_by uuid references public.actors(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  check (unassigned_at is null or unassigned_at >= assigned_at)
);

-- Notes are append-only in the database; future UI/API code must add safe
-- activity_events when a note corresponds to a meaningful operational action.
create table public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  author_actor_id uuid references public.actors(id) on delete restrict,
  kind public.command_job_note_kind not null default 'internal',
  body text not null check (char_length(body) between 1 and 4000),
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  created_at timestamptz not null default now()
);

create unique index jobs_source_idempotency_key_idx
  on public.jobs (source_system, idempotency_key) where idempotency_key is not null;
create unique index job_notes_idempotency_key_idx
  on public.job_notes (job_id, idempotency_key) where idempotency_key is not null;
create unique index job_assignments_active_role_idx
  on public.job_assignments (job_id, actor_id, assignment_role) where unassigned_at is null;
create index jobs_schedule_idx on public.jobs (scheduled_start_at, scheduled_end_at)
  where status in ('scheduled', 'en_route', 'in_progress');
create index jobs_customer_schedule_idx on public.jobs (customer_id, scheduled_start_at desc)
  where customer_id is not null;
create index jobs_location_schedule_idx on public.jobs (service_location_id, scheduled_start_at desc)
  where service_location_id is not null;
create index job_assignments_actor_active_idx on public.job_assignments (actor_id, assigned_at desc)
  where unassigned_at is null;

create function public.command_reject_job_note_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'job notes are immutable';
end;
$$;

-- `service_locations` permits either a customer or organization owner, so a
-- composite foreign key would skip validation when one optional owner is NULL.
-- Validate the optional reference explicitly and fail closed on a mismatch.
create function public.command_validate_job_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.service_location_id is not null and not exists (
    select 1 from public.service_locations location
    where location.id = new.service_location_id
      and location.customer_id is not distinct from new.customer_id
      and location.organization_id is not distinct from new.organization_id
  ) then
    raise exception 'job customer, organization, and service location must match';
  end if;
  return new;
end;
$$;

create trigger command_touch_jobs_updated_at before update on public.jobs
  for each row execute procedure public.command_touch_updated_at();
create trigger command_validate_job_location before insert or update of service_location_id, customer_id, organization_id on public.jobs
  for each row execute procedure public.command_validate_job_location();
create trigger command_touch_job_assignments_updated_at before update on public.job_assignments
  for each row execute procedure public.command_touch_updated_at();
create trigger command_reject_job_note_update before update on public.job_notes
  for each row execute procedure public.command_reject_job_note_mutation();
create trigger command_reject_job_note_delete before delete on public.job_notes
  for each row execute procedure public.command_reject_job_note_mutation();

alter table public.jobs enable row level security;
alter table public.job_assignments enable row level security;
alter table public.job_notes enable row level security;
revoke all on table public.jobs, public.job_assignments, public.job_notes from anon, authenticated;
revoke all on function public.command_reject_job_note_mutation() from public, anon, authenticated;
revoke all on function public.command_validate_job_location() from public, anon, authenticated;
create policy "No direct job access" on public.jobs as restrictive for all to authenticated using (false) with check (false);
create policy "No direct job assignment access" on public.job_assignments as restrictive for all to authenticated using (false) with check (false);
create policy "No direct job note access" on public.job_notes as restrictive for all to authenticated using (false) with check (false);

comment on table public.jobs is 'Canonical service visits and walkthroughs. Calendar remains scheduling authority; no sync worker is created.';
comment on table public.job_assignments is 'Technician and observer assignments for attribution and planning, not authorization.';
comment on table public.job_notes is 'Append-only operational notes. Do not store secrets, raw provider payloads, or hidden reasoning.';
comment on column public.jobs.calendar_event_id is 'Future Google Calendar seam only; this migration does not read, write, or synchronize Calendar.';
