const MAX_QUERY_LENGTH = 80;
const MAX_RESULTS_PER_GROUP = 8;

function normalizeQuery(value) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

function includesQuery(query, values) {
  const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function result(type, title, subtitle, section) {
  return { type, title: String(title || ''), subtitle: String(subtitle || ''), section };
}

function shapeSearchResults(query, { customers = {}, jobs = {}, approvals = {} }) {
  const normalized = normalizeQuery(query);
  if (!normalized) return { query: normalized, groups: [] };

  const organizations = new Map((customers.organizations || []).map(item => [item.id, item]));
  const locations = new Map((customers.locations || []).map(item => [item.id, item]));
  const groups = [
    { type: 'Customers', items: (customers.customers || []).filter(item => includesQuery(normalized, [item.display_name, item.status, organizations.get(item.organization_id)?.display_name, organizations.get(item.organization_id)?.legal_name])).map(item => result('Customer', item.display_name, [organizations.get(item.organization_id)?.display_name, item.status].filter(Boolean).join(' · '), 'customers')) },
    { type: 'Organizations', items: (customers.organizations || []).filter(item => includesQuery(normalized, [item.display_name, item.legal_name, item.status])).map(item => result('Organization', item.display_name, [item.legal_name, item.status].filter(Boolean).join(' · '), 'customers')) },
    { type: 'Jobs & bookings', items: (jobs.jobs || []).filter(item => includesQuery(normalized, [item.title, item.kind, item.status, item.source_system, locations.get(item.service_location_id)?.label, locations.get(item.service_location_id)?.city, locations.get(item.service_location_id)?.region])).map(item => result(item.scheduled_start_at ? 'Booking' : 'Job', item.title, [item.status, locations.get(item.service_location_id)?.city || locations.get(item.service_location_id)?.label].filter(Boolean).join(' · '), 'jobs')) },
    { type: 'Approvals', items: (approvals.approvals || []).filter(item => includesQuery(normalized, [item.action_type, item.target_type, item.status, item.rationale])).map(item => result('Approval', item.action_type, [item.target_type, item.status].filter(Boolean).join(' · '), 'approvals')) },
  ].map(group => ({ ...group, items: group.items.slice(0, MAX_RESULTS_PER_GROUP) })).filter(group => group.items.length);
  return { query: normalized, groups };
}

async function searchCommand(query, readers) {
  const normalized = normalizeQuery(query);
  if (!normalized) return { query: normalized, groups: [] };
  const [customers, jobs, approvals] = await Promise.all([readers.listCustomers(), readers.listJobs(), readers.listApprovals()]);
  return shapeSearchResults(normalized, { customers, jobs, approvals });
}

module.exports = { MAX_QUERY_LENGTH, MAX_RESULTS_PER_GROUP, normalizeQuery, shapeSearchResults, searchCommand };
