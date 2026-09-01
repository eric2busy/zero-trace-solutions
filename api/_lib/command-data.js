const { randomUUID } = require('node:crypto');

const SERVER_KEY_ENV_NAMES = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

function serverKey() {
  for (const name of SERVER_KEY_ENV_NAMES) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

function configured() {
  return Boolean(process.env.SUPABASE_URL && serverKey());
}

function serverHeaders(key) {
  const headers = {
    apikey: key,
    Accept: 'application/json',
  };

  // Modern sb_secret_ keys are API keys, not JWTs. Sending them as a
  // Bearer token causes Supabase to reject the request as an invalid JWT.
  // The legacy service_role key remains JWT-based and needs Authorization.
  if (!key.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${key}`;
  }

  return headers;
}

async function restRequest(path, options = {}) {
  const key = serverKey();
  if (!process.env.SUPABASE_URL || !key) {
    const error = new Error('Command server data access is not configured.');
    error.code = 'COMMAND_DATA_NOT_CONFIGURED';
    throw error;
  }

  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...serverHeaders(key),
      ...(options.headers || {}),
    },
  });
}

async function readJson(path) {
  let response = await restRequest(path);
  // A GET is safe to retry once. This gives an isolated upstream auth edge a
  // chance to recover (for example during key propagation) without retrying
  // any mutation or obscuring a persistent credential problem.
  if (response.status === 401) response = await restRequest(path);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Command data query failed.');
    error.code = 'COMMAND_DATA_QUERY_FAILED';
    error.status = response.status;
    error.upstreamStatus = response.status;
    throw error;
  }
  return payload;
}

async function writeJson(path, method, body, prefer = 'return=representation') {
  const response = await restRequest(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Command data mutation failed.');
    error.code = 'COMMAND_DATA_MUTATION_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function listCustomers() {
  const customers = await readJson('customers?select=id,organization_id,display_name,status,version,created_at,updated_at&order=updated_at.desc&limit=100');
  const organizations = await readJson('organizations?select=id,display_name,legal_name,status,created_at,updated_at&order=updated_at.desc&limit=100');
  // The directory needs only operational location context. Street addresses,
  // contact details, and other unnecessary customer data stay off this view.
  const locations = await readJson('service_locations?select=id,customer_id,organization_id,label,city,region,timezone,updated_at&order=updated_at.desc&limit=200');
  return { customers, organizations, locations };
}

async function listJobs() {
  const jobs = await readJson('jobs?select=id,kind,status,customer_id,organization_id,service_location_id,title,scheduled_start_at,scheduled_end_at,scheduled_timezone,source_system,completed_at,cancelled_at,version,created_at,updated_at&order=scheduled_start_at.asc.nullslast,updated_at.desc&limit=100');
  // Assignment display is intentionally limited to the active planning role
  // and existing actor display name. Do not expose actor IDs, contact details,
  // permissions, or historical assignments to the Command browser.
  const assignments = await readJson('job_assignments?select=job_id,assignment_role,assigned_at,actors!job_assignments_actor_id_fkey(display_name)&unassigned_at=is.null&order=assigned_at.desc&limit=200');
  const locations = await readJson('service_locations?select=id,label,city,region,timezone&limit=200');
  return { jobs, assignments, locations };
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function actorForAuthUser(authUserId) {
  const rows = await readJson(`actors?select=id&auth_user_id=eq.${encodeURIComponent(authUserId)}&kind=eq.human&status=eq.active&limit=1`);
  return rows?.[0]?.id || null;
}

async function listJobNotes({ authUserId, jobId }) {
  if (!validUuid(jobId)) return { state: 'invalid' };
  const actorId = await actorForAuthUser(authUserId);
  if (!actorId) {
    const error = new Error('Command actor is not provisioned.');
    error.code = 'COMMAND_ACTOR_NOT_PROVISIONED';
    throw error;
  }
  const notes = await readJson(`job_notes?select=id,job_id,kind,body,created_at,actors!job_notes_author_actor_id_fkey(display_name)&job_id=eq.${encodeURIComponent(jobId)}&order=created_at.desc&limit=100`);
  return { state: 'ok', notes };
}

function validateJobNote(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_payload' };
  const allowed = new Set(['jobId', 'body', 'idempotencyKey']);
  if (Object.keys(input).some(key => !allowed.has(key))) return { ok: false, error: 'unsupported_field' };
  const jobId = String(input.jobId || '').trim();
  const body = String(input.body || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!validUuid(jobId)) return { ok: false, error: 'invalid_job_id' };
  if (body.length < 1 || body.length > 2000) return { ok: false, error: 'invalid_note_body' };
  if (!validUuid(idempotencyKey)) return { ok: false, error: 'invalid_idempotency_key' };
  return { ok: true, value: { jobId, body, idempotencyKey } };
}

async function createJobNote({ authUserId, input }) {
  const validated = validateJobNote(input);
  if (!validated.ok) return { state: 'invalid', error: validated.error };
  const actorId = await actorForAuthUser(authUserId);
  if (!actorId) {
    const error = new Error('Command actor is not provisioned.');
    error.code = 'COMMAND_ACTOR_NOT_PROVISIONED';
    throw error;
  }
  const { jobId, body, idempotencyKey } = validated.value;
  const response = await writeJson('rpc/command_create_job_note', 'POST', {
    p_job_id: jobId,
    p_author_actor_id: actorId,
    p_body: body,
    p_idempotency_key: idempotencyKey,
    p_correlation_id: randomUUID(),
  });
  const note = response?.[0];
  if (!note) {
    const error = new Error('Command note operation returned no receipt.');
    error.code = 'COMMAND_NOTE_MISSING_RECEIPT';
    throw error;
  }
  return { state: note.replayed ? 'replayed' : 'created', note };
}

function validateJobPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_payload' };
  const allowed = new Set(['id', 'title', 'status', 'version']);
  if (Object.keys(input).some(key => !allowed.has(key))) return { ok: false, error: 'unsupported_field' };
  const id = String(input.id || '').trim();
  const title = String(input.title || '').trim().replace(/\s+/g, ' ');
  const status = String(input.status || '').trim().toLowerCase();
  const version = Number(input.version);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return { ok: false, error: 'invalid_job_id' };
  if (title.length < 1 || title.length > 200) return { ok: false, error: 'invalid_title' };
  if (!['draft', 'scheduled', 'en_route', 'in_progress', 'completed'].includes(status)) return { ok: false, error: 'invalid_status' };
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: 'invalid_version' };
  return { ok: true, value: { id, title, status, version } };
}

async function listApprovals() {
  // Payload summaries can contain customer or operational details. The current
  // read-only Command surfaces do not render them, so do not transmit them.
  const approvals = await readJson('approvals?select=id,requested_by_actor_id,decided_by_actor_id,action_type,target_type,target_id,authority_level,policy_basis,rationale,status,correlation_id,requested_at,decided_at,expires_at,updated_at&order=requested_at.desc&limit=100');
  const decisions = await readJson('approval_decisions?select=id,approval_id,decided_by_actor_id,decision,authority_basis,rationale,correlation_id,created_at&order=created_at.desc&limit=100');
  return { approvals, decisions };
}

async function listActivity() {
  const activity = await readJson('activity_events?select=id,actor_id,action,target_type,target_id,authority_level,approval_id,correlation_id,outcome,error_code,created_at,actors!activity_events_actor_id_fkey(kind,display_name)&order=created_at.desc&limit=100');
  return { activity };
}

function validateCustomerPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_payload' };
  const allowed = new Set(['id', 'displayName', 'status', 'version']);
  if (Object.keys(input).some(key => !allowed.has(key))) return { ok: false, error: 'unsupported_field' };

  const id = String(input.id || '').trim();
  const displayName = String(input.displayName || '').trim().replace(/\s+/g, ' ');
  const status = String(input.status || '').trim().toLowerCase();
  const version = Number(input.version);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return { ok: false, error: 'invalid_customer_id' };
  if (displayName.length < 1 || displayName.length > 160) return { ok: false, error: 'invalid_display_name' };
  if (!['active', 'archived'].includes(status)) return { ok: false, error: 'invalid_status' };
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: 'invalid_version' };

  return { ok: true, value: { id, displayName, status, version } };
}

async function updateCustomer({ authUserId, input }) {
  const validated = validateCustomerPatch(input);
  if (!validated.ok) return { state: 'invalid', error: validated.error };

  const { id, displayName, status, version } = validated.value;
  const actorId = await actorForAuthUser(authUserId);
  if (!actorId) {
    const error = new Error('Command actor is not provisioned.');
    error.code = 'COMMAND_ACTOR_NOT_PROVISIONED';
    throw error;
  }

  const currentRows = await readJson(`customers?select=id,display_name,status,updated_by,version&id=eq.${encodeURIComponent(id)}&limit=1`);
  const current = currentRows?.[0];
  if (!current) return { state: 'not_found' };
  if (current.version !== version) return { state: 'stale', currentVersion: current.version };

  if (current.display_name === displayName && current.status === status) {
    return { state: 'unchanged', customer: current };
  }

  const changedFields = [];
  if (current.display_name !== displayName) changedFields.push('display_name');
  if (current.status !== status) changedFields.push('status');
  const correlationId = randomUUID();

  const updatedRows = await writeJson(
    `customers?id=eq.${encodeURIComponent(id)}&version=eq.${version}`,
    'PATCH',
    { display_name: displayName, status, updated_by: actorId },
  );
  const updated = updatedRows?.[0];
  if (!updated) return { state: 'stale', currentVersion: current.version };

  try {
    await writeJson('activity_events', 'POST', [{
      actor_id: actorId,
      action: 'customer.updated',
      target_type: 'customer',
      target_id: id,
      authority_level: 'green',
      correlation_id: correlationId,
      outcome: 'succeeded',
      metadata: { changed_fields: changedFields },
    }], 'return=minimal');
  } catch (auditError) {
    try {
      await writeJson(
        `customers?id=eq.${encodeURIComponent(id)}&version=eq.${updated.version}`,
        'PATCH',
        { display_name: current.display_name, status: current.status, updated_by: current.updated_by },
        'return=minimal',
      );
    } catch (rollbackError) {
      const error = new Error('Customer audit failed and compensating rollback failed.');
      error.code = 'COMMAND_CUSTOMER_PARTIAL_MUTATION';
      throw error;
    }
    const error = new Error('Customer audit failed; mutation was rolled back.');
    error.code = 'COMMAND_CUSTOMER_AUDIT_FAILED';
    throw error;
  }

  return {
    state: 'updated',
    customer: {
      id: updated.id,
      organization_id: updated.organization_id,
      display_name: updated.display_name,
      status: updated.status,
      version: updated.version,
      created_at: updated.created_at,
      updated_at: updated.updated_at,
    },
  };
}

function permittedJobStatusTransition(from, to) {
  if (from === to) return true;
  return new Set(['scheduled:en_route', 'scheduled:in_progress', 'scheduled:completed', 'en_route:in_progress', 'en_route:completed', 'in_progress:completed']).has(`${from}:${to}`);
}

async function updateJob({ authUserId, input }) {
  const validated = validateJobPatch(input);
  if (!validated.ok) return { state: 'invalid', error: validated.error };
  const { id, title, status, version } = validated.value;
  const actorId = await actorForAuthUser(authUserId);
  if (!actorId) {
    const error = new Error('Command actor is not provisioned.');
    error.code = 'COMMAND_ACTOR_NOT_PROVISIONED';
    throw error;
  }
  const currentRows = await readJson(`jobs?select=id,title,status,completed_at,cancelled_at,updated_by,version&id=eq.${encodeURIComponent(id)}&limit=1`);
  const current = currentRows?.[0];
  if (!current) return { state: 'not_found' };
  if (current.version !== version) return { state: 'stale', currentVersion: current.version };
  if (current.status === 'cancelled' || !permittedJobStatusTransition(current.status, status)) return { state: 'invalid', error: 'invalid_status_transition' };
  if (current.title === title && current.status === status) return { state: 'unchanged', job: current };

  const changedFields = [];
  if (current.title !== title) changedFields.push('title');
  if (current.status !== status) changedFields.push('status');
  const patch = { title, status, updated_by: actorId };
  if (status === 'completed') patch.completed_at = new Date().toISOString();
  const correlationId = randomUUID();
  const updatedRows = await writeJson(`jobs?id=eq.${encodeURIComponent(id)}&version=eq.${version}`, 'PATCH', patch);
  const updated = updatedRows?.[0];
  if (!updated) return { state: 'stale', currentVersion: current.version };
  try {
    await writeJson('activity_events', 'POST', [{ actor_id: actorId, action: 'job.updated', target_type: 'job', target_id: id, authority_level: 'green', correlation_id: correlationId, outcome: 'succeeded', metadata: { changed_fields: changedFields } }], 'return=minimal');
  } catch (auditError) {
    try {
      const rollback = { title: current.title, status: current.status, completed_at: current.completed_at, updated_by: current.updated_by };
      await writeJson(`jobs?id=eq.${encodeURIComponent(id)}&version=eq.${updated.version}`, 'PATCH', rollback, 'return=minimal');
    } catch (rollbackError) {
      const error = new Error('Job audit failed and compensating rollback failed.'); error.code = 'COMMAND_JOB_PARTIAL_MUTATION'; throw error;
    }
    const error = new Error('Job audit failed; mutation was rolled back.'); error.code = 'COMMAND_JOB_AUDIT_FAILED'; throw error;
  }
  return { state: 'updated', job: updated };
}

module.exports = {
  configured,
  listActivity,
  listApprovals,
  listCustomers,
  listJobs,
  readJson,
  restRequest,
  serverHeaders,
  serverKey,
  updateCustomer,
  updateJob,
  actorForAuthUser,
  createJobNote,
  listJobNotes,
  validUuid,
  validateJobNote,
  validateCustomerPatch,
  validateJobPatch,
  writeJson,
};
