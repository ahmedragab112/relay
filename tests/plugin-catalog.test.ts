import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginManager } from '../src/main/plugins.js';
import { downloadPluginPackage } from '../src/main/import.js';

async function plugin(directory: string, id: string, name: string, files: Record<string, string> = {}): Promise<string> {
  const root = join(directory, id);
  const contents: Record<string, string> = {
    'relay-plugin.json': JSON.stringify({ id, name, version: '1.0.0', description: `${name} fixture` }),
    'README.md': `${name} fixture`,
    ...files,
  };
  for (const [path, content] of Object.entries(contents)) {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

async function scratch(): Promise<{ root: string; catalog: string; managed: string; dispose: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'relay-catalog-'));
  return { root, catalog: join(root, 'catalog'), managed: join(root, 'managed'), dispose: () => rm(root, { recursive: true, force: true }) };
}

const payload = new TextEncoder().encode('PK fixture plugin bytes');
const digestOf = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

test('lists bundled catalog plugins with their capabilities and stable digests', async () => {
  const project = await scratch();
  try {
    await plugin(project.catalog, 'code-review', 'Code review', {
      'commands/review.md': '---\ndescription: Review changes\n---\nReview the diff.',
      'skills/code-review/SKILL.md': '---\nname: code-review\ndescription: Review changes\n---\nReview carefully.',
    });
    await plugin(project.catalog, 'commit-notes', 'Commit notes', {
      'commands/commit-message.md': '---\ndescription: Write a commit message\n---\nWrite the message.',
    });
    await writeFile(join(project.catalog, 'code-review', '.DS_Store'), 'junk');
    const manager = new PluginManager(project.managed);
    const entries = await manager.catalog(project.catalog);
    assert.deepEqual(entries.map((entry) => entry.manifest.id), ['code-review', 'commit-notes']);
    assert.deepEqual(entries[0].capabilities, { skills: ['code-review'], commands: ['review'], agents: [], mcp: [], code: [] });
    assert.deepEqual(entries[1].capabilities.commands, ['commit-message']);
    assert.match(entries[0].digest, /^[a-f0-9]{64}$/);
    assert.equal(entries[0].digest, (await manager.catalog(project.catalog))[0].digest);
    const preview = await manager.previewDirectory(entries[0].directory);
    assert.equal(preview.manifest.name, 'Code review');
    assert.equal(preview.digest, entries[0].digest);
    assert.deepEqual(preview.files.map((file) => file.path), [
      'commands/review.md', 'README.md', 'relay-plugin.json', 'skills/code-review/SKILL.md',
    ]);
    const record = await manager.install(preview.token, false);
    assert.equal(record.id, 'code-review');
    assert.match(await readFile(join(project.managed, 'code-review', 'relay-plugin.json'), 'utf8'), /"id":\s*"code-review"/);
  } finally { await project.dispose(); }
});

test('ships a curated catalog of 100 declarative plugin packs', async () => {
  const project = await scratch();
  try {
    const manager = new PluginManager(project.managed);
    const entries = await manager.catalog(join(process.cwd(), 'catalog'));
    assert.equal(entries.length, 100);
    assert.equal(new Set(entries.map((entry) => entry.manifest.id)).size, 100);
    assert.deepEqual(entries.map((entry) => entry.manifest.name), [...entries].map((entry) => entry.manifest.name).sort((a, b) => a.localeCompare(b)));
    for (const entry of entries) {
      assert.equal(entry.capabilities.code.length, 0);
      assert.equal(entry.capabilities.mcp.length, 0);
      assert.equal(entry.capabilities.skills.length, 0);
      assert.equal(entry.capabilities.agents.length, 0);
      assert.ok(entry.capabilities.commands.length >= 2, `${entry.manifest.id} must add at least two commands`);
      assert.ok(entry.manifest.description.trim(), `${entry.manifest.id} needs a description`);
      assert.match(entry.digest, /^[a-f0-9]{64}$/);
    }
  } finally { await project.dispose(); }
});

