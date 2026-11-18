import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasProgress } from '../src/shared/atlas.js';

test('planning starts the bar near zero and ready fills it', () => {
  assert.deepEqual(atlasProgress({ state: 'planning' }), { percent: 3, phase: 'Planning pages' });
  assert.deepEqual(atlasProgress({ state: 'ready' }), { percent: 100, phase: 'Atlas is ready' });
});

test('writing follows the planned page count and never reaches 100 early', () => {
  assert.equal(atlasProgress({ state: 'writing', writing: 0, total: 8 })?.percent, 10);
  assert.equal(atlasProgress({ state: 'writing', writing: 4, total: 8 })?.percent, 53);
  assert.equal(atlasProgress({ state: 'writing', writing: 8, total: 8 })?.percent, 95);
  assert.equal(atlasProgress({ state: 'writing', writing: 20, total: 8 })?.percent, 95);
  assert.equal(atlasProgress({ state: 'writing', writing: 4, total: 8 })?.phase, 'Writing pages 4 of 8');
});

test('writing without a known total stays determinate but low', () => {
  assert.deepEqual(atlasProgress({ state: 'writing', writing: 2 }), { percent: 10, phase: 'Writing pages — 2 done' });
  assert.deepEqual(atlasProgress({ state: 'writing' }), { percent: 10, phase: 'Writing pages' });
});

test('idle, error and canceled runs show no bar', () => {
  assert.equal(atlasProgress({ state: 'idle' }), undefined);
  assert.equal(atlasProgress({ state: 'error', error: 'boom' }), undefined);
  assert.equal(atlasProgress({ state: 'canceled' }), undefined);
});
