import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultDesignSystem, designPrompt, rawDesignRequest } from '../src/shared/design.js';
import { Designs, type DesignDeps } from '../src/main/design.js';

const base = {
  projectName: 'Shop', slug: 'checkout', system: defaultDesignSystem(),
  request: 'Make the hero taller', existing: ['index.html', 'styles.css'],
};

test('a revision turn sends a short delta, not the whole brief again', () => {
  const revised = designPrompt({ ...base, revision: true });
  const fresh = designPrompt({ ...base, request: 'hi', revision: false });
  assert.ok(revised.length < fresh.length / 2, `revision ${revised.length} vs fresh ${fresh.length}`);
  assert.ok(!revised.includes('## 3. Build complete files'));
  assert.ok(!revised.includes('Create the page from scratch.'));
  assert.ok(revised.includes('Make the hero taller'));
  assert.ok(revised.includes('.relay/design/checkout/DESIGN.md'));
  assert.ok(revised.includes('index.html, styles.css'));
  assert.ok(revised.includes('--ds-primary'));
  assert.ok(revised.includes('offline'));
  assert.match(revised, /targeted/);
  assert.match(revised, /two or three sentences/);
});

test('the feed shows what was typed, not the design scaffold', () => {
  const full = designPrompt({ ...base, request: 'hi', revision: false, previewUrl: 'http://127.0.0.1:4321/token' });
  assert.equal(rawDesignRequest(full), 'hi');
  const revised = designPrompt({ ...base, request: 'hi', revision: true, previewUrl: 'http://127.0.0.1:4321/token' });
  assert.equal(rawDesignRequest(revised), 'hi');
  assert.equal(rawDesignRequest('plain message'), 'plain message');
});

test('a multi-line request survives the round trip', () => {
  const request = 'Add a pricing page.\n\nUse three tiers with a yearly toggle.';
  const prompt = designPrompt({ ...base, request, revision: false });
  assert.equal(rawDesignRequest(prompt), request);
});

function designsAt(path: string, aborted: string[] = []): Designs {
  const deps: DesignDeps = {
    project: () => ({ id: 'p', name: 'Shop', path }),
    engine: () => ({
      createSession: async () => ({ id: 'session' }),
      sendMessage: async () => undefined,
      abortSession: async (id: string) => { aborted.push(id); },
      deleteSession: async () => undefined,
    }),
    model: () => ({ model: 'test/model', auto: false }),
    access: () => 'full',
    emit: () => undefined,
    sessionsChanged: () => undefined,
    show: () => undefined,
  };
  return new Designs(deps);
}

test('stopping a design uses its saved session after a restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-cancel-'));
  try {
    const dir = join(root, '.relay/design/checkout');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), '<h1>Checkout</h1>');
    await writeFile(join(dir, 'session.json'), JSON.stringify({ sessionId: 'saved-session', turns: 2 }));
    const aborted: string[] = [];
    assert.equal(await designsAt(root, aborted).cancel('checkout'), true);
    assert.deepEqual(aborted, ['saved-session']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stopping a design that never ran reports nothing to stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-cancel-'));
  try {
    await mkdir(join(root, '.relay/design/fresh'), { recursive: true });
    const aborted: string[] = [];
    assert.equal(await designsAt(root, aborted).cancel('fresh'), false);
    assert.deepEqual(aborted, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
