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
  const response = await restRequest(path);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Command data query failed.');
    error.code = 'COMMAND_DATA_QUERY_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function listCustomers() {
  const customers = await readJson('customers?select=id,organization_id,display_name,status,created_at,updated_at&order=updated_at.desc&limit=100');
  const organizations = await readJson('organizations?select=id,display_name,legal_name,status,created_at,updated_at&order=updated_at.desc&limit=100');
  return { customers, organizations };
}

async function listJobs() {
  const jobs = await readJson('jobs?select=id,kind,status,customer_id,organization_id,service_location_id,title,scheduled_start_at,scheduled_end_at,scheduled_timezone,source_system,completed_at,cancelled_at,created_at,updated_at&order=scheduled_start_at.asc.nullslast,updated_at.desc&limit=100');
  const assignments = await readJson('job_assignments?select=id,job_id,actor_id,assignment_role,assigned_at,unassigned_at&unassigned_at=is.null&order=assigned_at.desc&limit=200');
  return { jobs, assignments };
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
};
