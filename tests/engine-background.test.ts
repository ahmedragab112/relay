import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/main/engine.js';

test('backgrounding a task moves its blocking tools without interrupting the task', async () => {
  const backgrounded: string[] = [];
  const interrupted: string[] = [];
  const engine = new Engine('/tmp/relay-background-test', '/bin/false', () => {});
  engine.client = {
    session: {
      background: async (input: { sessionID: string }) => { backgrounded.push(input.sessionID); },
      interrupt: async (input: { sessionID: string }) => { interrupted.push(input.sessionID); },
    },
  } as never;

  await engine.backgroundSession('s1');

  assert.deepEqual(backgrounded, ['s1']);
  assert.deepEqual(interrupted, []);
});
