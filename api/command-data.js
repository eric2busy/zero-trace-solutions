const { authenticatedCommandUser } = require('./_lib/command-auth');
const commandData = require('./_lib/command-data');

const READ_ROLES = new Set(['owner', 'admin', 'operator']);

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  res.end(JSON.stringify(body));
}

module.exports = async function commandDataHandler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const identity = await authenticatedCommandUser(req);
  if (!identity) return sendJson(res, 401, { error: 'authentication_required' });
  if (!READ_ROLES.has(identity.role)) return sendJson(res, 403, { error: 'insufficient_role' });
  if (identity.cookies) res.setHeader('Set-Cookie', identity.cookies);

  if (!commandData.configured()) {
    return sendJson(res, 503, { error: 'server_data_access_not_configured' });
  }

  const resource = String(req.query?.resource || 'customers');
  if (resource !== 'customers') {
    return sendJson(res, 400, { error: 'unsupported_resource' });
  }

  try {
    const data = await commandData.listCustomers();
    return sendJson(res, 200, {
      resource,
      data,
      meta: { source: 'supabase', mode: 'read_only' },
    });
  } catch (error) {
    console.error('command_data_read_failed', {
      code: error?.code || 'unknown',
      status: error?.status || null,
      resource,
    });
    return sendJson(res, 502, { error: 'command_data_read_failed' });
  }
};
