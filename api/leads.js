/**
 * POST /api/leads
 * Creates a Notion row + Google Calendar event for walkthrough requests.
 *
 * Env (Vercel):
 *   NOTION_TOKEN
 *   NOTION_DATABASE_ID
 *   GOOGLE_CLIENT_EMAIL      – service account email
 *   GOOGLE_PRIVATE_KEY       – service account private key (PEM, \n escaped)
 *   GOOGLE_CALENDAR_ID       – calendar id (often schedule.zts@gmail.com for primary)
 */

const { google } = require('googleapis');

const DATABASE_ID = process.env.NOTION_DATABASE_ID || '896228ea48af4523a8cb0f099ca800c2';
const NOTION_VERSION = '2022-06-28';

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(res, status, body, origin) {
  res.statusCode = status;
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(origin),
  };
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function sanitize(str, max = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, max);
}

/** Map preferred time → America/Los_Angeles window on preferredDate */
function eventTimes(preferredDate, preferredTime) {
  // All-day if no date
  if (!preferredDate || !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
    return null;
  }

  const time = (preferredTime || '').toLowerCase();
  // Windows in local PT (form is SoCal business)
  let startHour = 9;
  let endHour = 12;
  if (time === 'afternoon') {
    startHour = 13;
    endHour = 17;
  } else if (time === 'flexible' || !time) {
    // All-day event
    return {
      start: { date: preferredDate },
      end: { date: preferredDate },
    };
  }
  // Morning default 9–12

  const pad = (n) => String(n).padStart(2, '0');
  const start = `${preferredDate}T${pad(startHour)}:00:00`;
  const end = `${preferredDate}T${pad(endHour)}:00:00`;
  return {
    start: { dateTime: start, timeZone: 'America/Los_Angeles' },
    end: { dateTime: end, timeZone: 'America/Los_Angeles' },
  };
}

async function createCalendarEvent(fields) {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'schedule.zts@gmail.com';

  if (!clientEmail || !privateKey) {
    console.warn('Google Calendar env not set — skipping calendar event');
    return null;
  }

  const times = eventTimes(fields.preferredDate, fields.preferredTime);
  if (!times) {
    console.warn('No preferred date — skipping calendar event');
    return null;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  const title = `Walkthrough – ${fields.name}${
    fields.businessType ? ` (${fields.businessType})` : ''
  }`;

  const description = [
    `Lead from zerotraceusa.com`,
    `Name: ${fields.name}`,
    fields.phone ? `Phone: ${fields.phone}` : null,
    fields.email ? `Email: ${fields.email}` : null,
    fields.businessType ? `Business type: ${fields.businessType}` : null,
    fields.preferredTime ? `Preferred time: ${fields.preferredTime}` : null,
    fields.location ? `Location: ${fields.location}` : null,
    fields.notes ? `Notes: ${fields.notes}` : null,
    ``,
    `Status: New — confirm in Notion before treating as locked.`,
  ]
    .filter(Boolean)
    .join('\n');

  const event = {
    summary: title,
    description,
    location: fields.location || undefined,
    start: times.start,
    end: times.end,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
      ],
    },
  };

  const result = await calendar.events.insert({
    calendarId,
    requestBody: event,
  });

  return result.data.id;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';

  if (req.method === 'OPTIONS') {
    return json(res, 204, {}, origin);
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' }, origin);
  }

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error('NOTION_TOKEN is not set');
    return json(res, 500, { error: 'Server misconfigured' }, origin);
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Invalid JSON' }, origin);
    }
  }
  if (!body || typeof body !== 'object') {
    return json(res, 400, { error: 'Missing body' }, origin);
  }

  const name = sanitize(body.name, 120);
  const phone = sanitize(body.phone, 40);
  const email = sanitize(body.email, 120);
  const businessType = sanitize(body.businessType, 40);
  const preferredDate = sanitize(body.preferredDate, 20);
  const preferredTime = sanitize(body.preferredTime, 40);
  const location = sanitize(body.location, 200);
  const notes = sanitize(body.notes, 1000);

  if (!name || !phone || !email || !location) {
    return json(res, 400, { error: 'Name, phone, email, and location are required' }, origin);
  }

  const allowedBusiness = ['Office', 'Classroom', 'Commercial', 'Other'];
  const allowedTime = ['Morning', 'Afternoon', 'Flexible'];

  const properties = {
    Name: {
      title: [{ text: { content: name } }],
    },
    Phone: {
      phone_number: phone,
    },
    Email: {
      email: email,
    },
    'Business Type': {
      select: {
        name: allowedBusiness.includes(businessType) ? businessType : 'Other',
      },
    },
    Location: {
      rich_text: [{ text: { content: location } }],
    },
    Status: {
      select: { name: 'New' },
    },
    Source: {
      select: { name: 'Website Form' },
    },
  };

  if (preferredTime && allowedTime.includes(preferredTime)) {
    properties['Preferred Time'] = { select: { name: preferredTime } };
  }

  if (preferredDate && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
    properties['Preferred Date'] = {
      date: { start: preferredDate },
    };
  }

  if (notes) {
    properties.Notes = {
      rich_text: [{ text: { content: notes } }],
    };
  }

  try {
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: DATABASE_ID },
        properties,
      }),
    });

    const data = await notionRes.json();

    if (!notionRes.ok) {
      console.error('Notion API error', notionRes.status, JSON.stringify(data));
      return json(
        res,
        502,
        { error: 'Failed to save lead. Please try again or email support@zerotraceusa.com' },
        origin
      );
    }

    // Calendar is best-effort: lead is already saved if this fails
    let calendarEventId = null;
    try {
      calendarEventId = await createCalendarEvent({
        name,
        phone,
        email,
        businessType,
        preferredDate,
        preferredTime,
        location,
        notes,
      });
    } catch (calErr) {
      console.error('Google Calendar error', calErr?.message || calErr);
    }

    return json(
      res,
      200,
      { ok: true, id: data.id, calendarEventId: calendarEventId || undefined },
      origin
    );
  } catch (err) {
    console.error('Lead submit error', err);
    return json(res, 500, { error: 'Server error' }, origin);
  }
};
