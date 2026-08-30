-- PREPARED ONLY: do not apply this migration to any Supabase project without
-- explicit owner approval. This extends the prepared Command control plane only;
-- it creates no approval worker, external side effect, customer write, or policy.

-- One immutable decision receipt is retained for every terminal approval. The
-- mutable request row remains the current-state projection; this table is the
-- durable decision history used for audit and future operations APIs.
create table public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approvals(id) on delete restrict,
  decided_by_actor_id uuid not null references public.actors(id) on delete restrict,
  decision public.command_approval_status not null
    check (decision in ('approved', 'rejected', 'modified', 'expired', 'cancelled')),
  authority_basis text not null check (char_length(authority_basis) between 1 and 400),
  rationale text not null check (char_length(rationale) between 1 and 2000),
  effective_payload_summary jsonb
    check (effective_payload_summary is null or jsonb_typeof(effective_payload_summary) = 'object'),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (approval_id)
);

create index approval_decisions_actor_created_at_idx
  on public.approval_decisions (decided_by_actor_id, created_at desc);
create index approval_decisions_correlation_id_idx
  on public.approval_decisions (correlation_id);

-- Decision receipts must mirror the already-terminal approval projection. This
-- prevents contradictory audit evidence from being inserted even by a future
-- server-side writer. A changed decision requires a brand-new approval request.
create function public.command_validate_approval_decision_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.approvals approval
    where approval.id = new.approval_id
      and approval.status = new.decision
      and approval.status <> 'pending'
      and approval.decided_by_actor_id = new.decided_by_actor_id
      and approval.correlation_id = new.correlation_id
  ) then
    raise exception 'approval decision must match terminal approval state';
  end if;
  return new;
end;
$$;

-- Decision receipts are append-only. A correction is a new approval request,
-- never a rewrite of the historical decision that authorized or blocked work.
create function public.command_reject_approval_decision_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'approval decisions are immutable';
end;
$$;

create trigger command_validate_approval_decision_insert
  before insert on public.approval_decisions
  for each row execute procedure public.command_validate_approval_decision_insert();
create trigger command_reject_approval_decision_update
  before update on public.approval_decisions
  for each row execute procedure public.command_reject_approval_decision_mutation();
create trigger command_reject_approval_decision_delete
  before delete on public.approval_decisions
  for each row execute procedure public.command_reject_approval_decision_mutation();

-- Fail-closed validity check for a future server-only operations API. This does
-- not execute an action. It verifies exact action, target, and payload scope.
-- Approved requests authorize only the originally proposed payload summary;
-- modified requests authorize only the decision receipt's effective summary.
create function public.command_approval_allows_action(
  approval_uuid uuid,
  expected_action_type text,
  expected_target_type text,
  expected_target_id uuid,
  expected_payload_summary jsonb
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.approvals approval
    join public.approval_decisions decision
      on decision.approval_id = approval.id
    where approval.id = approval_uuid
      and approval.authority_level = 'yellow'
      and approval.status in ('approved', 'modified')
      and approval.action_type = expected_action_type
      and approval.target_type = expected_target_type
      and approval.target_id is not distinct from expected_target_id
      and jsonb_typeof(expected_payload_summary) = 'object'
      and (
        (approval.status = 'approved'
          and approval.proposed_payload_summary = expected_payload_summary)
        or
        (approval.status = 'modified'
          and decision.effective_payload_summary is not null
          and decision.effective_payload_summary = expected_payload_summary)
      )
      and (approval.expires_at is null or approval.expires_at > now())
      and decision.decision = approval.status
      and decision.decided_by_actor_id = approval.decided_by_actor_id
      and decision.correlation_id = approval.correlation_id
  );
$$;

alter table public.approval_decisions enable row level security;
revoke all on table public.approval_decisions from anon, authenticated;
revoke all on function public.command_validate_approval_decision_insert() from public, anon, authenticated;
revoke all on function public.command_reject_approval_decision_mutation() from public, anon, authenticated;
revoke all on function public.command_approval_allows_action(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

create policy "No direct approval decision access"
  on public.approval_decisions as restrictive for all to authenticated
  using (false) with check (false);

comment on table public.approval_decisions is
  'Append-only terminal decision receipts for Yellow-action approvals. A changed decision requires a new approval request.';
comment on function public.command_approval_allows_action(uuid, text, text, uuid, jsonb) is
  'Fail-closed server-side validity check for exact action, target, and approved/effective payload summary. It does not execute the proposed action.';
