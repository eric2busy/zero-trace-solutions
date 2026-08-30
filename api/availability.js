/**
 * GET /api/availability?date=YYYY-MM-DD&window=Morning|Afternoon|Flexible
 * Returns open walkthrough slots after checking the real Google Calendar.
 */

const { google } = require('googleapis');

const TIMEZONE = process.env.BOOKING_TIMEZONE || 'America/Los_Angeles';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'schedule.zts@gmail.com';

function corsHeaders(origin) {
  const allowed = [
    'https://zerotraceusa.com',
    'https://www.zerotraceusa.com',
    'https://zero-trace-solutions.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  const allow = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(res, status, body, origin) {
  res.statusCode = status;
  Object.entries({ 'Content-Type': 'application/json', ...corsHeaders(origin) }).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function authClient() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Google Calendar credentials are not configured');
  return new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/calendar'] });
}

function timezoneOffset(date) {
  const reference = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    timeZoneName: 'longOffset',
    hour: '2-digit',
  }).formatToParts(reference).find((p) => p.type === 'timeZoneName');
  const match = String(part?.value || '').match(/GMT([+-]\d{2}:\d{2})/);
  if (!match) throw new Error(`Unable to resolve offset for ${TIMEZONE}`);
  return match[1];
}

function localIso(date, hhmm) {
  return `${date}T${hhmm}:00`;
}

function localMs(local, offset) {
  return new Date(`${local}${offset}`).getTime();
}

function addMinutes(local, minutes, offset) {
  const d = new Date(localMs(local, offset) + minutes * 60000);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function overlaps(start, end, busyStart, busyEnd, bufferMinutes, offset) {
  const s = localMs(start, offset);
  const e = localMs(end, offset);
  const bs = new Date(busyStart).getTime() - bufferMinutes * 60000;
  const be = new Date(busyEnd).getTime() + bufferMinutes * 60000;
  return s < be && e > bs;
}

function slotLabel(localStart) {
  const [hh, mm] = localStart.slice(11, 16).split(':').map(Number);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') return json(res, 204, {}, origin);
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' }, origin);

  const date = String(req.query?.date || '').trim();
  const windowName = String(req.query?.window || 'Flexible').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Valid date is required' }, origin);
  if (!['Morning', 'Afternoon', 'Flexible'].includes(windowName)) return json(res, 400, { error: 'Invalid time window' }, origin);

  const slotMinutes = Math.max(30, Number(process.env.WALKTHROUGH_MINUTES || 60));
  const bufferMinutes = Math.max(0, Number(process.env.BOOKING_BUFFER_MINUTES || 30));
  const minimumNoticeMinutes = Math.max(0, Number(process.env.BOOKING_MIN_NOTICE_MINUTES || 120));
  const dayStart = process.env.BOOKING_DAY_START || '09:00';
  const dayEnd = process.env.BOOKING_DAY_END || '17:00';

  let startClock = dayStart;
  let endClock = dayEnd;
  if (windowName === 'Morning') endClock = '12:00';
  if (windowName === 'Afternoon') startClock = '13:00';

  try {
    const offset = timezoneOffset(date);
    const calendar = google.calendar({ version: 'v3', auth: authClient() });
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: `${date}T00:00:00${offset}`,
        timeMax: `${date}T23:59:59${offset}`,
        timeZone: TIMEZONE,
        items: [{ id: CALENDAR_ID }],
      },
    });
    const busy = fb.data.calendars?.[CALENDAR_ID]?.busy || [];
    const nowWithNotice = Date.now() + minimumNoticeMinutes * 60000;

    const slots = [];
    let candidateCount = 0;
    let noticeExcludedCount = 0;
    let busyExcludedCount = 0;
    let cursor = localIso(date, startClock);
    const closing = localIso(date, endClock);
    while (localMs(cursor, offset) < localMs(closing, offset)) {
      const end = addMinutes(cursor, slotMinutes, offset);
      if (localMs(end, offset) > localMs(closing, offset)) break;
      candidateCount += 1;
      const blocked = busy.some((b) => overlaps(cursor, end, b.start, b.end, bufferMinutes, offset));
      const insideNoticeWindow = localMs(cursor, offset) < nowWithNotice;
      if (insideNoticeWindow) noticeExcludedCount += 1;
      else if (blocked) busyExcludedCount += 1;
      else slots.push({ start: cursor, end, label: slotLabel(cursor), timeZone: TIMEZONE });
      cursor = addMinutes(cursor, slotMinutes, offset);
    }

    let emptyReason = null;
    if (!slots.length && candidateCount > 0) {
      if (noticeExcludedCount === candidateCount) emptyReason = 'minimum_notice';
      else if (busyExcludedCount + noticeExcludedCount === candidateCount && noticeExcludedCount > 0) emptyReason = 'notice_and_busy';
      else emptyReason = 'calendar_busy';
    }

    return json(res, 200, {
      ok: true,
      date,
      window: windowName,
      slots,
      availability: {
        emptyReason,
        minimumNoticeMinutes,
      },
    }, origin);
  } catch (err) {
    console.error('Availability error', err?.message || err);
    return json(res, 500, { error: 'Unable to check availability right now' }, origin);
  }
};
