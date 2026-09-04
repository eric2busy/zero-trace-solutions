-- PREPARED FOR PR REVIEW ONLY. This server-only operation creates a new
-- canonical service visit from a completed walkthrough. It does not call
-- Google Calendar, create an invoice, or introduce a payment model.

create or replace function public.command_create_service_job_from_walkthrough(
  p_walkthrough_job_id uuid,
  p_actor_id uuid,
  p_title text,
  p_scope text,
  p_idempotency_key text,
  p_correlation_id uuid
) returns table (job_id uuid, job_version integer, replayed boolean, correlation_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  v_walkthrough public.jobs;
  v_service_job public.jobs;
  v_source_record_id text;
  v_created boolean := false;
begin
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'valid service job title required';
  end if;
  if p_scope is not null and (char_length(btrim(p_scope)) < 1 or char_length(btrim(p_scope)) > 2000) then
    raise exception using errcode = '22023', message = 'valid service scope required';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'valid idempotency key required';
  end if;

  select * into v_walkthrough from public.jobs where id = p_walkthrough_job_id for key share;
  if not found then
    raise exception using errcode = 'P0002', message = 'walkthrough job not found';
  end if;
  if v_walkthrough.kind <> 'walkthrough' or v_walkthrough.status <> 'completed' then
    raise exception using errcode = 'P0001', message = 'completed walkthrough required';
  end if;

  -- The walkthrough id is the durable conversion identity. A replay cannot
  -- create a second service job or duplicate the linked client/location.
  v_source_record_id := 'walkthrough:' || v_walkthrough.id::text;
  insert into public.jobs (
    kind, status, customer_id, organization_id, service_location_id, title,
    source_system, source_record_id, idempotency_key, created_by, updated_by
  ) values (
    'service_visit', 'draft', v_walkthrough.customer_id, v_walkthrough.organization_id,
    v_walkthrough.service_location_id, btrim(p_title), 'manual', v_source_record_id,
    p_idempotency_key, p_actor_id, p_actor_id
  ) on conflict (source_system, source_record_id) where source_record_id is not null do nothing
  returning * into v_service_job;

  if found then
    v_created := true;
    if p_scope is not null then
      insert into public.job_notes (job_id, author_actor_id, kind, body, correlation_id, idempotency_key)
      values (v_service_job.id, p_actor_id, 'internal', btrim(p_scope), p_correlation_id, p_idempotency_key);
    end if;
    insert into public.activity_events (actor_id, action, target_type, target_id, authority_level, correlation_id, idempotency_key, outcome, metadata)
    values (p_actor_id, 'job.service_created_from_walkthrough', 'job', v_service_job.id, 'green', p_correlation_id, p_idempotency_key, 'succeeded', jsonb_build_object('walkthrough_job_id', v_walkthrough.id));
  else
    select * into v_service_job from public.jobs
      where source_system = 'manual' and source_record_id = v_source_record_id
      for key share;
  end if;

  return query select v_service_job.id, v_service_job.version, not v_created, p_correlation_id;
end;
$$;

revoke all on function public.command_create_service_job_from_walkthrough(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.command_create_service_job_from_walkthrough(uuid, uuid, text, text, text, uuid) to service_role;
comment on function public.command_create_service_job_from_walkthrough(uuid, uuid, text, text, text, uuid) is 'Server-only, auditable creation of one draft service visit linked to a completed walkthrough. Calendar scheduling remains a separate protected operation.';
