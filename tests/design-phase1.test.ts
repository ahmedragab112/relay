import test from 'node:test';
import assert from 'node:assert/strict';
import { designPrompt, defaultDesignSystem, strongestModel } from '../src/shared/design.js';
import { editedFiles } from '../src/renderer/design-turns.js';
import type { ModelOption, ToolPart } from '../src/shared/contracts.js';

const model = (id: string, overrides: Partial<ModelOption> = {}): ModelOption => ({
  id, providerID: 'custom', modelID: id, name: id.toUpperCase(), connected: true, cost: 1, context: 1000, variants: [], ...overrides,
});

const tool = (name: string, input: unknown, state: ToolPart['state'] = 'completed'): ToolPart => ({
  type: 'tool', id: `${name}-${Math.random()}`, name, state, input: JSON.stringify(input), output: '',
});

test('the design prompt sends the agent to the served preview', () => {
  const prompt = designPrompt({
    projectName: 'Shop', slug: 'checkout', request: 'A two column checkout',
    system: defaultDesignSystem(), existing: ['index.html'], revision: false,
    previewUrl: 'http://127.0.0.1:4321/abc',
  });
  assert.ok(prompt.includes('http://127.0.0.1:4321/abc/checkout/index.html'));
  assert.match(prompt, /open (it|the preview) in the browser tool/i);
  assert.match(prompt, /1440|1280/);
  assert.match(prompt, /390/);
  assert.match(prompt, /console/i);
});

test('without a preview URL the prompt keeps the folder-only check', () => {
  const prompt = designPrompt({
    projectName: 'Shop', slug: 'checkout', request: 'A two column checkout',
    system: defaultDesignSystem(), existing: [], revision: false,
  });
  assert.ok(!prompt.includes('127.0.0.1'));
  assert.match(prompt, /Use the browser tool/);
});

test('design Auto picks the strongest eligible model, not the cheapest', () => {
  const models = [
    model('free/small', { free: true, cost: 0 }),
    model('mid/model', { cost: 3 }),
    model('big/model', { cost: 15, context: 400_000, variants: ['high'] }),
    model('offline/huge', { connected: false, cost: 40 }),
    model('limited/huge', { limited: true, cost: 50 }),
  ];
  assert.deepEqual(strongestModel(models), { id: 'big/model', variant: 'high' });
});

test('design Auto respects the free-only setting and the allowed model list', () => {
  const models = [
    model('free/small', { free: true, cost: 0, context: 8000 }),
    model('free/big', { free: true, cost: 0, context: 200_000 }),
    model('paid/model', { cost: 20 }),
  ];
  assert.equal(strongestModel(models, { includeFree: true, modelIds: ['free/small', 'free/big'] })?.id, 'free/big');
  assert.equal(strongestModel(models, { includeFree: false })?.id, 'paid/model');
  assert.equal(strongestModel(models, { includeFree: false, modelIds: ['free/small'] }), undefined);
});

test('design Auto keeps engine-hosted models out unless asked', () => {
  const models = [
    model('opencode/default', { engineHosted: true, cost: 30 }),
    model('regular/model', { cost: 2 }),
  ];
  assert.equal(strongestModel(models)?.id, 'regular/model');
  assert.equal(strongestModel(models, { includeFree: true, includeEngineHosted: true })?.id, 'opencode/default');
});

test('edited files are read from write and edit tool calls once each', () => {
  const parts: ToolPart[] = [
    tool('read', { filePath: '/tmp/.relay/design/checkout/index.html' }),
    tool('edit', { filePath: 'styles.css' }),
    tool('write', { path: 'index.html' }),
    tool('edit', { file_path: 'styles.css' }),
    tool('bash', { command: 'ls' }),
    { type: 'tool', id: 'broken', name: 'edit', state: 'error', input: 'not json', output: '' },
  ];
  assert.deepEqual(editedFiles(parts), ['styles.css', 'index.html']);
});
