const test = require('node:test');
const assert = require('node:assert/strict');
const commandAuth = require('../api/command-auth');
const command = require('../api/command');

function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
}

test('Command sign-in rejects an account without a Command app_metadata role', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'access', expires_in: 3600, user: { app_metadata: { command_role: 'ai_service' } } }) });
  const res = response();
  await commandAuth({ method: 'POST', body: { email: 'agent@example.test', password: 'not-a-real-password' }, headers: {} }, res);
  global.fetch = originalFetch;
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, '/command/login/?error=access');
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('Command sign-in creates a Secure, HttpOnly cookie only for an interactive role', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'access', expires_in: 3600, user: { app_metadata: { command_role: 'owner' } } }) });
  const res = response();
  await commandAuth({ method: 'POST', body: { email: 'owner@example.test', password: 'not-a-real-password' }, headers: {} }, res);
  global.fetch = originalFetch;
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, '/command/');
  assert.match(res.headers['Set-Cookie'], /HttpOnly/);
  assert.match(res.headers['Set-Cookie'], /Secure/);
  assert.match(res.headers['Set-Cookie'], /SameSite=Lax/);
});

test('Command route redirects an unauthenticated request before returning Command HTML', async () => {
  const res = response();
  await command({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, '/command/login/');
  assert.equal(res.body, undefined);
});
