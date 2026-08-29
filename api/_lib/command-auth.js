const COMMAND_COOKIE = '__Host-zt-command-access';
const ALLOWED_INTERACTIVE_ROLES = new Set(['owner', 'admin', 'operator', 'technician']);
function configured() { return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY); }
function parseCookies(header = '') { return Object.fromEntries(header.split(';').map(part => { const i = part.indexOf('='); return i < 0 ? [] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())]; }).filter(([key]) => key)); }
function commandCookie(value, maxAge = null) { const parts = [`${COMMAND_COOKIE}=${encodeURIComponent(value || '')}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']; if (maxAge !== null) parts.push(`Max-Age=${maxAge}`); return parts.join('; '); }
async function fetchUser(accessToken) { if (!configured() || !accessToken) return null; const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` } }); return response.ok ? response.json() : null; }
function commandRole(user) { const role = user?.app_metadata?.command_role; return ALLOWED_INTERACTIVE_ROLES.has(role) ? role : null; }
async function authenticatedCommandUser(req) { const user = await fetchUser(parseCookies(req.headers.cookie)[COMMAND_COOKIE]); const role = commandRole(user); return user && role ? { user, role } : null; }
module.exports = { authenticatedCommandUser, commandCookie, commandRole, configured };
