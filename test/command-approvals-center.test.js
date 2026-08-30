const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'command', 'approvals.html'), 'utf8');
const vercel = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');
const commandHandler = fs.readFileSync(path.join(__dirname, '..', 'api', 'command.js'), 'utf8');

test('approval center exposes required fixture decision states and safety copy', () => {
  assert.match(html, /Approval Center/);
  assert.match(html, /Yellow actions stop here until a valid owner decision exists/);
  assert.match(html, /Red actions stay prohibited/);
  assert.match(html, /data-filter="pending"/);
  assert.match(html, /data-filter="decided"/);
  assert.match(html, /data-filter="expired"/);
  assert.match(html, /data-decision="approved"/);
  assert.match(html, /data-decision="rejected"/);
  assert.match(html, /data-decision="modified"/);
  assert.match(html, /Immutable receipt/);
  assert.match(html, /no Supabase read\/write/i);
  assert.match(html, /no Calendar, Notion, Resend, or customer action/i);
});

test('fixture decisions remain local UI behavior only', () => {
  assert.doesNotMatch(html, /fetch\s*\(/);
  assert.doesNotMatch(html, /supabase\.from/i);
  assert.doesNotMatch(html, /googleapis/i);
  assert.doesNotMatch(html, /api\/.*approval/i);
});

test('Approval Center is served only through authenticated Command handler', () => {
  assert.match(vercel, /command\/approvals/);
  assert.match(vercel, /api\/command\?view=approvals/);
  assert.match(vercel, /command\/\*\.html/);
  assert.match(commandHandler, /authenticatedCommandUser\(req\)/);
  assert.match(commandHandler, /req\.query\?\.view === 'approvals'/);
  assert.match(commandHandler, /'approvals\.html'/);
  assert.match(commandHandler, /Cache-Control', 'no-store, private'/);
});
