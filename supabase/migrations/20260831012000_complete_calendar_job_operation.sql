-- PREPARED AND TESTED LOCALLY ONLY. Do not apply to Production without a
-- separate explicit owner approval. This is the narrow Calendar-first
-- completion seam: it has no provider credentials and makes no provider call.

create function public.command_complete_job_calendar_operation(
  p_receipt_id uuid,
  p_actor_id uuid,
  p_scheduled_start_at timestamptz default null,
  p_scheduled_end_at timestamptz default null,
  p_scheduled_timezone text default null
)
returns table (job_id uuid, job_version integer, receipt_id uuid, correlation_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  v_receipt public.job_operation_receipts;
  v_job public.jobs;
begin
  select * into v_receipt from public.job_operation_receipts where id = p_receipt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'job operation receipt not found'; end if;
  if v_receipt.actor_id <> p_actor_id then raise exception using errcode = '42501', message = 'receipt actor mismatch'; end if;
  if v_receipt.state <> 'calendar_pending' then
    raise exception using errcode = 'P0001', message = 'job operation receipt is already terminal';
  end if;

  select * into v_job from public.jobs where id = v_receipt.job_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'job not found'; end if;
  if v_job.version <> v_receipt.expected_job_version then raise exception using errcode = '40001', message = 'stale job version'; end if;
  if v_job.calendar_event_id is null or v_job.status <> 'scheduled' then
    raise exception using errcode = 'P0001', message = 'scheduled calendar-backed job required';
  end if;

  if v_receipt.operation = 'reschedule' then
    if p_scheduled_start_at is null or p_scheduled_end_at is null or p_scheduled_end_at <= p_scheduled_start_at
      or p_scheduled_timezone is null or not public.command_is_iana_timezone(p_scheduled_timezone) then
      raise exception using errcode = '22023', message = 'valid reschedule times and timezone required';
    end if;
    update public.jobs set scheduled_start_at = p_scheduled_start_at, scheduled_end_at = p_scheduled_end_at,
      scheduled_timezone = p_scheduled_timezone, updated_by = p_actor_id
      where id = v_job.id returning * into v_job;
  elsif v_receipt.operation = 'cancel' then
    if p_scheduled_start_at is not null or p_scheduled_end_at is not null or p_scheduled_timezone is not null then
      raise exception using errcode = '22023', message = 'cancel operation cannot include schedule values';
    end if;
    update public.jobs set status = 'cancelled', cancelled_at = now(), updated_by = p_actor_id
      where id = v_job.id returning * into v_job;
  else
    raise exception using errcode = '22023', message = 'unsupported job operation';
  end if;

  update public.job_operation_receipts set state = 'succeeded', completed_at = now(), error_code = null
    where id = v_receipt.id;
  insert into public.activity_events (actor_id, action, target_type, target_id, authority_level, correlation_id,
    idempotency_key, outcome, metadata)
  values (p_actor_id, 'job.calendar_operation.completed', 'job', v_job.id, 'yellow', v_receipt.correlation_id,
    v_receipt.idempotency_key, 'succeeded', jsonb_build_object('operation', v_receipt.operation,
      'receipt_id', v_receipt.id, 'expected_job_version', v_receipt.expected_job_version, 'job_version', v_job.version));
  return query select v_job.id, v_job.version, v_receipt.id, v_receipt.correlation_id;
end;
$$;

revoke all on function public.command_complete_job_calendar_operation(uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.command_complete_job_calendar_operation(uuid, uuid, timestamptz, timestamptz, text) to service_role;
comment on function public.command_complete_job_calendar_operation(uuid, uuid, timestamptz, timestamptz, text) is 'Server-only atomic canonical job mutation, activity audit, and Calendar operation receipt success completion. Prepared only; it makes no Calendar call.';
