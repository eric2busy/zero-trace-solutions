const fs = require('fs/promises');
const path = require('path');
const { authenticatedCommandUser, configured } = require('./_lib/command-auth');

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

module.exports = async function command(req, res) {
  if (!configured()) {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    return res.end('Command authentication is not configured.');
  }

  const identity = await authenticatedCommandUser(req);
  if (!identity) {
    res.statusCode = 303;
    res.setHeader('Location', '/command/login/');
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }

  const view = req.query?.view === 'approvals' ? 'approvals.html' : 'index.html';
  const template = await fs.readFile(path.join(process.cwd(), 'command', view), 'utf8');
  const metadata = `<meta name="command-role" content="${identity.role}"><meta name="command-user" content="${escapeHtml(identity.user.email || 'Authorized user')}">`;
  const commandScripts = view === 'index.html'
    ? '<script src="/command/schedule-view.js" defer></script><script src="/command/live-data.js" defer></script><script src="/command/health-live.js" defer></script><script src="/command/communication-history.js" defer></script><script src="/command/customer-editing.js" defer></script><script src="/command/job-editing.js" defer></script><script src="/command/job-notes.js" defer></script><script src="/command/calendar-operations.js" defer></script>'
    : '';
  const html = template
    .replace('<!-- COMMAND_IDENTITY -->', metadata)
    .replace('</body>', `${commandScripts}</body>`);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  if (identity.cookies) res.setHeader('Set-Cookie', identity.cookies);
  res.end(html);
};
