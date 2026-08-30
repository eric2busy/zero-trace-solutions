/**
 * POST /api/book
 * Re-checks a selected slot, creates the confirmed Calendar event,
 * updates the existing Notion lead to Scheduled, and emails the customer.
 */

const { google } = require('googleapis');
const { syncConfirmedBooking } = require('./_lib/booking-command-sync');
const { confirmedTimeSlotDate } = require('./notion-booking-time');
const { sendTransactionalEmail } = require('./_email');

const NOTION_VERSION = '2022-06-28';
const TIMEZONE = process.env.BOOKING_TIMEZONE || 'America/Los_Angeles';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'schedule.zts@gmail.com';

function corsHeaders(origin) {
  const allowed = ['https://zerotraceusa.com','https://www.zerotraceusa.com','https://zero-trace-solutions.vercel.app','http://localhost:3000','http://127.0.0.1:3000'];
  const allow = allowed.includes(origin) ? origin : allowed[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

function json(res, status, body, origin) {
  res.statusCode = status;
  Object.entries({ 'Content-Type': 'application/json', ...corsHeaders(origin) }).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function sanitize(value, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

function authClient() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Google Calendar credentials are not configured');
  return new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/calendar'] });
}

function timezoneOffset(date) {
  const reference = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'longOffset', hour: '2-digit' })
    .formatToParts(reference).find((p) => p.type === 'timeZoneName');
  const match = String(part?.value || '').match(/GMT([+-]\d{2}:\d{2})/);
  if (!match) throw new Error(`Unable to resolve offset for ${TIMEZONE}`);
  return match[1];
}

async function slotIsFree(calendar, start, end, offset) {
  const bufferMinutes = Math.max(0, Number(process.env.BOOKING_BUFFER_MINUTES || 30));
  const s = new Date(`${start}${offset}`);
  const e = new Date(`${end}${offset}`);
  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: new Date(s.getTime() - bufferMinutes * 60000).toISOString(),
      timeMax: new Date(e.getTime() + bufferMinutes * 60000).toISOString(),
      timeZone: TIMEZONE,
      items: [{ id: CALENDAR_ID }],
    },
  });
  return (fb.data.calendars?.[CALENDAR_ID]?.busy || []).length === 0;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') return json(res, 204, {}, origin);
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }, origin);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }, origin); } }

  const leadId = sanitize(body?.leadId, 80);
  const start = sanitize(body?.start, 30);
  const end = sanitize(body?.end, 30);
  const name = sanitize(body?.name, 120);
  const email = sanitize(body?.email, 120);
  const phone = sanitize(body?.phone, 40);
  const businessType = sanitize(body?.businessType, 40);
  const location = sanitize(body?.location, 200);
  const notes = sanitize(body?.notes, 1000);

  if (!leadId || !start || !end || !name || !email || !location) return json(res, 400, { error: 'Lead, customer, location, and slot are required' }, origin);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(end)) return json(res, 400, { error: 'Invalid slot' }, origin);

  const notionToken = process.env.NOTION_TOKEN;
  if (!notionToken) return json(res, 500, { error: 'Server misconfigured' }, origin);

  try {
    const offset = timezoneOffset(start.slice(0, 10));
    const startMs = new Date(`${start}${offset}`).getTime();
    const endMs = new Date(`${end}${offset}`).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || startMs < Date.now()) return json(res, 400, { error: 'Invalid or expired slot' }, origin);

    const calendar = google.calendar({ version: 'v3', auth: authClient() });
    if (!(await slotIsFree(calendar, start, end, offset))) return json(res, 409, { error: 'That time was just booked. Please choose another available time.' }, origin);

    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `Confirmed Walkthrough – ${name}${businessType ? ` (${businessType})` : ''}`,
        description: ['Confirmed booking from zerotraceusa.com', `Name: ${name}`, phone ? `Phone: ${phone}` : null, `Email: ${email}`, businessType ? `Business type: ${businessType}` : null, `Location: ${location}`, notes ? `Notes: ${notes}` : null, `Notion lead: ${leadId}`].filter(Boolean).join('\n'),
        location,
        start: { dateTime: start, timeZone: TIMEZONE },
        end: { dateTime: end, timeZone: TIMEZONE },
        reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 1440 }, { method: 'popup', minutes: 60 }] },
      },
    });

    const notionRes = await fetch(`https://api.notion.com/v1/pages/${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${notionToken}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: {
        Status: { select: { name: 'Scheduled' } },
        'Preferred Date': { date: { start: start.slice(0, 10) } },
        'Confirmed Time Slot': { date: confirmedTimeSlotDate(start, end, TIMEZONE) },
        Notes: { rich_text: [{ text: { content: `${notes ? `${notes}\n\n` : ''}Confirmed walkthrough: ${start} ${TIMEZONE}`.slice(0, 1900) } }] },
      } }),
    });

    if (!notionRes.ok) {
      console.error('Notion booking update error', notionRes.status, await notionRes.text());
      try { await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: event.data.id }); } catch (rollbackErr) { console.error('Calendar rollback failed', rollbackErr?.message || rollbackErr); }
      return json(res, 502, { error: 'Booking could not be finalized. Please choose the time again.' }, origin);
    }

    const commandSync = await syncConfirmedBooking({
      leadId,
      scheduledStartAt: new Date(startMs).toISOString(),
      scheduledEndAt: new Date(endMs).toISOString(),
      timezone: TIMEZONE,
      calendarEventId: event.data.id,
    });

    const pretty = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(`${start}${offset}`));

    const emailDelivery = {
      customer: await sendTransactionalEmail({
        to: email,
        subject: 'Your walkthrough is confirmed — Zero Trace Solutions',
        text: [`Hi ${name},`, '', `Your Zero Trace Solutions walkthrough is confirmed for ${pretty}.`, `Location: ${location}`, '', 'If you need to make a change, reply to this email or contact support@zerotraceusa.com.', '', '— Zero Trace Solutions', 'https://zerotraceusa.com'].join('\n'),
        replyTo: process.env.LEAD_ALERT_TO || 'support@zerotraceusa.com',
        endpoint: '/api/book',
        messageType: 'booking_confirmation',
        recipientKind: 'customer',
      }),
      internal: await sendTransactionalEmail({
        to: process.env.LEAD_ALERT_TO || 'support@zerotraceusa.com',
        subject: `Walkthrough booked — ${name}`,
        text: [`Confirmed: ${pretty}`, `Name: ${name}`, `Location: ${location}`, `Email: ${email}`, phone ? `Phone: ${phone}` : null].filter(Boolean).join('\n'),
        replyTo: email,
        endpoint: '/api/book',
        messageType: 'booking_alert',
        recipientKind: 'internal',
      }),
    };

    return json(res, 200, { ok: true, calendarEventId: event.data.id, start, end, commandSync, emailDelivery }, origin);
  } catch (err) {
    console.error('Booking error', err?.message || err);
    return json(res, 500, { error: 'Unable to complete booking right now' }, origin);
  }
};
