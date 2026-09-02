const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const search = require('../api/_lib/command-search');

test('search shapes supported canonical entities into grouped, safe Command navigation results', () => {
  const result = search.shapeSearchResults('north', {
    customers: { customers: [{ display_name: 'North Client', status: 'active', organization_id: 'org-1' }], organizations: [{ id: 'org-1', display_name: 'North Organization', legal_name: 'North Legal', status: 'active' }], locations: [] },
    jobs: { jobs: [{ title: 'North walkthrough', status: 'scheduled', scheduled_start_at: '2026-09-03T10:00:00Z', service_location_id: 'loc-1' }], locations: [{ id: 'loc-1', city: 'North Hills' }] },
    approvals: { approvals: [{ action_type: 'north exception', target_type: 'job', status: 'pending', rationale: 'North review' }] },
  });
  assert.deepEqual(result.groups.map(group => group.type), ['Customers', 'Organizations', 'Jobs & bookings', 'Approvals']);
  assert.deepEqual(result.groups.flatMap(group => group.items.map(item => item.section)), ['customers', 'customers', 'jobs', 'approvals']);
  assert.equal(result.groups[2].items[0].type, 'Booking');
});

test('search normalizes control characters, bounds query length, and emits no result for blank input', () => {
  assert.equal(search.normalizeQuery('  a\u0000\n b  '), 'a b');
  assert.equal(search.normalizeQuery('x'.repeat(200)).length, search.MAX_QUERY_LENGTH);
  assert.deepEqual(search.shapeSearchResults(' ', {}), { query: '', groups: [] });
});

test('search uses only the supplied server readers and does not invent lead or browser data sources', async () => {
  const calls = [];
  const result = await search.searchCommand('client', {
    listCustomers: async () => { calls.push('customers'); return { customers: [{ display_name: 'Client', status: 'active' }], organizations: [], locations: [] }; },
    listJobs: async () => { calls.push('jobs'); return { jobs: [], locations: [] }; },
    listApprovals: async () => { calls.push('approvals'); return { approvals: [] }; },
  });
  assert.deepEqual(calls.sort(), ['approvals', 'customers', 'jobs']);
  assert.deepEqual(result.groups.map(group => group.type), ['Customers']);
});

test('search remains behind the existing Command authentication and read-role boundary', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'command-data.js'), 'utf8');
  assert.match(route, /authenticatedCommandUser/);
  assert.match(route, /resource === 'search'/);
  assert.match(route, /READ_ROLES\.has\(identity\.role\)/);
  assert.match(route, /commandSearch\.searchCommand/);
});
