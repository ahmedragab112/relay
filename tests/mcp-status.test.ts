import test from 'node:test';
import assert from 'node:assert/strict';
import { mapMcpStatus } from '../src/main/engine.js';

test('maps engine mcp statuses to runtime connector statuses', () => {
  const statuses = mapMcpStatus({ data: [
    { name: 'Filesystem', status: { status: 'connected' } },
    { name: 'Time', status: { status: 'pending' } },
    { name: 'Broken', status: { status: 'failed', error: 'spawn ENOENT' } },
    { name: 'Off', status: { status: 'disabled' } },
  ] });
  assert.deepEqual(statuses, [
    { name: 'Filesystem', status: 'connected' },
    { name: 'Time', status: 'pending' },
    { name: 'Broken', status: 'failed', error: 'spawn ENOENT' },
    { name: 'Off', status: 'disabled' },
  ]);
});

test('a failed status without an error string still explains itself', () => {
  const statuses = mapMcpStatus({ data: [{ name: 'X', status: { status: 'failed' } }] });
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].status, 'failed');
  assert.ok(statuses[0].error && statuses[0].error.length > 0);
});

test('malformed entries are dropped instead of invented', () => {
  assert.deepEqual(mapMcpStatus({ data: [null, { status: { status: 'connected' } }, { name: 5 }, 'x', undefined] }), []);
  assert.deepEqual(mapMcpStatus({ data: [{ name: 'Ok', status: { status: 'maybe' } }] }), []);
});

test('accepts a bare array as well as the wrapped response', () => {
  assert.deepEqual(mapMcpStatus([{ name: 'Solo', status: { status: 'connected' } }]), [{ name: 'Solo', status: 'connected' }]);
  assert.deepEqual(mapMcpStatus(undefined), []);
  assert.deepEqual(mapMcpStatus('nope'), []);
});
