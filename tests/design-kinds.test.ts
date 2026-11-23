import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Designs, type DesignProject } from '../src/main/design.js';
import type { SendMessageInput } from '../src/shared/contracts.js';

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'relay-kinds-'));
  const project: DesignProject = { id: 'p1', name: 'Shop', path };
  const calls: SendMessageInput[] = [];
  const deps = () => ({
    project: () => project,
    engine: () => ({
      createSession: async () => ({ id: 'session' }),
      sendMessage: async (input: SendMessageInput) => { calls.push(input); },
      abortSession: async () => undefined,
      deleteSession: async () => undefined,
    }),
    model: () => ({ model: 'test/model', auto: false }),
    access: () => 'full' as const,
    emit: () => undefined,
    sessionsChanged: () => undefined,
    show: () => undefined,
  });
  return { path, calls, designs: new Designs(deps()), reopen: () => new Designs(deps()), done: () => rm(path, { recursive: true, force: true }) };
}

test('a slides design starts as a deck and its turns ask for slides', async () => {
  const world = await workspace();
  try {
    const view = await world.designs.create('Q4 Deck', 'slides');
    assert.equal(view.designs[0].kind, 'slides');
    const html = await readFile(join(world.path, '.relay/design/q4-deck/index.html'), 'utf8');
    assert.match(html, /class="slide"/);
    assert.match(html, /scroll-snap-type:y mandatory/);
    assert.match(html, /ArrowDown/);
    await world.designs.send('q4-deck', 'Make the deck');
    assert.match(world.calls[0].text, /Format: slide deck/);
  } finally { await world.done(); }
});

test('a whiteboard design starts as a pannable board', async () => {
  const world = await workspace();
  try {
    const view = await world.designs.create('Ideas', 'board');
    assert.equal(view.designs[0].kind, 'board');
    const html = await readFile(join(world.path, '.relay/design/ideas/index.html'), 'utf8');
    assert.match(html, /id="board"/);
    assert.match(html, /data-zoom/);
    await world.designs.send('ideas', 'Sketch the flow');
    assert.match(world.calls[0].text, /Format: whiteboard/);
  } finally { await world.done(); }
});

test('a plain page keeps page guidance and no kind', async () => {
  const world = await workspace();
  try {
    const view = await world.designs.create('Landing');
    assert.equal(view.designs[0].kind, undefined);
    await world.designs.send('landing', 'A hero');
    assert.match(world.calls[0].text, /Create the page from scratch/);
    assert.doesNotMatch(world.calls[0].text, /Format: slide deck|Format: whiteboard/);
  } finally { await world.done(); }
});

test('the kind survives a restart', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Q4 Deck', 'slides');
    const view = await world.reopen().view();
    assert.equal(view.designs[0].kind, 'slides');
  } finally { await world.done(); }
});
