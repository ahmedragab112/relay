import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/main/engine.js';
import type { AppEvent } from '../src/shared/contracts.js';

function permission(id: string, sessionID: string) {
  return { id, sessionID, action: 'shell', resources: ['git status'], message: 'Run git status', metadata: {} };
}

function form(id: string, sessionID: string) {
  return { id, sessionID, title: 'Question', fields: [] };
}

test('stopping a task dismisses its pending permission and question requests', async () => {
  const events: AppEvent[] = [];
  const interrupted: string[] = [];
  const replies: Array<{ sessionID: string; requestID: string; decision: string }> = [];
  const cancelled: Array<{ sessionID: string; formID: string }> = [];
  const engine = new Engine('/tmp/relay-abort-test', '/bin/false', (event) => events.push(event));
  engine.client = {
    session: {
      interrupt: async (input: { sessionID: string }) => { interrupted.push(input.sessionID); },
      form: { cancel: async (input: { sessionID: string; formID: string }) => { cancelled.push(input); } },
    },
    permission: {
      request: { list: async () => ({ data: [permission('p1', 's1'), permission('p2', 's2')] }) },
      reply: async (input: { sessionID: string; requestID: string; decision: string }) => { replies.push(input); },
    },
    form: { list: async () => ({ data: [form('f1', 's1'), form('f2', 's2')] }) },
  } as never;

  await engine.abortSession('s1');

  assert.deepEqual(interrupted, ['s1']);
  assert.deepEqual(replies, [{ sessionID: 's1', requestID: 'p1', decision: 'reject' }]);
  assert.deepEqual(cancelled, [{ sessionID: 's1', formID: 'f1' }]);
  assert.ok(events.some((event) => event.type === 'permission-resolved' && event.id === 'p1'));
  assert.ok(events.some((event) => event.type === 'question-resolved' && event.id === 'f1'));
  assert.equal(events.some((event) => event.type === 'permission-resolved' && event.id === 'p2'), false);
});
