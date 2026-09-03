const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const editors = [
  'command/customer-editing.js',
  'command/job-editing.js',
  'command/calendar-operations.js',
];

test('all editable Command surfaces use theme variables in dark and light modes', () => {
  for (const file of editors) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /background:var\(--surface-raised\)/, file);
    assert.match(source, /color:var\(--dark\)/, file);
    assert.match(source, /color-scheme:dark/, file);
    assert.match(source, /::placeholder\{color:var\(--quiet\)/, file);
    assert.match(source, /:disabled/, file);
    assert.match(source, /\[readonly\]/, file);
    assert.match(source, /:focus/, file);
  }
});

test('Command editors never reintroduce fixed white form surfaces', () => {
  for (const file of editors) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /(?:input|select|textarea)\{[^}]*background:#fff/, file);
  }
});
