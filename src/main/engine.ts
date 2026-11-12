import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants, type Dirent } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, open, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, posix, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OpenCode, type JobSubagent, type OpenCodeClient, type FormInfo, type SessionMessageInfo, type SessionInfo } from '@opencode/client';
import type { AccessLevel, AgentMode, AgentOption, AppEvent, AttentionOverview, AttentionRequest, BackgroundRun, ChatMessage, CommandOption, ContextBlock, FileChange, McpServer, ModelOption, PermissionDecision, PermissionRequest, ProviderInput, QueuedMessage, RunCommandInput, SendMessageInput, SessionActivity, SessionSummary, SkillOption, SkillRegistryEntry, UsageSummary } from '../shared/contracts.js';
import { providerPreset } from '../shared/providers.js';
import { mapMessages, mapPermission, mapQuestion, mapSession, locatedSession, answerForm } from './engine-mapping.js';
import { annotateAttention, attentionRequests } from './attention.js';
import { AttentionLog, permissionSummary, questionSummary } from './attention-log.js';
import { buildActivity } from './activity.js';
import { buildBackgroundRuns } from './background.js';
import { mapQueuedMessages } from './queue.js';
import { composeMessage } from './context.js';
import { summarizeUsage } from './usage.js';
import { mapStreamEvent } from './streaming.js';
import { defaultShell } from './platform.js';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

// These arrive many times per second and never change the persisted transcript on their own.
const LIVE_ONLY = new Set(['session.tool.progress', 'session.tool.input.delta', 'session.step.streamed']);

type MessageList = (input: { sessionID: string; limit?: number; order?: 'asc' | 'desc'; cursor?: string }) => Promise<{ data: SessionMessageInfo[]; cursor: { next?: string | null } }>;

export async function collectMessages(list: MessageList, sessionID: string): Promise<SessionMessageInfo[]> {
  const messages: SessionMessageInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = cursor
      ? await list({ sessionID, limit: 200, cursor })
      : await list({ sessionID, limit: 200, order: 'asc' });
    messages.push(...page.data);
    cursor = page.cursor.next ?? undefined;
  } while (cursor);
  return messages;
}

export function forkBoundary(messages: Array<{ id: string }>, messageID: string): string | undefined {
  const index = messages.findIndex((message) => message.id === messageID);
  if (index < 0) throw new Error('This response is no longer part of the task.');
  return messages[index + 1]?.id;
}

export function childSessionsOf(sessions: SessionInfo[], sessionID: string): SessionInfo[] {
  const byParent = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (!session.parentID || session.time.archived) continue;
    const list = byParent.get(session.parentID) ?? [];
    list.push(session);
    byParent.set(session.parentID, list);
  }
  const found: SessionInfo[] = [];
  const queue = [sessionID];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const child of byParent.get(parent) ?? []) {
      if (found.includes(child)) continue;
      found.push(child);
      queue.push(child.id);
    }
  }
  return found;
}

export interface AttachmentFile {
  uri: string;
  data: string;
  mime: string;
  name: string;
  source: { type: 'inline' };
}

export async function readAttachment(root: string, path: string): Promise<AttachmentFile> {
  if (!path || path.includes('\0') || isAbsolute(path)) throw new Error('Attachments must be files inside the open project.');
  const rootPath = await realpath(root);
  const candidate = resolve(rootPath, path);
  if (!inside(rootPath, candidate)) throw new Error('Attachments must be files inside the open project.');
  const actual = await realpath(candidate);
  if (!inside(rootPath, actual)) throw new Error('Attachments must be files inside the open project.');
  const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Attachments must be files inside the open project.');
    if (info.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be smaller than 2 MB.');
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be smaller than 2 MB.');
    return { uri: pathToFileURL(actual).href, data: contents.toString('base64'), mime: 'text/plain', name: basename(actual), source: { type: 'inline' } };
  } finally {
    await handle.close();
  }
}

export function withinRoot(root: string, target: string, platform: NodeJS.Platform = process.platform): boolean {
  const path = platform === 'win32' ? win32 : posix;
  const portion = path.relative(path.normalize(root), path.normalize(target));
  return Boolean(portion) && !portion.startsWith('..') && !path.isAbsolute(portion);
}

function inside(root: string, target: string): boolean {
  return withinRoot(root, target);
}

