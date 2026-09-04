const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const commandData = require('../api/_lib/command-data');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260904150000_command_create_service_job_from_walkthrough.sql'), 'utf8');
const route = fs.readFileSync(path.join(root, 'api/command-data.js'), 'utf8');
const creationUi = fs.readFileSync(path.join(root, 'command/service-job-creation.js'), 'utf8');
const jobsUi = fs.readFileSync(path.join(root, 'command/job-editing.js'), 'utf8');
const customersUi = fs.readFileSync(path.join(root, 'command/customer-editing.js'), 'utf8');

function response(ok, payload, status = ok ? 200 : 400) { return { ok, status, json: async () => payload }; }

test.beforeEach(() => { process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_test'; });
test.afterEach(() => { delete global.fetch; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; });

test('creates one draft service visit from a completed walkthrough through a server-only atomic operation', () => {
  assert.match(migration, /v_walkthrough\.kind <> 'walkthrough' or v_walkthrough\.status <> 'completed'/);
  assert.match(migration, /'service_visit', 'draft', v_walkthrough\.customer_id, v_walkthrough\.organization_id/);
  assert.match(migration, /v_walkthrough\.service_location_id/);
  assert.match(migration, /source_record_id := 'walkthrough:' \|\| v_walkthrough\.id::text/);
  assert.match(migration, /on conflict \(source_system, source_record_id\)/);
  assert.match(migration, /job\.service_created_from_walkthrough/);
  assert.match(migration, /grant execute .*command_create_service_job_from_walkthrough.*service_role/);
  assert.doesNotMatch(migration, /googleapis|calendar\.events/i);
});

test('validates the create-service-job payload without accepting client, location, schedule, or price fields', () => {
  assert.deepEqual(commandData.validateServiceJobCreation({ walkthroughJobId: '40000000-0000-4000-8000-000000000001', title: '  Evening  sanitization ', scope: '  Reception and treatment rooms ', idempotencyKey: '50000000-0000-4000-8000-000000000001' }), { ok: true, value: { walkthroughJobId: '40000000-0000-4000-8000-000000000001', title: 'Evening sanitization', scope: 'Reception and treatment rooms', idempotencyKey: '50000000-0000-4000-8000-000000000001' } });
  assert.equal(commandData.validateServiceJobCreation({ walkthroughJobId: '40000000-0000-4000-8000-000000000001', title: 'Visit', scope: '', idempotencyKey: '50000000-0000-4000-8000-000000000001', customerId: 'duplicate-client' }).error, 'unsupported_field');
});

test('calls the canonical RPC then returns the linked draft job without creating a customer or location', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/actors?')) return response(true, [{ id: '60000000-0000-4000-8000-000000000001' }]);
    if (url.endsWith('/rest/v1/rpc/command_create_service_job_from_walkthrough')) return response(true, [{ job_id: '70000000-0000-4000-8000-000000000001', job_version: 1, replayed: false, correlation_id: '80000000-0000-4000-8000-000000000001' }], 201);
    if (url.includes('/jobs?select=') && url.includes('id=eq.70000000')) return response(true, [{ id: '70000000-0000-4000-8000-000000000001', kind: 'service_visit', status: 'draft', customer_id: 'customer-1', service_location_id: 'location-1', title: 'Service visit', version: 1 }]);
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await commandData.createServiceJobFromWalkthrough({ authUserId: 'cb385874-e7ed-4608-b58c-08324f15483c', input: { walkthroughJobId: '40000000-0000-4000-8000-000000000001', title: 'Service visit', scope: 'Lobby', idempotencyKey: '50000000-0000-4000-8000-000000000001' } });
  assert.equal(result.state, 'created'); assert.equal(result.job.kind, 'service_visit');
  const rpc = calls.find(call => call.url.endsWith('/rest/v1/rpc/command_create_service_job_from_walkthrough'));
  assert.equal(JSON.parse(rpc.options.body).p_walkthrough_job_id, '40000000-0000-4000-8000-000000000001');
  assert.equal(calls.some(call => /\/(customers|service_locations)(\?|$)/.test(call.url) && call.options.method === 'POST'), false);
});

test('limits conversion to Owner/Admin while keeping existing schedule contract and client history visible', () => {
  assert.match(route, /SERVICE_JOB_WRITE_ROLES = CUSTOMER_WRITE_ROLES/);
  assert.match(route, /resource === 'service-job' && !SERVICE_JOB_WRITE_ROLES\.has\(identity\.role\)/);
  assert.match(creationUi, /\['owner', 'admin'\]/); assert.match(creationUi, /Create service job/); assert.match(creationUi, /Calendar workflow/);
  assert.doesNotMatch(creationUi, /api\/command-calendar/);
  assert.match(jobsUi, /job\.kind === 'walkthrough' && job\.status === 'completed'/);
  assert.match(customersUi, /Operational history/); assert.match(customersUi, /data\.jobs/);
});
