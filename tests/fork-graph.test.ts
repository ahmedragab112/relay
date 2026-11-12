import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkForest, forkRelations } from '../src/renderer/fork-graph.js';
import type { SessionSummary } from '../src/shared/contracts.js';

function task(id: string, updatedAt: number, parent?: string): SessionSummary {
  return { id, title: id, updatedAt, status: 'idle', ...(parent ? { fork: { sessionId: parent } } : {}) };
}

test('nests forks under their origin and keeps the freshest tree first', () => {
  const forest = forkForest([
    task('origin', 100),
    task('fork-a', 300, 'origin'),
    task('fork-b', 200, 'origin'),
    task('other', 250),
  ]);

  assert.deepEqual(forest.map((node) => [node.session.id, node.depth]), [
    ['origin', 0],
    ['fork-a', 1],
    ['fork-b', 1],
    ['other', 0],
  ]);
  assert.equal(forest[0].branches, 2);
  assert.equal(forest[1].last, false);
  assert.equal(forest[2].last, true);
  assert.deepEqual(forest[1].lanes, []);
});

test('nested forks keep the ancestor lane open while the parent has a following branch', () => {
  const forest = forkForest([
    task('origin', 100),
    task('fork-a', 300, 'origin'),
    task('fork-a1', 400, 'fork-a'),
    task('fork-b', 200, 'origin'),
  ]);

  assert.deepEqual(forest.map((node) => [node.session.id, node.depth]), [
    ['origin', 0],
    ['fork-a', 1],
    ['fork-a1', 2],
    ['fork-b', 1],
  ]);
  assert.deepEqual(forest[2].lanes, [true]);
  assert.deepEqual(forest[3].lanes, []);
  assert.equal(forest[1].branches, 1);
});

test('orphaned, self-referencing and cyclic forks become roots without duplicating tasks', () => {
  const forest = forkForest([
    task('orphan', 300, 'missing'),
    task('self', 200, 'self'),
    task('a', 100, 'b'),
    task('b', 50, 'a'),
  ]);

  assert.deepEqual(forest.map((node) => node.session.id).sort(), ['a', 'b', 'orphan', 'self']);
  assert.equal(new Set(forest.map((node) => node.session.id)).size, 4);
  assert.equal(forest.find((node) => node.session.id === 'a')?.depth, 0);
  assert.equal(forest.find((node) => node.session.id === 'orphan')?.depth, 0);
  assert.equal(forest.find((node) => node.session.id === 'self')?.depth, 0);
});

test('relations find the origin and every direct fork regardless of order', () => {
  const items = [
    task('origin', 100),
    task('fork-a', 300, 'origin'),
    task('fork-b', 200, 'origin'),
    task('fork-a1', 400, 'fork-a'),
  ];

  const nested = forkRelations(items, 'fork-a1');
  assert.equal(nested.parent?.id, 'fork-a');
  assert.deepEqual(nested.forks, []);
  const origin = forkRelations(items, 'origin');
  assert.equal(origin.parent, undefined);
  assert.deepEqual(origin.forks.map((item) => item.id), ['fork-a', 'fork-b']);
});

test('an unknown or absent task has no branch relations', () => {
  const absent = forkRelations([task('origin', 100)], undefined);
  assert.equal(absent.parent, undefined);
  assert.deepEqual(absent.forks, []);
  const unknown = forkRelations([task('origin', 100)], 'missing');
  assert.equal(unknown.parent, undefined);
  assert.deepEqual(unknown.forks, []);
});
