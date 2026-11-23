import test from 'node:test';
import assert from 'node:assert/strict';
import { engineConfigForTests, modelOutputCaps } from '../src/main/engine.js';
import type { ProviderInput } from '../src/shared/contracts.js';

type Config = {
  providers: Record<string, { models?: Record<string, { name?: string; limit?: { output?: number } }> }>;
};

const config = (providers: ProviderInput[], caps: Array<{ providerID: string; modelID: string; output: number }>): Config =>
  JSON.parse(engineConfigForTests.providerConfig(providers, [], [], caps)) as Config;

test('a listed model carries the output cap without losing its name', () => {
  const parsed = config(
    [{ id: 'openrouter', apiKey: 'sk-test', models: ['openai/gpt-4o-mini'] }],
    [{ providerID: 'openrouter', modelID: 'openai/gpt-4o-mini', output: 4096 }],
  );
  assert.deepEqual(parsed.providers.openrouter.models?.['openai/gpt-4o-mini'], { name: 'openai/gpt-4o-mini', limit: { output: 4096 } });
});

test('a capped model is added even when the provider lists no models', () => {
  const parsed = config(
    [{ id: 'openrouter', apiKey: 'sk-test' }],
    [{ providerID: 'openrouter', modelID: 'anthropic/claude-sonnet-4', output: 8192 }],
  );
  assert.deepEqual(parsed.providers.openrouter.models?.['anthropic/claude-sonnet-4'], { name: 'anthropic/claude-sonnet-4', limit: { output: 8192 } });
});

test('a cap for a provider that is not configured is ignored', () => {
  const parsed = config(
    [{ id: 'openrouter', apiKey: 'sk-test' }],
    [{ providerID: 'openai', modelID: 'gpt-5', output: 4096 }],
  );
  assert.equal(parsed.providers.openai, undefined);
  assert.equal(JSON.stringify(parsed).includes('gpt-5'), false);
});

test('models are written without a limit when no cap applies', () => {
  const parsed = config([{ id: 'ollama', models: ['llama3.2:3b'] }], []);
  assert.deepEqual(parsed.providers.ollama.models?.['llama3.2:3b'], { name: 'llama3.2:3b' });
});

test('caps skip models the catalog already limits below the budget', () => {
  const caps = modelOutputCaps(
    { maxTokens: 4096, models: ['openrouter::small', 'openrouter::huge', 'openrouter::unknown'] },
    new Map([['openrouter::small', 2048], ['openrouter::huge', 128000]]),
  );
  assert.deepEqual(caps, [
    { providerID: 'openrouter', modelID: 'huge', output: 4096 },
    { providerID: 'openrouter', modelID: 'unknown', output: 4096 },
  ]);
});

test('caps ignore malformed and repeated model ids', () => {
  const caps = modelOutputCaps(
    { maxTokens: 4096, models: ['openrouter::a', 'openrouter::a', 'no-provider', 'openrouter::', ''] },
    new Map(),
  );
  assert.deepEqual(caps, [{ providerID: 'openrouter', modelID: 'a', output: 4096 }]);
});

test('caps keep the model id intact when it contains colons of its own', () => {
  const caps = modelOutputCaps({ maxTokens: 2048.4, models: ['ollama::llama3.2:3b'] }, new Map());
  assert.deepEqual(caps, [{ providerID: 'ollama', modelID: 'llama3.2:3b', output: 2048 }]);
});
