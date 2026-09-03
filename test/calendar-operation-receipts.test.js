const test = require('node:test');
const assert = require('node:assert/strict');
const receipts = require('../api/_lib/calendar-operation-receipts');

function setServerEnv() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
}

test('receipt reservation uses only the server-side RPC contract with actor and correlation attribution', async () => {
  setServerEnv();
  const originalFetch = global.fetch; let observed;
  global.fetch = async (url, options) => { observed = { url, options }; return { ok: true, json: async () => [{ receipt_id: 'receipt-id' }] }; };
  const result = await receipts.reserveOperation({ jobId: 'job-id', idempotencyKey: 'retry-1', operation: 'reschedule', actorId: 'actor-id', correlationId: 'correlation-id', expectedJobVersion: 4, metadata: { requested_by: 'owner' } });
  global.fetch = originalFetch;
  assert.deepEqual(result, [{ receipt_id: 'receipt-id' }]);
  assert.equal(observed.url, 'https://example.supabase.co/rest/v1/rpc/command_reserve_job_operation');
  assert.deepEqual(JSON.parse(observed.options.body), { p_job_id: 'job-id', p_idempotency_key: 'retry-1', p_operation: 'reschedule', p_actor_id: 'actor-id', p_correlation_id: 'correlation-id', p_expected_job_version: 4, p_operation_metadata: { requested_by: 'owner' } });
  assert.equal(observed.options.headers.Authorization, undefined);
});

test('terminal operation helpers persist success or reconciliation through the narrow RPC only', async () => {
  setServerEnv();
  const originalFetch = global.fetch; const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => [] }; };
  await receipts.markOperationSucceeded({ receiptId: 'receipt-id', actorId: 'actor-id' });
  await receipts.markOperationForReconciliation({ receiptId: 'receipt-id', actorId: 'actor-id', errorCode: 'calendar_rollback_failed' });
  global.fetch = originalFetch;
  assert.equal(calls.every(call => call.url.endsWith('/rest/v1/rpc/command_set_job_operation_state')), true);
  assert.deepEqual(calls.map(call => call.body), [
    { p_receipt_id: 'receipt-id', p_actor_id: 'actor-id', p_state: 'succeeded', p_error_code: null },
    { p_receipt_id: 'receipt-id', p_actor_id: 'actor-id', p_state: 'reconciliation_needed', p_error_code: 'calendar_rollback_failed' },
  ]);
});

test('atomic completion uses the dedicated server-only RPC with schedule values and a new Calendar event only for initial scheduling', async () => {
  setServerEnv(); const originalFetch = global.fetch; let observed;
  global.fetch = async (url, options) => { observed = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => [] }; };
  await receipts.completeOperation({ receiptId: 'receipt-id', actorId: 'actor-id', scheduledStartAt: '2026-09-01T17:00:00.000Z', scheduledEndAt: '2026-09-01T18:00:00.000Z', scheduledTimezone: 'America/Los_Angeles', calendarEventId: 'calendar-event-id' });
  global.fetch = originalFetch;
  assert.match(observed.url, /rpc\/command_complete_job_calendar_operation$/);
  assert.deepEqual(observed.body, { p_receipt_id: 'receipt-id', p_actor_id: 'actor-id', p_scheduled_start_at: '2026-09-01T17:00:00.000Z', p_scheduled_end_at: '2026-09-01T18:00:00.000Z', p_scheduled_timezone: 'America/Los_Angeles', p_calendar_event_id: 'calendar-event-id' });
});
