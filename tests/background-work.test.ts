import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackgroundRuns } from '../src/main/background.js';
import type { SessionSummary } from '../src/shared/contracts.js';

const session = (id: string, title: string, status: SessionSummary['status'], updatedAt = 10): SessionSummary =>
  ({ id, title, updatedAt, status });

test('runs list the tasks the engine is executing right now with their captured logs', () => {
  const runs = buildBackgroundRuns(
    [session('s1', 'Build the release', 'running', 30), session('s2', 'Done already', 'idle', 40)],
    new Map([['s1', ['You: build it', 'Agent: compiling']]]),
  );
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], {
    id: 's1', title: 'Build the release', status: 'running', updatedAt: 30,
    logs: ['You: build it', 'Agent: compiling'],
  });
});

test('runs are newest activity first and keep only the latest log lines', () => {
  const logs = new Map([['s2', Array.from({ length: 20 }, (_, index) => `line ${index}`)]]);
  const runs = buildBackgroundRuns(
    [session('s1', 'Older', 'running', 1), session('s2', 'Newer', 'running', 99)],
    logs,
  );
  assert.deepEqual(runs.map((run) => run.id), ['s2', 's1']);
  assert.equal(runs[0].logs.length, 12);
  assert.equal(runs[0].logs.at(-1), 'line 19');
});

test('runs without logs stay visible with empty logs', () => {
  const runs = buildBackgroundRuns([session('s3', 'Waiting on tools', 'running', 5)], new Map());
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].logs, []);
  assert.equal(runs[0].title, 'Waiting on tools');
});

test('runs skip finished and errored tasks — they live in the task list instead', () => {
  const runs = buildBackgroundRuns(
    [session('s1', 'Idle', 'idle'), session('s2', 'Failed', 'error')],
    new Map(),
  );
  assert.equal(runs.length, 0);
});
