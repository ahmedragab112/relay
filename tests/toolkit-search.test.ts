import test from 'node:test';
import assert from 'node:assert/strict';
import { searchTasksAndProjects } from '../src/renderer/toolkit-search.js';
import type { SessionSummary, Workspace } from '../src/shared/contracts.js';

const task = (id: string, title: string, status: SessionSummary['status'] = 'idle', directory?: string): SessionSummary =>
  ({ id, title, updatedAt: 1, status, ...(directory ? { directory } : {}) });
const project = (id: string, name: string, path: string): Workspace => ({ id, name, path, lastOpened: 1 });

test('an empty search returns no task or project matches', () => {
  const matches = searchTasksAndProjects([task('a', 'Fix login')], [project('w', 'relay', '/tmp/relay')], '   ');
  assert.deepEqual(matches.tasks, []);
  assert.deepEqual(matches.projects, []);
});

test('search matches task titles and task folders case-insensitively', () => {
  const tasks = [task('a', 'Fix login redirect', 'idle', '/tmp/relay'), task('b', 'Write release notes')];
  const matches = searchTasksAndProjects(tasks, [], 'LOGIN');
  assert.deepEqual(matches.tasks.map((item) => item.id), ['a']);
  assert.deepEqual(searchTasksAndProjects(tasks, [], 'release').tasks.map((item) => item.id), ['b']);
  assert.deepEqual(searchTasksAndProjects(tasks, [], 'relay').tasks.map((item) => item.id), ['a']);
});

test('search matches project names and paths', () => {
  const projects = [project('w1', 'relay', '/Users/me/code/relay'), project('w2', 'teacher', '/Users/me/code/teacher')];
  assert.deepEqual(searchTasksAndProjects([], projects, 'teacher').projects.map((item) => item.id), ['w2']);
  assert.deepEqual(searchTasksAndProjects([], projects, 'code/relay').projects.map((item) => item.id), ['w1']);
});

test('search caps each group so the toolkit stays readable', () => {
  const tasks = Array.from({ length: 9 }, (_, index) => task(`t${index}`, `Review pass ${index}`));
  const projects = Array.from({ length: 6 }, (_, index) => project(`w${index}`, `review-${index}`, `/tmp/review-${index}`));
  const matches = searchTasksAndProjects(tasks, projects, 'review', { tasks: 3, projects: 2 });
  assert.equal(matches.tasks.length, 3);
  assert.equal(matches.projects.length, 2);
});
