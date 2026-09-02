const test = require('node:test');
const assert = require('node:assert/strict');
const scheduleView = require('../command/schedule-view');

test('schedule view groups and sorts jobs by each job’s local date and instant', () => {
  const groups = scheduleView.groupScheduledJobs([
    { id: 'late', scheduled_start_at: '2026-09-02T01:00:00.000Z', scheduled_timezone: 'America/Los_Angeles' },
    { id: 'early', scheduled_start_at: '2026-09-01T16:00:00.000Z', scheduled_timezone: 'America/Los_Angeles' },
    { id: 'east', scheduled_start_at: '2026-09-02T05:00:00.000Z', scheduled_timezone: 'America/New_York' },
    { id: 'unscheduled', scheduled_start_at: null, scheduled_timezone: 'America/Los_Angeles' },
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].jobs.map(job => job.id), ['early', 'late']);
  assert.deepEqual(groups[1].jobs.map(job => job.id), ['east']);
  assert.equal(groups[0].timeZone, 'America/Los_Angeles');
  assert.equal(groups[1].timeZone, 'America/New_York');
});

test('schedule view safely ignores malformed timestamps and falls back from an invalid timezone', () => {
  const groups = scheduleView.groupScheduledJobs([
    { id: 'bad-date', scheduled_start_at: 'not-a-date', scheduled_timezone: 'America/Los_Angeles' },
    { id: 'fallback', scheduled_start_at: '2026-09-01T16:00:00.000Z', scheduled_timezone: 'Not/AZone' },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].jobs[0].id, 'fallback');
  assert.ok(groups[0].timeZone);
});
