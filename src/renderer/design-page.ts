import { byId, button, el, field, notify, report, run } from './dom';
import { confirmAction, dialog } from './dialog';
import type { ChatMessage, ModelOption } from '../shared/contracts';
import type { DesignColors, DesignEntry, DesignSystem, DesignVersion, DesignView } from '../shared/design';
import { designSlug, previewScroll, sameDesignURL } from '../shared/design';
import { chosenModelLabel, groupModels } from './model-menu';
import { previewKey } from './state';

type Viewport = 'desktop' | 'tablet' | 'phone';
type Mode = 'home' | 'workspace';
type Sort = 'recent' | 'name';

const VIEWPORTS: Viewport[] = ['desktop', 'tablet', 'phone'];

interface DesignPageOptions {
  openTask: (sessionId: string) => void;
  /** A design and its task were removed; task lists need a refresh. */
  deleted: () => void;
}

const stamp = (ms: number): string => ms
  ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'Saved earlier';

function textOf(message: ChatMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; id: string; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export class DesignPage {
  private page = byId('design');
  private control = byId<HTMLButtonElement>('design-button');
  private title = byId('design-title');
  private summary = byId('design-summary');
  private home = byId('design-home');
  private workspacePage = byId('design-workspace');
  private backButton = byId<HTMLButtonElement>('design-back');
  private systemButton = byId<HTMLButtonElement>('design-system');
  private modelButton = byId<HTMLButtonElement>('design-model');
  private modelMenu = byId('design-model-menu');
  private grid = byId('design-items');
  private sortButton = byId<HTMLButtonElement>('design-sort');
  private frame = byId('design-preview-frame');
  private preview = byId<HTMLIFrameElement>('design-preview');
  private stageEmpty = byId('design-stage-empty');
  private turns = byId('design-turns');
  private prompt = byId<HTMLTextAreaElement>('design-prompt');
  private form = byId<HTMLFormElement>('design-prompt-form');
  private sendButton = byId<HTMLButtonElement>('design-send');
  private cancelButton = byId<HTMLButtonElement>('design-cancel');
  private versionsSelect = byId<HTMLSelectElement>('design-versions');
  private restoreButton = byId<HTMLButtonElement>('design-restore');
  private implementButton = byId<HTMLButtonElement>('design-implement');
  private lazy: IntersectionObserver;
  private view?: DesignView;
  private mode: Mode = 'home';
  private slug?: string;
  private workspaceId?: string;
  private sessionId?: string;
  private versions: DesignVersion[] = [];
  private sort: Sort = 'recent';
  private gridSignature = '';
  private opened = false;
  private enabled = false;
  private busy = false;
  private viewport: Viewport = 'desktop';
  private generation = 0;
  private previewStamp = 0;
  private turnRequest = 0;
  private lastPreviewKey = '';
  private previewPos = new Map<string, { href: string; scrollY: number }>();
  private pendingScroll: number | null = null;
  private models: ModelOption[] = [];
  private modelMenuOpen = false;

  constructor(private readonly options: DesignPageOptions) {
    this.form.addEventListener('submit', (event) => { event.preventDefault(); void this.send(); });
    this.prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    });
    for (const viewport of VIEWPORTS) {
      byId(`design-viewport-${viewport}`).addEventListener('click', () => this.setViewport(viewport));
    }
    this.lazy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const shot = entry.target as HTMLElement;
        this.lazy.unobserve(shot);
        const slug = shot.dataset.slug;
        const frame = shot.querySelector('iframe');
        if (slug && frame && !frame.getAttribute('src')) frame.src = `relay-design://preview/${slug}/index.html`;
      }
    }, { root: this.home, rootMargin: '240px 0px' });
    byId('design-new').addEventListener('click', () => void this.create());
    byId('design-tile-system').addEventListener('click', () => void this.editSystem());
    this.backButton.addEventListener('click', () => this.back());
    this.sortButton.addEventListener('click', () => this.toggleSort());
    byId('design-system').addEventListener('click', () => void this.editSystem());
    this.modelButton.addEventListener('click', () => {
      if (this.modelMenuOpen) this.closeModelMenu();
      else void this.openModelMenu();
    });
    this.modelMenu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.closeModelMenu();
      this.modelButton.focus();
    });
    byId('design-implement').addEventListener('click', () => void this.implement());
    byId('design-save-version').addEventListener('click', () => void this.saveVersion());
    byId('design-reload').addEventListener('click', () => this.loadPreview(true));
    this.preview.addEventListener('load', () => this.restorePreviewScroll());
    window.addEventListener('message', (event) => this.notePreviewNavigation(event));
    byId('design-reveal').addEventListener('click', () => void this.reveal());
    byId('design-restore').addEventListener('click', () => void this.restore());
    byId('design-cancel').addEventListener('click', () => void this.cancel());
    this.versionsSelect.addEventListener('change', () => {
      this.restoreButton.disabled = !this.versionsSelect.value || this.busy;
    });
  }

  get isOpen(): boolean { return this.opened; }

  get inWorkspace(): boolean { return this.mode === 'workspace'; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.control.disabled = !enabled;
    if (!enabled) this.close();
  }

  setWorkspace(id?: string): void {
    if (this.workspaceId === id) return;
    this.workspaceId = id;
    this.mode = 'home';
    this.slug = undefined;
    this.sessionId = undefined;
    this.view = undefined;
    this.versions = [];
    this.gridSignature = '';
    if (this.opened) { this.applyMode(); void this.refresh(); }
  }

  show(): void {
    if (!this.enabled) return;
    this.opened = true;
    this.page.hidden = false;
    byId('app').classList.add('design-open');
    this.control.setAttribute('aria-pressed', 'true');
    this.applyMode();
    void this.refresh();
    byId('design-close').focus();
  }

  /** Opens the workspace for one design; used by cards and by design tasks in the sidebar. */
  openAt(slug: string): void {
    if (!this.enabled) return;
    if (this.openSlug() === slug && this.opened && this.mode === 'workspace') { void this.refresh(); return; }
    this.mode = 'workspace';
    this.slug = slug;
    this.sessionId = undefined;
    this.versions = [];
    this.show();
  }

  back(): void {
    if (this.mode !== 'workspace') return;
    this.mode = 'home';
    this.slug = undefined;
    this.sessionId = undefined;
    this.versions = [];
    this.busy = false;
    this.applyMode();
    this.gridSignature = '';
    this.renderGrid();
    this.backButton.blur();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.page.hidden = true;
    byId('app').classList.remove('design-open');
    this.control.setAttribute('aria-pressed', 'false');
  }

  toggle(): void {
    if (this.opened) { this.close(); return; }
    this.mode = 'home';
    this.slug = undefined;
    this.sessionId = undefined;
    this.versions = [];
    this.show();
  }

  /** Re-applies the header copy after a language change. */
  refreshMode(): void { if (this.opened) this.applyText(); }

  /** Fresh data pushed from the main process after a turn, snapshot or system change. */
  consume(view: DesignView): void {
    this.view = view;
    if (this.mode === 'workspace' && this.slug && !view.designs.some((design) => design.slug === this.slug)) {
      this.slug = view.designs[0]?.slug;
      this.sessionId = this.slug ? this.active?.sessionId : undefined;
      this.versions = [];
      if (!this.slug) { this.mode = 'home'; this.busy = false; }
    }
    if (this.mode === 'workspace' && this.slug) this.sessionId = this.active?.sessionId ?? this.sessionId;
    if (this.mode === 'home') this.renderGrid();
    this.renderVersions();
    this.applyMode();
    if (this.busy) void this.loadTurns();
  }

  /** Called for every session event; keeps the preview honest while the design task works. */
  noteSession(sessionId: string, idle: boolean): void {
    if (!this.slug || sessionId !== this.sessionId) return;
    if (idle) {
      this.busy = false;
      this.syncBusy();
      this.loadPreview();
      void this.loadVersions();
    } else if (this.busy) {
      void this.loadTurns();
    }
  }

  private get active(): DesignEntry | undefined { return this.view?.designs.find((design) => design.slug === this.slug); }

  private openSlug(): string | undefined { return this.opened ? this.slug : undefined; }

  async refresh(): Promise<void> {
    if (!this.enabled) return;
    const generation = ++this.generation;
    try {
      const view = await window.relay.designView();
      if (generation !== this.generation) return;
      this.view = view;
      if (this.mode === 'workspace') {
        if (!this.slug || !view.designs.some((design) => design.slug === this.slug)) this.slug = view.designs[0]?.slug;
        if (!this.slug) this.mode = 'home';
      }
      if (this.mode === 'workspace' && this.slug) {
        this.sessionId = this.active?.sessionId;
        await this.loadVersions();
        void this.loadTurns();
      } else {
        this.sessionId = undefined;
        this.versions = [];
      }
      this.consume(view);
      if (this.mode === 'workspace') void this.loadModels();
    } catch (error) {
      if (generation !== this.generation) return;
      this.summary.textContent = 'Designs could not be loaded. Close and reopen the page to retry.';
      report('Could not load designs', error);
    }
  }

  private applyMode(): void {
    const workspace = this.mode === 'workspace';
    this.home.hidden = workspace;
    this.workspacePage.hidden = !workspace;
    this.backButton.hidden = !workspace;
    this.systemButton.hidden = !workspace;
    this.modelButton.hidden = !workspace;
    if (!workspace) this.closeModelMenu();
    this.implementButton.hidden = !workspace;
    this.applyText();
    this.syncStage();
  }

  private renderModelLabel(): void {
    const chosen = this.active?.model ?? '';
    this.modelButton.textContent = chosenModelLabel(this.models, chosen);
    this.modelButton.title = chosen
      ? `Model for this design: ${this.modelButton.textContent}`
      : 'Model for this design: Auto picks the best available';
  }

  private async loadModels(): Promise<void> {
    if (this.models.length) return;
    this.models = await window.relay.listModels().catch(() => []);
    this.renderModelLabel();
    if (this.modelMenuOpen) this.renderModelMenu();
  }

  private async openModelMenu(): Promise<void> {
    if (this.modelMenuOpen || this.modelButton.hidden) return;
    await this.loadModels();
    if (!this.opened || this.mode !== 'workspace') return;
    this.modelMenuOpen = true;
    this.modelButton.setAttribute('aria-expanded', 'true');
    this.renderModelMenu();
    this.modelMenu.hidden = false;
    document.addEventListener('pointerdown', this.dismissModelMenu, true);
    this.modelMenu.querySelector<HTMLElement>('.model-option[aria-selected="true"]')?.focus();
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

  private renderModelMenu(): void {
    const chosen = this.active?.model ?? '';
    const rows: HTMLElement[] = [];
    const autoEntry = el('div', `model-entry${chosen ? '' : ' selected'}`);
    const autoRow = button('', () => this.pickModel(''), `model-option${chosen ? '' : ' selected'}`);
    autoRow.setAttribute('role', 'option');
    autoRow.setAttribute('aria-selected', String(!chosen));
    autoRow.append(el('span', 'truncate', 'Auto model'), el('span', 'pill', 'Best available'));
    autoEntry.append(autoRow);
    rows.push(autoEntry);
    const groups = groupModels(this.models, false);
    if (!groups.length) rows.push(el('p', 'model-empty', 'No models are connected yet. Add a provider in Settings.'));
    for (const group of groups) {
      rows.push(el('p', 'model-group-label', group.label));
      for (const model of group.models) {
        const selected = model.id === chosen;
        const entry = el('div', `model-entry${selected ? ' selected' : ''}`);
        const row = button('', () => this.pickModel(model.id), `model-option${selected ? ' selected' : ''}`);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(selected));
        row.disabled = !model.connected;
        row.append(el('span', 'truncate', model.name));
        if (model.free) row.append(el('span', 'pill', 'Free'));
        if (model.context) row.append(el('span', 'pill', `${Math.round(model.context / 1000)}k`));
        entry.append(row);
        rows.push(entry);
      }
    }
    this.modelMenu.replaceChildren(...rows);
  }

  private async pickModel(id: string): Promise<void> {
    const slug = this.slug;
    if (!slug) return;
    this.closeModelMenu();
    try {
      this.view = await window.relay.designSetModel(slug, id);
      this.renderModelLabel();
      notify(id ? `Design model set to ${chosenModelLabel(this.models, id)}` : 'Design model set to Auto');
    } catch (error) {
      report('The design model was not saved', error);
    }
  }

  private applyText(): void {
    const designs = this.view?.designs ?? [];
    if (this.mode === 'workspace') {
      const design = this.active;
      this.title.textContent = design?.title ?? 'Design';
      this.summary.textContent = design
        ? `${design.versions} ${design.versions === 1 ? 'version' : 'versions'} · saved ${stamp(design.updatedAt)} · .relay/design/${design.slug}/`
        : this.slug ? 'Loading this design…' : 'This design is no longer in the project.';
    } else {
      this.title.textContent = 'Design';
      this.summary.textContent = designs.length
        ? `${designs.length} ${designs.length === 1 ? 'design' : 'designs'} in this project. Open one to iterate, or make something new.`
        : 'Pages for this project, previewed live and turned into code when you are happy.';
    }
  }

  private toggleSort(): void {
    this.sort = this.sort === 'recent' ? 'name' : 'recent';
    this.sortButton.textContent = `Sort: ${this.sort === 'recent' ? 'Recent' : 'Name'}`;
    this.gridSignature = '';
    this.renderGrid();
  }

  private sortedDesigns(): DesignEntry[] {
    const designs = [...(this.view?.designs ?? [])];
    return designs.sort((a, b) => this.sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt);
  }

  private renderGrid(): void {
    if (this.mode !== 'home') return;
    const designs = this.sortedDesigns();
    const signature = `${this.sort}::${designs.map((design) => `${design.slug}:${design.title}:${design.versions}:${design.updatedAt}`).join(',')}`;
    if (signature === this.gridSignature) return;
    this.gridSignature = signature;
    this.lazy.disconnect();
    this.lazy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const shot = entry.target as HTMLElement;
        this.lazy.unobserve(shot);
        const slug = shot.dataset.slug;
        const frame = shot.querySelector('iframe');
        if (slug && frame && !frame.getAttribute('src')) frame.src = `relay-design://preview/${slug}/index.html`;
      }
    }, { root: this.home, rootMargin: '240px 0px' });
    if (!designs.length) {
      const empty = el('div', 'design-empty');
      empty.append(
        el('h3', '', 'No designs yet'),
        el('p', '', 'Describe a page and Relay builds it in .relay/design, previews it live, and versions every save.'),
        button('Create a design', () => void this.create(), 'button primary'),
      );
      this.grid.replaceChildren(empty);
      return;
    }
    this.grid.replaceChildren(...designs.map((design, index) => this.card(design, index)));
  }

  private card(design: DesignEntry, index: number): HTMLElement {
    const card = el('article', 'design-card');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open ${design.title}`);
    card.style.animationDelay = `${Math.min(index, 12) * 24}ms`;
    const shot = el('div', 'design-card-shot');
    shot.dataset.slug = design.slug;
    const frame = document.createElement('iframe');
    frame.className = 'design-card-frame';
    frame.title = `${design.title} preview`;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('scrolling', 'no');
    shot.append(frame);
    const foot = el('div', 'design-card-foot');
    const copy = el('div', 'design-card-copy');
    copy.append(
      el('strong', 'design-card-name', design.title),
      el('span', 'design-card-meta', `${design.versions} ${design.versions === 1 ? 'version' : 'versions'} · ${stamp(design.updatedAt)}`),
    );
    const more = el('button', 'icon-button design-card-more', '⋯');
    more.type = 'button';
    more.title = `Actions for ${design.title}`;
    more.setAttribute('aria-label', `Actions for ${design.title}`);
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      this.menu(design);
    });
    foot.append(copy, more);
    card.append(shot, foot);
    card.addEventListener('click', () => this.openAt(design.slug));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.openAt(design.slug);
    });
    this.lazy.observe(shot);
    return card;
  }

  private menu(design: DesignEntry): void {
    const modal = dialog(design.title);
    modal.add(el('p', 'small muted', `${design.versions} ${design.versions === 1 ? 'version' : 'versions'} · ${stamp(design.updatedAt)}`));
    modal.add(button('Open design', () => { modal.root.close(); this.openAt(design.slug); }));
    modal.add(button('Show folder', async () => {
      modal.busy(true);
      try {
        await window.relay.designReveal(design.slug);
        modal.root.close();
      } catch (error) { modal.fail(error); }
      finally { modal.busy(false); }
    }));
    modal.add(button('Delete design', async () => {
      const accepted = await confirmAction(
        'Delete this design?',
        `“${design.title}” is removed with its versions and its task. Files outside .relay/design are not touched.`,
        'Delete design',
      );
      if (!accepted) return;
      modal.busy(true);
      try {
        const view = await window.relay.designDelete(design.slug);
        modal.root.close();
        this.consume(view);
        this.options.deleted();
      } catch (error) { modal.fail(error); }
      finally { modal.busy(false); }
    }, 'button danger'));
  }

  private async loadVersions(): Promise<void> {
    if (!this.slug) { this.renderVersions(); return; }
    const slug = this.slug;
    try {
      const versions = await window.relay.designVersions(slug);
      if (slug !== this.slug) return;
      this.versions = versions;
      this.renderVersions();
    } catch (error) {
      report('Could not load versions', error);
    }
  }

  private renderVersions(): void {
    const options: HTMLOptionElement[] = [];
    const current = el('option', '', 'Current');
    current.value = '';
    options.push(current);
    for (const version of this.versions) {
      const entry = el('option', '', `v${version.version} · ${stamp(version.savedAt)}`);
      entry.value = String(version.version);
      options.push(entry);
    }
    this.versionsSelect.replaceChildren(...options);
    this.versionsSelect.disabled = !this.slug || !this.versions.length || this.busy;
    this.restoreButton.disabled = true;
  }

  private syncStage(): void {
    const ready = Boolean(this.slug) && this.mode === 'workspace';
    this.frame.hidden = !ready;
    this.stageEmpty.hidden = ready;
    this.implementButton.disabled = !ready || this.busy;
    byId<HTMLButtonElement>('design-save-version').disabled = !ready || this.busy;
    byId<HTMLButtonElement>('design-reload').disabled = !ready;
    byId<HTMLButtonElement>('design-reveal').disabled = !ready;
    this.syncBusy();
    if (ready) this.loadPreview();
    else this.preview.removeAttribute('src');
  }

  private syncBusy(): void {
    this.sendButton.disabled = this.busy || !this.slug;
    this.cancelButton.hidden = !this.busy;
    this.implementButton.disabled = this.busy || !this.slug || this.mode !== 'workspace';
    byId<HTMLButtonElement>('design-save-version').disabled = this.busy || !this.slug;
    this.prompt.disabled = this.busy;
    this.versionsSelect.disabled = this.busy || !this.versions.length;
  }

  private setViewport(viewport: Viewport): void {
    this.viewport = viewport;
    this.frame.dataset.viewport = viewport;
    for (const value of VIEWPORTS) {
      byId(`design-viewport-${value}`).setAttribute('aria-pressed', String(value === viewport));
    }
  }

  private loadPreview(force = false): void {
    if (!this.slug) return;
    const key = previewKey(this.active);
    if (!force && key && key === this.lastPreviewKey && this.preview.getAttribute('src')) return;
    this.lastPreviewKey = key;
    const saved = this.previewPos.get(this.slug);
    const href = saved && sameDesignURL(saved.href, this.slug)
      ? saved.href
      : `relay-design://preview/${this.slug}/index.html`;
    const target = new URL(href);
    target.searchParams.set('v', String(++this.previewStamp));
    this.pendingScroll = saved?.scrollY ?? 0;
    this.preview.src = target.toString();
  }

  /** The preview reports where the reader is, so a reload can put them back there. */
  private notePreviewNavigation(event: MessageEvent): void {
    if (event.source !== this.preview.contentWindow) return;
    const data = event.data as { relayPreview?: unknown; href?: unknown; scrollY?: unknown } | null;
    if (!data || data.relayPreview !== 1 || !this.slug) return;
    const href = sameDesignURL(data.href, this.slug);
    if (!href) return;
    this.previewPos.set(this.slug, { href, scrollY: previewScroll(data.scrollY) });
  }

  private restorePreviewScroll(): void {
    if (this.pendingScroll === null) return;
    const y = this.pendingScroll;
    this.pendingScroll = null;
    this.preview.contentWindow?.postMessage({ relayPreviewScroll: y }, '*');
  }

  private async loadTurns(): Promise<void> {
    if (!this.sessionId) {
      this.turns.replaceChildren(this.turnEmpty());
      return;
    }
    const request = ++this.turnRequest;
    try {
      const messages = await window.relay.getMessages(this.sessionId);
      if (request !== this.turnRequest) return;
      this.renderTurns(messages);
    } catch (error) {
      if (request !== this.turnRequest) return;
      report('Could not load design turns', error);
    }
  }

  private renderTurns(messages: ChatMessage[]): void {
    const nodes: HTMLElement[] = [];
    for (const message of messages.slice(-20)) {
      const text = textOf(message);
      if (!text) continue;
      const card = el('article', `design-turn ${message.role}`);
      card.append(el('span', 'design-turn-role', message.role === 'user' ? 'You' : 'Relay'), el('p', '', text));
      nodes.push(card);
    }
    if (this.busy) nodes.push(el('p', 'design-working', 'Working on it…'));
    if (!nodes.length) nodes.push(this.turnEmpty());
    this.turns.replaceChildren(...nodes);
    this.turns.scrollTop = this.turns.scrollHeight;
  }

  private turnEmpty(): HTMLElement {
    return el('p', 'design-turns-empty', 'Describe the page below. The agent writes it in the sandbox and the preview updates when it saves.');
  }

  private async send(): Promise<void> {
    if (!this.slug || this.busy) return;
    const request = this.prompt.value.trim();
    if (!request) return;
    this.busy = true;
    this.syncBusy();
    this.turns.append(el('p', 'design-working', 'Working on it…'));
    try {
      const result = await window.relay.designSend(this.slug, request);
      this.sessionId = result.sessionId;
      this.prompt.value = '';
      this.renderVersions();
      notify('Designing — the preview updates when the agent saves.');
      void this.loadTurns();
    } catch (error) {
      this.busy = false;
      this.syncBusy();
      report('Could not start the design turn', error);
    }
  }

  private async cancel(): Promise<void> {
    if (!this.slug) return;
    try {
      await window.relay.designCancel(this.slug);
    } catch (error) {
      report('Could not stop the design turn', error);
    }
  }

  private async create(): Promise<void> {
    const name = await this.askName();
    if (!name) return;
    try {
      const view = await window.relay.designCreate(name);
      const slug = view.designs.find((design) => design.slug === designSlug(name))?.slug ?? view.designs[0]?.slug;
      this.view = view;
      if (!slug) { this.consume(view); return; }
      this.mode = 'workspace';
      this.slug = slug;
      this.sessionId = view.designs.find((design) => design.slug === slug)?.sessionId;
      this.applyMode();
      void this.loadVersions();
      void this.loadTurns();
      this.consume(view);
      this.prompt.focus();
    } catch (error) {
      report('Could not create the design', error);
    }
  }

  private askName(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const modal = dialog('New design');
      const input = el('input');
      input.placeholder = 'Checkout flow';
      input.maxLength = 80;
      input.required = true;
      const form = el('form');
      const submit = el('button', 'button primary', 'Create');
      submit.type = 'submit';
      const actions = el('div', 'dialog-actions');
      actions.append(button('Cancel', () => { resolve(undefined); modal.root.close(); }), submit);
      form.append(field('Design name', input, 'Letters and numbers; this becomes the folder name.'), actions);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        resolve(value);
        modal.root.close();
      });
      modal.add(form);
      input.focus();
    });
  }

  private async saveVersion(): Promise<void> {
    if (!this.slug) return;
    try {
      const view = await window.relay.designSnapshot(this.slug);
      this.view = view;
      await this.loadVersions();
      notify('Version saved.');
    } catch (error) {
      report('Could not save a version', error);
    }
  }

  private async restore(): Promise<void> {
    const value = Number(this.versionsSelect.value);
    if (!this.slug || !value) return;
    const accepted = await confirmAction('Restore this version?', `The design's files go back to v${value}. The current state stays in its own saved version if you saved one.`, 'Restore');
    if (!accepted) return;
    try {
      const view = await window.relay.designRestore(this.slug, value);
      this.view = view;
      await this.loadVersions();
      this.loadPreview(true);
      notify(`Restored v${value}.`);
    } catch (error) {
      report('Could not restore that version', error);
    }
  }

  private async reveal(): Promise<void> {
    if (!this.slug) return;
    try {
      await window.relay.designReveal(this.slug);
    } catch (error) {
      report('Could not show the design folder', error);
    }
  }

  private async implement(): Promise<void> {
    if (!this.slug) return;
    const accepted = await confirmAction('Implement in project?', 'Relay starts a normal task that reads this design and applies it to your project files, following your project conventions.', 'Start task');
    if (!accepted) return;
    try {
      const result = await window.relay.designImplement(this.slug);
      notify('Implementation task started.');
      this.options.openTask(result.sessionId);
    } catch (error) {
      report('Could not start the implementation task', error);
    }
  }

  private async editSystem(): Promise<void> {
    const system = this.view?.system;
    if (!system) { notify('The design system is still loading.', true); return; }
    const modal = dialog('Design system');
    const form = el('form');
    const name = el('input');
    name.value = system.name;
    name.maxLength = 80;
    const notes = el('textarea');
    notes.rows = 4;
    notes.maxLength = 4000;
    notes.value = system.notes;
    const colors = Object.keys(system.colors) as Array<keyof DesignColors>;
    const colorInputs = colors.map((role) => {
      const input = el('input');
      input.type = 'color';
      input.value = system.colors[role];
      input.name = role;
      const label = el('label', 'design-color');
      label.append(el('span', '', role[0].toUpperCase() + role.slice(1)), input);
      return { role, input, label };
    });
    const heading = el('input');
    heading.value = system.type.heading;
    const bodyFont = el('input');
    bodyFont.value = system.type.body;
    const mono = el('input');
    mono.value = system.type.mono;
    const base = el('input');
    base.type = 'number';
    base.min = '12';
    base.max = '22';
    base.value = String(system.type.base);
    const scale = el('input');
    scale.type = 'number';
    scale.min = '1.05';
    scale.max = '1.6';
    scale.step = '0.01';
    scale.value = String(system.type.scale);
    const space = el('input');
    space.type = 'number';
    space.min = '2';
    space.max = '24';
    space.value = String(system.shape.space);
    const radius = el('input');
    radius.type = 'number';
    radius.min = '0';
    radius.max = '48';
    radius.value = String(system.shape.radius);
    const shadow = el('input');
    shadow.value = system.shape.shadow;
    shadow.maxLength = 120;
    const actions = el('div', 'dialog-actions');
    const submit = el('button', 'button primary', 'Save');
    submit.type = 'submit';
    actions.append(button('Cancel', () => modal.root.close()), submit);
    const colorsBox = el('div', 'design-colors');
    colorsBox.append(...colorInputs.map((entry) => entry.label));
    form.append(
      field('Name', name),
      field('Notes', notes, 'Tone, imagery, do and do-not rules. Sent with every design prompt.'),
      colorsBox,
      field('Heading font', heading), field('Body font', bodyFont), field('Mono font', mono),
      field('Base size (px)', base), field('Type scale', scale),
      field('Spacing unit (px)', space), field('Corner radius (px)', radius), field('Shadow', shadow),
      actions,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const next: DesignSystem = {
        version: 1, name: name.value, notes: notes.value,
        colors: Object.fromEntries(colorInputs.map((entry) => [entry.role, entry.input.value])) as unknown as DesignColors,
        type: {
          heading: heading.value, body: bodyFont.value, mono: mono.value,
          base: Number(base.value), scale: Number(scale.value),
        },
        shape: { space: Number(space.value), radius: Number(radius.value), shadow: shadow.value },
      };
      void run(submit, async () => {
        modal.busy(true);
        try {
          const view = await window.relay.saveDesignSystem(next);
          this.view = view;
          this.loadPreview(true);
          modal.root.close();
          notify('Design system saved — new designs use it.');
        } catch (error) {
          modal.fail(error);
        } finally {
          modal.busy(false);
        }
      });
    });
    modal.add(form);
    name.focus();
  }
}
