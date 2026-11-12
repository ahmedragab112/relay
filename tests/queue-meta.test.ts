import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueuedMessage } from '../src/shared/contracts';
import { queuedMeta } from '../src/renderer/queue-meta';

function queued(overrides: Partial<QueuedMessage>): QueuedMessage {
  return {
    id: 'inbox-1', text: 'Continue', files: [], skills: [], agents: [], model: 'model-a', variant: '',
    access: 'ask', planOnly: false, goalDriven: false, context: [], delivery: 'queue', createdAt: 0,
    ...overrides,
  };
}

test('a queued message says it waits for the current reply', () => {
  assert.equal(queuedMeta(queued({ files: ['a.ts', 'b.ts'] })), 'Sends when this reply finishes · 2 files');
});

test('a steered message says it is being sent now and lists its attachments', () => {
  assert.equal(queuedMeta(queued({ delivery: 'steer', skills: ['review'], planOnly: true })), 'Steering now · 1 skill · Plan only');
});

test('a plain queued message has no trailing separators', () => {
  assert.equal(queuedMeta(queued({})), 'Sends when this reply finishes');
});

test('agents and context blocks are counted in the summary', () => {
  assert.equal(
    queuedMeta(queued({ agents: ['build'], context: [{ label: 'Task: One', text: 'x' }] })),
    'Sends when this reply finishes · 1 agent · 1 context block',
  );
});
