import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackgroundRuns } from '../src/main/background.js';
import { shouldBackgroundOnLeave } from '../src/renderer/state.js';
import type { SessionSummary } from '../src/shared/contracts.js';

const session = (id: string, title: string, status: SessionSummary['status'], updatedAt = 10): SessionSummary =>
  ({ id, title, updatedAt, status });

test('background runs carry the task title, status, and captured logs', () => {
  const runs = buildBackgroundRuns(
    [{ sessionId: 's1', startedAt: 5 }],
    [session('s1', 'Build the release', 'running', 30)],
    new Map([['s1', ['You: build it', 'Agent: compiling']]]),
  );
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], {
    id: 's1', title: 'Build the release', status: 'running', startedAt: 5, updatedAt: 30,
    logs: ['You: build it', 'Agent: compiling'],
  });
});

test('background runs ignore tasks the engine no longer knows about and deduplicate marks', () => {
  const runs = buildBackgroundRuns(
    [{ sessionId: 'gone', startedAt: 1 }, { sessionId: 's2', startedAt: 2 }, { sessionId: 's2', startedAt: 9 }],
    [session('s2', 'Long build', 'idle')],
    new Map(),
  );
  assert.deepEqual(runs.map((run) => run.id), ['s2']);
  assert.equal(runs[0].startedAt, 9);
  assert.deepEqual(runs[0].logs, []);
});

test('background runs are newest first and keep only the latest log lines', () => {
  const logs = new Map([['s2', Array.from({ length: 20 }, (_, index) => `line ${index}`)]]);
  const runs = buildBackgroundRuns(
    [{ sessionId: 's1', startedAt: 1 }, { sessionId: 's2', startedAt: 2 }],
    [session('s1', 'Older', 'idle'), session('s2', 'Newer', 'error')],
    logs,
  );
  assert.deepEqual(runs.map((run) => run.id), ['s2', 's1']);
  assert.equal(runs[0].logs.length, 12);
  assert.equal(runs[0].logs.at(-1), 'line 19');
});

test('leaving a running task marks it for background continuation', () => {
  assert.equal(shouldBackgroundOnLeave(session('s1', 'Build', 'running'), 's2'), 's1');
  assert.equal(shouldBackgroundOnLeave(session('s1', 'Build', 'running'), 's1'), '');
  assert.equal(shouldBackgroundOnLeave(session('s1', 'Build', 'idle'), 's2'), '');
  assert.equal(shouldBackgroundOnLeave(undefined, 's2'), '');
});
