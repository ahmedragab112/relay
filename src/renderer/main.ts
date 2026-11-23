import './styles.css';
import type { AppEvent, AppState, EngineStatus, SearchMode, SessionSummary } from '../shared/contracts';
import { SCRATCH_WORKSPACE_ID } from '../shared/contracts';
import { byId, button, el, notify, report, run } from './dom';
import { applyLanguage } from './i18n';
import { confirmAction, dialog } from './dialog';
import { ChatView } from './chat';
import { Composer } from './composer';
import { QueueView } from './queue';
import { InspectorSplitter } from './splitter';
import { Inspector } from './inspector';
import { RequestView } from './requests';
import { Sessions, type AtlasActionTarget } from './sessions';
import { BranchBar } from './branch-bar';
import { AttentionView } from './attention';
import { DesignPage } from './design-page';
import { MotionPage } from './motion-page';
import { ToolsPage, type ToolsMode } from './tools-page';
import { playChime } from './chime';
import { TerminalView } from './terminal';
import { showSettings, closeSettings } from './settings';
import { showAutomation, closeAutomation } from './automation';
import { AtlasPanel, type AtlasTarget } from './atlas-page';
import { KnowledgePanel } from './knowledge-page';
import { showPalette, type Command } from './palette';
import { wirePlusMenu } from './plus-menu';
import { showSearch, showTaskSearch } from './search';
import { ReviewCard } from './review';
import { UsageMeter } from './usage';
import { homeGame } from './home-game';
import { coalescedReload } from './reload';
import { shouldDismissAttention } from './state';
import { disposeWorkers, editorTheme } from './monaco';
import { shortcutLabel } from './shortcuts';
import { providerPreset } from '../shared/providers';

let state: AppState | undefined;
let changingWorkspace = false;
let selectedId = '';
let selectedSession: SessionSummary | undefined;
let modelRequest = 0;
let initialized = false;
let disposed = false;
let unsubscribe: (() => void) | undefined;
let engineRevision = 0;
let lastEngine: EngineStatus | undefined;
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const chat = new ChatView({
  copy: async value => { await window.relay.copyText(value); notify('Copied response.'); },
  summary: async value => { await window.relay.copyText(value); notify('Chat summary copied.'); },
  react: async (messageId, reaction) => {
    if (!selectedId) return;
    await window.relay.setMessageReaction(selectedId, messageId, reaction);
    messagesReload.request();
  },
  fork: async messageId => {
    await sessions.fork(messageId);
    notify('Branched into a new task.');
  },
  addContext: (label, text) => {
    if (!composer.addContext(label, text)) { notify('Remove a context tag before adding another.', true); return false; }
    notify('Response added to your next message.');
    return true;
  },
  send: text => composer.sendText(text),
});
const requests = new RequestView();
const inspector = new Inspector(openSession);
const splitter = new InspectorSplitter();
const terminal = new TerminalView();
const composer = new Composer(() => {
  messagesReload.request(); sessionsReload.request(); changesReload.request(); requestsReload.request(); queueReload.request();
}, async values => { apply(await window.relay.savePreferences(values)); }, () => {
  const preferences = state?.preferences.dictation;
  if (!preferences?.model) return false;
  const provider = state?.providers.find(item => item.id === preferences.provider);
  return Boolean(provider && (provider.hasKey || providerPreset(preferences.provider)?.keyless));
});
const sessions = new Sessions(selectSession, openFolder, () => reviewReload.request(), id => requests.pendingFor(id) > 0,
  target => { void openAtlas(target); }, {
    open: id => { void openArtifactTask(id); },
    reveal: async id => {
      const slug = await window.relay.designForSession(id);
      if (slug) { await window.relay.designReveal(slug); return; }
      const motionSlug = await window.relay.motionForSession(id);
      if (!motionSlug) throw new Error('This task is not linked to a design or motion.');
      await window.relay.motionReveal(motionSlug);
    },
    remove: async id => {
      const slug = await window.relay.designForSession(id);
      if (slug) { design.consume(await window.relay.designDelete(slug)); return; }
      const motionSlug = await window.relay.motionForSession(id);
      if (!motionSlug) throw new Error('This task is not linked to a design or motion.');
      motion.consume(await window.relay.motionDelete(motionSlug));
    },
  });
