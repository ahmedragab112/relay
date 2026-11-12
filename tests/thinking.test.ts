import test from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, formatElapsed, rotatePhrase, thinkingLabel, toolLabel, toolStateLabel, THINKING_PHRASES, WRITING_PHRASES } from '../src/renderer/thinking-text.js';
import type { ChatMessage } from '../src/shared/contracts.js';

const message = (id: string, role: ChatMessage['role'], parts: ChatMessage['parts']): ChatMessage => ({ id, role, createdAt: 1, parts });

test('activity only follows the replies to the newest message', () => {
  const turn = [
    message('u1', 'user', [{ type: 'text', id: 'p1', text: 'first request' }]),
    message('a1', 'assistant', [{ type: 'text', id: 'p2', text: 'earlier answer' }]),
    message('u2', 'user', [{ type: 'text', id: 'p3', text: 'next request' }]),
  ];
  assert.deepEqual(activityOf(turn), { hasReasoning: false, hasText: false });
  assert.deepEqual(activityOf([...turn, message('a2', 'assistant', [
    { type: 'reasoning', id: 'r1', text: 'planning the edit' },
    { type: 'tool', id: 't1', name: 'bash', state: 'running', input: '', output: '' },
  ])]), { tool: { name: 'bash', state: 'running' }, hasReasoning: true, hasText: false });
  assert.deepEqual(activityOf([...turn, message('a3', 'assistant', [
    { type: 'tool', id: 't2', name: 'bash', state: 'completed', input: '', output: '' },
    { type: 'text', id: 'p4', text: 'Finished.' },
  ])]), { hasReasoning: false, hasText: true });
});

test('thinking phrases rotate on a steady interval and wrap', () => {
  assert.equal(rotatePhrase(0, THINKING_PHRASES), 'Thinking…');
  assert.equal(rotatePhrase(3_199, THINKING_PHRASES), 'Thinking…');
  assert.equal(rotatePhrase(3_200, THINKING_PHRASES), 'Deliberating…');
  assert.equal(rotatePhrase(6_400, THINKING_PHRASES), 'Pondering…');
  assert.equal(rotatePhrase(THINKING_PHRASES.length * 3_200, THINKING_PHRASES), 'Thinking…');
});

test('tool names read as plain-language activity', () => {
  assert.equal(toolLabel('bash'), 'Running a command');
  assert.equal(toolLabel('read'), 'Reading files');
  assert.equal(toolLabel('grep'), 'Searching the project');
  assert.equal(toolLabel('custom-tool'), 'Running custom-tool');
});

test('tool states read in plain language', () => {
  assert.equal(toolStateLabel('completed'), 'done');
  assert.equal(toolStateLabel('running'), 'running');
  assert.equal(toolStateLabel('pending'), 'waiting');
  assert.equal(toolStateLabel('error'), 'failed');
});

test('a running tool outranks reasoning, and streaming text reads as writing', () => {
  assert.equal(thinkingLabel({ tool: { name: 'bash', state: 'running' }, hasReasoning: true, hasText: false }, 0), 'Running a command…');
  assert.equal(thinkingLabel({ tool: { name: 'read', state: 'pending' }, hasReasoning: false, hasText: false }, 0), 'Reading files…');
  assert.equal(thinkingLabel({ hasReasoning: true, hasText: false }, 6_400), 'Pondering…');
  assert.equal(thinkingLabel({ hasReasoning: false, hasText: true }, 0), WRITING_PHRASES[0]);
  assert.equal(thinkingLabel({ tool: { name: 'bash', state: 'completed' }, hasReasoning: true, hasText: false }, 3_200), 'Deliberating…');
});

test('elapsed time stays quiet for the first second then reads naturally', () => {
  assert.equal(formatElapsed(0), '');
  assert.equal(formatElapsed(999), '');
  assert.equal(formatElapsed(12_400), '12s');
  assert.equal(formatElapsed(65_000), '1m 05s');
});
