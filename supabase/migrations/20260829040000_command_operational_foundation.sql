-- PREPARED ONLY: do not apply this migration to any Supabase project without
-- explicit owner approval. This creates control-plane primitives only; it does
-- not redirect existing website, Notion, Calendar, or email traffic.

create type public.command_actor_kind as enum ('human', 'agent', 'service');
create type public.command_authority_level as enum ('green', 'yellow', 'red');
create type public.command_activity_outcome as enum ('succeeded', 'failed', 'blocked', 'pending');
create type public.command_approval_status as enum ('pending', 'approved', 'rejected', 'modified', 'expired', 'cancelled');
create type public.command_outbox_status as enum ('pending', 'processing', 'delivered', 'needs_attention', 'cancelled');

-- An actor is the durable identity behind a human, agent, or server-side
-- integration. Authorization remains in command_roles/auth app metadata; this
-- table is for attribution and must not be used as an authorization shortcut.
create table public.actors (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  kind public.command_actor_kind not null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  service_key text unique,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.actors(id) on delete restrict,
  updated_by uuid references public.actors(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  check (
    (kind = 'human' and auth_user_id is not null and service_key is null)
    or (kind in ('agent', 'service') and auth_user_id is null and service_key is not null)
  )
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.actors(id) on delete restrict,
  action text not null check (char_length(action) between 1 and 160),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id uuid,
  authority_level public.command_authority_level not null,
  approval_id uuid,
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text,
  outcome public.command_activity_outcome not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  error_code text check (char_length(error_code) <= 120),
  created_at timestamptz not null default now(),
  check ((outcome = 'failed') = (error_code is not null))
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  requested_by_actor_id uuid not null references public.actors(id) on delete restrict,
  decided_by_actor_id uuid references public.actors(id) on delete restrict,
  action_type text not null check (char_length(action_type) between 1 and 160),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id uuid,
  authority_level public.command_authority_level not null check (authority_level = 'yellow'),
  policy_basis text not null check (char_length(policy_basis) between 1 and 400),
  rationale text not null check (char_length(rationale) between 1 and 2000),
  proposed_payload_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_payload_summary) = 'object'),
  decision_summary jsonb check (decision_summary is null or jsonb_typeof(decision_summary) = 'object'),
  status public.command_approval_status not null default 'pending',
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (
    (status = 'pending' and decided_by_actor_id is null and decided_at is null and decision_summary is null)
    or (status <> 'pending' and decided_by_actor_id is not null and decided_at is not null)
  )
);

alter table public.activity_events
  add constraint activity_events_approval_id_fkey
  foreign key (approval_id) references public.approvals(id) on delete restrict;

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null check (char_length(aggregate_type) between 1 and 80),
  aggregate_id uuid not null,
  aggregate_version integer not null check (aggregate_version > 0),
  event_type text not null check (char_length(event_type) between 1 and 160),
  destination text not null check (destination in ('notion', 'google_calendar', 'resend')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  correlation_id uuid not null default gen_random_uuid(),
  status public.command_outbox_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  error_code text check (char_length(error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'delivered') = (delivered_at is not null))
);

create unique index approvals_requester_idempotency_key_idx
  on public.approvals (requested_by_actor_id, idempotency_key);
create index activity_events_target_created_at_idx
  on public.activity_events (target_type, target_id, created_at desc);
create index activity_events_correlation_id_idx on public.activity_events (correlation_id);
create index activity_events_approval_id_idx on public.activity_events (approval_id)
  where approval_id is not null;
create unique index integration_outbox_destination_idempotency_key_idx
  on public.integration_outbox (destination, idempotency_key);
create index integration_outbox_ready_idx
  on public.integration_outbox (available_at, created_at)
  where status in ('pending', 'needs_attention');
create index integration_outbox_aggregate_idx
  on public.integration_outbox (aggregate_type, aggregate_id, aggregate_version);

create function public.command_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create function public.command_guard_approval_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'pending' then
    raise exception 'an approval decision is immutable';
  end if;

  if new.requested_by_actor_id is distinct from old.requested_by_actor_id
    or new.action_type is distinct from old.action_type
    or new.target_type is distinct from old.target_type
    or new.target_id is distinct from old.target_id
    or new.authority_level is distinct from old.authority_level
    or new.policy_basis is distinct from old.policy_basis
    or new.rationale is distinct from old.rationale
    or new.proposed_payload_summary is distinct from old.proposed_payload_summary
    or new.correlation_id is distinct from old.correlation_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at then
    raise exception 'approval request fields are immutable';
  end if;
  return new;
end;
$$;

create function public.command_reject_activity_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'activity events are immutable';
end;
$$;

create trigger command_touch_actors_updated_at before update on public.actors
  for each row execute procedure public.command_touch_updated_at();
create trigger command_guard_approval_update before update on public.approvals
  for each row execute procedure public.command_guard_approval_update();
create trigger command_touch_approvals_updated_at before update on public.approvals
  for each row execute procedure public.command_touch_updated_at();
create trigger command_touch_integration_outbox_updated_at before update on public.integration_outbox
  for each row execute procedure public.command_touch_updated_at();
create trigger command_reject_activity_event_update before update on public.activity_events
  for each row execute procedure public.command_reject_activity_event_mutation();
create trigger command_reject_activity_event_delete before delete on public.activity_events
  for each row execute procedure public.command_reject_activity_event_mutation();

alter table public.actors enable row level security;
alter table public.activity_events enable row level security;
alter table public.approvals enable row level security;
alter table public.integration_outbox enable row level security;

revoke all on table public.actors from anon, authenticated;
revoke all on table public.activity_events from anon, authenticated;
revoke all on table public.approvals from anon, authenticated;
revoke all on table public.integration_outbox from anon, authenticated;
revoke all on function public.command_touch_updated_at() from public, anon, authenticated;
revoke all on function public.command_guard_approval_update() from public, anon, authenticated;
revoke all on function public.command_reject_activity_event_mutation() from public, anon, authenticated;

-- Browser clients receive no direct access. Server-side application code must
-- use narrow operations APIs and a server-only service credential.
create policy "No direct actor access" on public.actors as restrictive for all to authenticated using (false) with check (false);
create policy "No direct activity access" on public.activity_events as restrictive for all to authenticated using (false) with check (false);
create policy "No direct approval access" on public.approvals as restrictive for all to authenticated using (false) with check (false);
create policy "No direct outbox access" on public.integration_outbox as restrictive for all to authenticated using (false) with check (false);

comment on table public.actors is 'Attribution identities only. Authorization remains in command_roles and auth app metadata.';
comment on table public.activity_events is 'Append-only audit ledger. Do not store secrets, raw provider payloads, or hidden reasoning.';
comment on table public.approvals is 'Yellow-action approval records. Decisions are immutable; record decision activity in activity_events.';
comment on table public.integration_outbox is 'Durable integration work queue. No worker is introduced by this migration.';
