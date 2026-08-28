function resendFrom(env) {
  return env.LEAD_ALERT_FROM || 'Zero Trace Solutions <solutions@zerotraceusa.com>';
}

function deliveryResult(sent, state, reason, providerStatus) {
  return {
    sent,
    state,
    reason,
    ...(providerStatus ? { providerStatus } : {}),
  };
}

function logDelivery(logger, level, context, result) {
  logger[level](JSON.stringify({
    event: 'transactional_email_delivery',
    endpoint: context.endpoint,
    messageType: context.messageType,
    recipientKind: context.recipientKind,
    ...result,
  }));
}

/**
 * Sends a transactional email without throwing. A delivery failure must not
 * reverse a lead or booking that was already persisted successfully.
 */
async function sendTransactionalEmail({
  to,
  subject,
  text,
  replyTo,
  endpoint,
  messageType,
  recipientKind,
  env = process.env,
  fetchImpl = global.fetch,
  logger = console,
}) {
  const context = { endpoint, messageType, recipientKind };
  const key = env.RESEND_API_KEY;

  if (!key) {
    const result = deliveryResult(false, 'skipped', 'resend_not_configured');
    logDelivery(logger, 'error', context, result);
    return result;
  }

  if (!to) {
    const result = deliveryResult(false, 'skipped', 'missing_recipient');
    logDelivery(logger, 'error', context, result);
    return result;
  }

  const body = {
    from: resendFrom(env),
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
  };
  if (replyTo) body.reply_to = replyTo;

  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const result = deliveryResult(false, 'failed', 'provider_rejected', response.status);
      logDelivery(logger, 'error', context, result);
      return result;
    }

    const result = deliveryResult(true, 'sent', 'accepted', response.status);
    logDelivery(logger, 'info', context, result);
    return result;
  } catch {
    const result = deliveryResult(false, 'failed', 'request_failed');
    logDelivery(logger, 'error', context, result);
    return result;
  }
}

module.exports = { sendTransactionalEmail };
