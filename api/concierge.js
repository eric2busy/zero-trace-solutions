const { randomUUID } = require('node:crypto');
const { createConciergeResponse, normalizeMessages } = require('./_lib/concierge-engine');

const ALLOWED_ORIGINS = [
  'https://zerotraceusa.com',
  'https://www.zerotraceusa.com',
  'https://zero-trace-solutions.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(res, status, body, origin) {
  res.statusCode = status;
  Object.entries({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) }).forEach(([key, value]) => res.setHeader(key, value));
  res.end(JSON.stringify(body));
}

function logEvent(event) {
  console.info(JSON.stringify({ service: 'concierge', ...event }));
}

module.exports = async function handler(req, res) {
  const origin = req.headers?.origin || '';
  if (req.method === 'OPTIONS') return json(res, 204, {}, origin);
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }, origin);

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }, origin); }
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return json(res, 400, { error: 'A messages array is required' }, origin);

  const messages = normalizeMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json(res, 400, { error: 'The latest message must be from the customer' }, origin);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logEvent({ event: 'configuration_failure', route: 'concierge', reason: 'missing_openai_api_key' });
    return json(res, 503, { error: 'The automated concierge is temporarily unavailable. Please email support@zerotraceusa.com.' }, origin);
  }

  const requestId = randomUUID();
  const sessionId = typeof body.sessionId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(body.sessionId) ? body.sessionId : randomUUID();
  try {
    const result = await createConciergeResponse({ messages, apiKey, model: process.env.OPENAI_CONCIERGE_MODEL || 'gpt-5.4-mini' });
    logEvent({
      event: 'response_completed',
      requestId,
      sessionId,
      route: result.metadata.route,
      model: result.metadata.model,
      knowledgeVersion: result.metadata.knowledgeVersion,
      knowledgeIds: result.decision.knowledge_ids,
      handoff: result.handoff.type,
      escalation: result.decision.escalation_required,
    });
    return json(res, 200, {
      ok: true,
      requestId,
      sessionId,
      message: { id: randomUUID(), role: 'assistant', text: result.responseText, createdAt: new Date().toISOString() },
      qualification: result.decision.qualification,
      escalation: { required: result.decision.escalation_required, reason: result.decision.escalation_reason || null, supportEmail: 'support@zerotraceusa.com' },
      handoff: result.handoff,
      metadata: result.metadata,
    }, origin);
  } catch (error) {
    const invalid = error?.code === 'INVALID_INPUT';
    logEvent({
      event: invalid ? 'validation_failure' : 'upstream_failure',
      requestId,
      sessionId,
      route: 'concierge',
      errorType: invalid ? 'invalid_input' : 'model_or_response_error',
      ...(invalid ? {} : {
        providerStatus: Number.isInteger(error?.providerStatus) ? error.providerStatus : null,
        providerErrorType: error?.providerErrorType || error?.name || 'unknown',
        providerErrorCode: error?.providerErrorCode || error?.code || 'unknown',
        providerMessage: error?.providerMessage || 'OpenAI request failed before a provider response was available',
        providerStage: error?.providerStage || 'transport',
      }),
    });
    return json(res, invalid ? 400 : 502, {
      error: invalid ? error.message : 'I could not safely answer that right now. Please try again or email support@zerotraceusa.com.',
      escalation: { required: true, reason: invalid ? 'malformed_input' : 'upstream_failure', supportEmail: 'support@zerotraceusa.com' },
    }, origin);
  }
};
