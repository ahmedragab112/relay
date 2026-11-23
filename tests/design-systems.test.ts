import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Designs, type DesignProject } from '../src/main/design.js';
import type { SendMessageInput } from '../src/shared/contracts.js';

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'relay-systems-'));
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
  return { path, designs, calls, done: () => rm(path, { recursive: true, force: true }) };
}

const barePage = '<html><head></head><body><h1>Landing</h1></body></html>';

async function landing(world: Awaited<ReturnType<typeof workspace>>): Promise<void> {
  await world.designs.create('Landing');
  await writeFile(join(world.path, '.relay/design/landing/index.html'), barePage);
}

test('library systems are stored with readable ids and update in place', async () => {
  const world = await workspace();
  try {
    const first = await world.designs.saveLibrarySystem({ name: 'Neon Night', colors: { primary: '#ff00aa' } });
    assert.deepEqual(first.systems.map((system) => system.id), ['neon-night']);
    assert.equal(first.systems[0].colors.primary, '#ff00aa');
    await world.designs.saveLibrarySystem({ name: 'Paper', colors: { primary: '#112233' } });
    const updated = await world.designs.saveLibrarySystem({ name: 'Neon Night', colors: { primary: '#00ffcc' } });
    assert.deepEqual(updated.systems.map((system) => system.id).sort(), ['neon-night', 'paper']);
    assert.equal(updated.systems.find((system) => system.id === 'neon-night')?.colors.primary, '#00ffcc');
    const stored = JSON.parse(await readFile(join(world.path, '.relay/design-systems.json'), 'utf8')) as { systems: unknown[] };
    assert.equal(stored.systems.length, 2);
  } finally { await world.done(); }
});

test('a design bound to a library system serves its tokens', async () => {
  const world = await workspace();
  try {
    await landing(world);
    await world.designs.saveLibrarySystem({ name: 'Neon Night', colors: { primary: '#ff00aa' } });
    const view = await world.designs.setDesignSystem('landing', 'neon-night');
    assert.equal(view.designs[0].systemId, 'neon-night');
    const page = await world.designs.preview('relay-design://preview/landing/index.html');
    assert.match(String(page?.body), /--ds-primary:#ff00aa/);
  } finally { await world.done(); }
});

test('unbound designs use the project system and unknown systems are refused', async () => {
  const world = await workspace();
  try {
    await landing(world);
    await world.designs.saveSystem({ name: 'Acme', colors: { primary: '#123456' } });
    const page = await world.designs.preview('relay-design://preview/landing/index.html');
    assert.match(String(page?.body), /--ds-primary:#123456/);
    await assert.rejects(world.designs.setDesignSystem('landing', 'missing'), /not|unknown|no longer/i);
  } finally { await world.done(); }
});

test('clearing the binding returns the design to the project system', async () => {
  const world = await workspace();
  try {
    await landing(world);
    await world.designs.saveLibrarySystem({ name: 'Neon Night', colors: { primary: '#ff00aa' } });
    await world.designs.setDesignSystem('landing', 'neon-night');
    const cleared = await world.designs.setDesignSystem('landing', '');
    assert.equal(cleared.designs[0].systemId, undefined);
    const page = await world.designs.preview('relay-design://preview/landing/index.html');
    assert.match(String(page?.body), /--ds-primary:#4f8cff/);
  } finally { await world.done(); }
});

test('deleting a library system unbinds designs that used it', async () => {
  const world = await workspace();
  try {
    await landing(world);
    await world.designs.saveLibrarySystem({ name: 'Neon Night', colors: { primary: '#ff00aa' } });
    await world.designs.setDesignSystem('landing', 'neon-night');
    const view = await world.designs.deleteLibrarySystem('neon-night');
    assert.deepEqual(view.systems, []);
    assert.equal(view.designs[0].systemId, undefined);
    const page = await world.designs.preview('relay-design://preview/landing/index.html');
    assert.match(String(page?.body), /--ds-primary:#4f8cff/);
  } finally { await world.done(); }
});

test('a design turn carries the bound system, not the project one', async () => {
  const world = await workspace();
  try {
    await landing(world);
    await world.designs.saveLibrarySystem({ name: 'Neon Night', notes: 'Hot pink accents', colors: { primary: '#ff00aa' } });
    await world.designs.setDesignSystem('landing', 'neon-night');
    await world.designs.send('landing', 'Make a pricing page');
    assert.match(world.calls[0].text, /--ds-primary:#ff00aa/);
    assert.match(world.calls[0].text, /Hot pink accents/);
  } finally { await world.done(); }
});
