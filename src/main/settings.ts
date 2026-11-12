import { mkdir, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ContextSettings, GeneralSettings, McpServer, MessageReaction, PluginRecord, Preferences, PreferencesPatch, ProviderInput, ProviderSummary, Workspace } from '../shared/contracts.js';
import { CONFIGURABLE_PROVIDERS, isConfigurableProviderID, providerPreset } from '../shared/providers.js';
import { text, validateEndpoint } from './security.js';
import type { AccessLevel, DictationSettings } from '../shared/contracts.js';

export interface SecretCodec { encrypt(value: string): string; decrypt(value: string): string }
interface StoredProvider extends Omit<ProviderInput, 'apiKey'> { encryptedKey?: string }
interface StoredReaction { session: string; message: string; value: MessageReaction }
interface StoredSettings {
  version: 1;
  preferences: Preferences;
  workspaces: Workspace[];
  providers: StoredProvider[];
  mcp: McpServer[];
  plugins: PluginRecord[];
  reactions: StoredReaction[];
}

const REACTIONS_LIMIT = 2000;

const providerIDs = CONFIGURABLE_PROVIDERS.map((preset) => preset.id);
const accessLevels: AccessLevel[] = ['read', 'ask', 'auto', 'full'];

export const generalDefaults: GeneralSettings = {
  inputWhileRunning: true,
  slashCommandDisplay: true,
  skipUnansweredQuestions: false,
  artifactDir: '',
  promptSuggestions: true,
  conversationDisplay: 'comfortable',
  showThinking: true,
  goalDriven: false,
  homeGame: false,
  skillSuggestions: false,
  skillRegistry: '',
  turnNotifications: true,
  turnSound: true,
};

export const contextDefaults: ContextSettings = { autoCompact: false, compactThreshold: 80, shareProject: true };

const flag = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback;

function artifactDir(value: unknown): string {
  if (value === undefined) return '';
  if (value === '') return '';
  const path = text(value, 'Artifact folder', 1024).trim();
  if (!path) return '';
  if (!isAbsolute(path)) throw new Error('Choose an absolute folder for artifacts.');
  return path;
}

function skillRegistry(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string') throw new Error('Enter an HTTPS skill registry URL.');
  const raw = value.trim();
  if (!raw) return '';
  if (raw.length > 2048) throw new Error('The skill registry URL is too long.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Enter a valid HTTPS skill registry URL.'); }
  if (url.protocol !== 'https:') throw new Error('Skill registries must use HTTPS.');
  if (url.username || url.password) throw new Error('Remove credentials from the skill registry URL.');
  if (!url.hostname) throw new Error('Enter a valid HTTPS skill registry URL.');
  return url.toString();
}

function compactThreshold(value: unknown): number {
  if (value === undefined) return contextDefaults.compactThreshold;
  const threshold = Number(value);
  if (!Number.isInteger(threshold) || threshold < 50 || threshold > 95) throw new Error('Choose a compaction threshold between 50 and 95 percent.');
  return threshold;
}

function sanitizeGeneral(value: unknown): GeneralSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<GeneralSettings>;
  let directory = '';
  try { directory = artifactDir(raw.artifactDir); } catch { directory = ''; }
  let registry = '';
  try { registry = skillRegistry(raw.skillRegistry); } catch { registry = ''; }
  return {
    inputWhileRunning: flag(raw.inputWhileRunning, generalDefaults.inputWhileRunning),
    slashCommandDisplay: flag(raw.slashCommandDisplay, generalDefaults.slashCommandDisplay),
    skipUnansweredQuestions: flag(raw.skipUnansweredQuestions, generalDefaults.skipUnansweredQuestions),
    artifactDir: directory,
    promptSuggestions: flag(raw.promptSuggestions, generalDefaults.promptSuggestions),
    conversationDisplay: raw.conversationDisplay === 'compact' ? 'compact' : 'comfortable',
    showThinking: flag(raw.showThinking, generalDefaults.showThinking),
    goalDriven: flag(raw.goalDriven, generalDefaults.goalDriven),
    homeGame: flag(raw.homeGame, generalDefaults.homeGame),
    skillSuggestions: flag(raw.skillSuggestions, generalDefaults.skillSuggestions),
    skillRegistry: registry,
    turnNotifications: flag(raw.turnNotifications, generalDefaults.turnNotifications),
    turnSound: flag(raw.turnSound, generalDefaults.turnSound),
  };
}

