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
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
  assert.equal(commandData.configured(), true);
  assert.equal(commandData.serverKey(), 'sb_secret_example');
});

test('modern Supabase secret key is sent only as apikey and never as bearer token', async () => {
  setBaseEnv();
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
  const originalFetch = global.fetch;
  let observed;
  global.fetch = async (url, options) => {
    observed = { url, options };
    return { ok: true, json: async () => [] };
  };

  await commandData.readJson('customers?select=id,display_name');
  global.fetch = originalFetch;

  assert.equal(observed.url, 'https://example.supabase.co/rest/v1/customers?select=id,display_name');
  assert.equal(observed.options.headers.apikey, 'sb_secret_example');
  assert.equal(observed.options.headers.Authorization, undefined);
  assert.equal(observed.url.includes('sb_secret_example'), false);
});

test('legacy service-role key remains supported as bearer JWT', async () => {
  setBaseEnv();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-service-role-jwt';
  const originalFetch = global.fetch;
  let observed;
  global.fetch = async (url, options) => {
    observed = { url, options };
    return { ok: true, json: async () => [] };
  };

  await commandData.readJson('customers?select=id');
  global.fetch = originalFetch;

  assert.equal(observed.options.headers.apikey, 'legacy-service-role-jwt');
  assert.equal(observed.options.headers.Authorization, 'Bearer legacy-service-role-jwt');
});

test('customer read contract excludes contact PII and returns canonical customers and organizations', async () => {
  setBaseEnv();
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
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
  assert.equal(urls.every(url => !url.includes('normalized_value')), true);
});

test('jobs read contract exposes schedule and active assignments without note bodies', async () => {
  setBaseEnv();
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async url => {
    urls.push(url);
    return { ok: true, json: async () => [] };
  };

  const result = await commandData.listJobs();
  global.fetch = originalFetch;

  assert.deepEqual(result, { jobs: [], assignments: [] });
  assert.equal(urls.some(url => url.includes('/jobs?')), true);
  assert.equal(urls.some(url => url.includes('/job_assignments?')), true);
  assert.equal(urls.some(url => url.includes('job_notes')), false);
  assert.equal(urls.some(url => url.includes('service_details')), false);
});

test('approval read contract includes immutable decision receipts and exact payload summaries', async () => {
  setBaseEnv();
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async url => {
    urls.push(url);
    return { ok: true, json: async () => [] };
  };

  const result = await commandData.listApprovals();
  global.fetch = originalFetch;

  assert.deepEqual(result, { approvals: [], decisions: [] });
  assert.equal(urls.some(url => url.includes('proposed_payload_summary')), true);
  assert.equal(urls.some(url => url.includes('effective_payload_summary')), true);
});

test('activity read contract excludes metadata payloads and returns audit identifiers', async () => {
  setBaseEnv();
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_example';
  const originalFetch = global.fetch;
  let observed = '';
  global.fetch = async url => {
    observed = url;
    return { ok: true, json: async () => [] };
  };

  const result = await commandData.listActivity();
  global.fetch = originalFetch;

  assert.deepEqual(result, { activity: [] });
  assert.equal(observed.includes('correlation_id'), true);
  assert.equal(observed.includes('metadata'), false);
});
