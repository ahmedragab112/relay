import type {
  CatalogSkillEntry, ConnectorCatalogEntry, McpRuntimeStatus, McpServer, PluginCapabilities, PluginCatalogEntry, PluginPreview, PluginView, SessionSummary,
  SkillLibraryEntry, Workspace,
} from '../shared/contracts';
import { byId, button, el, errorText, field, notify, option, report } from './dom';
import { confirmAction, dialog } from './dialog';
import { ALL_FILTER, INSTALLED_FILTER, discoveryLayout, pluginFamily, type DiscoveryItem } from './discovery';
import { catalogIconElement, connectorIcon, pluginIcon, skillIcon } from './catalog-icons';
import { showSkillPreview } from './skill-install';
import { externalURL } from './state';
import { searchTasksAndProjects } from './toolkit-search';

export type ToolsMode = 'skills' | 'plugins' | 'connectors' | 'atlas' | 'knowledge';

export interface ToolsPageOptions {
  openTask: (id: string) => void;
  openFolder: (id: string) => void | Promise<void>;
  atlasOpen: () => void;
  atlasRefresh: () => void;
  atlasClose: () => void;
  knowledgeOpen: () => void;
  knowledgeRefresh: () => void;
  knowledgeClose: () => void;
}

const MODES: ToolsMode[] = ['skills', 'plugins', 'connectors', 'atlas', 'knowledge'];

