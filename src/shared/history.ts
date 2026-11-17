import type { ChatMessage, SessionSummary } from './contracts.js';

export interface HistoryMessage {
  id: string;
  role: ChatMessage['role'];
  text: string;
}

export interface HistoryEntry {
  sessionId: string;
  title: string;
  directory?: string;
  updatedAt: number;
  messages: HistoryMessage[];
}

export interface HistoryHit {
  sessionId: string;
  title: string;
  directory?: string;
  messageId?: string;
  role?: ChatMessage['role'];
  snippet: string;
  updatedAt: number;
}

const TEXT_LIMIT = 4000;

export const cleanHistoryText = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function historyEntry(session: SessionSummary, messages: ChatMessage[]): HistoryEntry {
  const indexed: HistoryMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const text = cleanHistoryText(message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join(' ')).slice(0, TEXT_LIMIT);
    if (text) indexed.push({ id: message.id, role: message.role, text });
  }
  return {
    sessionId: session.id,
    title: cleanHistoryText(session.title),
    ...(session.directory ? { directory: session.directory } : {}),
    updatedAt: session.updatedAt,
    messages: indexed,
  };
}

export function historySnippet(text: string, query: string): string {
  const source = cleanHistoryText(text);
  const needle = query.trim().toLowerCase();
  const index = needle ? source.toLowerCase().indexOf(needle) : -1;
  if (index < 0) return source.length > 140 ? `${source.slice(0, 140)}…` : source;
  const start = Math.max(0, index - 60);
  const end = Math.min(source.length, index + needle.length + 80);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

export function searchHistory(entries: HistoryEntry[], query: string, limit = 30): HistoryHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<{ score: number; hit: HistoryHit }> = [];
  for (const entry of entries) {
    const titleMatch = entry.title.toLowerCase().includes(needle);
    let bodyMatch = false;
    for (const message of entry.messages) {
      if (!message.text.toLowerCase().includes(needle)) continue;
      bodyMatch = true;
      scored.push({
        score: titleMatch ? 3 : 1,
        hit: {
          sessionId: entry.sessionId,
          title: entry.title,
          ...(entry.directory ? { directory: entry.directory } : {}),
          messageId: message.id,
          role: message.role,
          snippet: historySnippet(message.text, needle),
          updatedAt: entry.updatedAt,
        },
      });
    }
    if (titleMatch && !bodyMatch) {
      scored.push({
        score: 2,
        hit: {
          sessionId: entry.sessionId,
          title: entry.title,
          ...(entry.directory ? { directory: entry.directory } : {}),
          snippet: entry.title,
          updatedAt: entry.updatedAt,
        },
      });
    }
  }
  return scored
    .sort((left, right) => right.score - left.score || right.hit.updatedAt - left.hit.updatedAt)
    .slice(0, limit)
    .map((entry) => entry.hit);
}
