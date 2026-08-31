const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('System Health UI stays read-only and fails closed without fabricated provider health', () => {
  const source = fs.readFileSync('command/health-live.js', 'utf8');

  assert.match(source, /resource=health/);
  assert.match(source, /credentials:\s*'same-origin'/);
  assert.match(source, /not_yet_instrumented/);
  assert.match(source, /No fixture or assumed healthy state was substituted/);
  assert.match(source, /reconciliation required/);
  assert.match(source, /need attention/);
  assert.doesNotMatch(source, /method:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]/i);
});
