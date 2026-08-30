const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('lead mirror keeps Calendar creation out of the intake endpoint', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../api/leads.js'), 'utf8');
  assert.equal(source.includes('calendar.googleapis.com'), false);
  assert.equal(source.includes('mirrorLeadToCommand'), true);
});
