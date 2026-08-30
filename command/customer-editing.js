(() => {
  const role = document.querySelector('meta[name="command-role"]')?.content || '';
  if (!['owner', 'admin'].includes(role)) return;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const initials = value => String(value || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());

  let data = null;
  let editingId = null;
  let saving = false;
  let renderTimer = null;

  const style = document.createElement('style');
  style.textContent = `
    .customer-edit-actions{display:flex;gap:7px;align-items:center}.customer-edit-form{grid-column:1/-1;display:grid;gap:10px;padding:12px 0 4px}.customer-edit-grid{display:grid;grid-template-columns:1fr;gap:9px}.customer-edit-field label{display:block;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--quiet);margin:0 0 5px}.customer-edit-field input,.customer-edit-field select{width:100%;border:1px solid var(--border);border-radius:12px;background:#fff;padding:10px 11px;color:var(--dark);outline:none}.customer-edit-field input:focus,.customer-edit-field select:focus{border-color:rgba(0,131,245,.45);box-shadow:0 0 0 4px rgba(0,131,245,.08)}.customer-edit-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.customer-save{border:1px solid var(--primary);background:var(--primary);color:#fff;border-radius:12px;padding:10px;font-size:11px;font-weight:700}.customer-cancel{border:1px solid var(--border);background:#fff;border-radius:12px;padding:10px;font-size:11px;font-weight:700}.customer-save:disabled,.customer-cancel:disabled{opacity:.55}.customer-write-note{font-size:10px;color:var(--quiet);text-align:center;margin:9px 0 0}@media(min-width:600px){.customer-edit-grid{grid-template-columns:2fr 1fr}}
  `;
  document.head.appendChild(style);

  function toast(message) {
    if (typeof window.showToast === 'function') return window.showToast(message);
    console.info(message);
  }

  async function loadCustomers() {
    const response = await fetch('/api/command-data?resource=customers', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (response.status === 401) return window.location.assign('/command/login/');
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'customer_load_failed');
    return payload.data;
  }

  function render() {
    const list = document.getElementById('customerList');
    if (!list || !data) return;
    const orgById = new Map((data.organizations || []).map(org => [org.id, org]));
    list.innerHTML = (data.customers || []).map(customer => {
      const org = orgById.get(customer.organization_id);
      const search = [customer.display_name, customer.status, org?.display_name, org?.legal_name].filter(Boolean).join(' ').toLowerCase();
      const isEditing = editingId === customer.id;
      return `<div class="list-row" data-search="${escapeHtml(search)}" data-customer-id="${escapeHtml(customer.id)}"><div class="row-icon">${escapeHtml(initials(customer.display_name))}</div><div><div class="row-name">${escapeHtml(customer.display_name)}</div><div class="row-sub">${escapeHtml(org?.display_name || 'Individual customer')} · ${escapeHtml(titleCase(customer.status))}</div></div><div class="customer-edit-actions"><button class="mini-button" type="button" data-customer-edit="${escapeHtml(customer.id)}" ${saving ? 'disabled' : ''}>${isEditing ? 'Editing' : 'Edit'}</button></div>${isEditing ? `<form class="customer-edit-form" data-customer-form="${escapeHtml(customer.id)}"><div class="customer-edit-grid"><div class="customer-edit-field"><label for="customer-name-${escapeHtml(customer.id)}">Customer name</label><input id="customer-name-${escapeHtml(customer.id)}" name="displayName" maxlength="160" required value="${escapeHtml(customer.display_name)}"></div><div class="customer-edit-field"><label for="customer-status-${escapeHtml(customer.id)}">Status</label><select id="customer-status-${escapeHtml(customer.id)}" name="status"><option value="active" ${customer.status === 'active' ? 'selected' : ''}>Active</option><option value="archived" ${customer.status === 'archived' ? 'selected' : ''}>Archived</option></select></div></div><div class="customer-edit-buttons"><button class="customer-cancel" type="button" data-customer-cancel ${saving ? 'disabled' : ''}>Cancel</button><button class="customer-save" type="submit" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save changes'}</button></div><div class="customer-write-note">Owner/Admin write · audited in Command activity</div></form>` : ''}</div>`;
    }).join('') || '<div class="empty"><strong>No customers yet</strong><span>Live Supabase is connected; no canonical customer records have been added yet.</span></div>';
  }

  async function saveCustomer(form, customer) {
    if (saving) return;
    const formData = new FormData(form);
    const displayName = String(formData.get('displayName') || '').trim().replace(/\s+/g, ' ');
    const status = String(formData.get('status') || '');
    if (!displayName) return toast('Customer name is required.');

    saving = true;
    render();
    try {
      const response = await fetch('/api/command-data?resource=customer', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: customer.id, displayName, status, version: customer.version }),
      });
      if (response.status === 401) return window.location.assign('/command/login/');
      const payload = await response.json().catch(() => null);
      if (response.status === 409 && payload?.error === 'stale_customer_version') {
        data = await loadCustomers();
        editingId = null;
        toast('Customer changed elsewhere. Latest data loaded.');
        return;
      }
      if (!response.ok) throw new Error(payload?.error || 'customer_update_failed');
      if (payload.customer) {
        const index = data.customers.findIndex(item => item.id === customer.id);
        if (index >= 0) data.customers[index] = { ...data.customers[index], ...payload.customer };
      }
      editingId = null;
      toast(payload.state === 'unchanged' ? 'No changes to save.' : 'Customer updated.');
      document.dispatchEvent(new CustomEvent('command:customer-updated', { detail: payload.customer || null }));
    } catch (error) {
      toast('Could not save customer. No silent partial update was accepted.');
    } finally {
      saving = false;
      render();
    }
  }

  document.addEventListener('click', event => {
    const edit = event.target.closest('[data-customer-edit]');
    if (edit) {
      editingId = edit.dataset.customerEdit;
      render();
      document.querySelector(`[data-customer-form="${CSS.escape(editingId)}"] input`)?.focus();
      return;
    }
    if (event.target.closest('[data-customer-cancel]')) {
      editingId = null;
      render();
    }
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-customer-form]');
    if (!form) return;
    event.preventDefault();
    const customer = data?.customers?.find(item => item.id === form.dataset.customerForm);
    if (customer) saveCustomer(form, customer);
  });

  const observer = new MutationObserver(() => {
    const list = document.getElementById('customerList');
    if (!list || !data || editingId || saving || list.querySelector('[data-customer-edit]')) return;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 40);
  });

  window.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('customerList');
    if (list) observer.observe(list, { childList: true });
    try {
      data = await loadCustomers();
      setTimeout(render, 80);
      const section = document.querySelector('[data-section="customers"]');
      if (section) {
        const eyebrow = section.querySelector('.section-header .eyebrow');
        if (eyebrow) eyebrow.textContent = 'CRM · Controlled writes';
      }
    } catch (error) {
      console.warn('command_customer_editing_load_failed');
    }
  }, { once: true });
})();