const branchBar = new BranchBar(id => sessions.open(id));
const attention = new AttentionView({ openTask: id => sessions.open(id) });
const design = new DesignPage({ openTask: id => sessions.open(id), deleted: () => sessionsReload.request() });
const motion = new MotionPage({ openTask: id => sessions.open(id), deleted: () => sessionsReload.request() });
let pendingAtlasTarget: AtlasTarget | undefined;
const tools = new ToolsPage({
  openTask: openSession,
  openFolder: id => { void openFolder(id); },
  atlasOpen: () => {
    const target = pendingAtlasTarget;
    pendingAtlasTarget = undefined;
    void atlas.open(target);
  },
  atlasRefresh: () => { void atlas.reload(true); },
  atlasClose: () => atlas.hide(),
  knowledgeOpen: () => knowledge.open(),
  knowledgeRefresh: () => { void knowledge.reload(); },
  knowledgeClose: () => knowledge.hide(),
});
const knowledge = new KnowledgePanel({
  attach: (label, text) => composer.addContext(label, text),
});
const atlas = new AtlasPanel({
  openFile: (path, line) => { closeOverlayPages(); showInspector(); inspector.openPath(path, line); },
  tasks: () => {
    const path = state?.workspace?.path;
    return path ? sessions.items.filter(item => item.directory === path) : [];
  },
  workspacePath: () => state?.workspace?.path,
  folders: () => (state?.workspaces ?? []).filter(item => item.id !== SCRATCH_WORKSPACE_ID),
  folder: () => state?.workspace && state.workspace.id !== SCRATCH_WORKSPACE_ID ? state.workspace.id : undefined,
  openFolder: id => { void openFolder(id); },
  openProject: () => { void openProject().catch(error => report('Could not open project', error)); },
});
const queue = new QueueView(message => composer.restoreQueued(message));
const review = new ReviewCard(() => { showInspector(); inspector.reviewSession(); }, () => inspector.follow('edit'));
const usage = new UsageMeter(() => { messagesReload.request(); changesReload.request(); reviewReload.request(); });
const messagesReload = coalescedReload(async () => { await chat.reload(); }, error => report('Conversation refresh failed', error), 90);
const queueReload = coalescedReload(() => queue.reload(), error => report('Queued messages refresh failed', error), 120);
const sessionsReload = coalescedReload(() => sessions.reload(), error => report('Task refresh failed', error), 400);
const sessionsRefresh = coalescedReload(() => sessions.reload(), error => report('Task refresh failed', error), 1_500);
const changesReload = coalescedReload(() => inspector.reloadChanges(), error => report('Changes refresh failed', error), 650);
const activityReload = coalescedReload(() => inspector.activity.reload(), error => report('Activity refresh failed', error), 2_500);
const reviewReload = coalescedReload(() => review.reload(), error => report('Could not read task changes', error), 900);
const requestsReload = coalescedReload(() => requests.reload(), error => report('Could not load agent requests. Refresh tasks to retry', error), 160);
const attentionReload = coalescedReload(() => attention.reload(), error => report('Could not load attention items', error), 200);
const visibleChanges = () => inspector.currentTab === 'changes';
const visibleActivity = () => inspector.currentTab === 'activity';

