const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

function loadHandler() {
  const modulePath = path.resolve(__dirname, '../api/leads.js');
  const syncPath = path.resolve(__dirname, '../api/_lib/lead-command-sync.js');
  const dataPath = path.resolve(__dirname, '../api/_lib/command-data.js');
  delete require.cache[modulePath];
  delete require.cache[syncPath];
  delete require.cache[dataPath];
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
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test('keeps a persisted lead successful when delivery fails and Command mirror is not configured', async () => {
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
    commandSync: 'pending',
    next: 'select_available_slot',
  });
});

test('mirrors a persisted Notion lead into an existing Command customer and draft walkthrough', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  const writes = [];
  global.fetch = async (url, options = {}) => {
    if (url.startsWith('https://api.notion.com/')) return { ok: true, async json() { return { id: 'notion-page-id' }; } };
    if (url.startsWith('https://api.resend.com/')) return { ok: true, async json() { return { id: 'email-id' }; } };
    if (url.includes('/jobs?select=id&source_system=eq.website')) return { ok: true, async json() { return []; } };
    if (url.includes('/customer_contacts?select=customer_id&kind=eq.email')) return { ok: true, async json() { return [{ customer_id: 'customer-id' }]; } };
    if (url.includes('/customer_contacts?') && options.method === 'POST') { writes.push({ url, body: JSON.parse(options.body) }); return { ok: true, async json() { return null; } }; }
    if (url.endsWith('/rest/v1/jobs') && options.method === 'POST') { writes.push({ url, body: JSON.parse(options.body) }); return { ok: true, async json() { return [{ id: 'job-id' }]; } }; }
    throw new Error(`Unexpected request: ${url}`);
  };

  const handler = loadHandler();
  const res = response();
  await handler(request(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.commandSync, 'synced');
  const jobWrite = writes.find((entry) => entry.url.endsWith('/rest/v1/jobs'));
  assert.equal(jobWrite.body[0].kind, 'walkthrough');
  assert.equal(jobWrite.body[0].status, 'draft');
  assert.equal(jobWrite.body[0].source_system, 'website');
  assert.equal(jobWrite.body[0].source_record_id, 'notion-page-id');
});

test('does not create another Command job when the Notion lead was already mirrored', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  let commandWrites = 0;
  global.fetch = async (url, options = {}) => {
    if (url.startsWith('https://api.notion.com/')) return { ok: true, async json() { return { id: 'notion-page-id' }; } };
    if (url.startsWith('https://api.resend.com/')) return { ok: true, async json() { return { id: 'email-id' }; } };
    if (url.includes('/jobs?select=id&source_system=eq.website')) return { ok: true, async json() { return [{ id: 'existing-job' }]; } };
    if (options.method === 'POST') commandWrites += 1;
    throw new Error(`Unexpected request: ${url}`);
  };

  const handler = loadHandler();
  const res = response();
  await handler(request(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.commandSync, 'synced');
  assert.equal(commandWrites, 0);
});

test('keeps Notion intake successful when Command mirror fails without returning raw PII', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    global.fetch = async (url) => {
      if (url.startsWith('https://api.notion.com/')) return { ok: true, async json() { return { id: 'notion-page-id' }; } };
      if (url.startsWith('https://api.resend.com/')) return { ok: true, async json() { return { id: 'email-id' }; } };
      if (url.includes('/rest/v1/')) return { ok: false, status: 503, async json() { return { message: 'provider failure' }; } };
      throw new Error('unexpected request');
    };
    const handler = loadHandler();
    const res = response();
    await handler(request(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.commandSync, 'pending');
    const serialized = JSON.stringify({ response: res.body, logs });
    assert.equal(serialized.includes('customer@example.com'), false);
    assert.equal(serialized.includes('555-0100'), false);
    assert.equal(serialized.includes('123 Test Street'), false);
    assert.equal(serialized.includes('Regression test'), false);
    assert.equal(serialized.includes('sb_secret_test'), false);
  } finally {
    console.error = originalError;
  }
});
