begin;
select plan(34);
select has_table('public', 'organizations'); select has_table('public', 'customers');
select has_table('public', 'customer_contacts'); select has_table('public', 'service_locations');
select col_is_pk('public', 'organizations', 'id'); select col_is_pk('public', 'customers', 'id');
select col_not_null('public', 'customer_contacts', 'value'); select col_not_null('public', 'customer_contacts', 'normalized_value');
select col_not_null('public', 'service_locations', 'address_line_1');
select row_security_active('public.organizations'); select row_security_active('public.customers');
select row_security_active('public.customer_contacts'); select row_security_active('public.service_locations');
select policies_are('public', 'organizations', array['No direct organization access']);
select policies_are('public', 'customers', array['No direct customer access']);
select policies_are('public', 'customer_contacts', array['No direct customer contact access']);
select policies_are('public', 'service_locations', array['No direct service location access']);
select table_privs_are('public', 'organizations', 'authenticated', array[]::text[]);
select table_privs_are('public', 'customers', 'authenticated', array[]::text[]);
select table_privs_are('public', 'customer_contacts', 'authenticated', array[]::text[]);
select table_privs_are('public', 'service_locations', 'authenticated', array[]::text[]);
select table_privs_are('public', 'organizations', 'anon', array[]::text[]);
select table_privs_are('public', 'customers', 'anon', array[]::text[]);
select table_privs_are('public', 'customer_contacts', 'anon', array[]::text[]);
select table_privs_are('public', 'service_locations', 'anon', array[]::text[]);
select has_index('public', 'customer_contacts', 'customer_contacts_primary_customer_kind_idx');
select has_index('public', 'customer_contacts', 'customer_contacts_primary_organization_kind_idx');
select has_index('public', 'customers', 'customers_organization_id_idx');
select has_index('public', 'service_locations', 'service_locations_organization_id_idx');
select has_index('public', 'service_locations', 'service_locations_customer_id_idx');
select lives_ok(
  $$
    insert into public.organizations (id, display_name)
    values ('10000000-0000-0000-0000-000000000001', 'Matching organization');
    insert into public.customers (id, organization_id, display_name)
    values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Matching customer');
    insert into public.service_locations (organization_id, customer_id, label, address_line_1, city, region, postal_code, timezone)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Matching site', '1 Main St', 'Portland', 'OR', '97201', 'America/Los_Angeles');
  $$,
  'a service location accepts matching customer and organization ownership'
);
select throws_ok(
  $$
    insert into public.organizations (id, display_name)
    values ('10000000-0000-0000-0000-000000000002', 'Different organization');
    insert into public.service_locations (organization_id, customer_id, label, address_line_1, city, region, postal_code)
    values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Mismatched site', '2 Main St', 'Portland', 'OR', '97201');
  $$,
  '23503',
  null,
  'a service location rejects a customer from another organization'
);
select throws_ok(
  $$
    insert into public.service_locations (label, address_line_1, city, region, postal_code)
    values ('Unowned site', '3 Main St', 'Portland', 'OR', '97201');
  $$,
  '23514',
  null,
  'a service location requires at least one owner'
);
select throws_ok(
  $$
    insert into public.service_locations (customer_id, label, address_line_1, city, region, postal_code, timezone)
    values ('20000000-0000-0000-0000-000000000001', 'Bad timezone site', '4 Main St', 'Portland', 'OR', '97201', 'Mars/Olympus_Mons');
  $$,
  '23514',
  null,
  'a service location rejects a timezone outside the installed IANA database'
);
select * from finish();
rollback;
