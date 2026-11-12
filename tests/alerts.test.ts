import test from 'node:test';
import assert from 'node:assert/strict';
import { finishAlert } from '../src/main/alerts.js';

const base = { notifications: true, sound: true, focused: false, supported: true };

test('an unfocused window prefers the system notification', () => {
  assert.equal(finishAlert(base), 'notification');
});

test('a focused window rings the in-app chime', () => {
  assert.equal(finishAlert({ ...base, focused: true }), 'sound');
});

test('the chime fills in when notifications are off or unsupported', () => {
  assert.equal(finishAlert({ ...base, notifications: false }), 'sound');
  assert.equal(finishAlert({ ...base, supported: false }), 'sound');
});

test('turning both alerts off stays silent', () => {
  assert.equal(finishAlert({ notifications: false, sound: false, focused: true, supported: true }), 'none');
  assert.equal(finishAlert({ notifications: true, sound: false, focused: false, supported: false }), 'none');
});
