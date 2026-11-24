import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeStore } from '../src/main/knowledge.js';
import { loadKnowledgeIndex } from '../src/main/knowledge-index.js';
import {
  formatKnowledgeIndex, htmlTitle, htmlToText, KNOWLEDGE_INDEX_LIMIT, knowledgeExcerpt, knowledgeMeta,
  parseKnowledgeLibrary, searchKnowledge, type KnowledgeSource,
} from '../src/shared/knowledge.js';

async function library(deps: { fetch?: typeof fetch; now?: () => number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'relay-knowledge-'));
  let clock = 1_700_000_000_000;
  const store = new KnowledgeStore(directory, {
    now: deps.now ?? (() => ++clock),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  return { directory, store, done: () => rm(directory, { recursive: true, force: true }) };
}

const source = (over: Partial<KnowledgeSource> = {}): KnowledgeSource => ({
  id: 'a', title: 'Build notes', kind: 'note', text: 'Use pnpm.\n\nDeploy from CI.', createdAt: 1, updatedAt: 2, ...over,
});

test('htmlToText keeps paragraphs and list items, drops scripts and markup', () => {
  const text = htmlToText('<style>.a{}</style><h1>Title &amp; more</h1><p>First   para</p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul>');
  assert.equal(text, 'Title & more\nFirst para\n\n- One\n- Two');
});

test('htmlTitle reads and decodes the title tag', () => {
  assert.equal(htmlTitle('<html><head><title> Docs &mdash; Relay </title></head></html>'), 'Docs — Relay');
  assert.equal(htmlTitle('<html><body>none</body></html>'), undefined);
});

test('parseKnowledgeLibrary drops broken entries and junk instead of throwing', () => {
  assert.deepEqual(parseKnowledgeLibrary('not json'), []);
  assert.deepEqual(parseKnowledgeLibrary('{"sources":[{"id":"","title":"x","kind":"note","text":"t"}]}'), []);
  const parsed = parseKnowledgeLibrary(JSON.stringify({
    version: 1,
    sources: [
      { id: 'a', title: 'Keep', kind: 'note', text: 'body', createdAt: 5, updatedAt: 6 },
      { id: 'a', title: 'Duplicate id', kind: 'note', text: 'body' },
      { id: 'b', title: 'Bad kind', kind: 'pdf', text: 'body' },
      { id: 'c', title: 'Empty', kind: 'note', text: '   ' },
      { id: 'd', title: 'Link', kind: 'link', origin: 'https://x.test', text: 'page', createdAt: 3 },
    ],
  }));
  assert.deepEqual(parsed.map(entry => entry.id), ['a', 'd']);
  assert.equal(parsed[1].updatedAt, 3);
});

test('formatKnowledgeIndex is empty without sources and lists titles with origin', () => {
  assert.equal(formatKnowledgeIndex([], '/tmp/k'), '');
  const index = formatKnowledgeIndex([
    source(),
    source({ id: 'b', kind: 'link', origin: 'https://x.test/docs', title: 'API docs', text: 'Endpoints live here.' }),
  ], '/tmp/k');
  assert.match(index, /Build notes \[note\]/);
  assert.match(index, /API docs \[link · https:\/\/x\.test\/docs\] — Endpoints live here\./);
  assert.match(index, /@knowledge/);
  assert.ok(formatKnowledgeIndex(Array.from({ length: 200 }, (_, i) => source({ id: `s${i}`, title: `T${i}`, text: 'x'.repeat(500) })), '/tmp/k').length <= KNOWLEDGE_INDEX_LIMIT + 200);
});

test('knowledgeExcerpt and knowledgeMeta flatten and cut text', () => {
  assert.equal(knowledgeExcerpt('a\n\nb   c'), 'a b c');
  assert.equal(knowledgeExcerpt('x'.repeat(200), 10), 'xxxxxxxxx…');
  const meta = knowledgeMeta(source({ text: 'hello world' }));
  assert.equal(meta.size, 11);
  assert.equal(meta.excerpt, 'hello world');
  assert.equal('origin' in meta, false);
});

test('notes take the first line as title unless given one, and survive a reopen', async () => {
  const { directory, store, done } = await library();
  try {
    await store.addNote(undefined, 'Deploy steps\n\n1. Build\n2. Ship');
    await store.addNote('Release process', 'Second note body');
    const list = await store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].title, 'Release process', 'newest first');
    assert.equal(list[1].title, 'Deploy steps');
    assert.equal(await store.read(list[1].id), 'Deploy steps\n\n1. Build\n2. Ship');

    store.forget();
    const reopened = new KnowledgeStore(directory);
    assert.equal((await reopened.list()).length, 2);
  } finally { await done(); }
});

test('an empty note is refused', async () => {
  const { store, done } = await library();
  try {
    await assert.rejects(() => store.addNote('T', '   \n  '), /Write something/);
  } finally { await done(); }
});

