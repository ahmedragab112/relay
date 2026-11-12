import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore, validateProvider, validateMcp } from '../src/main/settings.js';

const codec = {
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString(),
};

test('settings persist preferences and never expose or store plaintext keys', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = new SettingsStore(root, codec);
  await settings.load();
  await settings.saveProvider({ id: 'openai', apiKey: 'test-private-api-key' });
  await settings.savePreferences({ theme: 'light', defaultModel: 'openai/gpt-test' });
  assert.equal(settings.publicProviders()[0].hasKey, true);
  assert.equal(JSON.stringify(settings.publicProviders()).includes('test-private'), false);
  assert.equal((await readFile(join(root, 'settings.json'), 'utf8')).includes('test-private'), false);
  assert.equal(settings.runtimeProviders()[0].apiKey, 'test-private-api-key');
  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.equal(restored.preferences.theme, 'light');
  await restored.saveProvider({ id: 'openai', apiKey: '' });
  assert.equal(restored.runtimeProviders()[0].apiKey, 'test-private-api-key');
  await restored.removeProvider('openai');
  assert.deepEqual(restored.publicProviders(), []);
});

test('settings discard unsafe provider and MCP entries when loading from disk', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'settings.json'), JSON.stringify({
    version: 1,
    preferences: { theme: 'neon', defaultModel: 42, activeWorkspaceId: 'missing' },
    workspaces: [{ id: 'ok', path: '/tmp/project', name: 'project', lastOpened: 1 }],
    providers: [
      { id: 'evil-provider' },
      { id: 'custom', baseURL: 'http://example.com/v1', models: ['remote-http'] },
      { id: 'openai', encryptedKey: 'v1:stored' },
    ],
    mcp: [
      { name: 'insecure', type: 'remote', url: 'http://example.com/mcp', enabled: true },
      { name: 'broken', type: 'local', command: [42], enabled: false },
      { name: 'safe', type: 'remote', url: 'https://example.com/mcp', enabled: false },
    ],
  }));
  const store = new SettingsStore(root, codec);
  await store.load();
  assert.equal(store.preferences.theme, 'dark');
  assert.equal(store.preferences.defaultModel, '');
  assert.equal(store.workspace, undefined);
  assert.deepEqual(store.publicProviders().map(provider => provider.id), ['openai']);
  assert.equal(store.publicProviders()[0].hasKey, true);
  assert.deepEqual(store.mcp.map(server => server.name), ['safe']);
});

test('plugin records persist, toggle, remove and drop malformed entries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(root, codec);
  await store.load();
  const record = {
    id: 'alpha', name: 'Alpha plugin', version: '1.0.0', description: 'Fixture', digest: 'a'.repeat(64),
    enabled: true, installedAt: 1, codeApproved: false,
    capabilities: { skills: ['review'], commands: ['check'], agents: [], mcp: [], code: [] },
  };
  await store.savePlugins([record]);
  assert.deepEqual(store.plugins.map(plugin => plugin.id), ['alpha']);
  await store.setPluginEnabled('alpha', false);
  assert.equal(store.plugins[0].enabled, false);
  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.equal(restored.plugins[0].enabled, false);
  await restored.savePlugins([
    { ...record, id: '../escape' },
    { ...record, id: 'beta', digest: 'not-a-digest' },
    { ...record, id: 'gamma', capabilities: { skills: [42 as unknown as string], commands: [], agents: [], mcp: [], code: [] } },
  ]);
  assert.deepEqual(restored.plugins, []);
  await restored.savePlugins([record]);
  await restored.removePlugin('alpha');
  assert.deepEqual(restored.plugins, []);
});

