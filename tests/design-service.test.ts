import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Designs, designSessionIds, injectDesignSystem, type DesignProject } from '../src/main/design.js';
import { injectPreviewRuntime, normalizeDesignSystem } from '../src/shared/design.js';
import type { SendMessageInput } from '../src/shared/contracts.js';

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'relay-design-'));
  const project: DesignProject = { id: 'p1', name: 'Shop', path };
  const calls: SendMessageInput[] = [];
  const sessions: string[] = [];
  const shown: string[] = [];
  const deleted: string[] = [];
  const designs = new Designs({
    project: () => project,
    engine: () => ({
      createSession: async (title) => { const id = `s${sessions.length + 1}`; sessions.push(title); return { id }; },
      sendMessage: async (input) => { calls.push(input); },
      abortSession: async () => undefined,
      deleteSession: async (id) => { deleted.push(id); },
    }),
    model: () => ({ model: 'test/model', auto: false }),
    access: () => 'ask',
    emit: () => undefined,
    sessionsChanged: () => undefined,
    show: (id) => shown.push(id),
  });
  return { path, project, designs, calls, sessions, shown, deleted, done: () => rm(path, { recursive: true, force: true }) };
}

test('a new design starts with a token-styled page, version 1 and its own visible task', async () => {
  const world = await workspace();
  try {
    const view = await world.designs.create('Checkout Flow');
    assert.equal(view.designs.length, 1);
    assert.equal(view.designs[0].slug, 'checkout-flow');
    assert.equal(view.designs[0].title, 'Checkout flow');
    assert.equal(view.designs[0].versions, 1);
    assert.equal(view.designs[0].sessionId, 's1');
    assert.deepEqual(world.sessions, ['Design · Checkout flow']);
    const html = await readFile(join(world.path, '.relay/design/checkout-flow/index.html'), 'utf8');
    assert.ok(html.includes('--ds-background:#0b0d10'));
    assert.ok(html.includes('Checkout flow'));
    const versions = await world.designs.versions('checkout-flow');
    assert.equal(versions.length, 1);
  } finally { await world.done(); }
});

test('turns reuse the design task and carry the sandbox and design system', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Checkout Flow');
    await world.designs.saveSystem({ name: 'Acme', colors: { primary: '#ff0000' } });
    const first = await world.designs.send('checkout-flow', 'A two column checkout');
    const second = await world.designs.send('checkout-flow', 'Make the button bigger');
    assert.equal(first.sessionId, 's1');
    assert.equal(second.sessionId, 's1');
    assert.deepEqual(world.sessions, ['Design · Checkout flow']);
    assert.match(world.calls[0].text, /\.relay\/design\/checkout-flow\//);
    assert.match(world.calls[0].text, /--ds-primary:#ff0000/);
    assert.match(world.calls[0].text, /A two column checkout/);
    assert.equal(world.calls[0].access, 'full');
    assert.match(world.calls[0].text, /Create the page from scratch/);
    assert.match(world.calls[1].text, /Revise the existing design/);
  } finally { await world.done(); }
});

test('a chosen model is stored per design and drives its turns', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Landing');
    await world.designs.setModel('landing', 'live/precise');
    const view = await world.designs.view();
    assert.equal(view.designs[0].model, 'live/precise');
    await world.designs.send('landing', 'Make it warmer');
    assert.equal(world.calls.at(-1)?.model, 'live/precise');
    assert.equal(world.calls.at(-1)?.auto, undefined);
    await world.designs.setModel('landing', '');
    const cleared = await world.designs.view();
    assert.equal(cleared.designs[0].model, undefined);
    await world.designs.send('landing', 'Back to the usual model');
    assert.equal(world.calls.at(-1)?.model, 'test/model');
  } finally { await world.done(); }
});

test('each design keeps its own task and the session maps back to its slug', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Checkout Flow');
    await world.designs.create('Landing Page');
    assert.deepEqual(world.sessions, ['Design · Checkout flow', 'Design · Landing page']);
    assert.equal(await world.designs.slugForSession('s1'), 'checkout-flow');
    assert.equal(await world.designs.slugForSession('s2'), 'landing-page');
    assert.equal(await world.designs.slugForSession('missing'), undefined);
  } finally { await world.done(); }
});

test('deleting a design removes its folder, versions and task', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Checkout Flow');
    const view = await world.designs.remove('checkout-flow');
    assert.equal(view.designs.length, 0);
    assert.deepEqual(world.deleted, ['s1']);
    await assert.rejects(readFile(join(world.path, '.relay/design/checkout-flow/index.html')), /ENOENT/);
    assert.equal(await world.designs.slugForSession('s1'), undefined);
  } finally { await world.done(); }
});

test('a finished turn becomes a new version', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Landing');
    await world.designs.send('landing', 'A hero');
    await writeFile(join(world.path, '.relay/design/landing/index.html'), '<h1>Hi</h1>');
    await world.designs.noteIdle('s1');
    const versions = await world.designs.versions('landing');
    assert.deepEqual(versions.map((entry) => entry.version), [2, 1]);
    const snapshot = await readFile(join(world.path, '.relay/design/landing/versions/2/index.html'), 'utf8');
    assert.equal(snapshot, '<h1>Hi</h1>');
  } finally { await world.done(); }
});

