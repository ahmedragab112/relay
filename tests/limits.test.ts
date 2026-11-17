import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitResetAt, resetLabel } from '../src/shared/limits.js';

const now = Date.parse('2026-11-15T10:00:00Z');

test('reads a retry delay in seconds from the provider error', () => {
  assert.equal(limitResetAt('Rate limit exceeded. Please wait 18 seconds before retrying.', now), now + 18_000);
});

test('understands retry-after windows expressed in minutes', () => {
  assert.equal(limitResetAt('try again in 2 minutes', now), now + 120_000);
});

test('reads an absolute reset time from the provider error', () => {
  assert.equal(limitResetAt('Free quota exhausted. Quota resets at 2026-11-15T12:30:00Z.', now), Date.parse('2026-11-15T12:30:00Z'));
});

test('ignores a reset time that has already passed', () => {
  assert.equal(limitResetAt('Quota resets at 2026-11-15T09:00:00Z.', now), undefined);
});

test('returns no reset time when the error carries no timing', () => {
  assert.equal(limitResetAt('Insufficient credits for this request.', now), undefined);
});

test('labels a short wait in seconds', () => {
  assert.equal(resetLabel(now + 30_000, now), 'resets in 30s');
});

test('labels a longer wait in minutes', () => {
  assert.equal(resetLabel(now + 5 * 60_000, now), 'resets in 5m');
});

test('reports that the model is available once the window has passed', () => {
  assert.equal(resetLabel(now - 1, now), 'available now');
});