test('files are copied, listed, refreshed in place, and refused when binary or a folder', async () => {
  const { directory, store, done } = await library();
  try {
    const text = join(directory, 'brief.md');
    await writeFile(text, '# Brief\n\nShip it.');
    const first = await store.addFiles([text]);
    assert.equal(first.added, 1);
    const [entry] = await store.list();
    assert.equal(entry.title, 'brief');
    assert.equal(entry.kind, 'file');
    assert.equal(entry.origin, text);
    const copies = await readdir(join(directory, 'files'));
    assert.equal(copies.length, 1);
    assert.match(copies[0], /^[0-9a-f-]+-brief\.md$/);

    await writeFile(text, '# Brief\n\nShip it today.');
    const refresh = await store.addFiles([text]);
    assert.equal(refresh.added, 1);
    const listed = await store.list();
    assert.equal(listed.length, 1);
    assert.match(await store.read(entry.id), /today/);

    const binary = join(directory, 'scan.pdf');
    await writeFile(binary, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]));
    const folder = join(directory, 'nested');
    await mkdir(folder);
    const refused = await store.addFiles([binary, folder]);
    assert.equal(refused.added, 0);
    assert.equal(refused.skipped.length, 2);
    assert.match(refused.skipped[0], /binary file/);
    assert.match(refused.skipped[1], /Folders cannot be added/);

    await store.remove(entry.id);
    assert.deepEqual(await store.list(), []);
    assert.deepEqual(await readdir(join(directory, 'files')), []);
  } finally { await done(); }
});

test('links save readable text, refresh the same URL, and refuse hostile input', async () => {
  const page = '<html><head><title>Relay docs</title></head><body><p>Install with npm.</p><script>x()</script></body></html>';
  const { store, done } = await library({
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://missing.test')) return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
      if (url.startsWith('https://image.test')) return new Response('png', { status: 200, headers: { 'content-type': 'image/png' } });
      return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch,
  });
  try {
    await store.addLink('https://docs.test/guide');
    const [entry] = await store.list();
    assert.equal(entry.title, 'Relay docs');
    assert.equal(entry.kind, 'link');
    assert.equal(entry.origin, 'https://docs.test/guide');
    assert.equal(await store.read(entry.id), 'Install with npm.');

    await store.addLink('https://docs.test/guide');
    assert.equal((await store.list()).length, 1, 'same URL refreshes in place');

    await assert.rejects(() => store.addLink('ftp://docs.test'), /http and https/);
    await assert.rejects(() => store.addLink('not a url'), /full link/);
    await assert.rejects(() => store.addLink('https://missing.test/x'), /HTTP 404/);
    await assert.rejects(() => store.addLink('https://image.test/logo.png'), /not a page/);
  } finally { await done(); }
});

test('searchKnowledge ranks titles over bodies, keeps one hit per source, and cuts a snippet around the match', () => {
  const hits = searchKnowledge([
    source({ id: 'body', title: 'Unrelated', text: 'The cache is warm.', updatedAt: 30 }),
    source({ id: 'title', title: 'Cache notes', text: 'Nothing here.', updatedAt: 10 }),
    source({ id: 'none', title: 'Other', text: 'Unrelated.' }),
  ], 'cache');
  assert.deepEqual(hits.map((hit) => hit.id), ['title', 'body']);
  assert.equal(hits[0].snippet, 'Cache notes');
  assert.equal(hits[1].snippet, 'The cache is warm.');
  assert.equal(hits[0].score, 2);
  assert.equal(hits[1].score, 1);
});

test('searchKnowledge is blank-safe and respects the limit', () => {
  assert.deepEqual(searchKnowledge([source()], '   '), []);
  const many = Array.from({ length: 40 }, (_, index) => source({ id: `s${index}`, title: `Note ${index}`, text: 'alpha', updatedAt: index }));
  assert.equal(searchKnowledge(many, 'alpha', 12).length, 12);
});

test('the store searches saved sources without leaving memory', async () => {
  const { store, done } = await library();
  try {
    await store.addNote('Deploy runbook', 'Restart the engine before shipping.');
    await store.addNote('Design tokens', 'Colors live in theme.css.');
    const hits = await store.search('engine');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, 'Deploy runbook');
    assert.match(hits[0].snippet, /Restart the engine/);
    assert.deepEqual(await store.search('  '), []);
  } finally { await done(); }
});

test('loadKnowledgeIndex reads the library and returns undefined when empty', async () => {
  const { directory, store, done } = await library();
  try {
    assert.equal(await loadKnowledgeIndex(directory), undefined);
    await store.addNote('Runbook', 'Restart the engine first.');
    const index = await loadKnowledgeIndex(directory);
    assert.ok(index);
    assert.match(index, /Runbook \[note\]/);
    assert.match(index, new RegExp(`stored in ${directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/library.json`));
    assert.equal(await readFile(join(directory, 'library.json'), 'utf8').then(text => JSON.parse(text).sources.length), 1);
  } finally { await done(); }
});
