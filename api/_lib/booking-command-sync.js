const { configured, readJson, restRequest } = require('./command-data');

function encoded(value) {
  return encodeURIComponent(value);
}

function sameInstant(left, right) {
  if (!left || !right) return false;
  const leftMs = new Date(left).getTime();
  const rightMs = new Date(right).getTime();
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

async function patchJob(jobId, body) {
  const response = await restRequest(`jobs?id=eq.${encoded(jobId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Command booking sync update failed.');
    error.code = 'COMMAND_BOOKING_SYNC_UPDATE_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function syncConfirmedBooking({ leadId, scheduledStartAt, scheduledEndAt, timezone, calendarEventId }) {
  if (!configured()) return { state: 'pending', reason: 'not_configured' };

  try {
    const rows = await readJson(
      `jobs?select=id,status,scheduled_start_at,scheduled_end_at,scheduled_timezone,calendar_event_id&source_system=eq.website&source_record_id=eq.${encoded(leadId)}&limit=1`
    );
    const job = rows?.[0];
    if (!job) return { state: 'pending', reason: 'job_not_found' };

    const alreadySynced =
      job.status === 'scheduled' &&
      job.calendar_event_id === calendarEventId &&
      job.scheduled_timezone === timezone &&
      sameInstant(job.scheduled_start_at, scheduledStartAt) &&
      sameInstant(job.scheduled_end_at, scheduledEndAt);

    if (alreadySynced) return { state: 'synced', reason: 'already_synced' };

    await patchJob(job.id, {
      status: 'scheduled',
      scheduled_start_at: scheduledStartAt,
      scheduled_end_at: scheduledEndAt,
      scheduled_timezone: timezone,
      calendar_event_id: calendarEventId,
    });

    return { state: 'synced', reason: 'updated' };
  } catch (error) {
    console.error('Command booking sync failed', {
      code: error?.code || 'COMMAND_BOOKING_SYNC_FAILED',
      status: Number.isInteger(error?.status) ? error.status : undefined,
    });
    return { state: 'pending', reason: 'sync_failed' };
  }
}

module.exports = { sameInstant, syncConfirmedBooking };
