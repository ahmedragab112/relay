import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { undoFileChange } from '../src/main/revert.js';

const run = promisify(execFile);

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'relay-revert-'));
  await run('git', ['init', '--quiet'], { cwd: root });
  await run('git', ['-c', 'user.email=relay@example.test', '-c', 'user.name=Relay', 'commit', '--allow-empty', '--quiet', '-m', 'init'], { cwd: root });
  return root;
}

test('undo restores a tracked file to its committed content', async () => {
  const root = await repository();
  try {
    await writeFile(join(root, 'notes.md'), 'committed\n');
    await run('git', ['add', 'notes.md'], { cwd: root });
    await run('git', ['-c', 'user.email=relay@example.test', '-c', 'user.name=Relay', 'commit', '--quiet', '-m', 'notes'], { cwd: root });
    await writeFile(join(root, 'notes.md'), 'edited\n');
    assert.equal(await undoFileChange(root, 'notes.md'), 'restored');
    assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), 'committed\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('undo removes a new untracked file', async () => {
  const root = await repository();
  try {
    await writeFile(join(root, 'scratch.txt'), 'new\n');
    assert.equal(await undoFileChange(root, 'scratch.txt'), 'deleted');
    await assert.rejects(access(join(root, 'scratch.txt')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('undo rejects paths outside the workspace', async () => {
  const root = await repository();
  try {
    await assert.rejects(undoFileChange(root, '../outside.txt'), /outside the selected workspace/);
    await assert.rejects(undoFileChange(root, '/etc/hosts'), /relative path/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
