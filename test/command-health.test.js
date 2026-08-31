const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const commandHealth = require('../api/_lib/command-health');
const commandData = require('../api/_lib/command-data');

test('health resource stays behind the existing Command read-role gate', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/command-data.js'), 'utf8');
  assert.match(source, /const READ_ROLES = new Set\(\['owner', 'admin', 'operator'\]\)/);
  assert.match(source, /health:\s*commandHealth\.listHealth/);
  assert.equal(source.includes("'technician'"), false);
});

test('job summary groups states and returns the next upcoming job', () => {
  const now = new Date('2026-08-31T08:00:00.000Z');
  const result = commandHealth.summarizeJobs([
    { id: '1', title: 'Draft', status: 'draft' },
    { id: '2', title: 'Later', status: 'scheduled', scheduled_start_at: '2026-08-31T12:00:00.000Z', scheduled_end_at: '2026-08-31T13:00:00.000Z', scheduled_timezone: 'America/Los_Angeles' },
    { id: '3', title: 'Sooner', status: 'scheduled', scheduled_start_at: '2026-08-31T10:00:00.000Z', scheduled_end_at: '2026-08-31T11:00:00.000Z', scheduled_timezone: 'America/Los_Angeles' },
    { id: '4', title: 'Done', status: 'completed' },
  ], now);

  assert.equal(result.total, 4);
  assert.equal(result.counts.draft, 1);
  assert.equal(result.counts.scheduled, 2);
  assert.equal(result.counts.completed, 1);
  assert.equal(result.active, 3);
  assert.equal(result.nextUpcoming.id, '3');
});

test('approval summary separates pending from expired', () => {
  const now = new Date('2026-08-31T08:00:00.000Z');
  const result = commandHealth.summarizeApprovals([
    { status: 'pending', expires_at: '2026-08-31T09:00:00.000Z' },
    { status: 'pending', expires_at: '2026-08-31T07:00:00.000Z' },
    { status: 'expired', expires_at: '2026-08-30T07:00:00.000Z' },
    { status: 'approved', expires_at: null },
  ], now);

  assert.deepEqual(result, { total: 4, pending: 1, expired: 2 });
});

test('reconciliation and outbox exceptions surface as attention', () => {
  assert.deepEqual(commandHealth.summarizeReceipts([
    { state: 'succeeded' },
    { state: 'reconciliation_needed' },
  ]), { total: 2, reconciliationNeeded: 1, pending: 0, state: 'attention' });

  assert.deepEqual(commandHealth.summarizeOutbox([
    { status: 'pending' },
    { status: 'needs_attention' },
  ]), { total: 2, needsAttention: 1, pending: 1, state: 'attention' });
});

test('activity summary returns only recent failed or blocked events and omits metadata', () => {
  const result = commandHealth.summarizeActivity([
    { id: '1', action: 'job.sync', target_type: 'job', authority_level: 'green', outcome: 'succeeded', error_code: null, created_at: '2026-08-31T08:00:00Z', metadata: { secret: 'nope' } },
    { id: '2', action: 'job.sync', target_type: 'job', authority_level: 'yellow', outcome: 'failed', error_code: 'sync_failed', created_at: '2026-08-31T07:00:00Z', metadata: { secret: 'nope' } },
  ]);

  assert.equal(result.recentExceptions.length, 1);
  assert.equal(result.recentExceptions[0].id, '2');
  assert.equal(Object.hasOwn(result.recentExceptions[0], 'metadata'), false);
});

test('health read fails closed per source and never fabricates provider health', async () => {
  const originalReadJson = commandData.readJson;
  const responses = new Map([
    ['customers', [{ id: 'c1', status: 'active' }]],
    ['jobs', []],
    ['approvals', []],
    ['activity_events', []],
    ['job_operation_receipts', [{ id: 'r1', state: 'reconciliation_needed' }]],
  ]);

  commandData.readJson = async path => {
    const key = [...responses.keys()].find(name => path.startsWith(`${name}?`));
    if (path.startsWith('integration_outbox?')) throw new Error('outbox unavailable');
    return responses.get(key) || [];
  };

  const result = await commandHealth.listHealth();
  commandData.readJson = originalReadJson;

  assert.equal(result.business.customers.total, 1);
  assert.equal(result.health.calendarOperations.state, 'attention');
  assert.equal(result.health.integrationOutbox.state, 'unavailable');
  assert.equal(result.health.providerTelemetry, 'not_yet_instrumented');
});
