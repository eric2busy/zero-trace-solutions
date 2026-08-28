const assert = require('node:assert/strict');
const test = require('node:test');

const { sendTransactionalEmail } = require('../api/_email');

function input(overrides = {}) {
  return {
    to: 'customer@example.com',
    subject: 'Subject',
    text: 'Body',
    endpoint: '/api/test',
    messageType: 'test_message',
    recipientKind: 'customer',
    env: { RESEND_API_KEY: 'test-key', LEAD_ALERT_FROM: 'Sender <sender@example.com>' },
    logger: { info() {}, error() {} },
    ...overrides,
  };
}

test('records an accepted Resend delivery without logging a recipient or secret', async () => {
  const logs = [];
  let request;
  const result = await sendTransactionalEmail(input({
    logger: { info: (value) => logs.push(JSON.parse(value)), error() {} },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  }));

  assert.deepEqual(result, { sent: true, state: 'sent', reason: 'accepted', providerStatus: 200 });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(JSON.parse(request.options.body).from, 'Sender <sender@example.com>');
  assert.deepEqual(logs, [{
    event: 'transactional_email_delivery', endpoint: '/api/test', messageType: 'test_message',
    recipientKind: 'customer', sent: true, state: 'sent', reason: 'accepted', providerStatus: 200,
  }]);
  assert.doesNotMatch(JSON.stringify(logs), /customer@example\.com|test-key/);
});

test('records a Resend rejection without throwing', async () => {
  const result = await sendTransactionalEmail(input({
    fetchImpl: async () => ({ ok: false, status: 403 }),
  }));

  assert.deepEqual(result, { sent: false, state: 'failed', reason: 'provider_rejected', providerStatus: 403 });
});

test('records missing Resend configuration without making a request', async () => {
  let called = false;
  const result = await sendTransactionalEmail(input({
    env: {},
    fetchImpl: async () => { called = true; },
  }));

  assert.equal(called, false);
  assert.deepEqual(result, { sent: false, state: 'skipped', reason: 'resend_not_configured' });
});

test('records a request failure without throwing', async () => {
  const result = await sendTransactionalEmail(input({
    fetchImpl: async () => { throw new Error('connection reset'); },
  }));

  assert.deepEqual(result, { sent: false, state: 'failed', reason: 'request_failed' });
});
