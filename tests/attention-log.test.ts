import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_HISTORY, emptyLog, noticeRequests, permissionSummary, questionSummary, resolveRequest } from '../src/main/attention-log.js';
import type { AgentQuestion, AttentionRequest, PermissionRequest } from '../src/shared/contracts.js';

const request = (id: string, kind: 'permission' | 'question' = 'permission', summary = 'bash · npm test'): AttentionRequest =>
  ({ id, kind, sessionId: 's1', taskTitle: 'Fix build', folder: 'relay', summary });

test('pending requests keep their first seen time while labels refresh', () => {
  const first = noticeRequests(emptyLog(), [request('p1')], 100);
  const second = noticeRequests(first, [request('p1', 'permission', 'bash · npm test')].map((item) => ({ ...item, taskTitle: 'Renamed task' })), 900);
  assert.equal(second.pending.p1.askedAt, 100);
  assert.equal(second.pending.p1.request.taskTitle, 'Renamed task');
  assert.equal(second.history.length, 0);
});

test('requests that vanish without a reply land in history as expired', () => {
  const state = noticeRequests(emptyLog(), [request('p1'), request('p2')], 100);
  const settled = noticeRequests(state, [request('p2')], 900);
  assert.deepEqual(Object.keys(settled.pending), ['p2']);
  assert.equal(settled.history.length, 1);
  assert.equal(settled.history[0].id, 'p1');
  assert.equal(settled.history[0].outcome, 'expired');
  assert.equal(settled.history[0].askedAt, 100);
  assert.equal(settled.history[0].resolvedAt, 900);
});

test('resolving records the outcome, answer and elapsed time', () => {
  const state = noticeRequests(emptyLog(), [request('q1', 'question', 'Choose a target')], 100);
  const settled = resolveRequest(state, 'q1', 'answered', 400, 'arm64');
  assert.equal(settled.history.length, 1);
  assert.deepEqual(
    { outcome: settled.history[0].outcome, answer: settled.history[0].answer, askedAt: settled.history[0].askedAt, resolvedAt: settled.history[0].resolvedAt },
    { outcome: 'answered', answer: 'arm64', askedAt: 100, resolvedAt: 400 },
  );
  assert.deepEqual(Object.keys(settled.pending), []);
});

test('resolving an unknown request records nothing', () => {
  const settled = resolveRequest(emptyLog(), 'missing', 'approved', 500);
  assert.equal(settled.history.length, 0);
});

test('history stays newest first and bounded', () => {
  let state = emptyLog();
  for (let index = 0; index < MAX_HISTORY + 5; index++) {
    state = resolveRequest(noticeRequests(state, [request(`p${index}`)], index), `p${index}`, 'approved', index + 1);
  }
  assert.equal(state.history.length, MAX_HISTORY);
  assert.equal(state.history[0].id, `p${MAX_HISTORY + 4}`);
  assert.equal(state.history.at(-1)?.id, `p${MAX_HISTORY + 4 - (MAX_HISTORY - 1)}`);
});

test('request summaries stay short and specific', () => {
  const permission = { id: 'p', sessionId: 's1', permission: 'bash', patterns: ['npm test'], detail: '{}' } as PermissionRequest;
  assert.equal(permissionSummary(permission), 'bash · npm test');
  const question = { id: 'q', sessionId: 's1', questions: [{ header: 'Target', question: 'Which architecture?', multiple: false, custom: false, required: true, kind: 'choice', placeholder: '', options: [] }] } as AgentQuestion;
  assert.equal(questionSummary(question), 'Which architecture?');
  const long = { ...question, questions: [{ ...question.questions[0], question: 'x'.repeat(300) }] } as AgentQuestion;
  assert.equal(questionSummary(long).length, 140);
});
