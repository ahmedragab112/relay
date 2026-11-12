import type { AccessLevel, AutoSettings, CommandOption, ContextBlock, EngineStatus, ModelOption, Preferences, QueuedMessage, SessionSummary, SkillOption } from '../shared/contracts';
import { byId, button, el, errorText, notify, report } from './dom';
import { dialog } from './dialog';
import { chooseModel } from './state';
import { groupModels, resolveVariant, variantLabel } from './model-menu';
import { Dictation } from './dictation';

interface Draft {
  text: string; files: string[]; access: AccessLevel; variant: string; skills: string[]; command: string;
  planOnly: boolean; agents: string[]; context: ContextBlock[];
}

const accessLevels: AccessLevel[] = ['read', 'ask', 'auto', 'full'];

export class Composer {
  private form = byId<HTMLFormElement>('composer');
  private input = byId<HTMLTextAreaElement>('prompt');
  private modelButton = byId<HTMLButtonElement>('model-button');
  private modelLabel = byId('model-label');
  private modelMenu = byId('model-menu');
  private access = byId<HTMLSelectElement>('access-select');
  private free = byId<HTMLButtonElement>('free-toggle');
  private send = byId<HTMLButtonElement>('send-message');
  private interrupt = byId<HTMLButtonElement>('interrupt');
  private session?: SessionSummary;
  private ready = false;
  private models: ModelOption[] = [];
  private modelId = '';
  private modelMenuOpen = false;
  private sending = new Set<string>();
  private stopping = new Set<string>();
  private drafts = new Map<string, Draft>();
  private files: string[] = [];
  private skills: SkillOption[] = [];
  private selectedSkills: string[] = [];
  private selectedAgents: string[] = [];
  private contextBlocks: ContextBlock[] = [];
  private planOnly = false;
  private commands: CommandOption[] = [];
  private command = '';
  private menu: CommandOption[] = [];
  private menuIndex = 0;
  private menuOpen = false;
  private preferenceSaving = false;
  private preferredVariant = '';
  private freeOnly = false;
  private autoModel = false;
  private autoSettings: AutoSettings = { includeFree: true, maxTokens: 4096, modelIds: [] };
  private inputWhileRunning = false;
  private commandDetail = false;
  private goalDrivenByDefault = false;
  private workspaceGeneration = 0;
  private dictation: Dictation;

