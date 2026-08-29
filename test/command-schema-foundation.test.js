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
