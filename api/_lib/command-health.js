const commandData = require('./command-data');

const ACTIVE_JOB_STATES = new Set(['draft', 'scheduled', 'en_route', 'in_progress']);
const ATTENTION_OUTBOX_STATES = new Set(['needs_attention']);
const PENDING_OUTBOX_STATES = new Set(['pending', 'processing']);

function settledValue(result) {
  return result.status === 'fulfilled' ? result.value : null;
}

function sourceState(result) {
  return result.status === 'fulfilled' ? 'healthy' : 'unavailable';
}

function summarizeJobs(rows = [], now = new Date()) {
  const counts = { draft: 0, scheduled: 0, en_route: 0, in_progress: 0, completed: 0, cancelled: 0, other: 0 };
  let nextUpcoming = null;
  for (const job of rows) {
    if (Object.hasOwn(counts, job.status)) counts[job.status] += 1;
    else counts.other += 1;
    if (job.status === 'scheduled' && job.scheduled_start_at) {
      const start = new Date(job.scheduled_start_at);
      if (!Number.isNaN(start.getTime()) && start >= now && (!nextUpcoming || start < new Date(nextUpcoming.scheduled_start_at))) {
        nextUpcoming = {
          id: job.id,
          title: job.title,
          scheduled_start_at: job.scheduled_start_at,
          scheduled_end_at: job.scheduled_end_at,
          scheduled_timezone: job.scheduled_timezone,
        };
      }
    }
  }
  return { total: rows.length, counts, active: rows.filter(job => ACTIVE_JOB_STATES.has(job.status)).length, nextUpcoming };
}

function summarizeApprovals(rows = [], now = new Date()) {
  let pending = 0;
  let expired = 0;
  for (const approval of rows) {
    if (approval.status === 'pending') {
      if (approval.expires_at && new Date(approval.expires_at) < now) expired += 1;
      else pending += 1;
    } else if (approval.status === 'expired') expired += 1;
  }
  return { total: rows.length, pending, expired };
}

function summarizeActivity(rows = []) {
  const recentExceptions = rows
    .filter(event => ['failed', 'blocked'].includes(event.outcome))
    .slice(0, 10)
    .map(event => ({
      id: event.id,
      action: event.action,
      target_type: event.target_type,
      authority_level: event.authority_level,
      outcome: event.outcome,
      error_code: event.error_code || null,
      created_at: event.created_at,
    }));
  return { recentExceptions };
}

function summarizeReceipts(rows = []) {
  const reconciliationNeeded = rows.filter(row => row.state === 'reconciliation_needed').length;
  const pending = rows.filter(row => row.state === 'calendar_pending').length;
  return {
    total: rows.length,
    reconciliationNeeded,
    pending,
    state: reconciliationNeeded > 0 ? 'attention' : 'healthy',
  };
}

function summarizeOutbox(rows = []) {
  const needsAttention = rows.filter(row => ATTENTION_OUTBOX_STATES.has(row.status)).length;
  const pending = rows.filter(row => PENDING_OUTBOX_STATES.has(row.status)).length;
  return {
    total: rows.length,
    needsAttention,
    pending,
    state: needsAttention > 0 ? 'attention' : 'healthy',
  };
}

async function listHealth() {
  const results = await Promise.allSettled([
    commandData.readJson('customers?select=id,status&limit=1000'),
    commandData.readJson('jobs?select=id,title,status,scheduled_start_at,scheduled_end_at,scheduled_timezone&order=scheduled_start_at.asc.nullslast&limit=1000'),
    commandData.readJson('approvals?select=id,status,expires_at&order=requested_at.desc&limit=1000'),
    commandData.readJson('activity_events?select=id,action,target_type,authority_level,outcome,error_code,created_at&order=created_at.desc&limit=100'),
    commandData.readJson('job_operation_receipts?select=id,state&limit=1000'),
    commandData.readJson('integration_outbox?select=id,status,destination,available_at,last_attempt_at,error_code&limit=1000'),
  ]);

  const [customersResult, jobsResult, approvalsResult, activityResult, receiptsResult, outboxResult] = results;
  const customers = settledValue(customersResult);
  const jobs = settledValue(jobsResult);
  const approvals = settledValue(approvalsResult);
  const activity = settledValue(activityResult);
  const receipts = settledValue(receiptsResult);
  const outbox = settledValue(outboxResult);

  return {
    generatedAt: new Date().toISOString(),
    business: {
      customers: customers ? { total: customers.length, active: customers.filter(row => row.status === 'active').length } : null,
      jobs: jobs ? summarizeJobs(jobs) : null,
      approvals: approvals ? summarizeApprovals(approvals) : null,
      activity: activity ? summarizeActivity(activity) : null,
    },
    health: {
      customers: sourceState(customersResult),
      jobs: sourceState(jobsResult),
      approvals: sourceState(approvalsResult),
      activity: sourceState(activityResult),
      calendarOperations: receipts ? summarizeReceipts(receipts) : { state: 'unavailable', total: null, reconciliationNeeded: null, pending: null },
      integrationOutbox: outbox ? summarizeOutbox(outbox) : { state: 'unavailable', total: null, needsAttention: null, pending: null },
      providerTelemetry: 'not_yet_instrumented',
    },
  };
}

module.exports = {
  listHealth,
  summarizeActivity,
  summarizeApprovals,
  summarizeJobs,
  summarizeOutbox,
  summarizeReceipts,
};
