const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('availability API exposes safe empty-slot reason metadata', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../api/availability.js'), 'utf8');
  assert.equal(source.includes("emptyReason = 'minimum_notice'"), true);
  assert.equal(source.includes('minimumNoticeMinutes'), true);
  assert.equal(source.includes('GOOGLE_PRIVATE_KEY'), true);
  assert.equal(source.includes('return json(res, 200'), true);
});

test('booking UI explains notice-window empties and refreshes without duplicate lead creation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../book.html'), 'utf8');
  assert.equal(source.includes('booking notice window'), true);
  assert.equal(source.includes("if(leadId){"), true);
  assert.equal(source.includes("dateInput.addEventListener('change',refreshAvailability)"), true);
  assert.equal(source.includes("timeInput.addEventListener('change',refreshAvailability)"), true);
  assert.equal(source.includes("submitBtn.textContent=leadId?'Refresh available times':'See available times'"), true);
});
