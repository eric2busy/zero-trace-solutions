/**
 * GET /api/availability?date=YYYY-MM-DD&window=Morning|Afternoon|Flexible
 * Returns open walkthrough slots after checking the real Google Calendar.
 *
 * Env:
 *   GOOGLE_CLIENT_EMAIL
 *   GOOGLE_PRIVATE_KEY
 *   GOOGLE_CALENDAR_ID
 *   BOOKING_TIMEZONE          default America/Los_Angeles
 *   BOOKING_DAY_START         default 09:00
 *   BOOKING_DAY_END           default 17:00
 *   WALKTHROUGH_MINUTES       default 60
 *   BOOKING_BUFFER_MINUTES    default 30
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
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

function parts(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return { h, m };
}

function localIso(date, hhmm) {
  return `${date}T${hhmm}:00`;
}

function addMinutes(isoLocal, minutes) {
  const d = new Date(`${isoLocal}-07:00`);
  d.setMinutes(d.getMinutes() + minutes);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`;
}

function overlaps(start, end, busyStart, busyEnd, bufferMinutes) {
  const s = new Date(`${start}-07:00`).getTime();
  const e = new Date(`${end}-07:00`).getTime();
  const bs = new Date(busyStart).getTime() - bufferMinutes * 60000;
  const be = new Date(busyEnd).getTime() + bufferMinutes * 60000;
  return s < be && e > bs;
}

function slotLabel(localStart) {
  const [hh, mm] = localStart.slice(11, 16).split(':').map(Number);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const hour = hh % 12 || 12;
  return `${hour}:${String(mm).padStart(2, '0')} ${suffix}`;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') return json(res, 204, {}, origin);
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' }, origin);

  const date = String(req.query?.date || '').trim();
  const windowName = String(req.query?.window || 'Flexible').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Valid date is required' }, origin);

  const slotMinutes = Math.max(30, Number(process.env.WALKTHROUGH_MINUTES || 60));
  const bufferMinutes = Math.max(0, Number(process.env.BOOKING_BUFFER_MINUTES || 30));
  const dayStart = process.env.BOOKING_DAY_START || '09:00';
  const dayEnd = process.env.BOOKING_DAY_END || '17:00';

  let startClock = dayStart;
  let endClock = dayEnd;
  if (windowName === 'Morning') endClock = '12:00';
  if (windowName === 'Afternoon') startClock = '13:00';

  try {
    const calendar = google.calendar({ version: 'v3', auth: authClient() });
    const timeMin = `${date}T00:00:00-07:00`;
    const timeMax = `${date}T23:59:59-07:00`;
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: TIMEZONE,
        items: [{ id: CALENDAR_ID }],
      },
    });
    const busy = fb.data.calendars?.[CALENDAR_ID]?.busy || [];

    const slots = [];
    let cursor = localIso(date, startClock);
    const closing = localIso(date, endClock);
    while (new Date(`${cursor}-07:00`) < new Date(`${closing}-07:00`)) {
      const end = addMinutes(cursor, slotMinutes);
      if (new Date(`${end}-07:00`) > new Date(`${closing}-07:00`)) break;
      const blocked = busy.some((b) => overlaps(cursor, end, b.start, b.end, bufferMinutes));
      if (!blocked) {
        slots.push({
          start: cursor,
          end,
          label: slotLabel(cursor),
          timeZone: TIMEZONE,
        });
      }
      cursor = addMinutes(cursor, slotMinutes);
    }

    return json(res, 200, { ok: true, date, window: windowName, slots }, origin);
  } catch (err) {
    console.error('Availability error', err?.message || err);
    return json(res, 500, { error: 'Unable to check availability right now' }, origin);
  }
};
