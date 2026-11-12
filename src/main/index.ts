import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, Notification, safeStorage, session, shell, systemPreferences, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import type {
  AccessLevel, AgentMode, AppEvent, AppState, AutomationJob, AutomationState, ContextBlock, McpServer, PermissionDecision, PluginCatalogEntry, PluginView, PreferencesPatch, ProviderInput, RunCommandInput, SendMessageInput,
} from '../shared/contracts.js';
import { Engine } from './engine.js';
import { finishAlert } from './alerts.js';
import { AutomationStore, Scheduler, validateJobInput } from './schedules.js';
import { transcribe, transcriptionTarget, validateAudio } from './dictation.js';
import { downloadPluginPackage } from './import.js';
import { mergeMcpServers, PluginManager } from './plugins.js';
import { SkillRegistry } from './registry.js';
import { undoFileChange } from './revert.js';
import { text, identifier, isTrustedRenderer, validateExternalURL, dimensions } from './security.js';
import { SettingsStore, validateMcp, type SecretCodec } from './settings.js';
import { SkillLibrary } from './skills.js';
import { SkillCatalog } from './skills-catalog.js';
import { WorkspaceFiles } from './workspace.js';
import { accentColor, applicationMenu, credentialStoreLabel, windowChrome, windowMaterial, type Platform } from './platform.js';
import { engineBinaryName } from '../shared/engine-target.js';

let window: BrowserWindow | undefined;
let store: SettingsStore;
let engine: Engine;
let plugins: PluginManager;
let skillLibrary: SkillLibrary;
const skillRegistry = new SkillRegistry();
let automation: AutomationStore;
let scheduler: Scheduler;
let engineRoot = '';
let files: WorkspaceFiles | undefined;
let expectedURL = '';
let restarting: Promise<void> = Promise.resolve();
let shuttingDown = false;
const confirmedTerminals = new Set<string>();
const sessionTitles = new Map<string, string>();
const material = windowMaterial(process.platform as Platform, os.release());

function codec(): SecretCodec {
  const store = credentialStoreLabel(process.platform as Platform);
  return {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error(`${store} encryption is unavailable. Provider keys were not saved.`);
      return `v1:${safeStorage.encryptString(value).toString('base64')}`;
    },
    decrypt(value) {
      if (!value.startsWith('v1:')) throw new Error('Stored credentials use an unsupported format.');
      if (!safeStorage.isEncryptionAvailable()) throw new Error(`${store} encryption is unavailable. Stored provider keys cannot be read.`);
      return safeStorage.decryptString(Buffer.from(value.slice(3), 'base64'));
    },
  };
}

function engineBinary(): string {
  const name = engineBinaryName(process.platform);
  return app.isPackaged
    ? join(process.resourcesPath, 'opencode', name)
    : join(app.getAppPath(), 'build', 'engine', name);
}

function catalogDirectory(): string {
  return app.isPackaged ? join(process.resourcesPath, 'catalog') : join(app.getAppPath(), 'catalog');
}

function bundledSkillsDirectory(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bundled-skills') : join(app.getAppPath(), 'bundled-skills');
}

function bundledSkillCatalog(): SkillCatalog {
  return new SkillCatalog(bundledSkillsDirectory());
}

const BROWSER_PARTITION = 'persist:relay-browser';

function browserURL(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
  catch { return false; }
}

// The in-editor browser is a webview; force least privilege on every guest.
function hardenGuest(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!browserURL(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => { if (!browserURL(url)) event.preventDefault(); });
  contents.on('will-prevent-unload', event => event.preventDefault());
  contents.on('render-process-gone', (_event, details) => emit({ type: 'error', message: `Embedded browser stopped: ${details.reason}` }));
}

function prepareBrowserSession(): void {
  const isolated = session.fromPartition(BROWSER_PARTITION);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', event => event.preventDefault());
}

function emit(event: AppEvent): void {
  const delivered = event.type === 'session-idle' ? finishEvent(event) : event;
  if (window && !window.isDestroyed()) window.webContents.send('app:event', delivered);
}

