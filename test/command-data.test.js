const test = require('node:test');
const assert = require('node:assert/strict');
const commandData = require('../api/_lib/command-data');

function setBaseEnv() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

test('server data layer is disabled without a server-only Supabase key', () => {
  setBaseEnv();
  assert.equal(commandData.configured(), false);
  assert.equal(commandData.serverKey(), null);
});

test('server data layer prefers SUPABASE_SECRET_KEY over legacy service-role key', () => {
  setBaseEnv();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-key';
  process.env.SUPABASE_SECRET_KEY = 'secret-key';
  assert.equal(commandData.configured(), true);
  assert.equal(commandData.serverKey(), 'secret-key');
});

test('REST reads keep the server credential in request headers only', async () => {
  setBaseEnv();
  process.env.SUPABASE_SECRET_KEY = 'secret-key';
  const originalFetch = global.fetch;
  let observed;
  global.fetch = async (url, options) => {
    observed = { url, options };
    return { ok: true, json: async () => [] };
  };

  await commandData.readJson('customers?select=id,display_name');
  global.fetch = originalFetch;

  assert.equal(observed.url, 'https://example.supabase.co/rest/v1/customers?select=id,display_name');
  assert.equal(observed.options.headers.apikey, 'secret-key');
  assert.equal(observed.options.headers.Authorization, 'Bearer secret-key');
  assert.equal(observed.url.includes('secret-key'), false);
});

test('customer read contract excludes contact PII and returns canonical customers and organizations', async () => {
  setBaseEnv();
  process.env.SUPABASE_SECRET_KEY = 'secret-key';
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async url => {
    urls.push(url);
    return { ok: true, json: async () => [] };
  };

  const result = await commandData.listCustomers();
  global.fetch = originalFetch;

  assert.deepEqual(result, { customers: [], organizations: [] });
  assert.equal(urls.length, 2);
  assert.equal(urls.some(url => url.includes('customer_contacts')), false);
  assert.equal(urls.every(url => !url.includes('value') && !url.includes('normalized_value')), true);
});
