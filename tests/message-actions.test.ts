import test from 'node:test';
import assert from 'node:assert/strict';
import { forkBoundary } from '../src/main/engine.js';

const messages = [{ id: 'msg-1' }, { id: 'msg-2' }, { id: 'msg-3' }];

test('forking from a response includes it by stopping before the next message', () => {
  assert.equal(forkBoundary(messages, 'msg-1'), 'msg-2');
  assert.equal(forkBoundary(messages, 'msg-2'), 'msg-3');
});

test('forking from the last response copies the whole task', () => {
  assert.equal(forkBoundary(messages, 'msg-3'), undefined);
});

test('forking from a message outside the task is rejected', () => {
  assert.throws(() => forkBoundary(messages, 'msg-missing'), /no longer part of the task/i);
  assert.throws(() => forkBoundary([], 'msg-1'), /no longer part of the task/i);
});