function capabilitySummary({ commands, skills, agents, mcp, code }: PluginCapabilities): string {
  const parts: string[] = [];
  if (commands.length) parts.push(`${commands.length} command${commands.length === 1 ? '' : 's'}`);
  if (skills.length) parts.push(`${skills.length} skill${skills.length === 1 ? '' : 's'}`);
  if (agents.length) parts.push(`${agents.length} agent${agents.length === 1 ? '' : 's'}`);
  if (mcp.length) parts.push(`${mcp.length} MCP server${mcp.length === 1 ? '' : 's'}`);
  if (code.length) parts.push(`${code.length} code file${code.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'No capabilities';
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function taskState(status: SessionSummary['status']): string {
  return status === 'running' ? 'Running' : status === 'error' ? 'Error' : 'Saved task';
}

export class ToolsPage {
  private page = byId('tools-page');
  private title = byId('tools-title');
  private summary = byId('tools-summary');
  private search = byId<HTMLInputElement>('tools-search');
  private chips = byId('tools-chips');
  private body = byId('tools-body');
  private primary = byId<HTMLButtonElement>('tools-primary');
  private secondary = byId<HTMLButtonElement>('tools-secondary');
  private fromFile = byId<HTMLButtonElement>('tools-file');
  private tabs: Record<ToolsMode, HTMLButtonElement> = {
    skills: byId<HTMLButtonElement>('tools-tab-skills'),
    plugins: byId<HTMLButtonElement>('tools-tab-plugins'),
    connectors: byId<HTMLButtonElement>('tools-tab-connectors'),
    atlas: byId<HTMLButtonElement>('tools-tab-atlas'),
    knowledge: byId<HTMLButtonElement>('tools-tab-knowledge'),
  };
  private toolbar = byId('tools-toolbar');
  private atlasPanel = byId('atlas-panel');
  private knowledgePanel = byId('knowledge-panel');
  private mode: ToolsMode = 'skills';
  private open = false;
  private busy = false;
  private query = '';
  private filter = 'All';
  private generation = 0;
  private skills: CatalogSkillEntry[] = [];
  private library: SkillLibraryEntry[] = [];
  private catalog: PluginCatalogEntry[] = [];
  private plugins: PluginView[] = [];
  private connectors: McpServer[] = [];
  private connectorsCatalog: ConnectorCatalogEntry[] = [];
  private connectorStatuses: McpRuntimeStatus[] = [];
  private statusTimer: ReturnType<typeof setInterval> | undefined;
  private sessions: SessionSummary[] = [];
  private workspaces: Workspace[] = [];
  private currentWorkspaceId = '';
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ToolsPageOptions) {
    for (const mode of MODES) {
      this.tabs[mode].addEventListener('click', () => this.selectTab(mode));
    }
    this.search.addEventListener('input', () => {
      // Typing must not rebuild a hundred cards per keystroke.
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        if (!this.open) return;
        this.query = this.search.value;
        this.render();
      }, 120);
    });
    this.primary.addEventListener('click', () => this.openAdd());
    this.secondary.addEventListener('click', () => void this.installRemaining());
    this.fromFile.addEventListener('click', () => void this.installZip());
    byId('tools-refresh').addEventListener('click', () => {
      if (this.mode === 'atlas') this.options.atlasRefresh();
      else if (this.mode === 'knowledge') this.options.knowledgeRefresh();
      else void this.reload();
    });
    byId('tools-close').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean { return this.open; }

  get active(): ToolsMode { return this.mode; }

  show(mode: ToolsMode): void {
    this.mode = mode;
    this.open = true;
    this.query = '';
    this.filter = 'All';
    this.search.value = '';
    this.page.hidden = false;
    byId('app').classList.add('tools-open');
    this.pressed();
    this.paintChrome();
    this.paintPanels();
    this.render();
    this.refreshContent();
    this.syncStatusPolling();
    if (!this.sidePanel) this.search.focus();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.generation++;
    this.page.hidden = true;
    this.atlasPanel.hidden = true;
    this.knowledgePanel.hidden = true;
    this.options.atlasClose();
    this.options.knowledgeClose();
    byId('app').classList.remove('tools-open');
    this.syncStatusPolling();
    this.pressed();
  }

  private get sidePanel(): boolean { return this.mode === 'atlas' || this.mode === 'knowledge'; }

  private selectTab(mode: ToolsMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.filter = 'All';
    this.paintChrome();
    this.paintPanels();
    this.render();
    this.refreshContent();
    this.syncStatusPolling();
    if (!this.sidePanel) this.search.focus();
  }

  private paintPanels(): void {
    const atlas = this.mode === 'atlas';
    const panel = this.sidePanel;
    this.toolbar.hidden = panel;
    this.body.hidden = panel;
    this.atlasPanel.hidden = !atlas;
    this.knowledgePanel.hidden = this.mode !== 'knowledge';
    this.fromFile.hidden = panel || this.mode !== 'plugins';
    byId('tools-refresh').setAttribute('title', atlas ? 'Refresh Atlas' : this.mode === 'knowledge' ? 'Refresh Knowledge' : 'Refresh list');
  }

  private refreshContent(): void {
    if (this.mode === 'atlas') this.options.atlasOpen();
    else if (this.mode === 'knowledge') this.options.knowledgeOpen();
    else void this.reload();
  }

  // Connector health is live while the Connectors tab is on screen: the engine
  // connects local servers seconds after boot, so poll instead of guessing.
  private syncStatusPolling(): void {
    const wanted = this.open && this.mode === 'connectors';
    if (wanted && !this.statusTimer) {
      this.statusTimer = setInterval(() => void this.refreshConnectorStatus(), 4000);
      void this.refreshConnectorStatus();
    }
    if (!wanted && this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = undefined;
    }
  }

  private async refreshConnectorStatus(): Promise<void> {
    const statuses = await window.relay.connectorStatus().catch(() => null);
    if (!statuses || !this.open || this.mode !== 'connectors') return;
    if (JSON.stringify(statuses) === JSON.stringify(this.connectorStatuses)) return;
    this.connectorStatuses = statuses;
    this.render();
  }

  private statusFor(name: string): McpRuntimeStatus | undefined {
    return this.connectorStatuses.find((entry) => entry.name === name);
  }

  async reload(): Promise<void> {
    if (!this.open || this.sidePanel) return;
    const token = ++this.generation;
    try {
      const [skills, library, catalog, plugins, connectors, connectorsCatalog, connectorStatuses, sessions, state] = await Promise.all([
        window.relay.listCatalogSkills(),
        window.relay.listLibrarySkills(),
        window.relay.listPluginCatalog(),
        window.relay.listPlugins(),
        window.relay.listMcp(),
        window.relay.listConnectorCatalog(),
        window.relay.connectorStatus().catch(() => [] as McpRuntimeStatus[]),
        window.relay.listAllSessions().catch(() => [] as SessionSummary[]),
        window.relay.getState(),
      ]);
      if (token !== this.generation || !this.open) return;
      this.skills = skills;
      this.library = library;
      this.catalog = catalog;
      this.plugins = plugins;
      this.connectors = connectors;
      this.connectorsCatalog = connectorsCatalog;
      this.connectorStatuses = connectorStatuses;
      this.sessions = sessions;
      this.workspaces = state.workspaces;
      this.currentWorkspaceId = state.workspace?.id ?? '';
      this.paintChrome();
      this.render();
    } catch (error) {
      if (token !== this.generation || !this.open) return;
      const retry = button('Retry', () => void this.reload());
      this.body.replaceChildren(el('p', 'inline-error', `Could not load the toolkit: ${errorText(error)}`), retry);
    }
  }

  private pressed(): void {
    byId<HTMLButtonElement>('tools-button').setAttribute('aria-pressed', String(this.open));
    for (const mode of MODES) this.tabs[mode].setAttribute('aria-selected', String(this.open && this.mode === mode));
  }

  private paintChrome(): void {
    this.title.textContent = this.mode === 'atlas' ? 'Atlas' : this.mode === 'knowledge' ? 'Knowledge' : 'Toolkit';
    this.search.placeholder = 'Search tasks, projects, skills, plugins, and connectors';
    this.summary.textContent = this.mode === 'atlas'
      ? 'Project knowledge, written by the agent and kept inside this project.'
      : this.mode === 'knowledge'
        ? 'Saved sources, shared by every task in every folder.'
        : this.mode === 'skills'
        ? `${this.skills.length} skills bundled with Relay · ${this.library.length} installed`
        : this.mode === 'plugins'
          ? `${this.catalog.length} plugin packs bundled with Relay · ${this.plugins.length} installed`
          : `${this.connectorsCatalog.length} popular connectors · ${this.connectors.length} configured`;
    this.paintActions();
    this.pressed();
  }

  private paintChips(labels: string[]): void {
    if (this.sidePanel) { this.chips.replaceChildren(); return; }
    this.chips.replaceChildren(...labels.map((label) => {
      const chip = button(label, () => { this.filter = label; this.render(); }, 'extension-chip');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(this.filter === label));
      return chip;
    }));
  }

  private openAdd(): void {
    if (this.mode === 'skills') this.addSkillFromWeb();
    else if (this.mode === 'plugins') this.importPluginFromWeb();
    else if (this.mode === 'connectors') this.editServer();
  }

  private remaining(): number {
    if (this.mode !== 'skills' && this.mode !== 'plugins') return 0;
    const layout = discoveryLayout(this.discoveryItems(), this.filter, this.query);
    return layout.sections.reduce((total, section) => total + section.items.filter((item) => !item.installed).length, 0);
  }

  private paintActions(): void {
    if (this.sidePanel) { this.primary.hidden = true; this.secondary.hidden = true; return; }
    this.primary.hidden = false;
    this.primary.disabled = this.busy;
    this.primary.textContent = this.mode === 'skills' ? 'Add skill' : this.mode === 'plugins' ? 'Add plugin' : 'Add connector';
    const remaining = this.busy ? 0 : this.remaining();
    this.secondary.hidden = this.busy || remaining === 0;
    this.secondary.textContent = remaining ? `Install all ${remaining}` : '';
  }

  private installedSkill(id: string): SkillLibraryEntry | undefined {
    return this.library.find((entry) => entry.id === id);
  }

  private installedPlugin(id: string): PluginView | undefined {
    return this.plugins.find((entry) => entry.id === id);
  }

  private catalogPlugin(id: string): PluginCatalogEntry | undefined {
    return this.catalog.find((entry) => entry.id === id);
  }

  private catalogConnector(name: string): ConnectorCatalogEntry | undefined {
    return this.connectorsCatalog.find((entry) => entry.name === name);
  }

  private discoveryItems(): DiscoveryItem[] {
    if (this.mode === 'skills') {
      const items: DiscoveryItem[] = this.skills.map((entry) => ({
        id: entry.id, name: entry.name, description: entry.description, family: entry.category,
        installed: Boolean(this.installedSkill(entry.id)), bundled: true,
      }));
      const known = new Set(this.skills.map((entry) => entry.id));
      for (const entry of this.library) {
        if (!known.has(entry.id)) {
          items.push({ id: entry.id, name: entry.name, description: entry.description, family: 'Local skills', installed: true, bundled: false });
        }
      }
      return items;
    }
    if (this.mode === 'plugins') {
      const items: DiscoveryItem[] = this.catalog.map((entry) => ({
        id: entry.id, name: entry.name, description: entry.description, family: pluginFamily(entry.name),
        installed: Boolean(this.installedPlugin(entry.id)), bundled: true,
      }));
      const known = new Set(this.catalog.map((entry) => entry.id));
      for (const entry of this.plugins) {
        if (!known.has(entry.id)) {
          items.push({ id: entry.id, name: entry.name, description: entry.description, family: 'Local plugins', installed: true, bundled: false });
        }
      }
      return items;
    }
    const items: DiscoveryItem[] = this.connectorsCatalog.map((entry) => ({
      id: entry.name, name: entry.name, description: entry.description, family: entry.category,
      installed: entry.configured, bundled: true,
      tags: [entry.type === 'local' ? 'Local' : 'Remote', ...(entry.configured ? ['Enabled'] : [])],
    }));
    const known = new Set(this.connectorsCatalog.map((entry) => entry.name));
    for (const server of this.connectors) {
      if (known.has(server.name)) continue;
      items.push({
        id: server.name, name: server.name,
        description: server.type === 'local' ? (server.command ?? []).join(' ') : server.url ?? '',
        family: 'Local servers', installed: true, bundled: false,
        tags: [server.type === 'local' ? 'Local' : 'Remote', ...(server.enabled ? ['Enabled'] : [])],
      });
    }
    return items;
  }

  private connectorExtras(): string[] {
    return this.mode === 'connectors' ? ['Local', 'Remote', 'Enabled'] : [];
  }

  private render(): void {
    if (this.sidePanel) return;
    const items = this.discoveryItems();
    const layout = discoveryLayout(items, this.filter, this.query, this.connectorExtras());
    this.paintChips(layout.chips);

    const hero = el('section', 'discovery-hero');
    const intro = el('div', 'discovery-intro');
    intro.append(el('p', 'discovery-eyebrow', 'Discovery'), el('h2', 'discovery-headline', layout.headline));
    const count = el('span', 'discovery-count', `Installed ${items.filter((item) => item.installed).length}`);
    hero.append(intro, count);

    const view = el('div', 'discovery-view');
    if (!layout.sections.length) {
      view.append(el('p', 'tools-empty', this.emptyMessage()));
    } else {
      for (const section of layout.sections) {
        const group = el('section', 'discovery-group');
        group.append(el('h3', 'discovery-group-title', `${section.title} · ${section.items.length}`));
        const grid = el('div', 'discovery-grid');
        for (const item of section.items) grid.append(this.discoveryCard(item));
        group.append(grid);
        view.append(group);
      }
    }
    this.body.replaceChildren(hero, ...this.searchSections(), view);
    this.paintActions();
  }

  private emptyMessage(): string {
    if (this.query.trim()) return `No ${this.mode} match that search.`;
    if (this.filter === INSTALLED_FILTER) return `Nothing installed yet. Use “${this.primary.textContent}” to add one.`;
    return `No ${this.mode} in this view.`;
  }

  private discoveryCard(item: DiscoveryItem): HTMLElement {
    const card = el('article', 'discovery-card');
    const icon = this.mode === 'skills'
      ? skillIcon(item.family)
      : this.mode === 'plugins'
        ? pluginIcon(item.name)
        : connectorIcon(item.name, this.catalogConnector(item.id)?.type ?? this.connectors.find((server) => server.name === item.id)?.type ?? 'local');
    const tile = el('span', 'discovery-tile');
    tile.append(catalogIconElement(icon));
    const copy = el('div', 'discovery-card-copy');
    const title = el('div', 'discovery-card-title');
    title.append(el('strong', '', item.name));
    if (item.bundled) {
      const verified = el('span', 'discovery-verified', '✓');
      verified.title = 'Bundled with Relay';
      title.append(verified);
    }
    copy.append(title, el('p', 'discovery-card-desc', item.description || 'No description'));
    if (this.mode === 'plugins') {
      const entry = this.catalogPlugin(item.id);
      const capabilities = entry?.capabilities ?? this.installedPlugin(item.id)?.capabilities;
      if (capabilities) copy.append(el('p', 'discovery-meta', capabilitySummary(capabilities)));
    } else if (this.mode === 'connectors') {
      const entry = this.catalogConnector(item.id);
      const server = this.connectors.find((candidate) => candidate.name === item.id);
      const meta = el('p', 'discovery-meta', (entry?.type ?? server?.type) === 'remote' ? 'Remote server' : 'Local server');
      if (server) meta.append(' · ', this.connectorStatusPill(server));
      copy.append(meta);
      const error = server ? this.statusFor(server.name)?.error : undefined;
      if (error) copy.append(el('p', 'connector-error', error));
    }

    const trailing = el('div', 'discovery-trailing');
    if (item.installed) {
      const plugin = this.mode === 'plugins' ? this.installedPlugin(item.id) : undefined;
      const status = el('span', 'discovery-status', this.mode === 'plugins' ? (plugin?.enabled === false ? 'Disabled' : '✓ Enabled') : '✓ Installed');
      status.title = 'Installed';
      trailing.append(status);
      if (plugin) trailing.append(button(plugin.enabled ? 'Disable' : 'Enable', () => void this.togglePlugin(plugin), 'text-button'));
      if (this.mode === 'connectors') {
        const server = this.connectors.find((candidate) => candidate.name === item.id);
        if (server) {
          const status = this.statusFor(server.name);
          if (status?.status === 'failed') {
            const retry = button('Retry', () => void this.retryConnector(server.name), 'text-button');
            retry.setAttribute('aria-label', `Retry connector ${server.name}`);
            trailing.append(retry);
          }
          trailing.append(button(server.enabled ? 'Disable' : 'Enable', () => void this.toggleServer(server, !server.enabled), 'text-button'));
          trailing.append(button('Edit', () => this.editServer(server, true), 'text-button'));
        }
      }
      if (this.filter === INSTALLED_FILTER || !item.bundled) {
        trailing.append(button('Remove', () => void this.removeItem(item), 'text-button danger'));
      }
    } else {
      trailing.append(button(this.mode === 'connectors' ? 'Add' : 'Install', () => void this.installItem(item), 'button discovery-install'));
    }
    card.append(tile, copy, trailing);
    return card;
  }

  private async installItem(item: DiscoveryItem): Promise<void> {
    if (this.busy) return;
    if (this.mode === 'connectors') {
      const entry = this.catalogConnector(item.id);
      if (entry) this.editServer(this.connectorDraft(entry));
      return;
    }
    this.busy = true;
    this.paintActions();
    try {
      if (this.mode === 'skills') {
        this.library = await window.relay.installCatalogSkill(item.id);
      } else {
        const preview = await window.relay.previewCatalogPlugin(item.id);
        if (preview.capabilities.code.length) throw new Error('This package ships executable code, which Relay does not activate.');
        this.plugins = await window.relay.installPlugin(preview.token, false);
      }
      notify(`Installed ${item.name}.`);
    } catch (error) {
      report(`Could not install ${item.name}`, error);
    } finally {
      this.busy = false;
      this.paintChrome();
      this.render();
    }
  }

  private async removeItem(item: DiscoveryItem): Promise<void> {
    if (this.mode === 'skills') {
      const entry = this.library.find((candidate) => candidate.id === item.id);
      if (entry) await this.removeSkill(entry);
    } else if (this.mode === 'plugins') {
      const entry = this.plugins.find((candidate) => candidate.id === item.id);
      if (entry) await this.removePlugin(entry);
    } else {
      const server = this.connectors.find((candidate) => candidate.name === item.id);
      if (server) await this.removeServer(server);
    }
  }

  private connectorDraft(entry: ConnectorCatalogEntry): McpServer {
    return {
      name: entry.name, type: entry.type, enabled: true,
      ...(entry.command ? { command: entry.command } : {}), ...(entry.url ? { url: entry.url } : {}),
    };
  }

  private searchSections(): HTMLElement[] {
    const matches = searchTasksAndProjects(this.sessions, this.workspaces, this.query);
    const sections: HTMLElement[] = [];
    if (matches.tasks.length) {
      const section = el('section', 'tools-section tools-results');
      section.append(el('h3', '', `Tasks · ${matches.tasks.length}`));
      const list = el('div', 'tools-result-list');
      for (const task of matches.tasks) {
        const row = button('', () => { this.close(); this.options.openTask(task.id); }, 'tools-result');
        row.type = 'button';
        const copy = el('span', 'tools-result-copy');
        copy.append(
          el('span', 'tools-result-name truncate', task.title),
          el('span', 'tools-result-meta truncate', [taskState(task.status), task.directory ? folderName(task.directory) : ''].filter(Boolean).join(' · ')),
        );
        row.append(copy);
        list.append(row);
      }
      section.append(list);
      sections.push(section);
    }
    if (matches.projects.length) {
      const section = el('section', 'tools-section tools-results');
      section.append(el('h3', '', `Projects · ${matches.projects.length}`));
      const list = el('div', 'tools-result-list');
      for (const project of matches.projects) {
        const current = project.id === this.currentWorkspaceId;
        const row = button('', () => {
          this.close();
          if (!current) void this.options.openFolder(project.id);
        }, 'tools-result');
        row.type = 'button';
        const copy = el('span', 'tools-result-copy');
        copy.append(el('span', 'tools-result-name truncate', project.name), el('span', 'tools-result-meta truncate', project.path));
        row.append(copy, el('span', 'pill', current ? 'Current' : 'Project'));
        list.append(row);
      }
      section.append(list);
      sections.push(section);
    }
    return sections;
  }

  private async removeSkill(entry: SkillLibraryEntry): Promise<void> {
    if (!await confirmAction('Remove skill?', `“${entry.name}” will no longer be available to the agent in any project. Your project files are not changed.`, 'Remove skill')) return;
    try {
      this.library = await window.relay.removeSkill(entry.id);
      notify(`Removed ${entry.name}.`);
      this.paintChrome();
      this.render();
    } catch (error) { report(`Could not remove ${entry.name}`, error); }
  }

  private async removePlugin(plugin: PluginView): Promise<void> {
    if (!await confirmAction('Remove plugin?', `“${plugin.name}” and its commands will be deleted from Relay. Your project files are not changed.`, 'Remove plugin')) return;
    try {
      this.plugins = await window.relay.removePlugin(plugin.id);
      notify(`Removed ${plugin.name}.`);
      this.paintChrome();
      this.render();
    } catch (error) { report(`Could not remove ${plugin.name}`, error); }
  }

  private async togglePlugin(plugin: PluginView): Promise<void> {
    try {
      this.plugins = await window.relay.setPluginEnabled(plugin.id, !plugin.enabled);
      this.paintChrome();
      this.render();
    } catch (error) { report(`Could not update ${plugin.name}`, error); }
  }

  private async retryConnector(name: string): Promise<void> {
    const statuses = await window.relay.connectConnector(name).catch(() => null);
    if (!statuses) return;
    this.connectorStatuses = statuses;
    if (this.open && this.mode === 'connectors') this.render();
  }

  private async toggleServer(server: McpServer, enabled: boolean): Promise<void> {
    try {
      await window.relay.saveMcp({ ...server, enabled });
      this.connectors = await window.relay.listMcp();
      this.connectorStatuses = await window.relay.connectorStatus().catch(() => this.connectorStatuses);
      this.paintChrome();
      this.render();
    } catch (error) { report(`Could not update ${server.name}`, error); }
  }

  private connectorStatusPill(server: McpServer): HTMLElement {
    const status = this.statusFor(server.name);
    if (!status) return el('span', 'pill', server.enabled ? 'Enabled' : 'Disabled');
    const label = status.status === 'connected' ? 'Connected' : status.status === 'pending' ? 'Connecting…' : status.status === 'disabled' ? 'Off' : 'Failed';
    const pill = el('span', `pill status-${status.status}`, label);
    if (status.error) pill.title = status.error;
    return pill;
  }

  private async removeServer(server: McpServer): Promise<void> {
    if (this.busy) return;
    if (!await confirmAction('Remove connector?', `“${server.name}” will no longer provide tools to the agent. Your project files are not changed.`, 'Remove connector')) return;
    this.busy = true;
    try {
      await window.relay.removeMcp(server.name);
      this.connectors = await window.relay.listMcp();
      notify(`Removed ${server.name}.`);
      this.paintChrome();
      this.render();
    } catch (error) { report(`Could not remove ${server.name}`, error); }
    finally { this.busy = false; }
  }

  private editServer(draft?: McpServer, lockName = false): void {
    if (this.busy) return;
    const editor = dialog(draft && lockName ? `Edit ${draft.name}` : draft ? `Add ${draft.name}` : 'Add connector');
    const form = el('form');
    const name = el('input'); name.required = true; name.value = draft?.name ?? ''; name.readOnly = lockName;
    const type = el('select'); type.append(option('local', 'Local command'), option('remote', 'Remote URL')); type.value = draft?.type ?? 'local';
    const command = el('textarea'); command.value = draft?.command ? JSON.stringify(draft.command) : ''; command.placeholder = '["executable", "argument"]'; command.spellcheck = false;
    const url = el('input'); url.type = 'url'; url.value = draft?.url ?? ''; url.placeholder = 'https://…';
    const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = draft?.enabled ?? true;
    const commandField = field('Command and arguments (JSON array)', command, 'Each argument is a separate string. No shell expansion is applied by this form.');
    const urlField = field('Server URL', url);
    const enabledField = el('label', 'choice'); enabledField.append(enabled, el('span', '', 'Enabled'));
    const update = () => { commandField.hidden = type.value !== 'local'; urlField.hidden = type.value !== 'remote'; command.required = !commandField.hidden; url.required = !urlField.hidden; };
    type.addEventListener('change', update); update();
    const submit = el('button', 'button primary', 'Save and request confirmation'); submit.type = 'submit';
    form.append(field('Server name', name), field('Transport', type), commandField, urlField, enabledField, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      let server: McpServer;
      try {
        server = { name: name.value.trim(), type: type.value as McpServer['type'], enabled: enabled.checked };
        if (!server.name) throw new Error('Enter a server name.');
        if (server.type === 'local') {
          const args: unknown = JSON.parse(command.value);
          if (!Array.isArray(args) || !args.length || args.some((arg) => typeof arg !== 'string') || !args[0].trim()) throw new Error('Command must be a JSON array with an executable and optional string arguments.');
          server.command = args as string[];
        } else {
          const safe = externalURL(url.value.trim());
          if (!safe) throw new Error('Enter an HTTP or HTTPS URL without embedded credentials.');
          server.url = safe;
        }
      } catch (error) { editor.fail(error); return; }
      const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input, select, textarea, button');
      controls.forEach((control) => { control.disabled = true; }); editor.busy(true);
      void window.relay.saveMcp(server).then(async () => {
        editor.root.close();
        this.connectors = await window.relay.listMcp();
        notify(`Saved ${server.name}.`);
        this.paintChrome();
        this.render();
      }).catch(editor.fail).finally(() => {
        controls.forEach((control) => { control.disabled = false; }); editor.busy(false);
      });
    });
    editor.add(form);
    name.focus();
  }

  private async installRemaining(): Promise<void> {
    if (this.busy || (this.mode !== 'skills' && this.mode !== 'plugins')) return;
    const missing = discoveryLayout(this.discoveryItems(), this.filter, this.query)
      .sections.flatMap((section) => section.items)
      .filter((item) => item.bundled && !item.installed);
    if (!missing.length) return;
    this.busy = true;
    this.paintActions();
    const mode = this.mode;
    this.secondary.hidden = false;
    let count = 0;
    try {
      for (const item of missing) {
        this.secondary.textContent = `Installing ${count + 1}/${missing.length}…`;
        if (mode === 'skills') {
          await window.relay.installCatalogSkill(item.id);
        } else {
          const preview = await window.relay.previewCatalogPlugin(item.id);
          if (preview.capabilities.code.length) continue;
          await window.relay.installPlugin(preview.token, false);
        }
        count++;
      }
      if (mode === 'skills') this.library = await window.relay.listLibrarySkills();
      else this.plugins = await window.relay.listPlugins();
      if (count) notify(`Installed ${count} ${mode}.`);
    } catch (error) {
      report(`Could not install every ${mode === 'skills' ? 'skill' : 'plugin'}`, error);
    } finally {
      this.busy = false;
      this.paintChrome();
      this.render();
    }
  }

  private addSkillFromWeb(): void {
    const editor = dialog('Add a skill from the web');
    editor.add(el('p', '', 'Relay downloads a SKILL.md file or a ZIP of skills over HTTPS, shows exactly what it adds, then installs it for every project on this Mac.'));
    const form = el('form');
    const url = el('input'); url.type = 'url'; url.required = true; url.placeholder = 'https://example.com/skills.zip'; url.spellcheck = false;
    const sha256 = el('input'); sha256.placeholder = '64 hex characters'; sha256.spellcheck = false; sha256.autocomplete = 'off';
    const submit = el('button', 'button primary', 'Download and preview'); submit.type = 'submit';
    form.append(
      field('Skill URL', url, 'Link a SKILL.md file or a ZIP that contains skills/<name>/SKILL.md.'),
      field('SHA-256 (optional)', sha256, 'When provided, the download must match exactly.'),
      submit,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      editor.busy(true);
      void window.relay.previewSkillFromURL(url.value.trim(), sha256.value.trim() || undefined).then((preview) => {
        editor.root.close();
        showSkillPreview(preview, async (list) => {
          this.library = list;
          notify('Skill installed.');
          this.paintChrome();
          this.render();
        });
      }).catch(editor.fail).finally(() => { submit.disabled = false; editor.busy(false); });
    });
    editor.add(form);
    url.focus();
  }

  private importPluginFromWeb(): void {
    const editor = dialog('Import plugin from web');
    editor.add(el('p', '', 'Relay downloads the ZIP on this Mac over HTTPS, then shows exactly what it adds before anything is installed. Add the publisher’s SHA-256 hash when one is available.'));
    const form = el('form');
    const url = el('input'); url.type = 'url'; url.required = true; url.placeholder = 'https://example.com/plugin.zip'; url.spellcheck = false;
    const sha256 = el('input'); sha256.placeholder = '64 hex characters'; sha256.spellcheck = false; sha256.autocomplete = 'off';
    const submit = el('button', 'button primary', 'Download and preview'); submit.type = 'submit';
    form.append(
      field('Plugin ZIP URL', url, 'HTTPS only. Credentials in the URL are rejected.'),
      field('SHA-256 (optional)', sha256, 'When provided, the download must match exactly.'),
      submit,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      editor.busy(true);
      void window.relay.importPluginFromURL(url.value.trim(), sha256.value.trim() || undefined).then((preview) => {
        editor.root.close();
        this.confirmPlugin(preview);
      }).catch(editor.fail).finally(() => { submit.disabled = false; editor.busy(false); });
    });
    editor.add(form);
    url.focus();
  }

  private installZip(): Promise<void> {
    return window.relay.previewPlugin()
      .then((preview) => { if (preview) this.confirmPlugin(preview); })
      .catch((error) => report('Could not preview that plugin', error));
  }

  private confirmPlugin(preview: PluginPreview): void {
    const modal = dialog(`Install ${preview.manifest.name}`);
    modal.add(el('p', '', preview.manifest.description || 'No description'),
      el('p', '', `Version ${preview.manifest.version} · ${preview.files.length} files · ${capabilitySummary(preview.capabilities)}`),
      el('p', 'plugin-digest', `SHA-256 ${preview.digest}`));
    if (preview.capabilities.commands.length) modal.add(el('p', '', `Commands: ${preview.capabilities.commands.map((value) => `/${value}`).join(', ')}`));
    if (preview.capabilities.code.length) {
      modal.add(el('p', 'inline-error', `This package includes executable code (${preview.capabilities.code.join(', ')}), which Relay does not activate.`));
      return;
    }
    const actions = el('div', 'dialog-actions');
    actions.append(
      button('Cancel', () => modal.root.close()),
      button('Install plugin', async () => {
        modal.busy(true);
        try {
          this.plugins = await window.relay.installPlugin(preview.token, false);
          modal.root.close();
          notify(`Installed ${preview.manifest.name}.`);
          await this.reload();
        } catch (error) { modal.fail(error); }
        finally { modal.busy(false); }
      }, 'button primary'),
    );
    modal.add(actions);
  }
}
