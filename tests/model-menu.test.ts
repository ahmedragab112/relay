import test from 'node:test';
import assert from 'node:assert/strict';
import { groupModels, resolveVariant, variantLabel } from '../src/renderer/model-menu.js';
import type { ModelOption } from '../src/shared/contracts.js';

const model = (id: string, overrides: Partial<ModelOption> = {}): ModelOption => ({
  id, providerID: 'custom', modelID: id, name: id.toUpperCase(), connected: true, ...overrides,
});

test('models are grouped into free, available, and unavailable sections', () => {
  const groups = groupModels([
    model('free-a', { free: true }),
    model('paid-b'),
    model('offline-c', { connected: false }),
  ], false);
  assert.deepEqual(groups.map((group) => group.label), ['Free models', 'Available models', 'Unavailable']);
  assert.deepEqual(groups.map((group) => group.models.map((item) => item.id)), [['free-a'], ['paid-b'], ['offline-c']]);
});

test('the free-only filter drops paid and unavailable models', () => {
  const groups = groupModels([model('free-a', { free: true }), model('paid-b')], true);
  assert.deepEqual(groups.map((group) => group.label), ['Free models']);
  assert.deepEqual(groups[0].models.map((item) => item.id), ['free-a']);
});

test('a saved power variant only applies when the model supports it', () => {
  assert.equal(resolveVariant(['low', 'high'], 'high'), 'high');
  assert.equal(resolveVariant(['low', 'high'], 'medium'), '');
  assert.equal(resolveVariant(undefined, 'low'), '');
});

test('power levels read as plain words inside the model menu', () => {
  assert.equal(variantLabel('low'), 'Low');
  assert.equal(variantLabel('medium'), 'Medium');
  assert.equal(variantLabel('high'), 'High');
  assert.equal(variantLabel('max'), 'Max');
});
