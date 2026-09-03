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
    const locationsByCustomerId = new Map();
    for (const location of data.locations || []) {
      if (!location.customer_id) continue;
      const locations = locationsByCustomerId.get(location.customer_id) || [];
      locations.push(location);
      locationsByCustomerId.set(location.customer_id, locations);
    }
    const rows = (data.customers || []).map(customer => {
      const org = orgById.get(customer.organization_id);
      const locations = locationsByCustomerId.get(customer.id) || [];
      const locationSummary = locations.length
        ? `${locations.length} ${locations.length === 1 ? 'service location' : 'service locations'} · ${locations.slice(0, 2).map(location => [location.city, location.region].filter(Boolean).join(', ')).filter(Boolean).join(' · ')}`
        : 'No service location';
      const search = [customer.display_name, customer.status, org?.display_name, org?.legal_name, ...locations.flatMap(location => [location.label, location.city, location.region])].filter(Boolean).join(' ').toLowerCase();
      return `<div class="list-row" data-search="${escapeHtml(search)}"><div class="row-icon">${escapeHtml(initials(customer.display_name))}</div><div><div class="row-name">${escapeHtml(customer.display_name)}</div><div class="row-sub">${escapeHtml(org?.display_name || 'Individual customer')} · ${escapeHtml(titleCase(customer.status))}</div><div class="row-sub">${escapeHtml(locationSummary)}</div></div><span class="chev">›</span></div>`;
    }).join('');
    list.innerHTML = rows || '<div class="empty"><strong>No customers yet</strong><span>Live Supabase is connected; no canonical customer records have been added yet.</span></div>';
    const panel = section.querySelector('.panel-head');
    if (panel) panel.innerHTML = `<div><div class="panel-title">Relationship directory</div><div class="row-sub">Live canonical Supabase records · contact PII withheld in this read-only phase</div></div><span class="badge green">Live</span>`;
    section.querySelector('.section-header .eyebrow').textContent = 'CRM · Live read-only';
  }

  function locationLabel(job, locationsById) {
    const location = locationsById.get(job.service_location_id);
    if (!location) return 'Location pending';
    return [location.label, [location.city, location.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Location pending';
  }

  function assignmentLabel(assignment) {
    const role = titleCase(assignment.assignment_role || 'assigned');
    const name = assignment.actors?.display_name;
    return name ? `${role}: ${name}` : `${role} assigned`;
  }

  function assignmentLabels(job, assignmentsByJobId) {
    const assignments = assignmentsByJobId.get(job.id) || [];
    if (!assignments.length) return 'No active assignment';
    return assignments.slice(0, 3).map(assignmentLabel).join(' · ');
  }

  function jobRow(job, index, locationsById, assignmentsByJobId) {
    return `<div class="list-row" data-job-id="${escapeHtml(job.id)}"><div class="row-icon">${String(index + 1).padStart(2, '0')}</div><div><div class="row-name">${escapeHtml(job.title)}</div><div class="row-sub">${escapeHtml(formatDate(job.scheduled_start_at))} · ${escapeHtml(titleCase(job.kind))} · ${escapeHtml(titleCase(job.source_system))}</div><div class="row-sub">${escapeHtml(locationLabel(job, locationsById))}</div><div class="row-sub">${escapeHtml(assignmentLabels(job, assignmentsByJobId))}</div></div><span class="badge ${badgeClass(job.status)}">${escapeHtml(titleCase(job.status))}</span></div>`;
  }

  function scheduleTime(job, timeZone) {
    return new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(job.scheduled_start_at));
  }

  function scheduleEvent(job, timeZone, locationsById, assignmentsByJobId) {
    return `<article class="schedule-event"><div class="schedule-event-time">${escapeHtml(scheduleTime(job, timeZone))}</div><div><div class="schedule-event-title">${escapeHtml(job.title)}</div><div class="schedule-event-meta">${escapeHtml(locationLabel(job, locationsById))} · ${escapeHtml(titleCase(job.kind))}</div><div class="schedule-event-meta">${escapeHtml(assignmentLabels(job, assignmentsByJobId))}</div></div><span class="badge ${badgeClass(job.status)}">${escapeHtml(titleCase(job.status))}</span></article>`;
  }

  function scheduleDay(group, locationsById, assignmentsByJobId) {
    const count = `${group.jobs.length} ${group.jobs.length === 1 ? 'visit' : 'visits'}`;
    return `<section class="card panel schedule-day"><div class="schedule-day-head"><strong>${escapeHtml(group.label)}</strong><span>${escapeHtml(group.timeZone)} · ${escapeHtml(count)}</span></div>${group.jobs.map(job => scheduleEvent(job, group.timeZone, locationsById, assignmentsByJobId)).join('')}</section>`;
  }

  function renderScheduleLoading() {
    const schedule = document.querySelector('[data-section="jobs"] [data-jobs-view="schedule"]');
    if (!schedule) return;
    schedule.innerHTML = '<div class="section-header"><div class="eyebrow">Operations · Live read-only</div><h2>Schedule</h2><p>Day and week views from the current Command schedule. Google Calendar remains the scheduling authority.</p></div><div class="card panel"><div class="empty"><strong>Loading schedule</strong><span>Retrieving the live read-only schedule.</span></div></div>';
  }

  function renderScheduleError() {
    const schedule = document.querySelector('[data-section="jobs"] [data-jobs-view="schedule"]');
    if (!schedule) return;
    schedule.innerHTML = '<div class="section-header"><div class="eyebrow">Operations · Live read-only</div><h2>Schedule</h2><p>Day and week views from the current Command schedule. Google Calendar remains the scheduling authority.</p></div><div class="card panel"><div class="empty"><strong>Live schedule unavailable</strong><span>Command failed closed. No fixture data was substituted.</span></div></div>';
  }

  function renderSchedule(groups, locationsById, assignmentsByJobId) {
    const schedule = document.querySelector('[data-section="jobs"] [data-jobs-view="schedule"]');
    if (!schedule) return;
    if (!groups.length) {
      schedule.innerHTML = '<div class="section-header"><div class="eyebrow">Operations · Live read-only</div><h2>Schedule</h2><p>Day and week views from the current Command schedule. Google Calendar remains the scheduling authority.</p></div><div class="card panel"><div class="empty"><strong>No scheduled visits</strong><span>There are no dated active jobs to show.</span></div></div><div class="prototype-note">Read-only schedule projection · no Calendar changes</div>';
      return;
    }
    let mode = 'day';
    let selectedKey = groups[0].key;
    const paint = () => {
      const selected = groups.find(group => group.key === selectedKey) || groups[0];
      const days = mode === 'week' ? groups : [selected];
      schedule.innerHTML = `<div class="section-header"><div class="eyebrow">Operations · Live read-only</div><h2>Schedule</h2><p>Grouped in each job’s local timezone. Google Calendar remains the scheduling authority.</p></div><div class="schedule-controls"><div class="schedule-tabs" aria-label="Schedule view"><button type="button" class="schedule-tab ${mode === 'day' ? 'active' : ''}" data-schedule-mode="day" aria-pressed="${mode === 'day'}">Day</button><button type="button" class="schedule-tab ${mode === 'week' ? 'active' : ''}" data-schedule-mode="week" aria-pressed="${mode === 'week'}">Week</button></div><span class="badge blue">Read-only</span></div><div class="schedule-date-rail" aria-label="Scheduled dates">${groups.map(group => `<button type="button" class="schedule-date ${group.key === selectedKey ? 'active' : ''}" data-schedule-date="${escapeHtml(group.key)}" aria-pressed="${group.key === selectedKey}">${escapeHtml(group.shortLabel)}<span>${group.jobs.length}</span></button>`).join('')}</div><div data-schedule-results>${days.map(group => scheduleDay(group, locationsById, assignmentsByJobId)).join('')}</div><div class="prototype-note">Read-only schedule projection · no Calendar changes</div>`;
      schedule.querySelectorAll('[data-schedule-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.scheduleMode; paint(); }));
      schedule.querySelectorAll('[data-schedule-date]').forEach(button => button.addEventListener('click', () => { selectedKey = button.dataset.scheduleDate; mode = 'day'; paint(); }));
    };
    paint();
  }

  function agendaGroup(title, note, jobs, locationsById, assignmentsByJobId) {
    if (!jobs.length) return '';
    return `<section class="card panel schedule-day"><div class="schedule-day-head"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(note)}</span></div>${jobs.map((job, index) => jobRow(job, index, locationsById, assignmentsByJobId)).join('')}</section>`;
  }

  function renderAgenda(jobs, locationsById, assignmentsByJobId) {
    const agenda = document.querySelector('[data-section="jobs"] [data-jobs-view="agenda"]');
    if (!agenda) return;
    const active = jobs.filter(job => !['completed', 'cancelled'].includes(job.status));
    const scheduled = active.filter(job => job.scheduled_start_at).sort((a, b) => new Date(a.scheduled_start_at) - new Date(b.scheduled_start_at));
    const today = scheduled.filter(job => isToday(job.scheduled_start_at));
    const upcoming = scheduled.filter(job => !isToday(job.scheduled_start_at));
    const unscheduled = active.filter(job => !job.scheduled_start_at);
    const completed = jobs.filter(job => ['completed', 'cancelled'].includes(job.status));
    const content = [
      agendaGroup('Today', `${today.length} ${today.length === 1 ? 'job' : 'jobs'}`, today, locationsById, assignmentsByJobId),
      agendaGroup('Upcoming', `${upcoming.length} ${upcoming.length === 1 ? 'job' : 'jobs'}`, upcoming, locationsById, assignmentsByJobId),
      agendaGroup('Unscheduled', `${unscheduled.length} ${unscheduled.length === 1 ? 'job' : 'jobs'}`, unscheduled, locationsById, assignmentsByJobId),
      agendaGroup('Completed', `${completed.length} ${completed.length === 1 ? 'job' : 'jobs'}`, completed, locationsById, assignmentsByJobId),
    ].join('');
    agenda.innerHTML = content || '<div class="card panel"><div class="empty"><strong>No jobs yet</strong><span>Live canonical jobs will appear here.</span></div></div>';
  }

  function renderJobs(data) {
    const jobs = data.jobs || [];
    const locationsById = new Map((data.locations || []).map(location => [location.id, location]));
    const assignmentsByJobId = new Map();
    for (const assignment of data.assignments || []) {
      const assignments = assignmentsByJobId.get(assignment.job_id) || [];
      assignments.push(assignment);
      assignmentsByJobId.set(assignment.job_id, assignments);
    }
    const active = jobs.filter(job => !['completed', 'cancelled'].includes(job.status));
    const inProgress = active.filter(job => String(job.status || '').toLowerCase() === 'in_progress');
    const history = jobs.filter(job => ['completed', 'cancelled'].includes(job.status));
    const section = document.querySelector('[data-section="jobs"]');
    if (section) {
      const panels = section.querySelectorAll('[data-jobs-view="table"] .card.panel');
      if (panels[0]) panels[0].innerHTML = `<div class="panel-head"><div class="panel-title">Active work</div><span class="badge green">${active.length} active</span></div>${active.map((job, index) => jobRow(job, index, locationsById, assignmentsByJobId)).join('') || '<div class="empty"><strong>No active jobs</strong><span>Live canonical jobs will appear here.</span></div>'}`;
      if (panels[1]) panels[1].innerHTML = `<div class="panel-head"><div class="panel-title">Lifecycle history</div><span class="badge gray">Live</span></div>${history.map((job, index) => jobRow(job, index, locationsById, assignmentsByJobId)).join('') || '<div class="empty"><strong>No completed or cancelled jobs</strong><span>History will appear here as work progresses.</span></div>'}`;
      section.querySelector('.section-header .eyebrow').textContent = 'Field work · Live';
      const note = section.querySelector('.prototype-note'); if (note) note.textContent = 'Live canonical job records · Calendar remains the scheduling authority';
      const activeJobsSection = section.querySelector('#activeJobsSection');
      if (activeJobsSection) {
        activeJobsSection.innerHTML = inProgress.length
          ? `<div class="card active-job-card"><div class="panel-head"><div><div class="eyebrow">In progress now</div><div class="panel-title">Active jobs</div></div><span class="badge green">${inProgress.length} live</span></div>${inProgress.map((job, index) => jobRow(job, index, locationsById, assignmentsByJobId)).join('')}</div>`
          : '';
      }
    }

    renderAgenda(jobs, locationsById, assignmentsByJobId);
    const scheduleJobs = active.filter(job => job.scheduled_start_at);
    renderSchedule(window.CommandScheduleView.groupScheduledJobs(scheduleJobs), locationsById, assignmentsByJobId);
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
    const inProgressJobs = activeJobs.filter(job => String(job.status || '').toLowerCase() === 'in_progress');
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
    const dashboardActive = document.getElementById('dashboardActiveJobs');
    if (dashboardActive) dashboardActive.innerHTML = inProgressJobs.length
      ? `<div class="card active-job-card"><div class="panel-head"><div><div class="eyebrow">Happening now</div><div class="panel-title">${inProgressJobs.length === 1 ? '1 active job' : `${inProgressJobs.length} active jobs`}</div></div><button class="panel-action" type="button" data-dashboard-jobs>View work</button></div>${inProgressJobs.slice(0, 2).map((job, index) => jobRow(job, index, new Map((jobs.locations || []).map(location => [location.id, location])), new Map())).join('')}</div>`
      : '';
    dashboardActive?.querySelector('[data-dashboard-jobs]')?.addEventListener('click', () => {
      document.querySelector('[data-target="jobs"]')?.click();
    });
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
    renderScheduleLoading();
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
        if (resource === 'jobs') renderScheduleError();
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
