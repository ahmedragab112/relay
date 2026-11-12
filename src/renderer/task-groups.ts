import type { SessionSummary, Workspace } from '../shared/contracts';

export interface TaskGroup {
  id: string;
  name: string;
  path?: string;
  current: boolean;
  sessions: SessionSummary[];
}

const normalize = (path: string): string => path.length > 1 ? path.replace(/\/+$/, '') : path;

function latest(sessions: SessionSummary[]): SessionSummary[] {
  const byId = new Map<string, SessionSummary>();
  for (const session of sessions) {
    const known = byId.get(session.id);
    if (!known || session.updatedAt > known.updatedAt) byId.set(session.id, session);
  }
  return [...byId.values()];
}

export function groupTasks(sessions: SessionSummary[], workspaces: Workspace[], currentId?: string): TaskGroup[] {
  const byPath = new Map(workspaces.map((workspace) => [normalize(workspace.path), workspace]));
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const groups = new Map<string, TaskGroup>();
  const make = (id: string, name: string, path?: string): TaskGroup => {
    const group = { id, name, ...(path ? { path } : {}), current: id === currentId, sessions: [] };
    groups.set(id, group);
    return group;
  };
  for (const session of latest(sessions)) {
    if (!session.directory) { (groups.get('none') ?? make('none', 'No folder')).sessions.push(session); continue; }
    const workspace = byPath.get(normalize(session.directory));
    if (!workspace) continue;
    (groups.get(workspace.id) ?? make(workspace.id, workspace.name, workspace.path)).sessions.push(session);
  }
  const ordered: TaskGroup[] = [];
  const current = currentId ? byId.get(currentId) : undefined;
  if (current) ordered.push(groups.get(current.id) ?? make(current.id, current.name, current.path));
  ordered.push(...workspaces.filter((workspace) => workspace.id !== currentId)
    .sort((left, right) => right.lastOpened - left.lastOpened)
    .flatMap((workspace) => groups.get(workspace.id) ?? []));
  const loose = groups.get('none');
  if (loose) ordered.push(loose);
  for (const group of ordered) group.sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  return ordered;
}
