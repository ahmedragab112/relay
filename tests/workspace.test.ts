import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceFiles } from '../src/main/workspace.js';

test('workspace reads and saves text with optimistic revisions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'hello.ts'), 'const hello = 1;');
  const files = new WorkspaceFiles(root);
  const document = await files.read('hello.ts');
  assert.equal(document.content, 'const hello = 1;');
  const saved = await files.save('hello.ts', 'const hello = 2;', document.revision);
  assert.equal(saved.content, 'const hello = 2;');
  assert.notEqual(saved.revision, document.revision);
  assert.equal(await readFile(join(root, 'hello.ts'), 'utf8'), saved.content);
  await assert.rejects(() => files.save('hello.ts', 'stale', document.revision), /changed/i);
});

test('workspace refuses traversal, external symlinks, binary and oversized files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'project'));
  await writeFile(join(root, 'secret'), 'private');
  await symlink(join(root, 'secret'), join(root, 'project', 'linked'));
  await writeFile(join(root, 'project', 'binary'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'project', 'huge'), 'x'.repeat(2_097_153));
  const files = new WorkspaceFiles(join(root, 'project'));
  await assert.rejects(() => files.read('../secret'), /workspace/i);
  await assert.rejects(() => files.read(join(root, 'secret')), /relative|workspace/i);
  await assert.rejects(() => files.read('linked'), /workspace/i);
  await assert.rejects(() => files.read('binary'), /binary/i);
  await assert.rejects(() => files.read('huge'), /2 MB/i);
});

test('workspace listing excludes dependency folders and external links', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'project'));
  await mkdir(join(root, 'project', 'src'));
  await mkdir(join(root, 'project', '.git'));
  await mkdir(join(root, 'project', 'node_modules'));
  await writeFile(join(root, 'project', 'index.ts'), '');
  await symlink(root, join(root, 'project', 'outside'));
  const entries = await new WorkspaceFiles(join(root, 'project')).list();
  assert.deepEqual(entries.map(entry => entry.name), ['src', 'index.ts']);
  assert.equal(entries[0].directory, true);
});

test('workspace searches file names and text while skipping hidden and binary files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-search-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'project'));
  await mkdir(join(root, 'project', 'src'));
  await mkdir(join(root, 'project', 'node_modules'));
  await writeFile(join(root, 'project', 'src', 'composer.ts'), 'const draft = 1;\n');
  await writeFile(join(root, 'project', 'src', 'composer-notes.md'), 'composer notes\n');
  await writeFile(join(root, 'project', 'node_modules', 'composer.js'), 'composer bundled\n');
  await writeFile(join(root, 'project', 'blob.bin'), Buffer.from([0, 1, 2]));
  const files = new WorkspaceFiles(join(root, 'project'));
  const names = await files.search('composer', 'files');
  assert.deepEqual(names.map(entry => entry.path), ['src/composer.ts', 'src/composer-notes.md']);
  const content = await files.search('composer', 'content');
  assert.deepEqual(content.map(entry => entry.path), ['src/composer-notes.md']);
  assert.equal(content[0].line, 1);
  assert.match(content[0].preview ?? '', /composer notes/);
  assert.deepEqual(await files.search('', 'content'), []);
});