// One alert per finished turn: the system notification owns the sound in the background,
// otherwise the chat rings its own chime.
function finishEvent(event: Extract<AppEvent, { type: 'session-idle' }>): AppEvent {
  const general = store?.preferences.general;
  if (!general) return event;
  const alert = finishAlert({
    notifications: general.turnNotifications,
    sound: general.turnSound,
    focused: Boolean(window && !window.isDestroyed() && window.isFocused()),
    supported: Notification.isSupported(),
  });
  if (alert === 'notification') {
    const note = new Notification({
      title: sessionTitles.get(event.sessionId) ?? 'Relay task finished',
      body: 'The agent finished this turn. Open Relay to review it.',
    });
    note.on('click', () => {
      window?.show();
      window?.focus();
      emit({ type: 'open-session', sessionId: event.sessionId });
    });
    note.show();
    return event;
  }
  return alert === 'sound' ? { ...event, chime: true } : event;
}

function rememberSessions(items: Array<{ id: string; title: string }>): void {
  for (const item of items) if (item.title) sessionTitles.set(item.id, item.title);
}

function state(): AppState {
  let accent: string | undefined;
  try { accent = accentColor(process.platform as Platform, systemPreferences.getAccentColor()); } catch { accent = undefined; }
  return {
    version: app.getVersion(), platform: process.platform, arch: process.arch, material, accent,
    workspaces: store.workspaces, workspace: store.workspace, preferences: store.preferences,
    providers: store.publicProviders(), engine: engine.status,
  };
}

async function pluginViews(): Promise<PluginView[]> {
  const views: PluginView[] = [];
  for (const record of store.plugins) views.push({ ...record, available: await plugins.exists(record.id) });
  return views;
}

function automationState(): AutomationState {
  return { jobs: automation.jobs, runs: automation.runs };
}

function announceAutomation(): void {
  emit({ type: 'automation', jobs: automation.jobs, runs: automation.runs });
}

async function restart(): Promise<void> {
  const previous = restarting;
  restarting = (async () => {
    await previous;
    await engine.stop();
    const workspace = store.workspace;
    files = workspace ? new WorkspaceFiles(workspace.path) : undefined;
    try { await plugins.syncConfig(join(engineRoot, 'config', 'opencode'), store.plugins); }
    catch (error) { emit({ type: 'error', message: `Plugin configuration could not be written: ${error instanceof Error ? error.message : 'unknown error'}` }); }
    if (!workspace) { engine.status = { state: 'stopped', detail: 'Open a project to start the engine' }; emit({ type: 'engine', status: engine.status }); return; }
    let providers: ProviderInput[];
    try { providers = store.runtimeProviders(); }
    catch (error) {
      engine.status = { state: 'error', detail: error instanceof Error ? error.message : 'Stored provider keys could not be read.' };
      emit({ type: 'engine', status: engine.status });
      return;
    }
    try {
      const mcp = mergeMcpServers(store.mcp, await plugins.mcpServers(store.plugins));
      await engine.start(workspace.path, providers, mcp, store.workspaces.map((item) => item.path));
    }
    catch { /* engine.status carries the actionable failure */ }
  })();
  await restarting;
}

function define(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!window || event.senderFrame !== window.webContents.mainFrame || !isTrustedRenderer(event.senderFrame.url, expectedURL, true)) throw new Error('Request rejected: untrusted renderer.');
    return handler(event, ...args);
  });
}

function needEngine() {
  if (engine.status.state !== 'ready') throw new Error(`Local engine is ${engine.status.state}: ${engine.status.detail}`);
  return engine;
}

function needFiles() {
  if (!files) throw new Error('Open a project first.');
  return files;
}

function accessOf(value: unknown): AccessLevel {
  if (value !== 'read' && value !== 'ask' && value !== 'auto' && value !== 'full') throw new Error('Invalid access level.');
  return value;
}

