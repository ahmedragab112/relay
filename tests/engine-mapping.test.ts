import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapMessages, mapPermission, mapQuestion, answerForm, mapSession, locatedSession } from '../src/main/engine-mapping.js';
import type { SessionMessageInfo, FormInfo, SessionInfo } from '@opencode/client';

test('maps V2 messages without leaking native metadata or dropping tool failures', () => {
  const messages: SessionMessageInfo[] = [
    { id: 'user_1', type: 'user', time: { created: 100 }, text: 'Review this' },
    { id: 'assistant_1', type: 'assistant', agent: 'build', model: { providerID: 'openai', id: 'test' }, time: { created: 200 }, content: [
      { type: 'reasoning', text: 'Checking', native: { private: 'secret' } },
      { type: 'tool', id: 'call_1', name: 'read', time: { created: 201 }, state: { status: 'completed', input: { path: 'test.ts' }, content: [{ type: 'text', text: 'actual content' }] } },
      { type: 'tool', id: 'call_2', name: 'bash', time: { created: 202 }, state: { status: 'error', input: { command: 'test' }, error: { type: 'Failed', message: 'Permission denied' } } },
      { type: 'text', text: 'Finished' },
    ] },
  ];
  const result = mapMessages(messages);
  assert.equal(result[0].role, 'user');
  assert.equal(result[1].parts[1].type, 'tool');
  assert.deepEqual(result[1].parts[1], { type: 'tool', id: 'call_1', name: 'read', state: 'completed', input: '{\n  "path": "test.ts"\n}', output: 'actual content' });
  assert.equal((result[1].parts[2] as { output: string }).output, 'Permission denied');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('maps approval resources and preserves session association', () => {
  assert.deepEqual(mapPermission({ id: 'p1', sessionID: 's1', action: 'bash', resources: ['npm test'], metadata: { command: 'npm test' } }), {
    id: 'p1', sessionId: 's1', permission: 'bash', patterns: ['npm test'], detail: '{\n  "command": "npm test"\n}',
  });
});

test('converts question labels back to protocol values and rejects missing answers', () => {
  const form: FormInfo = { id: 'f1', sessionID: 's1', title: 'Choose', fields: [
    { key: 'target', type: 'string', title: 'Target', required: true, options: [{ value: 'arm64', label: 'Apple Silicon' }, { value: 'x64', label: 'Intel' }] },
    { key: 'checks', type: 'multiselect', title: 'Checks', options: [{ value: 'test', label: 'Tests' }, { value: 'build', label: 'Build' }] },
  ] };
  assert.equal(mapQuestion(form).questions[0].options[0].label, 'Apple Silicon');
  assert.equal(mapQuestion(form).questions[0].options[0].value, 'arm64');
  assert.equal(mapQuestion(form).questions[0].kind, 'choice');
  assert.deepEqual(answerForm(form, [['Apple Silicon'], ['Tests', 'Build']]), { target: 'arm64', checks: ['test', 'build'] });
  assert.deepEqual(answerForm(form, [['arm64'], ['test']]), { target: 'arm64', checks: ['test'] });
  assert.throws(() => answerForm(form, [[], []]), /required/i);
  assert.throws(() => answerForm(form, [['Unknown'], []]), /option/i);
});

test('maps boolean, number, free text and custom flags for question cards', () => {
  const form: FormInfo = { id: 'f2', sessionID: 's1', title: 'Configure', fields: [
    { key: 'confirm', type: 'boolean', title: 'Confirm', required: true },
    { key: 'port', type: 'integer', title: 'Port' },
    { key: 'name', type: 'string', title: 'Name' },
    { key: 'locked', type: 'string', title: 'Locked', options: [{ value: 'a', label: 'Alpha' }], custom: false },
  ] };
  const questions = mapQuestion(form).questions;
  assert.equal(questions[0].kind, 'choice');
  assert.deepEqual(questions[0].options.map((option) => option.value), ['true', 'false']);
  assert.equal(questions[0].required, true);
  assert.equal(questions[1].kind, 'number');
  assert.equal(questions[2].kind, 'text');
  assert.equal(questions[2].custom, true);
  assert.equal(questions[3].custom, false);
  assert.deepEqual(answerForm(form, [['true'], ['8080'], ['relay'], ['Alpha']]), { confirm: true, port: 8080, name: 'relay', locked: 'a' });
});

test('session outcome does not conceal a currently active run', () => {
  const session = { id: 's1', title: 'Fix tests', time: { created: 1, updated: 2 }, outcome: 'failed' } as SessionInfo;
  assert.equal(mapSession(session, true).status, 'running');
  assert.equal(mapSession(session, false).status, 'error');
});

test('session summaries remember their project folder', () => {
  const session = { id: 's1', title: 'Fix tests', time: { created: 1, updated: 2 }, location: { directory: '/projects/relay' } } as SessionInfo;
  assert.equal(mapSession(session, false).directory, '/projects/relay');
});

test('newly created tasks fall back to the folder that created them', () => {
  const session = { id: 's1', title: 'Fix tests', time: { created: 1, updated: 2 } } as SessionInfo;
  assert.equal(locatedSession(session, false, '/projects/relay').directory, '/projects/relay');
  const located = { id: 's2', title: 'Other', time: { created: 1, updated: 2 }, location: { directory: '/projects/other' } } as SessionInfo;
  assert.equal(locatedSession(located, false, '/projects/relay').directory, '/projects/other');
});

test('session summaries keep the origin of a forked task', () => {
  const forked = { id: 's2', title: 'Fork', time: { created: 3, updated: 4 }, fork: { sessionID: 's1', boundary: { type: 'before', messageID: 'm2' } } } as SessionInfo;
  assert.deepEqual(mapSession(forked, false).fork, { sessionId: 's1' });
  assert.deepEqual(locatedSession(forked, false, '/projects/relay').fork, { sessionId: 's1' });
  const root = { id: 's3', title: 'Root', time: { created: 5, updated: 6 } } as SessionInfo;
  assert.equal(mapSession(root, false).fork, undefined);
});

test('background tools are marked whether they are running or finished', () => {
  const messages: SessionMessageInfo[] = [
    { id: 'assistant_1', type: 'assistant', agent: 'build', model: { providerID: 'openai', id: 'test' }, time: { created: 200 }, content: [
      { type: 'tool', id: 'call_1', name: 'bash', time: { created: 201 }, state: { status: 'running', input: { command: 'npm run build' }, metadata: { background: true } } },
      { type: 'tool', id: 'call_2', name: 'bash', time: { created: 202 }, state: { status: 'completed', input: { command: 'npm test' }, metadata: { background: true }, content: [{ type: 'text', text: 'ok' }] } },
      { type: 'tool', id: 'call_3', name: 'read', time: { created: 203 }, state: { status: 'completed', input: { path: 'a.ts' }, content: [{ type: 'text', text: 'file' }] } },
    ] },
  ];
  const parts = mapMessages(messages)[0].parts;
  assert.equal((parts[0] as { background?: boolean }).background, true);
  assert.equal((parts[1] as { background?: boolean }).background, true);
  assert.equal((parts[2] as { background?: boolean }).background, undefined);
});

test('assistant messages keep completion time, token total and cost', () => {
  const messages: SessionMessageInfo[] = [
    { id: 'assistant_1', type: 'assistant', agent: 'build', model: { providerID: 'openai', id: 'test' }, time: { created: 200, completed: 5_200 }, cost: 0.0123,
      tokens: { input: 1_000, output: 200, reasoning: 50, cache: { read: 10, write: 5 } }, content: [{ type: 'text', text: 'Done' }] },
  ];
  const message = mapMessages(messages)[0];
  assert.equal(message.completedAt, 5_200);
  assert.equal(message.tokens, 1_265);
  assert.equal(message.cost, 0.0123);
});