export function sidecarEnvironment(root: string, password: string, configPath: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  const path = platform === 'win32' ? win32 : posix;
  const home = path.join(root, 'home');
  const pick = (...names: string[]) => names.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]!] as const]));
  const fallbackPath = platform === 'win32'
    ? process.env.PATH || process.env.Path || ''
    : '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin';
  const env: NodeJS.ProcessEnv = Object.fromEntries([
    ['HOME', home],
    ['XDG_CONFIG_HOME', path.join(root, 'config')],
    ['XDG_DATA_HOME', path.join(root, 'data')],
    ['XDG_CACHE_HOME', path.join(root, 'cache')],
    ['XDG_STATE_HOME', path.join(root, 'state')],
    ...(platform === 'win32' ? [
      ['USERPROFILE', home],
      ['APPDATA', path.join(home, 'AppData', 'Roaming')],
      ['LOCALAPPDATA', path.join(home, 'AppData', 'Local')],
    ] : []),
    ['OPENCODE_CONFIG_DIR', path.join(root, 'config', 'opencode')],
    ['OPENCODE_CONFIG', configPath],
    ['OPENCODE_CONFIG_PROJECT_DISABLE', '1'],
    ['OPENCODE_DISABLE_CLAUDE_CODE', '1'],
    ['OPENCODE_PASSWORD', password],
    ['OPENCODE_CLIENT', 'relay'],
    ['PATH', process.env.PATH || fallbackPath],
    ...pick('TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SHELL', 'USER', 'LOGNAME'),
  ]);
  return env;
}

const askAll = [{ action: '*', resource: '*', effect: 'ask' as const }];
const denyTask = { action: 'task', resource: '*', effect: 'deny' as const };

export function sessionRules(access: AccessLevel) {
  if (access === 'full') return [{ action: '*', resource: '*', effect: 'allow' as const }, denyTask];
  if (access === 'auto') return [...askAll, { action: 'write', resource: '*', effect: 'allow' as const }, { action: 'edit', resource: '*', effect: 'allow' as const }, denyTask];
  if (access === 'read') return [...askAll, ...['write', 'edit', 'shell'].map((action) => ({ action, resource: '*', effect: 'deny' as const })), denyTask];
  return [...askAll, denyTask];
}

const agentFor = (access: AccessLevel): AgentMode => access === 'read' ? 'plan' : 'build';

const activationPending = (error: unknown): boolean => /did not finish activating/i.test(error instanceof Error ? error.message : String(error));

export async function retryActivation<T>(operation: () => Promise<T>, delay = 250, attempts = 30): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= attempts || !activationPending(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// OpenCode treats each `skills` entry as one skill folder, not a parent directory.
export async function installedSkillDirectories(root: string): Promise<string[]> {
  let entries: Dirent[];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = join(root, entry.name);
    if (await access(join(directory, 'SKILL.md')).then(() => true, () => false)) directories.push(directory);
  }
  return directories.sort();
}

function providerConfig(providers: ProviderInput[], mcp: McpServer[], skillDirectories: string[] = []): string {
  const configured = Object.fromEntries(providers.map((provider) => {
    const preset = providerPreset(provider.id);
    const models = provider.models?.length ? Object.fromEntries(provider.models.map((model) => [model, { name: model }])) : undefined;
    return [provider.id, {
      name: provider.id, package: preset?.package,
      settings: {
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        ...(provider.baseURL || preset?.baseURL ? { baseURL: provider.baseURL ?? preset?.baseURL } : {}),
      },
      ...(models ? { models } : {}),
    }];
  }));
  return JSON.stringify({
    permissions: [...askAll, denyTask],
    update: 'disable', share: 'disabled', providers: configured,
    ...(mcp.length ? { mcp: { servers: Object.fromEntries(mcp.map((server) => [server.name, server.type === 'local'
      ? { type: 'local', command: server.command, disabled: !server.enabled }
      : { type: 'remote', url: server.url, disabled: !server.enabled }])) } } : {}),
    ...(skillDirectories.length ? { skills: skillDirectories } : {}),
  });
}

function basic(password: string): string { return `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`; }

function trustedEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('The local engine reported an unexpected network address.');
  }
  return url.href.replace(/\/$/, '');
}

export class Engine {
  status: { state: 'stopped' | 'starting' | 'ready' | 'error'; detail: string; version?: string } = { state: 'stopped', detail: 'Not started' };
  client!: OpenCodeClient;
  private child?: ChildProcessWithoutNullStreams;
  private endpoint?: string;
  private password = '';
  private directory = '';
  private workspaces: string[] = [];
  private providers: ProviderInput[] = [];
  private mcp: McpServer[] = [];
  private abort?: AbortController;
  private configPath?: string;
  private stopped = true;
  private terminals = new Map<string, WebSocket>();
  private permissions = new Map<string, PermissionRequest>();
  private autoCompact?: { enabled: boolean; threshold: number };
  private compacting = new Set<string>();
  private attention?: AttentionLog;
  private skillsDirectory = '';
  private backgrounded = new Map<string, number>();