function register(): void {
  define('app:state', () => state());
  define('workspace:open', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Open a project in Relay', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Open project' });
    if (result.canceled || !result.filePaths[0]) return null;
    await store.addWorkspace(result.filePaths[0]);
    await restart();
    return state();
  });
  define('workspace:switch', async (_event, id) => { await store.switchWorkspace(identifier(id)); await restart(); return state(); });
  define('sessions:list', async () => {
    const archived = new Set(store.preferences.archivedSessions);
    const items = (await needEngine().listSessions()).filter((item) => !archived.has(item.id));
    rememberSessions(items);
    return items;
  });
  define('sessions:all', async () => {
    const archived = new Set(store.preferences.archivedSessions);
    const items = (await needEngine().listAllSessions()).filter((item) => !archived.has(item.id));
    rememberSessions(items);
    return items;
  });
  define('sessions:archived', async () => {
    const archived = new Set(store.preferences.archivedSessions);
    return (await needEngine().listSessions()).filter((item) => archived.has(item.id));
  });
  define('sessions:create', async (_event, title) => {
    if (!store.workspace) throw new Error('Open a project first.');
    const summary = await needEngine().createSession(text(title ?? 'New task', 'Session title', 512));
    sessionTitles.set(summary.id, summary.title);
    return summary;
  });
  define('sessions:fork', async (_event, id, messageId) => {
    const summary = await needEngine().forkSession(identifier(id), text(messageId, 'Message', 256));
    emit({ type: 'sessions-changed' });
    return summary;
  });
  define('sessions:rename', async (_event, id, title) => {
    const sessionId = identifier(id);
    const clean = text(title, 'Session title', 512);
    await needEngine().renameSession(sessionId, clean);
    sessionTitles.set(sessionId, clean.trim() || 'Untitled task');
  });
  define('sessions:delete', async (_event, id) => needEngine().deleteSession(identifier(id)));
  define('sessions:archive', async (_event, id) => { await store.archiveSession(identifier(id)); emit({ type: 'sessions-changed' }); });
  define('sessions:restore', async (_event, id) => { await store.restoreSession(identifier(id)); emit({ type: 'sessions-changed' }); });
  define('sessions:messages', async (_event, id) => {
    const sessionId = identifier(id);
    const reactions = store.reactions(sessionId);
    return (await needEngine().getMessages(sessionId)).map((message) => reactions[message.id] ? { ...message, reaction: reactions[message.id] } : message);
  });
  define('sessions:react', async (_event, id, messageId, reaction) => {
    if (reaction !== null && reaction !== 'like' && reaction !== 'dislike') throw new Error('Choose like or dislike.');
    await store.setReaction(identifier(id), text(messageId, 'Message', 256), reaction);
  });
  define('clipboard:write', (_event, value) => { clipboard.writeText(text(value, 'Clipboard text', 1_000_000)); });
  define('sessions:usage', async (_event, id) => needEngine().getUsage(identifier(id)));
  define('sessions:compact', async (_event, id) => needEngine().compactSession(identifier(id)));
  define('sessions:digest', async (_event, id) => needEngine().getSessionDigest(identifier(id)));
  define('sessions:send', async (_event, value) => {
    const input = value as SendMessageInput;
    if (!input || typeof input !== 'object' || !Array.isArray(input.files) || !Array.isArray(input.skills)) throw new Error('Invalid message.');
    const context: ContextBlock[] = Array.isArray(input.context)
      ? input.context.slice(0, 6).map((block) => ({ label: text(block?.label, 'Context label', 160), text: text(block?.text, 'Context', 20_000) }))
      : [];
    await needEngine().sendMessage({
      sessionId: identifier(input.sessionId), text: text(input.text, 'Message', 500_000),
      model: text(input.model, 'Model', 512), variant: text(input.variant ?? '', 'Model power', 64), access: accessOf(input.access),
      files: input.files.slice(0, 20).map((file) => text(file, 'Attachment', 4096)),
      skills: input.skills.slice(0, 10).map((skill) => text(skill, 'Skill', 256)),
      agents: Array.isArray(input.agents) ? input.agents.slice(0, 10).map((agent) => text(agent, 'Agent', 128)) : [],
      context,
      planOnly: input.planOnly === true,
      ...(input.delivery === 'steer' || input.delivery === 'queue' ? { delivery: input.delivery } : {}),
    });
  });
  define('sessions:abort', async (_event, id) => needEngine().abortSession(identifier(id)));
  define('sessions:inbox', async (_event, id) => needEngine().listQueuedMessages(identifier(id)));
  define('sessions:inbox-remove', async (_event, id, inboxId) => needEngine().removeQueuedMessage(identifier(id), identifier(inboxId)));
  define('sessions:inbox-steer', async (_event, id, inboxId) => needEngine().steerQueuedMessage(identifier(id), identifier(inboxId)));
  define('sessions:background', async (_event, id) => needEngine().backgroundSession(identifier(id)));
  define('permissions:list', () => needEngine().listPermissions());
  define('permissions:reply', async (_event, id, decision) => {
    if (decision !== 'once' && decision !== 'reject') throw new Error('Invalid permission decision.');
    await needEngine().replyPermission(identifier(id), decision as PermissionDecision);
  });
  define('questions:list', () => needEngine().listQuestions());
  define('questions:answer', async (_event, id, answers) => {
    if (answers !== null && (!Array.isArray(answers) || answers.some((row) => !Array.isArray(row) || row.some((value) => typeof value !== 'string')))) throw new Error('Invalid answers.');
    await needEngine().answerQuestion(identifier(id), answers as string[][] | null);
  });
  define('attention:overview', () => needEngine().listAttention());
  define('activity:background', () => needEngine().listBackgroundWork());
  define('activity:get', async (_event, id) => {
    const registryURL = store?.preferences.general.skillRegistry;
    const webSkills = registryURL ? await skillRegistry.list(registryURL).catch(() => []) : [];
    return needEngine().getActivity(identifier(id), webSkills);
  });
  define('models:list', () => needEngine().listModels());
  define('agents:list', () => needEngine().listAgents());
  define('skills:list', () => needEngine().listSkills());
  define('skills:library', () => skillLibrary.list());
  define('skills:catalog', () => bundledSkillCatalog().list());
  define('skills:catalog-install', async (_event, id) => {
    const key = text(id, 'Skill', 64);
    const files = await bundledSkillCatalog().files(key);
    const preview = await skillLibrary.previewFiles(files, 'Bundled with Relay');
    const list = await skillLibrary.install(preview.token);
    await engine?.refreshSkills(list.map((entry) => entry.id));
    emit({ type: 'skills-changed' });
    return list;
  });
  define('skills:preview', (_event, url, sha256) => skillLibrary.previewURL(url, sha256));
  define('skills:install', async (_event, token) => {
    const list = await skillLibrary.install(text(token, 'Skill preview', 64));
    await engine?.refreshSkills(list.map((entry) => entry.id));
    emit({ type: 'skills-changed' });
    return list;
  });
  define('skills:cancel', async (_event, token) => { await skillLibrary.cancel(text(token, 'Skill preview', 64)); });
  define('skills:remove', async (_event, id) => {
    const list = await skillLibrary.remove(text(id, 'Skill', 64));
    await engine?.refreshSkills();
    emit({ type: 'skills-changed' });
    return list;
  });
  define('commands:list', () => needEngine().listCommands());
  define('commands:run', async (_event, value) => {
    const input = value as RunCommandInput;
    if (!input || typeof input !== 'object' || !Array.isArray(input.files) || !Array.isArray(input.skills)) throw new Error('Invalid command.');
    await needEngine().runCommand({
      sessionId: identifier(input.sessionId),
      name: text(input.name, 'Command', 256),
      text: text(input.text ?? '', 'Command input', 500_000),
      model: text(input.model, 'Model', 512),
      variant: text(input.variant ?? '', 'Model power', 64),
      access: accessOf(input.access),
      files: input.files.slice(0, 20).map((file) => text(file, 'Attachment', 4096)),
      skills: input.skills.slice(0, 10).map((skill) => text(skill, 'Skill', 256)),
    });
  });
  define('changes:list', (_event, id) => needEngine().getChanges(typeof id === 'string' && id ? identifier(id) : ''));
  define('changes:undo', (_event, path) => undoFileChange(needFiles().root, text(path, 'File path', 4096)));
  define('files:list', (_event, path) => needFiles().list(path === undefined || path === null ? '' : text(path, 'Path', 4096)));
  define('files:search', (_event, query, mode) => {
    if (mode !== 'files' && mode !== 'content') throw new Error('Invalid search mode.');
    return needFiles().search(text(query, 'Search', 256), mode);
  });
  define('files:read', (_event, path) => needFiles().read(text(path, 'Path', 4096)));
  define('files:save', (_event, path, content, revision) => needFiles().save(text(path, 'Path', 4096), text(content, 'File content', 2 * 1024 * 1024), text(revision, 'Revision', 256)));
  define('preferences:artifact-dir', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Choose where Relay saves automation output', properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Use this folder' });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  define('preferences:save', async (_event, values) => {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid preferences.');
    await store.savePreferences(values as PreferencesPatch);
    const context = store.preferences.context;
    engine.setAutoCompact(context.autoCompact, context.compactThreshold);
    return state();
  });
  define('providers:save', async (_event, value) => { await store.saveProvider(value as ProviderInput); await restart(); return state(); });
  define('providers:remove', async (_event, id) => { await store.removeProvider(id as ProviderInput['id']); await restart(); return state(); });
  define('mcp:list', () => store.mcp);
  define('mcp:save', async (_event, value) => {
    const server = validateMcp(value as McpServer);
    if (server.enabled && (server.type === 'local' || server.url)) {
      const detail = server.type === 'local' ? `This will run:\n\n${server.command?.map((part) => JSON.stringify(part)).join(' ')}` : `This will connect to:\n\n${JSON.stringify(server.url)}`;
      const answer = await dialog.showMessageBox(window!, { type: 'warning', title: 'Enable MCP server?', message: `Enable “${server.name}”?`,
        detail: `${detail}\n\nOnly enable servers you trust. Agent tools from this server can request actions subject to Relay approvals.`,
        buttons: ['Cancel', 'Enable'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return;
    }
    await store.saveMcp(server); await restart();
  });
  define('mcp:remove', async (_event, name) => { await store.removeMcp(text(name, 'MCP name', 64)); await restart(); });
  define('plugins:list', () => pluginViews());
  define('plugins:catalog', async (): Promise<PluginCatalogEntry[]> => {
    const installed = new Set(store.plugins.map((record) => record.id));
    return (await plugins.catalog(catalogDirectory())).map(({ manifest, capabilities, digest }) => ({
      id: manifest.id, name: manifest.name, version: manifest.version,
      description: manifest.description, capabilities, digest, installed: installed.has(manifest.id),
    }));
  });
  define('plugins:catalog-preview', async (_event, id) => {
    const key = identifier(id);
    const entry = (await plugins.catalog(catalogDirectory())).find((item) => item.manifest.id === key);
    if (!entry) throw new Error('This featured plugin is not available in this build.');
    return plugins.previewDirectory(entry.directory);
  });
  define('plugins:import', async (_event, url, sha256) => {
    const download = await downloadPluginPackage(url, sha256, { fetch: (input, init) => net.fetch(input, init) });
    try { return await plugins.preview(download.path); }
    finally { await rm(download.directory, { recursive: true, force: true }).catch(() => undefined); }
  });
  define('plugins:preview', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose a Relay plugin', properties: ['openFile'], filters: [{ name: 'Relay plugin package', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return plugins.preview(result.filePaths[0]);
  });
  define('plugins:install', async (_event, token, allowCode) => {
    if (allowCode !== false) throw new Error('Executable plugin code is not activated by the bundled engine. Install declarative plugins only.');
    const record = await plugins.install(text(token, 'Plugin preview', 128), false);
    const records = store.plugins.filter((item) => item.id !== record.id);
    records.push(record);
    await store.savePlugins(records);
    await restart();
    return pluginViews();
  });
  define('plugins:set-enabled', async (_event, id, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid plugin state.');
    await store.setPluginEnabled(identifier(id), enabled);
    await restart();
    return pluginViews();
  });
  define('plugins:remove', async (_event, id) => {
    const key = identifier(id);
    await store.removePlugin(key);
    await plugins.remove(key);
    await restart();
    return pluginViews();
  });
  define('terminal:create', async (_event, cols, rows) => {
    const workspace = store.workspace;
    if (!workspace) throw new Error('Open a project first.');
    if (!confirmedTerminals.has(workspace.path)) {
      const answer = await dialog.showMessageBox(window!, { type: 'question', title: 'Open a terminal?', message: `Open a terminal in “${workspace.name}”?`,
        detail: 'Commands run in this terminal have the same access as your macOS user account. Relay does not review terminal commands.',
        buttons: ['Cancel', 'Open terminal'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) throw new Error('Terminal access was not approved.');
      confirmedTerminals.add(workspace.path);
    }
    const size = dimensions(cols, rows);
    return needEngine().createTerminal(size.cols, size.rows);
  });
  define('terminal:write', async (_event, id, data) => needEngine().writeTerminal(identifier(id), text(data, 'Terminal input', 64 * 1024)));
  define('terminal:resize', async (_event, id, cols, rows) => { const size = dimensions(cols, rows); await needEngine().resizeTerminal(identifier(id), size.cols, size.rows); });
  define('terminal:close', async (_event, id) => needEngine().closeTerminal(identifier(id)));
  define('app:open-external', async (_event, url) => { await shell.openExternal(validateExternalURL(url)); });
  define('automation:list', () => automationState());
  define('automation:save', async (_event, value) => {
    await automation.upsert(validateJobInput(value));
    announceAutomation();
    return automationState();
  });
  define('automation:remove', async (_event, id) => {
    await automation.remove(identifier(id));
    announceAutomation();
    return automationState();
  });
  define('automation:run', async (_event, id) => { await scheduler.runNow(identifier(id)); return automationState(); });
  define('automation:reveal', async (_event, id) => {
    const job = automation.find(identifier(id));
    if (!job?.artifactPath) throw new Error('This automation has no output file yet.');
    shell.showItemInFolder(job.artifactPath);
  });
  define('dictation:transcribe', async (_event, value) => {
    const audio = validateAudio(value);
    const target = transcriptionTarget(store.preferences.dictation, store.runtimeProviders());
    return transcribe(target, audio);
  });
  define('window:minimize', () => window?.minimize());
  define('window:zoom', () => { if (!window) return; window.isMaximized() ? window.unmaximize() : window.maximize(); });
  define('window:close', () => window?.close());
}

async function createWindow(): Promise<void> {
  const development = Boolean(process.env.RELAY_DEV_URL);
  const renderer = join(__dirname, '../renderer/index.html');
  expectedURL = development ? process.env.RELAY_DEV_URL! : pathToFileURL(renderer).href;
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 860, minHeight: 620,
    ...windowChrome(process.platform as Platform, material),
    show: false, webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: true, spellcheck: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== expectedURL) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.webSecurity = true;
    preferences.allowRunningInsecureContent = false;
    preferences.experimentalFeatures = false;
    preferences.webviewTag = false;
    if (params.partition !== BROWSER_PARTITION) event.preventDefault();
    if (params.src && params.src !== 'about:blank' && !browserURL(params.src)) event.preventDefault();
  });
  window.webContents.on('did-attach-webview', (_event, guest) => hardenGuest(guest));
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = undefined; });
  if (development) await window.loadURL(expectedURL); else await window.loadFile(renderer);
}

