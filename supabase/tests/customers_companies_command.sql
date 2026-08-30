begin;
select plan(34);
select has_table('public'::name, 'organizations'::name); select has_table('public'::name, 'customers'::name);
select has_table('public'::name, 'customer_contacts'::name); select has_table('public'::name, 'service_locations'::name);
select col_is_pk('public'::name, 'organizations'::name, 'id'::name); select col_is_pk('public'::name, 'customers'::name, 'id'::name);
select col_not_null('public'::name, 'customer_contacts'::name, 'value'::name); select col_not_null('public'::name, 'customer_contacts'::name, 'normalized_value'::name);
select col_not_null('public'::name, 'service_locations'::name, 'address_line_1'::name);
select ok((select relrowsecurity from pg_class where oid = 'public.organizations'::regclass), 'organizations has row-level security enabled'); select ok((select relrowsecurity from pg_class where oid = 'public.customers'::regclass), 'customers has row-level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.customer_contacts'::regclass), 'customer_contacts has row-level security enabled'); select ok((select relrowsecurity from pg_class where oid = 'public.service_locations'::regclass), 'service_locations has row-level security enabled');
select policies_are('public', 'organizations', array['No direct organization access']::name[]);
select policies_are('public', 'customers', array['No direct customer access']::name[]);
select policies_are('public', 'customer_contacts', array['No direct customer contact access']::name[]);
select policies_are('public', 'service_locations', array['No direct service location access']::name[]);
select table_privs_are('public', 'organizations', 'authenticated', array[]::name[]);
select table_privs_are('public', 'customers', 'authenticated', array[]::name[]);
select table_privs_are('public', 'customer_contacts', 'authenticated', array[]::name[]);
select table_privs_are('public', 'service_locations', 'authenticated', array[]::name[]);
select table_privs_are('public', 'organizations', 'anon', array[]::name[]);
select table_privs_are('public', 'customers', 'anon', array[]::name[]);
select table_privs_are('public', 'customer_contacts', 'anon', array[]::name[]);
select table_privs_are('public', 'service_locations', 'anon', array[]::name[]);
select has_index('public'::name, 'customer_contacts'::name, 'customer_contacts_primary_customer_kind_idx'::name);
select has_index('public'::name, 'customer_contacts'::name, 'customer_contacts_primary_organization_kind_idx'::name);
select has_index('public'::name, 'customers'::name, 'customers_organization_id_idx'::name);
select has_index('public'::name, 'service_locations'::name, 'service_locations_organization_id_idx'::name);
select has_index('public'::name, 'service_locations'::name, 'service_locations_customer_id_idx'::name);
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
