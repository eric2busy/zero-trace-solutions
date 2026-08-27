function resendFrom(env) {
  return env.LEAD_ALERT_FROM || 'Zero Trace Solutions <solutions@zerotraceusa.com>';
}

function publicResult(sent, state, reason, providerStatus) {
  return {
    sent,
    state,
    reason,
    ...(providerStatus ? { providerStatus } : {}),
  };
}

function logDelivery(logger, level, context, result, details = {}) {
  const entry = {
    event: 'transactional_email_delivery',
    endpoint: context.endpoint,
    messageType: context.messageType,
    recipientKind: context.recipientKind,
    ...result,
    ...details,
  };
  logger[level]('Transactional email delivery', JSON.stringify(entry));
}

/**
 * Sends through Resend without throwing. Email delivery must never turn a
 * successfully persisted lead or booking into an application failure.
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
    const result = publicResult(false, 'skipped', 'resend_not_configured');
    logDelivery(logger, 'error', context, result);
    return result;
  }
  if (!to) {
    const result = publicResult(false, 'skipped', 'missing_recipient');
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
    const responseText = await response.text().catch(() => '');

    if (!response.ok) {
      const result = publicResult(false, 'failed', 'provider_rejected', response.status);
      logDelivery(logger, 'error', context, result, { providerError: responseText.slice(0, 1000) });
      return result;
    }

    let providerId;
    try { providerId = JSON.parse(responseText).id; } catch { /* response id is optional */ }
    const result = publicResult(true, 'sent', 'accepted', response.status);
    logDelivery(logger, 'info', context, result, providerId ? { providerId } : {});
    return result;
  } catch (err) {
    const result = publicResult(false, 'failed', 'request_failed');
    logDelivery(logger, 'error', context, result, { error: err?.message || String(err) });
    return result;
  }
}

module.exports = { sendTransactionalEmail };
