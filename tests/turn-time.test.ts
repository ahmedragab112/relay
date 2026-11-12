import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatTokens, formatWorked, workSummary } from '../src/renderer/turn-time.js';

test('worked durations read naturally from seconds to hours', () => {
  assert.equal(formatWorked(0), '0s');
  assert.equal(formatWorked(4_400), '4s');
  assert.equal(formatWorked(64_000), '1m 04s');
  assert.equal(formatWorked(3_725_000), '1h 02m');
});

test('token counts stay compact', () => {
  assert.equal(formatTokens(0), '');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(12_400), '12.4k');
  assert.equal(formatTokens(48_000), '48k');
  assert.equal(formatTokens(1_250_000), '1.3M');
});

test('the live clock counts minutes and seconds', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(65_000), '1:05');
  assert.equal(formatClock(600_000), '10:00');
});

test('a finished reply summarizes work, tokens and cost', () => {
  assert.equal(workSummary({ startedAt: 1_000, completedAt: 65_000, tokens: 12_400, cost: 0.0312 }), 'Worked 1m 04s · 12.4k tokens · $0.03');
  assert.equal(workSummary({ startedAt: 1_000, completedAt: 3_000 }), 'Worked 2s');
  assert.equal(workSummary({ startedAt: 1_000 }), '');
});
