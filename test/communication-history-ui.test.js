const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('communication history remains behind the authenticated Command route and contains no direct data access', () => {
  const route = fs.readFileSync('api/command.js', 'utf8');
  const source = fs.readFileSync('command/communication-history.js', 'utf8');
  assert.match(route, /communication-history\.js/);
  assert.match(source, /\/api\/command-data\?resource=health/);
  assert.match(source, /credentials:\s*'same-origin'/);
  assert.doesNotMatch(source, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|service_role|\/rest\/v1\//i);
  assert.doesNotMatch(source, /method:\s*['\"](?:POST|PUT|PATCH|DELETE)/i);
});
