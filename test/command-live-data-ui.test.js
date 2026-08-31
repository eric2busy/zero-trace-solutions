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

test('live UI renders service-location context without street-address fields or direct database access', () => {
  assert.match(ui, /function locationLabel/);
  assert.match(ui, /service location/);
  assert.match(ui, /locationLabel\(job, locationsById\)/);
  assert.doesNotMatch(ui, /address_line_1|postal_code/);
});

test('Home dashboard derives its live summary from the existing authenticated resources', () => {
  assert.match(ui, /function renderDashboard/);
  for (const resource of ['customers', 'jobs', 'approvals', 'activity']) {
    assert.match(ui, new RegExp(`['"]${resource}['"]`));
  }
  assert.match(ui, /dashboardNextUp/);
  assert.match(ui, /dashboardRecentActivity/);
  assert.match(ui, /dashboardCustomersValue/);
  assert.match(ui, /dashboardApprovalsValue/);
});

test('Home template contains live placeholders instead of dashboard fixture values', () => {
  const home = fs.readFileSync(path.join(root, 'command', 'index.html'), 'utf8');
  const dashboard = home.match(/<section class="section active" data-section="today">([\s\S]*?)<section class="section" data-section="schedule">/)?.[1] || '';
  assert.match(home, /id="dashboardTodayValue">—/);
  assert.match(home, /id="dashboardNextUp"/);
  assert.doesNotMatch(dashboard, /BrightWorks Dental|Northlake Pediatrics|Horizon Wellness/);
  assert.doesNotMatch(dashboard, /Static prototype · no real customer data/);
});

test('live UI fails closed rather than substituting fixture data after a data error', () => {
  assert.match(ui, /Command failed closed\. No fixture data was substituted\./);
});
