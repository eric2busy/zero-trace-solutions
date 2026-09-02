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

test('live UI renders only active assignment role and display name without actor identifiers or writable controls', () => {
  assert.match(ui, /function assignmentLabel/);
  assert.match(ui, /No active assignment/);
  assert.match(ui, /assignment\.actors\?\.display_name/);
  assert.doesNotMatch(ui, /assignment\.actor_id/);
  assert.doesNotMatch(ui, /method:\s*['\"](?:POST|PATCH|PUT|DELETE)/);
});

test('schedule uses a read-only day/week presentation with loading, empty, and failed-closed states', () => {
  const scheduleHelper = fs.readFileSync(path.join(root, 'command', 'schedule-view.js'), 'utf8');
  assert.match(ui, /function renderScheduleLoading/);
  assert.match(ui, /function renderScheduleError/);
  assert.match(ui, /data-schedule-mode="day"/);
  assert.match(ui, /data-schedule-mode="week"/);
  assert.match(ui, /No scheduled visits/);
  assert.match(ui, /Live schedule unavailable/);
  assert.match(ui, /no Calendar changes/);
  assert.match(scheduleHelper, /groupScheduledJobs/);
  assert.doesNotMatch(scheduleHelper, /fetch\(|calendar\.events|address_line_1|postal_code/);
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
  const dashboard = home.match(/<section class="section active" data-section="today">([\s\S]*?)<section class="section" data-section="customers">/)?.[1] || '';
  assert.match(home, /id="dashboardTodayValue">—/);
  assert.match(home, /id="dashboardNextUp"/);
  assert.match(home, /id="dashboardActiveJobs"/);
  assert.doesNotMatch(dashboard, /BrightWorks Dental|Northlake Pediatrics|Horizon Wellness/);
  assert.doesNotMatch(dashboard, /Static prototype · no real customer data/);
});

test('mobile shell has the requested destinations, an honest Messages state, and a More-sheet sign out', () => {
  const home = fs.readFileSync(path.join(root, 'command', 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'command', 'live-data.js'), 'utf8');
  for (const label of ['Today', 'Jobs', 'Clients', 'Messages', 'More']) assert.match(home, new RegExp(label));
  assert.match(home, /Messages are coming to Command/);
  assert.match(home, /more-sheet/);
  assert.match(home, /Sign out/);
  assert.match(home, /prefers-reduced-motion/);
  assert.match(ui, /inProgress/);
  assert.match(ui, /activeJobsSection/);
});

test('Command uses the Schedule label, removes the duplicate header menu, and persists an accessible theme switch', () => {
  const home = fs.readFileSync(path.join(root, 'command', 'index.html'), 'utf8');
  assert.match(home, /label:'Schedule'/);
  assert.match(home, /data-jobs-tab="work">Jobs/);
  assert.match(home, /data-jobs-tab="schedule">Calendar/);
  assert.doesNotMatch(home, /accountMenuButton/);
  assert.match(home, /zts-command-theme/);
  assert.match(home, /role="switch" data-theme-switch aria-checked="true"/);
  assert.match(home, /\.theme-switch\{[^}]*width:52px;min-height:0;height:30px/);
  assert.match(home, /Night mode on\. Switch to Day mode/);
  assert.match(home, /data-theme-status/);
  assert.match(home, /prefers-color-scheme/);
  assert.match(home, /#0083F5/);
});

test('live UI fails closed rather than substituting fixture data after a data error', () => {
  assert.match(ui, /Command failed closed\. No fixture data was substituted\./);
});
