import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTasks } from '../src/renderer/task-groups.js';
import type { SessionSummary, Workspace } from '../src/shared/contracts.js';

const relays: Workspace = { id: 'relay', name: 'relay', path: '/projects/relay', lastOpened: 200 };
const teacher: Workspace = { id: 'teacher', name: 'teacher', path: '/projects/teacher', lastOpened: 100 };
const empty: Workspace = { id: 'empty', name: 'empty', path: '/projects/empty', lastOpened: 300 };

function task(id: string, directory: string | undefined, updatedAt: number): SessionSummary {
  return { id, title: id, updatedAt, status: 'idle', ...(directory === undefined ? {} : { directory }) };
}

test('groups tasks under their project folder with the current folder first', () => {
  const groups = groupTasks([
    task('relay-old', '/projects/relay', 100),
    task('relay-new', '/projects/relay/', 300),
    task('teacher-task', '/projects/teacher', 250),
    task('loose', undefined, 50),
    task('outside', '/tmp/elsewhere', 400),
  ], [relays, teacher, empty], 'relay');

  assert.deepEqual(groups.map((group) => group.name), ['relay', 'teacher', 'No folder']);
  assert.equal(groups[0].current, true);
  assert.equal(groups[0].path, '/projects/relay');
  assert.deepEqual(groups[0].sessions.map((session) => session.id), ['relay-new', 'relay-old']);
  assert.deepEqual(groups[1].sessions.map((session) => session.id), ['teacher-task']);
  assert.equal(groups[1].current, false);
  assert.equal(groups[2].id, 'none');
  assert.equal(groups[2].path, undefined);
  assert.deepEqual(groups[2].sessions.map((session) => session.id), ['loose']);
});

test('keeps the current folder visible even when it has no tasks and hides empty past folders', () => {
  const groups = groupTasks([task('teacher-task', '/projects/teacher', 250)], [relays, teacher, empty], 'empty');

  assert.deepEqual(groups.map((group) => group.id), ['empty', 'teacher']);
  assert.equal(groups[0].current, true);
  assert.deepEqual(groups[0].sessions, []);
});

test('keeps one entry per task and the freshest timestamp', () => {
  const groups = groupTasks([
    task('same', '/projects/relay', 100),
    task('same', '/projects/relay', 300),
    task('other', '/projects/relay', 200),
  ], [relays], 'relay');

  assert.deepEqual(groups[0].sessions.map((session) => [session.id, session.updatedAt]), [['same', 300], ['other', 200]]);
  assert.equal(groups.length, 1);
});

test('orders past folders by recency of use', () => {
  const recent: Workspace = { id: 'recent', name: 'recent', path: '/projects/recent', lastOpened: 500 };
  const groups = groupTasks([
    task('teacher-task', '/projects/teacher', 250),
    task('recent-task', '/projects/recent', 100),
  ], [relays, teacher, recent], 'relay');

  assert.deepEqual(groups.map((group) => group.name), ['relay', 'recent', 'teacher']);
});