function appearance(): void {
  if (!state) return;
  const light = state.preferences.theme === 'light' || (state.preferences.theme === 'system' && !systemTheme.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  editorTheme(light); terminal.theme();
}

function engine(status: EngineStatus): void {
  byId('engine-dot').className = `status-dot ${status.state}`;
  byId('engine-status').textContent = `Engine ${status.state}${status.version ? ` · ${status.version}` : ''} — ${status.detail}`;
  byId('engine-status').title = status.detail;
  const sidebarEngine = byId('sidebar-engine');
  sidebarEngine.className = `sidebar-engine ${status.state}`;
  sidebarEngine.textContent = status.state === 'ready' ? 'Local' : status.state;
  sidebarEngine.title = `Engine ${status.state} — ${status.detail}`;
  byId('retry-state').hidden = status.state !== 'error' && status.state !== 'stopped';
  inspector.setReady(status.state === 'ready');
  composer.setEngine(status);
  byId<HTMLButtonElement>('new-task').disabled = changingWorkspace || status.state !== 'ready';
  byId<HTMLButtonElement>('tools-button').disabled = !state?.workspace || status.state !== 'ready';
  attention.setEnabled(Boolean(state?.workspace) && status.state === 'ready');
  const artifacts = Boolean(state?.workspace) && state?.workspace?.id !== SCRATCH_WORKSPACE_ID && status.state === 'ready';
  design.setEnabled(artifacts);
  motion.setEnabled(artifacts);
}

function applyPlatform(next: AppState): void {
  const root = document.documentElement;
  root.dataset.platform = next.platform;
  root.dataset.material = next.material;
  if (next.accent) root.style.setProperty('--os-accent', next.accent);
  for (const label of document.querySelectorAll<HTMLElement>('[data-shortcut]')) {
    const combo = label.dataset.shortcut;
    if (combo) label.textContent = shortcutLabel(next.platform, combo);
  }
}

function key(combo: string): string {
  return shortcutLabel(state?.platform ?? 'darwin', combo);
}

function apply(next: AppState): void {
  if (disposed) return;
  const previousWorkspace = state?.workspace?.id;
  state = next;
  applyPlatform(next);
  const scratch = next.workspace?.id === SCRATCH_WORKSPACE_ID;
  byId('workspace-button').textContent = scratch ? 'No folder' : next.workspace?.name ?? 'Open project';
  byId('workspace-button').title = next.workspace?.path ?? 'Open or switch local project';
  byId('workspace-path').textContent = next.workspace?.path ?? 'No project open';
  const light = next.preferences.theme === 'light' || (next.preferences.theme === 'system' && !systemTheme.matches);
  const themeToggle = byId('theme-toggle');
  themeToggle.setAttribute('aria-pressed', String(light));
  themeToggle.title = light ? 'Switch to dark theme' : 'Switch to light theme';
  byId('app-version').textContent = `Relay ${next.version} · ${next.arch}`;
  byId<HTMLButtonElement>('terminal-button').disabled = !next.workspace || changingWorkspace;
  byId('app').classList.toggle('compact-chat', next.preferences.general.conversationDisplay === 'compact');
  byId('app').classList.toggle('layout-inbox', next.preferences.general.layout === 'inbox');
  byId('app').classList.toggle('layout-focus', next.preferences.general.layout === 'focus');
  document.documentElement.dataset.accent = next.preferences.general.accent;
  byId('conversation').classList.toggle('hide-thinking', !next.preferences.general.showThinking);
  requests.setSkipUnanswered(next.preferences.general.skipUnansweredQuestions);
  applyLanguage(next.preferences.general.language);
  appearance(); engine(next.engine);
  design.refreshMode();
  motion.refreshMode();
  composer.setPreferences(next.preferences);
  if (!initialized || previousWorkspace !== next.workspace?.id) {
    initialized = true;
    selectedId = ''; modelRequest++;
    composer.reset(); composer.setModels([], next.preferences.defaultModel);
    queue.select('');
    requests.clear(); inspector.setWorkspace(next.workspace?.id ?? '');
    atlas.setWorkspace(next.workspace && next.workspace.id !== SCRATCH_WORKSPACE_ID ? next.workspace.id : undefined);
    design.setWorkspace(next.workspace && next.workspace.id !== SCRATCH_WORKSPACE_ID ? next.workspace.id : undefined);
    motion.setWorkspace(next.workspace && next.workspace.id !== SCRATCH_WORKSPACE_ID ? next.workspace.id : undefined);
    usage.setSession(''); review.setSession('');
    sessions.reset(!!next.workspace, next.workspaces, next.workspace?.id);
    if (next.workspace && next.engine.state === 'ready') {
      sessionsReload.request(); requestsReload.request(); attentionReload.request();
      void refreshModels().catch(error => report('Could not load models. Check settings and refresh models', error));
      void refreshSkills(); void refreshCommands();
    }
  }
}

function homeExtras(): { suggestions?: Array<{ label: string; action: () => void }>; game?: HTMLElement } {
  if (!state?.workspace) return {};
  const preferences = state.preferences.general;
  const extras: { suggestions?: Array<{ label: string; action: () => void }>; game?: HTMLElement } = {};
  if (preferences.promptSuggestions && state.workspace.id !== SCRATCH_WORKSPACE_ID) {
    extras.suggestions = [
      { label: 'Explain this project', action: () => composer.suggest('Explain how this project is structured and how its main parts fit together.') },
      { label: 'Review recent changes', action: () => composer.suggest('Review the current uncommitted changes and flag anything risky.') },
      { label: 'Suggest next steps', action: () => composer.suggest('Suggest the highest-value next steps for this project.') },
    ];
  }
  if (preferences.homeGame) extras.game = homeGame();
  return extras;
}

function selectSession(session?: SessionSummary, userInitiated = false): void {
  const nextId = session?.id ?? '';
  const changed = selectedId !== nextId;
  if (userInitiated) closeOverlayPages();
  if (userInitiated && session) void openArtifactTask(session.id);
  // Automatic selection changes only reset the cross-task pages; the Design page
  // follows its own view updates and should not close under the user's cursor.
  if (shouldDismissAttention(selectedId, nextId, userInitiated)) { attention.close(); tools.close(); }
  selectedId = nextId;
  selectedSession = session;
  composer.select(session); requests.select(nextId); inspector.setSession(nextId);
  usage.setSession(nextId); review.setSession(nextId); queue.select(nextId);
  byId('task-title').textContent = session?.title ?? 'Your workspace';
  byId('task-status').textContent = session ? session.status === 'running' ? 'Running' : session.status === 'error' ? 'Error' : 'Idle' : 'No task selected';
  branchBar.render(sessions.items, session?.id);
  byId<HTMLButtonElement>('task-menu').disabled = !session;
  if (session) {
    chat.select(session.id);
    chat.setRunning(session.status === 'running');
    if (changed) messagesReload.request();
  } else if (!state?.workspace) {
    chat.empty('Build with your own models.', 'Open a local project, attach a provider (most free tiers work), and your tasks run against the local OpenCode engine on this Mac.', [
      { label: 'Open project', action: openProject }, { label: 'Configure model', action: settings },
    ]);
  } else if (state.workspace.id === SCRATCH_WORKSPACE_ID) {
    chat.empty('What should we work on?', 'No folder needed — describe the goal and Relay works in a shared space. Switch projects from the sidebar anytime.', [
      { label: 'New task', action: newTask }, { label: 'Configure model', action: settings },
    ], homeExtras());
  } else {
    chat.empty('What should we build?', 'Describe the goal. Relay inspects your project, makes the changes, and verifies them before declaring done.', [
      { label: 'New task', action: newTask }, { label: 'Configure model', action: settings },
    ], homeExtras());
  }
}

async function refreshModels(): Promise<void> {
  if (!state?.workspace) return;
  const workspaceId = state.workspace.id;
  const request = ++modelRequest;
  const models = await window.relay.listModels();
  if (disposed || request !== modelRequest || state?.workspace?.id !== workspaceId) return;
  composer.setModels(models, state.preferences.defaultModel);
}

async function refreshSkills(): Promise<void> {
  if (!state?.workspace) { composer.setSkills([]); return; }
  const workspaceId = state.workspace.id;
  try {
    const skills = await window.relay.listSkills();
    if (disposed || state?.workspace?.id !== workspaceId) return;
    composer.setSkills(skills);
  } catch (error) {
    report('Could not load skills', error);
  }
}

async function refreshCommands(): Promise<void> {
  if (!state?.workspace || state.engine.state !== 'ready') { composer.setCommands([]); return; }
  const workspaceId = state.workspace.id;
  try {
    const commands = await window.relay.listCommands();
    if (disposed || state?.workspace?.id !== workspaceId) return;
    composer.setCommands(commands);
  } catch (error) {
    report('Could not load commands', error);
  }
}

// Only one overlay page may be visible at a time (settings/automation/toolkit/attention stack).
const closeOverlayPages = (): void => { closeSettings(); closeAutomation(); atlas.hide(); knowledge.hide(); tools.close(); attention.close(); design.close(); motion.close(); };

async function toggleTheme(): Promise<void> {
  if (!state) return;
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try { apply(await window.relay.savePreferences({ theme: next })); }
  catch (error) { report('Could not change the theme', error); }
}

function settings(): void {
  if (!state) { notify('App state is not available yet. Use Refresh to retry.', true); return; }
  closeOverlayPages();
  showSettings(() => state!, apply, refreshModels, {
    openToolkit: (mode) => { closeOverlayPages(); tools.show(mode); },
  });
}

async function newTask(): Promise<void> {
  if (changingWorkspace) return;
  if (!state?.workspace) {
    if (!await changeWorkspace(() => window.relay.switchWorkspace(SCRATCH_WORKSPACE_ID))) return;
  }
  if (state?.engine.state !== 'ready') { notify(`Engine ${state?.engine.state ?? 'stopped'}: ${state?.engine.detail ?? 'not ready'}. Wait for ready or check settings.`, true); return; }
  const control = byId<HTMLButtonElement>('new-task'); control.disabled = true;
  try { await sessions.create(); composer.focus(); }
  finally { if (state) engine(state.engine); }
}

async function changeWorkspace(action: () => Promise<AppState | null>): Promise<boolean> {
  if (changingWorkspace) return false;
  changingWorkspace = true;
  byId<HTMLButtonElement>('open-project').disabled = true;
  byId<HTMLButtonElement>('workspace-button').disabled = true;
  byId<HTMLButtonElement>('new-task').disabled = true;
  byId<HTMLButtonElement>('terminal-button').disabled = true;
  try {
    if (!await inspector.editor.canLeave()) return false;
    if (terminal.active) {
      if (!await confirmAction('Switch project?', 'Switching projects closes the current terminal. Any running shell process will be stopped.', 'Close terminal and continue')) return false;
      await terminal.close();
    }
    const next = await action();
    if (!next) return false;
    apply(next);
    return true;
  } finally {
    changingWorkspace = false;
    byId<HTMLButtonElement>('open-project').disabled = false;
    byId<HTMLButtonElement>('workspace-button').disabled = false;
    if (state) {
      engine(state.engine); byId<HTMLButtonElement>('terminal-button').disabled = !state.workspace;
      if (state.workspace && state.engine.state === 'ready') { sessionsReload.request(); requestsReload.request(); attentionReload.request(); messagesReload.request(); changesReload.request(); activityReload.request(); void refreshSkills(); void refreshCommands(); }
    }
  }
}

async function openFolder(workspaceId: string): Promise<boolean> {
  if (!state?.workspaces.some(workspace => workspace.id === workspaceId)) return false;
  if (state.workspace?.id === workspaceId) return true;
  return changeWorkspace(() => window.relay.switchWorkspace(workspaceId));
}

async function openProject(): Promise<void> { await changeWorkspace(() => window.relay.openWorkspace()); }

function workspacePicker(): void {
  if (!state?.workspaces.length) { void openProject().catch(error => report('Could not open project', error)); return; }
  const modal = dialog('Local projects');
  modal.add(button('Open another project…', async () => { modal.root.close(); await openProject(); }, 'button primary'));
  for (const workspace of state.workspaces) {
    const control = button('', async () => {
      if (state?.workspace?.id === workspace.id) { modal.root.close(); return; }
      modal.busy(true);
      try { await changeWorkspace(() => window.relay.switchWorkspace(workspace.id)); modal.root.close(); }
      catch (error) { modal.fail(error); }
      finally { modal.busy(false); }
    }, 'palette-option');
    const text = el('span'); text.append(el('span', '', workspace.id === SCRATCH_WORKSPACE_ID ? 'No folder' : workspace.name),
      el('div', 'project-path', workspace.id === SCRATCH_WORKSPACE_ID ? 'Shared space for tasks without a project' : workspace.path));
    control.append(text);
    if (workspace.id === state.workspace?.id) control.append(el('span', 'pill', 'Current'));
    modal.add(control);
  }
  if (state.workspaces.some(workspace => workspace.id === SCRATCH_WORKSPACE_ID)) {
    modal.add(button('Show No folder on disk', async () => {
      try { await window.relay.revealWorkspace(SCRATCH_WORKSPACE_ID); modal.root.close(); }
      catch (error) { modal.fail(error); }
    }, 'palette-option'));
  }
}

function toggleInspector(): void {
  splitter.toggle();
}

function toggleSidebar(): void {
  const hidden = byId('app').classList.toggle('sidebar-hidden');
  const control = byId<HTMLButtonElement>('sidebar-button');
  control.setAttribute('aria-pressed', String(!hidden));
  control.title = hidden ? 'Show the sidebar' : 'Hide the sidebar';
}

function showInspector(): void {
  splitter.show();
}

function search(mode: SearchMode): void {
  if (!state?.workspace) { notify('Open a project to search its files.', true); return; }
  showSearch(mode, (path, line) => { showInspector(); inspector.openPath(path, line); });
}

function openSession(id: string): void { sessions.open(id); }

/** A design or motion task opens its studio; ordinary tasks fall through to the chat. */
async function openArtifactTask(sessionId: string): Promise<void> {
  try {
    const slug = await window.relay.designForSession(sessionId);
    if (slug) { closeOverlayPages(); design.openAt(slug); return; }
    const motionSlug = await window.relay.motionForSession(sessionId);
    if (!motionSlug) return;
    closeOverlayPages();
    motion.openAt(motionSlug);
  } catch (error) {
    report('Could not open the design task', error);
  }
}

function searchTasks(): void {
  showTaskSearch(hit => {
    if (!sessions.items.some(item => item.id === hit.sessionId)) void sessions.reload().then(() => sessions.open(hit.sessionId));
    else sessions.open(hit.sessionId);
    if (hit.messageId) revealMessage(hit.sessionId, hit.messageId);
  });
}

// The transcript reloads after the switch; keep asking until the reply is on screen.
function revealMessage(sessionId: string, messageId: string): void {
  if (selectedId === sessionId && chat.locate(messageId)) return;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts++;
    if (selectedId === sessionId && chat.locate(messageId)) { window.clearInterval(timer); return; }
    if (attempts >= 80) window.clearInterval(timer);
  }, 100);
}

