import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { designSuggestions } from '../src/shared/design.js';
import { Designs, type DesignDeps } from '../src/main/design.js';

test('a fresh design asks for mobile, states and a second screen', () => {
  const items = designSuggestions({ versions: 1, context: 0 });
  assert.equal(items.length, 3);
  assert.match(items[0], /mobile/i);
  assert.match(items[1], /empty and error/i);
  assert.match(items[2], /second screen/i);
});

test('an iterated design asks for polish, states and a matching screen', () => {
  const items = designSuggestions({ versions: 4, context: 0 });
  assert.equal(items.length, 3);
  assert.match(items[0], /spacing|hierarchy|contrast/i);
  assert.match(items[1], /hover, focus/i);
  assert.ok(!items.some((item) => /mobile layout/i.test(item)));
});

test('a picked element leads with a focused rework suggestion', () => {
  const items = designSuggestions({ versions: 2, context: 1 });
  assert.equal(items.length, 3);
  assert.match(items[0], /attached context/i);
  assert.equal(new Set(items).size, 3);
  for (const item of items) assert.ok(item.length <= 120, item);
});

const project = (path: string): DesignDeps['project'] => () => ({ id: 'p', name: 'Shop', path });

function designsAt(path: string): Designs {
  return new Designs({
    project: project(path),
    engine: () => ({
      createSession: async () => ({ id: 'session' }),
      sendMessage: async () => undefined,
      abortSession: async () => undefined,
      deleteSession: async () => undefined,
    }),
    model: () => ({ model: 'test/model', auto: false }),
    access: () => 'full',
    emit: () => undefined,
    sessionsChanged: () => undefined,
    show: () => undefined,
  });
}

test('copying a page returns the raw entry file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-code-'));
  try {
    const dir = join(root, '.relay/design/checkout');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), '<h1>Checkout</h1>');
    const page = await designsAt(root).code('checkout');
    assert.deepEqual(page, { name: 'index.html', text: '<h1>Checkout</h1>' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('copying refuses bad slugs and designs without a page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-code-'));
  try {
    await mkdir(join(root, '.relay/design/empty'), { recursive: true });
    const designs = designsAt(root);
    await assert.rejects(designs.code('Empty Slug'));
    await assert.rejects(designs.code('empty'), /no page/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
