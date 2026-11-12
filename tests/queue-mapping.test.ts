import assert from 'node:assert/strict';
import test from 'node:test';
import { mapQueuedMessages } from '../src/main/queue';

const item = (overrides: Record<string, unknown> = {}) => ({
  type: 'user',
  id: 'msg_1',
  delivery: 'queue',
  sessionID: 'ses_1',
  time: { created: 1_700_000_000_000 },
  payload: { text: 'Composed prompt', metadata: { relay: { text: 'Original ask', model: 'custom::test-model', access: 'full', files: ['src/app.ts'], skills: ['opencode'], planOnly: true } } },
  ...overrides,
});

test('queued user prompts map to the original ask with its settings', () => {
  assert.deepEqual(mapQueuedMessages([item()]), [{
    id: 'msg_1',
    text: 'Original ask',
    files: ['src/app.ts'],
    skills: ['opencode'],
    agents: [],
    model: 'custom::test-model',
    variant: '',
    access: 'full',
    planOnly: true,
    goalDriven: false,
    context: [],
    delivery: 'queue',
    createdAt: 1_700_000_000_000,
  }]);
});

test('non-user inbox entries and unknown shapes are skipped', () => {
  assert.deepEqual(mapQueuedMessages([item({ type: 'compaction' }), null, 'junk']), []);
});

test('missing metadata falls back to the stored text and safe defaults', () => {
  const [queued] = mapQueuedMessages([item({ payload: { text: 'Plain prompt' } })]);
  assert.equal(queued.text, 'Plain prompt');
  assert.equal(queued.access, 'ask');
  assert.deepEqual(queued.files, []);
  assert.equal(queued.delivery, 'queue');
});

test('steering is reported for items promoted to steer', () => {
  assert.equal(mapQueuedMessages([item({ delivery: 'steer' })])[0].delivery, 'steer');
});
