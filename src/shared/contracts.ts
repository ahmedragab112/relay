import type { ConfigurableProviderID } from './providers';

export type AgentMode = 'build' | 'plan';
export type AccessLevel = 'read' | 'ask' | 'auto' | 'full';
export type Theme = 'dark' | 'light' | 'system';
export type PermissionDecision = 'once' | 'reject';

export interface Workspace {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}

export interface ProviderInput {
  id: ConfigurableProviderID;
  apiKey?: string;
  baseURL?: string;
  models?: string[];
}

export interface ProviderSummary {
  id: ProviderInput['id'];
  hasKey: boolean;
  baseURL?: string;
  models?: string[];
}

export interface DictationSettings {
  provider: ConfigurableProviderID;
  model: string;
}

export type ConversationDisplay = 'comfortable' | 'compact';
export type Language = 'en' | 'ar';
export type Layout = 'tabs' | 'inbox' | 'focus';
export type Accent = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan';

export interface GeneralSettings {
  inputWhileRunning: boolean;
  slashCommandDisplay: boolean;
  skipUnansweredQuestions: boolean;
  artifactDir: string;
  promptSuggestions: boolean;
  conversationDisplay: ConversationDisplay;
  showThinking: boolean;
  goalDriven: boolean;
  homeGame: boolean;
  skillSuggestions: boolean;
  skillRegistry: string;
  turnNotifications: boolean;
  turnSound: boolean;
  requestNotifications: boolean;
  language: Language;
  layout: Layout;
  accent: Accent;
}

export interface ContextSettings {
  autoCompact: boolean;
  compactThreshold: number;
  shareProject: boolean;
}

export interface AutoSettings {
  includeFree: boolean;
  maxTokens: number;
  modelIds: string[];
}

export interface Preferences {
  theme: Theme;
  defaultModel: string;
  defaultAccess: AccessLevel;
  modelVariant: string;
  dictation: DictationSettings;
  general: GeneralSettings;
  context: ContextSettings;
  auto: AutoSettings;
  archivedSessions: string[];
  activeWorkspaceId?: string;
}

export interface PreferencesPatch {
  theme?: Theme;
  defaultModel?: string;
  defaultAccess?: AccessLevel;
  modelVariant?: string;
  dictation?: DictationSettings;
  general?: Partial<GeneralSettings>;
  context?: Partial<ContextSettings>;
  auto?: Partial<AutoSettings>;
}

export interface ContextBlock {
  label: string;
  text: string;
}

export interface UsageSummary {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  contextUsed: number;
  contextLimit?: number;
  percent: number;
  cost: number;
  compactions: number;
  worked: number;
  model?: string;
}

export interface DictationInput {
  mime: string;
  data: ArrayBuffer;
}

export interface EngineStatus {
  state: 'stopped' | 'starting' | 'ready' | 'error';
  detail: string;
  version?: string;
}

export interface ModelOption {
  id: string;
  providerID: string;
  modelID: string;
  name: string;
  connected: boolean;
  free?: boolean;
  variants?: string[];
  context?: number;
  cost?: number;
  limited?: boolean;
}

export function autoModelCandidates(models: ModelOption[], settings?: AutoSettings): Array<{ id: string; variant: string }> {
  const includeFree = settings?.includeFree ?? true;
  const allowed = settings?.modelIds?.length ? new Set(settings.modelIds) : null;
  return models
    .filter((model) => model.connected)
    .filter((model) => includeFree || !model.free)
    .filter((model) => !allowed || allowed.has(model.id))
    .sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0) || (a.context ?? 0) - (b.context ?? 0))
    .slice(0, 6)
    .map((model) => ({ id: model.id, variant: model.variants?.[0] ?? '' }));
}

export interface AgentOption {
  name: string;
  description: string;
  primary: boolean;
}

export interface SkillOption {
  id: string;
  name: string;
  description: string;
  library?: boolean;
}

export interface SkillLibraryEntry {
  id: string;
  name: string;
  description: string;
  source: string;
  digest: string;
  installedAt: number;
  files: number;
  bytes: number;
}

export interface CatalogSkillEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  order: number;
}

export interface SkillPreviewItem {
  id: string;
  name: string;
  description: string;
  existing: boolean;
}

export interface SkillFilePreview {
  path: string;
  size: number;
}