test('rejects catalog entries with unsupported content or a mismatched folder name', async () => {
  const project = await scratch();
  try {
    await plugin(project.catalog, 'unsafe-root', 'Unsafe root', { 'install.sh': 'echo no' });
    const manager = new PluginManager(project.managed);
    await assert.rejects(() => manager.catalog(project.catalog), /unsupported/i);
    const other = await scratch();
    try {
      await plugin(other.catalog, 'folder-name', 'Folder name');
      const renamed = join(other.catalog, 'renamed');
      await mkdir(renamed);
      await writeFile(join(renamed, 'relay-plugin.json'), JSON.stringify({ id: 'folder-name', name: 'Folder name', version: '1.0.0' }));
      await assert.rejects(() => manager.catalog(other.catalog), /folder|match|id/i);
    } finally { await other.dispose(); }
  } finally { await project.dispose(); }
});

test('rejects symlinks in a catalog directory', async () => {
  const project = await scratch();
  try {
    const root = await plugin(project.catalog, 'linked', 'Linked');
    await symlink('/etc/passwd', join(root, 'escape'));
    const manager = new PluginManager(project.managed);
    await assert.rejects(() => manager.catalog(project.catalog), /unsupported|symlink/i);
  } finally { await project.dispose(); }
});

test('downloads an HTTPS plugin ZIP and verifies an optional SHA-256 hash', async () => {
  const requests: string[] = [];
  const result = await downloadPluginPackage('https://plugins.example/code-review.zip', digestOf(payload).toUpperCase(), {
    fetch: async (url) => { requests.push(url); return new Response(payload, { headers: { 'content-type': 'application/zip' } }); },
  });
  try {
    assert.deepEqual(requests, ['https://plugins.example/code-review.zip']);
    assert.equal(result.digest, digestOf(payload));
    assert.deepEqual(new Uint8Array(await readFile(result.path)), payload);
  } finally { await rm(result.directory, { recursive: true, force: true }); }
});

test('resolves relative redirects while importing a plugin', async () => {
  const requests: string[] = [];
  const result = await downloadPluginPackage('https://plugins.example/start', '', {
    fetch: async (url) => {
      requests.push(url);
      return url.endsWith('/start')
        ? new Response(null, { status: 302, headers: { location: '/packages/code-review.zip' } })
        : new Response(payload);
    },
  });
  try {
    assert.deepEqual(requests, ['https://plugins.example/start', 'https://plugins.example/packages/code-review.zip']);
    assert.equal(result.digest, digestOf(payload));
  } finally { await rm(result.directory, { recursive: true, force: true }); }
});

test('rejects insecure, credential-bearing and mismatched imports before writing a package', async () => {
  let called = false;
  const fetch = async () => { called = true; return new Response(payload); };
  await assert.rejects(() => downloadPluginPackage('http://plugins.example/code.zip', '', { fetch }), /HTTPS/);
  await assert.rejects(() => downloadPluginPackage('https://user:secret@plugins.example/code.zip', '', { fetch }), /credentials/i);
  assert.equal(called, false);
  await assert.rejects(() => downloadPluginPackage('not a url', '', { fetch }), /valid HTTPS URL/);
  await assert.rejects(() => downloadPluginPackage('https://plugins.example/code.zip', 'abc', { fetch }), /64 hex characters/);
  await assert.rejects(
    () => downloadPluginPackage('https://plugins.example/code.zip', digestOf(new TextEncoder().encode('other')), { fetch }),
    /SHA-256 hash does not match/i,
  );
});

test('rejects a redirect from HTTPS to HTTP', async () => {
  await assert.rejects(() => downloadPluginPackage('https://plugins.example/start', '', {
    fetch: async () => new Response(null, { status: 301, headers: { location: 'http://plugins.example/code.zip' } }),
  }), /HTTPS/);
});

test('rejects downloads that exceed the size limit', async () => {
  await assert.rejects(() => downloadPluginPackage('https://plugins.example/code.zip', '', {
    fetch: async () => new Response(new Uint8Array(64)),
    maxBytes: 32,
  }), /larger/i);
  await assert.rejects(() => downloadPluginPackage('https://plugins.example/code.zip', '', {
    fetch: async () => new Response(new Uint8Array(64), { headers: { 'content-length': '64' } }),
    maxBytes: 32,
  }), /larger/i);
});
