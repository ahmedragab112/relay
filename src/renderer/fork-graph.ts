import type { SessionSummary } from '../shared/contracts';

export interface ForkNode {
  session: SessionSummary;
  depth: number;
  last: boolean;
  lanes: boolean[];
  branches: number;
}

export interface ForkRelations {
  parent?: SessionSummary;
  forks: SessionSummary[];
}

function freshest(sessions: SessionSummary[]): SessionSummary[] {
  const byId = new Map<string, SessionSummary>();
  for (const session of sessions) {
    const known = byId.get(session.id);
    if (!known || session.updatedAt > known.updatedAt) byId.set(session.id, session);
  }
  return [...byId.values()];
}

export function forkRelations(items: SessionSummary[], sessionId?: string): ForkRelations {
  const sessions = freshest(items);
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const session = sessionId ? byId.get(sessionId) : undefined;
  const parent = session?.fork ? byId.get(session.fork.sessionId) : undefined;
  const forks = sessionId
    ? sessions
      .filter((candidate) => candidate.fork?.sessionId === sessionId && candidate.id !== sessionId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
    : [];
  return { ...(parent ? { parent } : {}), forks };
}

export function forkForest(sessions: SessionSummary[]): ForkNode[] {
  const unique = freshest(sessions);
  const byId = new Map(unique.map((session) => [session.id, session]));
  const children = new Map<string, SessionSummary[]>();
  for (const session of unique) {
    const parentId = session.fork?.sessionId;
    if (!parentId || parentId === session.id || !byId.has(parentId)) continue;
    const list = children.get(parentId) ?? [];
    list.push(session);
    children.set(parentId, list);
  }
  for (const list of children.values()) list.sort((left, right) => right.updatedAt - left.updatedAt);

  const recency = new Map<string, number>();
  const measure = (session: SessionSummary, path = new Set<string>()): number => {
    const cached = recency.get(session.id);
    if (cached !== undefined) return cached;
    if (path.has(session.id)) return session.updatedAt;
    path.add(session.id);
    const latest = (children.get(session.id) ?? [])
      .reduce((max, child) => Math.max(max, measure(child, path)), session.updatedAt);
    path.delete(session.id);
    recency.set(session.id, latest);
    return latest;
  };

  const parented = new Set([...children.values()].flat().map((session) => session.id));
  const roots = unique.filter((session) => !parented.has(session.id));
  const pending = [...roots].sort((left, right) => measure(right) - measure(left));
  const nodes: ForkNode[] = [];
  const seen = new Set<string>();
  const emit = (session: SessionSummary, depth: number, last: boolean, lanes: boolean[]): void => {
    if (seen.has(session.id)) return;
    seen.add(session.id);
    const kids = (children.get(session.id) ?? []).filter((child) => !seen.has(child.id));
    nodes.push({ session, depth, last, lanes, branches: (children.get(session.id) ?? []).length });
    const childLanes = depth === 0 ? [] : [...lanes, !last];
    kids.forEach((kid, index) => emit(kid, depth + 1, index === kids.length - 1, childLanes));
  };
  for (const root of pending) emit(root, 0, true, []);
  // A fork cycle has no natural root; surface its tasks instead of hiding them.
  while (seen.size < unique.length) {
    const next = unique
      .filter((session) => !seen.has(session.id))
      .sort((left, right) => measure(right) - measure(left))[0];
    if (!next) break;
    emit(next, 0, true, []);
  }
  return nodes;
}
