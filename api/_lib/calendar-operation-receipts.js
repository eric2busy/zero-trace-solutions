const commandData = require('./command-data');

function assertServerConfigured() {
  if (!commandData.configured()) {
    const error = new Error('server_data_access_not_configured');
    error.code = 'SERVER_DATA_ACCESS_NOT_CONFIGURED';
    throw error;
  }
}

async function rpc(name, body) {
  assertServerConfigured();
  return commandData.writeJson(`rpc/${name}`, 'POST', body);
}

function reserveOperation({ jobId, idempotencyKey, operation, actorId, correlationId, expectedJobVersion, metadata = {} }) {
  return rpc('command_reserve_job_operation', {
    p_job_id: jobId,
    p_idempotency_key: idempotencyKey,
    p_operation: operation,
    p_actor_id: actorId,
    p_correlation_id: correlationId,
    p_expected_job_version: expectedJobVersion,
    p_operation_metadata: metadata,
  });
}

function markOperationSucceeded({ receiptId, actorId }) {
  return rpc('command_set_job_operation_state', {
    p_receipt_id: receiptId, p_actor_id: actorId, p_state: 'succeeded', p_error_code: null,
  });
}

function completeOperation({ receiptId, actorId, scheduledStartAt = null, scheduledEndAt = null, scheduledTimezone = null, calendarEventId = null }) {
  return rpc('command_complete_job_calendar_operation', {
    p_receipt_id: receiptId, p_actor_id: actorId,
    p_scheduled_start_at: scheduledStartAt, p_scheduled_end_at: scheduledEndAt, p_scheduled_timezone: scheduledTimezone, p_calendar_event_id: calendarEventId,
  });
}

function markOperationForReconciliation({ receiptId, actorId, errorCode }) {
  return rpc('command_set_job_operation_state', {
    p_receipt_id: receiptId, p_actor_id: actorId, p_state: 'reconciliation_needed', p_error_code: errorCode,
  });
}

module.exports = { reserveOperation, completeOperation, markOperationSucceeded, markOperationForReconciliation };
