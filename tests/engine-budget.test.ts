import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/main/engine.js';
import type { AppEvent } from '../src/shared/contracts.js';

const tokens = (input: number) => ({ input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } });
const assistant = (cost: number) => ({
  id: 'msg-1', type: 'assistant' as const, time: { created: 1, completed: 2 }, agent: 'build',
  model: { id: 'openai::gpt-test', providerID: 'openai' }, content: [], tokens: tokens(10), cost,
});

function harness(cost: number) {
  const events: AppEvent[] = [];
  const interrupted: Array<{ sessionID: string; resume: boolean }> = [];
  const engine = new Engine('/tmp/relay-budget-test', '/bin/false', (event) => events.push(event));
  const client = {
    message: { list: async () => ({ data: [assistant(cost)], cursor: {} }) },
    session: {
      interrupt: async (input: { sessionID: string; resume: boolean }) => { interrupted.push(input); },
      form: { cancel: async () => {} },
    },
    permission: {
      request: { list: async () => ({ data: [] }) },
      reply: async () => {},
    },
    form: { list: async () => ({ data: [] }) },
  };
  const internals = engine as unknown as {
    client: unknown;
    directory: string;
    event: (event: { type: string; data?: unknown }) => void;
    checkBudget: (id: string) => Promise<void>;
    silenceSession: (id: string) => void;
  };
  internals.client = client;
  internals.directory = '/tmp/relay-budget-project';
  return { engine, internals, events, interrupted };
}

const flushed = () => new Promise((resolve) => setImmediate(resolve));

test('a task over its budget is stopped and reports the amount spent', async () => {
  const h = harness(0.08);
  h.engine.setCostLimit(true, 0.05);
  h.internals.event({ type: 'message.updated', data: { sessionID: 'ses_1', info: { role: 'assistant' } } });
  await flushed();
  await flushed();
  assert.deepEqual(h.interrupted, [{ sessionID: 'ses_1', resume: false }]);
  const hit = h.events.find((event) => event.type === 'budget-reached');
  assert.deepEqual(hit, { type: 'budget-reached', sessionId: 'ses_1', cost: 0.08, limit: 0.05 });
});

test('a task under its budget keeps running', async () => {
  const h = harness(0.01);
  h.engine.setCostLimit(true, 0.05);
  await h.internals.checkBudget('ses_1');
  assert.deepEqual(h.interrupted, []);
  assert.equal(h.events.some((event) => event.type === 'budget-reached'), false);
});

test('the guard is off until a limit is enabled and skips invisible runs', async () => {
  const h = harness(1);
  await h.internals.checkBudget('ses_1');
  assert.deepEqual(h.interrupted, []);
  h.engine.setCostLimit(false, 0.05);
  await h.internals.checkBudget('ses_1');
  assert.deepEqual(h.interrupted, []);
  h.engine.setCostLimit(true, 0.05);
  h.internals.silenceSession('ses_atlas');
  await h.internals.checkBudget('ses_atlas');
  assert.deepEqual(h.interrupted, []);
});