export interface SkillPreview {
  token: string;
  digest: string;
  source: string;
  skills: SkillPreviewItem[];
  files: SkillFilePreview[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
}

export interface PluginCapabilities {
  skills: string[];
  commands: string[];
  agents: string[];
  mcp: string[];
  code: string[];
}

export interface PluginFilePreview {
  path: string;
  size: number;
}

export interface PluginCodePreview {
  path: string;
  content: string;
}

export interface PluginPreview {
  token: string;
  digest: string;
  manifest: PluginManifest;
  files: PluginFilePreview[];
  capabilities: PluginCapabilities;
  code: PluginCodePreview[];
}

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description: string;
  digest: string;
  enabled: boolean;
  installedAt: number;
  capabilities: PluginCapabilities;
  codeApproved: boolean;
}

export interface PluginView extends PluginRecord {
  available: boolean;
}

export interface PluginCatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: PluginCapabilities;
  digest: string;
  installed: boolean;
}

export interface CommandOption {
  name: string;
  description: string;
}

export interface RunCommandInput {
  sessionId: string;
  name: string;
  text: string;
  model: string;
  variant: string;
  access: AccessLevel;
  files: string[];
  skills: string[];
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
  status: 'idle' | 'running' | 'error';
  directory?: string;
  fork?: { sessionId: string };
}

export interface TextPart {
  type: 'text' | 'reasoning';
  id: string;
  text: string;
}

export interface ToolPart {
  type: 'tool';
  id: string;
  name: string;
  state: 'pending' | 'running' | 'completed' | 'error';
  background?: boolean;
  input: string;
  output: string;
}

export interface AttachmentPart {
  type: 'file';
  id: string;
  name: string;
}

export interface CompactionPart {
  type: 'compaction';
  id: string;
  status: 'running' | 'completed' | 'failed';
  reason: 'auto' | 'manual';
  summary: string;
  error?: string;
}

export type MessageReaction = 'like' | 'dislike';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: number;
  completedAt?: number;
  tokens?: number;
  cost?: number;
  model?: string;
  modelVariant?: string;
  parts: Array<TextPart | ToolPart | AttachmentPart | CompactionPart>;
  error?: string;
  reaction?: MessageReaction;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  detail: string;
}

export interface AgentQuestion {
  id: string;
  sessionId: string;
  questions: Array<{
    header: string;
    question: string;
    multiple: boolean;
    custom: boolean;
    required: boolean;
    kind: 'choice' | 'text' | 'number';
    placeholder: string;
    options: Array<{ label: string; description: string; value?: string }>;
  }>;
}

export interface AttentionPermission {
  request: PermissionRequest;
  sessionId: string;
  taskTitle: string;
  folder: string;
}

export interface AttentionQuestion {
  request: AgentQuestion;
  sessionId: string;
  taskTitle: string;
  folder: string;
}

export type AttentionKind = 'permission' | 'question';
export type AttentionOutcome = 'approved' | 'rejected' | 'answered' | 'dismissed' | 'expired';

export interface AttentionRequest {
  id: string;
  kind: AttentionKind;
  sessionId: string;
  taskTitle: string;
  folder: string;
  summary: string;
  detail?: string;
}

export interface AttentionHistoryEntry extends AttentionRequest {
  askedAt: number;
  resolvedAt: number;
  outcome: AttentionOutcome;
  answer?: string;
}

export interface AttentionOverview {
  permissions: AttentionPermission[];
  questions: AttentionQuestion[];
  history: AttentionHistoryEntry[];
}

export interface ActivityChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface ActivitySubagent {
  id: string;
  sessionId: string;
  agent: string;
  title: string;
  description: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  messages: ActivityChatMessage[];
}

export interface ActivitySkill {
  id: string;
  name: string;
  description: string;
  uses: number;
  lastUsed: number;
}

export interface ActivitySkillSuggestion {
  id: string;
  name: string;
  description: string;
  reason: string;
  source?: 'web';
  url?: string;
  sha256?: string;
}

export interface SkillRegistryEntry {
  id: string;
  name: string;
  description: string;
  url: string;
  sha256?: string;
}

export interface ActivityMcp {
  name: string;
  type: 'local' | 'remote';
  uses: number;
  lastUsed: number;
}

export interface ActivityMcpSuggestion {
  name: string;
  type: 'local' | 'remote';
  reason: string;
}

export interface ActivityArtifact {
  id: string;
  title: string;
  provider: string;
  entry: string;
  url: string;
  updatedAt: number;
}

export interface ActivityWebSource {
  id: string;
  kind: 'fetch' | 'search';
  label: string;
  url?: string;
  mentions: number;
  lastUsed: number;
}

export type ActivitySourceKind = 'pdf' | 'image' | 'document' | 'file';

export interface ActivityFileSource {
  path: string;
  name: string;
  kind: ActivitySourceKind;
  mentions: number;
  lastUsed: number;
}

