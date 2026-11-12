import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { engineConfigForTests, readAttachment, withinRoot } from '../src/main/engine.js';

test('sidecar environment carries a config path, never provider keys or host secrets', () => {
  process.env.RELAY_TEST_HOST_SECRET = 'host-secret-value';
  try {
    const env = engineConfigForTests.sidecarEnvironment('/tmp/relay-engine', 'session-password', '/tmp/relay-engine/opencode.json');
    assert.equal(env.OPENCODE_CONFIG, '/tmp/relay-engine/opencode.json');
    assert.equal(env.OPENCODE_CONFIG_CONTENT, undefined);
    assert.equal(env.RELAY_TEST_HOST_SECRET, undefined);
    assert.equal(env.OPENCODE_PASSWORD, 'session-password');
    assert.ok(env.PATH);
    assert.equal(env.HOME, '/tmp/relay-engine/home');
  } finally {
    delete process.env.RELAY_TEST_HOST_SECRET;
  }
});

test('access levels map to real permission rules', () => {
  const read = engineConfigForTests.sessionRules('read');
  for (const action of ['write', 'edit', 'shell', 'task']) {
    assert.ok(read.some((rule) => rule.action === action && rule.effect === 'deny'), `${action} must be denied`);
  }
  const ask = engineConfigForTests.sessionRules('ask');
  assert.ok(ask.some((rule) => rule.action === '*' && rule.effect === 'ask'));
  assert.equal(ask.some((rule) => rule.action === 'shell' && rule.effect === 'deny'), false);
  const auto = engineConfigForTests.sessionRules('auto');
  assert.ok(auto.some((rule) => rule.action === 'edit' && rule.effect === 'allow'));
  assert.ok(auto.some((rule) => rule.action === 'write' && rule.effect === 'allow'));
  assert.ok(auto.some((rule) => rule.action === '*' && rule.effect === 'ask'));
  assert.equal(auto.some((rule) => rule.effect === 'allow' && rule.action === 'shell'), false);
  const full = engineConfigForTests.sessionRules('full');
  assert.ok(full.some((rule) => rule.action === '*' && rule.effect === 'allow'));
  assert.ok(full.some((rule) => rule.action === 'task' && rule.effect === 'deny'));
});

test('the engine config points OpenCode at each installed skill directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-skills-'));
  await mkdir(join(root, 'alpha'), { recursive: true });
  await writeFile(join(root, 'alpha', 'SKILL.md'), '---\nname: Alpha\n---\nA.\n');
  await mkdir(join(root, 'beta'), { recursive: true });
  await writeFile(join(root, 'beta', 'SKILL.md'), '---\nname: Beta\n---\nB.\n');
  await mkdir(join(root, 'notes'), { recursive: true });
  await mkdir(join(root, 'nested', 'hidden-skill'), { recursive: true });
  await writeFile(join(root, 'nested', 'hidden-skill', 'SKILL.md'), '---\nname: Nested\n---\nN.\n');
  await mkdir(join(root, '.staging', 'tmp'), { recursive: true });
  await writeFile(join(root, '.staging', 'tmp', 'SKILL.md'), '---\nname: Staged\n---\nS.\n');
  try {
    const directories = await engineConfigForTests.installedSkillDirectories(root);
    assert.deepEqual(directories, [join(root, 'alpha'), join(root, 'beta')]);
    const config = JSON.parse(engineConfigForTests.providerConfig([], [], directories)) as { skills?: string[] };
    assert.deepEqual(config.skills, [join(root, 'alpha'), join(root, 'beta')]);
    const empty = JSON.parse(engineConfigForTests.providerConfig([], [], [])) as { skills?: string[] };
    assert.equal(empty.skills, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('path containment holds on Windows drives and stays case-insensitive', () => {
  assert.equal(withinRoot('C:\\Users\\Me\\Project', 'C:\\Users\\Me\\Project\\src\\a.ts', 'win32'), true);
  assert.equal(withinRoot('C:\\Users\\Me\\Project', 'c:\\users\\me\\project\\src\\a.ts', 'win32'), true);
  assert.equal(withinRoot('C:\\Users\\Me\\Project', 'C:\\Users\\Me\\Project-other\\a.ts', 'win32'), false);
  assert.equal(withinRoot('C:\\Users\\Me\\Project', 'C:\\Users\\Me\\Project\\..\\secret.txt', 'win32'), false);
  assert.equal(withinRoot('C:\\Users\\Me\\Project', 'D:\\Project\\a.ts', 'win32'), false);
  assert.equal(withinRoot('/work/app', '/work/app/src/a.ts', 'linux'), true);
  assert.equal(withinRoot('/work/app', '/work/application/a.ts', 'linux'), false);
  assert.equal(withinRoot('/work/app', '/work/app/../secret', 'linux'), false);
});

test('the sidecar home follows Windows conventions', () => {
  const env = engineConfigForTests.sidecarEnvironment('C:\\Relay\\engine', 'session-password', 'C:\\Relay\\engine\\opencode.json', 'win32');
  assert.equal(env.USERPROFILE, win32.join('C:\\Relay\\engine', 'home'));
  assert.equal(env.APPDATA, win32.join('C:\\Relay\\engine', 'home', 'AppData', 'Roaming'));
  assert.equal(env.LOCALAPPDATA, win32.join('C:\\Relay\\engine', 'home', 'AppData', 'Local'));
  assert.equal(env.OPENCODE_CONFIG, 'C:\\Relay\\engine\\opencode.json');
});

test('attachments resolve only regular files inside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-attach-'));
  const workspace = join(root, 'project');
  await mkdir(join(workspace, 'src'), { recursive: true });
  await writeFile(join(workspace, 'src', 'app.ts'), 'export {};\n');
  await writeFile(join(root, 'outside.txt'), 'outside');
  try {
    const file = await readAttachment(workspace, 'src/app.ts');
    assert.equal(file.name, 'app.ts');
    assert.equal(Buffer.from(file.data, 'base64').toString(), 'export {};\n');
    assert.equal(file.mime, 'text/plain');
    await assert.rejects(() => readAttachment(workspace, '../outside.txt'));
    await assert.rejects(() => readAttachment(workspace, join(workspace, 'src/app.ts')));
    await assert.rejects(() => readAttachment(workspace, 'src'));
    await symlink(join(root, 'outside.txt'), join(workspace, 'link.txt'));
    await assert.rejects(() => readAttachment(workspace, 'link.txt'));
    await writeFile(join(workspace, 'big.txt'), 'x'.repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(() => readAttachment(workspace, 'big.txt'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
