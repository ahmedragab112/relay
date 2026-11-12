import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalWorked, turnDurations } from '../src/shared/turns.js';

test('a turn spans from the user message to the last completed step', () => {
  const durations = turnDurations([
    { role: 'user', createdAt: 1_000 },
    { role: 'assistant', createdAt: 1_200, completedAt: 2_000 },
    { role: 'assistant', createdAt: 2_100, completedAt: 6_200 },
  ]);
  assert.deepEqual(durations, [5_200]);
});

test('each user turn is measured separately and unfinished turns are skipped', () => {
  const durations = turnDurations([
    { role: 'user', createdAt: 100 },
    { role: 'assistant', createdAt: 200, completedAt: 1_100 },
    { role: 'user', createdAt: 2_000 },
    { role: 'assistant', createdAt: 2_100, completedAt: 2_600 },
    { role: 'user', createdAt: 3_000 },
    { role: 'assistant', createdAt: 3_100 },
  ]);
  assert.deepEqual(durations, [1_000, 600]);
});

test('assistant steps without a user message and out-of-order completions are ignored', () => {
  assert.deepEqual(turnDurations([{ role: 'assistant', createdAt: 10, completedAt: 90 }]), []);
  assert.deepEqual(turnDurations([
    { role: 'user', createdAt: 500 },
    { role: 'assistant', createdAt: 400, completedAt: 300 },
  ]), [0]);
  assert.deepEqual(turnDurations([
    { role: 'user', createdAt: 500 },
    { role: 'system', createdAt: 520 },
    { role: 'assistant', createdAt: 540, completedAt: 900 },
  ]), [400]);
});

test('worked total sums every completed turn', () => {
  assert.equal(totalWorked([
    { role: 'user', createdAt: 0 },
    { role: 'assistant', createdAt: 50, completedAt: 1_500 },
    { role: 'user', createdAt: 10_000 },
    { role: 'assistant', createdAt: 10_050, completedAt: 13_000 },
  ]), 4_500);
});
