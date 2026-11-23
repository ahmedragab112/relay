import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasMention, knowledgeMention, parseMentionToken, filterMentionables, type MentionSource } from '../src/renderer/mention.js';

test('parses an @token immediately before the caret', () => {
  assert.deepEqual(parseMentionToken('read @REA', 9), { query: 'REA', start: 5, end: 9 });
  assert.deepEqual(parseMentionToken('@', 1), { query: '', start: 0, end: 1 });
  assert.deepEqual(parseMentionToken('use @git-kit', 12), { query: 'git-kit', start: 4, end: 12 });
});

test('no token when the caret is not right after one', () => {
  assert.equal(parseMentionToken('read @REA now', 13), undefined, 'caret at the end after more text');
  assert.equal(parseMentionToken('read @REA now', 5), undefined, 'caret before the @');
  assert.equal(parseMentionToken('no mention here', 15), undefined);
  assert.equal(parseMentionToken('email me @', 6), undefined, 'caret not at the end of the token');
});

const sources: MentionSource[] = [
  { kind: 'file', id: '/p/README.md', name: 'README.md', path: '/p/README.md' },
  { kind: 'skill', id: 'review', name: 'Code review', detail: 'Review the tree' },
  { kind: 'plugin', id: 'git-suite', name: 'Git suite' },
  { kind: 'agent', id: 'planner', name: 'planner' },
  { kind: 'connector', id: 'GitHub', name: 'GitHub' },
];

test('filters mentionables by name across every kind', () => {
  assert.deepEqual(filterMentionables(sources, 'git').map(source => source.name), ['Git suite', 'GitHub']);
  assert.deepEqual(filterMentionables(sources, 'READ').map(source => source.name), ['README.md']);
});

test('an empty query keeps every source in order', () => {
  assert.deepEqual(filterMentionables(sources, '').map(source => source.kind),
    ['file', 'skill', 'plugin', 'agent', 'connector']);
});

test('filtering is case-insensitive on the name', () => {
  assert.deepEqual(filterMentionables(sources, 'CODE').map(source => source.name), ['Code review']);
});

test('@atlas offers the Atlas picker while the query matches', () => {
  assert.equal(atlasMention('atlas')?.kind, 'atlas');
  assert.equal(atlasMention('ATL')?.name, 'Atlas');
  assert.equal(atlasMention('re'), undefined, 'an unrelated query hides the Atlas row');
  assert.equal(atlasMention(''), undefined, 'a bare @ stops at files, skills, and tools');
});

test('@knowledge offers the library picker while the query matches', () => {
  assert.equal(knowledgeMention('knowledge')?.kind, 'knowledge');
  assert.equal(knowledgeMention('KNOW')?.name, 'Knowledge');
  assert.equal(knowledgeMention('know')?.name, 'Knowledge', 'prefixes match, like @atlas');
  assert.equal(knowledgeMention('re'), undefined);
  assert.equal(knowledgeMention(''), undefined);
});