test('provider and MCP inputs reject unsafe endpoints and malformed commands', () => {
  assert.throws(() => validateProvider({ id: 'custom', baseURL: 'file:///etc/passwd', models: ['x'] }), /HTTPS|URL/i);
  assert.throws(() => validateProvider({ id: 'custom', baseURL: 'http://example.com/v1', apiKey: 'key', models: ['x'] }), /HTTPS/i);
  assert.throws(() => validateProvider({ id: 'custom', baseURL: 'https://user:pass@example.com', models: ['x'] }), /credentials/i);
  assert.doesNotThrow(() => validateProvider({ id: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', models: ['qwen3'] }));
  assert.doesNotThrow(() => validateProvider({ id: 'groq', models: ['llama-3.3-70b-versatile'] }));
  assert.throws(() => validateProvider({ id: 'not-a-provider' as never }), /supported provider/i);
  assert.throws(() => validateMcp({ name: '../bad', type: 'local', command: ['node'], enabled: true }), /name/i);
  assert.throws(() => validateMcp({ name: 'empty', type: 'local', command: [], enabled: true }), /command/i);
  assert.doesNotThrow(() => validateMcp({ name: 'local-tool', type: 'local', command: ['node', '/tmp/server.js'], enabled: false }));
});

test('cloud providers require a key while local providers and legacy model IDs stay usable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(root, codec);
  await store.load();
  await assert.rejects(() => store.saveProvider({ id: 'groq' }), /API key/i);
  await store.saveProvider({ id: 'groq', apiKey: 'groq-key' });
  await store.saveProvider({ id: 'ollama', models: ['qwen3:8b'] });
  assert.deepEqual(store.publicProviders().map(provider => provider.id), ['groq', 'ollama']);
  assert.deepEqual(store.publicProviders()[1].models, ['qwen3:8b']);
  await store.savePreferences({ defaultAccess: 'auto', modelVariant: 'high' });
  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.equal(restored.preferences.defaultAccess, 'auto');
  assert.equal(restored.preferences.modelVariant, 'high');
  await writeFile(join(root, 'settings.json'), JSON.stringify({
    version: 1,
    preferences: { theme: 'dark', defaultModel: '', defaultAccess: 'unsafe' },
    workspaces: [],
    providers: [{ id: 'custom', baseURL: 'https://example.com/v1', modelID: 'legacy-model' }],
    mcp: [],
  }));
  const legacy = new SettingsStore(root, codec);
  await legacy.load();
  assert.deepEqual(legacy.publicProviders()[0].models, ['legacy-model']);
  assert.equal(legacy.preferences.defaultAccess, 'ask');
  assert.equal(legacy.preferences.modelVariant, '');
});

test('dictation preferences persist and reject invalid choices', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(root, codec);
  await store.load();
  assert.equal(store.preferences.dictation.provider, 'groq');
  await store.savePreferences({ dictation: { provider: 'openai', model: 'whisper-1' } });
  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.deepEqual(restored.preferences.dictation, { provider: 'openai', model: 'whisper-1' });
  await assert.rejects(() => restored.savePreferences({ dictation: { provider: 'opencode' as never, model: 'whisper-1' } }), /provider/i);
  await assert.rejects(() => restored.savePreferences({ dictation: { provider: 'groq', model: '  ' } }), /model/i);
  assert.deepEqual(restored.preferences.dictation, { provider: 'openai', model: 'whisper-1' });
});

test('general and context preferences merge partial updates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(root, codec);
  await store.load();
  assert.equal(store.preferences.general.inputWhileRunning, true);
  assert.equal(store.preferences.general.showThinking, true);
  assert.equal(store.preferences.general.conversationDisplay, 'comfortable');
  assert.equal(store.preferences.context.autoCompact, false);
  assert.equal(store.preferences.context.compactThreshold, 80);
  assert.deepEqual(store.preferences.archivedSessions, []);

  await store.savePreferences({ general: { turnNotifications: false, conversationDisplay: 'compact' } });
  assert.equal(store.preferences.general.turnNotifications, false);
  assert.equal(store.preferences.general.showThinking, true);
  await store.savePreferences({ context: { autoCompact: true } });
  assert.equal(store.preferences.context.autoCompact, true);
  assert.equal(store.preferences.context.compactThreshold, 80);
  await assert.rejects(() => store.savePreferences({ general: { conversationDisplay: 'fancy' as never } }), /display/i);
  await assert.rejects(() => store.savePreferences({ general: { artifactDir: 'relative/path' } }), /absolute/i);
  await assert.rejects(() => store.savePreferences({ context: { compactThreshold: 20 } }), /threshold/i);
  await store.savePreferences({ general: { artifactDir: '/tmp/relay artifacts' } });

  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.equal(restored.preferences.general.conversationDisplay, 'compact');
  assert.equal(restored.preferences.general.artifactDir, '/tmp/relay artifacts');
  assert.equal(restored.preferences.context.autoCompact, true);
});

test('the skill registry URL must be a credential-free HTTPS address', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(root, codec);
  await store.load();
  assert.equal(store.preferences.general.skillRegistry, '');
  await assert.rejects(() => store.savePreferences({ general: { skillRegistry: 'http://example.com/skills.json' } }), /HTTPS/i);
  await assert.rejects(() => store.savePreferences({ general: { skillRegistry: 'https://user:pass@example.com/skills.json' } }), /credentials/i);
  await store.savePreferences({ general: { skillRegistry: 'https://example.com/skills.json' } });
  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.equal(restored.preferences.general.skillRegistry, 'https://example.com/skills.json');
  await restored.savePreferences({ general: { skillRegistry: '' } });
  assert.equal(restored.preferences.general.skillRegistry, '');
});

