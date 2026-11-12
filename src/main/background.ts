import type { BackgroundRun, SessionSummary } from '../shared/contracts.js';

export interface BackgroundMark {
  sessionId: string;
  startedAt: number;
}

const MAX_RUNS = 6;
const MAX_LOGS = 12;
const MAX_LOG_LENGTH = 600;

export function buildBackgroundRuns(
  marks: BackgroundMark[],
  sessions: SessionSummary[],
  logs: Map<string, string[]>,
): BackgroundRun[] {
  const newest = new Map<string, number>();
  for (const mark of marks) newest.set(mark.sessionId, Math.max(newest.get(mark.sessionId) ?? 0, mark.startedAt));
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return [...newest.entries()]
    .flatMap(([id, startedAt]): BackgroundRun[] => {
      const session = byId.get(id);
      if (!session) return [];
      return [{
        id,
        title: session.title || 'Background task',
        status: session.status,
        startedAt,
        updatedAt: session.updatedAt,
        logs: (logs.get(id) ?? []).slice(-MAX_LOGS).map((line) => line.length > MAX_LOG_LENGTH ? `${line.slice(0, MAX_LOG_LENGTH)}…` : line),
      }];
    })
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, MAX_RUNS);
}
