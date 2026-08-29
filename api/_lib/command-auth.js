const ACCESS_COOKIE = '__Host-zt-command-access';
const REFRESH_COOKIE = '__Host-zt-command-refresh';
const ALLOWED_INTERACTIVE_ROLES = new Set(['owner', 'admin', 'operator', 'technician']);

function configured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function secureCookie(name, value, maxAge = null) {
  const parts = [`${name}=${encodeURIComponent(value || '')}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAge !== null) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

function sessionCookies(session) {
  const maxAge = Math.max(60, Number(session?.expires_in) || 3600);
  return [
    secureCookie(ACCESS_COOKIE, session.access_token, maxAge),
    secureCookie(REFRESH_COOKIE, session.refresh_token, 60 * 60 * 24 * 7),
  ];
}

function clearSessionCookies() {
  return [secureCookie(ACCESS_COOKIE, '', 0), secureCookie(REFRESH_COOKIE, '', 0)];
}

async function authRequest(path, options = {}) {
  return fetch(`${process.env.SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      ...(options.headers || {}),
    },
  });
}

async function fetchUser(accessToken) {
  if (!configured() || !accessToken) return null;
  const response = await authRequest('/auth/v1/user', { headers: { Authorization: `Bearer ${accessToken}` } });
  return response.ok ? response.json() : null;
}

function commandRole(user) {
  const role = user?.app_metadata?.command_role;
  return ALLOWED_INTERACTIVE_ROLES.has(role) ? role : null;
}

async function refreshSession(refreshToken) {
  if (!configured() || !refreshToken) return null;
  const response = await authRequest('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const session = await response.json().catch(() => null);
  return response.ok && session?.access_token && session?.refresh_token ? session : null;
}

async function authenticatedCommandUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  let accessToken = cookies[ACCESS_COOKIE];
  let user = await fetchUser(accessToken);
  let session = null;

  if (!user && cookies[REFRESH_COOKIE]) {
    session = await refreshSession(cookies[REFRESH_COOKIE]);
    if (session) {
      accessToken = session.access_token;
      user = await fetchUser(accessToken);
    }
  }

  const role = commandRole(user);
  return user && role ? { user, role, cookies: session ? sessionCookies(session) : null } : null;
}

module.exports = {
  authRequest,
  authenticatedCommandUser,
  clearSessionCookies,
  commandRole,
  configured,
  fetchUser,
  refreshSession,
  sessionCookies,
};
