const test = require('node:test');
const assert = require('node:assert/strict');
const calendarCommand = require('../api/_lib/calendar-command');

test('calendar operation input rejects malformed schedules and cancel schedule values', () => {
  assert.equal(calendarCommand.validateInput({ jobId: 'bad', operation: 'cancel', idempotencyKey: 'a', version: 1 }).ok, false);
  assert.equal(calendarCommand.validateInput({ jobId: '40000000-0000-4000-8000-000000000001', operation: 'reschedule', idempotencyKey: 'a', version: 1, startAt: 'nope', endAt: '2026-09-01T12:00:00Z', timezone: 'America/Los_Angeles' }).error, 'invalid_schedule');
  assert.equal(calendarCommand.validateInput({ jobId: '40000000-0000-4000-8000-000000000001', operation: 'cancel', idempotencyKey: 'a', version: 1, timezone: 'America/Los_Angeles' }).error, 'cancel_has_schedule');
});

test('Calendar command has no provider fallback when credentials are absent', () => {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL; delete process.env.GOOGLE_PRIVATE_KEY; delete process.env.GOOGLE_CALENDAR_ID;
  assert.equal(calendarCommand.configured(), false);
});
