import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { SkillLibrary, analyzeSkillFiles, parseSkillFile, skillIdFromName, validateSkillURL } from '../src/main/skills.js';

const encoder = new TextEncoder();

function skillFile(name: string, description = 'A focused helper.'): Uint8Array {
  return encoder.encode(`---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n\nUse this when the task asks for ${name}.\n`);
}

function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('parses the name and description from SKILL.md frontmatter', () => {
  assert.deepEqual(
    parseSkillFile('---\nname: "Release notes"\ndescription: Writes release notes from commits.\n---\n# Body\n'),
    { name: 'Release notes', description: 'Writes release notes from commits.' },
  );
});

test('rejects a SKILL.md without frontmatter or a name', () => {
  assert.throws(() => parseSkillFile('# Just a page'), /frontmatter/i);
  assert.throws(() => parseSkillFile('---\ndescription: Missing name\n---\n'), /name/i);
  assert.throws(() => parseSkillFile(`---\nname: ${'x'.repeat(81)}\n---\n`), /80/);
});

test('turns a skill name into a safe folder id', () => {
  assert.equal(skillIdFromName('Release  Notes!'), 'release-notes');
  assert.equal(skillIdFromName('  déjà vu  '), 'deja-vu');
  assert.throws(() => skillIdFromName('---'), /name/i);
});

test('analyzes a single SKILL.md package with sibling assets', () => {
  const files = new Map<string, Uint8Array>([
    ['SKILL.md', skillFile('changelog-writer')],
    ['scripts/format.sh', encoder.encode('#!/bin/sh\n')],
  ]);
  const [skill] = analyzeSkillFiles(files);
  assert.equal(skill.id, 'changelog-writer');
  assert.equal(skill.name, 'changelog-writer');
  assert.deepEqual([...skill.files.keys()].sort(), ['SKILL.md', 'scripts/format.sh']);
});

test('analyzes several skills from a skills/ package', () => {
  const files = new Map<string, Uint8Array>([
    ['skills/api-review/SKILL.md', skillFile('api-review')],
    ['skills/api-review/reference/checklist.md', encoder.encode('- validate input\n')],
    ['skills/release-notes/SKILL.md', skillFile('release-notes', 'Summarizes commits.')],
  ]);
  const skills = analyzeSkillFiles(files);
  assert.deepEqual(skills.map((skill) => skill.id), ['api-review', 'release-notes']);
  assert.deepEqual([...skills[0].files.keys()].sort(), ['SKILL.md', 'reference/checklist.md']);
  assert.equal(skills[1].description, 'Summarizes commits.');
});

test('rejects unsafe or unsupported skill packages', () => {
  assert.throws(() => analyzeSkillFiles(new Map([['../SKILL.md', skillFile('escape')]])), /unsafe/i);
  assert.throws(() => analyzeSkillFiles(new Map([['.git/SKILL.md', skillFile('hidden')]])), /hidden/i);
  assert.throws(() => analyzeSkillFiles(new Map([['README.md', encoder.encode('nothing')]])), /SKILL\.md/i);
  assert.throws(() => analyzeSkillFiles(new Map([
    ['skills/a/SKILL.md', skillFile('first')],
    ['skills/b/SKILL.md', skillFile('first')],
  ])), /same name/i);
});

test('accepts only credential-free HTTPS skill URLs', () => {
  assert.equal(validateSkillURL('https://skills.example/package.zip'), 'https://skills.example/package.zip');
  assert.throws(() => validateSkillURL('http://skills.example/package.zip'), /HTTPS/);
  assert.throws(() => validateSkillURL('https://user:secret@skills.example/package.zip'), /credentials/i);
  assert.throws(() => validateSkillURL('not a url'), /HTTPS/);
});

test('installs, lists, and removes a managed skill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-skill-library-'));
  try {
    const library = new SkillLibrary(root);
    await library.cleanup();
    const preview = await library.previewFiles(new Map([['SKILL.md', skillFile('changelog-writer')]]), 'local');
    assert.equal(preview.skills[0].id, 'changelog-writer');
    assert.equal(preview.skills[0].existing, false);
    const installed = await library.install(preview.token);
    assert.equal(installed.length, 1);
    assert.equal(installed[0].name, 'changelog-writer');
    assert.equal(installed[0].source, 'local');
    assert.match(await readFile(join(root, 'changelog-writer', 'SKILL.md'), 'utf8'), /changelog-writer/);

    const again = await library.previewFiles(new Map([['SKILL.md', skillFile('changelog-writer', 'Updated.')]]), 'local');
    assert.equal(again.skills[0].existing, true);
    await library.install(again.token);
    const entries = await library.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].description, 'Updated.');

    assert.equal((await library.remove('changelog-writer')).length, 0);
    await assert.rejects(() => library.remove('../outside'), /Unknown skill/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('downloads a skill package over HTTPS and verifies its digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-skill-download-'));
  try {
    const payload = zipSync({ 'skills/commit-notes/SKILL.md': strToU8(new TextDecoder().decode(skillFile('commit-notes'))) });
    const library = new SkillLibrary(root);
    await library.cleanup();
    const preview = await library.previewURL('https://skills.example/commit-notes.zip', digestOf(payload), {
      fetch: async () => new Response(payload.buffer as ArrayBuffer, { headers: { 'content-type': 'application/zip' } }),
    });
    assert.equal(preview.skills[0].id, 'commit-notes');
    assert.equal(preview.digest, digestOf(payload));
    assert.deepEqual(preview.files, [{ path: 'commit-notes/SKILL.md', size: skillFile('commit-notes').length }]);
    await assert.rejects(
      () => library.previewURL('https://skills.example/commit-notes.zip', digestOf(encoder.encode('other')), {
        fetch: async () => new Response(payload.buffer as ArrayBuffer),
      }),
      /SHA-256 hash does not match/i,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('downloads a single SKILL.md over HTTPS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-skill-markdown-'));
  try {
    const library = new SkillLibrary(root);
    await library.cleanup();
    const bytes = skillFile('single-file');
    const preview = await library.previewURL('https://skills.example/SKILL.md', '', {
      fetch: async () => new Response(bytes.buffer as ArrayBuffer, { headers: { 'content-type': 'text/markdown' } }),
    });
    assert.equal(preview.skills[0].name, 'single-file');
    assert.equal(preview.files[0].path, 'single-file/SKILL.md');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('expires a preview whose token was already consumed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-skill-token-'));
  try {
    const library = new SkillLibrary(root);
    await library.cleanup();
    const preview = await library.previewFiles(new Map([['SKILL.md', skillFile('one-shot')]]), 'local');
    await library.install(preview.token);
    await assert.rejects(() => library.install(preview.token), /expired/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
