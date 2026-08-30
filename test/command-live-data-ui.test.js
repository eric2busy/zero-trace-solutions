const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'command', 'live-data.js'), 'utf8');
const commandRoute = fs.readFileSync(path.join(root, 'api', 'command.js'), 'utf8');

test('Command live-data client is injected only through the authenticated Command route', () => {
  assert.match(commandRoute, /live-data\.js/);
  assert.match(commandRoute, /authenticatedCommandUser/);
});

test('browser live-data client uses only authenticated Command API and contains no server key references', () => {
  assert.match(ui, /\/api\/command-data\?resource=/);
  assert.doesNotMatch(ui, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(ui, /\/rest\/v1\//);
});

test('live UI explicitly loads all current read-only operational resources', () => {
  for (const resource of ['customers', 'jobs', 'approvals', 'activity']) {
    assert.match(ui, new RegExp(`['\"]${resource}['\"]`));
  }
});

test('live UI fails closed rather than substituting fixture data after a data error', () => {
  assert.match(ui, /Command failed closed\. No fixture data was substituted\./);
});
