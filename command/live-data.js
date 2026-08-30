(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  const initials = value => String(value || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const badgeClass = value => ({
    active: 'green', scheduled: 'green', completed: 'gray', cancelled: 'red', rejected: 'red',
    approved: 'green', modified: 'amber', pending: 'amber', expired: 'gray', green: 'green', yellow: 'amber', red: 'red',
  })[String(value || '').toLowerCase()] || 'blue';
  const formatDate = value => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Unscheduled';

  async function load(resource) {
    const response = await fetch(`/api/command-data?resource=${encodeURIComponent(resource)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) {
      window.location.assign('/command/login/');
      throw new Error('authentication_required');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'command_data_read_failed');
    return payload.data;
  }

  function renderCustomers(data) {
    const section = document.querySelector('[data-section="customers"]');
    const list = document.getElementById('customerList');
    if (!section || !list) return;
    const orgById = new Map((data.organizations || []).map(org => [org.id, org]));
    const rows = (data.customers || []).map(customer => {
      const org = orgById.get(customer.organization_id);
      const search = [customer.display_name, customer.status, org?.display_name, org?.legal_name].filter(Boolean).join(' ').toLowerCase();
      return `<div class="list-row" data-search="${escapeHtml(search)}"><div class="row-icon">${escapeHtml(initials(customer.display_name))}</div><div><div class="row-name">${escapeHtml(customer.display_name)}</div><div class="row-sub">${escapeHtml(org?.display_name || 'Individual customer')} · ${escapeHtml(titleCase(customer.status))}</div></div><span class="chev">›</span></div>`;
    }).join('');
    list.innerHTML = rows || '<div class="empty"><strong>No customers yet</strong><span>Live Supabase is connected; no canonical customer records have been added yet.</span></div>';
    const panel = section.querySelector('.panel-head');
    if (panel) panel.innerHTML = `<div><div class="panel-title">Relationship directory</div><div class="row-sub">Live canonical Supabase records · contact PII withheld in this read-only phase</div></div><span class="badge green">Live</span>`;
    section.querySelector('.section-header .eyebrow').textContent = 'CRM · Live read-only';
  }

  function jobRow(job, index) {
    return `<div class="list-row"><div class="row-icon">${String(index + 1).padStart(2, '0')}</div><div><div class="row-name">${escapeHtml(job.title)}</div><div class="row-sub">${escapeHtml(formatDate(job.scheduled_start_at))} · ${escapeHtml(titleCase(job.kind))} · ${escapeHtml(titleCase(job.source_system))}</div></div><span class="badge ${badgeClass(job.status)}">${escapeHtml(titleCase(job.status))}</span></div>`;
  }

  function renderJobs(data) {
    const jobs = data.jobs || [];
    const active = jobs.filter(job => !['completed', 'cancelled'].includes(job.status));
    const history = jobs.filter(job => ['completed', 'cancelled'].includes(job.status));
    const section = document.querySelector('[data-section="jobs"]');
    if (section) {
      const panels = section.querySelectorAll('.card.panel');
      if (panels[0]) panels[0].innerHTML = `<div class="panel-head"><div class="panel-title">Active work</div><span class="badge green">${active.length} active</span></div>${active.map(jobRow).join('') || '<div class="empty"><strong>No active jobs</strong><span>Live canonical jobs will appear here.</span></div>'}`;
      if (panels[1]) panels[1].innerHTML = `<div class="panel-head"><div class="panel-title">Lifecycle history</div><span class="badge gray">Live</span></div>${history.map(jobRow).join('') || '<div class="empty"><strong>No completed or cancelled jobs</strong><span>History will appear here as work progresses.</span></div>'}`;
      section.querySelector('.section-header .eyebrow').textContent = 'Field work · Live read-only';
      const note = section.querySelector('.prototype-note'); if (note) note.textContent = 'Live Supabase job records · operational writes remain disabled';
    }

    const schedule = document.querySelector('[data-section="schedule"]');
    if (schedule) {
      const timeline = schedule.querySelector('.timeline');
      const scheduled = active.filter(job => job.scheduled_start_at).sort((a, b) => new Date(a.scheduled_start_at) - new Date(b.scheduled_start_at));
      if (timeline) timeline.innerHTML = scheduled.map(job => `<div class="event"><div class="event-time">${escapeHtml(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(job.scheduled_start_at)))}</div><div><div class="event-name">${escapeHtml(job.title)}</div><div class="event-meta">${escapeHtml(titleCase(job.kind))} · ${escapeHtml(job.scheduled_timezone || 'Timezone pending')}</div></div><span class="badge ${badgeClass(job.status)}">${escapeHtml(titleCase(job.status))}</span></div>`).join('') || '<div class="empty"><strong>No scheduled visits</strong><span>Live jobs exist independently from Google Calendar until that integration is approved.</span></div>';
      schedule.querySelector('.section-header .eyebrow').textContent = 'Operations · Live read-only';
      const note = schedule.querySelector('.prototype-note'); if (note) note.textContent = 'Live Supabase schedule projection · Google Calendar remains disconnected';
    }
  }

  function renderApprovals(data) {
    const section = document.querySelector('[data-section="approvals"]');
    if (!section) return;
    const pending = (data.approvals || []).filter(item => item.status === 'pending');
    const decided = (data.approvals || []).filter(item => item.status !== 'pending');
    section.innerHTML = `<div class="section-header"><div class="eyebrow">Owner control · Live read-only</div><h2>Approvals</h2><p>Canonical approval requests and retained decisions. Decision writes are not enabled yet.</p></div>${pending.map(item => `<div class="card approval"><div class="approval-top"><div><div class="eyebrow">${escapeHtml(titleCase(item.target_type))}</div><h3>${escapeHtml(titleCase(item.action_type))}</h3></div><span class="badge amber">Yellow</span></div><p>${escapeHtml(item.rationale)}</p><div class="row-sub">Requested ${escapeHtml(formatDate(item.requested_at))}${item.expires_at ? ` · Expires ${escapeHtml(formatDate(item.expires_at))}` : ''}</div></div>`).join('') || '<div class="card"><div class="empty"><strong>No pending approvals</strong><span>Nothing is waiting on an owner decision.</span></div></div>'}<div class="card panel"><div class="panel-head"><div class="panel-title">Recently decided</div><span class="badge gray">Audit retained</span></div>${decided.slice(0, 20).map(item => `<div class="list-row"><div class="row-icon">${item.status === 'approved' ? '✓' : '•'}</div><div><div class="row-name">${escapeHtml(titleCase(item.action_type))}</div><div class="row-sub">${escapeHtml(titleCase(item.target_type))} · ${escapeHtml(formatDate(item.decided_at || item.updated_at))}</div></div><span class="badge ${badgeClass(item.status)}">${escapeHtml(titleCase(item.status))}</span></div>`).join('') || '<div class="empty"><strong>No decisions yet</strong><span>Decision receipts will appear here.</span></div>'}</div>`;
  }

  function renderActivity(data) {
    const section = document.querySelector('[data-section="activity"]');
    if (!section) return;
    const rows = (data.activity || []).map(item => {
      const actor = item.actors || {};
      const marker = actor.kind === 'human' ? 'HU' : actor.kind === 'service' ? 'SV' : 'AI';
      const actorName = actor.display_name || titleCase(actor.kind) || 'Activity actor';
      return `<div class="list-row"><div class="row-icon">${marker}</div><div><div class="row-name">${escapeHtml(titleCase(item.action))}</div><div class="row-sub">${escapeHtml(actorName)} · ${escapeHtml(titleCase(item.target_type))} · ${escapeHtml(formatDate(item.created_at))}</div></div><span class="badge ${badgeClass(item.authority_level)}">${escapeHtml(titleCase(item.authority_level))}</span></div>`;
    }).join('');
    section.innerHTML = `<div class="section-header"><div class="eyebrow">Oversight · Live read-only</div><h2>AI Activity</h2><p>A human-readable view of the canonical activity ledger.</p></div><div class="card panel">${rows || '<div class="empty"><strong>No activity yet</strong><span>The live audit ledger is connected and empty.</span></div>'}</div>`;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function dashboardEvent(job) {
    return `<div class="event"><div class="event-time">${escapeHtml(new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(job.scheduled_start_at)))}</div><div><div class="event-name">${escapeHtml(job.title)}</div><div class="event-meta">${escapeHtml(titleCase(job.kind))} · ${escapeHtml(job.scheduled_timezone || 'Timezone pending')}</div></div><span class="badge ${badgeClass(job.status)}">${escapeHtml(titleCase(job.status))}</span></div>`;
  }

  function dashboardActivity(item) {
    const actor = item.actors || {};
    const actorName = actor.display_name || titleCase(actor.kind) || 'Activity actor';
    return `<div class="attention"><div><strong>${escapeHtml(titleCase(item.action))}</strong><span>${escapeHtml(actorName)} · ${escapeHtml(titleCase(item.target_type))} · ${escapeHtml(formatDate(item.created_at))}</span></div><span class="badge ${badgeClass(item.authority_level)}">${escapeHtml(titleCase(item.authority_level))}</span></div>`;
  }

  function isToday(value) {
    if (!value) return false;
    const date = new Date(value);
    const today = new Date();
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  }

  function renderDashboard({ customers, jobs, approvals, activity }) {
    const liveCustomers = customers.customers || [];
    const liveJobs = jobs.jobs || [];
    const activeJobs = liveJobs.filter(job => !['completed', 'cancelled'].includes(job.status));
    const scheduled = activeJobs.filter(job => job.scheduled_start_at).sort((a, b) => new Date(a.scheduled_start_at) - new Date(b.scheduled_start_at));
    const todayJobs = scheduled.filter(job => isToday(job.scheduled_start_at));
    const pendingApprovals = (approvals.approvals || []).filter(item => item.status === 'pending');
    const liveActivity = activity.activity || [];

    setText('dashboardDate', new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date()));
    setText('dashboardTodayValue', String(todayJobs.length));
    setText('dashboardTodayNote', todayJobs.length === 1 ? '1 scheduled visit' : `${todayJobs.length} scheduled visits`);
    setText('dashboardCustomersValue', String(liveCustomers.length));
    setText('dashboardCustomersNote', liveCustomers.length === 1 ? '1 canonical customer' : `${liveCustomers.length} canonical customers`);
    setText('dashboardApprovalsValue', String(pendingApprovals.length));
    setText('dashboardApprovalsNote', pendingApprovals.length === 1 ? '1 awaiting a decision' : `${pendingApprovals.length} awaiting a decision`);
    setText('dashboardActivityValue', String(liveActivity.length));
    setText('dashboardActivityNote', liveActivity.length === 1 ? '1 recent ledger event' : `${liveActivity.length} recent ledger events`);
    setText('dashboardScheduleAction', todayJobs.length ? `${todayJobs.length} today` : 'Nothing today');
    setText('dashboardApprovalsAction', pendingApprovals.length ? `${pendingApprovals.length} waiting` : 'Nothing waiting');

    const nextUp = document.getElementById('dashboardNextUp');
    if (nextUp) nextUp.innerHTML = scheduled.slice(0, 5).map(dashboardEvent).join('') || '<div class="empty"><strong>No scheduled visits</strong><span>Live jobs exist independently from Google Calendar until that integration is approved.</span></div>';
    const recentActivity = document.getElementById('dashboardRecentActivity');
    if (recentActivity) recentActivity.innerHTML = liveActivity.slice(0, 3).map(dashboardActivity).join('') || '<div class="empty"><strong>No activity yet</strong><span>The live audit ledger is connected and empty.</span></div>';
    setText('dashboardActivityBadge', liveActivity.length ? `${liveActivity.length} events` : 'Empty');
  }

  function showDashboardLoadError() {
    ['dashboardTodayValue', 'dashboardCustomersValue', 'dashboardApprovalsValue', 'dashboardActivityValue'].forEach(id => setText(id, '—'));
    ['dashboardTodayNote', 'dashboardCustomersNote', 'dashboardApprovalsNote', 'dashboardActivityNote'].forEach(id => setText(id, 'Live data unavailable'));
    const message = '<div class="empty"><strong>Live data unavailable</strong><span>Command failed closed. No fixture data was substituted.</span></div>';
    const nextUp = document.getElementById('dashboardNextUp'); if (nextUp) nextUp.innerHTML = message;
    const recentActivity = document.getElementById('dashboardRecentActivity'); if (recentActivity) recentActivity.innerHTML = message;
    setText('dashboardActivityBadge', 'Unavailable');
  }

  function showLoadError(resource) {
    const section = document.querySelector(`[data-section="${resource === 'customers' ? 'customers' : resource}"]`);
    if (!section) return;
    const note = document.createElement('div');
    note.className = 'card panel';
    note.innerHTML = '<div class="empty"><strong>Live data unavailable</strong><span>Command failed closed. No fixture data was substituted.</span></div>';
    section.appendChild(note);
  }

  async function boot() {
    const resources = [
      ['customers', renderCustomers],
      ['jobs', renderJobs],
      ['approvals', renderApprovals],
      ['activity', renderActivity],
    ];
    const results = await Promise.all(resources.map(async ([resource, render]) => {
      try {
        const data = await load(resource);
        render(data);
        return [resource, data];
      } catch (error) {
        console.warn('command_live_data_load_failed', resource);
        showLoadError(resource);
        return null;
      }
    }));
    const dashboardData = Object.fromEntries(results.filter(Boolean));
    if (Object.keys(dashboardData).length === resources.length) renderDashboard(dashboardData);
    else showDashboardLoadError();
  }

  window.addEventListener('DOMContentLoaded', boot, { once: true });
})();
