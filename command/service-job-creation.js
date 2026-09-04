(() => {
  const role = document.querySelector('meta[name="command-role"]')?.content || '';
  if (!['owner', 'admin'].includes(role)) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const idempotency = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let saving = false;

  const style = document.createElement('style');
  style.textContent = `.service-job-create{grid-column:1/-1;display:grid;gap:10px;margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--surface)}.service-job-create label{display:block;margin-bottom:5px;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--quiet)}.service-job-create input,.service-job-create textarea{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:12px;background:var(--surface-raised);padding:10px 11px;color:var(--dark);font:inherit}.service-job-create textarea{min-height:76px;resize:vertical}.service-job-create input:focus,.service-job-create textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 4px rgba(0,131,245,.18)}.service-job-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.service-job-actions button{border-radius:12px;padding:10px;font-size:11px;font-weight:700}.service-job-submit{border:1px solid var(--primary);background:var(--primary);color:#fff}.service-job-cancel{border:1px solid var(--border);background:var(--surface-raised);color:var(--dark)}.service-job-help{font-size:11px;color:var(--quiet);line-height:1.45}`;
  document.head.appendChild(style);

  function toast(message) { if (typeof window.showToast === 'function') window.showToast(message); else console.info(message); }
  function form(job) {
    return `<form class="service-job-create" data-service-job-form="${escapeHtml(job.id)}"><div><label for="service-title-${escapeHtml(job.id)}">Service job title</label><input id="service-title-${escapeHtml(job.id)}" name="title" maxlength="200" required value="${escapeHtml(job.title ? `Service visit — ${job.title}` : 'Service visit')}"></div><div><label for="service-scope-${escapeHtml(job.id)}">Service scope (internal)</label><textarea id="service-scope-${escapeHtml(job.id)}" name="scope" maxlength="2000" placeholder="Coverage, access, timing, or agreed work details"></textarea></div><div class="service-job-help">This creates a new draft service job linked to the same client and service location. Schedule it next using the existing Calendar workflow. Pricing and invoicing are not part of this step.</div><div class="service-job-actions"><button class="service-job-cancel" type="button" data-service-job-cancel>Cancel</button><button class="service-job-submit" type="submit">Create service job</button></div></form>`;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-create-service-job]');
    if (button) {
      const row = button.closest('[data-job-id]');
      if (!row || row.querySelector('[data-service-job-form]')) return;
      row.insertAdjacentHTML('beforeend', form({ id: button.dataset.createServiceJob, title: button.dataset.walkthroughTitle }));
      row.querySelector('[data-service-job-form] input')?.focus();
      return;
    }
    if (event.target.closest('[data-service-job-cancel]')) event.target.closest('[data-service-job-form]')?.remove();
  });

  document.addEventListener('submit', async event => {
    const formElement = event.target.closest('[data-service-job-form]');
    if (!formElement || saving) return;
    event.preventDefault();
    const title = String(new FormData(formElement).get('title') || '').trim().replace(/\s+/g, ' ');
    const scope = String(new FormData(formElement).get('scope') || '').trim().replace(/\s+/g, ' ');
    if (!title) return toast('A service job title is required.');
    saving = true;
    const submit = formElement.querySelector('[type="submit"]'); if (submit) { submit.disabled = true; submit.textContent = 'Creating…'; }
    try {
      const response = await fetch('/api/command-data?resource=service-job', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ walkthroughJobId: formElement.dataset.serviceJobForm, title, scope, idempotencyKey: idempotency() }) });
      if (response.status === 401) return window.location.assign('/command/login/');
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'service_job_create_failed');
      toast(payload.state === 'replayed' ? 'The linked service job already exists. Latest Jobs loaded.' : 'Service job created. Schedule it when ready.');
      window.location.reload();
    } catch (error) {
      toast('Could not create the service job. No duplicate client or service location was created.');
    } finally { saving = false; if (submit?.isConnected) { submit.disabled = false; submit.textContent = 'Create service job'; } }
  });
})();
