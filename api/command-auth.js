const {
  authRequest,
  clearSessionCookies,
  commandRole,
  configured,
  fetchUser,
  refreshSession,
  sessionCookies,
} = require('./_lib/command-auth');

function redirect(res, location, cookies = null) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  if (cookies) res.setHeader('Set-Cookie', cookies);
  res.end();
}

function json(res, statusCode, body, cookies = null) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (cookies) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(body));
}

async function signIn(email, password) {
  const response = await authRequest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await response.json().catch(() => null);
  return response.ok && session?.access_token && session?.refresh_token ? session : null;
}

async function freshAuthorizedUser(session) {
  return session?.access_token ? fetchUser(session.access_token) : null;
}

async function acceptInvite(req, res) {
  const { access_token: accessToken, refresh_token: refreshToken, password } = req.body || {};
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return json(res, 400, { error: 'invalid_invite' });
  }

  const user = await fetchUser(accessToken);
  if (!user || !commandRole(user)) return json(res, 403, { error: 'access_denied' });

  const update = await authRequest('/auth/v1/user', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!update.ok) return json(res, 400, { error: 'password_update_failed' });

  const session = await refreshSession(refreshToken);
  const refreshedUser = await freshAuthorizedUser(session);
  if (!refreshedUser || !commandRole(refreshedUser)) return json(res, 403, { error: 'access_denied' });
  return json(res, 200, { ok: true, redirectTo: '/command/' }, sessionCookies(session));
}

module.exports = async function commandAuth(req, res) {
  const action = req.query?.action;
  if (req.method === 'GET' && action === 'logout') {
    return redirect(res, '/command/login/', clearSessionCookies());
  }
  if (!configured()) {
    if (action === 'accept-invite') return json(res, 503, { error: 'unavailable' });
    res.statusCode = 503;
    return res.end('Command authentication is not configured.');
  }
  if (req.method === 'POST' && action === 'accept-invite') {
    try { return await acceptInvite(req, res); } catch { return json(res, 503, { error: 'unavailable' }); }
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return redirect(res, '/command/login/?error=invalid');
  }

  try {
    const session = await signIn(email, password);
    const user = await freshAuthorizedUser(session);
    if (!user || !commandRole(user)) return redirect(res, '/command/login/?error=access');
    return redirect(res, '/command/', sessionCookies(session));
  } catch {
    return redirect(res, '/command/login/?error=unavailable');
  }
};
