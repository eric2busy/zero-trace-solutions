const assert = require('node:assert/strict');
const test = require('node:test');

const MODULE_PATH = require.resolve('../api/_lib/booking-command-sync');

function loadSync() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

function response({ ok = true, status = 200, json = null } = {}) {
  return {
    ok,
    status,
    json: async () => json,
  };
}

test.beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test.afterEach(() => {
  delete global.fetch;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete require.cache[MODULE_PATH];
});

test('updates the existing website walkthrough job with the confirmed schedule and Calendar identity', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method) {
      return response({ json: [{ id: 'job-1', status: 'draft', scheduled_start_at: null, scheduled_end_at: null, scheduled_timezone: null, calendar_event_id: null }] });
    }
    return response({ json: [{ id: 'job-1' }] });
  };

  const { syncConfirmedBooking } = loadSync();
  const result = await syncConfirmedBooking({
    leadId: 'notion-page-id',
    scheduledStartAt: '2099-07-16T17:00:00.000Z',
    scheduledEndAt: '2099-07-16T18:00:00.000Z',
    timezone: 'America/Los_Angeles',
    calendarEventId: 'calendar-event-id',
  });

  assert.deepEqual(result, { state: 'synced', reason: 'updated' });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /jobs\?select=.*source_system=eq\.website&source_record_id=eq\.notion-page-id/);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(calls[1].options.headers.apikey, 'sb_secret_test');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    status: 'scheduled',
    scheduled_start_at: '2099-07-16T17:00:00.000Z',
    scheduled_end_at: '2099-07-16T18:00:00.000Z',
    scheduled_timezone: 'America/Los_Angeles',
    calendar_event_id: 'calendar-event-id',
  });
});

test('is idempotent when the same confirmed booking is already synchronized', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return response({ json: [{
      id: 'job-1',
      status: 'scheduled',
      scheduled_start_at: '2099-07-16T17:00:00+00:00',
      scheduled_end_at: '2099-07-16T18:00:00+00:00',
      scheduled_timezone: 'America/Los_Angeles',
      calendar_event_id: 'calendar-event-id',
    }] });
  };

  const { syncConfirmedBooking } = loadSync();
  const result = await syncConfirmedBooking({
    leadId: 'notion-page-id',
    scheduledStartAt: '2099-07-16T17:00:00.000Z',
    scheduledEndAt: '2099-07-16T18:00:00.000Z',
    timezone: 'America/Los_Angeles',
    calendarEventId: 'calendar-event-id',
  });

  assert.deepEqual(result, { state: 'synced', reason: 'already_synced' });
  assert.equal(calls.length, 1);
});

test('fails open for the customer booking when Command synchronization is unavailable', async () => {
  global.fetch = async () => response({ ok: false, status: 503, json: { message: 'unavailable' } });
  const { syncConfirmedBooking } = loadSync();

  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await syncConfirmedBooking({
      leadId: 'notion-page-id',
      scheduledStartAt: '2099-07-16T17:00:00.000Z',
      scheduledEndAt: '2099-07-16T18:00:00.000Z',
      timezone: 'America/Los_Angeles',
      calendarEventId: 'calendar-event-id',
    });
    assert.deepEqual(result, { state: 'pending', reason: 'sync_failed' });
  } finally {
    console.error = originalError;
  }
});

test('does not create a second job when the lead mirror is missing', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return response({ json: [] });
  };
  const { syncConfirmedBooking } = loadSync();

  const result = await syncConfirmedBooking({
    leadId: 'notion-page-id',
    scheduledStartAt: '2099-07-16T17:00:00.000Z',
    scheduledEndAt: '2099-07-16T18:00:00.000Z',
    timezone: 'America/Los_Angeles',
    calendarEventId: 'calendar-event-id',
  });

  assert.deepEqual(result, { state: 'pending', reason: 'job_not_found' });
  assert.equal(calls.length, 1);
  assert.equal(calls.some(({ options }) => options.method === 'POST'), false);
});
