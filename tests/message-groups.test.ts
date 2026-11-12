import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMessages, groupText, lastAssistantIndex, replyBlocks } from '../src/renderer/message-groups.js';
import type { ChatMessage } from '../src/shared/contracts.js';

const text = (id: string, value: string, type: 'text' | 'reasoning' = 'text') => ({ id, type, text: value });
const tool = (id: string, name: string, state: 'pending' | 'running' | 'completed' | 'error' = 'completed') =>
  ({ type: 'tool' as const, id, name, state, input: '', output: '' });
const message = (id: string, role: ChatMessage['role'], parts: ChatMessage['parts'], createdAt = 1): ChatMessage =>
  ({ id, role, createdAt, parts });

test('consecutive assistant messages from one turn become a single reply', () => {
  const groups = groupMessages([
    message('u1', 'user', [text('u1-t', 'Fix the build')]),
    message('a1', 'assistant', [text('a1-0', 'Looking at it.')], 2),
    message('a2', 'assistant', [tool('t1', 'bash'), text('a2-0', 'Done.')], 3),
  ]);
  assert.deepEqual(groups.map((group) => group.id), ['u1', 'a1']);
  assert.equal(groups[1].role, 'assistant');
  assert.deepEqual(groups[1].messages.map((item) => item.id), ['a1', 'a2']);
  assert.equal(groups[1].createdAt, 2);
});

test('a new user message starts a new reply group', () => {
  const groups = groupMessages([
    message('a1', 'assistant', [text('a1-0', 'First answer')]),
    message('u2', 'user', [text('u2-0', 'Next request')]),
    message('a2', 'assistant', [text('a2-0', 'Second answer')]),
    message('a3', 'assistant', [text('a3-0', 'More detail')]),
  ]);
  assert.deepEqual(groups.map((group) => [group.role, group.messages.length]), [['assistant', 1], ['user', 1], ['assistant', 2]]);
});

test('the latest assistant reply is the only follow-up anchor', () => {
  const groups = groupMessages([
    message('u1', 'user', [text('u1-t', 'First')]),
    message('a1', 'assistant', [text('a1-0', 'First answer')]),
    message('u2', 'user', [text('u2-t', 'Second')]),
    message('a2', 'assistant', [text('a2-0', 'Second answer')]),
    message('a3', 'assistant', [text('a3-0', 'More detail')]),
  ]);
  assert.equal(lastAssistantIndex(groups), 3);
  assert.equal(lastAssistantIndex(groupMessages([message('u1', 'user', [text('u1-t', 'Hi')])])), -1);
});

test('adjacent text and reasoning merge while tools keep their place', () => {
  const groups = groupMessages([
    message('u1', 'user', [text('u1-t', 'Go')]),
    message('a1', 'assistant', [text('a1-0', 'Plan:', 'reasoning')]),
    message('a2', 'assistant', [text('a2-0', 'checking files', 'reasoning'), tool('t1', 'read')]),
    message('a3', 'assistant', [text('a3-0', 'All good.'), text('a3-1', 'Nothing else.')]),
  ]);
  const blocks = replyBlocks(groups[1]);
  assert.deepEqual(blocks.map((block) => block.kind), ['reasoning', 'tool', 'text']);
  assert.equal(blocks[0].kind === 'reasoning' && blocks[0].text, 'Plan:\n\nchecking files');
  assert.equal(blocks[2].kind === 'text' && blocks[2].text, 'All good.\n\nNothing else.');
});

test('copied reply text keeps every answer segment and skips reasoning', () => {
  const groups = groupMessages([
    message('u1', 'user', [text('u1-t', 'Go')]),
    message('a1', 'assistant', [text('a1-0', 'Thinking hard', 'reasoning')]),
    message('a2', 'assistant', [text('a2-0', 'First part.'), tool('t1', 'bash')]),
    message('a3', 'assistant', [text('a3-0', 'Second part.')]),
  ]);
  assert.equal(groupText(groups[1]), 'First part.\n\nSecond part.');
});

test('a reply group records its turn start, completion, tokens and cost', () => {
  const groups = groupMessages([
    message('u1', 'user', [text('u1-t', 'Go')], 1_000),
    { ...message('a1', 'assistant', [text('a1-0', 'Step')], 1_200), completedAt: 2_000, tokens: 500, cost: 0.25 },
    { ...message('a2', 'assistant', [text('a2-0', 'Answer')], 2_100), completedAt: 5_200, tokens: 700, cost: 0.5 },
  ]);
  assert.equal(groups[1].startedAt, 1_000);
  assert.equal(groups[1].completedAt, 5_200);
  assert.equal(groups[1].tokens, 1_200);
  assert.equal(groups[1].cost, 0.75);
});