  constructor(private changed: () => void, private savePreference: (values: Partial<Pick<Preferences, 'defaultModel' | 'defaultAccess' | 'modelVariant'>>) => Promise<void>, canDictate: () => boolean) {
    this.dictation = new Dictation(this.input, canDictate);
    this.form.addEventListener('submit', event => { event.preventDefault(); void this.submit(); });
    this.input.addEventListener('input', () => { this.sync(); this.refreshMenu(); });
    this.input.addEventListener('keydown', event => {
      if (this.menuOpen) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); this.moveMenu(event.key === 'ArrowDown' ? 1 : -1); return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          const item = this.menu[this.menuIndex];
          if (item) this.chooseCommand(item);
          return;
        }
        if (event.key === 'Escape') { event.preventDefault(); this.closeMenu(); return; }
      }
      if (event.key === 'Escape' && this.command) {
        event.preventDefault(); this.command = ''; this.renderCommands(); this.sync(); return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); this.form.requestSubmit(); }
    });
    this.interrupt.addEventListener('click', () => void this.abort());
    this.modelButton.addEventListener('click', () => { if (this.modelMenuOpen) this.closeModelMenu(); else this.openModelMenu(); });
    this.modelButton.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.openModelMenu(); }
      if (event.key === 'Escape' && this.modelMenuOpen) { event.preventDefault(); this.closeModelMenu(); }
    });
    this.modelMenu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.closeModelMenu(); this.modelButton.focus(); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const options = [...this.modelMenu.querySelectorAll<HTMLElement>('.model-option')];
      if (!options.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const index = options.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? (step === 1 ? options[0] : options[options.length - 1]) : options[(index + step + options.length) % options.length];
      next.focus();
    });
    this.access.addEventListener('change', () => {
      this.access.dataset.access = this.access.value;
      const value = this.access.value as AccessLevel;
      this.persistPreference({ defaultAccess: value }, 'Access level was not saved. Choose it again to retry');
      const session = this.session;
      if (!session) return;
      void window.relay.setSessionAccess(session.id, value)
        .catch(error => report('Access level did not reach the running task', error));
    });
    this.free.addEventListener('click', () => {
      this.freeOnly = !this.freeOnly;
      this.renderModels(this.modelId);
      this.sync();
    });
  }

  private persistPreference(values: Partial<Pick<Preferences, 'defaultModel' | 'defaultAccess' | 'modelVariant'>>, message: string): void {
    this.preferenceSaving = true;
    this.sync();
    void this.savePreference(values).catch(error => report(message, error)).finally(() => { this.preferenceSaving = false; this.sync(); });
  }

  private openModelMenu(): void {
    if (this.modelMenuOpen || this.modelButton.disabled) return;
    this.modelMenuOpen = true;
    this.modelButton.setAttribute('aria-expanded', 'true');
    this.renderModelMenu();
    this.modelMenu.hidden = false;
    document.addEventListener('pointerdown', this.dismissModelMenu, true);
    this.modelMenu.querySelector<HTMLElement>('.model-option.selected')?.focus();
  }

  private closeModelMenu(): void {
    if (!this.modelMenuOpen) return;
    this.modelMenuOpen = false;
    this.modelButton.setAttribute('aria-expanded', 'false');
    this.modelMenu.hidden = true;
    document.removeEventListener('pointerdown', this.dismissModelMenu, true);
  }

  private dismissModelMenu = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target && (this.modelMenu.contains(target) || this.modelButton.contains(target))) return;
    this.closeModelMenu();
  };

  private pickModel(id: string): void {
    const model = this.models.find(item => item.id === id);
    if (!model || !model.connected) return;
    this.autoModel = false;
    const changed = this.modelId !== id;
    this.modelId = id;
    if (changed) this.preferredVariant = resolveVariant(model.variants, this.preferredVariant);
    this.renderModelLabel();
    if (this.modelMenuOpen) {
      this.renderModelMenu();
      this.modelMenu.querySelector<HTMLElement>('.model-option.selected')?.focus();
    }
    this.sync();
    if (changed) this.persistPreference({ defaultModel: id }, 'Model preference was not saved. Choose the model again to retry');
    if (!model.variants?.length || !changed) this.closeModelMenu();
  }

  private pickAuto(): void {
    this.autoModel = true;
    this.modelId = '';
    this.renderModelLabel();
    if (this.modelMenuOpen) {
      this.renderModelMenu();
      this.modelMenu.querySelector<HTMLElement>('.model-option.selected')?.focus();
    }
    this.sync();
    this.closeModelMenu();
    this.modelButton.focus();
  }

  private pickPower(id: string, variant: string): void {
    const model = this.models.find(item => item.id === id);
    if (!model) return;
    const modelChanged = this.modelId !== id;
    this.modelId = id;
    this.preferredVariant = resolveVariant(model.variants, variant);
    this.renderModelLabel();
    this.closeModelMenu();
    this.sync();
    this.modelButton.focus();
    const values: Partial<Pick<Preferences, 'defaultModel' | 'modelVariant'>> = { modelVariant: this.preferredVariant };
    if (modelChanged) values.defaultModel = id;
    this.persistPreference(values, 'Model power was not saved. Choose it again to retry');
  }

  setPreferences(preferences: Preferences): void {
    this.access.value = accessLevels.includes(preferences.defaultAccess) ? preferences.defaultAccess : 'ask';
    this.access.dataset.access = this.access.value;
    this.preferredVariant = preferences.modelVariant;
    this.inputWhileRunning = preferences.general.inputWhileRunning;
    this.commandDetail = preferences.general.slashCommandDisplay;
    this.goalDrivenByDefault = preferences.general.goalDriven;
    this.autoSettings = preferences.auto;
    this.renderModelLabel(); this.renderCommands();
    this.sync();
  }

  suggest(text: string): void {
    if (!this.session) return;
    this.input.value = text;
    this.sync();
    this.input.focus();
  }

  async sendText(text: string): Promise<boolean> {
    if (!this.session || !this.ready) return false;
    this.input.value = text.trim();
    this.sync();
    if (!this.input.value || this.send.disabled) {
      notify('Wait for this task to finish before sending another message.', true);
      this.sync();
      return false;
    }
    await this.submit();
    return true;
  }

  suggestSkills(limit = 3): void {
    const host = byId('skill-suggestions');
    const unused = this.skills.filter(skill => !this.selectedSkills.includes(skill.id)).slice(0, limit);
    if (!this.session || !unused.length) { host.replaceChildren(); return; }
    host.replaceChildren(el('span', '', 'Skills you have not used yet:'), ...unused.map(skill => {
      const chip = button(`✦ ${skill.name}`, () => {
        if (!this.selectedSkills.includes(skill.id)) this.selectedSkills.push(skill.id);
        this.renderSkills(); this.clearSkillSuggestions(); this.input.focus();
      });
      chip.title = skill.description || `Add ${skill.name} to the next message`;
      return chip;
    }));
  }

  private clearSkillSuggestions(): void { byId('skill-suggestions').replaceChildren(); }

  reset(): void {
    this.workspaceGeneration++;
    this.dictation.cancel();
    this.drafts.clear(); this.sending.clear(); this.stopping.clear(); this.session = undefined;
    this.input.value = ''; this.files = []; this.skills = []; this.selectedSkills = [];
    this.selectedAgents = []; this.contextBlocks = []; this.planOnly = false;
    this.commands = []; this.command = ''; this.closeMenu(); this.clearSkillSuggestions();
    this.renderFiles(); this.renderSkills(); this.renderCommands(); this.renderTags(); this.sync();
  }

  select(session?: SessionSummary): void {
    if (this.session?.id === session?.id) { this.session = session; this.sync(); return; }
    if (this.session) this.drafts.set(this.session.id, {
      text: this.input.value, files: [...this.files], access: this.access.value as AccessLevel, variant: this.preferredVariant,
      skills: [...this.selectedSkills], command: this.command, planOnly: this.planOnly,
      agents: [...this.selectedAgents], context: [...this.contextBlocks],
    });
    this.session = session;
    const draft = session ? this.drafts.get(session.id) : undefined;
    this.input.value = draft?.text ?? '';
    this.files = [...(draft?.files ?? [])];
    this.selectedSkills = [...(draft?.skills ?? [])];
    this.selectedAgents = [...(draft?.agents ?? [])];
    this.contextBlocks = [...(draft?.context ?? [])];
    this.planOnly = draft?.planOnly ?? false;
    this.command = draft?.command ?? '';
    this.access.value = draft?.access ?? this.access.value;
    this.access.dataset.access = this.access.value;
    this.preferredVariant = draft?.variant ?? this.preferredVariant;
    this.closeMenu(); this.clearSkillSuggestions();
    this.renderFiles(); this.renderSkills(); this.renderCommands(); this.renderTags(); this.renderModelLabel(); this.sync();
  }

  setEngine(engine: EngineStatus): void { this.ready = engine.state === 'ready'; this.sync(); }
  setModels(models: ModelOption[], preferred: string): void {
    this.models = models;
    if (!models.some(model => model.free)) this.freeOnly = false;
    this.free.hidden = !models.some(model => model.free);
    this.renderModels(preferred);
  }

  private renderModels(preferred: string): void {
    const hasFree = this.models.some(model => model.free);
    const visible = this.freeOnly && hasFree ? this.models.filter(model => model.free) : this.models;
    this.modelId = chooseModel(visible, preferred || this.modelId);
    this.free.setAttribute('aria-pressed', String(this.freeOnly));
    this.free.textContent = this.freeOnly ? 'Free only' : 'All models';
    this.renderModelLabel();
    if (this.modelMenuOpen) this.renderModelMenu();
    this.sync();
  }

  private resolvedVariant(): string {
    return resolveVariant(this.models.find(model => model.id === this.modelId)?.variants, this.preferredVariant);
  }

  private renderModelLabel(): void {
    if (this.autoModel) { this.modelLabel.textContent = 'Auto (best available)'; return; }
    const selected = this.models.find(model => model.id === this.modelId);
    if (!selected) {
      this.modelLabel.textContent = this.freeOnly ? 'No free models' : 'Configure model';
      return;
    }
    const variant = this.resolvedVariant();
    this.modelLabel.textContent = variant ? `${selected.name} · ${variantLabel(variant)}` : selected.name;
  }

  private renderModelMenu(): void {
    const groups = groupModels(this.models, this.freeOnly);
    if (!groups.length) {
      this.modelMenu.replaceChildren(el('p', 'model-empty', this.freeOnly
        ? 'No free models are connected. Turn off Free only to see every model.'
        : 'No models are connected yet. Add a provider in Settings.'));
      return;
    }
    const rows: HTMLElement[] = [];
    // Auto entry at the top: Relay picks the best available model and rotates away from limits.
    const autoEntry = el('div', `model-entry${this.autoModel ? ' selected' : ''}`);
    const autoRow = button('', () => this.pickAuto(), `model-option${this.autoModel ? ' selected' : ''}`);
    autoRow.type = 'button';
    autoRow.setAttribute('role', 'option');
    autoRow.setAttribute('aria-selected', String(this.autoModel));
    autoRow.append(el('span', 'truncate', 'Auto (best available)'));
    autoRow.append(el('span', 'pill', 'Lowest cost'));
    autoEntry.append(autoRow);
    rows.push(autoEntry);
    for (const group of groups) {
      rows.push(el('p', 'model-group-label', group.label));
      for (const model of group.models) rows.push(this.modelEntry(model));
    }
    this.modelMenu.replaceChildren(...rows);
  }

  private modelEntry(model: ModelOption): HTMLElement {
    const selected = model.id === this.modelId;
    const entry = el('div', `model-entry${selected ? ' selected' : ''}`);
    const row = button('', () => this.pickModel(model.id), `model-option${selected ? ' selected' : ''}`);
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(selected));
    row.disabled = !model.connected;
    row.append(el('span', 'truncate', model.name));
    if (model.free) row.append(el('span', 'pill', 'Free'));
    if (model.context) row.append(el('span', 'pill', `${Math.round(model.context / 1000)}k`));
    if (model.limited) row.append(el('span', 'pill limit-pill', 'Limit reached'));
    entry.append(row);
    const active = this.resolvedVariant();
    if (model.variants?.length) {
      const power = el('div', 'model-power');
      power.setAttribute('role', 'group');
      power.setAttribute('aria-label', `Power for ${model.name}`);
      power.append(el('span', 'model-power-label', 'Power'));
      for (const variant of ['', ...model.variants]) {
        const chip = button(variant ? variantLabel(variant) : 'Default', () => this.pickPower(model.id, variant), 'model-power-option');
        chip.type = 'button';
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', String(selected && active === variant));
        power.append(chip);
      }
      entry.append(power);
    }
    return entry;
  }

  setSkills(skills: SkillOption[]): void {
    this.skills = skills;
    this.selectedSkills = this.selectedSkills.filter(id => skills.some(skill => skill.id === id));
    this.renderSkills(); this.clearSkillSuggestions();
  }

  setCommands(commands: CommandOption[]): void {
    this.commands = [...new Map(commands.filter(command => command.name).map(command => [command.name, command])).values()];
    if (this.command && !this.commands.some(command => command.name === this.command)) {
      this.command = ''; this.renderCommands();
    }
    this.refreshMenu();
    this.sync();
  }

  pickCommands(): void {
    const modal = dialog('Commands');
    modal.add(el('p', '', 'Commands are prompts and workflows provided by Relay, your workspace, or installed plugins. Type / in the composer to run one.'));
    if (!this.commands.length) { modal.add(el('p', '', 'No commands are available yet. Install a plugin or add a command file to this workspace.')); return; }
    const list = el('div');
    for (const command of this.commands) {
      const row = el('section', 'integration-row');
      row.append(el('strong', '', `/${command.name}`), el('p', '', command.description || 'No description'));
      list.append(row);
    }
    modal.add(list);
  }

  pickSkills(): void {
    if (!this.session) return;
    const modal = dialog('Skills');
    modal.add(el('p', '', 'Skills add focused instructions from this workspace to your next message.'));
    const body = el('div');
    body.append(el('p', 'small muted', 'Loading skills…'));
    modal.add(body);
    const render = (skills: SkillOption[]) => {
      if (!skills.length) { body.replaceChildren(el('p', '', 'No skills are available in this workspace.')); return; }
      const chosen = new Set(this.selectedSkills);
      const list = el('div');
      for (const skill of skills) {
        const choice = el('label', 'choice');
        const input = el('input');
        input.type = 'checkbox'; input.checked = chosen.has(skill.id);
        input.addEventListener('change', () => { if (input.checked) chosen.add(skill.id); else chosen.delete(skill.id); });
        const copy = el('span');
        copy.append(el('strong', '', skill.name), el('p', '', skill.description || 'No description'));
        choice.append(input, copy);
        list.append(choice);
      }
      const actions = el('div', 'dialog-actions');
      actions.append(button('Cancel', () => modal.root.close()), button('Add to message', () => {
        this.selectedSkills = [...chosen];
        this.renderSkills(); modal.root.close(); this.input.focus();
      }, 'button primary'));
      body.replaceChildren(list, actions);
    };
    void window.relay.listSkills().then(skills => { this.setSkills(skills); render(skills); })
      .catch(error => body.replaceChildren(el('p', 'inline-error', errorText(error))));
  }

  togglePlanOnly(): void {
    if (!this.session) return;
    this.planOnly = !this.planOnly;
    this.renderTags(); this.sync(); this.input.focus();
  }

  pickAgents(): void {
    if (!this.session) return;
    const modal = dialog('Tools & agents');
    modal.add(el('p', '', 'Route this message to a specific agent from this workspace. Leave everything unchecked to use the default agent.'));
    const body = el('div');
    body.append(el('p', 'small muted', 'Loading agents…'));
    modal.add(body);
    void window.relay.listAgents().then(agents => {
      const chosen = new Set(this.selectedAgents);
      const list = el('div');
      for (const agent of agents) {
        const choice = el('label', 'choice');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = chosen.has(agent.name);
        input.addEventListener('change', () => { if (input.checked) chosen.add(agent.name); else chosen.delete(agent.name); });
        const copy = el('span');
        copy.append(el('strong', '', agent.name), el('small', '', agent.description || (agent.primary ? 'Primary agent' : 'Subagent')));
        choice.append(input, copy);
        list.append(choice);
      }
      if (!agents.length) list.append(el('p', '', 'No agents are available in this workspace.'));
      const actions = el('div', 'dialog-actions');
      actions.append(
        button('Cancel', () => modal.root.close()),
        button('Use agents', () => { this.selectedAgents = [...chosen]; this.renderTags(); modal.root.close(); this.input.focus(); }, 'button primary'),
      );
      body.replaceChildren(list, actions);
    }).catch(error => body.replaceChildren(el('p', 'inline-error', errorText(error))));
  }

  pickContext(): void {
    if (!this.session) return;
    const modal = dialog('Add task context');
    modal.add(el('p', '', 'Attach a compact digest of another task, or of this task so far, to your next message. Relay reads it locally and sends a trimmed summary.'));
    const body = el('div');
    body.append(el('p', 'small muted', 'Loading tasks…'));
    const status = el('p', 'inline-error');
    modal.add(body, status);
    const attach = async (id: string, label: string) => {
      if (this.contextBlocks.length >= 4) { status.textContent = 'Remove a context tag before adding another.'; return; }
      status.textContent = '';
      modal.busy(true);
      try {
        const digest = await window.relay.getSessionDigest(id);
        if (!digest.trim()) { status.textContent = 'That task has no conversation text to summarize yet.'; return; }
        this.contextBlocks.push({ label, text: digest });
        this.renderTags(); modal.root.close(); this.input.focus();
      } catch (error) { status.textContent = errorText(error); }
      finally { modal.busy(false); }
    };
    void window.relay.listSessions().then(sessions => {
      const list = el('div');
      const current = this.session;
      if (current) {
        const row = el('button', 'palette-option');
        row.type = 'button';
        const copy = el('span', 'search-copy');
        copy.append(el('span', '', 'This task so far'), el('span', 'search-path', current.title));
        row.append(copy);
        row.addEventListener('click', () => void attach(current.id, `Task: ${current.title} (so far)`));
        list.append(row);
      }
      const others = sessions.filter(session => session.id !== this.session?.id);
      if (others.length) list.append(el('div', 'section-label', 'Other tasks'));
      for (const session of others.slice(0, 12)) {
        const row = el('button', 'palette-option');
        row.type = 'button';
        const copy = el('span', 'search-copy');
        copy.append(el('span', '', session.title), el('span', 'search-path', session.status === 'running' ? 'Running now' : 'Saved task'));
        row.append(copy);
        row.addEventListener('click', () => void attach(session.id, `Task: ${session.title}`));
        list.append(row);
      }
      if (!sessions.length) list.append(el('p', '', 'There are no other tasks in this project yet.'));
      body.replaceChildren(list);
    }).catch(error => body.replaceChildren(el('p', 'inline-error', errorText(error))));
  }

  attach(path: string): void {
    if (!this.session) return;
    if (!this.files.includes(path)) this.files.push(path);
    this.renderFiles(); this.input.focus();
  }

  addContext(label: string, text: string): boolean {
    if (!this.session || !text.trim()) return false;
    if (this.contextBlocks.length >= 4) return false;
    this.contextBlocks.push({ label, text });
    this.renderTags(); this.sync(); this.input.focus();
    return true;
  }

  attachSkill(id: string): boolean {
    if (!this.session || this.selectedSkills.includes(id)) return false;
    if (!this.skills.some(skill => skill.id === id)) return false;
    this.selectedSkills.push(id);
    this.renderSkills(); this.sync(); this.input.focus();
    return true;
  }

  selectedSkillIds(): string[] { return [...this.selectedSkills]; }

  restoreQueued(message: QueuedMessage): void {
    if (!this.session) return;
    this.input.value = [message.text, this.input.value].filter(Boolean).join('\n\n');
    this.files = [...new Set([...message.files, ...this.files])];
    const known = new Set(this.skills.map(skill => skill.id));
    this.selectedSkills = [...new Set([...message.skills.filter(id => known.has(id)), ...this.selectedSkills])];
    this.selectedAgents = [...new Set([...message.agents, ...this.selectedAgents])];
    this.contextBlocks = [...message.context, ...this.contextBlocks].slice(0, 4);
    this.planOnly = this.planOnly || message.planOnly;
    if (message.model && this.models.some(model => model.id === message.model)) this.modelId = message.model;
    if (message.variant) this.preferredVariant = message.variant;
    if (accessLevels.includes(message.access)) { this.access.value = message.access; this.access.dataset.access = message.access; }
    this.renderModelLabel(); this.renderFiles(); this.renderSkills(); this.renderTags(); this.sync();
    this.input.focus();
  }

  focus(): void { this.input.focus(); }

  private renderFiles(): void {
    byId('attachments').replaceChildren(...this.files.map(path => {
      const remove = button(`${path} ×`, () => { this.files = this.files.filter(file => file !== path); this.renderFiles(); }, 'attachment');
      remove.setAttribute('aria-label', `Remove attachment ${path}`);
      return remove;
    }));
  }

  private renderSkills(): void {
    byId('skill-chips').replaceChildren(...this.selectedSkills.map(id => {
      const name = this.skills.find(skill => skill.id === id)?.name ?? id;
      const remove = button(`✦ ${name} ×`, () => { this.selectedSkills = this.selectedSkills.filter(item => item !== id); this.renderSkills(); }, 'attachment');
      remove.setAttribute('aria-label', `Remove skill ${name}`);
      return remove;
    }));
  }

  private renderTags(): void {
    const mode = byId('mode-chips');
    if (this.planOnly) {
      const chip = button('◇ Plan only ×', () => { this.planOnly = false; this.renderTags(); this.sync(); }, 'attachment mode-chip');
      chip.setAttribute('aria-label', 'Remove plan-only mode');
      chip.title = 'The agent will not modify files; it returns a plan instead.';
      mode.replaceChildren(chip);
    } else mode.replaceChildren();

    byId('agent-chips').replaceChildren(...this.selectedAgents.map(name => {
      const chip = button(`⛭ ${name} ×`, () => {
        this.selectedAgents = this.selectedAgents.filter(agent => agent !== name);
        this.renderTags();
      }, 'attachment');
      chip.setAttribute('aria-label', `Remove agent ${name}`);
      return chip;
    }));

    byId('context-chips').replaceChildren(...this.contextBlocks.map((block, index) => {
      const chip = button(`↩ ${block.label} ×`, () => {
        this.contextBlocks = this.contextBlocks.filter((_, position) => position !== index);
        this.renderTags();
      }, 'attachment');
      chip.setAttribute('aria-label', `Remove context ${block.label}`);
      chip.title = `${Math.ceil(block.text.length / 1000)}k characters from ${block.label}`;
      return chip;
    }));
  }

  private renderCommands(): void {
    const host = byId('command-chips');
    if (!this.command) { host.replaceChildren(); return; }
    const command = this.commands.find(item => item.name === this.command);
    const detail = this.commandDetail && command?.description ? ` · ${command.description}` : '';
    const remove = button(`⚡ /${this.command}${detail} ×`, () => {
      this.command = ''; this.renderCommands(); this.sync(); this.input.focus();
    }, 'attachment command-chip');
    remove.setAttribute('aria-label', `Remove command ${this.command}`);
    if (command?.description) remove.title = command.description;
    host.replaceChildren(remove);
  }

  private moveMenu(delta: number): void {
    if (!this.menu.length) return;
    this.menuIndex = (this.menuIndex + delta + this.menu.length) % this.menu.length;
    this.renderMenu();
  }

  private refreshMenu(): void {
    const match = /^\/([a-z0-9][a-z0-9_-]*)?$/i.exec(this.input.value);
    if (!match || !this.commands.length) { this.closeMenu(); return; }
    const query = (match[1] ?? '').toLowerCase();
    const matches = this.commands.filter(command => command.name.toLowerCase().includes(query)).slice(0, 8);
    if (!matches.length) { this.closeMenu(); return; }
    this.menu = matches;
    this.menuIndex = Math.min(this.menuIndex, matches.length - 1);
    this.menuOpen = true;
    this.renderMenu();
  }

  private renderMenu(): void {
    const host = byId('command-menu');
    host.replaceChildren(...this.menu.map((command, index) => {
      const item = button('', () => this.chooseCommand(command), `command-option${index === this.menuIndex ? ' active' : ''}`);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === this.menuIndex));
      item.append(el('span', 'command-name', `/${command.name}`), el('span', 'command-description', command.description || 'Command'));
      item.addEventListener('mousedown', event => event.preventDefault());
      return item;
    }));
    host.hidden = false;
    host.children[this.menuIndex]?.scrollIntoView({ block: 'nearest' });
  }

  private closeMenu(): void {
    this.menuOpen = false; this.menu = []; this.menuIndex = 0;
    byId('command-menu').hidden = true;
  }

  private chooseCommand(command: CommandOption): void {
    this.command = command.name;
    this.input.value = '';
    this.closeMenu();
    this.renderCommands(); this.sync();
    this.input.focus();
  }

  private sync(): void {
    const id = this.session?.id ?? '';
    const ready = Boolean(this.session) && this.ready;
    const running = this.session?.status === 'running' || this.sending.has(id);
    const blocked = running && (!this.inputWhileRunning || Boolean(this.command));
    this.input.disabled = !ready;
    this.modelButton.disabled = this.preferenceSaving || !this.models.some(model => model.connected);
    if (this.modelButton.disabled) this.closeModelMenu();
    this.access.disabled = this.preferenceSaving;
    this.free.disabled = !this.models.some(model => model.free);
    this.send.disabled = !ready || (!this.autoModel && !this.modelId) || (!this.input.value.trim() && !this.command) || blocked;
    this.interrupt.hidden = !running;
    this.interrupt.disabled = this.stopping.has(id) || !this.ready;
    this.send.hidden = running && !this.inputWhileRunning;
    byId<HTMLButtonElement>('attach-file').disabled = !this.session;
    this.dictation.setEnabled(ready);
  }

  private async submit(): Promise<void> {
    if (this.send.disabled || !this.session) return;
    const id = this.session.id;
    const generation = this.workspaceGeneration;
    const wasRunning = this.session.status === 'running' || this.sending.has(id);
    const text = this.input.value.trim();
    const files = [...this.files];
    const skills = [...this.selectedSkills];
    const access = this.access.value as AccessLevel;
    const variant = this.resolvedVariant();
    const model = this.modelId;
    const command = this.command;
    const planOnly = this.planOnly;
    const agents = [...this.selectedAgents];
    const context = [...this.contextBlocks];
    this.sending.add(id);
    this.input.value = ''; this.files = []; this.selectedSkills = []; this.selectedAgents = [];
    this.contextBlocks = []; this.planOnly = false; this.command = '';
    this.closeMenu(); this.clearSkillSuggestions();
    this.renderFiles(); this.renderSkills(); this.renderCommands(); this.renderTags(); this.sync();
    try {
      if (command) await window.relay.runCommand({ sessionId: id, name: command, text, model: this.autoModel ? '' : model, variant, access, files, skills });
      else await window.relay.sendMessage({
        sessionId: id, text, files, variant, access, model: this.autoModel ? '' : model, skills,
        auto: this.autoModel,
        autoSettings: this.autoModel ? this.autoSettings : undefined,
        goalDriven: this.goalDrivenByDefault,
        ...(planOnly ? { planOnly } : {}),
        ...(agents.length ? { agents } : {}),
        ...(context.length ? { context } : {}),
        ...(wasRunning && this.inputWhileRunning ? { delivery: 'queue' as const } : {}),
      });
    } catch (error) {
      if (generation === this.workspaceGeneration) {
        if (this.session?.id === id) {
          this.input.value = [text, this.input.value].filter(Boolean).join('\n\n');
          this.files = [...new Set([...files, ...this.files])]; this.renderFiles();
          this.selectedSkills = [...new Set([...skills, ...this.selectedSkills])]; this.renderSkills();
          this.selectedAgents = [...new Set([...agents, ...this.selectedAgents])];
          this.contextBlocks = [...context, ...this.contextBlocks]; this.planOnly = planOnly;
          this.command = this.command || command; this.renderCommands(); this.renderTags();
        } else {
          const draft = this.drafts.get(id);
          this.drafts.set(id, {
            text: [text, draft?.text].filter(Boolean).join('\n\n'),
            files: [...new Set([...files, ...(draft?.files ?? [])])],
            access, variant, skills: [...new Set([...skills, ...(draft?.skills ?? [])])],
            command: draft?.command || command, planOnly: planOnly || (draft?.planOnly ?? false),
            agents: [...new Set([...agents, ...(draft?.agents ?? [])])],
            context: [...context, ...(draft?.context ?? [])],
          });
        }
        report('Message was not sent. Your draft is preserved; check provider settings and retry', error);
      }
    } finally {
      this.sending.delete(id);
      if (generation === this.workspaceGeneration) { this.sync(); this.changed(); }
    }
  }

  private async abort(): Promise<void> {
    const id = this.session?.id;
    if (!id || this.stopping.has(id)) return;
    this.stopping.add(id); this.sync();
    try { await window.relay.abortSession(id); this.changed(); }
    catch (error) { report('Could not stop the agent. Try Stop again', error); }
    finally { this.stopping.delete(id); this.sync(); }
  }
}
