const { authenticatedCommandUser } = require('./_lib/command-auth');
const commandData = require('./_lib/command-data');
const commandHealth = require('./_lib/command-health');
const commandSearch = require('./_lib/command-search');

const READ_ROLES = new Set(['owner', 'admin', 'operator']);
const CUSTOMER_WRITE_ROLES = new Set(['owner', 'admin']);
const NOTE_ROLES = READ_ROLES;
const RESOURCES = {
  customers: commandData.listCustomers,
  jobs: commandData.listJobs,
  approvals: commandData.listApprovals,
  activity: commandData.listActivity,
  health: commandHealth.listHealth,
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
    const resource = String(req.query?.resource || 'customers');
    if (resource === 'search') {
      if (!READ_ROLES.has(identity.role)) return sendJson(res, 403, { error: 'insufficient_role' });
      try {
        const data = await commandSearch.searchCommand(req.query?.q, commandData);
        return sendJson(res, 200, { resource, data, meta: { source: 'supabase', mode: 'read_only' } });
      } catch (error) {
        console.error('command_search_read_failed', { code: error?.code || 'unknown', status: error?.status || null });
        return sendJson(res, 502, { error: 'command_search_read_failed' });
      }
    }
    if (resource === 'notes') {
      if (!NOTE_ROLES.has(identity.role)) return sendJson(res, 403, { error: 'insufficient_role' });
      try {
        const result = await commandData.listJobNotes({ authUserId: identity.user.id, jobId: req.query?.jobId });
        if (result.state === 'invalid') return sendJson(res, 400, { error: 'invalid_job_id' });
        return sendJson(res, 200, { resource, data: { notes: result.notes }, meta: { source: 'supabase', mode: 'read_only' } });
      } catch (error) {
        console.error('command_notes_read_failed', { code: error?.code || 'unknown', status: error?.status || null });
        if (error?.code === 'COMMAND_ACTOR_NOT_PROVISIONED') return sendJson(res, 409, { error: 'command_actor_not_provisioned' });
        return sendJson(res, 502, { error: 'command_notes_read_failed' });
      }
    }
    if (!READ_ROLES.has(identity.role)) return sendJson(res, 403, { error: 'insufficient_role' });
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

  if (req.method === 'POST') {
    if (!NOTE_ROLES.has(identity.role)) return sendJson(res, 403, { error: 'insufficient_role' });
    const resource = String(req.query?.resource || '');
    if (resource !== 'note') return sendJson(res, 400, { error: 'unsupported_resource' });
    const body = await parseBody(req);
    if (!body) return sendJson(res, 400, { error: 'invalid_json' });
    try {
      const result = await commandData.createJobNote({ authUserId: identity.user.id, input: body });
      if (result.state === 'invalid') return sendJson(res, 400, { error: result.error });
      return sendJson(res, 201, { ok: true, state: result.state, note: result.note });
    } catch (error) {
      console.error('command_note_create_failed', { code: error?.code || 'unknown', status: error?.status || null });
      if (error?.code === 'COMMAND_ACTOR_NOT_PROVISIONED') return sendJson(res, 409, { error: 'command_actor_not_provisioned' });
      return sendJson(res, 502, { error: 'job_note_create_failed' });
    }
  }

  if (req.method === 'PATCH') {
    if (!CUSTOMER_WRITE_ROLES.has(identity.role)) return sendJson(res, 403, { error: 'insufficient_role' });
    const resource = String(req.query?.resource || '');
    if (!['customer', 'job'].includes(resource)) return sendJson(res, 400, { error: 'unsupported_resource' });
    const body = await parseBody(req);
    if (!body) return sendJson(res, 400, { error: 'invalid_json' });

    try {
      const result = resource === 'job'
        ? await commandData.updateJob({ authUserId: identity.user.id, input: body })
        : await commandData.updateCustomer({ authUserId: identity.user.id, input: body });
      if (result.state === 'invalid') return sendJson(res, 400, { error: result.error });
      if (result.state === 'not_found') return sendJson(res, 404, { error: resource === 'job' ? 'job_not_found' : 'customer_not_found' });
      if (result.state === 'stale') return sendJson(res, 409, { error: resource === 'job' ? 'stale_job_version' : 'stale_customer_version', currentVersion: result.currentVersion });
      return sendJson(res, 200, { ok: true, state: result.state, [resource]: result[resource] });
    } catch (error) {
      console.error('command_customer_update_failed', {
        code: error?.code || 'unknown',
        status: error?.status || null,
      });
      if (error?.code === 'COMMAND_ACTOR_NOT_PROVISIONED') return sendJson(res, 409, { error: 'command_actor_not_provisioned' });
      return sendJson(res, 502, { error: resource === 'job' ? 'job_update_failed' : 'customer_update_failed' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return sendJson(res, 405, { error: 'method_not_allowed' });
};
