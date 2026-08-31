begin;
select plan(22);
select has_function('public', 'command_complete_job_calendar_operation', array['uuid', 'uuid', 'timestamptz', 'timestamptz', 'text']);
select function_privs_are('public', 'command_complete_job_calendar_operation', array['uuid', 'uuid', 'timestamptz', 'timestamptz', 'text'], 'anon', array[]::name[], 'browser role cannot execute completion helper');
insert into public.organizations (id, display_name) values ('32000000-0000-0000-0000-000000000001', 'Completion organization');
insert into public.customers (id, organization_id, display_name) values ('42000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 'Completion customer');
insert into public.actors (id, kind, display_name, service_key) values ('62000000-0000-0000-0000-000000000001', 'service', 'Completion worker', 'completion-worker');
insert into public.jobs (id, kind, status, customer_id, organization_id, title, scheduled_start_at, scheduled_end_at, scheduled_timezone, calendar_event_id)
values ('72000000-0000-0000-0000-000000000001', 'service_visit', 'scheduled', '42000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 'Completion fixture', now() + interval '1 day', now() + interval '1 day 1 hour', 'America/Los_Angeles', 'completion-event');
set local role service_role;
select lives_ok($$ select * from public.command_reserve_job_operation('72000000-0000-0000-0000-000000000001', 'complete-reschedule', 'reschedule', '62000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 1, '{}'::jsonb) $$, 'reserves completion receipt');
select lives_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'complete-reschedule'), '62000000-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 1 hour', 'America/Los_Angeles') $$, 'completes reschedule atomically');
select is((select state::text from public.job_operation_receipts where idempotency_key = 'complete-reschedule'), 'succeeded', 'receipt is terminal success');
select ok((select scheduled_start_at > now() + interval '1 day 12 hours' and status = 'scheduled' and version = 2 from public.jobs where id = '72000000-0000-0000-0000-000000000001'), 'reschedule changes canonical job and increments version');
select is((select count(*) from public.activity_events where action = 'job.calendar_operation.completed' and target_id = '72000000-0000-0000-0000-000000000001'), 1::bigint, 'completion audit is retained');
select ok((select actor_id = '62000000-0000-0000-0000-000000000001' and correlation_id = '82000000-0000-0000-0000-000000000001' and outcome = 'succeeded' from public.activity_events where action = 'job.calendar_operation.completed' and target_id = '72000000-0000-0000-0000-000000000001'), 'completion audit retains actor and correlation attribution');
select throws_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'complete-reschedule'), '62000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days 1 hour', 'America/Los_Angeles') $$, 'P0001', 'job operation receipt is already terminal', 'terminal completion cannot duplicate job or audit');
select is((select count(*) from public.activity_events where action = 'job.calendar_operation.completed' and target_id = '72000000-0000-0000-0000-000000000001'), 1::bigint, 'terminal retry leaves one reschedule completion audit');
select lives_ok($$ select * from public.command_reserve_job_operation('72000000-0000-0000-0000-000000000001', 'complete-cancel', 'cancel', '62000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000002', 2, '{}'::jsonb) $$, 'reserves cancellation receipt at current version');
select lives_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'complete-cancel'), '62000000-0000-0000-0000-000000000001') $$, 'completes cancel atomically');
select ok((select status = 'cancelled' and cancelled_at is not null and scheduled_timezone = 'America/Los_Angeles' and version = 3 from public.jobs where id = '72000000-0000-0000-0000-000000000001'), 'cancel sets only canonical cancellation fields and increments version');
select is((select state::text from public.job_operation_receipts where idempotency_key = 'complete-cancel'), 'succeeded', 'cancel receipt is terminal success');
select is((select count(*) from public.activity_events where action = 'job.calendar_operation.completed' and target_id = '72000000-0000-0000-0000-000000000001' and correlation_id = '82000000-0000-0000-0000-000000000002'), 1::bigint, 'cancel emits exactly one attributed completion audit');
reset role;

insert into public.job_operation_receipts (job_id, idempotency_key, operation, actor_id, correlation_id, expected_job_version)
values ('72000000-0000-0000-0000-000000000001', 'stale-completion', 'reschedule', '62000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000003', 2),
       ('72000000-0000-0000-0000-000000000001', 'bad-actor-completion', 'reschedule', '62000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000004', 3),
       ('72000000-0000-0000-0000-000000000001', 'invalid-times-completion', 'reschedule', '62000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000005', 3);
set local role service_role;
select throws_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'stale-completion'), '62000000-0000-0000-0000-000000000001', now() + interval '4 days', now() + interval '4 days 1 hour', 'America/Los_Angeles') $$, '40001', 'stale job version', 'stale expected version fails before any mutation');
select ok((select state = 'calendar_pending' from public.job_operation_receipts where idempotency_key = 'stale-completion') and (select version = 3 from public.jobs where id = '72000000-0000-0000-0000-000000000001') and (select count(*) from public.activity_events where correlation_id = '82000000-0000-0000-0000-000000000003') = 0, 'stale completion rolls back receipt, job, and audit changes');
select throws_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'bad-actor-completion'), '62000000-0000-0000-0000-000000000002', now() + interval '4 days', now() + interval '4 days 1 hour', 'America/Los_Angeles') $$, '42501', 'receipt actor mismatch', 'actor mismatch fails closed');
select ok((select state = 'calendar_pending' from public.job_operation_receipts where idempotency_key = 'bad-actor-completion') and (select count(*) from public.activity_events where correlation_id = '82000000-0000-0000-0000-000000000004') = 0, 'actor mismatch rolls back all internal changes');
select throws_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'invalid-times-completion'), '62000000-0000-0000-0000-000000000001', now() + interval '5 days', now() + interval '5 days', 'America/Los_Angeles') $$, '22023', 'valid reschedule times and timezone required', 'invalid reschedule input fails closed');
select ok((select state = 'calendar_pending' from public.job_operation_receipts where idempotency_key = 'invalid-times-completion') and (select version = 3 from public.jobs where id = '72000000-0000-0000-0000-000000000001') and (select count(*) from public.activity_events where correlation_id = '82000000-0000-0000-0000-000000000005') = 0, 'internal validation failure rolls back receipt, job, and audit changes');
reset role;
set local role authenticated;
select throws_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'invalid-times-completion'), '62000000-0000-0000-0000-000000000001', now() + interval '5 days', now() + interval '5 days 1 hour', 'America/Los_Angeles') $$, '42501', 'permission denied for function command_complete_job_calendar_operation', 'browser role is denied completion helper execution');
reset role;
select * from finish();
rollback;
