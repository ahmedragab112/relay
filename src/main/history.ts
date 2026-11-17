import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ChatMessage, SessionSummary } from '../shared/contracts.js';
import { historyEntry, searchHistory, type HistoryEntry, type HistoryHit } from '../shared/history.js';

export interface HistorySource {
  listAllSessions(): Promise<SessionSummary[]>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
}

const WORKERS = 3;

export class HistoryIndex {
  private entries = new Map<string, HistoryEntry>();
  private working: Promise<void> | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly source: () => HistorySource | undefined) {}

  get size(): number {
    return this.entries.size;
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          if (entry && typeof entry === 'object' && typeof (entry as HistoryEntry).sessionId === 'string' && typeof (entry as HistoryEntry).title === 'string' && Array.isArray((entry as HistoryEntry).messages)) {
            this.entries.set((entry as HistoryEntry).sessionId, entry as HistoryEntry);
          }
        }
      }
    } catch { /* the first run has no index yet */ }
  }

  search(query: string, limit = 30): HistoryHit[] {
    return searchHistory([...this.entries.values()], query, limit);
  }

  refresh(): Promise<void> {
    if (this.working) return this.working;
    this.working = this.reconcile().finally(() => { this.working = undefined; });
    return this.working;
  }

  async refreshSession(sessionId: string): Promise<void> {
    const source = this.source();
    if (!source) return;
    try {
      const session = (await source.listAllSessions()).find((item) => item.id === sessionId);
      if (!session) {
        if (this.entries.delete(sessionId)) await this.persist();
        return;
      }
      if (this.entries.get(sessionId)?.updatedAt === session.updatedAt) return;
      const messages = await source.getMessages(sessionId);
      this.entries.set(sessionId, historyEntry(session, messages));
      await this.persist();
    } catch { /* a running engine may refuse a snapshot; the next event retries */ }
  }

  private async reconcile(): Promise<void> {
    const source = this.source();
    if (!source) return;
    try {
      const sessions = await source.listAllSessions();
      const known = new Set(sessions.map((session) => session.id));
      for (const id of [...this.entries.keys()]) if (!known.has(id)) this.entries.delete(id);
      const pending = sessions.filter((session) => this.entries.get(session.id)?.updatedAt !== session.updatedAt);
      let next = 0;
      const workers = Array.from({ length: Math.min(WORKERS, pending.length) }, async () => {
        while (next < pending.length) {
          const session = pending[next++];
          try {
            const messages = await source.getMessages(session.id);
            this.entries.set(session.id, historyEntry(session, messages));
          } catch { /* skip a session the engine cannot read right now */ }
        }
      });
      await Promise.all(workers);
      await this.persist();
    } catch { /* offline engine: keep the previous index */ }
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify([...this.entries.values()]);
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, this.file);
    }).catch(() => { /* a failed write only costs freshness */ });
    return this.writing;
  }
}