test('archived task ids persist uniquely and sanitize malformed entries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(root, codec);
  await store.load();
  await store.archiveSession('task-one');
  await store.archiveSession('task-one');
  assert.deepEqual(store.preferences.archivedSessions, ['task-one']);
  await store.archiveSession('task-two');
  assert.deepEqual(store.preferences.archivedSessions, ['task-one', 'task-two']);
  await store.restoreSession('task-one');
  assert.deepEqual(store.preferences.archivedSessions, ['task-two']);

  await writeFile(join(root, 'settings.json'), JSON.stringify({
    version: 1,
    preferences: {
      theme: 'dark',
      general: { conversationDisplay: 'fancy', showThinking: 'yes', artifactDir: 'relative', inputWhileRunning: false },
      context: { autoCompact: true, compactThreshold: 500, shareProject: false },
      archivedSessions: ['../escape', 'keep-me', 'keep-me'],
    },
    workspaces: [], providers: [], mcp: [],
  }));
  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.equal(restored.preferences.general.conversationDisplay, 'comfortable');
  assert.equal(restored.preferences.general.showThinking, true);
  assert.equal(restored.preferences.general.artifactDir, '');
  assert.equal(restored.preferences.general.inputWhileRunning, false);
  assert.equal(restored.preferences.context.autoCompact, true);
  assert.equal(restored.preferences.context.compactThreshold, 80);
  assert.equal(restored.preferences.context.shareProject, false);
  assert.deepEqual(restored.preferences.archivedSessions, ['keep-me']);
});

test('message reactions persist per task and toggle off', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(root, codec);
  await store.load();
  assert.equal(store.reaction('task-a', 'msg-1'), undefined);
  await store.setReaction('task-a', 'msg-1', 'like');
  await store.setReaction('task-a', 'msg-2', 'dislike');
  assert.deepEqual(store.reactions('task-a'), { 'msg-1': 'like', 'msg-2': 'dislike' });
  assert.deepEqual(store.reactions('task-b'), {});
  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.equal(restored.reaction('task-a', 'msg-2'), 'dislike');
  await restored.setReaction('task-a', 'msg-2', null);
  assert.deepEqual(restored.reactions('task-a'), { 'msg-1': 'like' });
  await restored.setReaction('task-a', 'msg-2', null);
  assert.deepEqual(restored.reactions('task-a'), { 'msg-1': 'like' });
});

test('message reactions reject malformed ids and values and drop bad stored rows', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SettingsStore(root, codec);
  await store.load();
  await assert.rejects(() => store.setReaction('', 'msg', 'like'));
  await assert.rejects(() => store.setReaction('task', '', 'like'));
  await assert.rejects(() => store.setReaction('task', 'msg', 'love' as never));
  await assert.rejects(() => store.setReaction('a'.repeat(257), 'msg', 'like'));
  await writeFile(join(root, 'settings.json'), JSON.stringify({
    version: 1,
    preferences: {},
    workspaces: [], providers: [], mcp: [],
    reactions: [
      { session: 'task', message: 'bad-value', value: 'love' },
      { session: '', message: 'no-task', value: 'like' },
      { session: 'task', message: 'good', value: 'like' },
      { session: 'task', message: 'good', value: 'dislike' },
      { session: 'task', message: 'x'.repeat(257), value: 'like' },
    ],
  }));
  const restored = new SettingsStore(root, codec);
  await restored.load();
  assert.deepEqual(restored.reactions('task'), { good: 'dislike' });
  assert.deepEqual(restored.reactions(''), {});
});

test('message reactions keep the newest occurrences when loading a large file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reactions = Array.from({ length: 2002 }, (_, index) => ({ session: 'task', message: `msg-${index}`, value: 'like' }));
  await writeFile(join(root, 'settings.json'), JSON.stringify({
    version: 1, preferences: {}, workspaces: [], providers: [], mcp: [], reactions,
  }));
  const store = new SettingsStore(root, codec);
  await store.load();
  const kept = store.reactions('task');
  assert.equal(Object.keys(kept).length, 2000);
  assert.equal(kept['msg-0'], undefined);
  assert.equal(kept['msg-1'], undefined);
  assert.equal(kept['msg-2001'], 'like');
});