function openTools(mode: ToolsMode): void {
  closeOverlayPages();
  tools.show(mode);
}

async function openAtlas(target?: AtlasActionTarget): Promise<void> {
  if (!state?.workspace || state.workspace.id === SCRATCH_WORKSPACE_ID) {
    notify('Open a project folder to give Atlas code to read.', true);
    return;
  }
  if (target?.workspaceId && state.workspace.id !== target.workspaceId) {
    const opened = await openFolder(target.workspaceId);
    if (!opened) return;
  }
  closeOverlayPages();
  pendingAtlasTarget = target ? { sessionId: target.sessionId, create: true } : undefined;
  tools.show('atlas');
}

function toggleAttention(): void {
  if (!attention.isOpen) closeOverlayPages();
  attention.toggle();
}

function toggleDesign(): void {
  if (!design.isOpen) closeOverlayPages();
  design.toggle();
}

function openMotion(): void {
  closeOverlayPages();
  motion.toggle();
}

function openAutomation(): void {
  closeOverlayPages();
  showAutomation(async id => {
    await sessions.reload();
    sessions.select(id);
  });
}

function palette(): void {
  const commands: Command[] = [
    { label: 'Open project…', action: openProject }, { label: 'Switch project', action: workspacePicker },
    { label: 'Settings / Configure model', shortcut: key('Mod+,'), action: settings },
    { label: 'Toggle file inspector', action: toggleInspector },
  ];
  if (state?.workspace) {
    commands.push({ label: 'New task', shortcut: key('Mod+N'), action: newTask },
      { label: 'Template: Debug failing test', action: () => void composer.sendText('A test is failing. Reproduce it, find the root cause, fix it, and verify by running the test again.') },
      { label: 'Template: Review this diff', action: () => void composer.sendText('Review the current changes: list correctness bugs, security risks and design problems with file references, then summarize what is safe to ship.') },
      { label: 'Template: Write tests', action: () => void composer.sendText('Write tests for the code I just changed. Cover the happy path, edge cases and error paths, then run them.') },
      { label: 'Template: Explain this repo', action: () => void composer.sendText('Explain how this repository is structured: the entry points, data flow, and the two or three files that matter most. Keep it short.') },
      { label: 'Go to file…', shortcut: key('Mod+P'), action: () => search('files') },
      { label: 'Search in files…', shortcut: key('Mod+F'), action: () => search('content') },
      { label: 'Search tasks & messages…', shortcut: key('Mod+Shift+F'), action: searchTasks },
      { label: 'Open in-app browser', action: () => { showInspector(); inspector.openBrowser(); } },
      { label: 'Open terminal', action: () => terminal.open() },
      { label: 'Save current file', shortcut: key('Mod+S'), action: () => inspector.editor.save() },
      { label: 'Toolkit — skills', action: () => openTools('skills') }, { label: 'Commands', action: () => composer.pickCommands() }, { label: 'Toolkit — plugins', action: () => openTools('plugins') }, { label: 'Toolkit — connectors', action: () => openTools('connectors') }, { label: 'Toolkit — knowledge', action: () => openTools('knowledge') },
      { label: 'Scheduled automation', action: openAutomation },
      { label: 'Atlas — project knowledge', action: () => { void openAtlas(); } },
      { label: 'Attention — agent requests', action: () => { closeOverlayPages(); attention.show(); } },
      { label: 'Design — pages for this project', action: () => { closeOverlayPages(); design.toggle(); } },
      { label: 'Motion — animated scenes for this project', action: openMotion },
      { label: 'Usage & context', action: () => usage.open() },
      { label: 'Compact conversation', action: () => usage.compactNow() },
      ...sessions.items.map(session => ({ label: `Task: ${session.title}`, action: () => sessions.open(session.id) })));
  }
  showPalette(commands);
}

