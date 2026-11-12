import type { AgentQuestion, AttentionOverview, AttentionPermission, AttentionQuestion, AttentionRequest, PermissionRequest, SessionSummary } from '../shared/contracts.js';
import { permissionSummary, questionSummary } from './attention-log.js';

export interface LocatedPermission {
  directory: string;
  request: PermissionRequest;
}

export interface LocatedQuestion {
  directory: string;
  request: AgentQuestion;
}

function folderLabel(session: SessionSummary | undefined, directory: string): string {
  const value = session ? session.directory : directory;
  if (!value) return 'No folder';
  return value.replace(/\/+$/, '').split('/').pop() || value;
}

function taskLabel(session: SessionSummary | undefined, sessionId: string): string {
  return session?.title ?? `Task ${sessionId.slice(0, 8)}`;
}

export function annotateAttention(permissions: LocatedPermission[], questions: LocatedQuestion[], sessions: SessionSummary[]): AttentionOverview {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const seen = new Set<string>();
  const approvals: AttentionPermission[] = [];
  for (const { directory, request } of permissions) {
    if (seen.has(request.id)) continue;
    seen.add(request.id);
    const session = byId.get(request.sessionId);
    approvals.push({ request, sessionId: request.sessionId, taskTitle: taskLabel(session, request.sessionId), folder: folderLabel(session, directory) });
  }
  const prompts: AttentionQuestion[] = [];
  for (const { directory, request } of questions) {
    if (seen.has(request.id)) continue;
    seen.add(request.id);
    const session = byId.get(request.sessionId);
    prompts.push({ request, sessionId: request.sessionId, taskTitle: taskLabel(session, request.sessionId), folder: folderLabel(session, directory) });
  }
  return { permissions: approvals, questions: prompts, history: [] };
}

export function attentionRequests(overview: AttentionOverview): AttentionRequest[] {
  return [
    ...overview.permissions.map((item) => ({
      id: item.request.id,
      kind: 'permission' as const,
      sessionId: item.sessionId,
      taskTitle: item.taskTitle,
      folder: item.folder,
      summary: permissionSummary(item.request),
      ...(item.request.detail ? { detail: item.request.detail } : {}),
    })),
    ...overview.questions.map((item) => ({
      id: item.request.id,
      kind: 'question' as const,
      sessionId: item.sessionId,
      taskTitle: item.taskTitle,
      folder: item.folder,
      summary: questionSummary(item.request),
    })),
  ];
}
