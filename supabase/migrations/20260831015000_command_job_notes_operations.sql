-- PREPARED ONLY: do not apply this migration to any Supabase project without
-- explicit owner approval. It adds a server-only, atomic operation for Command
-- job notes; it creates no external integration, Calendar change, or worker.

-- The table remains the immutable ledger. This operation is intentionally the
-- only new writer seam: it records the operational note and its activity event
-- in one transaction, or persists neither.
create function public.command_create_job_note(
  p_job_id uuid,
  p_author_actor_id uuid,
  p_body text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_require_active_assignment boolean default false
)
returns table (id uuid, job_id uuid, kind public.command_job_note_kind, body text,
  created_at timestamptz, replayed boolean)
language plpgsql security invoker set search_path = '' as $$
declare
  v_note public.job_notes;
  v_replayed boolean := false;
begin
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception using errcode = '22023', message = 'note body must be between 1 and 2000 characters';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception using errcode = '22023', message = 'invalid note idempotency key';
  end if;
  if not exists (select 1 from public.actors where id = p_author_actor_id and kind = 'human' and status = 'active') then
    raise exception using errcode = '42501', message = 'active human actor required';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception using errcode = 'P0002', message = 'job not found';
  end if;
  if p_require_active_assignment and not exists (
    select 1 from public.job_assignments
    where job_id = p_job_id and actor_id = p_author_actor_id and unassigned_at is null
  ) then
    raise exception using errcode = '42501', message = 'active assignment required';
  end if;

  insert into public.job_notes (job_id, author_actor_id, kind, body, correlation_id, idempotency_key)
  values (p_job_id, p_author_actor_id, 'internal', btrim(p_body), p_correlation_id, p_idempotency_key)
  on conflict (job_id, idempotency_key) do nothing
  returning * into v_note;

  if not found then
    select * into v_note from public.job_notes
    where job_id = p_job_id and idempotency_key = p_idempotency_key;
    v_replayed := true;
    if v_note.author_actor_id is distinct from p_author_actor_id
      or v_note.kind <> 'internal' or v_note.body <> btrim(p_body) then
      raise exception using errcode = '23505', message = 'idempotency key conflicts with existing note';
    end if;
  else
    insert into public.activity_events (
      actor_id, action, target_type, target_id, authority_level,
      correlation_id, idempotency_key, outcome, metadata
    ) values (
      p_author_actor_id, 'job.note.created', 'job', p_job_id, 'green',
      p_correlation_id, p_idempotency_key, 'succeeded',
      jsonb_build_object('note_id', v_note.id, 'kind', v_note.kind)
    );
  end if;

  return query select v_note.id, v_note.job_id, v_note.kind, v_note.body, v_note.created_at, v_replayed;
end;
$$;

revoke all on function public.command_create_job_note(uuid, uuid, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.command_create_job_note(uuid, uuid, text, text, uuid, boolean) to service_role;

comment on function public.command_create_job_note(uuid, uuid, text, text, uuid, boolean) is
  'Server-only atomic Command note writer. Inserts an immutable internal note and activity event together; an identical idempotent retry returns the original note without a second activity event.';
