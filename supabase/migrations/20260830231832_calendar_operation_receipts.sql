-- PREPARED ONLY: do not apply this migration to any Supabase project without
-- explicit owner approval. This adds durable server-side receipts only. It
-- does not create a Calendar client, worker, webhook, or Calendar mutation.

create type public.command_job_operation_kind as enum ('reschedule', 'cancel');
create type public.command_job_operation_state as enum (
  'calendar_pending', 'succeeded', 'reconciliation_needed'
);

-- One receipt represents one requested Calendar-affecting operation. The
-- receipt is deliberately separate from `jobs`: Calendar remains scheduling
-- authority and no job schedule/status is changed by these helpers.
create table public.job_operation_receipts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  operation public.command_job_operation_kind not null,
  state public.command_job_operation_state not null default 'calendar_pending',
  actor_id uuid not null references public.actors(id) on delete restrict,
  correlation_id uuid not null,
  expected_job_version integer not null check (expected_job_version > 0),
  operation_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(operation_metadata) = 'object'),
  error_code text check (error_code is null or char_length(error_code) between 1 and 120),
  reconciliation_needed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (job_id, idempotency_key),
  check ((state = 'reconciliation_needed') = (reconciliation_needed_at is not null)),
  check ((state = 'succeeded') = (completed_at is not null)),
  check ((state = 'reconciliation_needed') = (error_code is not null)),
  check (state <> 'succeeded' or error_code is null)
);

create index job_operation_receipts_reconciliation_idx
  on public.job_operation_receipts (reconciliation_needed_at, created_at)
  where state = 'reconciliation_needed';
create index job_operation_receipts_correlation_idx
  on public.job_operation_receipts (correlation_id, created_at desc);

create trigger command_touch_job_operation_receipts_updated_at before update on public.job_operation_receipts
  for each row execute procedure public.command_touch_updated_at();

-- Reserve a receipt and append its audit record in one database transaction.
-- A matching retry returns the original receipt; a conflicting retry fails
-- closed instead of silently treating a different operation as idempotent.
create function public.command_reserve_job_operation(
  p_job_id uuid,
  p_idempotency_key text,
  p_operation public.command_job_operation_kind,
  p_actor_id uuid,
  p_correlation_id uuid,
  p_expected_job_version integer,
  p_operation_metadata jsonb default '{}'::jsonb
)
returns table (
  receipt_id uuid,
  state public.command_job_operation_state,
  replayed boolean,
  correlation_id uuid,
  created_at timestamptz
)
language plpgsql security invoker set search_path = '' as $$
declare
  v_receipt public.job_operation_receipts;
  v_job public.jobs;
  v_replayed boolean := false;
