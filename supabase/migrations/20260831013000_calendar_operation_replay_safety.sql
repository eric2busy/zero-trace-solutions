-- A retry supplies the same client idempotency key but does not (and must not)
-- supply a caller-controlled correlation id. Keep the correlation from the
-- original reservation and fail closed before a second provider mutation.
create or replace function public.command_reserve_job_operation(
  p_job_id uuid, p_idempotency_key text, p_operation public.command_job_operation_kind,
  p_actor_id uuid, p_correlation_id uuid, p_expected_job_version integer,
  p_operation_metadata jsonb default '{}'::jsonb
)
returns table (receipt_id uuid, state public.command_job_operation_state, replayed boolean,
  correlation_id uuid, created_at timestamptz)
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
  if not found then raise exception using errcode = 'P0002', message = 'job not found'; end if;
  if v_job.version <> p_expected_job_version then raise exception using errcode = '40001', message = 'stale job version'; end if;
  if v_job.calendar_event_id is null then raise exception using errcode = 'P0001', message = 'calendar-backed job required'; end if;
  insert into public.job_operation_receipts (job_id, idempotency_key, operation, actor_id, correlation_id, expected_job_version, operation_metadata)
  values (p_job_id, p_idempotency_key, p_operation, p_actor_id, p_correlation_id, p_expected_job_version, p_operation_metadata)
  on conflict (job_id, idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into v_receipt from public.job_operation_receipts where job_id = p_job_id and idempotency_key = p_idempotency_key for update;
    v_replayed := true;
    -- Correlation is intentionally excluded: it is generated server-side per
    -- request, while the receipt retains the original, auditable correlation.
    if v_receipt.operation <> p_operation or v_receipt.actor_id <> p_actor_id
      or v_receipt.expected_job_version <> p_expected_job_version or v_receipt.operation_metadata <> p_operation_metadata then
      raise exception using errcode = '23505', message = 'idempotency key conflicts with existing job operation';
    end if;
  else
    insert into public.activity_events (actor_id, action, target_type, target_id, authority_level, correlation_id, idempotency_key, outcome, metadata)
    values (p_actor_id, 'job.calendar_operation.received', 'job', p_job_id, 'yellow', p_correlation_id, p_idempotency_key, 'pending',
      jsonb_build_object('operation', p_operation, 'receipt_id', v_receipt.id));
  end if;
  return query select v_receipt.id, v_receipt.state, v_replayed, v_receipt.correlation_id, v_receipt.created_at;
end;
$$;

revoke all on function public.command_reserve_job_operation(uuid, text, public.command_job_operation_kind, uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.command_reserve_job_operation(uuid, text, public.command_job_operation_kind, uuid, uuid, integer, jsonb) to service_role;
comment on function public.command_reserve_job_operation(uuid, text, public.command_job_operation_kind, uuid, uuid, integer, jsonb) is 'Server-only receipt reservation. Replays retain the original server-derived correlation and never authorize a second provider mutation.';
