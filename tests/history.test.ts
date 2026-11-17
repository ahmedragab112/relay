import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage, SessionSummary } from '../src/shared/contracts.js';
import { historyEntry, historySnippet, searchHistory, type HistoryEntry } from '../src/shared/history.js';

const session = (id: string, title: string, updatedAt: number, directory?: string): SessionSummary => ({ id, title, updatedAt, status: 'idle', directory });

const say = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({
  id,
  role,
  createdAt: 1,
  parts: [{ type: 'text', id: `${id}-p`, text }],
});

test('history entries index text from user and assistant messages only', () => {
  const messages: ChatMessage[] = [
    say('m1', 'user', 'Rename the upload helper'),
    { id: 'm2', role: 'assistant', createdAt: 2, parts: [{ type: 'reasoning', id: 'r', text: 'thinking hard' }, { type: 'text', id: 't', text: 'Done, the helper now streams.' }] },
    { id: 'm3', role: 'assistant', createdAt: 3, parts: [{ type: 'tool', id: 'x', tool: 'bash', status: 'completed', title: 'ls' }] },
    { id: 'm4', role: 'system', createdAt: 4, parts: [{ type: 'compaction', id: 'c', summary: 'compacted' }] },
  ] as ChatMessage[];
  const entry = historyEntry(session('s1', 'Upload work', 50, '/tmp/app'), messages);
  assert.equal(entry.sessionId, 's1');
  assert.equal(entry.title, 'Upload work');
  assert.equal(entry.directory, '/tmp/app');
  assert.deepEqual(entry.messages, [
    { id: 'm1', role: 'user', text: 'Rename the upload helper' },
    { id: 'm2', role: 'assistant', text: 'Done, the helper now streams.' },
  ]);
});

test('history entries collapse whitespace and cap very long messages', () => {
  const entry = historyEntry(session('s1', 'Long', 1), [say('m1', 'assistant', `a ${'b'.repeat(6000)}`)] as ChatMessage[]);
  assert.ok(entry.messages[0].text.length <= 4000);
  assert.ok(!entry.messages[0].text.includes('\n'));
});

test('snippets stay short and keep the matched term visible', () => {
  const text = `${'x'.repeat(300)} needle ${'y'.repeat(300)}`;
  const snippet = historySnippet(text, 'needle');
  assert.ok(snippet.includes('needle'));
  assert.ok(snippet.length < 160);
  assert.ok(snippet.startsWith('…'));
  assert.ok(snippet.endsWith('…'));
});

test('search matches case-insensitively and reports the session, role, and snippet', () => {
  const entries: HistoryEntry[] = [
    { sessionId: 's1', title: 'Refactor uploads', updatedAt: 10, messages: [{ id: 'm1', role: 'assistant', text: 'The UPLOAD path is now streamed.' }] },
  ];
  const hits = searchHistory(entries, 'upload');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sessionId, 's1');
  assert.equal(hits[0].messageId, 'm1');
  assert.equal(hits[0].role, 'assistant');
  assert.match(hits[0].snippet, /UPLOAD/);
});

test('a title match alone still produces a hit', () => {
  const entries: HistoryEntry[] = [{ sessionId: 's1', title: 'Database migration', updatedAt: 10, messages: [] }];
  const hits = searchHistory(entries, 'migration');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].messageId, undefined);
  assert.equal(hits[0].snippet, 'Database migration');
});

test('title matches rank above body matches, then recency decides', () => {
  const entries: HistoryEntry[] = [
    { sessionId: 'body-new', title: 'Unrelated', updatedAt: 30, messages: [{ id: 'm', role: 'user', text: 'mentions cache here' }] },
    { sessionId: 'title-old', title: 'Cache warmup', updatedAt: 10, messages: [] },
    { sessionId: 'body-old', title: 'Unrelated', updatedAt: 5, messages: [{ id: 'm', role: 'user', text: 'cache again' }] },
  ];
  const hits = searchHistory(entries, 'cache');
  assert.deepEqual(hits.map((hit) => hit.sessionId), ['title-old', 'body-new', 'body-old']);
});

test('blank queries return nothing and the limit is respected', () => {
  const entries: HistoryEntry[] = [{ sessionId: 's1', title: 'One', updatedAt: 1, messages: [{ id: 'm', role: 'user', text: 'alpha' }] }];
  assert.deepEqual(searchHistory(entries, '   '), []);
  const many: HistoryEntry[] = Array.from({ length: 40 }, (_, index) => ({ sessionId: `s${index}`, title: `Task ${index}`, updatedAt: index, messages: [{ id: 'm', role: 'user', text: 'alpha' }] }));
  assert.equal(searchHistory(many, 'alpha', 12).length, 12);
});