async function runScheduledJob(job: AutomationJob): Promise<{ detail: string; sessionId?: string; artifactPath?: string }> {
  if (job.action.kind === 'page') {
    if (!window || window.isDestroyed()) throw new Error('Relay is not available to open the page.');
    emit({ type: 'job-preview', jobId: job.id, jobName: job.name, url: job.action.url });
    return { detail: `Opened ${new URL(job.action.url).host} in Relay` };
  }
  const running = needEngine();
  const action = job.action;
  let sessionId = job.sessionId;
  if (sessionId) {
    try { await running.getMessages(sessionId); }
    catch { sessionId = undefined; }
  }
  if (!sessionId || action.output === 'independent') sessionId = (await running.createSession(`Automation · ${job.name}`)).id;
  const prompt = action.steps ? `${action.prompt}\n\nSteps to follow:\n${action.steps}` : action.prompt;
  await running.sendMessage({
    sessionId, model: action.model, variant: '', access: action.access,
    files: [], skills: [], text: prompt,
    context: action.context ? [{ label: `Automation context · ${job.name}`, text: action.context }] : [],
  });
  await running.waitForIdle(sessionId);
  const messages = await running.getMessages(sessionId);
  const latest = [...messages].reverse().find((message) => message.role === 'assistant');
  const output = latest?.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n').trim() ?? '';
  const directory = store.preferences.general.artifactDir || join(app.getPath('userData'), 'relay', 'artifacts');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = job.name.replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 60) || 'automation';
  const artifactPath = join(directory, `${base}-${stamp}.md`);
  await writeFile(artifactPath, `# ${job.name}\n\nRun: ${new Date().toISOString()}\n\n${action.prompt}\n\n---\n\n${output || 'The agent finished without text output.'}\n`, { mode: 0o600 });
  emit({ type: 'sessions-changed' });
  return { detail: output ? output.slice(0, 160) : 'Prompt finished with no text output.', sessionId, artifactPath };
}

