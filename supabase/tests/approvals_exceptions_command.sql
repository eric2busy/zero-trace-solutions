begin;
select plan(22);

select has_table('public', 'approval_decisions');
select col_is_pk('public', 'approval_decisions', 'id');
select col_not_null('public', 'approval_decisions', 'approval_id');
select col_not_null('public', 'approval_decisions', 'decided_by_actor_id');
select col_not_null('public', 'approval_decisions', 'decision');
select col_not_null('public', 'approval_decisions', 'authority_basis');
select col_not_null('public', 'approval_decisions', 'rationale');
select col_not_null('public', 'approval_decisions', 'correlation_id');
select row_security_active('public.approval_decisions');
select policies_are('public', 'approval_decisions', array['No direct approval decision access']);
select table_privs_are('public', 'approval_decisions', 'authenticated', array[]::text[]);
select table_privs_are('public', 'approval_decisions', 'anon', array[]::text[]);
select has_function('public', 'command_approval_allows_action', array['uuid','text','text','uuid']);

select lives_ok($$
  insert into public.actors (id, kind, display_name, service_key)
  values
    ('70000000-0000-0000-0000-000000000001', 'agent', 'Fixture requester', 'fixture-requester'),
    ('70000000-0000-0000-0000-000000000002', 'human', 'Fixture owner', null);
$$, 'fixture actors can be prepared for approval testing');

-- The human actor requires auth_user_id under the foundation constraint, so
-- convert the second fixture to a service actor in a separate safe statement.
select lives_ok($$
  delete from public.actors where id = '70000000-0000-0000-0000-000000000002';
  insert into public.actors (id, kind, display_name, service_key)
  values ('70000000-0000-0000-0000-000000000002', 'service', 'Fixture owner proxy', 'fixture-owner-proxy');
$$, 'decision actor fixture satisfies attribution constraints');

select lives_ok($$
  insert into public.approvals (
    id, requested_by_actor_id, decided_by_actor_id, action_type, target_type,
    authority_level, policy_basis, rationale, status, correlation_id,
    idempotency_key, decided_at, decision_summary, expires_at
  ) values (
    '71000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002',
    'custom_price', 'proposal', 'yellow', 'custom_price requires owner approval',
    'Fixture approval', 'approved', '72000000-0000-0000-0000-000000000001',
    'approval-fixture-1', now(), '{"approved":true}'::jsonb, now() + interval '1 hour'
  );
  insert into public.approval_decisions (
    approval_id, decided_by_actor_id, decision, authority_basis, rationale,
    effective_payload_summary, correlation_id
  ) values (
    '71000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002', 'approved',
    'Owner approved exact fixture proposal', 'Fixture rationale',
    '{"approved":true}'::jsonb, '72000000-0000-0000-0000-000000000001'
  );
$$, 'terminal approval and immutable receipt can be recorded together');

select ok(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000001', 'custom_price', 'proposal', null
  ),
  'matching unexpired approved request with receipt allows the exact Yellow action'
);
select is(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000001', 'refund', 'proposal', null
  ), false,
  'mismatched action type fails closed'
);
select is(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000001', 'custom_price', 'job', null
  ), false,
  'mismatched target type fails closed'
);

select throws_ok($$
  update public.approval_decisions set rationale = 'Changed' where approval_id = '71000000-0000-0000-0000-000000000001';
$$, 'P0001', 'approval decisions are immutable', 'decision receipt cannot be updated');
select throws_ok($$
  delete from public.approval_decisions where approval_id = '71000000-0000-0000-0000-000000000001';
$$, 'P0001', 'approval decisions are immutable', 'decision receipt cannot be deleted');

select throws_ok($$
  insert into public.approval_decisions (
    approval_id, decided_by_actor_id, decision, authority_basis, rationale, correlation_id
  ) values (
    '71000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002', 'approved',
    'duplicate', 'duplicate', '72000000-0000-0000-0000-000000000001'
  );
$$, '23505', null, 'one terminal decision receipt exists per approval');

select * from finish();
rollback;
