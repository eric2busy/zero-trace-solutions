const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

function loadHandler() {
  const modulePath = path.resolve(__dirname, '../api/leads.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function request() {
  return {
    method: 'POST',
    headers: { origin: 'http://localhost:3000' },
    body: {
      name: 'Test Customer', phone: '555-0100', email: 'customer@example.com',
      businessType: 'Office', preferredDate: '2099-07-16', preferredTime: 'Morning',
      location: '123 Test Street', notes: 'Regression test',
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

test.beforeEach(() => {
  process.env.NOTION_TOKEN = 'test-notion-token';
  process.env.RESEND_API_KEY = 'test-resend-key';
});

test.afterEach(() => {
  delete global.fetch;
  delete process.env.NOTION_TOKEN;
  delete process.env.RESEND_API_KEY;
});

test('keeps a persisted lead successful when delivery fails and returns both delivery results', async () => {
  global.fetch = async (url) => {
    if (url.startsWith('https://api.notion.com/')) return { ok: true, async json() { return { id: 'notion-page-id' }; } };
    throw new Error('network unavailable');
  };
  const handler = loadHandler();
  const res = response();

  await handler(request(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    id: 'notion-page-id',
    emailDelivery: {
      internal: { sent: false, state: 'failed', reason: 'request_failed' },
      customer: { sent: false, state: 'failed', reason: 'request_failed' },
    },
    next: 'select_available_slot',
  });
});