export interface BackgroundRun {
  id: string;
  title: string;
  status: 'idle' | 'running' | 'error';
  startedAt: number;
  updatedAt: number;
  logs: string[];
}

export interface SessionActivity {
  sessionId: string;
  subagents: ActivitySubagent[];
  skills: { used: ActivitySkill[]; suggested: ActivitySkillSuggestion[] };
  mcp: { used: ActivityMcp[]; suggested: ActivityMcpSuggestion[] };
  artifacts: ActivityArtifact[];
  web: ActivityWebSource[];
  sources: ActivityFileSource[];
}

export interface FileEntry {
  path: string;
  name: string;
  directory: boolean;
}

export type SearchMode = 'files' | 'content';

export interface FileSearchResult {
  path: string;
  line?: number;
  preview?: string;
}

export interface FileDocument {
  path: string;
  content: string;
  revision: string;
}

export type JobSchedule =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string };

export type AutomationAction =
  | { kind: 'page'; url: string }
  | {
      kind: 'prompt';
      prompt: string;
      context?: string;
      steps?: string;
      location: 'local';
      output: 'independent' | 'merged';
      access: AccessLevel;
      model: string;
    };

export interface AutomationJob {
  id: string;
  name: string;
  action: AutomationAction;
  schedule: JobSchedule;
  timezone: string;
  expiresAt?: number;
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  nextRun: number;
  sessionId?: string;
  artifactPath?: string;
}

export interface AutomationInput {
  id?: string;
  name: string;
  action: AutomationAction;
  schedule: JobSchedule;
  timezone: string;
  expiresAt?: number;
  enabled: boolean;
}

export interface AutomationExecution {
  detail: string;
  sessionId?: string;
  artifactPath?: string;
}

export interface JobRun {
  id: string;
  jobId: string;
  jobName: string;
  url?: string;
  startedAt: number;
  status: 'ok' | 'error';
  detail: string;
  sessionId?: string;
}

export interface AutomationState {
  jobs: AutomationJob[];
  runs: JobRun[];
}

export interface FileChange {
  path: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface McpServer {
  name: string;
  type: 'local' | 'remote';
  command?: string[];
  url?: string;
  enabled: boolean;
  status?: string;
}

export interface AppState {
  version: string;
  platform: string;
  arch: string;
  material: 'vibrancy' | 'mica' | 'solid';
  accent?: string;
  workspaces: Workspace[];
  workspace?: Workspace;
  preferences: Preferences;
  providers: ProviderSummary[];
  engine: EngineStatus;
}

export interface SendMessageInput {
  sessionId: string;
  text: string;
  goalDriven?: boolean;
  model: string;
  variant: string;
  access: AccessLevel;
  files: string[];
  skills: string[];
  agents?: string[];
  context?: ContextBlock[];
  planOnly?: boolean;
  delivery?: 'steer' | 'queue';
  auto?: boolean;
  autoSettings?: AutoSettings;
}

export interface QueuedMessage {
  id: string;
  text: string;
  files: string[];
  skills: string[];
  agents: string[];
  model: string;
  variant: string;
  access: AccessLevel;
  planOnly: boolean;
  goalDriven: boolean;
  context: ContextBlock[];
  delivery: 'steer' | 'queue';
  createdAt: number;
}

export type AppEvent =
  | { type: 'engine'; status: EngineStatus }
  | { type: 'session-changed'; sessionId: string }
  | { type: 'session-stream'; sessionId: string; messageId: string; kind: 'text' | 'reasoning'; ordinal: number; text: string; ended: boolean }
  | { type: 'session-idle'; sessionId: string; chime?: boolean }
  | { type: 'open-session'; sessionId: string }
  | { type: 'usage'; sessionId: string; usage: UsageSummary }
  | { type: 'sessions-changed' }
  | { type: 'skills-changed' }
  | { type: 'commands-changed' }
  | { type: 'plugins-changed' }
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'permission-resolved'; id: string }
  | { type: 'question'; request: AgentQuestion }
  | { type: 'question-resolved'; id: string }
  | { type: 'automation'; jobs: AutomationJob[]; runs: JobRun[] }
  | { type: 'job-preview'; jobId: string; jobName: string; url: string }
  | { type: 'terminal-data'; id: string; data: string }
  | { type: 'terminal-exit'; id: string; code: number }
  | { type: 'models-changed' }
  | { type: 'agent-open-page'; url: string }
  | { type: 'auto-switched'; sessionId: string; model: string; detail: string }
  | { type: 'error'; message: string };

