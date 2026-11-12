import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMessages } from '../src/main/engine.js';

test('message pagination never combines a cursor with an explicit sort order', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const pages = [
    { data: [{ id: 'm1', type: 'user' }], cursor: { next: 'cursor-1' } },
    { data: [{ id: 'm2', type: 'assistant' }], cursor: { next: null } },
  ];
  const list = async (input: Record<string, unknown>) => {
    calls.push(input);
    return pages.shift() as never;
  };
  const messages = await collectMessages(list as never, 'session-1');
  assert.deepEqual(messages.map((message) => (message as { id: string }).id), ['m1', 'm2']);
  assert.deepEqual(calls, [
    { sessionID: 'session-1', limit: 200, order: 'asc' },
    { sessionID: 'session-1', limit: 200, cursor: 'cursor-1' },
  ]);
});
