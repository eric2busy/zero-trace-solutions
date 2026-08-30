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
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
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

module.exports = {
  configured,
  listCustomers,
  readJson,
  restRequest,
  serverKey,
};
