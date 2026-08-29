const test = require('node:test');
const assert = require('node:assert/strict');
const commandAuth = require('../api/command-auth');
const command = require('../api/command');

function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
}

function setTestEnv() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
}

test('Command sign-in rejects an account without a fresh Command app_metadata role', async () => {
  setTestEnv();
  const originalFetch = global.fetch;
  global.fetch = async url => ({
    ok: true,
    json: async () => url.endsWith('/auth/v1/user')
      ? { app_metadata: { command_role: 'ai_service' } }
      : { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 },
  });
  const res = response();
  await commandAuth({ method: 'POST', body: { email: 'agent@example.test', password: 'not-a-real-password' }, headers: {} }, res);
  global.fetch = originalFetch;
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, '/command/login/?error=access');
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('Command sign-in authorizes from the fresh user record and creates Secure, HttpOnly cookies', async () => {
  setTestEnv();
  const originalFetch = global.fetch;
  global.fetch = async url => ({
    ok: true,
    json: async () => url.endsWith('/auth/v1/user')
      ? { app_metadata: { command_role: 'owner' } }
      : { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { app_metadata: { command_role: 'ai_service' } } },
  });
  const res = response();
  await commandAuth({ method: 'POST', body: { email: 'owner@example.test', password: 'not-a-real-password' }, headers: {} }, res);
  global.fetch = originalFetch;
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, '/command/');
  assert.equal(res.headers['Set-Cookie'].length, 2);
  assert.match(res.headers['Set-Cookie'][0], /HttpOnly/);
  assert.match(res.headers['Set-Cookie'][0], /Secure/);
  assert.match(res.headers['Set-Cookie'][1], /__Host-zt-command-refresh/);
  assert.match(res.headers['Set-Cookie'][1], /SameSite=Lax/);
});

test('invite acceptance updates a password only after role authorization and establishes a session', async () => {
  setTestEnv();
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user') && options.method !== 'PUT') return { ok: true, json: async () => ({ app_metadata: { command_role: 'admin' } }) };
    if (url.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }) };
  };
  const res = response();
  await commandAuth({ method: 'POST', query: { action: 'accept-invite' }, body: { access_token: 'invite-access', refresh_token: 'invite-refresh', password: 'long-enough-password' }, headers: {} }, res);
  global.fetch = originalFetch;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, redirectTo: '/command/' });
  assert.equal(res.headers['Set-Cookie'].length, 2);
  assert.equal(calls.filter(call => call.url.endsWith('/auth/v1/user') && call.options.method === 'PUT').length, 1);
});

test('invite acceptance refuses an unprovisioned user before changing a password', async () => {
  setTestEnv();
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ app_metadata: { command_role: 'ai_service' } }) };
  };
  const res = response();
  await commandAuth({ method: 'POST', query: { action: 'accept-invite' }, body: { access_token: 'invite-access', refresh_token: 'invite-refresh', password: 'long-enough-password' }, headers: {} }, res);
  global.fetch = originalFetch;
  assert.equal(res.statusCode, 403);
  assert.equal(calls.some(call => call.options.method === 'PUT'), false);
});

test('Command route redirects an unauthenticated request before returning Command HTML', async () => {
  setTestEnv();
  const res = response();
  await command({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.Location, '/command/login/');
  assert.equal(res.body, undefined);
});
