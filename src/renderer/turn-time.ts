export function formatWorked(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatClock(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatTokens(count: number): string {
  if (!count) return '';
  if (count < 1_000) return String(count);
  if (count < 100_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export interface WorkedGroup {
  startedAt: number;
  completedAt?: number;
  tokens?: number;
  cost?: number;
}

export function workSummary(group: WorkedGroup): string {
  if (group.completedAt === undefined) return '';
  const parts = [`Worked ${formatWorked(group.completedAt - group.startedAt)}`];
  const tokens = formatTokens(group.tokens ?? 0);
  if (tokens) parts.push(`${tokens} tokens`);
  if (group.cost) parts.push(`$${group.cost.toFixed(group.cost < 0.01 ? 4 : 2)}`);
  return parts.join(' · ');
}
