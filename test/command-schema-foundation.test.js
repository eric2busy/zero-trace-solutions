const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260829040000_command_operational_foundation.sql'),
  'utf8',
);
const foundationTest = fs.readFileSync(
  path.join(root, 'supabase/tests/command_operational_foundation.sql'),
  'utf8',
);

test('Command operational migration remains limited to the four approved foundation tables', () => {
  for (const table of ['actors', 'activity_events', 'approvals', 'integration_outbox']) {
    assert.match(migration, new RegExp(`create table public\\.${table} \\(`));
  }
  for (const outOfScopeTable of ['customers', 'organizations', 'leads', 'bookings', 'jobs', 'payments']) {
    assert.doesNotMatch(migration, new RegExp(`create table public\\.${outOfScopeTable} \\(`));
  }
});

test('Command operational migration denies browser access and protects audit history', () => {
  for (const table of ['actors', 'activity_events', 'approvals', 'integration_outbox']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
  }
  assert.match(migration, /activity events are immutable/);
  assert.match(migration, /an approval decision is immutable/);
  assert.match(foundationTest, /select plan\(26\)/);
});

test('customers and companies migration is scoped, private, and covered by pgTAP', () => {
  const crmMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260829050000_customers_companies_command.sql'), 'utf8');
  const crmTest = fs.readFileSync(path.join(root, 'supabase/tests/customers_companies_command.sql'), 'utf8');
  for (const table of ['organizations', 'customers', 'customer_contacts', 'service_locations']) {
    assert.match(crmMigration, new RegExp(`create table public\\.${table} \\(`));
    assert.match(crmMigration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(crmMigration, /revoke all on table public\.organizations, public\.customers, public\.customer_contacts, public\.service_locations from anon, authenticated/);
  assert.match(crmMigration, /raw_app_meta_data|app metadata|app_metadata/i);
  assert.doesNotMatch(crmMigration, /create table public\.(leads|bookings|jobs|payments) \(/);
  assert.match(crmTest, /select plan\(34\)/);
  assert.match(crmMigration, /foreign key \(customer_id, organization_id\)/);
  assert.match(crmMigration, /command_is_iana_timezone/);
  assert.match(crmTest, /'a service location rejects a customer from another organization'/);
});
