import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillCatalog } from '../src/main/skills-catalog.js';
import { SkillLibrary } from '../src/main/skills.js';

const CATALOG = join(process.cwd(), 'bundled-skills');

async function scratch(): Promise<{ root: string; dispose: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'relay-skill-catalog-'));
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}

test('ships a bundled skill catalog of 100 safe, described skills', async () => {
  const catalog = new SkillCatalog(CATALOG);
  const entries = await catalog.list();
  assert.equal(entries.length, 100);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 100);
  assert.equal(new Set(entries.map((entry) => entry.category)).size, 10);
  for (const entry of entries) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9_-]{0,63}$/);
    assert.ok(entry.name.trim(), `${entry.id} needs a name`);
    assert.ok(entry.description.trim(), `${entry.id} needs a description`);
    assert.ok(entry.category.trim(), `${entry.id} needs a category`);
  }
});

test('orders the bundled catalog by category, then name', async () => {
  const entries = await new SkillCatalog(CATALOG).list();
  const sorted = [...entries].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  assert.deepEqual(entries.map((entry) => entry.id), sorted.map((entry) => entry.id));
});

test('installs a bundled skill into the library without a network request', async () => {
  const project = await scratch();
  try {
    const catalog = new SkillCatalog(CATALOG);
    const files = await catalog.files('code-review');
    assert.ok(files.has('SKILL.md'));
    const library = new SkillLibrary(join(project.root, 'skills'));
    await library.cleanup();
    const preview = await library.previewFiles(files, 'Bundled with Relay');
    const installed = await library.install(preview.token);
    assert.deepEqual(installed.map((entry) => entry.id), ['code-review']);
    assert.equal(installed[0].source, 'Bundled with Relay');
    assert.equal((await new SkillCatalog(CATALOG).list()).find((entry) => entry.id === 'code-review')?.description.length! > 0, true);
  } finally { await project.dispose(); }
});

test('rejects unknown and unsafe catalog ids', async () => {
  const catalog = new SkillCatalog(CATALOG);
  await assert.rejects(() => catalog.files('not-a-real-skill'), /Unknown|not available/i);
  await assert.rejects(() => catalog.files('../escape'), /Unknown|not available/i);
  await assert.rejects(() => catalog.files(''), /Unknown|not available/i);
});
