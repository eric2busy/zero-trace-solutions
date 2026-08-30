const { authenticatedCommandUser } = require('./_lib/command-auth');
const commandData = require('./_lib/command-data');

const READ_ROLES = new Set(['owner', 'admin', 'operator']);
const CUSTOMER_WRITE_ROLES = new Set(['owner', 'admin']);
const RESOURCES = {
  customers: commandData.listCustomers,
  jobs: commandData.listJobs,
  approvals: commandData.listApprovals,
  activity: commandData.listActivity,
};

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  res.end(JSON.stringify(body));
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

module.exports = async function commandDataHandler(req, res) {
  const identity = await authenticatedCommandUser(req);
  if (!identity) return sendJson(res, 401, { error: 'authentication_required' });
  if (identity.cookies) res.setHeader('Set-Cookie', identity.cookies);

  if (!commandData.configured()) {
    return sendJson(res, 503, { error: 'server_data_access_not_configured' });
  }

  if (req.method === 'GET') {
    if (!READ_ROLES.has(identity.role)) return sendJson(res, 403, { error: 'insufficient_role' });
    const resource = String(req.query?.resource || 'customers');
    const reader = RESOURCES[resource];
    if (!reader) return sendJson(res, 400, { error: 'unsupported_resource' });

    try {
      const data = await reader();
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
  }

  if (req.method === 'PATCH') {
    if (!CUSTOMER_WRITE_ROLES.has(identity.role)) return sendJson(res, 403, { error: 'insufficient_role' });
    const resource = String(req.query?.resource || '');
    if (resource !== 'customer') return sendJson(res, 400, { error: 'unsupported_resource' });
    const body = await parseBody(req);
    if (!body) return sendJson(res, 400, { error: 'invalid_json' });

    try {
      const result = await commandData.updateCustomer({ authUserId: identity.user.id, input: body });
      if (result.state === 'invalid') return sendJson(res, 400, { error: result.error });
      if (result.state === 'not_found') return sendJson(res, 404, { error: 'customer_not_found' });
      if (result.state === 'stale') return sendJson(res, 409, { error: 'stale_customer_version', currentVersion: result.currentVersion });
      return sendJson(res, 200, { ok: true, state: result.state, customer: result.customer });
    } catch (error) {
      console.error('command_customer_update_failed', {
        code: error?.code || 'unknown',
        status: error?.status || null,
      });
      if (error?.code === 'COMMAND_ACTOR_NOT_PROVISIONED') return sendJson(res, 409, { error: 'command_actor_not_provisioned' });
      return sendJson(res, 502, { error: 'customer_update_failed' });
    }
  }

  res.setHeader('Allow', 'GET, PATCH');
  return sendJson(res, 405, { error: 'method_not_allowed' });
};
