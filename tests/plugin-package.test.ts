import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strToU8, zipSync } from 'fflate';
import { PluginManager, mergeMcpServers } from '../src/main/plugins.js';
import type { PluginRecord } from '../src/shared/contracts.js';

async function archive(root: string, name: string, files: Record<string, string>): Promise<string> {
  const path = join(root, `${name}.zip`);
  await writeFile(path, zipSync(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)]))));
  return path;
}

const manifest = (id = 'demo') => JSON.stringify({ id, name: 'Demo plugin', version: '1.0.0', description: 'Fixture plugin' });

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'relay-plugins-'));
  return { root, plugins: new PluginManager(join(root, 'plugins')), dispose: () => rm(root, { recursive: true, force: true }) };
}

test('installs a declarative plugin from a wrapped ZIP and discovers its capabilities', async () => {
  const project = await workspace();
  try {
    const path = await archive(project.root, 'demo', {
      'demo/relay-plugin.json': manifest(),
      'demo/skills/review/SKILL.md': '---\nname: Review\ndescription: Review changes\n---\nRead the diff.',
      'demo/commands/check.md': '---\ndescription: Check the workspace\n---\nRun checks.',
      'demo/agents/helper.md': '---\ndescription: Helper agent\n---\nHelp with the task.',
      'demo/mcp.json': JSON.stringify([{ name: 'demo-tools', type: 'local', command: ['node', 'server.js'], enabled: true }]),
      'demo/README.md': 'Fixture',
    });
    const preview = await project.plugins.preview(path);
    assert.equal(preview.manifest.id, 'demo');
    assert.match(preview.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(preview.capabilities, { skills: ['review'], commands: ['check'], agents: ['helper'], mcp: ['demo-tools'], code: [] });
    assert.equal(preview.code.length, 0);
    const record = await project.plugins.install(preview.token, false);
    assert.equal(record.id, 'demo');
    assert.equal(record.enabled, true);
    assert.equal(record.codeApproved, false);
    assert.equal(record.digest, preview.digest);
    assert.equal(await project.plugins.exists('demo'), true);
  } finally { await project.dispose(); }
});

test('requires explicit consent before installing or activating plugin code', async () => {
  const project = await workspace();
  try {
    const path = await archive(project.root, 'coded', {
      'relay-plugin.json': manifest('coded'),
      'plugins/hooks.js': 'export const Hooks = async () => ({})\n',
    });
    const first = await project.plugins.preview(path);
    assert.deepEqual(first.capabilities.code, ['hooks.js']);
    assert.deepEqual(first.code.map((entry) => entry.path), ['plugins/hooks.js']);
    await assert.rejects(() => project.plugins.install(first.token, false), /executable code/i);
    const second = await project.plugins.preview(path);
    const record = await project.plugins.install(second.token, true);
    assert.equal(record.codeApproved, true);
  } finally { await project.dispose(); }
});

test('rejects traversal, absolute paths and unknown root files', async () => {
  const project = await workspace();
  try {
    const traversal = await archive(project.root, 'traversal', {
      'relay-plugin.json': manifest(),
      '../escape.txt': 'no',
    });
    await assert.rejects(() => project.plugins.preview(traversal), /unsafe|path/i);
    const absolute = await archive(project.root, 'absolute', {
      'relay-plugin.json': manifest(),
      '/tmp/escape.txt': 'no',
    });
    await assert.rejects(() => project.plugins.preview(absolute), /unsafe|path/i);
    const unknown = await archive(project.root, 'unknown', {
      'relay-plugin.json': manifest(),
      'install.sh': 'echo no',
    });
    await assert.rejects(() => project.plugins.preview(unknown), /unsupported/i);
    const malformed = await archive(project.root, 'malformed', {
      'relay-plugin.json': JSON.stringify({ id: 'Bad Id', name: 'x', version: '1.0.0' }),
    });
    await assert.rejects(() => project.plugins.preview(malformed), /identifier|id/i);
  } finally { await project.dispose(); }
});

test('syncs only enabled plugin capabilities into the engine config directory', async () => {
  const project = await workspace();
  try {
    const first = await archive(project.root, 'alpha', {
      'relay-plugin.json': manifest('alpha'),
      'skills/alpha/SKILL.md': '---\nname: Alpha\n---\nAlpha skill.',
      'commands/alpha.md': '---\ndescription: Alpha command\n---\nAlpha.',
      'agents/alpha.md': '---\ndescription: Alpha agent\n---\nAlpha agent.',
      'plugins/alpha.js': 'export const Alpha = async () => ({})\n',
    });
    const second = await archive(project.root, 'beta', {
      'relay-plugin.json': manifest('beta'),
      'commands/beta.md': '---\ndescription: Beta command\n---\nBeta.',
    });
    const alpha = await project.plugins.install((await project.plugins.preview(first)).token, true);
    const beta = await project.plugins.install((await project.plugins.preview(second)).token, false);
    const config = join(project.root, 'engine', 'config');
    await project.plugins.syncConfig(config, [alpha, beta]);
    assert.equal(existsSync(join(config, 'skills', 'alpha', 'SKILL.md')), true);
    assert.equal(existsSync(join(config, 'commands', 'alpha.md')), true);
    assert.equal(existsSync(join(config, 'agents', 'alpha.md')), true);
    assert.equal(existsSync(join(config, 'plugins', 'alpha.js')), true);
    assert.equal(existsSync(join(config, 'commands', 'beta.md')), true);
    await project.plugins.syncConfig(config, [{ ...alpha, enabled: false } satisfies PluginRecord, beta]);
    assert.equal(existsSync(join(config, 'skills', 'alpha', 'SKILL.md')), false);
    assert.equal(existsSync(join(config, 'commands', 'alpha.md')), false);
    assert.equal(existsSync(join(config, 'plugins', 'alpha.js')), false);
    assert.equal(existsSync(join(config, 'commands', 'beta.md')), true);
    await project.plugins.syncConfig(config, []);
    assert.equal(existsSync(join(config, 'commands')), false);
  } finally { await project.dispose(); }
});

test('reads plugin MCP declarations and lets user servers win on name conflicts', async () => {
  const project = await workspace();
  try {
    const path = await archive(project.root, 'mcp', {
      'relay-plugin.json': manifest('mcp'),
      'mcp.json': JSON.stringify({ servers: [{ name: 'shared', type: 'remote', url: 'https://plugin.example/mcp', enabled: true }] }),
    });
    const record = await project.plugins.install((await project.plugins.preview(path)).token, false);
    assert.deepEqual(await project.plugins.mcpServers([record]), [{ name: 'shared', type: 'remote', url: 'https://plugin.example/mcp', enabled: true }]);
    assert.deepEqual(mergeMcpServers([{ name: 'shared', type: 'local', command: ['user-server'], enabled: true }], await project.plugins.mcpServers([record])), [
      { name: 'shared', type: 'local', command: ['user-server'], enabled: true },
    ]);
    const invalid = await archive(project.root, 'invalid-mcp', {
      'relay-plugin.json': manifest('invalid-mcp'),
      'mcp.json': JSON.stringify([{ name: 'bad', type: 'remote', url: 'file:///etc/passwd', enabled: true }]),
    });
    await assert.rejects(() => project.plugins.preview(invalid), /URL|http/i);
  } finally { await project.dispose(); }
});

test('installed plugin files stay in the managed plugin directory', async () => {
  const project = await workspace();
  try {
    const path = await archive(project.root, 'layout', {
      'relay-plugin.json': manifest('layout'),
      'skills/layout/SKILL.md': '---\nname: Layout\n---\nLayout.',
    });
    await project.plugins.install((await project.plugins.preview(path)).token, false);
    const contents = await readFile(join(project.root, 'plugins', 'layout', 'relay-plugin.json'), 'utf8');
    assert.match(contents, /"id":\s*"layout"/);
  } finally { await project.dispose(); }
});
