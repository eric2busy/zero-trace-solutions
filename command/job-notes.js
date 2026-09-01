(() => {
  const role = document.querySelector('meta[name="command-role"]')?.content || '';
  if (!['owner', 'admin', 'operator'].includes(role)) return;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const toast = message => typeof window.showToast === 'function' ? window.showToast(message) : console.info(message);
  const retryKeys = new WeakMap();

  function installStyle() {
    const style = document.createElement('style');
    style.textContent = '.job-note-toggle{margin-left:6px}.job-notes{grid-column:1/-1;border-top:1px solid #e8eef5;margin-top:10px;padding-top:12px}.job-notes-list{display:grid;gap:8px;margin:10px 0}.job-note{padding:10px 11px;background:#fff;border:1px solid #edf2f8;border-radius:12px;font-size:12px;line-height:1.45;white-space:pre-wrap}.job-note-meta{color:var(--quiet);font-size:10px;margin-top:5px}.job-note-form{display:grid;gap:8px}.job-note-form textarea{width:100%;min-height:88px;resize:vertical;border:1px solid var(--border);border-radius:12px;padding:10px 11px;color:var(--dark);font:inherit;line-height:1.4}.job-note-form textarea:focus{outline:none;border-color:rgba(0,131,245,.45);box-shadow:0 0 0 4px rgba(0,131,245,.08)}.job-note-submit{border:1px solid var(--primary);background:var(--primary);color:#fff;border-radius:12px;padding:10px;font-size:11px;font-weight:700}.job-note-submit:disabled{opacity:.55}';
    document.head.appendChild(style);
  }
  async function load(jobId) {
    const response = await fetch(`/api/command-data?resource=notes&jobId=${encodeURIComponent(jobId)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'notes_load_failed');
    return payload.data.notes || [];
  }
  function time(value) { return value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : ''; }
  function notesHtml(notes) {
    return notes.length ? notes.map(note => `<div class="job-note">${escapeHtml(note.body)}<div class="job-note-meta">${escapeHtml(note.actors?.display_name || 'Authorized team member')} · ${escapeHtml(time(note.created_at))}</div></div>`).join('') : '<div class="row-sub">No operational notes yet.</div>';
  }
  async function open(container, jobId) {
    let panel = container.querySelector('.job-notes');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div'); panel.className = 'job-notes'; panel.innerHTML = '<div class="row-sub">Loading notes…</div>'; container.appendChild(panel);
    try {
      const notes = await load(jobId);
      panel.innerHTML = `<div class="panel-title">Operational notes</div><div class="job-notes-list">${notesHtml(notes)}</div><form class="job-note-form"><label class="row-sub" for="note-${escapeHtml(jobId)}">Internal note · 2,000 characters max</label><textarea id="note-${escapeHtml(jobId)}" name="body" maxlength="2000" required></textarea><button class="job-note-submit" type="submit">Add operational note</button></form>`;
      panel.querySelector('textarea')?.focus();
      panel.querySelector('form').addEventListener('submit', event => save(event, panel, jobId));
    } catch { panel.innerHTML = '<div class="row-sub">Notes are unavailable. Nothing was changed.</div>'; }
  }
  async function save(event, panel, jobId) {
    event.preventDefault(); const form = event.currentTarget; const textarea = panel.querySelector('textarea'); const button = panel.querySelector('button'); const body = textarea.value.trim();
    if (!body) return toast('A note cannot be empty.');
    const retry = retryKeys.get(form); const key = retry?.body === body ? retry.key : crypto.randomUUID(); button.disabled = true;
    try {
      const response = await fetch('/api/command-data?resource=note', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jobId, body, idempotencyKey: key }) });
      const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || 'note_create_failed');
      retryKeys.delete(form); textarea.value = ''; const notes = await load(jobId); panel.querySelector('.job-notes-list').innerHTML = notesHtml(notes); toast(payload.state === 'replayed' ? 'Existing note restored.' : 'Operational note added.');
    } catch { retryKeys.set(form, { body, key }); toast('Could not add note. It was not treated as saved.'); } finally { button.disabled = false; }
  }
  document.addEventListener('click', event => { const button = event.target.closest('[data-job-notes]'); if (!button) return; const row = button.closest('[data-job-id]'); if (row) open(row, row.dataset.jobId); });
  window.addEventListener('DOMContentLoaded', installStyle, { once: true });
})();
