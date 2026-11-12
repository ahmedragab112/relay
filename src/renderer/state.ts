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

// The composer steps aside while the agent waits on an approval or an answer, so the
// request owns the space where the typing field was. "Type anyway" reveals it for the
// current set of requests only.
export function shouldHideComposer(pendingRequests: number, revealed: boolean): boolean {
  return pendingRequests > 0 && !revealed;
}

// Order-independent key for the requests on screen, so a new request re-hides the composer
// while a re-render of the same requests leaves a manual reveal alone.
export function requestSignature(keys: string[]): string {
  return [...keys].sort().join('\u001f');
}

export type InspectorTab = 'activity' | 'changes' | 'files' | 'browser';

// While the agent works the inspector follows it: the tool log when a turn starts, the
// changed files when it edits, and the page it opened when it browses. Choosing a tab
// yourself hands control back for the rest of that turn, so the view never moves under you.
export function followTab(signal: 'turn-start' | 'edit' | 'page', userSelectedTab: boolean): InspectorTab | undefined {
  if (signal === 'page') return 'browser';
  if (userSelectedTab) return undefined;
  return signal === 'edit' ? 'changes' : 'activity';
}

export function imageSrc(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return trimmed;
  return externalURL(trimmed);
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
