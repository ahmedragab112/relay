import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSearchHits } from '../src/shared/search.js';
import type { HistoryHit } from '../src/shared/history.js';
import type { KnowledgeHit } from '../src/shared/knowledge.js';

const task = (id: string, score: number, updatedAt: number): HistoryHit => ({
  sessionId: id, title: id, snippet: id, updatedAt, score,
});

const saved = (id: string, score: number, updatedAt: number): KnowledgeHit => ({
  id, title: id, kind: 'note', snippet: id, updatedAt, score,
});

test('tasks and Knowledge rank together by score, then recency', () => {
  const hits = combineSearchHits(
    [task('task-title', 2, 50), task('task-body', 1, 90)],
    [saved('knowledge-title', 3, 10), saved('knowledge-body', 1, 20)],
  );
  assert.deepEqual(hits.map((hit) => hit.source === 'task' ? `task:${hit.task.sessionId}` : `knowledge:${hit.knowledge.id}`), [
    'knowledge:knowledge-title',
    'task:task-title',
    'task:task-body',
    'knowledge:knowledge-body',
  ]);
});

test('the combined limit is shared by both kinds', () => {
  const tasks = Array.from({ length: 20 }, (_, index) => task(`t${index}`, 3, 100 - index));
  const knowledge = Array.from({ length: 20 }, (_, index) => saved(`k${index}`, 2, 100 - index));
  const hits = combineSearchHits(tasks, knowledge, 12);
  assert.equal(hits.length, 12);
  assert.equal(hits.filter((hit) => hit.source === 'knowledge').length, 0);
  assert.deepEqual(combineSearchHits([], [], 12), []);
});