function event(event: AppEvent): void {
  if (disposed) return;
  terminal.event(event);
  if (event.type === 'engine') {
    engineRevision++; lastEngine = event.status;
    if (state) state = { ...state, engine: event.status };
    engine(event.status);
    if (event.status.state === 'ready' && state?.workspace && !changingWorkspace) {
      sessionsReload.request(); requestsReload.request(); attentionReload.request();
      void refreshModels().catch(error => report('Could not refresh available models', error));
      void refreshSkills(); void refreshCommands();
    }
  } else if (event.type === 'models-changed') {
    refreshModels();
  } else if (event.type === 'agent-open-page') {
    showInspector(); inspector.openPage(event.url); notify('Agent opened a page in the browser.');
  } else if (event.type === 'auto-switched') {
    if (event.sessionId === selectedId) notify(`Model limit reached — switched to ${event.model} and continued the task.`);
    messagesReload.request();
  } else if (event.type === 'error') report('Engine reported an error', event.message);
  if (changingWorkspace) return;
  requests.event(event);
  if (event.type === 'design') { if (event.workspaceId === state?.workspace?.id) design.consume(event.view); }
  else if (event.type === 'design-files') { if (event.workspaceId === state?.workspace?.id) design.filesChanged(event.slug, event.stamp); }
  else if (event.type === 'motion') { if (event.workspaceId === state?.workspace?.id) motion.consume(event.view); }
  else if (event.type === 'motion-export') {
    if (event.workspaceId !== state?.workspace?.id) return;
    if (event.status === 'running') motion.noteExport(event.progress);
    else if (event.status === 'failed' && event.message) notify(`Export failed: ${event.message}`, true);
  }
  else if (event.type === 'session-changed' || event.type === 'session-idle') {
    design.noteSession(event.sessionId, event.type === 'session-idle');
    motion.noteSession(event.sessionId, event.type === 'session-idle');
  }
  const attentionEvent = event.type === 'permission' || event.type === 'permission-resolved' || event.type === 'question' || event.type === 'question-resolved';
  if (attentionEvent || (attention.isOpen && (event.type === 'session-idle' || event.type === 'session-changed' || event.type === 'sessions-changed'))) attentionReload.request();
  if (attentionEvent) sessionsRefresh.request();
  if (event.type === 'job-preview') {
    showInspector(); inspector.openPage(event.url);
    let host = event.url;
    try { host = new URL(event.url).host; } catch { /* keep the raw address */ }
    notify(`Automation “${event.jobName}” opened ${host} in the editor.`);
  } else if (event.type === 'session-stream') {
    design.stream(event.sessionId, event);
    if (event.sessionId === selectedId) { chat.stream(event); inspector.beginTurn(); }
  } else if (event.type === 'session-changed') {
    if (event.sessionId === selectedId) {
      messagesReload.request(); queueReload.request();
      reviewReload.request();
      if (visibleChanges()) changesReload.request();
    }
    if (visibleActivity()) activityReload.request();
    sessionsRefresh.request();
  } else if (event.type === 'session-idle') {
    if (event.chime) playChime();
    if (event.sessionId === selectedId) {
      inspector.endTurn();
      messagesReload.request(); queueReload.request(); usage.load(); chat.settleStream();
      if (visibleChanges()) changesReload.request();
      reviewReload.request();
      if (state?.preferences.general.skillSuggestions) composer.suggestSkills();
    }
    if (visibleActivity()) activityReload.request();
    sessionsReload.request();
  } else if (event.type === 'usage') usage.apply(event.sessionId, event.usage);
  else if (event.type === 'open-session') { closeOverlayPages(); sessions.open(event.sessionId); }
  else if (event.type === 'sessions-changed') sessionsReload.request();
  else if (event.type === 'atlas') { if (event.workspaceId === state?.workspace?.id) atlas.consume(event.view); }
  else if (event.type === 'skills-changed') { void refreshSkills(); if (tools.isOpen) void tools.reload(); }
  else if (event.type === 'plugins-changed' && tools.isOpen) void tools.reload();
  else if (event.type === 'commands-changed') void refreshCommands();
}

