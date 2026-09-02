(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  root.CommandScheduleView = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function validDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function supportedTimezone(value) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value || undefined });
      return value || Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }

  function dateParts(date, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    }).formatToParts(date).reduce((parts, part) => {
      if (part.type !== 'literal') parts[part.type] = part.value;
      return parts;
    }, {});
  }

  function localDay(job) {
    const date = validDate(job && job.scheduled_start_at);
    if (!date) return null;
    const timeZone = supportedTimezone(job.scheduled_timezone);
    const parts = dateParts(date, timeZone);
    return {
      key: `${parts.year}-${parts.month}-${parts.day}`,
      label: new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long', month: 'short', day: 'numeric' }).format(date),
      shortLabel: `${parts.weekday} ${parts.day}`,
      timeZone,
      startsAt: date.getTime(),
    };
  }

  function groupScheduledJobs(jobs) {
    const groups = new Map();
    (jobs || []).map(job => ({ job, day: localDay(job) })).filter(item => item.day).sort((a, b) => a.day.startsAt - b.day.startsAt).forEach(({ job, day }) => {
      const group = groups.get(day.key) || { ...day, jobs: [] };
      group.jobs.push(job);
      groups.set(day.key, group);
    });
    return [...groups.values()];
  }

  return { groupScheduledJobs, localDay, supportedTimezone };
});
