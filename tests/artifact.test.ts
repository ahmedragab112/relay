import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactFolders, type ArtifactProject } from '../src/main/artifact.js';
import { isDesignSlug } from '../src/shared/design.js';

const folders = new ArtifactFolders({
  root: '.relay/design',
  entry: 'index.html',
  versions: 'versions',
  maxVersions: 2,
  valid: isDesignSlug,
  title: (slug) => slug.replace(/-/g, ' '),
});

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'relay-artifact-'));
  const project: ArtifactProject = { id: 'p1', name: 'Shop', path };
  const dir = join(path, '.relay/design/landing');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), '<h1>One</h1>');
  await writeFile(join(dir, 'styles.css'), 'h1{color:red}');
  return { path, project, dir, done: () => rm(path, { recursive: true, force: true }) };
}

test('an artifact entry counts files, versions and the saved session choice', async () => {
  const world = await workspace();
  try {
    await folders.saveSession(world.project, 'landing', { sessionId: 's1', model: 'live/precise' });
    await folders.snapshot(world.project, 'landing', 'Starter page');
    const entry = await folders.entry(world.project, 'landing');
    assert.ok(entry);
    assert.equal(entry.slug, 'landing');
    assert.equal(entry.title, 'landing');
    assert.equal(entry.versions, 1);
    assert.equal(entry.sessionId, 's1');
    assert.equal(entry.model, 'live/precise');
    // session.json does not count as content: saving it must not reorder the grid.
    const before = entry.updatedAt;
    await folders.saveSession(world.project, 'landing', { model: '' });
    assert.equal((await folders.entry(world.project, 'landing'))?.updatedAt, before);
  } finally { await world.done(); }
});

test('saving the session keeps the session id and replaces only chosen fields', async () => {
  const world = await workspace();
  try {
    await folders.saveSession(world.project, 'landing', { sessionId: 's1' });
    await folders.saveSession(world.project, 'landing', { model: 'live/large' });
    assert.deepEqual(await folders.session(world.project, 'landing'), {
      sessionId: 's1', model: 'live/large',
    });
  } finally { await world.done(); }
});

test('snapshots copy content, list newest first and prune old versions', async () => {
  const world = await workspace();
  try {
    const first = await folders.snapshot(world.project, 'landing');
    await writeFile(join(world.dir, 'styles.css'), 'h1{color:blue}');
    const second = await folders.snapshot(world.project, 'landing', 'Agent turn');
    const third = await folders.snapshot(world.project, 'landing');
    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(third, 3);
    const versions = await folders.versions(world.project, 'landing');
    assert.deepEqual(versions.map((entry) => entry.version), [3, 2]);
    assert.ok(versions[1].savedAt > 0);
    assert.equal(await readFile(join(world.dir, 'versions/2/styles.css'), 'utf8'), 'h1{color:blue}');
  } finally { await world.done(); }
});

test('restoring a version brings back its files and removes files added later', async () => {
  const world = await workspace();
  try {
    await folders.snapshot(world.project, 'landing');
    await writeFile(join(world.dir, 'styles.css'), 'h1{color:blue}');
    await writeFile(join(world.dir, 'app.js'), 'console.log(1)');
    await folders.restore(world.project, 'landing', 1);
    assert.equal(await readFile(join(world.dir, 'styles.css'), 'utf8'), 'h1{color:red}');
    await assert.rejects(stat(join(world.dir, 'app.js')), /ENOENT/);
  } finally { await world.done(); }
});

test('artifact files skip hidden entries and versions, with the entry page first', async () => {
  const world = await workspace();
  try {
    await writeFile(join(world.dir, '.secret'), 'x');
    await mkdir(join(world.dir, 'screens'), { recursive: true });
    await writeFile(join(world.dir, 'screens/checkout.html'), '<p>x</p>');
    await folders.snapshot(world.project, 'landing');
    const files = await folders.files(world.project, 'landing');
    assert.deepEqual(files, ['index.html', 'screens/checkout.html', 'styles.css']);
  } finally { await world.done(); }
});

test('only valid slugs inside the root resolve, and paths cannot escape the folder', async () => {
  const world = await workspace();
  try {
    await assert.rejects(folders.require(world.project, 'Landing Page'), /not valid/);
    await assert.rejects(folders.require(world.project, 'missing'), /no longer exists/);
    assert.ok(await folders.file(world.project, 'landing', 'index.html'));
    assert.equal(await folders.file(world.project, 'landing', '../other/index.html'), undefined);
    assert.equal(await folders.file(world.project, '../landing', 'index.html'), undefined);
    assert.equal((await folders.file(world.project, 'landing', 'styles.css'))?.type, 'text/css; charset=utf-8');
  } finally { await world.done(); }
});

test('folders named in the spec stay out of the agent file list but still load in the preview', async () => {
  const world = await workspace();
  try {
    const motion = new ArtifactFolders({
      root: '.relay/design', entry: 'index.html', versions: 'versions', ignored: ['exports'],
      valid: isDesignSlug, title: (slug) => slug,
    });
    await mkdir(join(world.dir, 'exports'), { recursive: true });
    await writeFile(join(world.dir, 'exports/clip.mp4'), 'video');
    assert.deepEqual(await motion.files(world.project, 'landing'), ['index.html', 'styles.css']);
    const file = await motion.file(world.project, 'landing', 'exports/clip.mp4');
    assert.equal(file?.type, 'video/mp4');
  } finally { await world.done(); }
});