async function boot(): Promise<void> {
  const revision = engineRevision;
  try {
    unsubscribe ??= window.relay.onEvent(event);
    const next = await window.relay.getState();
    if (revision !== engineRevision && lastEngine) next.engine = lastEngine;
    apply(next);
    if (next.workspace && next.engine.state === 'ready') { sessionsReload.request(); requestsReload.request(); attentionReload.request(); void refreshSkills(); void refreshCommands(); }
  } catch (error) {
    report('Could not load the app. Refresh to retry; if this persists, relaunch Relay', error);
    byId('engine-status').textContent = 'App unavailable · Could not reach the local engine';
    byId('engine-dot').className = 'status-dot error';
    byId('retry-state').hidden = false;
    chat.empty('Let’s reconnect.', 'The local app could not be loaded. No project data has been substituted.', [{ label: 'Retry', action: boot }]);
  }
}

function bind(id: string, action: () => void | Promise<void>): void {
  const control = byId<HTMLButtonElement>(id);
  control.addEventListener('click', () => void run(control, action));
}
bind('open-project', openProject);
bind('workspace-button', workspacePicker);
bind('new-task', newTask);
bind('window-minimize', () => window.relay.minimizeWindow());
bind('window-zoom', () => window.relay.zoomWindow());
bind('window-close', () => window.relay.closeWindow());
document.querySelector('.titlebar')?.addEventListener('dblclick', (event) => {
  if ((event.target as HTMLElement).closest('button')) return;
  if (document.documentElement.dataset.platform !== 'linux') return;
  void window.relay.zoomWindow();
});
bind('refresh-tasks', async () => { await sessions.reload(); requestsReload.request(); attentionReload.request(); messagesReload.request(); });
bind('workspaces-toggle', () => {
  const collapsed = sessions.toggleAll();
  byId('workspaces-toggle').setAttribute('aria-expanded', String(!collapsed));
});
bind('theme-toggle', toggleTheme);
bind('task-menu', () => sessions.menu());
bind('attention-button', toggleAttention);
bind('attention-close', () => attention.close());
bind('design-button', toggleDesign);
bind('design-close', () => design.close());
bind('design-tile-motion', openMotion);
bind('motion-close', () => motion.close());
bind('attention-refresh', () => attention.reload());
bind('search-button', () => search('files'));
bind('settings-button', settings);
bind('configure-model', settings);
bind('automation-button', openAutomation);
bind('tools-button', () => openTools('skills'));
bind('palette-button', palette);
bind('terminal-button', () => terminal.open());
bind('inspector-button', toggleInspector);
const overflowMenu = byId('title-overflow');
const overflowButton = byId<HTMLButtonElement>('overflow-button');
const setOverflow = (value?: boolean): void => {
  const open = value ?? overflowMenu.hidden;
  overflowMenu.hidden = !open;
  overflowButton.setAttribute('aria-expanded', String(open));
};
overflowButton.addEventListener('click', () => setOverflow());
document.addEventListener('pointerdown', event => {
  if (!(event.target as HTMLElement).closest('.title-overflow-wrap')) setOverflow(false);
});
for (const id of ['terminal-button', 'inspector-button']) byId(id).addEventListener('click', () => setOverflow(false));
bind('sidebar-button', toggleSidebar);
bind('retry-state', boot);
function attachOpenFile(): void {
  if (inspector.editor.path) composer.attach(inspector.editor.path);
  else {
    showInspector(); inspector.tab('files');
    notify('Open a file in the inspector, then use + to attach it to this task.');
  }
}

