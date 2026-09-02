(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const titleCase = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
  const formatDate = value => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'None';

  async function loadHealth() {
    const response = await fetch('/api/command-data?resource=health', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 401) {
      window.location.assign('/command/login/');
      throw new Error('authentication_required');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || 'command_health_read_failed');
    return payload.data;
  }

  function healthVisual(state) {
    if (state === 'attention' || state === 'unavailable') return { dot: 'warn', badge: state === 'attention' ? 'amber' : 'red' };
    return { dot: '', badge: 'green' };
  }

  function sourceRow(name, state, note) {
    const visual = healthVisual(state);
    return `<div class="health-row"><span class="health-dot ${visual.dot}"></span><div><div class="health-name">${escapeHtml(name)}</div><div class="health-note">${escapeHtml(note)}</div></div><span class="badge ${visual.badge}">${escapeHtml(titleCase(state))}</span></div>`;
  }

  function render(data) {
    const section = document.querySelector('[data-section="health"]');
    if (!section) return;
    const business = data.business || {};
    const health = data.health || {};
    const calendar = health.calendarOperations || {};
    const outbox = health.integrationOutbox || {};
    const exceptions = business.activity?.recentExceptions || [];
    const attentionCount = Number(calendar.reconciliationNeeded || 0) + Number(outbox.needsAttention || 0) + exceptions.length;
    const overallState = attentionCount > 0 ? 'attention' : Object.values({ customers: health.customers, jobs: health.jobs, approvals: health.approvals, activity: health.activity }).includes('unavailable') || [calendar.state, outbox.state].includes('unavailable') ? 'unavailable' : 'healthy';
    const overallBadge = overallState === 'healthy' ? 'green' : overallState === 'attention' ? 'amber' : 'red';

    const nextJob = business.jobs?.nextUpcoming;
    const summaryCards = `<div class="grid stats">
      <div class="card stat"><div class="stat-top"><span class="stat-label">Customers</span><span class="stat-icon">◎</span></div><div><div class="stat-value">${escapeHtml(business.customers?.total ?? '—')}</div><div class="stat-note">${escapeHtml(business.customers ? `${business.customers.active} active` : 'Source unavailable')}</div></div></div>
      <div class="card stat"><div class="stat-top"><span class="stat-label">Active jobs</span><span class="stat-icon">◇</span></div><div><div class="stat-value">${escapeHtml(business.jobs?.active ?? '—')}</div><div class="stat-note">${escapeHtml(nextJob ? `Next ${formatDate(nextJob.scheduled_start_at)}` : business.jobs ? 'No upcoming scheduled job' : 'Source unavailable')}</div></div></div>
      <div class="card stat"><div class="stat-top"><span class="stat-label">Pending approvals</span><span class="stat-icon">✓</span></div><div><div class="stat-value">${escapeHtml(business.approvals?.pending ?? '—')}</div><div class="stat-note">${escapeHtml(business.approvals ? `${business.approvals.expired} expired` : 'Source unavailable')}</div></div></div>
      <div class="card stat"><div class="stat-top"><span class="stat-label">Attention signals</span><span class="stat-icon">!</span></div><div><div class="stat-value">${escapeHtml(attentionCount)}</div><div class="stat-note">Reconciliation, outbox, and recent exceptions</div></div></div>
    </div>`;

    const rows = [
      sourceRow('Customer data', health.customers || 'unavailable', health.customers === 'healthy' ? 'Canonical customer reads available' : 'Canonical customer source unavailable'),
      sourceRow('Jobs & scheduling data', health.jobs || 'unavailable', health.jobs === 'healthy' ? 'Canonical job reads available' : 'Canonical job source unavailable'),
      sourceRow('Approvals data', health.approvals || 'unavailable', health.approvals === 'healthy' ? 'Approval reads available' : 'Approval source unavailable'),
      sourceRow('Activity ledger', health.activity || 'unavailable', health.activity === 'healthy' ? 'Audit/event reads available' : 'Activity source unavailable'),
      sourceRow('Calendar operation receipts', calendar.state || 'unavailable', calendar.state === 'healthy' ? `${calendar.pending || 0} pending · no reconciliation required` : calendar.state === 'attention' ? `${calendar.reconciliationNeeded || 0} reconciliation required` : 'Receipt source unavailable'),
      sourceRow('Integration outbox', outbox.state || 'unavailable', outbox.state === 'healthy' ? `${outbox.pending || 0} pending · no attention required` : outbox.state === 'attention' ? `${outbox.needsAttention || 0} need attention` : 'Outbox source unavailable'),
      sourceRow('External provider telemetry', 'unavailable', health.providerTelemetry === 'not_yet_instrumented' ? 'Not yet instrumented — no health claim is being fabricated' : 'Provider telemetry unavailable'),
    ].join('');

    const integration = data.integrationHistory;
    const integrationState = value => value === 'attention' || value === 'needs_attention' || value === 'reconciliation_needed' ? 'amber' : value === 'healthy' || value === 'delivered' || value === 'succeeded' ? 'green' : 'gray';
    const integrationLabel = value => value === 'not_yet_instrumented' ? 'Not instrumented' : titleCase(value);
    const integrationRow = (name, source, note) => { const state = source?.state || 'unavailable'; return `<div class="health-row"><span class="health-dot ${state === 'attention' ? 'warn' : ''}"></span><div><div class="health-name">${escapeHtml(name)}</div><div class="health-note">${escapeHtml(note)}</div></div><span class="badge ${integrationState(state)}">${escapeHtml(integrationLabel(state))}</span></div>`; };
    const activityRow = item => { const label = item.kind === 'calendar_operation' ? `${titleCase(item.operation)} Calendar operation` : `${titleCase(item.eventType)} · ${titleCase(item.kind)}`; const detail = `${formatDate(item.occurredAt)}${item.errorCode ? ` · ${item.errorCode}` : ''}`; return `<div class="list-row"><div class="row-icon">${item.kind === 'resend' ? '✉' : item.kind === 'notion' ? 'N' : '◇'}</div><div><div class="row-name">${escapeHtml(label)}</div><div class="row-sub">${escapeHtml(detail)}</div></div><span class="badge ${integrationState(item.state)}">${escapeHtml(integrationLabel(item.state))}</span></div>`; };
    const calendarNote = integration?.calendar?.recordedOperations ? `${integration.calendar.recordedOperations} recorded operation${integration.calendar.recordedOperations === 1 ? '' : 's'} · ${integration.calendar.reconciliationNeeded} need reconciliation` : 'No Calendar operation receipt recorded yet';
    const integrationRows = integration ? [
      integrationRow('Transactional email receipts', integration.email, integration.email.recordedEvents ? `${integration.email.recordedEvents} recorded delivery event${integration.email.recordedEvents === 1 ? '' : 's'} · recipient details withheld` : 'Not yet instrumented — Command does not infer delivery from server logs'),
      integrationRow('Google Calendar reconciliation', integration.calendar, calendarNote),
      integrationRow('Notion mirror events', integration.notion, integration.notion.recordedEvents ? `${integration.notion.recordedEvents} recorded mirror event${integration.notion.recordedEvents === 1 ? '' : 's'}` : 'Not yet instrumented — no mirror status is assumed'),
    ].join('') : '';
    const integrationPanel = integration ? `<div class="card panel"><div class="panel-head"><div><div class="panel-title">Integration evidence</div><div class="row-sub">Durable server-side records only</div></div><span class="badge blue">Read-only</span></div><div class="health">${integrationRows}</div></div><div class="card panel"><div class="panel-head"><div class="panel-title">Recent recorded activity</div><span class="badge ${integration.timeline.length ? 'blue' : 'gray'}">${integration.timeline.length ? `${integration.timeline.length} events` : 'Empty'}</span></div>${integration.timeline.map(activityRow).join('') || '<div class="empty"><div class="empty-icon">✦</div><strong>No recorded integration activity</strong><span>Command is not substituting provider assumptions or customer-message fixtures.</span></div>'}</div><div class="prototype-note">Read-only integration health · no Calendar events or mirrors can be changed here</div>` : '<div class="card"><div class="empty"><div class="empty-icon">!</div><strong>Integration evidence unavailable</strong><span>Command failed closed. No fixture activity or assumed provider state was substituted.</span></div></div>';

    const exceptionRows = exceptions.map(item => `<div class="list-row"><div class="row-icon">!</div><div><div class="row-name">${escapeHtml(titleCase(item.action))}</div><div class="row-sub">${escapeHtml(titleCase(item.target_type))} · ${escapeHtml(formatDate(item.created_at))}${item.error_code ? ` · ${escapeHtml(item.error_code)}` : ''}</div></div><span class="badge red">${escapeHtml(titleCase(item.outcome))}</span></div>`).join('');

    section.innerHTML = `<div class="section-header"><div class="eyebrow">Infrastructure · Live read-only</div><h2>System Health</h2><p>Canonical operational signals only. Unknown provider state is shown as unknown, never guessed.</p></div>${summaryCards}<div class="card panel"><div class="panel-head"><div><div class="panel-title">Operational sources</div><div class="row-sub">Generated ${escapeHtml(formatDate(data.generatedAt))}</div></div><span class="badge ${overallBadge}">${escapeHtml(titleCase(overallState))}</span></div><div class="health">${rows}</div></div><div class="card panel"><div class="panel-head"><div class="panel-title">Recent exceptions</div><span class="badge ${exceptions.length ? 'red' : 'green'}">${exceptions.length ? `${exceptions.length} recent` : 'Clear'}</span></div>${exceptionRows || '<div class="empty"><div class="empty-icon">✓</div><strong>No recent failed or blocked activity</strong><span>Command is reading the canonical audit ledger; no fixture incidents were substituted.</span></div>'}</div>${integrationPanel}`;
  }

  function renderFailure() {
    const section = document.querySelector('[data-section="health"]');
    if (!section) return;
    section.innerHTML = '<div class="section-header"><div class="eyebrow">Infrastructure · Live read-only</div><h2>System Health</h2><p>Operational status failed closed.</p></div><div class="card"><div class="empty"><div class="empty-icon">!</div><strong>Health data unavailable</strong><span>No fixture or assumed healthy state was substituted. Production systems were not modified.</span></div></div>';
  }

  async function boot() {
    try { render(await loadHealth()); }
    catch (error) { console.warn('command_health_load_failed'); renderFailure(); }
  }

  window.addEventListener('DOMContentLoaded', boot, { once: true });
})();
