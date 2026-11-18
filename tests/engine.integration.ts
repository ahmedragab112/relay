import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { Engine } from '../src/main/engine.js';
import { PluginManager } from '../src/main/plugins.js';
import type { AppEvent } from '../src/shared/contracts.js';

function pluginArchive(): Uint8Array {
  return zipSync({
    'relay-plugin.json': strToU8(JSON.stringify({ id: 'alpha', name: 'Alpha plugin', version: '1.0.0', description: 'Engine fixture' })),
    'commands/check.md': strToU8('---\ndescription: Check the workspace\n---\nCheck the workspace and report findings.\n'),
    'skills/review/SKILL.md': strToU8('---\nname: review\ndescription: Review the working tree\n---\nReview the current working tree carefully.\n'),
    'agents/helper.md': strToU8('---\ndescription: Helpful agent\nmode: primary\n---\nYou are a careful helper.\n'),
  });
}

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for engine state');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('real pinned engine persists sessions, enforces approvals and streams a workspace terminal', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-engine-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  await writeFile(join(workspace, 'example.txt'), 'hello');
  const events: AppEvent[] = [];
  const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), (event) => events.push(event));
  try {
    await engine.start(workspace, [], []);
    assert.equal(engine.status.state, 'ready');
    assert.equal(engine.status.version, '2.2.6');
    const session = await engine.createSession('Integration task');
    assert.equal((await engine.listSessions())[0].id, session.id);
    await engine.renameSession(session.id, 'Renamed task');
    assert.equal((await engine.listSessions())[0].title, 'Renamed task');
    assert.deepEqual(await engine.getMessages(session.id), []);
    await engine.waitForIdle(session.id);
    const pending = await engine.client.permission.create({ sessionID: session.id, action: 'shell', resources: ['printf test'], agent: 'build' });
    assert.equal(pending.effect, 'ask');
    await waitFor(async () => (await engine.listPermissions()).length === 1);
    const [permission] = await engine.listPermissions();
    assert.equal(permission.sessionId, session.id);
    assert.equal(permission.permission, 'shell');
    await engine.replyPermission(permission.id, 'reject');
    assert.equal((await engine.listPermissions()).length, 0);
    const terminal = await engine.createTerminal(80, 24);
    await engine.writeTerminal(terminal.id, "printf 'RELAY_%s\\n' 'TERMINAL_OK'\r");
    await waitFor(() => events.some((event) => event.type === 'terminal-data' && event.data.includes('RELAY_TERMINAL_OK')));
    await engine.closeTerminal(terminal.id);
    await engine.stop();
    await engine.start(workspace, [], []);
    assert.equal((await engine.listSessions())[0].title, 'Renamed task');
    await engine.deleteSession(session.id);
    assert.deepEqual(await engine.listSessions(), []);
  } finally {
    await engine.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('silent sessions approve their own permissions and stay out of attention', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-engine-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  await writeFile(join(workspace, 'example.txt'), 'hello');
  const events: AppEvent[] = [];
  const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), (event) => events.push(event));
  try {
    await engine.start(workspace, [], []);
    const replies: Array<{ requestID: string; decision: string }> = [];
    const permissionClient = engine.client.permission;
    const originalReply = permissionClient.reply.bind(permissionClient);
    permissionClient.reply = async (input: Parameters<typeof originalReply>[0]) => {
      replies.push({ requestID: input.requestID, decision: input.decision });
      return originalReply(input);
    };
    const silent = await engine.createSession('Atlas run');
    engine.silenceSession(silent.id);
    const pending = await engine.client.permission.create({ sessionID: silent.id, action: 'shell', resources: ['printf silent'], agent: 'build' });
    assert.equal(pending.effect, 'ask');
    await waitFor(() => replies.length === 1);
    assert.equal(replies[0].requestID, pending.id);
    assert.equal(replies[0].decision, 'once');
    assert.equal((await engine.listPermissions()).length, 0);
    assert.equal((await engine.listAttention()).permissions.length, 0);
    assert.equal(events.some((event) => event.type === 'permission'), false);
    const visible = await engine.createSession('Visible task');
    await engine.client.permission.create({ sessionID: visible.id, action: 'shell', resources: ['printf visible'], agent: 'build' });
    await waitFor(async () => (await engine.listPermissions()).some((item) => item.sessionId === visible.id));
    assert.ok(events.some((event) => event.type === 'permission' && event.request.sessionId === visible.id));
  } finally {
    await engine.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('terminal never inherits host secrets or provider credentials, and config is private', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-engine-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  const configPath = join(root, 'engine', 'opencode.json');
  const events: AppEvent[] = [];
  process.env.RELAY_TEST_TERMINAL_SECRET = 'host-secret-terminal-value';
  const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), (event) => events.push(event));
  try {
    await engine.start(workspace, [{ id: 'openai', apiKey: 'sk-provider-secret-value' }], []);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    const terminal = await engine.createTerminal(100, 30);
    await engine.writeTerminal(terminal.id, "printf 'ENV_%s\\n' BEGIN; env; printf 'ENV_%s\\n' END\r");
    await waitFor(() => events.filter((event) => event.type === 'terminal-data').map((event) => event.data).join('').includes('ENV_END'));
    const output = events.filter((event) => event.type === 'terminal-data').map((event) => event.data).join('');
    assert.doesNotMatch(output, /host-secret-terminal-value/);
    assert.doesNotMatch(output, /sk-provider-secret-value/);
    await engine.closeTerminal(terminal.id);
    await engine.stop();
    await assert.rejects(() => access(configPath));
    events.length = 0;
    await engine.start(workspace, [], []);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(events.some((event) => event.type === 'error' && event.message.includes('interrupted')), false);
  } finally {
    delete process.env.RELAY_TEST_TERMINAL_SECRET;
    await engine.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('installed plugin commands, skills and agents survive an engine restart', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-engine-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  const archive = join(root, 'alpha.zip');
  await writeFile(archive, pluginArchive());
  const plugins = new PluginManager(join(root, 'engine', 'plugins'));
  await plugins.cleanup();
  const preview = await plugins.preview(archive);
  const record = await plugins.install(preview.token, false);
  assert.equal(record.id, 'alpha');
  await plugins.syncConfig(join(root, 'engine', 'config', 'opencode'), [record]);
  const events: AppEvent[] = [];
  const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), (event) => events.push(event));
  try {
    await engine.start(workspace, [], []);
    await waitFor(async () => (await engine.listCommands()).some((command) => command.name === 'check'));
    await waitFor(async () => (await engine.listSkills()).some((skill) => skill.id === 'review'));
    const check = (await engine.listCommands()).find((command) => command.name === 'check');
    assert.match(check?.description ?? '', /Check the workspace/);
    assert.ok((await engine.listSkills()).some((skill) => skill.id === 'review'));
    assert.ok((await engine.listAgents()).some((agent) => agent.name === 'helper'));
    await engine.stop();
    await engine.start(workspace, [], []);
    await waitFor(async () => (await engine.listCommands()).some((command) => command.name === 'check'));
    await waitFor(async () => (await engine.listSkills()).some((skill) => skill.id === 'review'));
    await assert.rejects(
      () => engine.runCommand({ sessionId: 'missing', name: 'absent', text: '', model: 'openai::none', variant: '', access: 'ask', files: [], skills: [] }),
      /available command/i,
    );
    await plugins.syncConfig(join(root, 'engine', 'config', 'opencode'), [{ ...record, enabled: false }]);
    await engine.stop();
    await engine.start(workspace, [], []);
    await waitFor(async () => (await engine.listCommands()).some((command) => command.name === 'init'));
    await waitFor(async () => (await engine.listSkills()).some((skill) => skill.id === 'browser'));
    assert.equal((await engine.listCommands()).some((command) => command.name === 'check'), false);
    assert.equal((await engine.listSkills()).some((skill) => skill.id === 'review'), false);
    assert.equal((await engine.listAgents()).some((agent) => agent.name === 'helper'), false);
  } finally {
    await engine.stop();
    await plugins.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