begin
  if jsonb_typeof(p_operation_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'operation metadata must be an object';
  end if;

  select * into v_job from public.jobs where id = p_job_id for key share;
  if not found then
    raise exception using errcode = 'P0002', message = 'job not found';
  end if;
  if v_job.version <> p_expected_job_version then
    raise exception using errcode = '40001', message = 'stale job version';
  end if;
  if v_job.calendar_event_id is null then
    raise exception using errcode = 'P0001', message = 'calendar-backed job required';
  end if;

  insert into public.job_operation_receipts (
    job_id, idempotency_key, operation, actor_id, correlation_id,
    expected_job_version, operation_metadata
  ) values (
    p_job_id, p_idempotency_key, p_operation, p_actor_id, p_correlation_id,
    p_expected_job_version, p_operation_metadata
  ) on conflict (job_id, idempotency_key) do nothing returning * into v_receipt;

  if not found then
    select * into v_receipt from public.job_operation_receipts
      where job_id = p_job_id and idempotency_key = p_idempotency_key for update;
    v_replayed := true;
    if v_receipt.operation <> p_operation
      or v_receipt.actor_id <> p_actor_id
      or v_receipt.correlation_id <> p_correlation_id
      or v_receipt.expected_job_version <> p_expected_job_version
      or v_receipt.operation_metadata <> p_operation_metadata then
      raise exception using errcode = '23505', message = 'idempotency key conflicts with existing job operation';
    end if;
  else
    insert into public.activity_events (
      actor_id, action, target_type, target_id, authority_level, correlation_id,
      idempotency_key, outcome, metadata
    ) values (
      p_actor_id, 'job.calendar_operation.received', 'job', p_job_id, 'yellow',
      p_correlation_id, p_idempotency_key, 'pending',
      jsonb_build_object('operation', p_operation, 'receipt_id', v_receipt.id)
    );
  end if;

  return query select v_receipt.id, v_receipt.state, v_replayed,
    v_receipt.correlation_id, v_receipt.created_at;
end;
$$;

-- Completion and reconciliation marking also append immutable activity in the
-- same transaction. A worker may retry only by using the original receipt.
create function public.command_set_job_operation_state(
  p_receipt_id uuid,
  p_actor_id uuid,
  p_state public.command_job_operation_state,
  p_error_code text default null
)
returns table (receipt_id uuid, state public.command_job_operation_state, correlation_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare v_receipt public.job_operation_receipts;
begin
  select * into v_receipt from public.job_operation_receipts where id = p_receipt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'job operation receipt not found'; end if;
  if v_receipt.actor_id <> p_actor_id then raise exception using errcode = '42501', message = 'receipt actor mismatch'; end if;
  if p_state = 'calendar_pending' then raise exception using errcode = '22023', message = 'receipt cannot be reset to pending'; end if;
  if v_receipt.state <> 'calendar_pending' and v_receipt.state <> p_state then
    raise exception using errcode = 'P0001', message = 'terminal receipt state is immutable';
  end if;
  if v_receipt.state = p_state then
    if v_receipt.error_code is distinct from p_error_code then
      raise exception using errcode = '23505', message = 'terminal receipt outcome conflicts with existing receipt';
    end if;
    return query select v_receipt.id, v_receipt.state, v_receipt.correlation_id;
    return;
  end if;
  if p_state = 'reconciliation_needed' and (p_error_code is null or char_length(p_error_code) = 0) then
    raise exception using errcode = '22023', message = 'reconciliation state requires error code';
  end if;
  if p_state = 'succeeded' and p_error_code is not null then
    raise exception using errcode = '22023', message = 'succeeded receipt cannot include error code';
  end if;

  update public.job_operation_receipts set
    state = p_state,
    error_code = p_error_code,
    reconciliation_needed_at = case when p_state = 'reconciliation_needed' then now() else null end,
    completed_at = case when p_state = 'succeeded' then now() else null end
  where id = p_receipt_id returning * into v_receipt;

  insert into public.activity_events (
    actor_id, action, target_type, target_id, authority_level, correlation_id,
    idempotency_key, outcome, error_code, metadata
  ) values (
    p_actor_id,
    case when p_state = 'succeeded' then 'job.calendar_operation.succeeded' else 'job.calendar_operation.reconciliation_needed' end,
    'job', v_receipt.job_id, 'yellow', v_receipt.correlation_id,
    v_receipt.idempotency_key,
    (case when p_state = 'succeeded' then 'succeeded' else 'failed' end)::public.command_activity_outcome,
    p_error_code,
    jsonb_build_object('operation', v_receipt.operation, 'receipt_id', v_receipt.id)
  );
  return query select v_receipt.id, v_receipt.state, v_receipt.correlation_id;
end;
$$;

alter table public.job_operation_receipts enable row level security;
revoke all on table public.job_operation_receipts from anon, authenticated;
revoke all on function public.command_reserve_job_operation(uuid, text, public.command_job_operation_kind, uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.command_set_job_operation_state(uuid, uuid, public.command_job_operation_state, text) from public, anon, authenticated;
grant execute on function public.command_reserve_job_operation(uuid, text, public.command_job_operation_kind, uuid, uuid, integer, jsonb) to service_role;
grant execute on function public.command_set_job_operation_state(uuid, uuid, public.command_job_operation_state, text) to service_role;
create policy "No direct job operation receipt access" on public.job_operation_receipts as restrictive for all to authenticated using (false) with check (false);

comment on table public.job_operation_receipts is 'Private durable receipt for one Calendar reschedule/cancel operation. Calendar remains scheduling authority; no worker is created.';
comment on function public.command_reserve_job_operation(uuid, text, public.command_job_operation_kind, uuid, uuid, integer, jsonb) is 'Server-only transactional receipt reservation with idempotency and activity attribution.';
comment on function public.command_set_job_operation_state(uuid, uuid, public.command_job_operation_state, text) is 'Server-only transactional receipt outcome/reconciliation state with activity attribution.';
