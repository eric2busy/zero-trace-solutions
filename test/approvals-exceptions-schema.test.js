const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260830022000_approvals_exceptions_command.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

test('approval decisions are append-only, consistent, and browser-denied', () => {
  assert.match(sql, /create table public\.approval_decisions/i);
  assert.match(sql, /unique \(approval_id\)/i);
  assert.match(sql, /command_validate_approval_decision_insert/i);
  assert.match(sql, /approval decision must match terminal approval state/i);
  assert.match(sql, /command_reject_approval_decision_update/i);
  assert.match(sql, /command_reject_approval_decision_delete/i);
  assert.match(sql, /alter table public\.approval_decisions enable row level security/i);
  assert.match(sql, /revoke all on table public\.approval_decisions from anon, authenticated/i);
  assert.match(sql, /No direct approval decision access/i);
});

test('approval validity check fails closed on scope, payload, status, expiry, and receipt', () => {
  assert.match(sql, /command_approval_allows_action/i);
  assert.match(sql, /approval\.authority_level = 'yellow'/i);
  assert.match(sql, /approval\.status in \('approved', 'modified'\)/i);
  assert.match(sql, /approval\.action_type = expected_action_type/i);
  assert.match(sql, /approval\.target_type = expected_target_type/i);
  assert.match(sql, /approval\.target_id is not distinct from expected_target_id/i);
  assert.match(sql, /jsonb_typeof\(expected_payload_summary\) = 'object'/i);
  assert.match(sql, /approval\.proposed_payload_summary = expected_payload_summary/i);
  assert.match(sql, /decision\.effective_payload_summary = expected_payload_summary/i);
  assert.match(sql, /approval\.expires_at is null or approval\.expires_at > now\(\)/i);
  assert.match(sql, /decision\.decision = approval\.status/i);
  assert.match(sql, /decision\.decided_by_actor_id = approval\.decided_by_actor_id/i);
  assert.match(sql, /decision\.correlation_id = approval\.correlation_id/i);
  assert.match(sql, /revoke all on function public\.command_approval_allows_action\(uuid, text, text, uuid, jsonb\)/i);
});
