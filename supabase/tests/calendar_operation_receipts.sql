begin;
select plan(23);
select has_table('public'::name, 'job_operation_receipts'::name);
select col_not_null('public'::name, 'job_operation_receipts'::name, 'job_id'::name);
select col_not_null('public'::name, 'job_operation_receipts'::name, 'idempotency_key'::name);
select col_not_null('public'::name, 'job_operation_receipts'::name, 'actor_id'::name);
select col_not_null('public'::name, 'job_operation_receipts'::name, 'correlation_id'::name);
select col_not_null('public'::name, 'job_operation_receipts'::name, 'expected_job_version'::name);
select ok((select relrowsecurity from pg_class where oid = 'public.job_operation_receipts'::regclass), 'receipts have RLS');
select table_privs_are('public', 'job_operation_receipts', 'anon', array[]::name[]);
select table_privs_are('public', 'job_operation_receipts', 'authenticated', array[]::name[]);
select policies_are('public', 'job_operation_receipts', array['No direct job operation receipt access']::name[]);
select has_index('public'::name, 'job_operation_receipts'::name, 'job_operation_receipts_reconciliation_idx'::name);
select has_function('public', 'command_reserve_job_operation', array['uuid', 'text', 'command_job_operation_kind', 'uuid', 'uuid', 'integer', 'jsonb']);
select has_function('public', 'command_set_job_operation_state', array['uuid', 'uuid', 'command_job_operation_state', 'text']);

insert into public.organizations (id, display_name) values ('31000000-0000-0000-0000-000000000001', 'Receipt organization');
insert into public.customers (id, organization_id, display_name) values ('41000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'Receipt customer');
insert into public.actors (id, kind, display_name, service_key) values ('61000000-0000-0000-0000-000000000001', 'service', 'Receipt worker', 'receipt-worker');
insert into public.jobs (id, kind, status, customer_id, organization_id, title, scheduled_start_at, scheduled_end_at, scheduled_timezone, calendar_event_id)
values ('71000000-0000-0000-0000-000000000001', 'service_visit', 'scheduled', '41000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'Calendar-backed receipt fixture', now() + interval '1 day', now() + interval '1 day 1 hour', 'America/Los_Angeles', 'receipt-event-1');
set local role service_role;
select lives_ok($$
  select * from public.command_reserve_job_operation('71000000-0000-0000-0000-000000000001', 'receipt-retry-1', 'reschedule', '61000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 1, '{"requested_by":"test"}'::jsonb);
$$, 'reserving a calendar operation creates a receipt');
select is((select count(*) from public.job_operation_receipts), 1::bigint, 'unique job/idempotency receipt exists once');
select is((select state::text from public.job_operation_receipts), 'calendar_pending', 'new receipt is pending');
select is((select count(*) from public.activity_events where action = 'job.calendar_operation.received'), 1::bigint, 'receipt and audit event commit together');
select is((select replayed from public.command_reserve_job_operation('71000000-0000-0000-0000-000000000001', 'receipt-retry-1', 'reschedule', '61000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 1, '{"requested_by":"test"}'::jsonb)), true, 'matching retry replays original receipt');
select is((select count(*) from public.job_operation_receipts), 1::bigint, 'retry does not duplicate receipt');
select throws_ok($$
  select * from public.command_reserve_job_operation('71000000-0000-0000-0000-000000000001', 'receipt-retry-1', 'cancel', '61000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 1, '{}'::jsonb);
$$, '23505', 'idempotency key conflicts with existing job operation', 'conflicting retry fails closed');
select lives_ok($$
  select * from public.command_set_job_operation_state((select id from public.job_operation_receipts), '61000000-0000-0000-0000-000000000001', 'reconciliation_needed', 'calendar_rollback_failed');
$$, 'rollback failure persists reconciliation-needed state');
select ok((select reconciliation_needed_at is not null and error_code = 'calendar_rollback_failed' from public.job_operation_receipts), 'reconciliation receipt retains failure attribution');
select is((select count(*) from public.activity_events where action = 'job.calendar_operation.reconciliation_needed'), 1::bigint, 'reconciliation state is audited atomically');
reset role;
select * from finish();
rollback;
