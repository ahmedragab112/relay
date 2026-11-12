import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsage } from '../src/main/usage.js';
import { mapMessages } from '../src/main/engine-mapping.js';
import type { SessionMessageInfo } from '@opencode/client';

let serial = 0;
const tokens = (input: number, output = 0, read = 0, write = 0, reasoning = 0) => ({ input, output, reasoning, cache: { read, write } });
const assistant = (usage: ReturnType<typeof tokens>) => ({
  id: `assistant-${++serial}`, type: 'assistant' as const, time: { created: serial }, agent: 'build',
  model: { id: 'openai::gpt-test', providerID: 'openai' }, content: [], tokens: usage,
});
const compaction = (status: 'running' | 'completed' | 'failed', usage?: ReturnType<typeof tokens>) => ({
  id: `compaction-${++serial}`, type: 'compaction' as const, time: { created: serial }, reason: 'manual' as const,
  status, summary: 'Earlier conversation condensed', ...(usage ? { tokens: usage } : {}),
});

test('usage reports context after the latest completed compaction', () => {
  const before = assistant(tokens(800, 100, 100));
  const running = compaction('running');
  const after = assistant(tokens(120, 20, 0));
  const summary = summarizeUsage([before, running, after] as SessionMessageInfo[], 1000);
  assert.equal(summary.contextUsed, 140);
  assert.equal(summary.percent, 14);
  assert.equal(summary.compactions, 0);
  assert.equal(summary.input, 920);
  assert.equal(summary.output, 120);
  assert.equal(summary.cacheRead, 100);
  assert.equal(summary.cacheWrite, 0);
  assert.equal(summary.total, 1140);
  assert.equal(summary.model, 'openai · gpt-test');
});

test('usage counts only completed compactions and falls back before any compaction', () => {
  const first = assistant(tokens(400));
  const summary = summarizeUsage([first] as SessionMessageInfo[], 2000);
  assert.equal(summary.contextUsed, 400);
  assert.equal(summary.percent, 20);
  assert.equal(summary.compactions, 0);

  const completed = compaction('completed', tokens(10, 5));
  const latest = summarizeUsage([first, compaction('failed'), completed, assistant(tokens(300, 10, 50))] as SessionMessageInfo[], 2000);
  assert.equal(latest.compactions, 1);
  assert.equal(latest.contextUsed, 360);
  assert.equal(latest.percent, 18);
  assert.equal(latest.total, 775);
});

test('usage without a context limit stays at zero percent', () => {
  const summary = summarizeUsage([assistant(tokens(50, 5))] as SessionMessageInfo[]);
  assert.equal(summary.contextUsed, 55);
  assert.equal(summary.contextLimit, undefined);
  assert.equal(summary.percent, 0);
  assert.equal(summary.cost, 0);
});

test('usage stays empty for sessions with no token data', () => {
  const summary = summarizeUsage([] as SessionMessageInfo[], 128_000);
  assert.deepEqual(summary, {
    input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0,
    contextUsed: 0, contextLimit: 128_000, percent: 0, cost: 0, compactions: 0, worked: 0,
  });
});

test('message mapping renders compaction as a system card', () => {
  const messages = mapMessages([
    compaction('completed'),
    assistant(tokens(10)),
  ] as SessionMessageInfo[]);
  const card = messages[0];
  assert.equal(card.role, 'system');
  assert.deepEqual(card.parts[0], {
    type: 'compaction', id: card.parts[0].type === 'compaction' ? card.parts[0].id : '',
    status: 'completed', reason: 'manual', summary: 'Earlier conversation condensed',
  });
  assert.equal(messages[1].role, 'assistant');
});

test('usage totals the time spent across completed turns', () => {
  const messages = [
    { id: 'user_1', type: 'user' as const, time: { created: 100 }, text: 'go' },
    { id: 'assistant_1', type: 'assistant' as const, agent: 'build', model: { providerID: 'openai', id: 'test' }, time: { created: 200, completed: 3_200 }, content: [] },
    { id: 'user_2', type: 'user' as const, time: { created: 5_000 }, text: 'again' },
    { id: 'assistant_2', type: 'assistant' as const, agent: 'build', model: { providerID: 'openai', id: 'test' }, time: { created: 5_100, completed: 5_400 }, content: [] },
  ];
  assert.equal(summarizeUsage(messages as SessionMessageInfo[]).worked, 3_500);
});
