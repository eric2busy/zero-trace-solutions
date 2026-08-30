begin;
select plan(31);
select has_table('public', 'jobs'); select has_table('public', 'job_assignments'); select has_table('public', 'job_notes');
select col_is_pk('public', 'jobs', 'id'); select col_not_null('public', 'jobs', 'kind');
select col_not_null('public', 'jobs', 'status'); select col_not_null('public', 'jobs', 'service_details');
select col_not_null('public', 'jobs', 'correlation_id'); select col_not_null('public', 'jobs', 'created_at');
select col_not_null('public', 'jobs', 'updated_at'); select col_not_null('public', 'jobs', 'version');
select row_security_active('public.jobs'); select row_security_active('public.job_assignments'); select row_security_active('public.job_notes');
select policies_are('public', 'jobs', array['No direct job access']);
select policies_are('public', 'job_assignments', array['No direct job assignment access']);
select policies_are('public', 'job_notes', array['No direct job note access']);
select table_privs_are('public', 'jobs', 'authenticated', array[]::text[]);
select table_privs_are('public', 'job_assignments', 'authenticated', array[]::text[]);
select table_privs_are('public', 'job_notes', 'authenticated', array[]::text[]);
select table_privs_are('public', 'jobs', 'anon', array[]::text[]);
select table_privs_are('public', 'job_assignments', 'anon', array[]::text[]);
select table_privs_are('public', 'job_notes', 'anon', array[]::text[]);
select has_index('public', 'jobs', 'jobs_source_idempotency_key_idx');
select has_index('public', 'jobs', 'jobs_schedule_idx');
select has_index('public', 'job_assignments', 'job_assignments_active_role_idx');
select has_index('public', 'job_notes', 'job_notes_idempotency_key_idx');
select lives_ok($$
  insert into public.organizations (id, display_name) values ('30000000-0000-0000-0000-000000000001', 'Job organization');
  insert into public.customers (id, organization_id, display_name) values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Job customer');
  insert into public.service_locations (id, organization_id, customer_id, label, address_line_1, city, region, postal_code, timezone)
  values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Job site', '1 Main', 'Portland', 'OR', '97201', 'America/Los_Angeles');
  insert into public.jobs (kind, status, customer_id, organization_id, service_location_id, title, scheduled_start_at, scheduled_end_at, scheduled_timezone, source_system, source_record_id, idempotency_key)
  values ('service_visit', 'scheduled', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Fixture visit', '2026-09-01 16:00:00+00', '2026-09-01 17:00:00+00', 'America/Los_Angeles', 'google_calendar', 'fixture-event-1', 'fixture-1');
$$, 'a scheduled job accepts matching customer, organization, location, and timezone');
select throws_ok($$
  insert into public.jobs (kind, status, customer_id, title) values ('service_visit', 'scheduled', '40000000-0000-0000-0000-000000000001', 'Missing schedule');
$$, '23514', null, 'scheduled lifecycle state requires an appointment instant');
select throws_ok($$
  insert into public.jobs (kind, status, customer_id, title, scheduled_start_at, scheduled_end_at, scheduled_timezone)
  values ('service_visit', 'scheduled', '40000000-0000-0000-0000-000000000001', 'Wrong order', '2026-09-01 17:00:00+00', '2026-09-01 16:00:00+00', 'America/Los_Angeles');
$$, '23514', null, 'a job rejects an inverted appointment interval');
select throws_ok($$
  insert into public.jobs (kind, status, customer_id, title, scheduled_start_at, scheduled_end_at, scheduled_timezone)
  values ('service_visit', 'scheduled', '40000000-0000-0000-0000-000000000001', 'Bad timezone', '2026-09-01 16:00:00+00', '2026-09-01 17:00:00+00', 'Mars/Olympus_Mons');
$$, '23514', null, 'a job rejects a timezone outside the installed IANA database');
select * from finish();
rollback;