function sanitizeContext(value: unknown): ContextSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ContextSettings>;
  let threshold = contextDefaults.compactThreshold;
  try { threshold = compactThreshold(raw.compactThreshold); } catch { threshold = contextDefaults.compactThreshold; }
  return {
    autoCompact: flag(raw.autoCompact, contextDefaults.autoCompact),
    compactThreshold: threshold,
    shareProject: flag(raw.shareProject, contextDefaults.shareProject),
  };
}

function sanitizeArchived(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(entry) || ids.includes(entry)) continue;
    ids.push(entry);
  }
  return ids.slice(0, 500);
}

function sanitizeWorkspace(value: unknown): Workspace | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const workspace = value as Partial<Workspace>;
  if (typeof workspace.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(workspace.id)) return undefined;
  if (typeof workspace.path !== 'string' || !isAbsolute(workspace.path) || workspace.path.includes('\0')) return undefined;
  if (typeof workspace.name !== 'string' || typeof workspace.lastOpened !== 'number' || !Number.isFinite(workspace.lastOpened)) return undefined;
  return { id: workspace.id, path: workspace.path, name: workspace.name, lastOpened: workspace.lastOpened };
}

function sanitizeProvider(value: unknown): StoredProvider | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const stored = value as StoredProvider & { modelID?: unknown };
  const candidate = {
    ...stored,
    models: stored.models ?? (typeof stored.modelID === 'string' ? [stored.modelID] : undefined),
  };
  let provider: ProviderInput;
  try { provider = validateProvider(candidate); } catch { return undefined; }
  const encryptedKey = typeof stored.encryptedKey === 'string' && stored.encryptedKey ? stored.encryptedKey : undefined;
  return { ...provider, ...(encryptedKey ? { encryptedKey } : {}) };
}

function sanitizeMcp(value: unknown): McpServer | undefined {
  try { return validateMcp(value as McpServer); } catch { return undefined; }
}

export function sanitizePlugin(value: unknown): PluginRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const plugin = value as Partial<PluginRecord>;
  if (typeof plugin.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(plugin.id)) return undefined;
  if (typeof plugin.name !== 'string' || !plugin.name.trim() || plugin.name.length > 80) return undefined;
  if (typeof plugin.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/.test(plugin.version)) return undefined;
  if (typeof plugin.description !== 'string' || plugin.description.length > 400) return undefined;
  if (typeof plugin.digest !== 'string' || !/^[a-f0-9]{64}$/.test(plugin.digest)) return undefined;
  if (typeof plugin.enabled !== 'boolean' || typeof plugin.codeApproved !== 'boolean') return undefined;
  if (typeof plugin.installedAt !== 'number' || !Number.isFinite(plugin.installedAt)) return undefined;
  const raw = plugin.capabilities as Partial<Record<'skills' | 'commands' | 'agents' | 'mcp' | 'code', unknown>> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const capabilities = {} as PluginRecord['capabilities'];
  for (const key of ['skills', 'commands', 'agents', 'mcp', 'code'] as const) {
    const entries = raw[key];
    if (!Array.isArray(entries) || entries.some(entry => typeof entry !== 'string' || !entry || entry.length > 120)) return undefined;
    capabilities[key] = [...new Set(entries)];
  }
  return {
    id: plugin.id, name: plugin.name, version: plugin.version, description: plugin.description, digest: plugin.digest,
    enabled: plugin.enabled, installedAt: plugin.installedAt, capabilities, codeApproved: plugin.codeApproved,
  };
}

function sanitizeReactions(value: unknown): StoredReaction[] {
  if (!Array.isArray(value)) return [];
  const kept = new Map<string, StoredReaction>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Partial<StoredReaction>;
    if (row.value !== 'like' && row.value !== 'dislike') continue;
    if (typeof row.session !== 'string' || typeof row.message !== 'string') continue;
    if (!row.session || !row.message || row.session.length > 256 || row.message.length > 256) continue;
    if (row.session.includes('\0') || row.message.includes('\0')) continue;
    kept.set(`${row.session}\0${row.message}`, { session: row.session, message: row.message, value: row.value });
  }
  return [...kept.values()].slice(-REACTIONS_LIMIT);
}

