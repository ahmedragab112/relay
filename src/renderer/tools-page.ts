import type {
  CatalogSkillEntry, McpServer, PluginCapabilities, PluginCatalogEntry, PluginPreview, PluginView, SessionSummary,
  SkillLibraryEntry, Workspace,
} from '../shared/contracts';
import { byId, button, el, errorText, field, notify, option, report } from './dom';
import { confirmAction, dialog } from './dialog';
import { filterConnectors, type ConnectorFilter } from './extension-filter';
import { showSkillPreview } from './skill-install';
import { externalURL } from './state';
import { searchTasksAndProjects } from './toolkit-search';

export type ToolsMode = 'skills' | 'plugins' | 'connectors';

export interface ToolsPageOptions {
  openTask: (id: string) => void;
  openFolder: (id: string) => void | Promise<void>;
}

const MODES: ToolsMode[] = ['skills', 'plugins', 'connectors'];

function capabilitySummary({ commands, skills, agents, mcp, code }: PluginCapabilities): string {
  const parts: string[] = [];
  if (commands.length) parts.push(`${commands.length} command${commands.length === 1 ? '' : 's'}`);
  if (skills.length) parts.push(`${skills.length} skill${skills.length === 1 ? '' : 's'}`);
  if (agents.length) parts.push(`${agents.length} agent${agents.length === 1 ? '' : 's'}`);
  if (mcp.length) parts.push(`${mcp.length} MCP server${mcp.length === 1 ? '' : 's'}`);
  if (code.length) parts.push(`${code.length} code file${code.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'No capabilities';
}

function sourceLabel(source: string): string {
  if (!source) return 'Local';
  if (source === 'Bundled with Relay') return 'Curated';
  try { return new URL(source).host; } catch { return 'From the web'; }
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
  };
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
  private sessions: SessionSummary[] = [];
  private workspaces: Workspace[] = [];
  private currentWorkspaceId = '';

  constructor(private readonly options: ToolsPageOptions) {
    for (const mode of MODES) {
      this.tabs[mode].addEventListener('click', () => this.selectTab(mode));
    }
    this.search.addEventListener('input', () => { this.query = this.search.value; this.render(); });
    this.primary.addEventListener('click', () => void this.installRemaining());
    this.secondary.addEventListener('click', () => {
      if (this.mode === 'skills') this.addSkillFromWeb();
      else if (this.mode === 'plugins') this.importPluginFromWeb();
      else this.editServer();
    });
    this.fromFile.addEventListener('click', () => void this.installZip());
    byId('tools-refresh').addEventListener('click', () => void this.reload());
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
    this.render();
    void this.reload();
    this.search.focus();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.generation++;
    this.page.hidden = true;
    byId('app').classList.remove('tools-open');
    this.pressed();
  }

  private selectTab(mode: ToolsMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.filter = 'All';
    this.paintChrome();
    this.render();
    this.search.focus();
  }

  async reload(): Promise<void> {
    if (!this.open) return;
    const token = ++this.generation;
    try {
      const [skills, library, catalog, plugins, connectors, sessions, state] = await Promise.all([
        window.relay.listCatalogSkills(),
        window.relay.listLibrarySkills(),
        window.relay.listPluginCatalog(),
        window.relay.listPlugins(),
        window.relay.listMcp(),
        window.relay.listAllSessions().catch(() => [] as SessionSummary[]),
        window.relay.getState(),
      ]);
      if (token !== this.generation || !this.open) return;
      this.skills = skills;
      this.library = library;
      this.catalog = catalog;
      this.plugins = plugins;
      this.connectors = connectors;
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
    this.title.textContent = 'Toolkit';
    this.search.placeholder = 'Search tasks, projects, skills, plugins, and connectors';
    this.secondary.textContent = this.mode === 'skills' ? 'Add skill from web…' : this.mode === 'plugins' ? 'Import plugin from web…' : 'Add server';
    this.fromFile.hidden = this.mode !== 'plugins';
    this.summary.textContent = this.mode === 'skills'
      ? `${this.library.length} installed · ${this.skills.length} skill${this.skills.length === 1 ? '' : 's'} bundled with Relay`
      : this.mode === 'plugins'
        ? `${this.plugins.length} installed · ${this.catalog.length} plugin pack${this.catalog.length === 1 ? '' : 's'} bundled with Relay`
        : `${this.connectors.filter((server) => server.enabled).length} enabled · ${this.connectors.length} connector${this.connectors.length === 1 ? '' : 's'} configured`;
    this.paintChips();
    this.paintPrimary();
    this.pressed();
  }

  private paintChips(): void {
    const items = this.mode === 'skills'
      ? ['All', ...new Set(this.skills.map((entry) => entry.category))]
      : this.mode === 'plugins'
        ? ['All', 'Installed', 'Available']
        : ['All', 'Local', 'Remote', 'Enabled'];
    this.chips.replaceChildren(...items.map((label) => {
      const chip = button(label, () => { this.filter = label; this.render(); }, 'extension-chip');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(this.filter === label));
      return chip;
    }));
  }

  private remaining(): number {
    if (this.mode === 'connectors') return 0;
    if (this.mode === 'skills') return this.skills.filter((entry) => this.visibleSkill(entry) && !this.installedSkill(entry.id)).length;
    return this.catalog.filter((entry) => this.visiblePlugin(entry) && !this.installedPlugin(entry.id)).length;
  }

  private paintPrimary(): void {
    const remaining = this.remaining();
    this.primary.hidden = remaining === 0;
    this.primary.disabled = this.busy;
    if (!this.busy && remaining) this.primary.textContent = `Install all ${remaining}`;
  }

  private installedSkill(id: string): SkillLibraryEntry | undefined {
    return this.library.find((entry) => entry.id === id);
  }

  private installedPlugin(id: string): PluginView | undefined {
    return this.plugins.find((entry) => entry.id === id);
  }

  private matches(query: string, ...values: string[]): boolean {
    const needle = query.trim().toLowerCase();
    return !needle || values.join(' ').toLowerCase().includes(needle);
  }

  private visibleSkill(entry: CatalogSkillEntry): boolean {
    if (this.filter !== 'All' && entry.category !== this.filter) return false;
    return this.matches(this.query, entry.name, entry.description, entry.category);
  }

  private visiblePlugin(entry: PluginCatalogEntry): boolean {
    if (this.filter === 'Installed' && !this.installedPlugin(entry.id)) return false;
    if (this.filter === 'Available' && this.installedPlugin(entry.id)) return false;
    return this.matches(this.query, entry.name, entry.description);
  }

  private visibleConnectors(): McpServer[] {
    const filter: ConnectorFilter = this.filter === 'Local' ? 'local' : this.filter === 'Remote' ? 'remote' : this.filter === 'Enabled' ? 'enabled' : 'all';
    return filterConnectors(this.connectors, this.query, filter);
  }

  private render(): void {
    this.body.replaceChildren(...this.searchSections(), ...this.sections());
    this.paintPrimary();
  }

  private sections(): HTMLElement[] {
    if (this.mode === 'skills') return this.skillSections();
    if (this.mode === 'plugins') return this.pluginSections();
    return this.connectorSections();
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

  private skillSections(): HTMLElement[] {
    const installedItems = this.library.filter((entry) => this.matches(this.query, entry.name, entry.description, entry.source));
    const curated = this.skills.filter((entry) => this.visibleSkill(entry));
    const installed = el('section', 'tools-section');
    installed.append(el('h3', '', `Installed · ${this.library.length}`),
      el('p', '', 'These skills are ready for the agent in every project on this Mac.'));
    if (!installedItems.length) {
      installed.append(el('p', 'tools-empty', this.library.length ? 'No installed skills match that search.' : 'No skills installed yet. Install one from the curated catalog below.'));
    } else {
      const list = el('div', 'tools-installed');
      for (const entry of installedItems) list.append(this.installedSkillRow(entry));
      installed.append(list);
    }
    const curatedSection = el('section', 'tools-section');
    curatedSection.append(el('h3', '', `Curated skills · ${curated.length}`),
      el('p', '', 'One hundred working skills bundled with Relay. Installing copies the skill into your local library over no network.'));
    if (!curated.length) {
      curatedSection.append(el('p', 'tools-empty', 'No skills match that search.'));
    } else {
      const grid = el('div', 'tools-grid');
      for (const entry of curated) grid.append(this.skillCard(entry));
      curatedSection.append(grid);
    }
    return [installed, curatedSection];
  }

  private installedSkillRow(entry: SkillLibraryEntry): HTMLElement {
    const row = el('section', 'integration-row');
    const head = el('div', 'row');
    const identity = el('div', 'row row-identity');
    const source = el('span', 'pill', entry.source === 'Bundled with Relay' ? 'Curated' : sourceLabel(entry.source));
    source.title = entry.source || 'Installed locally';
    identity.append(el('strong', '', entry.name), el('span', 'pill', 'Skill'), source);
    const remove = button('Remove', () => void this.removeSkill(entry), 'text-button danger');
    remove.title = `Remove ${entry.name} from this Mac`;
    head.append(identity, remove);
    row.append(head, el('p', '', entry.description || 'No description'), el('p', 'small muted', `${entry.files} file${entry.files === 1 ? '' : 's'} · installed ${new Date(entry.installedAt).toLocaleDateString()}`));
    return row;
  }

  private skillCard(entry: CatalogSkillEntry): HTMLElement {
    const installed = this.installedSkill(entry.id);
    const card = el('article', 'tools-card');
    const head = el('div', 'tools-card-head');
    head.append(el('strong', '', entry.name), el('span', 'pill', entry.category));
    if (installed) head.append(el('span', 'pill', 'Installed'));
    card.append(head, el('p', 'tools-card-copy', entry.description));
    const actions = el('div', 'tools-card-actions');
    if (installed) {
      const remove = button('Remove', () => void this.removeSkill(installed), 'text-button danger');
      actions.append(remove);
    } else {
      const install = button('Install', async () => {
        install.textContent = 'Installing…';
        try {
          this.library = await window.relay.installCatalogSkill(entry.id);
          notify(`Installed ${entry.name}.`);
          this.paintChrome();
          this.render();
        } catch (error) {
          report(`Could not install ${entry.name}`, error);
          install.textContent = 'Install';
        }
      }, 'button primary');
      actions.append(install);
    }
    card.append(actions);
    return card;
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

  private pluginSections(): HTMLElement[] {
    const installedItems = this.plugins.filter((entry) => this.matches(this.query, entry.name, entry.description));
    const curated = this.catalog.filter((entry) => this.visiblePlugin(entry));
    const installed = el('section', 'tools-section');
    installed.append(el('h3', '', `Installed · ${this.plugins.length}`),
      el('p', '', 'Installed plugins add their commands to every task. Enable, disable, or remove them here.'));
    if (!installedItems.length) {
      installed.append(el('p', 'tools-empty', this.plugins.length ? 'No installed plugins match that search.' : 'No plugins installed yet. Install one from the curated catalog below.'));
    } else {
      const list = el('div', 'tools-installed');
      for (const entry of installedItems) list.append(this.installedPluginRow(entry));
      installed.append(list);
    }
    const curatedSection = el('section', 'tools-section');
    curatedSection.append(el('h3', '', `Curated plugins · ${curated.length}`),
      el('p', '', 'One hundred declarative plugin packs bundled with Relay. Each pack adds slash commands and no executable code.'));
    if (!curated.length) {
      curatedSection.append(el('p', 'tools-empty', 'No plugins match that search.'));
    } else {
      const grid = el('div', 'tools-grid');
      for (const entry of curated) grid.append(this.pluginCard(entry));
      curatedSection.append(grid);
    }
    return [installed, curatedSection];
  }

  private installedPluginRow(plugin: PluginView): HTMLElement {
    const row = el('section', 'integration-row');
    const head = el('div', 'row');
    const identity = el('div', 'row row-identity');
    identity.append(el('strong', '', plugin.name), el('span', 'pill', `v${plugin.version}`),
      el('span', 'pill', !plugin.available ? 'Files missing' : plugin.enabled ? 'Enabled' : 'Disabled'));
    const actions = el('div', 'row');
    const toggle = button(plugin.enabled ? 'Disable' : 'Enable', async () => {
      try {
        this.plugins = await window.relay.setPluginEnabled(plugin.id, !plugin.enabled);
        this.paintChrome();
        this.render();
      } catch (error) { report(`Could not update ${plugin.name}`, error); }
    }, 'text-button');
    toggle.disabled = !plugin.available;
    const remove = button('Remove', () => void this.removePlugin(plugin), 'text-button danger');
    actions.append(toggle, remove);
    head.append(identity, actions);
    row.append(head, el('p', '', plugin.description || 'No description'), el('p', 'small muted', capabilitySummary(plugin.capabilities)));
    return row;
  }

  private pluginCard(entry: PluginCatalogEntry): HTMLElement {
    const installed = this.installedPlugin(entry.id);
    const card = el('article', 'tools-card');
    const head = el('div', 'tools-card-head');
    head.append(el('strong', '', entry.name), el('span', 'pill', `v${entry.version}`));
    if (installed) head.append(el('span', 'pill', 'Installed'));
    card.append(head, el('p', 'tools-card-copy', entry.description));
    if (entry.capabilities.commands.length) {
      const detail = el('details', 'tools-commands');
      detail.append(el('summary', '', `${entry.capabilities.commands.length} commands`));
      const list = el('ul');
      for (const name of entry.capabilities.commands) list.append(el('li', '', `/${name}`));
      detail.append(list);
      card.append(detail);
    }
    card.append(el('p', 'small muted', capabilitySummary(entry.capabilities)));
    if (!installed) {
      const install = button('Install', async () => {
        install.textContent = 'Installing…';
        try {
          const preview = await window.relay.previewCatalogPlugin(entry.id);
          if (preview.capabilities.code.length) throw new Error('This package ships executable code, which Relay does not activate.');
          this.plugins = await window.relay.installPlugin(preview.token, false);
          notify(`Installed ${entry.name}.`);
          this.paintChrome();
          this.render();
        } catch (error) {
          report(`Could not install ${entry.name}`, error);
          install.textContent = 'Install';
        }
      }, 'button primary');
      const actions = el('div', 'tools-card-actions');
      actions.append(install);
      card.append(actions);
    }
    return card;
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

  private connectorSections(): HTMLElement[] {
    const items = this.visibleConnectors();
    const section = el('section', 'tools-section');
    section.append(el('h3', '', `Connectors · ${items.length}`),
      el('p', '', 'Connectors are MCP servers that give the agent extra tools. Local servers run commands on this Mac; remote servers use an HTTP URL. Every change is confirmed by the app.'));
    if (!items.length) {
      section.append(el('p', 'tools-empty', this.connectors.length ? 'No connectors match that search.' : 'No connectors configured yet. Add an MCP server to get started.'));
    } else {
      const list = el('div', 'tools-installed');
      for (const server of items) list.append(this.connectorRow(server));
      section.append(list);
    }
    return [section];
  }

  private connectorRow(server: McpServer): HTMLElement {
    const row = el('section', 'integration-row');
    const head = el('div', 'row');
    const identity = el('div', 'row row-identity');
    identity.append(el('strong', '', server.name), el('span', 'pill', server.type === 'local' ? 'Local' : 'Remote'), el('span', 'pill', server.enabled ? 'Enabled' : 'Disabled'));
    const actions = el('div', 'row');
    const toggle = button(server.enabled ? 'Disable' : 'Enable', () => void this.saveServer({ ...server, enabled: !server.enabled }), 'text-button');
    const edit = button('Edit', () => this.editServer(server), 'text-button');
    const remove = button('Remove', () => void this.removeServer(server), 'text-button danger');
    actions.append(toggle, edit, remove);
    head.append(identity, actions);
    row.append(head, el('p', '', server.type === 'local' ? (server.command ?? []).join(' ') : server.url ?? ''));
    return row;
  }

  private async saveServer(server: McpServer): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await window.relay.saveMcp(server);
      this.connectors = await window.relay.listMcp();
      this.paintChrome();
      this.render();
    } catch (error) { report(`Could not update ${server.name}`, error); }
    finally { this.busy = false; }
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

  private editServer(existing?: McpServer): void {
    if (this.busy) return;
    const editor = dialog(existing ? `Edit ${existing.name}` : 'Add connector');
    const form = el('form');
    const name = el('input'); name.required = true; name.value = existing?.name ?? ''; name.readOnly = !!existing;
    const type = el('select'); type.append(option('local', 'Local command'), option('remote', 'Remote URL')); type.value = existing?.type ?? 'local';
    const command = el('textarea'); command.value = existing?.command ? JSON.stringify(existing.command) : ''; command.placeholder = '["executable", "argument"]'; command.spellcheck = false;
    const url = el('input'); url.type = 'url'; url.value = existing?.url ?? ''; url.placeholder = 'https://…';
    const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = existing?.enabled ?? true;
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
    if (this.busy || this.mode === 'connectors') return;
    this.busy = true;
    this.paintPrimary();
    const mode = this.mode;
    let count = 0;
    try {
      if (mode === 'skills') {
        const missing = this.skills.filter((entry) => this.visibleSkill(entry) && !this.installedSkill(entry.id));
        for (const entry of missing) {
          this.primary.textContent = `Installing ${count + 1}/${missing.length}…`;
          await window.relay.installCatalogSkill(entry.id);
          count++;
        }
        this.library = await window.relay.listLibrarySkills();
      } else {
        const missing = this.catalog.filter((entry) => this.visiblePlugin(entry) && !this.installedPlugin(entry.id));
        for (const entry of missing) {
          this.primary.textContent = `Installing ${count + 1}/${missing.length}…`;
          const preview = await window.relay.previewCatalogPlugin(entry.id);
          if (preview.capabilities.code.length) continue;
          await window.relay.installPlugin(preview.token, false);
          count++;
        }
        this.plugins = await window.relay.listPlugins();
      }
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
