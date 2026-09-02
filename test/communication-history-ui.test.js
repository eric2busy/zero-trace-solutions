const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Messages remains an honest future customer inbox while System Health owns integration evidence', () => {
  const home = fs.readFileSync('command/index.html', 'utf8');
  const route = fs.readFileSync('api/command.js', 'utf8');
  const health = fs.readFileSync('command/health-live.js', 'utf8');
  for (const label of ['Today', 'Jobs', 'Clients', 'Messages', 'More']) assert.match(home, new RegExp(label));
  assert.match(home, /Customer messaging is coming to Command/);
  assert.match(home, /Website chat and customer conversation workflows are not connected yet/);
  assert.match(health, /Integration evidence/);
  assert.match(health, /Recent recorded activity/);
  assert.match(health, /Google Calendar reconciliation/);
  assert.match(health, /Notion mirror events/);
  assert.match(health, /Transactional email receipts/);
  assert.doesNotMatch(route, /communication-history\.js/);
  assert.doesNotMatch(health, /method:\s*['\"](?:POST|PUT|PATCH|DELETE)/i);
});
