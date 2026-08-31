begin;
select plan(7);
select has_function('public', 'command_complete_job_calendar_operation', array['uuid', 'uuid', 'timestamptz', 'timestamptz', 'text']);
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
select throws_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'complete-reschedule'), '62000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days 1 hour', 'America/Los_Angeles') $$, 'P0001', 'job operation receipt is already terminal', 'terminal completion cannot duplicate job or audit');
reset role;
select * from finish();
rollback;
