/**
 * POST /api/leads
 * Accepts walkthrough form submissions and creates a row in the
 * Notion "Walkthrough Requests" database.
 *
 * Required env vars (Vercel project settings):
 *   NOTION_TOKEN        – Notion integration secret (ntn_... or secret_...)
 *   NOTION_DATABASE_ID  – 896228ea48af4523a8cb0f099ca800c2
 */

const DATABASE_ID = process.env.NOTION_DATABASE_ID || '896228ea48af4523a8cb0f099ca800c2';
const NOTION_VERSION = '2022-06-28';

function corsHeaders(origin) {
  // Allow same-origin + localhost for testing
  const allowed = [
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
  // Vercel may already parse JSON; also handle raw stream edge case
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
  const notes = sanitize(body.notes, 2000);

  if (!name || !phone || !email || !businessType || !location) {
    return json(res, 400, { error: 'Missing required fields' }, origin);
  }

  // Basic email check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: 'Invalid email' }, origin);
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

    return json(res, 200, { ok: true, id: data.id }, origin);
  } catch (err) {
    console.error('Lead submit error', err);
    return json(res, 500, { error: 'Server error' }, origin);
  }
};
