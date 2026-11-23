import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Designs, type DesignProject } from '../src/main/design.js';

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'relay-export-'));
  const project: DesignProject = { id: 'p1', name: 'Shop', path };
  const designs = new Designs({
    project: () => project,
    engine: () => ({
      createSession: async () => ({ id: 'session' }),
      sendMessage: async () => undefined,
      abortSession: async () => undefined,
      deleteSession: async () => undefined,
    }),
    model: () => ({ model: 'test/model', auto: false }),
    previewBase: async () => 'http://127.0.0.1:4321/',
    access: () => 'full',
    emit: () => undefined,
    sessionsChanged: () => undefined,
    show: () => undefined,
  });
  await designs.create('Landing');
  return { path, designs, done: () => rm(path, { recursive: true, force: true }) };
}

test('exporting copies pages and assets but not versions or notes', async () => {
  const world = await workspace();
  try {
    await world.designs.addComment('landing', { page: 'index.html', selector: '', note: 'Hi' });
    await writeFile(join(world.path, '.relay/design/landing/styles.css'), 'body{color:red}');
    await writeFile(join(world.path, '.relay/design/landing/about.html'), '<h1>About</h1>');
    const target = join(world.path, 'exported');
    await world.designs.exportFolder('landing', target);
    const files = (await readdir(target)).sort();
    assert.deepEqual(files, ['about.html', 'index.html', 'styles.css']);
    assert.match(await readFile(join(target, 'index.html'), 'utf8'), /Landing/);
  } finally { await world.done(); }
});

test('the export preview URL names the page behind the loopback base', async () => {
  const world = await workspace();
  try {
    assert.equal(await world.designs.previewURL('landing'), 'http://127.0.0.1:4321/landing/index.html');
    assert.equal(await world.designs.previewURL('landing', 'about.html'), 'http://127.0.0.1:4321/landing/about.html');
  } finally { await world.done(); }
});
