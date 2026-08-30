const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeEmail, normalizePhone } = require('../api/_lib/lead-command-sync');

test('normalizes lead reconciliation contact values', () => {
  assert.equal(normalizeEmail(' Customer@Example.COM '), 'customer@example.com');
  assert.equal(normalizePhone('+1 (555) 123-4567'), '5551234567');
  assert.equal(normalizePhone('(555) 123-4567'), '5551234567');
});
