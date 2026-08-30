const { configured, readJson, restRequest } = require('./command-data');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function encoded(value) {
  return encodeURIComponent(value);
}

async function writeJson(path, method, body, prefer = 'return=representation') {
  const response = await restRequest(path, {
    method,
    headers: { 'Content-Type': 'application/json', Prefer: prefer },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Command lead sync query failed.');
    error.code = 'COMMAND_LEAD_SYNC_QUERY_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function findCustomerByContact(kind, normalizedValue) {
  if (!normalizedValue) return null;
  const rows = await readJson(`customer_contacts?select=customer_id&kind=eq.${kind}&normalized_value=eq.${encoded(normalizedValue)}&customer_id=not.is.null&limit=1`);
  return rows?.[0]?.customer_id || null;
}

async function createCustomer(fields, notionPageId) {
  const rows = await writeJson('customers', 'POST', [{
    display_name: fields.name,
    status: 'active',
    notion_page_id: notionPageId,
  }]);
  return rows?.[0]?.id;
}

async function ensureContact(customerId, kind, value, normalizedValue, isPrimary) {
  if (!customerId || !value || !normalizedValue) return;
  const path = `customer_contacts?on_conflict=customer_id,kind,normalized_value`;
  await writeJson(path, 'POST', [{
    customer_id: customerId,
    kind,
    value,
    normalized_value: normalizedValue,
    is_primary: isPrimary,
  }], 'resolution=ignore-duplicates,return=minimal');
}

async function ensureWalkthroughJob(customerId, fields, notionPageId) {
  const existing = await readJson(`jobs?select=id&source_system=eq.website&source_record_id=eq.${encoded(notionPageId)}&limit=1`);
  if (existing?.length) return existing[0].id;

  const rows = await writeJson('jobs', 'POST', [{
    kind: 'walkthrough',
    status: 'draft',
    customer_id: customerId,
    title: `Walkthrough — ${fields.name}`,
    service_details: {
      businessType: fields.businessType || null,
      preferredDate: fields.preferredDate || null,
      preferredTime: fields.preferredTime || null,
      location: fields.location || null,
    },
    source_system: 'website',
    source_record_id: notionPageId,
    idempotency_key: `website-lead:${notionPageId}`,
  }]);
  return rows?.[0]?.id;
}

async function mirrorLeadToCommand(fields, notionPageId) {
  if (!configured()) return { state: 'pending', reason: 'not_configured' };

  const email = normalizeEmail(fields.email);
  const phone = normalizePhone(fields.phone);
  try {
    const existingJob = await readJson(`jobs?select=id&source_system=eq.website&source_record_id=eq.${encoded(notionPageId)}&limit=1`);
    if (existingJob?.length) return { state: 'synced' };

    let customerId = await findCustomerByContact('email', email);
    if (!customerId) customerId = await findCustomerByContact('phone', phone);
    if (!customerId) customerId = await createCustomer(fields, notionPageId);
    if (!customerId) throw Object.assign(new Error('Customer creation failed.'), { code: 'COMMAND_LEAD_SYNC_CUSTOMER_FAILED' });

    await ensureContact(customerId, 'email', fields.email, email, true);
    await ensureContact(customerId, 'phone', fields.phone, phone, true);
    await ensureWalkthroughJob(customerId, fields, notionPageId);
    return { state: 'synced' };
  } catch (error) {
    console.error('Command lead sync failed', {
      code: error?.code || 'COMMAND_LEAD_SYNC_FAILED',
      status: Number.isInteger(error?.status) ? error.status : undefined,
    });
    return { state: 'pending', reason: 'sync_failed' };
  }
}

module.exports = { mirrorLeadToCommand, normalizeEmail, normalizePhone };
