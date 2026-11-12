import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentQuestion, AttentionHistoryEntry, AttentionOutcome, AttentionRequest, PermissionRequest } from '../shared/contracts.js';

export const MAX_HISTORY = 100;

interface PendingAttention {
  request: AttentionRequest;
  askedAt: number;
}

export interface AttentionLogState {
  pending: Record<string, PendingAttention>;
  history: AttentionHistoryEntry[];
}

export function emptyLog(): AttentionLogState {
  return { pending: {}, history: [] };
}

function cap(history: AttentionHistoryEntry[]): AttentionHistoryEntry[] {
  return history.slice(0, MAX_HISTORY);
}

export function noticeRequests(state: AttentionLogState, requests: AttentionRequest[], now: number): AttentionLogState {
  const pending: Record<string, PendingAttention> = {};
  const live = new Set<string>();
  for (const request of requests) {
    if (live.has(request.id)) continue;
    live.add(request.id);
    pending[request.id] = { request, askedAt: state.pending[request.id]?.askedAt ?? now };
  }
  const expired = Object.entries(state.pending)
    .filter(([id]) => !live.has(id))
    .map(([id, item]) => ({ ...item.request, askedAt: item.askedAt, resolvedAt: now, outcome: 'expired' as const }));
  const unchanged = expired.length === 0 && JSON.stringify(pending) === JSON.stringify(state.pending);
  if (unchanged) return state;
  return { pending, history: cap([...expired, ...state.history]) };
}

export function resolveRequest(
  state: AttentionLogState,
  id: string,
  outcome: AttentionOutcome,
  now: number,
  answer?: string,
  fallback?: AttentionRequest,
): AttentionLogState {
  const item = state.pending[id];
  const source = item?.request ?? fallback;
  if (!source) return state;
  const pending = { ...state.pending };
  delete pending[id];
  const entry: AttentionHistoryEntry = {
    ...source,
    askedAt: item?.askedAt ?? now,
    resolvedAt: now,
    outcome,
    ...(answer === undefined ? {} : { answer }),
  };
  return { pending, history: cap([entry, ...state.history]) };
}

function shorten(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export function permissionSummary(request: PermissionRequest): string {
  const target = request.patterns.filter(Boolean).join(', ');
  return target ? `${request.permission} · ${shorten(target, 120)}` : request.permission;
}

export function questionSummary(request: AgentQuestion): string {
  const first = request.questions[0];
  return shorten(first ? first.question || first.header : 'Question', 140);
}

function sanitize(value: unknown): AttentionLogState {
  if (!value || typeof value !== 'object') return emptyLog();
  const candidate = value as { pending?: unknown; history?: unknown };
  const pending: Record<string, PendingAttention> = {};
  if (candidate.pending && typeof candidate.pending === 'object') {
    for (const [id, item] of Object.entries(candidate.pending as Record<string, PendingAttention>)) {
      if (!item || typeof item !== 'object' || !item.request || typeof item.request.id !== 'string') continue;
      pending[id] = { request: item.request, askedAt: Number(item.askedAt) || 0 };
    }
  }
  const history = Array.isArray(candidate.history)
    ? (candidate.history as AttentionHistoryEntry[]).filter((entry) => entry && typeof entry.id === 'string' && typeof entry.resolvedAt === 'number').slice(0, MAX_HISTORY)
    : [];
  return { pending, history };
}

export class AttentionLog {
  private cached?: Promise<AttentionLogState>;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async history(): Promise<AttentionHistoryEntry[]> {
    return (await this.load()).history;
  }

  async notice(requests: AttentionRequest[], now = Date.now()): Promise<void> {
    await this.mutate((state) => noticeRequests(state, requests, now));
  }

  async resolve(id: string, outcome: AttentionOutcome, now = Date.now(), options: { answer?: string; request?: AttentionRequest } = {}): Promise<void> {
    await this.mutate((state) => resolveRequest(state, id, outcome, now, options.answer, options.request));
  }

  private load(): Promise<AttentionLogState> {
    this.cached ??= readFile(this.file, 'utf8')
      .then((text) => sanitize(JSON.parse(text)))
      .catch(() => emptyLog());
    return this.cached;
  }

  private mutate(change: (state: AttentionLogState) => AttentionLogState): Promise<void> {
    const run = async () => {
      const current = await this.load();
      const next = change(current);
      if (next === current) return;
      this.cached = Promise.resolve(next);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = `${this.file}.tmp`;
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, this.file);
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}
