begin;
select plan(15);

select has_function('public', 'command_complete_job_calendar_operation', array['uuid', 'uuid', 'timestamptz', 'timestamptz', 'text', 'text']);
select function_privs_are('public', 'command_complete_job_calendar_operation', array['uuid', 'uuid', 'timestamptz', 'timestamptz', 'text', 'text'], 'anon', array[]::name[], 'browser role cannot complete an initial schedule');
select function_privs_are('public', 'command_complete_job_calendar_operation', array['uuid', 'uuid', 'timestamptz', 'timestamptz', 'text', 'text'], 'authenticated', array[]::name[], 'authenticated browser role cannot complete an initial schedule');

insert into public.organizations (id, display_name) values ('33000000-0000-0000-0000-000000000001', 'Initial schedule organization');
insert into public.customers (id, organization_id, display_name) values ('43000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', 'Initial schedule customer');
insert into public.actors (id, kind, display_name, service_key) values ('63000000-0000-0000-0000-000000000001', 'service', 'Initial schedule worker', 'initial-schedule-worker');
insert into public.jobs (id, kind, status, customer_id, organization_id, title)
values ('73000000-0000-0000-0000-000000000001', 'walkthrough', 'draft', '43000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', 'Existing walkthrough');

set local role service_role;
select lives_ok($$ select * from public.command_reserve_job_operation('73000000-0000-0000-0000-000000000001', 'initial-schedule', 'schedule', '63000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1, '{"operation":"schedule"}'::jsonb) $$, 'an unscheduled draft job reserves an initial schedule receipt');
select is((select state::text from public.job_operation_receipts where idempotency_key = 'initial-schedule'), 'calendar_pending', 'initial schedule receipt starts pending');
select is((select replayed from public.command_reserve_job_operation('73000000-0000-0000-0000-000000000001', 'initial-schedule', 'schedule', '63000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1, '{"operation":"schedule"}'::jsonb)), true, 'matching initial schedule retry replays its receipt before provider mutation');
select throws_ok($$ select * from public.command_reserve_job_operation('73000000-0000-0000-0000-000000000001', 'initial-schedule', 'reschedule', '63000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', 1, '{"operation":"schedule"}'::jsonb) $$, 'P0001', 'calendar-backed job required', 'an unscheduled job cannot be reserved as a reschedule');
select lives_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'initial-schedule'), '63000000-0000-0000-0000-000000000001', '2026-09-15 16:00:00+00', '2026-09-15 17:00:00+00', 'America/Los_Angeles', 'calendar-event-initial') $$, 'initial schedule completes through the canonical receipt path');
select ok((select status = 'scheduled' and calendar_event_id = 'calendar-event-initial' and scheduled_start_at = '2026-09-15 16:00:00+00'::timestamptz and scheduled_end_at = '2026-09-15 17:00:00+00'::timestamptz and scheduled_timezone = 'America/Los_Angeles' and version = 2 from public.jobs where id = '73000000-0000-0000-0000-000000000001'), 'completion transitions the same canonical job to scheduled with Calendar linkage and timezone');
select is((select state::text from public.job_operation_receipts where idempotency_key = 'initial-schedule'), 'succeeded', 'initial schedule receipt becomes terminal success');
select is((select count(*) from public.activity_events where action = 'job.calendar_operation.completed' and target_id = '73000000-0000-0000-0000-000000000001'), 1::bigint, 'initial schedule completion is audited once');
select throws_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'initial-schedule'), '63000000-0000-0000-0000-000000000001', '2026-09-16 16:00:00+00', '2026-09-16 17:00:00+00', 'America/Los_Angeles', 'calendar-event-second') $$, 'P0001', 'job operation receipt is already terminal', 'a completed initial schedule cannot be applied twice');

insert into public.jobs (id, kind, status, customer_id, organization_id, title)
values ('73000000-0000-0000-0000-000000000002', 'walkthrough', 'draft', '43000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', 'Missing event walkthrough');
select lives_ok($$ select * from public.command_reserve_job_operation('73000000-0000-0000-0000-000000000002', 'missing-event', 'schedule', '63000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002', 1, '{}'::jsonb) $$, 'second draft job reserves a receipt for validation coverage');
select throws_ok($$ select * from public.command_complete_job_calendar_operation((select id from public.job_operation_receipts where idempotency_key = 'missing-event'), '63000000-0000-0000-0000-000000000001', '2026-09-17 16:00:00+00', '2026-09-17 17:00:00+00', 'America/Los_Angeles', null) $$, 'P0001', 'unscheduled draft job and calendar event required', 'initial schedule fails closed without the Calendar event linkage');
select ok((select state = 'calendar_pending' from public.job_operation_receipts where idempotency_key = 'missing-event') and (select status = 'draft' and calendar_event_id is null and version = 1 from public.jobs where id = '73000000-0000-0000-0000-000000000002'), 'failed completion leaves the receipt and unscheduled job unchanged');
reset role;
select * from finish();
rollback;
