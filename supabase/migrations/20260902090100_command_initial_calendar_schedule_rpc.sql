-- PREPARED FOR PR REVIEW ONLY. This follows the committed enum extension in
-- 20260902090000; it has no credentials and performs no provider call.

create or replace function public.command_reserve_job_operation(
  p_job_id uuid, p_idempotency_key text, p_operation public.command_job_operation_kind,
  p_actor_id uuid, p_correlation_id uuid, p_expected_job_version integer,
  p_operation_metadata jsonb default '{}'::jsonb
) returns table (receipt_id uuid, state public.command_job_operation_state, replayed boolean, correlation_id uuid, created_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare v_receipt public.job_operation_receipts; v_job public.jobs; v_replayed boolean := false;
begin
  if jsonb_typeof(p_operation_metadata) <> 'object' then raise exception using errcode = '22023', message = 'operation metadata must be an object'; end if;
  select * into v_job from public.jobs where id = p_job_id for key share;
  if not found then raise exception using errcode = 'P0002', message = 'job not found'; end if;
  if v_job.version <> p_expected_job_version then raise exception using errcode = '40001', message = 'stale job version'; end if;
  if p_operation = 'schedule' then
    if v_job.status <> 'draft' or v_job.calendar_event_id is not null or v_job.scheduled_start_at is not null or v_job.scheduled_end_at is not null then raise exception using errcode = 'P0001', message = 'unscheduled draft job required'; end if;
  elsif v_job.calendar_event_id is null then raise exception using errcode = 'P0001', message = 'calendar-backed job required'; end if;
  insert into public.job_operation_receipts (job_id, idempotency_key, operation, actor_id, correlation_id, expected_job_version, operation_metadata)
  values (p_job_id, p_idempotency_key, p_operation, p_actor_id, p_correlation_id, p_expected_job_version, p_operation_metadata)
  on conflict (job_id, idempotency_key) do nothing returning * into v_receipt;
  if not found then
    select * into v_receipt from public.job_operation_receipts where job_id = p_job_id and idempotency_key = p_idempotency_key for update; v_replayed := true;
    if v_receipt.operation <> p_operation or v_receipt.actor_id <> p_actor_id or v_receipt.correlation_id <> p_correlation_id or v_receipt.expected_job_version <> p_expected_job_version or v_receipt.operation_metadata <> p_operation_metadata then raise exception using errcode = '23505', message = 'idempotency key conflicts with existing job operation'; end if;
  else
    insert into public.activity_events (actor_id, action, target_type, target_id, authority_level, correlation_id, idempotency_key, outcome, metadata)
    values (p_actor_id, 'job.calendar_operation.received', 'job', p_job_id, 'yellow', p_correlation_id, p_idempotency_key, 'pending', jsonb_build_object('operation', p_operation, 'receipt_id', v_receipt.id));
  end if;
  return query select v_receipt.id, v_receipt.state, v_replayed, v_receipt.correlation_id, v_receipt.created_at;
end;
$$;

create or replace function public.command_complete_job_calendar_operation(
  p_receipt_id uuid, p_actor_id uuid, p_scheduled_start_at timestamptz default null,
  p_scheduled_end_at timestamptz default null, p_scheduled_timezone text default null,
  p_calendar_event_id text default null
) returns table (job_id uuid, job_version integer, receipt_id uuid, correlation_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare v_receipt public.job_operation_receipts; v_job public.jobs;
begin
  select * into v_receipt from public.job_operation_receipts where id = p_receipt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'job operation receipt not found'; end if;
  if v_receipt.actor_id <> p_actor_id then raise exception using errcode = '42501', message = 'receipt actor mismatch'; end if;
  if v_receipt.state <> 'calendar_pending' then raise exception using errcode = 'P0001', message = 'job operation receipt is already terminal'; end if;
  select * into v_job from public.jobs where id = v_receipt.job_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'job not found'; end if;
  if v_job.version <> v_receipt.expected_job_version then raise exception using errcode = '40001', message = 'stale job version'; end if;
  if v_receipt.operation in ('schedule', 'reschedule') then
    if p_scheduled_start_at is null or p_scheduled_end_at is null or p_scheduled_end_at <= p_scheduled_start_at or p_scheduled_timezone is null or not public.command_is_iana_timezone(p_scheduled_timezone) then raise exception using errcode = '22023', message = 'valid schedule times and timezone required'; end if;
    if v_receipt.operation = 'schedule' then
      if v_job.status <> 'draft' or v_job.calendar_event_id is not null or p_calendar_event_id is null or char_length(p_calendar_event_id) = 0 then raise exception using errcode = 'P0001', message = 'unscheduled draft job and calendar event required'; end if;
      update public.jobs set status = 'scheduled', scheduled_start_at = p_scheduled_start_at, scheduled_end_at = p_scheduled_end_at, scheduled_timezone = p_scheduled_timezone, calendar_event_id = p_calendar_event_id, updated_by = p_actor_id where id = v_job.id returning * into v_job;
    else
      if v_job.status <> 'scheduled' or v_job.calendar_event_id is null or p_calendar_event_id is not null then raise exception using errcode = 'P0001', message = 'scheduled calendar-backed job required'; end if;
      update public.jobs set scheduled_start_at = p_scheduled_start_at, scheduled_end_at = p_scheduled_end_at, scheduled_timezone = p_scheduled_timezone, updated_by = p_actor_id where id = v_job.id returning * into v_job;
    end if;
  elsif v_receipt.operation = 'cancel' then
    if p_scheduled_start_at is not null or p_scheduled_end_at is not null or p_scheduled_timezone is not null or p_calendar_event_id is not null then raise exception using errcode = '22023', message = 'cancel operation cannot include schedule values'; end if;
    if v_job.calendar_event_id is null or v_job.status <> 'scheduled' then raise exception using errcode = 'P0001', message = 'scheduled calendar-backed job required'; end if;
    update public.jobs set status = 'cancelled', cancelled_at = now(), updated_by = p_actor_id where id = v_job.id returning * into v_job;
  else raise exception using errcode = '22023', message = 'unsupported job operation'; end if;
  update public.job_operation_receipts set state = 'succeeded', completed_at = now(), error_code = null where id = v_receipt.id;
  insert into public.activity_events (actor_id, action, target_type, target_id, authority_level, correlation_id, idempotency_key, outcome, metadata)
  values (p_actor_id, 'job.calendar_operation.completed', 'job', v_job.id, 'yellow', v_receipt.correlation_id, v_receipt.idempotency_key, 'succeeded', jsonb_build_object('operation', v_receipt.operation, 'receipt_id', v_receipt.id, 'expected_job_version', v_receipt.expected_job_version, 'job_version', v_job.version));
  return query select v_job.id, v_job.version, v_receipt.id, v_receipt.correlation_id;
end;
$$;

revoke all on function public.command_complete_job_calendar_operation(uuid, uuid, timestamptz, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.command_complete_job_calendar_operation(uuid, uuid, timestamptz, timestamptz, text, text) to service_role;
comment on function public.command_complete_job_calendar_operation(uuid, uuid, timestamptz, timestamptz, text, text) is 'Server-only atomic canonical job schedule/reschedule/cancel completion. Prepared only; Calendar calls remain in the protected server command.';
