import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateAttention, attentionRequests } from '../src/main/attention.js';
import type { AgentQuestion, PermissionRequest, SessionSummary } from '../src/shared/contracts.js';

const sessions: SessionSummary[] = [
  { id: 's1', title: 'Fix the installer', updatedAt: 300, status: 'running', directory: '/projects/relay' },
  { id: 's2', title: 'Port the tablet app', updatedAt: 200, status: 'idle', directory: '/projects/teacher' },
  { id: 's3', title: 'Scratch task', updatedAt: 100, status: 'idle' },
];

const request: PermissionRequest = { id: 'p1', sessionId: 's1', permission: 'shell', patterns: ['npm test'], detail: 'Run tests' };
const question: AgentQuestion = { id: 'q1', sessionId: 's2', questions: [{ header: 'Target', question: 'Which target?', multiple: false, custom: true, required: true, kind: 'text', placeholder: '', options: [] }] };

test('labels approvals with their task title and project folder', () => {
  const overview = annotateAttention([{ directory: '/projects/relay', request }], [], sessions);
  assert.equal(overview.permissions.length, 1);
  assert.equal(overview.permissions[0].taskTitle, 'Fix the installer');
  assert.equal(overview.permissions[0].folder, 'relay');
  assert.equal(overview.permissions[0].sessionId, 's1');
  assert.equal(overview.permissions[0].request, request);
});

test('labels questions from another folder and keeps folderless tasks readable', () => {
  const loose: PermissionRequest = { ...request, id: 'p2', sessionId: 's3' };
  const overview = annotateAttention([{ directory: '/projects/relay', request: loose }], [{ directory: '/projects/teacher', request: question }], sessions);
  assert.equal(overview.permissions[0].folder, 'No folder');
  assert.equal(overview.permissions[0].taskTitle, 'Scratch task');
  assert.equal(overview.questions[0].folder, 'teacher');
  assert.equal(overview.questions[0].taskTitle, 'Port the tablet app');
});

test('falls back to the request folder and a short task label when a session is missing', () => {
  const orphan: AgentQuestion = { ...question, id: 'q2', sessionId: 'gone-session' };
  const overview = annotateAttention([], [{ directory: '/projects/teacher', request: orphan }], sessions);
  assert.equal(overview.questions[0].taskTitle, 'Task gone-ses');
  assert.equal(overview.questions[0].folder, 'teacher');
});

test('lists each pending request only once', () => {
  const overview = annotateAttention([
    { directory: '/projects/relay', request },
    { directory: '/projects/relay', request },
  ], [], sessions);
  assert.equal(overview.permissions.length, 1);
});

test('builds a log entry with a short summary for every pending request', () => {
  const overview = annotateAttention([{ directory: '/projects/relay', request }], [{ directory: '/projects/teacher', request: question }], sessions);
  assert.deepEqual(attentionRequests(overview).map((item) => [item.id, item.kind, item.summary]), [
    ['p1', 'permission', 'shell · npm test'],
    ['q1', 'question', 'Which target?'],
  ]);
  assert.equal(attentionRequests(overview)[0].detail, 'Run tests');
});
