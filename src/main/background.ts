import type { BackgroundRun, SessionSummary } from '../shared/contracts.js';

const MAX_RUNS = 12;
const MAX_LOGS = 12;
const MAX_LOG_LENGTH = 600;

// A run is any task the engine is executing right now — the user can watch one chat
// while the rest keep working, so the Activity page lists every live run.
export function buildBackgroundRuns(
  sessions: SessionSummary[],
  logs: Map<string, string[]>,
): BackgroundRun[] {
  return sessions
    .filter((session) => session.status === 'running')
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RUNS)
    .map((session) => ({
      id: session.id,
      title: session.title || 'Running task',
      status: session.status,
      updatedAt: session.updatedAt,
      logs: (logs.get(session.id) ?? []).slice(-MAX_LOGS).map((line) => line.length > MAX_LOG_LENGTH ? `${line.slice(0, MAX_LOG_LENGTH)}…` : line),
    }));
}
