import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Designs, type DesignProject } from '../src/main/design.js';
import type { SendMessageInput } from '../src/shared/contracts.js';

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'relay-comments-'));
  const project: DesignProject = { id: 'p1', name: 'Shop', path };
  const calls: SendMessageInput[] = [];
  const designs = new Designs({
    project: () => project,
    engine: () => ({
      createSession: async () => ({ id: 'session' }),
      sendMessage: async (input) => { calls.push(input); },
      abortSession: async () => undefined,
      deleteSession: async () => undefined,
    }),
    model: () => ({ model: 'test/model', auto: false }),
    access: () => 'full',
    emit: () => undefined,
    sessionsChanged: () => undefined,
    show: () => undefined,
  });
  await designs.create('Landing');
  await writeFile(join(path, '.relay/design/landing/index.html'), '<html><head></head><body><h1>Landing</h1></body></html>');
  return { path, designs, calls, done: () => rm(path, { recursive: true, force: true }) };
}

test('a comment is stored with its page and survives a reload', async () => {
  const world = await workspace();
  try {
    const comments = await world.designs.addComment('landing', {
      page: 'index.html', selector: 'body > h1', note: 'Make the heading warmer.',
    });
    assert.equal(comments.length, 1);
    assert.equal(comments[0].note, 'Make the heading warmer.');
    assert.equal(comments[0].selector, 'body > h1');
    assert.equal(comments[0].status, 'open');
    assert.ok(comments[0].id);
    const stored = JSON.parse(await readFile(join(world.path, '.relay/design/landing/comments.json'), 'utf8')) as { comments: unknown[] };
    assert.equal(stored.comments.length, 1);
    const reloaded = await world.designs.comments('landing');
    assert.equal(reloaded[0].note, 'Make the heading warmer.');
  } finally { await world.done(); }
});

test('a comment needs a note and a page in the design', async () => {
  const world = await workspace();
  try {
    await assert.rejects(world.designs.addComment('landing', { page: 'index.html', selector: '', note: '  ' }), /note/i);
    await assert.rejects(world.designs.addComment('landing', { page: 'missing.html', selector: '', note: 'Hi' }), /page/i);
    assert.deepEqual(await world.designs.comments('landing'), []);
  } finally { await world.done(); }
});

test('resolving removes a comment', async () => {
  const world = await workspace();
  try {
    const [comment] = await world.designs.addComment('landing', { page: 'index.html', selector: 'h1', note: 'Bigger.' });
    await world.designs.resolveComment('landing', comment.id);
    assert.deepEqual(await world.designs.comments('landing'), []);
    await assert.rejects(world.designs.resolveComment('landing', comment.id), /no longer/i);
  } finally { await world.done(); }
});

test('sending comments packs them into one design turn and marks them sent', async () => {
  const world = await workspace();
  try {
    await world.designs.addComment('landing', { page: 'index.html', selector: 'body > h1', note: 'Make the heading warmer.' });
    await world.designs.addComment('landing', { page: 'index.html', selector: 'main > p', note: 'Tighten the paragraph.' });
    const result = await world.designs.sendComments('landing');
    assert.equal(result.sessionId, 'session');
    assert.equal(world.calls.length, 1);
    assert.match(world.calls[0].text, /Make the heading warmer\./);
    assert.match(world.calls[0].text, /Tighten the paragraph\./);
    assert.match(world.calls[0].text, /body > h1/);
    const comments = await world.designs.comments('landing');
    assert.deepEqual(comments.map((comment) => comment.status), ['sent', 'sent']);
  } finally { await world.done(); }
});

test('only open comments are sent', async () => {
  const world = await workspace();
  try {
    await world.designs.addComment('landing', { page: 'index.html', selector: '', note: 'First pass.' });
    await world.designs.sendComments('landing');
    const [comment] = await world.designs.addComment('landing', { page: 'index.html', selector: '', note: 'Second pass.' });
    await world.designs.sendComments('landing');
    assert.equal(world.calls.length, 2);
    assert.doesNotMatch(world.calls[1].text, /First pass\./);
    assert.match(world.calls[1].text, /Second pass\./);
    assert.equal((await world.designs.comments('landing')).find((entry) => entry.id === comment.id)?.status, 'sent');
    await assert.rejects(world.designs.sendComments('landing'), /No open comments/i);
  } finally { await world.done(); }
});