  constructor(private readonly root: string, private readonly cli: string, private readonly emit: (event: AppEvent) => void) {}

  async start(directory: string, providers: ProviderInput[], mcp: McpServer[], workspaces: string[] = []): Promise<void> {
    await this.stop();
    this.stopped = false;
    this.directory = directory; this.providers = providers; this.mcp = mcp;
    this.workspaces = [...new Set(workspaces.filter((path) => path && path !== directory))];
    this.status = { state: 'starting', detail: 'Starting local engine' };
    this.emit({ type: 'engine', status: this.status });
    await Promise.all(['config', 'data', 'cache', 'state', 'home'].map((name) => mkdir(join(this.root, name), { recursive: true, mode: 0o700 })));
    this.skillsDirectory = join(this.root, 'skills');
    await mkdir(this.skillsDirectory, { recursive: true, mode: 0o700 });
    this.password = randomBytes(32).toString('base64url');
    const configPath = join(this.root, 'opencode.json');
    this.configPath = configPath;
    const skillDirectories = await installedSkillDirectories(this.skillsDirectory);
    await writeFile(configPath, providerConfig(providers, mcp, skillDirectories), { mode: 0o600 });
    await chmod(configPath, 0o600);
    const env = sidecarEnvironment(this.root, this.password, configPath);
    const child = spawn(this.cli, ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'], { cwd: directory, env, stdio: 'pipe' });
    this.child = child;
    try {
      this.endpoint = await new Promise<string>((resolve, reject) => {
        let output = '', errors = '';
        const timer = setTimeout(() => reject(new Error(`Engine did not start in time${errors ? `: ${errors.slice(-400)}` : ''}`)), 25_000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          output += chunk;
          for (const line of output.split('\n')) {
            if (!line.trim()) continue;
            try { const value = JSON.parse(line) as { url?: unknown }; if (typeof value.url === 'string') { clearTimeout(timer); resolve(value.url); return; } } catch {}
          }
        });
        child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { errors = (errors + chunk).slice(-4000); });
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Engine exited with code ${code}${errors ? `: ${errors.slice(-400)}` : ''}`)); });
      });
      this.endpoint = trustedEndpoint(this.endpoint);
      this.client = OpenCode.make({ baseUrl: this.endpoint, headers: { authorization: basic(this.password) } });
      const info = await this.client.server.info();
      this.status = { state: 'ready', detail: directory, version: info.version };
      this.emit({ type: 'engine', status: this.status });
      this.subscribe();
    } catch (error) {
      this.stopped = true; child.kill(); this.child = undefined;
      await this.discardConfig();
      this.status = { state: 'error', detail: error instanceof Error ? error.message : 'Engine failed to start' };
      this.emit({ type: 'engine', status: this.status });
      throw error;
    }
  }

  private async subscribe(): Promise<void> {
    const abort = new AbortController(); this.abort = abort;
    const client = this.client;
    while (!this.stopped && !abort.signal.aborted && this.abort === abort && this.client === client) {
      try {
        for await (const event of client.event.subscribe({ signal: abort.signal })) {
          if (abort.signal.aborted || this.abort !== abort) return;
          this.event(event);
        }
      } catch (error) {
        if (this.stopped || abort.signal.aborted || this.abort !== abort) return;
        this.emit({ type: 'error', message: `Engine connection interrupted: ${error instanceof Error ? error.message : 'unknown error'}` });
      }
      if (!this.stopped && !abort.signal.aborted && this.abort === abort) {
        this.emit({ type: 'sessions-changed' });
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
  }

  private async discardConfig(): Promise<void> {
    const path = this.configPath;
    this.configPath = undefined;
    if (path) await unlink(path).catch(() => {});
  }

  async refreshSkills(expected: string[] = []): Promise<void> {
    if (this.stopped || !this.configPath) return;
    const directories = await installedSkillDirectories(this.skillsDirectory);
    await writeFile(this.configPath, providerConfig(this.providers, this.mcp, directories), { mode: 0o600 });
    await chmod(this.configPath, 0o600);
    if (expected.length) {
      for (let attempt = 0; attempt < 25; attempt++) {
        const loaded = await this.listSkills().catch(() => []);
        if (expected.every((id) => loaded.some((skill) => skill.id === id))) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  private event(event: { type: string; data?: unknown }): void {
    if (event.type === 'skill.updated') { this.emit({ type: 'skills-changed' }); return; }
    if (event.type === 'command.updated') { this.emit({ type: 'commands-changed' }); return; }
    if (event.type === 'plugin.updated') { this.emit({ type: 'plugins-changed' }); return; }
    const stream = mapStreamEvent(event);
    if (stream) { this.emit(stream); return; }
    const data = event.data as Record<string, unknown> | undefined;
    if (!data) return;
    if (event.type === 'permission.asked') { const request = mapPermission(data as never); this.permissions.set(request.id, request); this.emit({ type: 'permission', request }); return; }
    if (event.type === 'permission.replied') { const id = String(data.requestID); this.permissions.delete(id); this.emit({ type: 'permission-resolved', id }); this.sessionChanged(String(data.sessionID)); return; }
    if (event.type === 'form.created') { const form = (data as { form: FormInfo }).form; if (form) this.emit({ type: 'question', request: mapQuestion(form) }); return; }
    if (event.type === 'form.replied' || event.type === 'form.cancelled') { this.emit({ type: 'question-resolved', id: String(data.formID) }); return; }
    if (event.type === 'session.idle' && typeof data.sessionID === 'string') {
      this.emit({ type: 'session-idle', sessionId: data.sessionID });
      void this.getUsage(data.sessionID).then((usage) => this.emit({ type: 'usage', sessionId: data.sessionID as string, usage })).catch(() => {});
      void this.maybeCompact(data.sessionID);
    }
    if (event.type.startsWith('session.') && typeof data.sessionID === 'string') {
      // Token and tool-progress events are live decorations; the conversation snapshot updates when steps settle.
      if (LIVE_ONLY.has(event.type)) return;
      if (event.type === 'session.created' || event.type === 'session.deleted' || event.type === 'session.renamed') this.emit({ type: 'sessions-changed' });
      this.sessionChanged(data.sessionID);
    }
  }

  private sessionChanged(id: string): void {
    this.emit({ type: 'session-changed', sessionId: id });
  }

  private async running(): Promise<Set<string>> {
    try { return new Set(Object.entries(await this.client.session.active()).filter(([, value]) => value.type === 'running').map(([id]) => id)); }
    catch { return new Set(); }
  }

  private directories(): string[] {
    return [...new Set([this.directory, ...this.workspaces])].filter(Boolean);
  }

  async listSessions(): Promise<SessionSummary[]> {
    const running = await this.running();
    const result = await this.client.session.list({ directory: this.directory, limit: 100, order: 'desc' });
    return result.data.filter((session) => !session.parentID && !session.time.archived).map((session) => mapSession(session, running.has(session.id)));
  }

  async listAllSessions(): Promise<SessionSummary[]> {
    const running = await this.running();
    const directories = this.directories();
    const pages = await Promise.all([
      this.client.session.list({ limit: 100, order: 'desc' }),
      ...directories.map((directory) => this.client.session.list({ directory, limit: 100, order: 'desc' })),
    ]);
    const sessions = new Map<string, SessionInfo>();
    for (const page of pages) for (const session of page.data) {
      if (!session.parentID && !session.time.archived) sessions.set(session.id, session);
    }
    return [...sessions.values()]
      .sort((left, right) => right.time.updated - left.time.updated)
      .map((session) => mapSession(session, running.has(session.id)));
  }

  async listAttention(): Promise<AttentionOverview> {
    const sessions = await this.listAllSessions();
    const located = await Promise.all(this.directories().map(async (directory) => {
      const [permissions, forms] = await Promise.all([
        this.client.permission.request.list({ location: { directory } }).then((result) => result.data).catch(() => []),
        this.client.form.list({ location: { directory } }).then((result) => result.data).catch(() => []),
      ]);
      return { directory, permissions, forms };
    }));
    const overview = annotateAttention(
      located.flatMap(({ directory, permissions }) => permissions.map((request) => ({ directory, request: mapPermission(request) }))),
      located.flatMap(({ directory, forms }) => forms.map((request) => ({ directory, request: mapQuestion(request) }))),
      sessions,
    );
    const log = this.attentionLog();
    let history = overview.history;
    try {
      await log.notice(attentionRequests(overview));
      history = await log.history();
    } catch {
      // History is a convenience: a damaged log must never block live requests.
    }
    return { ...overview, history };
  }

  private attentionLog(): AttentionLog {
    return this.attention ??= new AttentionLog(join(this.root, 'attention.json'));
  }

  private historyRequest(id: string, kind: 'permission' | 'question', sessionId: string, summary: string, detail?: string): AttentionRequest {
    return {
      id, kind, sessionId, taskTitle: `Task ${sessionId.slice(0, 8)}`,
      folder: basename(this.directory) || 'No folder', summary, ...(detail ? { detail } : {}),
    };
  }

  async createSession(title = 'New task'): Promise<SessionSummary> {
    const session = await this.client.session.create({ location: { directory: this.directory }, title: title.trim() || 'New task', agent: 'build', permissions: sessionRules('ask') });
    return locatedSession(session, false, this.directory);
  }

  async forkSession(sessionID: string, messageID: string): Promise<SessionSummary> {
    const client = this.client;
    const messages = await collectMessages((input) => client.message.list(input), sessionID);
    const before = forkBoundary(messages, messageID);
    const session = await client.session.fork({ sessionID, ...(before ? { before } : {}) });
    return locatedSession(session, false, this.directory);
  }

  async renameSession(sessionID: string, title: string): Promise<void> {
    await this.client.session.update({ sessionID, title: title.trim().slice(0, 200) || 'Untitled task' });
  }

  async deleteSession(sessionID: string): Promise<void> { await this.client.session.remove({ sessionID }); }

  async getMessages(sessionID: string): Promise<ChatMessage[]> {
    const client = this.client;
    const messages = await collectMessages((input) => client.message.list(input), sessionID);
    return mapMessages(messages);
  }

  async getActivity(sessionID: string, webSkills: SkillRegistryEntry[] = []): Promise<SessionActivity> {
    const client = this.client;
    const [messages, session, jobs, artifacts, skills, listing, running] = await Promise.all([
      collectMessages((input) => client.message.list(input), sessionID),
      client.session.get({ sessionID }).catch(() => undefined),
      retryActivation(() => client.experimental.job.list({ sessionID, kind: 'subagent', descendants: true }))
        .then((jobs) => jobs.filter((job): job is JobSubagent => job.kind === 'subagent')).catch(() => [] as JobSubagent[]),
      client.experimental.artifacts.list({ location: { directory: this.directory }, sessionID }).then((result) => result.data).catch(() => []),
      this.listSkills().catch(() => []),
      client.session.list({ limit: 100, order: 'desc' }).then((result) => result.data).catch(() => [] as SessionInfo[]),
      this.running(),
    ]);
    const subagents = await Promise.all(jobs.map(async (job) => ({
      ...job,
      messages: await collectMessages((input) => client.message.list(input), job.childSessionID).catch(() => []),
    })));
    const childSessions = await Promise.all(childSessionsOf(listing, sessionID).map(async (child) => ({
      id: child.id,
      ...(child.agent ? { agent: child.agent } : {}),
      ...(child.title ? { title: child.title } : {}),
      status: running.has(child.id) ? 'running' as const : 'completed' as const,
      time: { created: child.time.created, updated: child.time.updated },
      messages: await collectMessages((input) => client.message.list(input), child.id).catch(() => []),
    })));
    const lastUser = [...messages].reverse().find((message) => message.type === 'user' && message.text.trim());
    const taskText = [session?.title ?? '', lastUser?.type === 'user' ? lastUser.text.slice(0, 4_000) : ''].filter(Boolean).join('\n');
    return buildActivity({ sessionId: sessionID, messages, subagents, childSessions, artifacts, skills, webSkills, mcp: this.mcp, taskText });
  }

  async getUsage(sessionID: string): Promise<UsageSummary> {
    const client = this.client;
    const messages = await collectMessages((input) => client.message.list(input), sessionID);
    let limit: number | undefined;
    try {
      const session = await client.session.get({ sessionID });
      const id = session.model ? `${session.model.providerID}::${session.model.id}` : '';
      limit = (await this.listModels()).find((model) => model.id === id)?.context;
    } catch {}
    return summarizeUsage(messages, limit);
  }

  async compactSession(sessionID: string): Promise<void> {
    await this.client.session.compact({ sessionID });
  }

  async waitForIdle(sessionID: string): Promise<void> {
    await this.client.experimental.session.wait({ sessionID });
  }

  setAutoCompact(enabled: boolean, threshold: number): void {
    this.autoCompact = { enabled, threshold };
  }

  private async maybeCompact(sessionID: string): Promise<void> {
    const config = this.autoCompact;
    if (!config?.enabled || this.compacting.has(sessionID)) return;
    try {
      const usage = await this.getUsage(sessionID);
      if (!usage.contextLimit || usage.percent < config.threshold) return;
      this.compacting.add(sessionID);
      await this.client.session.compact({ sessionID });
    } catch {}
    finally { this.compacting.delete(sessionID); }
  }

  async getSessionDigest(sessionID: string): Promise<string> {
    const messages = await this.getMessages(sessionID);
    const lines: string[] = [];
    for (const message of messages.slice(-30)) {
      if (message.role === 'system') continue;
      const contents = message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n').trim();
      if (!contents) continue;
      lines.push(`${message.role === 'user' ? 'User' : 'Agent'}: ${contents.slice(0, 1500)}`);
    }
    return lines.join('\n\n').slice(-6000);
  }

  private async applySessionSettings(sessionID: string, model: string, variant: string, access: AccessLevel): Promise<void> {
    const [providerID, ...rest] = model.split('::');
    const id = rest.join('::');
    if (!providerID || !id) throw new Error('Choose a configured model before sending.');
    if (variant) {
      const selected = (await this.listModels()).find((option) => option.id === model);
      if (!selected?.variants?.includes(variant)) throw new Error('Choose a valid model power setting.');
    }
    await this.client.session.switchAgent({ sessionID, agent: agentFor(access) });
    await this.client.session.update({ sessionID, permissions: sessionRules(access) });
    await this.client.session.switchModel({ sessionID, model: { providerID, id, ...(variant ? { variant } : {}) } as never });
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    const access = input.planOnly ? 'read' : input.access;
    await this.applySessionSettings(input.sessionId, input.model, input.variant, access);
    const files = await Promise.all(input.files.map((path) => readAttachment(this.directory, path)));
    const requested = new Set(input.skills);
    const skills = (await this.listSkills()).filter((skill) => requested.has(skill.id)).map((skill) => ({ id: skill.id }));
    const requestedAgents = new Set(input.agents ?? []);
    const agents = requestedAgents.size
      ? (await this.listAgents()).filter((agent) => requestedAgents.has(agent.name)).map((agent) => ({ name: agent.name }))
      : [];
    const context: ContextBlock[] = Array.isArray(input.context) ? input.context : [];
    const composed = composeMessage(input.text, context);
    const prefix = input.planOnly
      ? 'Plan only: do not create or modify files. Inspect what you need and reply with a concrete plan, the files you would change, and the commands you would run.\n\n'
      : '';
    const text = input.goalDriven
      ? `${prefix}Treat this as a goal: keep working and verifying until it is complete, and only stop when the goal is met or you are blocked.\n\n${composed}`
      : `${prefix}${composed}`;
    await this.client.session.prompt({
      sessionID: input.sessionId, text, files,
      ...(skills.length ? { skills } : {}), ...(agents.length ? { agents } : {}),
      ...(input.delivery ? { delivery: input.delivery } : {}),
      metadata: {
        relay: {
          text: input.text, files: input.files, skills: input.skills, agents: input.agents ?? [],
          model: input.model, variant: input.variant, access, planOnly: input.planOnly === true,
          goalDriven: input.goalDriven === true,
          context: context.map((block) => ({ label: block.label, text: block.text })),
        },
      },
    });
  }

  async listQueuedMessages(sessionID: string): Promise<QueuedMessage[]> {
    const items = await this.client.session.inbox.list({ sessionID });
    return mapQueuedMessages(items as unknown[]);
  }

  async removeQueuedMessage(sessionID: string, inboxID: string): Promise<void> {
    await this.client.session.inbox.cancel({ sessionID, inboxID });
  }

  async steerQueuedMessage(sessionID: string, inboxID: string): Promise<void> {
    await this.client.session.inbox.update({ sessionID, inboxID, delivery: 'steer' });
    if ((await this.running()).has(sessionID)) await this.client.session.interrupt({ sessionID, resume: true });
  }

  async abortSession(sessionID: string): Promise<void> {
    await this.client.session.interrupt({ sessionID, resume: false });
    await this.dismissSessionRequests(sessionID);
  }

  async backgroundSession(sessionID: string): Promise<void> {
    await this.client.session.background({ sessionID });
    this.backgrounded.set(sessionID, Date.now());
    while (this.backgrounded.size > 20) {
      const oldest = this.backgrounded.keys().next().value;
      if (oldest === undefined) break;
      this.backgrounded.delete(oldest);
    }
  }

  async listBackgroundWork(): Promise<BackgroundRun[]> {
    if (!this.backgrounded.size) return [];
    const marks = [...this.backgrounded.entries()].map(([sessionId, startedAt]) => ({ sessionId, startedAt }));
    const logs = new Map<string, string[]>();
    await Promise.all(marks.map(async ({ sessionId }) => {
      try {
        const messages = await this.getMessages(sessionId);
        logs.set(sessionId, messages.flatMap((message) => {
          const prefix = message.role === 'user' ? 'You' : message.role === 'system' ? 'System' : 'Agent';
          const text = message.parts
            .flatMap((part) => part.type === 'text' && part.text.trim() ? [`${prefix}: ${part.text.trim()}`] : [])
            .join('\n');
          return text ? [text] : [];
        }).slice(-24));
      } catch {
        // A task can finish or be removed while its log is being read; keep the run visible without logs.
      }
    }));
    return buildBackgroundRuns(marks, await this.listAllSessions().catch(() => []), logs);
  }

  private async dismissSessionRequests(sessionID: string): Promise<void> {
    const permissions = await this.client.permission.request.list({ location: { directory: this.directory } })
      .then((result) => result.data.filter((request) => request.sessionID === sessionID))
      .catch(() => []);
    for (const request of permissions) {
      await this.client.permission.reply({ sessionID, requestID: request.id, decision: 'reject' }).catch(() => {});
      this.permissions.delete(request.id);
      this.emit({ type: 'permission-resolved', id: request.id });
    }
    const forms = await this.client.form.list({ location: { directory: this.directory } })
      .then((result) => result.data.filter((form) => form.sessionID === sessionID))
      .catch(() => []);
    for (const form of forms) {
      await this.client.session.form.cancel({ sessionID, formID: form.id }).catch(() => {});
      this.emit({ type: 'question-resolved', id: form.id });
    }
  }

  async listPermissions(): Promise<PermissionRequest[]> {
    const result = await this.client.permission.request.list({ location: { directory: this.directory } });
    this.permissions = new Map(result.data.map((request) => [request.id, mapPermission(request)]));
    return [...this.permissions.values()];
  }

  async replyPermission(id: string, decision: PermissionDecision): Promise<void> {
    const request = this.permissions.get(id) ?? await this.findPermission(id);
    if (!request) throw new Error('This approval request is no longer pending.');
    await this.client.permission.reply({ sessionID: request.sessionId, requestID: id, decision });
    this.permissions.delete(id);
    await this.attentionLog()
      .resolve(id, decision === 'reject' ? 'rejected' : 'approved', Date.now(), {
        request: this.historyRequest(id, 'permission', request.sessionId, permissionSummary(request), request.detail),
      })
      .catch(() => undefined);
  }

  private async findPermission(id: string): Promise<PermissionRequest | undefined> {
    for (const directory of this.directories()) {
      const result = await this.client.permission.request.list({ location: { directory } }).catch(() => undefined);
      const found = result?.data.find((request) => request.id === id);
      if (found) return mapPermission(found);
    }
    return undefined;
  }

  async listQuestions(): Promise<import('../shared/contracts.js').AgentQuestion[]> {
    const result = await this.client.form.list({ location: { directory: this.directory } });
    return result.data.map(mapQuestion);
  }

  async answerQuestion(id: string, answers: string[][] | null): Promise<void> {
    const form = await this.findForm(id);
    if (!form) throw new Error('This question is no longer pending.');
    if (answers === null) await this.client.session.form.cancel({ sessionID: form.sessionID, formID: form.id });
    else await this.client.session.form.reply({ sessionID: form.sessionID, formID: form.id, answer: answerForm(form, answers) });
    const request = mapQuestion(form);
    const answer = answers?.map((selection) => selection.join(', ')).filter(Boolean).join(' · ');
    await this.attentionLog()
      .resolve(id, answers === null ? 'dismissed' : 'answered', Date.now(), {
        request: this.historyRequest(id, 'question', form.sessionID, questionSummary(request)),
        ...(answer ? { answer } : {}),
      })
      .catch(() => undefined);
  }

  private async findForm(id: string): Promise<FormInfo | undefined> {
    for (const directory of this.directories()) {
      const result = await this.client.form.list({ location: { directory } }).catch(() => undefined);
      const found = result?.data.find((form) => form.id === id);
      if (found) return found;
    }
    return undefined;
  }

  async listModels(): Promise<ModelOption[]> {
    const response = await retryActivation(() => this.client.model.list({ location: { directory: this.directory } }));
    const connected = new Set(this.providers.map((provider) => provider.id));
    return response.data.filter((model) => model.enabled && model.capabilities.tools !== false).map((model) => {
      const detail = model as unknown as {
        cost?: Array<{ input?: number; output?: number }>;
        variants?: Array<{ id: string }>;
        limit?: { context?: number };
      };
      return {
        id: `${model.providerID}::${model.modelID}`, providerID: model.providerID, modelID: model.modelID,
        name: `${model.providerID} · ${model.name}`, connected: connected.has(model.providerID as ProviderInput['id']) || model.providerID === 'opencode',
        free: !detail.cost?.length || detail.cost.every((entry) => !entry.input && !entry.output),
        variants: (detail.variants ?? []).map((entry) => entry.id),
        context: detail.limit?.context,
      };
    });
  }

  async listAgents(): Promise<AgentOption[]> {
    const response = await retryActivation(() => this.client.agent.list({ location: { directory: this.directory } }));
    return response.data.filter((agent) => !agent.hidden && agent.mode !== 'subagent').map((agent) => ({ name: agent.name, description: agent.description || '', primary: agent.mode === 'primary' }));
  }

  async listSkills(): Promise<SkillOption[]> {
    const response = await retryActivation(() => this.client.skill.list({ location: { directory: this.directory } }));
    return response.data.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description || '', ...(this.managedSkill(skill.path) ? { library: true } : {}) }));
  }

  private managedSkill(path: string): boolean {
    if (!this.skillsDirectory || !isAbsolute(path)) return false;
    return withinRoot(this.skillsDirectory, path);
  }

  async listCommands(): Promise<CommandOption[]> {
    const response = await retryActivation(() => this.client.command.list({ location: { directory: this.directory } }));
    return response.data.filter((command) => command.name).map((command) => ({ name: command.name, description: command.description || '' }));
  }

  async runCommand(input: RunCommandInput): Promise<void> {
    const available = await this.listCommands();
    if (!available.some((command) => command.name === input.name)) throw new Error('Choose an available command.');
    await this.applySessionSettings(input.sessionId, input.model, input.variant, input.access);
    const files = await Promise.all(input.files.map((path) => readAttachment(this.directory, path)));
    const requested = new Set(input.skills);
    const skills = (await this.listSkills()).filter((skill) => requested.has(skill.id)).map((skill) => ({ id: skill.id }));
    await this.client.session.command({ sessionID: input.sessionId, name: input.name, text: input.text, files, ...(skills.length ? { skills } : {}) });
  }

  async getChanges(sessionID: string): Promise<FileChange[]> {
    if (!sessionID) {
      const result = await this.client.vcs.diff({ location: { directory: this.directory }, mode: 'working' });
      return result.data.map((change) => ({ path: change.file, before: '', after: '', additions: change.additions, deletions: change.deletions, patch: change.patch }));
    }
    const diffs = await this.client.session.diff({ sessionID });
    return diffs.map((change) => ({ path: change.file, before: '', after: '', additions: change.additions, deletions: change.deletions, patch: change.patch }));
  }

  async createTerminal(cols: number, rows: number): Promise<{ id: string }> {
    const shell = defaultShell(process.platform, process.env);
    const created = await this.client.pty.create({ location: { directory: this.directory }, command: shell.command, args: shell.args });
    const pty = created.data;
    await this.client.pty.update({ location: { directory: this.directory }, ptyID: pty.id, size: { cols, rows } });
    const token = await this.client.pty.connect.token({ location: { directory: this.directory }, ptyID: pty.id, 'x-opencode-ticket': '1' });
    const url = new URL(`/api/pty/${encodeURIComponent(pty.id)}/connect`, this.endpoint);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('location[directory]', this.directory);
    url.searchParams.set('ticket', token.data.ticket);
    const socket = new WebSocket(url); socket.binaryType = 'arraybuffer';
    this.terminals.set(pty.id, socket);
    socket.onmessage = (message) => {
      if (typeof message.data === 'string') this.emit({ type: 'terminal-data', id: pty.id, data: message.data });
      else {
        const data = Buffer.from(message.data as ArrayBuffer);
        if (data[0] === 0) return;
        this.emit({ type: 'terminal-data', id: pty.id, data: data.toString('utf8') });
      }
    };
    socket.onclose = (event) => { this.terminals.delete(pty.id); this.emit({ type: 'terminal-exit', id: pty.id, code: event.code }); };
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('Terminal connection failed.')); });
    return { id: pty.id };
  }

  async writeTerminal(id: string, data: string): Promise<void> {
    const socket = this.terminals.get(id); if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Terminal is not connected.');
    socket.send(data);
  }

  async resizeTerminal(id: string, cols: number, rows: number): Promise<void> { await this.client.pty.update({ location: { directory: this.directory }, ptyID: id, size: { cols, rows } }); }

  async closeTerminal(id: string): Promise<void> {
    this.terminals.get(id)?.close(); this.terminals.delete(id);
    try { await this.client.pty.remove({ location: { directory: this.directory }, ptyID: id }); } catch {}
  }

  async stop(): Promise<void> {
    this.stopped = true; this.abort?.abort(); this.abort = undefined;
    this.permissions.clear();
    for (const socket of this.terminals.values()) socket.close();
    this.terminals.clear();
    const child = this.child; this.child = undefined;
    if (child && !child.killed) {
      child.stdin.end();
      await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    await this.discardConfig();
    if (this.status.state !== 'error') this.status = { state: 'stopped', detail: 'Not started' };
  }
}

export const engineConfigForTests = { providerConfig, sessionRules, sidecarEnvironment, readAttachment, installedSkillDirectories };
