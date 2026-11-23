import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesignWatcher, designChangeSlug } from '../src/main/design-watch.js';

const root = '/project/.relay/design';

test('a change maps to the design folder it happened in', () => {
  assert.equal(designChangeSlug(root, 'checkout-flow/index.html'), 'checkout-flow');
  assert.equal(designChangeSlug(root, 'checkout-flow/assets/logo.svg'), 'checkout-flow');
  assert.equal(designChangeSlug(root, 'checkout-flow'), 'checkout-flow');
});

test('versions, dot folders and loose files never reload a preview', () => {
  assert.equal(designChangeSlug(root, 'checkout-flow/versions/2/index.html'), undefined);
  assert.equal(designChangeSlug(root, 'checkout-flow/.cache/x.css'), undefined);
  assert.equal(designChangeSlug(root, 'checkout-flow/versions'), undefined);
  assert.equal(designChangeSlug(root, 'index.html'), undefined);
  assert.equal(designChangeSlug(root, 'Bad Slug/index.html'), undefined);
});

test('bookkeeping files never reload a preview', () => {
  assert.equal(designChangeSlug(root, 'checkout-flow/comments.json'), undefined);
  assert.equal(designChangeSlug(root, 'checkout-flow/session.json'), undefined);
  assert.equal(designChangeSlug(root, 'checkout-flow/DESIGN.md'), undefined);
});

test('a burst of writes reloads the design once, after the quiet window', async () => {
  const project = await mkdtemp(join(tmpdir(), 'relay-watch-'));
  try {
    const design = join(project, '.relay/design/checkout-flow');
    await mkdir(design, { recursive: true });
    await writeFile(join(design, 'index.html'), 'one');
    const seen: string[] = [];
    const watcher = new DesignWatcher(join(project, '.relay/design'), (slug) => seen.push(slug), 120);
    try {
      watcher.start();
      await writeFile(join(design, 'index.html'), 'two');
      await writeFile(join(design, 'styles.css'), 'body{}');
      await new Promise((resolve) => setTimeout(resolve, 450));
      assert.deepEqual(seen, ['checkout-flow']);
    } finally { watcher.close(); }
  } finally { await rm(project, { recursive: true, force: true }); }
});
