const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const commandData = require('../api/_lib/command-data');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260831015000_command_job_notes_operations.sql'), 'utf8');
const client = fs.readFileSync(path.join(root, 'command/job-notes.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'api/command.js'), 'utf8');

function response(ok, payload, status = ok ? 200 : 400) { return { ok, status, json: async () => payload }; }

test('prepared note operation is append-only, server-only, atomic, and replay-safe', () => {
  assert.match(migration, /PREPARED ONLY/);
  assert.match(migration, /create function public\.command_create_job_note/);
  assert.match(migration, /insert into public\.job_notes/);
  assert.match(migration, /insert into public\.activity_events/);
  assert.match(migration, /on conflict \(job_id, idempotency_key\) do nothing/);
  assert.match(migration, /revoke all on function public\.command_create_job_note[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.command_create_job_note[\s\S]*to service_role/);
  assert.match(migration, /p_require_active_assignment/);
  assert.match(migration, /active assignment required/);
});

test('note validation admits only a UUID job, UUID retry key, and bounded body', () => {
  assert.deepEqual(commandData.validateJobNote({
    jobId: '40000000-0000-4000-8000-000000000001', body: '  Arrival   confirmed. ', idempotencyKey: '50000000-0000-4000-8000-000000000001',
  }), { ok: true, value: { jobId: '40000000-0000-4000-8000-000000000001', body: 'Arrival confirmed.', idempotencyKey: '50000000-0000-4000-8000-000000000001' } });
  assert.equal(commandData.validateJobNote({ jobId: 'bad', body: 'x', idempotencyKey: '50000000-0000-4000-8000-000000000001' }).error, 'invalid_job_id');
  assert.equal(commandData.validateJobNote({ jobId: '40000000-0000-4000-8000-000000000001', body: '', idempotencyKey: '50000000-0000-4000-8000-000000000001' }).error, 'invalid_note_body');
  assert.equal(commandData.validateJobNote({ jobId: '40000000-0000-4000-8000-000000000001', body: 'x', idempotencyKey: 'not-a-key' }).error, 'invalid_idempotency_key');
});

test('note creation uses only the narrow atomic RPC and technician assignment guard', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  const calls = []; const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/actors?')) return response(true, [{ id: '60000000-0000-4000-8000-000000000001' }]);
    if (url.includes('/job_assignments?')) return response(true, [{ id: '70000000-0000-4000-8000-000000000001' }]);
    if (url.endsWith('/rest/v1/rpc/command_create_job_note')) return response(true, [{ id: '80000000-0000-4000-8000-000000000001', replayed: false }], 201);
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await commandData.createJobNote({ authUserId: 'cb385874-e7ed-4608-b58c-08324f15483c', role: 'technician', input: { jobId: '40000000-0000-4000-8000-000000000001', body: 'Ready for service.', idempotencyKey: '50000000-0000-4000-8000-000000000001' } });
  global.fetch = originalFetch; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
  assert.equal(result.state, 'created');
  const rpc = calls.find(call => call.url.endsWith('/rest/v1/rpc/command_create_job_note'));
  assert.ok(rpc); const body = JSON.parse(rpc.options.body);
  assert.equal(body.p_require_active_assignment, true);
  assert.equal(body.p_body, 'Ready for service.');
  assert.equal(calls.some(call => call.url.endsWith('/rest/v1/job_notes') && call.options.method === 'POST'), false);
  assert.equal(calls.some(call => call.url.endsWith('/rest/v1/activity_events') && call.options.method === 'POST'), false);
});

test('mobile notes UI uses only the authenticated Command API and retains its retry key after failure', () => {
  assert.match(route, /job-notes\.js/);
  assert.match(client, /\/api\/command-data\?resource=notes/);
  assert.match(client, /\/api\/command-data\?resource=note/);
  assert.match(client, /crypto\.randomUUID/);
  assert.match(client, /maxlength="2000"/);
  assert.doesNotMatch(client, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|\/rest\/v1\//i);
});
