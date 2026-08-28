const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const { confirmedTimeSlotDate } = require('../api/notion-booking-time');

const START = '2099-07-16T10:00:00';
const END = '2099-07-16T11:00:00';
const TIME_ZONE = 'America/Los_Angeles';

function loadHandler(calendar) {
  const originalLoad = Module._load;
  Module._load = function mockGoogleApis(request, parent, isMain) {
    if (request === 'googleapis') {
      return {
        google: {
          auth: { JWT: class JWT {} },
          calendar: () => calendar,
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const modulePath = path.resolve(__dirname, '../api/book.js');
  delete require.cache[modulePath];
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function request() {
  return {
    method: 'POST',
    headers: { origin: 'http://localhost:3000' },
    body: {
      leadId: 'notion-page-id',
      start: START,
      end: END,
      name: 'Test Customer',
      email: 'customer@example.com',
      phone: '555-0100',
      businessType: 'Office',
      location: '123 Test Street',
      notes: 'Regression test',
    },
  };
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = JSON.parse(body); },
  };
}

function calendarMock() {
  const calls = { inserts: [], deletes: [] };
  return {
    calls,
    freebusy: { query: async () => ({ data: { calendars: { 'schedule.zts@gmail.com': { busy: [] } } } }) },
    events: {
      insert: async (input) => {
        calls.inserts.push(input);
        return { data: { id: 'calendar-event-id' } };
      },
      delete: async (input) => { calls.deletes.push(input); },
    },
  };
}

function fetchResponse(ok, status = ok ? 200 : 400, text = '') {
  return { ok, status, text: async () => text };
}

test.beforeEach(() => {
  process.env.NOTION_TOKEN = 'test-notion-token';
  process.env.GOOGLE_CLIENT_EMAIL = 'calendar@example.com';
  process.env.GOOGLE_PRIVATE_KEY = 'test-private-key';
  process.env.RESEND_API_KEY = 'test-resend-key';
  delete process.env.BOOKING_TIMEZONE;
  delete process.env.GOOGLE_CALENDAR_ID;
});

test.afterEach(() => {
  delete global.fetch;
  delete process.env.NOTION_TOKEN;
  delete process.env.GOOGLE_CLIENT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
  delete process.env.RESEND_API_KEY;
});

test('serializes the selected slot in the Notion-supported timezone format', () => {
  const rejectedOldFormat = {
    start: `${START}-07:00`,
    end: `${END}-07:00`,
    time_zone: TIME_ZONE,
  };
  const corrected = confirmedTimeSlotDate(START, END, TIME_ZONE);

  assert.match(rejectedOldFormat.start, /[+-]\d{2}:\d{2}$/);
  assert.equal(rejectedOldFormat.time_zone, TIME_ZONE);
  assert.deepEqual(corrected, { start: START, end: END, time_zone: TIME_ZONE });
  assert.doesNotMatch(corrected.start, /(?:Z|[+-]\d{2}:\d{2})$/);
  assert.doesNotMatch(corrected.end, /(?:Z|[+-]\d{2}:\d{2})$/);
});

test('finalizes Notion, preserves Calendar timing, sends emails, and returns success', async () => {
  const calendar = calendarMock();
  const fetchCalls = [];
  global.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return fetchResponse(true);
  };
  const handler = loadHandler(calendar);
  const res = response();

  await handler(request(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    calendarEventId: 'calendar-event-id',
    start: START,
    end: END,
    emailDelivery: {
      customer: { sent: true, state: 'sent', reason: 'accepted', providerStatus: 200 },
      internal: { sent: true, state: 'sent', reason: 'accepted', providerStatus: 200 },
    },
  });
  assert.deepEqual(calendar.calls.inserts[0].requestBody.start, { dateTime: START, timeZone: TIME_ZONE });
  assert.deepEqual(calendar.calls.inserts[0].requestBody.end, { dateTime: END, timeZone: TIME_ZONE });
  assert.equal(calendar.calls.deletes.length, 0);

  const notionCall = fetchCalls.find(({ url }) => url.startsWith('https://api.notion.com/'));
  const notionBody = JSON.parse(notionCall.options.body);
  assert.deepEqual(notionBody.properties['Confirmed Time Slot'].date, {
    start: START,
    end: END,
    time_zone: TIME_ZONE,
  });
  assert.deepEqual(notionBody.properties.Status, { select: { name: 'Scheduled' } });
  assert.equal(fetchCalls.filter(({ url }) => url === 'https://api.resend.com/emails').length, 2);
});

test('keeps a finalized booking successful when email delivery fails', async () => {
  const calendar = calendarMock();
  global.fetch = async (url) => {
    if (url.startsWith('https://api.notion.com/')) return fetchResponse(true);
    throw new Error('network unavailable');
  };
  const handler = loadHandler(calendar);
  const res = response();

  await handler(request(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.emailDelivery, {
    customer: { sent: false, state: 'failed', reason: 'request_failed' },
    internal: { sent: false, state: 'failed', reason: 'request_failed' },
  });
  assert.equal(calendar.calls.deletes.length, 0);
});

test('rolls back Calendar and sends no email when Notion rejects persistence', async () => {
  const calendar = calendarMock();
  const fetchCalls = [];
  global.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    if (url.startsWith('https://api.notion.com/')) {
      return fetchResponse(false, 400, 'validation_error');
    }
    return fetchResponse(true);
  };
  const handler = loadHandler(calendar);
  const res = response();

  await handler(request(), res);

  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: 'Booking could not be finalized. Please choose the time again.' });
  assert.deepEqual(calendar.calls.deletes, [{ calendarId: 'schedule.zts@gmail.com', eventId: 'calendar-event-id' }]);
  assert.equal(fetchCalls.filter(({ url }) => url === 'https://api.resend.com/emails').length, 0);
});