export interface RelayAPI {
  getState(): Promise<AppState>;
  openWorkspace(): Promise<AppState | null>;
  switchWorkspace(id: string): Promise<AppState>;
  listSessions(): Promise<SessionSummary[]>;
  listAllSessions(): Promise<SessionSummary[]>;
  createSession(title?: string): Promise<SessionSummary>;
  forkSession(id: string, messageId: string): Promise<SessionSummary>;
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  setMessageReaction(sessionId: string, messageId: string, reaction: MessageReaction | null): Promise<void>;
  copyText(value: string): Promise<void>;
  getUsage(sessionId: string): Promise<UsageSummary>;
  compactSession(sessionId: string): Promise<void>;
  getSessionDigest(sessionId: string): Promise<string>;
  archiveSession(id: string): Promise<void>;
  restoreSession(id: string): Promise<void>;
  listArchivedSessions(): Promise<SessionSummary[]>;
  sendMessage(input: SendMessageInput): Promise<void>;
  setSessionAccess(sessionId: string, access: AccessLevel): Promise<void>;
  listQueuedMessages(sessionId: string): Promise<QueuedMessage[]>;
  removeQueuedMessage(sessionId: string, id: string): Promise<void>;
  steerQueuedMessage(sessionId: string, id: string): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  backgroundSession(sessionId: string): Promise<void>;
  listPermissions(): Promise<PermissionRequest[]>;
  replyPermission(id: string, decision: PermissionDecision): Promise<void>;
  listQuestions(): Promise<AgentQuestion[]>;
  answerQuestion(id: string, answers: string[][] | null): Promise<void>;
  attention(): Promise<AttentionOverview>;
  getActivity(sessionId: string): Promise<SessionActivity>;
  backgroundActivity(): Promise<BackgroundRun[]>;
  listModels(): Promise<ModelOption[]>;
  listAgents(): Promise<AgentOption[]>;
  listSkills(): Promise<SkillOption[]>;
  listLibrarySkills(): Promise<SkillLibraryEntry[]>;
  listCatalogSkills(): Promise<CatalogSkillEntry[]>;
  installCatalogSkill(id: string): Promise<SkillLibraryEntry[]>;
  previewSkillFromURL(url: string, sha256?: string): Promise<SkillPreview>;
  installSkills(token: string): Promise<SkillLibraryEntry[]>;
  cancelSkillPreview(token: string): Promise<void>;
  removeSkill(id: string): Promise<SkillLibraryEntry[]>;
  listCommands(): Promise<CommandOption[]>;
  runCommand(input: RunCommandInput): Promise<void>;
  listPlugins(): Promise<PluginView[]>;
  listPluginCatalog(): Promise<PluginCatalogEntry[]>;
  previewPlugin(): Promise<PluginPreview | null>;
  previewCatalogPlugin(id: string): Promise<PluginPreview>;
  importPluginFromURL(url: string, sha256?: string): Promise<PluginPreview>;
  installPlugin(token: string, allowCode: boolean): Promise<PluginView[]>;
  setPluginEnabled(id: string, enabled: boolean): Promise<PluginView[]>;
  removePlugin(id: string): Promise<PluginView[]>;
  getChanges(sessionId: string): Promise<FileChange[]>;
  undoChange(path: string): Promise<'restored' | 'deleted'>;
  listFiles(path?: string): Promise<FileEntry[]>;
  searchFiles(query: string, mode: SearchMode): Promise<FileSearchResult[]>;
  readFile(path: string): Promise<FileDocument>;
  saveFile(path: string, content: string, revision: string): Promise<FileDocument>;
  savePreferences(values: PreferencesPatch): Promise<AppState>;
  chooseArtifactDir(): Promise<string | null>;
  saveProvider(input: ProviderInput): Promise<AppState>;
  removeProvider(id: ProviderInput['id']): Promise<AppState>;
  listMcp(): Promise<McpServer[]>;
  saveMcp(server: McpServer): Promise<void>;
  removeMcp(name: string): Promise<void>;
  createTerminal(cols: number, rows: number): Promise<{ id: string }>;
  writeTerminal(id: string, data: string): Promise<void>;
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>;
  closeTerminal(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  listAutomation(): Promise<AutomationState>;
  saveAutomation(input: AutomationInput): Promise<AutomationState>;
  removeAutomation(id: string): Promise<AutomationState>;
  runAutomation(id: string): Promise<AutomationState>;
  revealAutomationArtifact(id: string): Promise<void>;
  transcribeAudio(input: DictationInput): Promise<string>;
  minimizeWindow(): Promise<void>;
  zoomWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}

declare global {
  interface Window {
    relay: RelayAPI;
    MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker };
  }
}
