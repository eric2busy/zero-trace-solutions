const { randomUUID } = require('node:crypto');
const { google } = require('googleapis');
const commandData = require('./command-data');
const receipts = require('./calendar-operation-receipts');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITE_ROLES = new Set(['owner', 'admin']);

function fail(code, status = 400, correlationId = null) {
  const error = new Error(code); error.code = code; error.status = status; error.correlationId = correlationId; throw error;
}

function validTimezone(value) { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } }
function parseInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_payload' };
  const allowed = new Set(['jobId', 'idempotencyKey', 'operation', 'version', 'startAt', 'endAt', 'timezone']);
  if (Object.keys(input).some(key => !allowed.has(key))) return { ok: false, error: 'unsupported_field' };
  const jobId = String(input.jobId || '').trim(); const idempotencyKey = String(input.idempotencyKey || '').trim();
  const operation = String(input.operation || '').trim(); const version = Number(input.version);
  if (!UUID.test(jobId)) return { ok: false, error: 'invalid_job_id' };
  if (!['reschedule', 'cancel'].includes(operation)) return { ok: false, error: 'invalid_operation' };
  if (!idempotencyKey || idempotencyKey.length > 200) return { ok: false, error: 'invalid_idempotency_key' };
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: 'invalid_version' };
  if (operation === 'cancel') {
    if (input.startAt !== undefined || input.endAt !== undefined || input.timezone !== undefined) return { ok: false, error: 'cancel_has_schedule' };
    return { ok: true, value: { jobId, idempotencyKey, operation, version, startAt: null, endAt: null, timezone: null } };
  }
  const startAt = parseInstant(input.startAt); const endAt = parseInstant(input.endAt); const timezone = String(input.timezone || '');
  if (!startAt || !endAt || new Date(endAt) <= new Date(startAt) || !validTimezone(timezone)) return { ok: false, error: 'invalid_schedule' };
  return { ok: true, value: { jobId, idempotencyKey, operation, version, startAt, endAt, timezone } };
}

function configured() { return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_CALENDAR_ID); }
function calendarClient() {
  if (!configured()) fail('calendar_provider_not_configured', 503);
  const auth = new google.auth.JWT({ email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/calendar'] });
  return google.calendar({ version: 'v3', auth });
}
async function jobForOperation(id) {
  const rows = await commandData.readJson(`jobs?select=id,status,calendar_event_id,scheduled_start_at,scheduled_end_at,scheduled_timezone,version&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows?.[0] || null;
}
function snapshot(event) { return { id: event.id, status: event.status || 'confirmed', start: event.start, end: event.end }; }
async function eventIsAvailable(calendar, calendarId, eventId, startAt, endAt) {
  const response = await calendar.events.list({ calendarId, timeMin: startAt, timeMax: endAt, singleEvents: true, showDeleted: false });
  return !(response.data.items || []).some(event => event.id !== eventId && event.status !== 'cancelled');
}
async function restore(calendar, calendarId, before) {
  await calendar.events.patch({ calendarId, eventId: before.id, requestBody: { status: before.status, start: before.start, end: before.end } });
}
async function executeCalendarOperation({ role, authUserId, input, calendar = null }) {
  if (!WRITE_ROLES.has(role)) fail('insufficient_role', 403);
  const checked = validateInput(input); if (!checked.ok) fail(checked.error);
  if (!commandData.configured()) fail('server_data_access_not_configured', 503);
  const request = checked.value;
  const actorId = await commandData.actorForAuthUser(authUserId);
  if (!actorId) fail('command_actor_not_provisioned', 409);
  const job = await jobForOperation(request.jobId);
  if (!job) return { state: 'not_found' };
  if (job.version !== request.version) return { state: 'stale', currentVersion: job.version };
  if (job.status !== 'scheduled' || !job.calendar_event_id) fail('calendar_backed_scheduled_job_required', 409);
  // Fail before reserving a durable operation when Preview has no provider
  // authority. Tests supply a mock explicitly; there is no fallback provider.
  const provider = calendar || calendarClient();
  const correlationId = randomUUID();
  const reservation = await receipts.reserveOperation({ jobId: request.jobId, idempotencyKey: request.idempotencyKey, operation: request.operation, actorId, correlationId, expectedJobVersion: request.version, metadata: { operation: request.operation } });
  const receipt = reservation?.[0];
  if (!receipt?.receipt_id) fail('receipt_reservation_failed', 502);
  if (receipt.replayed) {
    if (receipt.state === 'calendar_pending') {
      // The original provider request may have completed despite a lost
      // response. Never issue a second Calendar mutation for the same key.
      await receipts.markOperationForReconciliation({ receiptId: receipt.receipt_id, actorId, errorCode: 'idempotency_replay_requires_reconciliation' });
      return { state: 'reconciliation_needed', replayed: true, correlationId: receipt.correlation_id };
    }
    return { state: receipt.state, replayed: true, correlationId: receipt.correlation_id };
  }
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'mock-calendar';
  let before;
  try {
    const current = await provider.events.get({ calendarId, eventId: job.calendar_event_id });
    if (!current?.data?.id || current.data.status === 'cancelled') fail('calendar_event_unavailable', 409, receipt.correlation_id);
    before = snapshot(current.data);
    if (request.operation === 'reschedule' && !(await eventIsAvailable(provider, calendarId, job.calendar_event_id, request.startAt, request.endAt))) fail('calendar_availability_conflict', 409, receipt.correlation_id);
    const body = request.operation === 'cancel' ? { status: 'cancelled' } : { start: { dateTime: request.startAt, timeZone: request.timezone }, end: { dateTime: request.endAt, timeZone: request.timezone } };
    await provider.events.patch({ calendarId, eventId: job.calendar_event_id, requestBody: body });
  } catch (error) {
    if (error.code) throw error;
    fail('calendar_provider_failed', 502, receipt.correlation_id);
  }
  try {
    const result = await receipts.completeOperation({ receiptId: receipt.receipt_id, actorId, scheduledStartAt: request.startAt, scheduledEndAt: request.endAt, scheduledTimezone: request.timezone });
    return { state: 'succeeded', operation: request.operation, result: result?.[0] || null, correlationId: receipt.correlation_id };
  } catch (completionError) {
    try {
      await restore(provider, calendarId, before);
      await receipts.markOperationForReconciliation({ receiptId: receipt.receipt_id, actorId, errorCode: 'canonical_completion_rolled_back' });
      fail('canonical_completion_rolled_back', 502, receipt.correlation_id);
    } catch (rollbackError) {
      if (rollbackError.code === 'canonical_completion_rolled_back') throw rollbackError;
      try { await receipts.markOperationForReconciliation({ receiptId: receipt.receipt_id, actorId, errorCode: 'calendar_rollback_failed' }); } catch {}
      fail('reconciliation_needed', 502, receipt.correlation_id);
    }
  }
}

module.exports = { configured, executeCalendarOperation, validateInput };
