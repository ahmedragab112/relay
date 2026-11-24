import type { HistoryHit } from './history.js';
import type { KnowledgeHit } from './knowledge.js';

export type SearchHit =
  | { source: 'task'; task: HistoryHit }
  | { source: 'knowledge'; knowledge: KnowledgeHit };

export function combineSearchHits(tasks: HistoryHit[], knowledge: KnowledgeHit[], limit = 30): SearchHit[] {
  const ranked: Array<{ score: number; updatedAt: number; hit: SearchHit }> = [
    ...tasks.map((task) => ({ score: task.score, updatedAt: task.updatedAt, hit: { source: 'task' as const, task } })),
    ...knowledge.map((knowledgeHit) => ({ score: knowledgeHit.score, updatedAt: knowledgeHit.updatedAt, hit: { source: 'knowledge' as const, knowledge: knowledgeHit } })),
  ];
  return ranked
    .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
    .slice(0, limit)
    .map((entry) => entry.hit);
}
