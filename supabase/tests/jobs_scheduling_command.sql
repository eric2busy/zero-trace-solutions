begin;
select plan(45);
select has_table('public'::name, 'jobs'::name); select has_table('public'::name, 'job_assignments'::name); select has_table('public'::name, 'job_notes'::name);
select col_is_pk('public'::name, 'jobs'::name, 'id'::name); select col_not_null('public'::name, 'jobs'::name, 'kind'::name);
select col_not_null('public'::name, 'jobs'::name, 'status'::name); select col_not_null('public'::name, 'jobs'::name, 'service_details'::name);
select col_not_null('public'::name, 'jobs'::name, 'correlation_id'::name); select col_not_null('public'::name, 'jobs'::name, 'created_at'::name);
select col_not_null('public'::name, 'jobs'::name, 'updated_at'::name); select col_not_null('public'::name, 'jobs'::name, 'version'::name);
select ok((select relrowsecurity from pg_class where oid = 'public.jobs'::regclass), 'jobs has row-level security enabled'); select ok((select relrowsecurity from pg_class where oid = 'public.job_assignments'::regclass), 'job_assignments has row-level security enabled'); select ok((select relrowsecurity from pg_class where oid = 'public.job_notes'::regclass), 'job_notes has row-level security enabled');
select policies_are('public', 'jobs', array['No direct job access']::name[]);
select policies_are('public', 'job_assignments', array['No direct job assignment access']::name[]);
select policies_are('public', 'job_notes', array['No direct job note access']::name[]);
select table_privs_are('public', 'jobs', 'authenticated', array[]::name[]);
select table_privs_are('public', 'job_assignments', 'authenticated', array[]::name[]);
select table_privs_are('public', 'job_notes', 'authenticated', array[]::name[]);
select table_privs_are('public', 'jobs', 'anon', array[]::name[]);
select table_privs_are('public', 'job_assignments', 'anon', array[]::name[]);
select table_privs_are('public', 'job_notes', 'anon', array[]::name[]);
select has_index('public'::name, 'jobs'::name, 'jobs_source_idempotency_key_idx'::name);
select has_index('public'::name, 'jobs'::name, 'jobs_source_record_id_idx'::name);
select has_index('public'::name, 'jobs'::name, 'jobs_schedule_idx'::name);
select has_index('public'::name, 'job_assignments'::name, 'job_assignments_active_role_idx'::name);
select has_index('public'::name, 'job_notes'::name, 'job_notes_idempotency_key_idx'::name);
select lives_ok($$
  insert into public.organizations (id, display_name) values ('30000000-0000-0000-0000-000000000001', 'Job organization');
  insert into public.customers (id, organization_id, display_name) values ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Job customer');
  insert into public.service_locations (id, organization_id, customer_id, label, address_line_1, city, region, postal_code, timezone)
  values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Job site', '1 Main', 'Portland', 'OR', '97201', 'America/Los_Angeles');
  insert into public.jobs (kind, status, customer_id, organization_id, service_location_id, title, scheduled_start_at, scheduled_end_at, scheduled_timezone, source_system, source_record_id, idempotency_key)
  values ('service_visit', 'scheduled', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'Fixture visit', '2026-09-01 16:00:00+00', '2026-09-01 17:00:00+00', 'America/Los_Angeles', 'google_calendar', 'fixture-event-1', 'fixture-1');
$$, 'a scheduled job accepts matching customer, organization, location, and timezone');
select lives_ok($$
  insert into public.jobs (kind, customer_id, organization_id, title)
  values ('walkthrough', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Matching customer and organization without a location');
$$, 'a job accepts matching customer and organization without a service location');
select throws_ok($$
  insert into public.organizations (id, display_name) values ('30000000-0000-0000-0000-000000000002', 'Other organization');
  insert into public.jobs (kind, customer_id, organization_id, title)
  values ('walkthrough', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Mismatched customer organization');
$$, 'P0001', 'job customer and organization must match', 'a job rejects a customer from another organization without a service location');
select throws_ok($$
  insert into public.service_locations (id, organization_id, label, address_line_1, city, region, postal_code, timezone)
  values ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'Organization-only site', '2 Main', 'Portland', 'OR', '97201', 'America/Los_Angeles');
  insert into public.jobs (kind, customer_id, organization_id, service_location_id, title)
  values ('walkthrough', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'Mismatched location owner');
$$, 'P0001', 'job customer, organization, and service location must match', 'a job separately rejects a mismatched service location');
select lives_ok($$
  insert into public.jobs (kind, customer_id, organization_id, title, source_system, source_record_id)
  values ('walkthrough', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Notion source one', 'notion', 'fixture-page-1');
$$, 'a source record is accepted for its source system');
select throws_ok($$
  insert into public.jobs (kind, customer_id, organization_id, title, source_system, source_record_id)
  values ('walkthrough', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Notion source duplicate', 'notion', 'fixture-page-1');
$$, '23505', null, 'a source record cannot produce duplicate canonical jobs in one source system');
select lives_ok($$
  insert into public.jobs (kind, customer_id, organization_id, title, source_system, source_record_id)
  values ('walkthrough', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Calendar source same external value', 'google_calendar', 'fixture-page-1');
$$, 'the same source record value is allowed for a different source system');
select lives_ok($$
  insert into public.jobs (kind, customer_id, organization_id, title)
  values ('walkthrough', '40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Manual source without a provider record');
$$, 'a manual job without a source record remains valid');
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
select throws_ok($$
  insert into public.jobs (kind, status, customer_id, title, completed_at)
  values ('service_visit', 'draft', '40000000-0000-0000-0000-000000000001', 'Premature completion timestamp', now());
$$, '23514', null, 'a completion timestamp requires completed status');
select throws_ok($$
  insert into public.jobs (kind, status, customer_id, title, cancelled_at)
  values ('service_visit', 'draft', '40000000-0000-0000-0000-000000000001', 'Premature cancellation timestamp', now());
$$, '23514', null, 'a cancellation timestamp requires cancelled status');
select lives_ok($$
  insert into public.actors (id, kind, display_name, service_key)
  values ('60000000-0000-0000-0000-000000000001', 'service', 'Fixture worker', 'fixture-worker');
  insert into public.job_assignments (job_id, actor_id, assignment_role)
  select id, '60000000-0000-0000-0000-000000000001', 'lead' from public.jobs where title = 'Fixture visit';
  update public.job_assignments set unassigned_at = now()
  where actor_id = '60000000-0000-0000-0000-000000000001';
  insert into public.job_assignments (job_id, actor_id, assignment_role)
  select id, '60000000-0000-0000-0000-000000000001', 'lead' from public.jobs where title = 'Fixture visit';
$$, 'an assignment can be ended before the same role is reassigned');
select throws_ok($$
  insert into public.job_assignments (job_id, actor_id, assignment_role)
  select id, '60000000-0000-0000-0000-000000000001', 'lead' from public.jobs where title = 'Fixture visit';
$$, '23505', null, 'an active assignment role cannot be duplicated');
select lives_ok($$
  insert into public.job_notes (job_id, kind, body)
  select id, 'internal', 'Fixture note' from public.jobs where title = 'Fixture visit';
$$, 'a job note can be appended');
select throws_ok($$
  update public.job_notes set body = 'Changed fixture note' where body = 'Fixture note';
$$, 'P0001', 'job notes are immutable', 'a job note cannot be changed after creation');
select * from finish();
rollback;
