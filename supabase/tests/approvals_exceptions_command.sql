begin;
select plan(26);

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
select has_function('public', 'command_approval_allows_action', array['uuid','text','text','uuid','jsonb']);

select lives_ok($$
  insert into public.actors (id, kind, display_name, service_key)
  values
    ('70000000-0000-0000-0000-000000000001', 'agent', 'Fixture requester', 'fixture-requester'),
    ('70000000-0000-0000-0000-000000000002', 'service', 'Fixture owner proxy', 'fixture-owner-proxy');
$$, 'fixture attribution actors satisfy foundation constraints');

select throws_ok($$
  insert into public.approvals (
    id, requested_by_actor_id, decided_by_actor_id, action_type, target_type,
    authority_level, policy_basis, rationale, status, correlation_id,
    idempotency_key, decided_at, decision_summary
  ) values (
    '71000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002',
    'discount', 'proposal', 'yellow', 'discount requires owner approval',
    'Fixture rejected request', 'rejected', '72000000-0000-0000-0000-000000000002',
    'approval-fixture-2', now(), '{"approved":false}'::jsonb
  );
  insert into public.approval_decisions (
    approval_id, decided_by_actor_id, decision, authority_basis, rationale, correlation_id
  ) values (
    '71000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000002', 'approved',
    'wrong fixture decision', 'wrong fixture decision',
    '72000000-0000-0000-0000-000000000002'
  );
$$, 'P0001', 'approval decision must match terminal approval state', 'contradictory decision receipt is rejected');

select lives_ok($$
  insert into public.approvals (
    id, requested_by_actor_id, decided_by_actor_id, action_type, target_type,
    authority_level, policy_basis, rationale, proposed_payload_summary, status,
    correlation_id, idempotency_key, decided_at, decision_summary, expires_at
  ) values (
    '71000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002',
    'custom_price', 'proposal', 'yellow', 'custom_price requires owner approval',
    'Fixture approval', '{"term_months":12}'::jsonb, 'approved',
    '72000000-0000-0000-0000-000000000001', 'approval-fixture-1', now(),
    '{"approved":true}'::jsonb, now() + interval '1 hour'
  );
  insert into public.approval_decisions (
    approval_id, decided_by_actor_id, decision, authority_basis, rationale,
    effective_payload_summary, correlation_id
  ) values (
    '71000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002', 'approved',
    'Owner approved exact fixture proposal', 'Fixture rationale',
    '{"term_months":12}'::jsonb, '72000000-0000-0000-0000-000000000001'
  );
$$, 'terminal approval and immutable receipt can be recorded together');

select ok(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000001', 'custom_price', 'proposal', null,
    '{"term_months":12}'::jsonb
  ),
  'matching unexpired approved request allows the exact action and proposed payload'
);
select is(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000001', 'refund', 'proposal', null,
    '{"term_months":12}'::jsonb
  ), false,
  'mismatched action type fails closed'
);
select is(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000001', 'custom_price', 'job', null,
    '{"term_months":12}'::jsonb
  ), false,
  'mismatched target type fails closed'
);
select is(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000001', 'custom_price', 'proposal', null,
    '{"term_months":24}'::jsonb
  ), false,
  'mismatched approved payload fails closed'
);

select lives_ok($$
  insert into public.approvals (
    id, requested_by_actor_id, decided_by_actor_id, action_type, target_type,
    authority_level, policy_basis, rationale, proposed_payload_summary, status,
    correlation_id, idempotency_key, decided_at, decision_summary, expires_at
  ) values (
    '71000000-0000-0000-0000-000000000003',
    '70000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002',
    'nonstandard_customer_commitment', 'job', 'yellow',
    'nonstandard commitment requires owner approval', 'Fixture modification',
    '{"window":"original"}'::jsonb, 'modified',
    '72000000-0000-0000-0000-000000000003', 'approval-fixture-3', now(),
    '{"window":"owner-selected"}'::jsonb, now() + interval '1 hour'
  );
  insert into public.approval_decisions (
    approval_id, decided_by_actor_id, decision, authority_basis, rationale,
    effective_payload_summary, correlation_id
  ) values (
    '71000000-0000-0000-0000-000000000003',
    '70000000-0000-0000-0000-000000000002', 'modified',
    'Owner narrowed the fixture window', 'Use only owner-selected window',
    '{"window":"owner-selected"}'::jsonb,
    '72000000-0000-0000-0000-000000000003'
  );
$$, 'modified approval retains an exact effective payload receipt');
select ok(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000003',
    'nonstandard_customer_commitment', 'job', null,
    '{"window":"owner-selected"}'::jsonb
  ),
  'modified approval allows only the owner-selected effective payload'
);
select is(
  public.command_approval_allows_action(
    '71000000-0000-0000-0000-000000000003',
    'nonstandard_customer_commitment', 'job', null,
    '{"window":"original"}'::jsonb
  ), false,
  'modified approval does not authorize the original proposed payload'
);

select throws_ok($$
  update public.approval_decisions set rationale = 'Changed' where approval_id = '71000000-0000-0000-0000-000000000001';
$$, 'P0001', 'approval decisions are immutable', 'decision receipt cannot be updated');
select throws_ok($$
  delete from public.approval_decisions where approval_id = '71000000-0000-0000-0000-000000000001';
$$, 'P0001', 'approval decisions are immutable', 'decision receipt cannot be deleted');

select throws_ok($$
  insert into public.approval_decisions (
    approval_id, decided_by_actor_id, decision, authority_basis, rationale,
    effective_payload_summary, correlation_id
  ) values (
    '71000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000002', 'approved',
    'duplicate', 'duplicate', '{"term_months":12}'::jsonb,
    '72000000-0000-0000-0000-000000000001'
  );
$$, '23505', null, 'one terminal decision receipt exists per approval');

select * from finish();
rollback;