async function boot(): Promise<void> {
  const root = join(app.getPath('userData'), 'relay');
  await mkdir(root, { recursive: true, mode: 0o700 });
  store = new SettingsStore(join(root, 'settings'), codec());
  await store.load();
  automation = new AutomationStore(join(root, 'automation.json'));
  await automation.load();
  engineRoot = join(root, 'engine');
  engine = new Engine(engineRoot, engineBinary(), emit);
  engine.setAutoCompact(store.preferences.context.autoCompact, store.preferences.context.compactThreshold);
  plugins = new PluginManager(join(engineRoot, 'plugins'));
  await plugins.cleanup();
  skillLibrary = new SkillLibrary(join(engineRoot, 'skills'));
  await skillLibrary.cleanup();
  // Microphone access is granted only to Relay's own renderer, never to embedded pages.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trusted = Boolean(window && !window.isDestroyed() && contents?.id === window.webContents.id);
    if (permission === 'media') {
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      callback(trusted && mediaTypes.length > 0 && mediaTypes.every((kind) => kind === 'audio'));
      return;
    }
    callback(trusted && permission === 'clipboard-sanitized-write');
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    const trusted = Boolean(window && !window.isDestroyed() && contents?.id === window.webContents.id);
    return trusted && (permission === 'clipboard-sanitized-write' || permission === 'media');
  });
  prepareBrowserSession();
  scheduler = new Scheduler(automation, runScheduledJob, announceAutomation);
  register();
  await createWindow();
  scheduler.start();
  await restart();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    // Windows associates toast notifications and taskbar grouping with this id.
    if (process.platform === 'win32') app.setAppUserModelId('app.relay.workspace');
    Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu(process.platform as Platform) as Parameters<typeof Menu.buildFromTemplate>[0]));
    try { await boot(); } catch (error) {
      await dialog.showMessageBox({ type: 'error', title: 'Relay could not start', message: 'Relay could not open its local state.', detail: error instanceof Error ? error.message : String(error) });
      app.quit();
    }
  });
  app.on('activate', () => { if (!window && store) void createWindow().then(() => restart()).catch(() => app.quit()); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    scheduler?.stop();
    void (engine ? engine.stop() : Promise.resolve()).finally(() => app.quit());
  });
}
