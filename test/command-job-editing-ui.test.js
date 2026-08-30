const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'command', 'job-editing.js'), 'utf8');
const commandRoute = fs.readFileSync(path.join(root, 'api', 'command.js'), 'utf8');

test('job editing is authenticated Command UI only and never has direct Supabase access', () => {
  assert.match(commandRoute, /job-editing\.js/);
  assert.match(client, /\/api\/command-data\?resource=job/);
  assert.match(client, /\['owner', 'admin'\]/);
  assert.doesNotMatch(client, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|\/rest\/v1\//i);
});

test('job editor describes the Calendar boundary and omits cancellation controls', () => {
  assert.match(client, /Calendar schedule and cancellation are locked/);
  assert.doesNotMatch(client, /name="scheduled_start_at"/);
  assert.doesNotMatch(client, /name="scheduled_end_at"/);
  assert.doesNotMatch(client, /calendar_event_id/);
});
