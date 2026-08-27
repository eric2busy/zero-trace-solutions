const test = require('node:test');
const assert = require('node:assert/strict');
const { sendTransactionalEmail } = require('../api/_email');

function quietLogger() {
  return { info() {}, error() {} };
}

function input(overrides = {}) {
  return {
    to: 'customer@example.com',
    subject: 'Subject',
    text: 'Body',
    endpoint: '/api/test',
    messageType: 'test_message',
    recipientKind: 'customer',
    env: { RESEND_API_KEY: 'test-key', LEAD_ALERT_FROM: 'Sender <sender@example.com>' },
    logger: quietLogger(),
    ...overrides,
  };
}

test('reports missing configuration without calling Resend', async () => {
  let called = false;
  const result = await sendTransactionalEmail(input({
    env: {},
    fetchImpl: async () => { called = true; },
  }));

  assert.equal(called, false);
  assert.deepEqual(result, { sent: false, state: 'skipped', reason: 'resend_not_configured' });
});

test('surfaces a Resend rejection without throwing', async () => {
  const result = await sendTransactionalEmail(input({
    fetchImpl: async () => new Response('{"message":"domain is not verified"}', { status: 403 }),
  }));

  assert.deepEqual(result, { sent: false, state: 'failed', reason: 'provider_rejected', providerStatus: 403 });
});

test('surfaces a network failure without throwing', async () => {
  const result = await sendTransactionalEmail(input({
    fetchImpl: async () => { throw new Error('connection reset'); },
  }));

  assert.deepEqual(result, { sent: false, state: 'failed', reason: 'request_failed' });
});

test('reports accepted delivery and sends the configured From identity', async () => {
  let request;
  const result = await sendTransactionalEmail(input({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('{"id":"email_123"}', { status: 200 });
    },
  }));

  assert.deepEqual(result, { sent: true, state: 'sent', reason: 'accepted', providerStatus: 200 });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(JSON.parse(request.options.body).from, 'Sender <sender@example.com>');
});
