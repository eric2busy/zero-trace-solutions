const assert = require('node:assert/strict');
const test = require('node:test');

const commandData = require('../api/_lib/command-data');

function response(ok, payload, status = ok ? 200 : 400) {
  return { ok, status, json: async () => payload };
}

test.beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
});

test.afterEach(() => {
  delete global.fetch;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

test('validates and normalizes the narrow customer write allowlist', () => {
  assert.deepEqual(commandData.validateCustomerPatch({
    id: '40000000-0000-4000-8000-000000000001',
    displayName: '  Acme   Dental  ',
    status: 'ACTIVE',
    version: 2,
  }), {
    ok: true,
    value: {
      id: '40000000-0000-4000-8000-000000000001',
      displayName: 'Acme Dental',
      status: 'active',
      version: 2,
    },
  });

  assert.equal(commandData.validateCustomerPatch({
    id: '40000000-0000-4000-8000-000000000001',
    displayName: 'Acme',
    status: 'active',
    version: 1,
    notion_page_id: 'immutable-provider-field',
  }).error, 'unsupported_field');
});

test('updates an existing customer with optimistic concurrency and appends an audit event', async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/actors?')) return response(true, [{ id: '60000000-0000-4000-8000-000000000001' }]);
    if (url.includes('/customers?select=')) return response(true, [{
      id: '40000000-0000-4000-8000-000000000001', display_name: 'Old Name', status: 'active', updated_by: null, version: 3,
    }]);
    if (url.includes('/customers?id=eq.') && options.method === 'PATCH') return response(true, [{
      id: '40000000-0000-4000-8000-000000000001', organization_id: null, display_name: 'New Name', status: 'archived', version: 4,
      created_at: '2026-08-30T00:00:00Z', updated_at: '2026-08-30T01:00:00Z',
    }]);
    if (url.endsWith('/rest/v1/activity_events')) return response(true, null, 201);
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await commandData.updateCustomer({
    authUserId: 'cb385874-e7ed-4608-b58c-08324f15483c',
    input: {
      id: '40000000-0000-4000-8000-000000000001',
      displayName: 'New Name',
      status: 'archived',
      version: 3,
    },
  });

  assert.equal(result.state, 'updated');
  assert.equal(result.customer.version, 4);
  const patch = calls.find(call => call.options.method === 'PATCH');
  assert.match(patch.url, /version=eq\.3/);
  assert.deepEqual(JSON.parse(patch.options.body), {
    display_name: 'New Name',
    status: 'archived',
    updated_by: '60000000-0000-4000-8000-000000000001',
  });
  const audit = calls.find(call => call.url.endsWith('/rest/v1/activity_events'));
  const auditBody = JSON.parse(audit.options.body)[0];
  assert.equal(auditBody.action, 'customer.updated');
  assert.equal(auditBody.target_type, 'customer');
  assert.equal(auditBody.outcome, 'succeeded');
  assert.deepEqual(auditBody.metadata.changed_fields.sort(), ['display_name', 'status']);
});

test('rejects stale edits before mutation', async () => {
  global.fetch = async (url) => {
    if (url.includes('/actors?')) return response(true, [{ id: '60000000-0000-4000-8000-000000000001' }]);
    if (url.includes('/customers?select=')) return response(true, [{
      id: '40000000-0000-4000-8000-000000000001', display_name: 'Current Name', status: 'active', updated_by: null, version: 8,
    }]);
    throw new Error('Mutation should not be attempted for a stale version');
  };

  const result = await commandData.updateCustomer({
    authUserId: 'cb385874-e7ed-4608-b58c-08324f15483c',
    input: {
      id: '40000000-0000-4000-8000-000000000001',
      displayName: 'Old Screen Value',
      status: 'active',
      version: 7,
    },
  });

  assert.deepEqual(result, { state: 'stale', currentVersion: 8 });
});
