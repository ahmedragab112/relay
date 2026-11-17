import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoModelCandidates } from '../src/shared/contracts.js';
import type { ModelOption } from '../src/shared/contracts.js';

function model(overrides: Partial<ModelOption>): ModelOption {
  return {
    id: overrides.id ?? 'p::m',
    providerID: overrides.providerID ?? 'p',
    modelID: overrides.modelID ?? 'm',
    name: overrides.name ?? 'p · m',
    connected: overrides.connected ?? true,
    ...overrides,
  };
}

test('auto candidates are empty when nothing is connected', () => {
  assert.deepEqual(autoModelCandidates([model({ connected: false })]), []);
});

test('auto candidates prefer lowest cost, then smallest context', () => {
  const result = autoModelCandidates([
    model({ id: 'paid::big', connected: true, cost: 5, context: 200000, free: false }),
    model({ id: 'free::small', connected: true, cost: 0, context: 8000, free: true }),
    model({ id: 'free::large', connected: true, cost: 0, context: 256000, free: true }),
    model({ id: 'paid::cheap', connected: true, cost: 1, context: 32000, free: false }),
  ]);
  assert.deepEqual(result.map((item) => item.id), ['free::small', 'free::large', 'paid::cheap', 'paid::big']);
});

test('auto candidates skip models hosted on the engine gateway by default', () => {
  const result = autoModelCandidates([
    model({ id: 'opencode::free', providerID: 'opencode', free: true, engineHosted: true, cost: 0 }),
    model({ id: 'openrouter::paid', providerID: 'openrouter', free: false, cost: 1 }),
  ]);
  assert.deepEqual(result.map((item) => item.id), ['openrouter::paid']);
});

test('auto candidates include engine-hosted models only when opted in', () => {
  const result = autoModelCandidates([
    model({ id: 'opencode::free', providerID: 'opencode', free: true, engineHosted: true, cost: 0 }),
    model({ id: 'openrouter::paid', providerID: 'openrouter', free: false, cost: 1 }),
  ], { includeFree: true, includeEngineHosted: true, maxTokens: 4096, modelIds: [] });
  assert.deepEqual(result.map((item) => item.id), ['opencode::free', 'openrouter::paid']);
});

test('auto candidates cap at six and pick the first variant', () => {
  const models = Array.from({ length: 10 }, (_, index) => model({
    id: `p::m${index}`,
    connected: true,
    cost: 0,
    context: 1000 * (index + 1),
    variants: ['low', 'high'],
  }));
  const result = autoModelCandidates(models);
  assert.equal(result.length, 6);
  assert.equal(result[0].variant, 'low');
});