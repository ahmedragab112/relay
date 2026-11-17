import assert from 'node:assert/strict';
import test from 'node:test';
import { initialUpdateStatus, nextUpdateStatus, shouldAutoCheck, updatesConfigured } from '../src/shared/updates.js';

test('idle status carries the auto-check preference', () => {
  assert.deepEqual(initialUpdateStatus(true), { phase: 'idle', autoCheck: true });
  assert.deepEqual(initialUpdateStatus(false), { phase: 'idle', autoCheck: false });
});

test('checking clears stale version and progress but keeps the preference', () => {
  const previous = { phase: 'downloaded' as const, version: '0.2.0', progress: 100, autoCheck: true, checkedAt: 5 };
  assert.deepEqual(nextUpdateStatus(previous, { kind: 'checking' }, 9), { phase: 'checking', autoCheck: true });
});

test('an available update records its version and check time', () => {
  const status = nextUpdateStatus(initialUpdateStatus(true), { kind: 'available', version: '0.2.0' }, 100);
  assert.equal(status.phase, 'available');
  assert.equal(status.version, '0.2.0');
  assert.equal(status.checkedAt, 100);
});

test('download progress is rounded and clamped to 0-100 while keeping the version', () => {
  const available = nextUpdateStatus(initialUpdateStatus(true), { kind: 'available', version: '0.2.0' }, 100);
  const half = nextUpdateStatus(available, { kind: 'progress', percent: 42.6 }, 110);
  assert.deepEqual(half, { phase: 'downloading', version: '0.2.0', progress: 43, autoCheck: true, checkedAt: 100 });
  assert.equal(nextUpdateStatus(available, { kind: 'progress', percent: 140 }, 110).progress, 100);
  assert.equal(nextUpdateStatus(available, { kind: 'progress', percent: -3 }, 110).progress, 0);
});

test('a finished download is ready to install at 100 percent', () => {
  const status = nextUpdateStatus(initialUpdateStatus(true), { kind: 'downloaded', version: '0.2.0' }, 200);
  assert.equal(status.phase, 'downloaded');
  assert.equal(status.version, '0.2.0');
  assert.equal(status.progress, 100);
});

test('no update marks the check time and reports up to date', () => {
  const status = nextUpdateStatus(initialUpdateStatus(false), { kind: 'none' }, 300);
  assert.deepEqual(status, { phase: 'up-to-date', autoCheck: false, checkedAt: 300 });
});

test('errors keep their message and the check time', () => {
  const status = nextUpdateStatus(initialUpdateStatus(true), { kind: 'error', message: 'network down' }, 400);
  assert.equal(status.phase, 'error');
  assert.equal(status.message, 'network down');
  assert.equal(status.checkedAt, 400);
});

test('automatic checks only run in packaged builds with the preference on', () => {
  assert.equal(shouldAutoCheck(true, true), true);
  assert.equal(shouldAutoCheck(true, false), false);
  assert.equal(shouldAutoCheck(false, true), false);
  assert.equal(shouldAutoCheck(false, false), false);
});

test('a build without an update feed cannot check or auto-check', () => {
  assert.equal(updatesConfigured(true, true), true);
  assert.equal(updatesConfigured(true, false), false);
  assert.equal(updatesConfigured(false, true), false);
  assert.equal(updatesConfigured(false, false), false);
});
