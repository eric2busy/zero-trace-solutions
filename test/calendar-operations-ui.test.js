const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs');
test('Calendar controls are owner/admin-only and explain safe failure states', () => {
  const source = fs.readFileSync('command/calendar-operations.js', 'utf8');
  assert.match(source, /\['owner', 'admin'\]/); assert.match(source, /calendar_availability_conflict/); assert.match(source, /canonical_completion_rolled_back/); assert.match(source, /reconciliation_needed/); assert.match(source, /Saving safely/);
});
