import type { ModelOption, SessionSummary } from '../shared/contracts';

export function nearBottom(metrics: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= 96;
}

export function chooseModel(models: ModelOption[], preferred: string): string {
  const available = models.filter(model => model.connected);
  return available.find(model => model.id === preferred)?.id ?? available[0]?.id ?? '';
}

export function isDirty(document: { content: string } | undefined, content: string): boolean {
  return document !== undefined && document.content !== content;
}

export function externalURL(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function parsePatch(patch: string): Array<{ kind: 'meta' | 'hunk' | 'added' | 'removed' | 'context'; text: string }> {
  return patch.split('\n').map(text => ({
    kind: text.startsWith('+++ ') || text.startsWith('--- ') || text.startsWith('diff ') || text.startsWith('index ')
      ? 'meta' : text.startsWith('@@') ? 'hunk' : text.startsWith('+') ? 'added' : text.startsWith('-') ? 'removed' : 'context',
    text,
  }));
}

export function shouldDismissAttention(previousSessionId: string, nextSessionId: string, userInitiated: boolean): boolean {
  return userInitiated || previousSessionId !== nextSessionId;
}

export function shouldBackgroundOnLeave(previous: Pick<SessionSummary, 'id' | 'status'> | undefined, nextId: string): string {
  return previous && previous.id !== nextId && previous.status === 'running' ? previous.id : '';
}

export interface ReloadState { running: boolean; queued: boolean }
export function reloadTransition(state: ReloadState, event: 'request' | 'start' | 'finish'): ReloadState {
  if (event === 'request') return { ...state, queued: true };
  if (event === 'finish') return { ...state, running: false };
  return state.running || !state.queued ? state : { running: true, queued: false };
}
