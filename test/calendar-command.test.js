const test = require('node:test');
const assert = require('node:assert/strict');
const calendarCommand = require('../api/_lib/calendar-command');
const receipts = require('../api/_lib/calendar-operation-receipts');
const commandData = require('../api/_lib/command-data');

test('calendar operation input rejects malformed schedules and cancel schedule values', () => {
  assert.equal(calendarCommand.validateInput({ jobId: 'bad', operation: 'cancel', idempotencyKey: 'a', version: 1 }).ok, false);
  assert.equal(calendarCommand.validateInput({ jobId: '40000000-0000-4000-8000-000000000001', operation: 'reschedule', idempotencyKey: 'a', version: 1, startAt: 'nope', endAt: '2026-09-01T12:00:00Z', timezone: 'America/Los_Angeles' }).error, 'invalid_schedule');
  assert.equal(calendarCommand.validateInput({ jobId: '40000000-0000-4000-8000-000000000001', operation: 'cancel', idempotencyKey: 'a', version: 1, timezone: 'America/Los_Angeles' }).error, 'cancel_has_schedule');
});

test('initial schedule is a supported canonical operation and non-writers are denied', () => {
  const input = { jobId: '40000000-0000-4000-8000-000000000001', operation: 'schedule', idempotencyKey: 'a', version: 1, startAt: '2026-09-01T12:00:00Z', endAt: '2026-09-01T13:00:00Z', timezone: 'America/Los_Angeles' };
  assert.equal(calendarCommand.validateInput(input).ok, true);
  return assert.rejects(() => calendarCommand.executeCalendarOperation({ role: 'operator', authUserId: 'auth-user', input }), { code: 'insufficient_role' });
});

test('initial schedule creates one Calendar event for the existing draft job and completes its receipt', async () => {
  const originals = { actorForAuthUser: commandData.actorForAuthUser, readJson: commandData.readJson, reserveOperation: receipts.reserveOperation, completeOperation: receipts.completeOperation };
  const oldUrl = process.env.SUPABASE_URL; const oldKey = process.env.SUPABASE_SECRET_KEY; let completed; let inserted = 0;
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
  commandData.actorForAuthUser = async () => '60000000-0000-4000-8000-000000000001';
  commandData.readJson = async () => [{ id: '40000000-0000-4000-8000-000000000001', title: 'Existing walkthrough', status: 'draft', calendar_event_id: null, scheduled_start_at: null, scheduled_end_at: null, version: 1 }];
  receipts.reserveOperation = async () => [{ receipt_id: 'receipt', state: 'calendar_pending', replayed: false, correlation_id: '80000000-0000-4000-8000-000000000001' }];
  receipts.completeOperation = async value => { completed = value; return [{ job_id: value.receiptId }]; };
  const provider = { events: { list: async () => ({ data: { items: [] } }), insert: async () => { inserted += 1; return { data: { id: 'new-calendar-event' } }; } } };
  try { const result = await calendarCommand.executeCalendarOperation({ role: 'owner', authUserId: 'auth-user', input: { jobId: '40000000-0000-4000-8000-000000000001', operation: 'schedule', idempotencyKey: 'new-key', version: 1, startAt: '2026-09-01T12:00:00Z', endAt: '2026-09-01T13:00:00Z', timezone: 'America/Los_Angeles' }, calendar: provider }); assert.equal(result.state, 'succeeded'); assert.equal(inserted, 1); assert.equal(completed.calendarEventId, 'new-calendar-event'); assert.equal(completed.receiptId, 'receipt'); } finally { Object.assign(commandData, { actorForAuthUser: originals.actorForAuthUser, readJson: originals.readJson }); Object.assign(receipts, { reserveOperation: originals.reserveOperation, completeOperation: originals.completeOperation }); if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl; if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldKey; }
});

test('Calendar command has no provider fallback when credentials are absent', () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL; delete process.env.GOOGLE_PRIVATE_KEY; delete process.env.GOOGLE_CALENDAR_ID;
  assert.equal(calendarCommand.configured(), false);
});

test('a replayed pending receipt is reconciled without a second Calendar mutation', async () => {
  const originals = { actorForAuthUser: commandData.actorForAuthUser, readJson: commandData.readJson, reserveOperation: receipts.reserveOperation, markOperationForReconciliation: receipts.markOperationForReconciliation };
  const originalUrl = process.env.SUPABASE_URL; const originalKey = process.env.SUPABASE_SECRET_KEY;
  let providerCalls = 0; let reconciliation;
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
  commandData.actorForAuthUser = async () => '60000000-0000-4000-8000-000000000001';
  commandData.readJson = async () => [{ id: '40000000-0000-4000-8000-000000000001', status: 'scheduled', calendar_event_id: 'event', version: 1 }];
  receipts.reserveOperation = async () => [{ receipt_id: 'receipt', state: 'calendar_pending', replayed: true, correlation_id: '80000000-0000-4000-8000-000000000001' }];
  receipts.markOperationForReconciliation = async value => { reconciliation = value; };
  try {
    const result = await calendarCommand.executeCalendarOperation({ role: 'owner', authUserId: 'auth-user', input: { jobId: '40000000-0000-4000-8000-000000000001', operation: 'cancel', idempotencyKey: 'same-key', version: 1 }, calendar: { events: { get: async () => { providerCalls += 1; } } } });
    assert.deepEqual(result, { state: 'reconciliation_needed', replayed: true, correlationId: '80000000-0000-4000-8000-000000000001' });
    assert.equal(providerCalls, 0);
    assert.deepEqual(reconciliation, { receiptId: 'receipt', actorId: '60000000-0000-4000-8000-000000000001', errorCode: 'idempotency_replay_requires_reconciliation' });
  } finally { Object.assign(commandData, { actorForAuthUser: originals.actorForAuthUser, readJson: originals.readJson }); Object.assign(receipts, { reserveOperation: originals.reserveOperation, markOperationForReconciliation: originals.markOperationForReconciliation }); if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl; if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalKey; }
});
