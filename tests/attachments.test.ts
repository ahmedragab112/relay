import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachmentName, stageAttachment } from '../src/main/attachments.js';

test('pasted text is staged as a readable file inside the project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-stage-'));
  try {
    const staged = await stageAttachment(root, { name: 'pasted-1200.txt', text: '<?php namespace App;\n' });
    assert.equal(staged.path, '.relay/attachments/pasted-1200.txt');
    assert.equal(staged.name, 'pasted-1200.txt');
    assert.equal(staged.size, 21);
    assert.equal(await readFile(join(root, staged.path), 'utf8'), '<?php namespace App;\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dropped files are copied into the project and identical content is reused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-stage-'));
  try {
    const source = join(root, 'outside.php');
    await writeFile(source, '<?php echo 1;\n');
    const first = await stageAttachment(root, { path: source });
    const second = await stageAttachment(root, { path: source });
    assert.equal(first.path, '.relay/attachments/outside.php');
    assert.equal(second.path, first.path);
    assert.equal(await readFile(join(root, first.path), 'utf8'), '<?php echo 1;\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a different file with the same name gets its own copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-stage-'));
  try {
    const one = join(root, 'one', 'notes.txt');
    const two = join(root, 'two', 'notes.txt');
    await mkdir(join(root, 'one'));
    await mkdir(join(root, 'two'));
    await writeFile(one, 'first');
    await writeFile(two, 'second');
    const first = await stageAttachment(root, { path: one });
    const second = await stageAttachment(root, { path: two });
    assert.equal(first.path, '.relay/attachments/notes.txt');
    assert.equal(second.path, '.relay/attachments/notes-2.txt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('staging rejects folders, oversized, empty and relative sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-stage-'));
  try {
    await mkdir(join(root, 'folder'));
    await writeFile(join(root, 'big.txt'), 'x'.repeat(2 * 1024 * 1024 + 1));
    await writeFile(join(root, 'empty.txt'), '');
    assert.rejects(() => stageAttachment(root, { path: join(root, 'folder') }), /Folders cannot be attached/);
    assert.rejects(() => stageAttachment(root, { path: join(root, 'big.txt') }), /smaller than 2 MB/);
    assert.rejects(() => stageAttachment(root, { path: 'relative.txt' }), /Finder/);
    assert.rejects(() => stageAttachment(root, { text: '' }), /empty/);
    assert.rejects(() => stageAttachment(root, {}), /Nothing to attach/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('attachment names keep their base and lose unsafe characters', () => {
  assert.equal(attachmentName('/tmp/weird:name?.php'), 'weird-name-.php');
  assert.equal(attachmentName('../../escape.md'), 'escape.md');
  assert.equal(attachmentName('.hidden'), 'hidden');
  assert.equal(attachmentName(''), 'attachment');
});