bind('attach-files', () => composer.pickAttachments());
wirePlusMenu(byId<HTMLButtonElement>('attach-file'), byId('plus-menu'), () => [
  { label: 'Attach files…', icon: 'attach', run: () => composer.pickAttachments() },
  { label: 'Attach open file', hint: 'Editor', icon: 'file', run: attachOpenFile },
  { label: 'Atlas knowledge', hint: '/knowledge', icon: 'book', run: () => composer.pickKnowledge() },
  { label: 'Knowledge library', hint: '@knowledge', icon: 'book', run: () => composer.pickLibrary() },
  { label: 'Task context', hint: '↩', icon: 'layers', run: () => composer.pickContext() },
  { label: 'Plan only', icon: 'plan', divider: true, run: () => composer.togglePlanOnly() },
  { label: 'Skills', icon: 'spark', chevron: true, run: () => composer.pickSkills() },
  { label: 'Plugins', icon: 'grid', chevron: true, run: () => openTools('plugins') },
  { label: 'Tools & agents', hint: '⛭', icon: 'robot', run: () => composer.pickAgents() },
  { label: 'Task history', icon: 'clock', chevron: true, run: searchTasks },
  { label: 'Run a command', icon: 'slash', chevron: true, run: () => composer.pickCommands() },
  { label: 'Open terminal', icon: 'terminal', divider: true, run: () => terminal.open() },
  { label: 'Settings', hint: key('Mod+,'), icon: 'sliders', run: settings },
]);
function dismissNotice(): void {
  const notice = byId('notice');
  if (notice.hidden) return;
  const label = byId('notice-text').textContent;
  const exit = notice.animate(
    [{ opacity: 1, transform: 'translate(-50%, 0)' }, { opacity: 0, transform: 'translate(-50%, 7px)' }],
    { duration: 140, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
  );
  exit.finished.then(() => {
    if (byId('notice-text').textContent !== label) return;
    notice.hidden = true;
  }).catch(() => {});
}
bind('dismiss-notice', dismissNotice);

function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
    if (tools.isOpen) { event.preventDefault(); tools.close(); return; }
    if (attention.isOpen) { event.preventDefault(); attention.close(); return; }
    if (design.isOpen) {
      event.preventDefault();
      if (design.inWorkspace) design.back(); else design.close();
      return;
    }
  }
  if (!(event.metaKey || event.ctrlKey) || event.isComposing || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  if (!['k', 'n', 's', ',', 'f', 'p', 'b'].includes(key)) return;
  // Monaco owns in-file find while the editor has focus.
  if (key === 'f' && byId('editor-host').contains(document.activeElement)) return;
  event.preventDefault();
  if (key === 'k') palette();
  else if (key === 'n') void newTask().catch(error => report('Could not create task', error));
  else if (key === 's') void inspector.editor.save();
  else if (key === 'f') { if (event.shiftKey) searchTasks(); else search('content'); }
  else if (key === 'p') search('files');
  else if (key === 'b') toggleSidebar();
  else settings();
}
document.addEventListener('keydown', keydown);
systemTheme.addEventListener('change', appearance);

let requestingClose = false;
window.relay.onRequestClose(async () => {
  if (requestingClose) return;
  requestingClose = true;
  try {
    if (!inspector.editor.dirty) { await window.relay.confirmClose(); return; }
    const accepted = await confirmAction('Discard unsaved changes?', 'You have unsaved edits in the file. Close anyway and discard them?', 'Discard and close');
    if (accepted) await window.relay.confirmClose();
  } finally { requestingClose = false; }
});
window.addEventListener('unload', () => {
  disposed = true; unsubscribe?.();
  messagesReload.dispose(); sessionsReload.dispose(); sessionsRefresh.dispose(); changesReload.dispose(); activityReload.dispose(); requestsReload.dispose(); reviewReload.dispose();
  chat.dispose(); sessions.dispose(); requests.clear(); inspector.dispose(); terminal.dispose(); disposeWorkers();
  systemTheme.removeEventListener('change', appearance); document.removeEventListener('keydown', keydown);
}, { once: true });
void boot();