test('restoring a version brings its files back and removes extras', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Landing');
    const starter = await readFile(join(world.path, '.relay/design/landing/index.html'), 'utf8');
    await writeFile(join(world.path, '.relay/design/landing/index.html'), '<h1>Changed</h1>');
    await writeFile(join(world.path, '.relay/design/landing/extra.css'), 'p{}');
    await world.designs.restore('landing', 1);
    assert.equal(await readFile(join(world.path, '.relay/design/landing/index.html'), 'utf8'), starter);
    await assert.rejects(readFile(join(world.path, '.relay/design/landing/extra.css')), /ENOENT/);
  } finally { await world.done(); }
});

test('only the newest twenty versions are kept', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Long');
    for (let turn = 0; turn < 25; turn += 1) await world.designs.snapshotNow('long');
    const versions = await world.designs.versions('long');
    assert.equal(versions.length, 20);
    assert.equal(versions[0].version, 26);
    assert.equal(versions.at(-1)?.version, 7);
  } finally { await world.done(); }
});

test('the design system round-trips through the project file', async () => {
  const world = await workspace();
  try {
    await world.designs.saveSystem({ name: 'Acme', notes: 'Calm', type: { base: 18 } });
    const stored = JSON.parse(await readFile(join(world.path, '.relay/design-system.json'), 'utf8'));
    assert.equal(stored.name, 'Acme');
    const view = await world.designs.view();
    assert.equal(view.system.type.base, 18);
    assert.equal(view.system.type.scale, normalizeDesignSystem({}).type.scale);
  } finally { await world.done(); }
});

test('the preview serves sandbox files and refuses anything outside it', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Landing');
    await writeFile(join(world.path, '.relay/design/landing/app.css'), 'body{color:red}');
    await writeFile(join(world.path, 'secret.txt'), 'do not serve');
    const css = await world.designs.preview('relay-design://preview/landing/app.css');
    assert.equal(css?.type, 'text/css; charset=utf-8');
    assert.equal(css?.body, 'body{color:red}');
    const page = await world.designs.preview('relay-design://preview/landing/');
    assert.equal(page?.type, 'text/html; charset=utf-8');
    assert.ok(String(page?.body).includes('--ds-background'));
    assert.equal(await world.designs.preview('relay-design://preview/landing/../../secret.txt'), undefined);
    assert.equal(await world.designs.preview('relay-design://preview/../secret.txt'), undefined);
    assert.equal(await world.designs.preview('relay-design://other/landing/index.html'), undefined);
  } finally { await world.done(); }
});

test('tokens are injected only when a page lacks them', () => {
  const system = normalizeDesignSystem({ colors: { primary: '#123456' } });
  const bare = injectDesignSystem('<!doctype html><html><head><title>x</title></head><body></body></html>', system);
  assert.ok(bare.includes('<style id="relay-design-system">'));
  assert.ok(bare.indexOf('relay-design-system') < bare.indexOf('<title>'));
  const owned = injectDesignSystem('<html><head><style>:root{--ds-primary:#fff}</style></head></html>', system);
  assert.equal(owned, '<html><head><style>:root{--ds-primary:#fff}</style></head></html>');
});

test('every served page carries the navigation runtime', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Landing');
    await writeFile(join(world.path, '.relay/design/landing/index.html'), '<html><head><style>:root{--ds-primary:#fff}</style></head><body>hi</body></html>');
    const page = await world.designs.preview('relay-design://preview/landing/index.html');
    assert.ok(String(page?.body).includes('relay-preview-runtime'));
    assert.ok(String(page?.body).includes('@view-transition'));
    const twice = injectPreviewRuntime(injectPreviewRuntime('<html><body>x</body></html>'));
    assert.equal(twice.match(/relay-preview-runtime/g)?.length, 1);
  } finally { await world.done(); }
});

test('implementing opens a visible task for the project', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Checkout Flow');
    const result = await world.designs.implement('checkout-flow');
    assert.equal(result.sessionId, 's2');
    assert.deepEqual(world.sessions, ['Design · Checkout flow', 'Implement · Checkout flow']);
    assert.equal(world.calls[0].access, 'ask');
    assert.match(world.calls[0].text, /\.relay\/design\/checkout-flow\//);
  } finally { await world.done(); }
});

test('design sessions resume from disk and are shown again after an upgrade', async () => {
  const world = await workspace();
  try {
    await mkdir(join(world.path, '.relay/design/landing'), { recursive: true });
    await writeFile(join(world.path, '.relay/design/landing/index.html'), '<h1>x</h1>');
    await writeFile(join(world.path, '.relay/design/landing/session.json'), JSON.stringify({ sessionId: 'kept' }));
    const result = await world.designs.send('landing', 'More');
    assert.equal(result.sessionId, 'kept');
    assert.deepEqual(world.sessions, []);
    assert.deepEqual(world.shown, ['kept']);
  } finally { await world.done(); }
});

test('existing design sessions can be listed for the boot migration', async () => {
  const world = await workspace();
  try {
    await world.designs.create('Checkout Flow');
    await world.designs.create('Landing Page');
    assert.deepEqual(await designSessionIds(world.path), ['s1', 's2']);
    assert.deepEqual(await designSessionIds(join(world.path, 'nowhere')), []);
  } finally { await world.done(); }
});
