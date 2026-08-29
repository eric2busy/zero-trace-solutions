const { commandCookie, commandRole, configured } = require('./_lib/command-auth');
function redirect(res, location, cookie) { res.statusCode = 303; res.setHeader('Location', location); res.setHeader('Cache-Control', 'no-store'); if (cookie) res.setHeader('Set-Cookie', cookie); res.end(); }
module.exports = async function commandAuth(req, res) {
  if (req.method === 'GET' && req.query?.action === 'logout') return redirect(res, '/command/login/', commandCookie('', 0));
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method not allowed'); }
  if (!configured()) { res.statusCode = 503; return res.end('Command authentication is not configured.'); }
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') return redirect(res, '/command/login/?error=invalid');
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const session = await response.json();
    if (!response.ok || !session.access_token || !commandRole(session.user)) return redirect(res, '/command/login/?error=access');
    return redirect(res, '/command/', commandCookie(session.access_token, Math.max(60, Number(session.expires_in) || 3600)));
  } catch { return redirect(res, '/command/login/?error=unavailable'); }
};