function sanitizeSettings(data: StoredSettings): StoredSettings {
  const rawPreferences = (data.preferences ?? {}) as Partial<Preferences>;
  const theme: Preferences['theme'] = ['dark', 'light', 'system'].includes(rawPreferences.theme as string) ? rawPreferences.theme as Preferences['theme'] : 'dark';
  const defaultModel = typeof rawPreferences.defaultModel === 'string' ? rawPreferences.defaultModel.slice(0, 512) : '';
  const defaultAccess: AccessLevel = accessLevels.includes(rawPreferences.defaultAccess as AccessLevel) ? rawPreferences.defaultAccess as AccessLevel : 'ask';
  const modelVariant = typeof rawPreferences.modelVariant === 'string' ? rawPreferences.modelVariant.slice(0, 64) : '';
  const rawDictation = (rawPreferences.dictation ?? {}) as Partial<DictationSettings>;
  const dictation: DictationSettings = {
    provider: isConfigurableProviderID(rawDictation.provider) ? rawDictation.provider : 'groq',
    model: typeof rawDictation.model === 'string' && rawDictation.model.trim() ? rawDictation.model.trim().slice(0, 256) : 'whisper-large-v3-turbo',
  };
  const workspaces: Workspace[] = [];
  for (const entry of data.workspaces) {
    const workspace = sanitizeWorkspace(entry);
    if (workspace && !workspaces.some((item) => item.id === workspace.id)) workspaces.push(workspace);
  }
  const active = typeof rawPreferences.activeWorkspaceId === 'string' && workspaces.some((item) => item.id === rawPreferences.activeWorkspaceId)
    ? rawPreferences.activeWorkspaceId : undefined;
  const providers: StoredProvider[] = [];
  for (const entry of data.providers) {
    const provider = sanitizeProvider(entry);
    if (provider && !providers.some((item) => item.id === provider.id)) providers.push(provider);
  }
  const mcp: McpServer[] = [];
  for (const entry of data.mcp) {
    const server = sanitizeMcp(entry);
    if (server && !mcp.some((item) => item.name === server.name)) mcp.push(server);
  }
  const plugins: PluginRecord[] = [];
  for (const entry of Array.isArray(data.plugins) ? data.plugins : []) {
    const plugin = sanitizePlugin(entry);
    if (plugin && !plugins.some((item) => item.id === plugin.id)) plugins.push(plugin);
  }
  return {
    version: 1,
    preferences: {
      theme, defaultModel, defaultAccess, modelVariant, dictation,
      general: sanitizeGeneral(rawPreferences.general),
      context: sanitizeContext(rawPreferences.context),
      archivedSessions: sanitizeArchived(rawPreferences.archivedSessions),
      ...(active ? { activeWorkspaceId: active } : {}),
    },
    workspaces: workspaces.slice(0, 30), providers, mcp, plugins: plugins.slice(0, 50),
    reactions: sanitizeReactions(data.reactions),
  };
}

function modelList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const models = [...new Set(value.map((entry) => text(entry, 'Model ID', 256).trim()).filter(Boolean))];
  return models.slice(0, 50);
}

export function validateProvider(value: ProviderInput): ProviderInput {
  if (!value || !isConfigurableProviderID(value.id)) throw new Error('Choose a supported provider.');
  const result: ProviderInput = { id: value.id };
  if (value.apiKey !== undefined) result.apiKey = text(value.apiKey, 'API key', 16_384).trim();
  if (value.baseURL) result.baseURL = validateEndpoint(value.baseURL);
  const models = modelList(value.models);
  if (models?.length) result.models = models;
  if (value.id === 'custom' && !result.baseURL) throw new Error('A custom provider needs an endpoint URL.');
  if (value.id === 'custom' && !models?.length) throw new Error('A custom provider needs at least one model ID.');
  return result;
}

export function validateMcp(value: McpServer): McpServer {
  if (!value || typeof value.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.name)) throw new Error('Use a server name with letters, numbers, dashes, or underscores.');
  if (typeof value.enabled !== 'boolean') throw new Error('Choose whether the MCP server is enabled.');
  if (value.type === 'local') {
    if (!Array.isArray(value.command) || !value.command.length || value.command.length > 100) throw new Error('Enter the MCP command and its arguments.');
    const command = value.command.map(part => text(part, 'Command argument', 4096));
    if (!command[0].trim()) throw new Error('Enter an MCP command.');
    return { name: value.name, type: 'local', command, enabled: value.enabled };
  }
  if (value.type === 'remote') return { name: value.name, type: 'remote', url: validateEndpoint(value.url), enabled: value.enabled };
  throw new Error('Choose a local or remote MCP server.');
}

