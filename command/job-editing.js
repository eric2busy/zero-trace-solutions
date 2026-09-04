(() => {
  const role = document.querySelector('meta[name="command-role"]')?.content || '';
  if (!['owner', 'admin'].includes(role)) return;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  const formatDate = value => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Unscheduled';
  let data = null; let editingId = null; let saving = false; let timer = null;

  const style = document.createElement('style');
  style.textContent = '.job-edit-actions{display:flex;gap:7px;align-items:center}.job-edit-form{grid-column:1/-1;display:grid;gap:10px;padding:12px 0 4px}.job-edit-grid{display:grid;grid-template-columns:1fr;gap:9px}.job-edit-field label{display:block;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--quiet);margin:0 0 5px}.job-edit-field input,.job-edit-field select,.job-edit-field textarea{width:100%;border:1px solid var(--border);border-radius:12px;background:var(--surface-raised);padding:10px 11px;color:var(--dark);outline:none;color-scheme:light}.job-edit-field select option{background:var(--surface-raised);color:var(--dark)}.job-edit-field input::placeholder,.job-edit-field textarea::placeholder{color:var(--quiet);opacity:1}.job-edit-field input:focus,.job-edit-field select:focus,.job-edit-field textarea:focus{border-color:var(--primary);box-shadow:0 0 0 4px rgba(0,131,245,.18)}.job-edit-field input:disabled,.job-edit-field select:disabled,.job-edit-field textarea:disabled,.job-edit-field input[readonly],.job-edit-field textarea[readonly]{background:var(--surface);color:var(--quiet);cursor:not-allowed}.job-edit-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.job-save{border:1px solid var(--primary);background:var(--primary);color:#fff;border-radius:12px;padding:10px;font-size:11px;font-weight:700}.job-cancel{border:1px solid var(--border);background:var(--surface-raised);color:var(--dark);border-radius:12px;padding:10px;font-size:11px;font-weight:700}.job-save:disabled,.job-cancel:disabled{opacity:.55;cursor:not-allowed}:root[data-theme="dark"] .job-edit-field input,:root[data-theme="dark"] .job-edit-field select,:root[data-theme="dark"] .job-edit-field textarea{color-scheme:dark}@media(min-width:600px){.job-edit-grid{grid-template-columns:2fr 1fr}}';
  document.head.appendChild(style);
  const toast = message => typeof window.showToast === 'function' ? window.showToast(message) : console.info(message);
  const allowedNext = { scheduled: ['scheduled', 'en_route', 'in_progress', 'completed'], en_route: ['en_route', 'in_progress', 'completed'], in_progress: ['in_progress', 'completed'], completed: ['completed'], draft: ['draft'] };

  async function loadJobs() {
    const response = await fetch('/api/command-data?resource=jobs', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401) return window.location.assign('/command/login/');
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'job_load_failed');
    return payload.data;
  }
  function row(job, index) {
    const options = (allowedNext[job.status] || [job.status]).map(status => `<option value="${status}" ${status === job.status ? 'selected' : ''}>${escapeHtml(titleCase(status))}</option>`).join('');
    const editing = editingId === job.id;
    const state = [job.scheduled_start_at ? 'scheduled' : 'needs-scheduling', !['completed', 'cancelled'].includes(job.status) ? 'active' : 'completed', job.status].join(' ');
    const scheduleNote = job.scheduled_start_at ? '' : '<span class="badge amber">Needs scheduling</span>';
    return `<div class="list-row" data-job-id="${escapeHtml(job.id)}" data-job-state="${escapeHtml(state)}"><div class="row-icon">${String(index + 1).padStart(2, '0')}</div><div><div class="row-name">${escapeHtml(job.title)}</div><div class="row-sub">${escapeHtml(formatDate(job.scheduled_start_at))} · ${escapeHtml(titleCase(job.kind))}</div></div><div class="job-edit-actions">${scheduleNote}<span class="badge ${job.status === 'completed' ? 'gray' : 'green'}">${escapeHtml(titleCase(job.status))}</span><button class="mini-button" type="button" data-job-notes="${escapeHtml(job.id)}">Notes</button><button class="mini-button" type="button" data-job-edit="${escapeHtml(job.id)}" ${saving ? 'disabled' : ''}>${editing ? 'Editing' : 'Edit'}</button></div>${editing ? `<form class="job-edit-form" data-job-form="${escapeHtml(job.id)}"><div class="job-edit-grid"><div class="job-edit-field"><label for="job-title-${escapeHtml(job.id)}">Job title</label><input id="job-title-${escapeHtml(job.id)}" name="title" maxlength="200" required value="${escapeHtml(job.title)}"></div><div class="job-edit-field"><label for="job-status-${escapeHtml(job.id)}">Operational status</label><select id="job-status-${escapeHtml(job.id)}" name="status">${options}</select></div></div><div class="job-edit-buttons"><button class="job-cancel" type="button" data-job-cancel ${saving ? 'disabled' : ''}>Cancel</button><button class="job-save" type="submit" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save changes'}</button></div><div class="job-write-note">Owner/Admin write · audited · Calendar schedule and cancellation are locked</div></form>` : ''}</div>`;
  }
  function render() {
    const section = document.querySelector('[data-section="jobs"]'); if (!section || !data) return;
    const list = section.querySelector('#jobsList');
    const ordered = [...(data.jobs || [])].sort((a, b) => Number(!a.scheduled_start_at) - Number(!b.scheduled_start_at) || new Date(a.scheduled_start_at || a.updated_at) - new Date(b.scheduled_start_at || b.updated_at));
    if (list) list.innerHTML = ordered.map(row).join('') || '<div class="empty"><strong>No jobs yet</strong><span>Live canonical jobs will appear here.</span></div>';
    window.CommandJobsFilter?.();
    section.querySelector('.section-header .eyebrow').textContent = 'Field work · Controlled writes';
    const note = section.querySelector('.prototype-note'); if (note) note.textContent = 'Operational title/status edits only · Google Calendar remains scheduling authority';
  }
  async function save(form, job) {
    if (saving) return; const fd = new FormData(form); const title = String(fd.get('title') || '').trim().replace(/\s+/g, ' '); const status = String(fd.get('status') || '');
    if (!title) return toast('Job title is required.'); saving = true; render();
    try {
      const response = await fetch('/api/command-data?resource=job', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id: job.id, title, status, version: job.version }) });
      if (response.status === 401) return window.location.assign('/command/login/'); const payload = await response.json().catch(() => null);
      if (response.status === 409 && payload?.error === 'stale_job_version') { data = await loadJobs(); editingId = null; toast('Job changed elsewhere. Latest data loaded.'); return; }
      if (!response.ok) throw new Error(payload?.error || 'job_update_failed');
      if (payload.job) { const i = data.jobs.findIndex(item => item.id === job.id); if (i >= 0) data.jobs[i] = { ...data.jobs[i], ...payload.job }; }
      editingId = null; toast(payload.state === 'unchanged' ? 'No changes to save.' : 'Job updated.');
    } catch { toast('Could not save job. No silent partial update was accepted.'); } finally { saving = false; render(); }
  }
  document.addEventListener('click', event => { const edit = event.target.closest('[data-job-edit]'); if (edit) { editingId = edit.dataset.jobEdit; render(); document.querySelector(`[data-job-form="${CSS.escape(editingId)}"] input`)?.focus(); return; } if (event.target.closest('[data-job-cancel]')) { editingId = null; render(); } });
  document.addEventListener('submit', event => { const form = event.target.closest('[data-job-form]'); if (!form) return; event.preventDefault(); const job = data?.jobs?.find(item => item.id === form.dataset.jobForm); if (job) save(form, job); });
  window.addEventListener('DOMContentLoaded', async () => { try { data = await loadJobs(); setTimeout(render, 100); const section = document.querySelector('[data-section="jobs"]'); if (section) new MutationObserver(() => { if (!editingId && !saving && !section.querySelector('[data-job-edit]')) { clearTimeout(timer); timer = setTimeout(render, 40); } }).observe(section, { childList: true, subtree: true }); } catch { console.warn('command_job_editing_load_failed'); } }, { once: true });
})();
