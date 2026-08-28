/**
 * POST /api/leads
 * Creates a Notion walkthrough lead and sends request acknowledgements.
 * IMPORTANT: this endpoint does NOT create a Calendar event. Calendar state is
 * created only by /api/book after a real availability check and customer slot selection.
 */

const DATABASE_ID = process.env.NOTION_DATABASE_ID || '896228ea48af4523a8cb0f099ca800c2';
const NOTION_VERSION = '2022-06-28';
const { sendTransactionalEmail } = require('./_email');

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

function sanitize(str, max = 500) { return typeof str === 'string' ? str.trim().slice(0, max) : ''; }

async function sendLeadAlert(fields) {
  return sendTransactionalEmail({
    to: process.env.LEAD_ALERT_TO || 'support@zerotraceusa.com',
    subject: `New walkthrough request — ${fields.name}`,
    text: [
      'New walkthrough request from zerotraceusa.com', '',
      `Name: ${fields.name}`, `Phone: ${fields.phone}`, `Email: ${fields.email}`,
      `Business type: ${fields.businessType || '—'}`, `Preferred date: ${fields.preferredDate || '—'}`,
      `Preferred time: ${fields.preferredTime || '—'}`, `Location: ${fields.location}`,
      fields.notes ? `Notes: ${fields.notes}` : null, '',
      'Saved to Notion as New. No calendar event has been created until the customer selects a verified available slot.'
    ].filter((x) => x !== null).join('\n'),
    replyTo: fields.email,
    endpoint: '/api/leads',
    messageType: 'lead_alert',
    recipientKind: 'internal',
  });
}

async function sendClientConfirmation(fields) {
  return sendTransactionalEmail({
    to: fields.email,
    subject: 'We received your walkthrough request — Zero Trace Solutions',
    text: [
      `Hi ${fields.name},`, '',
      'Thanks for reaching out to Zero Trace Solutions. We received your walkthrough request.',
      'Your appointment is not confirmed yet. Please choose from the available times shown on the website to lock in your walkthrough.', '',
      `Location: ${fields.location}`,
      fields.businessType ? `Business type: ${fields.businessType}` : null,
      fields.preferredDate ? `Preferred date: ${fields.preferredDate}` : null,
      fields.preferredTime ? `Preferred time: ${fields.preferredTime}` : null,
      '', 'If you need help, reply to this email or contact support@zerotraceusa.com.', '',
      '— Zero Trace Solutions', 'https://zerotraceusa.com'
    ].filter((x) => x !== null).join('\n'),
    replyTo: process.env.LEAD_ALERT_TO || 'support@zerotraceusa.com',
    endpoint: '/api/leads',
    messageType: 'lead_acknowledgement',
    recipientKind: 'customer',
  });
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') return json(res, 204, {}, origin);
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }, origin);

  const token = process.env.NOTION_TOKEN;
  if (!token) return json(res, 500, { error: 'Server misconfigured' }, origin);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }, origin); } }
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Missing body' }, origin);

  const name = sanitize(body.name, 120);
  const phone = sanitize(body.phone, 40);
  const email = sanitize(body.email, 120);
  const businessType = sanitize(body.businessType, 40);
  const preferredDate = sanitize(body.preferredDate, 20);
  const preferredTime = sanitize(body.preferredTime, 40);
  const location = sanitize(body.location, 200);
  const notes = sanitize(body.notes, 1000);

  if (!name || !phone || !email || !location) return json(res, 400, { error: 'Name, phone, email, and location are required' }, origin);

  const allowedBusiness = ['Office', 'Classroom', 'Commercial', 'Other'];
  const allowedTime = ['Morning', 'Afternoon', 'Flexible'];
  const properties = {
    Name: { title: [{ text: { content: name } }] },
    Phone: { phone_number: phone },
    Email: { email },
    'Business Type': { select: { name: allowedBusiness.includes(businessType) ? businessType : 'Other' } },
    Location: { rich_text: [{ text: { content: location } }] },
    Status: { select: { name: 'New' } },
    Source: { select: { name: 'Website Form' } },
  };
  if (preferredTime && allowedTime.includes(preferredTime)) properties['Preferred Time'] = { select: { name: preferredTime } };
  if (preferredDate && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) properties['Preferred Date'] = { date: { start: preferredDate } };
  if (notes) properties.Notes = { rich_text: [{ text: { content: notes } }] };

  try {
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: { database_id: DATABASE_ID }, properties }),
    });
    const data = await notionRes.json();
    if (!notionRes.ok) {
      console.error('Notion API error', notionRes.status, JSON.stringify(data));
      return json(res, 502, { error: 'Failed to save lead. Please try again or email support@zerotraceusa.com' }, origin);
    }

    const fields = { name, phone, email, businessType, preferredDate, preferredTime, location, notes };
    const emailDelivery = {
      internal: await sendLeadAlert(fields),
      customer: await sendClientConfirmation(fields),
    };

    return json(res, 200, {
      ok: true,
      id: data.id,
      emailSent: emailDelivery.internal.sent || undefined,
      clientEmailSent: emailDelivery.customer.sent || undefined,
      emailDelivery,
      next: 'select_available_slot',
    }, origin);
  } catch (err) {
    console.error('Lead submit error', err);
    return json(res, 500, { error: 'Server error' }, origin);
  }
};