export class SettingsStore {
  private data: StoredSettings = {
    version: 1,
    preferences: {
      theme: 'dark', defaultModel: '', defaultAccess: 'ask', modelVariant: '',
      dictation: { provider: 'groq', model: 'whisper-large-v3-turbo' },
      general: { ...generalDefaults }, context: { ...contextDefaults }, archivedSessions: [],
    },
    workspaces: [], providers: [], mcp: [], plugins: [], reactions: [],
  };
  private writes: Promise<void> = Promise.resolve();
  constructor(readonly directory: string, private readonly codec: SecretCodec) {}

  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'));
      if (data.version !== 1 || !data.preferences || !Array.isArray(data.workspaces) || !Array.isArray(data.providers) || !Array.isArray(data.mcp)) {
        throw new Error('Relay settings are invalid. Your settings file has not been overwritten.');
      }
      this.data = sanitizeSettings(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  get preferences(): Preferences { return structuredClone(this.data.preferences); }
  get workspaces(): Workspace[] { return structuredClone(this.data.workspaces); }
  get mcp(): McpServer[] { return structuredClone(this.data.mcp); }
  get plugins(): PluginRecord[] { return structuredClone(this.data.plugins); }
  get workspace(): Workspace | undefined { return this.workspaces.find(item => item.id === this.data.preferences.activeWorkspaceId); }

  reaction(session: string, message: string): MessageReaction | undefined {
    return this.data.reactions.find(item => item.session === session && item.message === message)?.value;
  }

  reactions(session: string): Record<string, MessageReaction> {
    const result: Record<string, MessageReaction> = {};
    for (const item of this.data.reactions) if (item.session === session) result[item.message] = item.value;
    return result;
  }

  async setReaction(session: string, message: string, value: MessageReaction | null): Promise<void> {
    const sessionID = text(session, 'Task', 256).trim();
    const messageID = text(message, 'Message', 256).trim();
    if (!sessionID || !messageID) throw new Error('A reaction needs a task and a message.');
    if (value !== null && value !== 'like' && value !== 'dislike') throw new Error('Choose like or dislike.');
    const rest = this.data.reactions.filter(item => !(item.session === sessionID && item.message === messageID));
    this.data.reactions = value ? [...rest, { session: sessionID, message: messageID, value }].slice(-REACTIONS_LIMIT) : rest;
    await this.save();
  }

  publicProviders(): ProviderSummary[] {
    return this.data.providers.map(({ encryptedKey, ...provider }) => ({
      ...provider, hasKey: Boolean(encryptedKey), models: provider.models ? [...provider.models] : undefined,
    }));
  }

  runtimeProviders(): ProviderInput[] {
    return this.data.providers.map(({ encryptedKey, ...provider }) => ({ ...provider, ...(encryptedKey ? { apiKey: this.codec.decrypt(encryptedKey) } : {}) }));
  }

  async addWorkspace(path: string): Promise<Workspace> {
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a project folder.');
    const id = createHash('sha256').update(canonical).digest('hex').slice(0, 20);
    const workspace: Workspace = { id, path: canonical, name: basename(canonical), lastOpened: Date.now() };
    this.data.workspaces = [workspace, ...this.data.workspaces.filter(item => item.id !== id)].slice(0, 30);
    this.data.preferences.activeWorkspaceId = id;
    await this.save();
    return workspace;
  }

  async switchWorkspace(id: string): Promise<Workspace> {
    const workspace = this.data.workspaces.find(item => item.id === id);
    if (!workspace) throw new Error('Open this workspace through the folder picker first.');
    return this.addWorkspace(workspace.path);
  }

  async savePreferences(values: PreferencesPatch): Promise<void> {
    if (values.theme !== undefined) {
      if (!['dark', 'light', 'system'].includes(values.theme)) throw new Error('Choose a valid appearance.');
      this.data.preferences.theme = values.theme;
    }
    if (values.defaultModel !== undefined) this.data.preferences.defaultModel = text(values.defaultModel, 'Model', 512);
    if (values.defaultAccess !== undefined) {
      if (!accessLevels.includes(values.defaultAccess)) throw new Error('Choose a valid access level.');
      this.data.preferences.defaultAccess = values.defaultAccess;
    }
    if (values.modelVariant !== undefined) this.data.preferences.modelVariant = text(values.modelVariant, 'Model power', 64);
    if (values.dictation !== undefined) {
      const dictation = values.dictation;
      if (!dictation || typeof dictation !== 'object' || !isConfigurableProviderID(dictation.provider)) throw new Error('Choose a configured provider for voice dictation.');
      const model = text(dictation.model, 'Dictation model', 256).trim();
      if (!model) throw new Error('Enter the transcription model ID.');
      this.data.preferences.dictation = { provider: dictation.provider, model };
    }
    if (values.general !== undefined) this.data.preferences.general = this.mergeGeneral(values.general, this.data.preferences.general);
    if (values.context !== undefined) this.data.preferences.context = this.mergeContext(values.context, this.data.preferences.context);
    await this.save();
  }

  private mergeGeneral(patch: Partial<GeneralSettings>, current: GeneralSettings): GeneralSettings {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid general settings.');
    const next = { ...current };
    const booleans = ['inputWhileRunning', 'slashCommandDisplay', 'skipUnansweredQuestions', 'promptSuggestions', 'showThinking', 'goalDriven', 'homeGame', 'skillSuggestions', 'turnNotifications', 'turnSound'] as const;
    for (const key of booleans) {
      const value = patch[key];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') throw new Error('General settings toggles must be on or off.');
      next[key] = value;
    }
    if (patch.conversationDisplay !== undefined) {
      if (!['comfortable', 'compact'].includes(patch.conversationDisplay)) throw new Error('Choose a valid conversation display.');
      next.conversationDisplay = patch.conversationDisplay;
    }
    if (patch.artifactDir !== undefined) next.artifactDir = artifactDir(patch.artifactDir);
    if (patch.skillRegistry !== undefined) next.skillRegistry = skillRegistry(patch.skillRegistry);
    return next;
  }

  private mergeContext(patch: Partial<ContextSettings>, current: ContextSettings): ContextSettings {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid context settings.');
    const next = { ...current };
    if (patch.autoCompact !== undefined) {
      if (typeof patch.autoCompact !== 'boolean') throw new Error('Auto compaction must be on or off.');
      next.autoCompact = patch.autoCompact;
    }
    if (patch.shareProject !== undefined) {
      if (typeof patch.shareProject !== 'boolean') throw new Error('Project context sharing must be on or off.');
      next.shareProject = patch.shareProject;
    }
    if (patch.compactThreshold !== undefined) next.compactThreshold = compactThreshold(patch.compactThreshold);
    return next;
  }

  async archiveSession(id: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(id)) throw new Error('Invalid task identifier.');
    const archived = this.data.preferences.archivedSessions;
    if (!archived.includes(id)) archived.push(id);
    this.data.preferences.archivedSessions = archived.slice(0, 500);
    await this.save();
  }

