const { authenticatedCommandUser } = require('./_lib/command-auth');
const { executeCalendarOperation } = require('./_lib/calendar-command');

function send(res, status, body) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store, private'); res.end(JSON.stringify(body)); }
module.exports = async function commandCalendar(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  const identity = await authenticatedCommandUser(req); if (!identity) return send(res, 401, { error: 'authentication_required' });
  if (identity.cookies) res.setHeader('Set-Cookie', identity.cookies);
  try {
    const input = req.body && typeof req.body === 'object' ? req.body : typeof req.body === 'string' ? JSON.parse(req.body) : null;
    const result = await executeCalendarOperation({ role: identity.role, authUserId: identity.user.id, input });
    if (result.state === 'not_found') return send(res, 404, { error: 'job_not_found' });
    if (result.state === 'stale') return send(res, 409, { error: 'stale_job_version', currentVersion: result.currentVersion });
    if (result.state === 'reconciliation_needed') return send(res, 409, { error: 'reconciliation_needed', correlationId: result.correlationId || null });
    return send(res, 200, { ok: true, ...result });
  } catch (error) { return send(res, error.status || 502, { error: error.code || 'calendar_command_failed', correlationId: error.correlationId || null }); }
};