  async restoreSession(id: string): Promise<void> {
    this.data.preferences.archivedSessions = this.data.preferences.archivedSessions.filter((item) => item !== id);
    await this.save();
  }

  async saveProvider(input: ProviderInput): Promise<void> {
    const provider = validateProvider(input);
    const existing = this.data.providers.find(item => item.id === provider.id);
    const preset = providerPreset(provider.id);
    const { apiKey, ...publicFields } = provider;
    if (!apiKey && !existing?.encryptedKey && preset && !preset.keyless) {
      throw new Error(`${preset.name} needs an API key before it can be connected.`);
    }
    const encryptedKey = apiKey ? this.codec.encrypt(apiKey) : existing?.encryptedKey;
    this.data.providers = [...this.data.providers.filter(item => item.id !== provider.id), { ...publicFields, encryptedKey }];
    await this.save();
  }

  async removeProvider(id: ProviderInput['id']): Promise<void> {
    if (!providerIDs.includes(id)) throw new Error('Unknown provider.');
    this.data.providers = this.data.providers.filter(item => item.id !== id);
    await this.save();
  }

  async saveMcp(input: McpServer): Promise<void> {
    const server = validateMcp(input);
    this.data.mcp = [...this.data.mcp.filter(item => item.name !== server.name), server];
    await this.save();
  }

  async removeMcp(name: string): Promise<void> {
    this.data.mcp = this.data.mcp.filter(item => item.name !== name);
    await this.save();
  }

  async savePlugins(records: PluginRecord[]): Promise<void> {
    const plugins: PluginRecord[] = [];
    for (const entry of records) {
      const plugin = sanitizePlugin(entry);
      if (plugin && !plugins.some(item => item.id === plugin.id)) plugins.push(plugin);
    }
    this.data.plugins = plugins.slice(0, 50);
    await this.save();
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<PluginRecord[]> {
    const plugin = this.data.plugins.find(item => item.id === id);
    if (!plugin) throw new Error('Install this plugin first.');
    plugin.enabled = Boolean(enabled);
    await this.save();
    return this.plugins;
  }

  async removePlugin(id: string): Promise<PluginRecord[]> {
    this.data.plugins = this.data.plugins.filter(item => item.id !== id);
    await this.save();
    return this.plugins;
  }

  private async save(): Promise<void> {
    const contents = JSON.stringify(this.data, null, 2);
    this.writes = this.writes.catch(() => {}).then(async () => {
      const temporary = join(this.directory, `settings-${randomUUID()}.tmp`);
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, join(this.directory, 'settings.json'));
    });
    return this.writes;
  }
}
