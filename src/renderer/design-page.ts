import { byId, button, el, field, notify, report, run } from './dom';
import { confirmAction, dialog } from './dialog';
import type { ChatMessage, ContextBlock, McpServer, ModelOption, PluginView, SkillOption, ToolPart } from '../shared/contracts';
import type { DesignColors, DesignComment, DesignEntry, DesignKind, DesignPage as DesignScreen, DesignSystem, DesignTemplate, DesignVersion, DesignView } from '../shared/design';
import {
  DESIGN_ENTRY, DESIGN_MAX_CONTEXT, DESIGN_MAX_FILES, DESIGN_SYSTEM_PRESETS, DESIGN_TEMPLATES, applyDesignSystemPreset, defaultDesignSkills,
  designPageFile, designSlug, designSuggestions, designTemplate, pickedElement, previewScroll, rawDesignRequest, sameDesignURL,
} from '../shared/design';
import { filterMentionables, parseMentionToken, type MentionSource } from './mention';
import { wirePlusMenu, type PlusAction } from './plus-menu';
import { chosenModelLabel, groupModels } from './model-menu';
import { previewKey } from './state';
import { appendStream, liveReplyText, type LiveReply, type StreamChunk } from './live-reply';
import { editedFiles } from './design-turns';
import { stepperSummary } from './tool-stepper';

type Viewport = 'desktop' | 'tablet' | 'phone';
type Mode = 'home' | 'workspace';
type Sort = 'recent' | 'name';

const VIEWPORTS: Viewport[] = ['desktop', 'tablet', 'phone'];

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const PASTE_ATTACH_CHARS = 2000;

function pathFromFileURL(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'file:') return '';
    const decoded = decodeURIComponent(url.pathname);
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch { return ''; }
}

function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

interface DesignPageOptions {
  openTask: (sessionId: string) => void;
  /** A design and its task were removed; task lists need a refresh. */
  deleted: () => void;
}

/** One composed design turn: the request plus everything attached to it. */
interface DesignTurn {
  request: string;
  files: Array<{ path: string; name: string }>;
  skills: string[];
  context: ContextBlock[];
}

const stamp = (ms: number): string => ms
  ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'Saved earlier';

function toolState(state: ToolPart['state']): string {
  return state === 'error' ? 'Failed' : state === 'running' ? 'Running' : state === 'pending' ? 'Queued' : 'Done';
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
  private queued: DesignTurn[] = [];
  private queueNode = byId<HTMLElement>('design-queue');
  private dispatching = false;
  private viewport: Viewport = 'desktop';
  private generation = 0;
  private previewStamp = 0;
  private turnRequest = 0;
  private lastPreviewKey = '';
  private previewPos = new Map<string, { href: string; scrollY: number }>();
  private pendingScroll: number | null = null;
  private models: ModelOption[] = [];
  private modelMenuOpen = false;
  private live?: LiveReply;
  private liveNode?: HTMLElement;
  private turnTimer?: number;
  private updatedTimer?: number;
  private pickButton = byId<HTMLButtonElement>('design-pick');
  private picking = false;
  private editButton = byId<HTMLButtonElement>('design-edit');
  private saveEditButton = byId<HTMLButtonElement>('design-save-edit');
  private artboards = byId('design-artboards');
  private pages: DesignScreen[] = [];
  private activeFile = DESIGN_ENTRY;
  private artboardSignature = '';
  private editing = false;
  private editChanged = false;
  private savingEdit = false;
  private commentsButton = byId<HTMLButtonElement>('design-comments');
  private commentsBadge = byId<HTMLElement>('design-comments-count');
  private exportButton = byId<HTMLButtonElement>('design-export');
  private codeButton = byId<HTMLButtonElement>('design-code');
  private openButton = byId<HTMLButtonElement>('design-open');
  private fullscreenButton = byId<HTMLButtonElement>('design-fullscreen');
  private suggestions = byId('design-suggestions');
  private full = false;
  private plusButton = byId<HTMLButtonElement>('design-plus');
  private plusMenu = byId('design-plus-menu');
  private attachButton = byId<HTMLButtonElement>('design-attach');
  private chips = byId('design-chips');
  private mentionMenu = byId('design-mention-menu');
  private mentionOpen = false;
  private mentionSources: MentionSource[] = [];
  private mentionIndex = 0;
  private mentionGeneration = 0;
  private skills: SkillOption[] = [];
  private plugins: PluginView[] = [];
  private connectors: McpServer[] = [];
  private toolsLoading?: Promise<void>;
  private selectedSkills: string[] = [];
  private files: Array<{ path: string; name: string }> = [];
  private context: ContextBlock[] = [];

  constructor(private readonly options: DesignPageOptions) {
    this.form.addEventListener('submit', (event) => { event.preventDefault(); void this.send(); });
    this.prompt.addEventListener('input', () => this.refreshMention());
    this.prompt.addEventListener('keydown', (event) => {
      if (this.mentionOpen) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          this.moveMention(event.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const source = this.mentionSources[this.mentionIndex];
          if (source) { event.preventDefault(); this.chooseMention(source); return; }
        }
        if (event.key === 'Escape') { event.preventDefault(); this.closeMention(); return; }
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    });
    this.prompt.addEventListener('blur', () => this.closeMention());
    this.prompt.addEventListener('paste', (event) => this.pasteFiles(event));
    this.form.addEventListener('dragover', (event) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      this.form.classList.add('drop-target');
    });
    this.form.addEventListener('dragleave', (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && this.form.contains(next)) return;
      this.form.classList.remove('drop-target');
    });
    this.form.addEventListener('drop', (event) => {
      event.preventDefault();
      this.form.classList.remove('drop-target');
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length) void this.attachFiles(files);
    });
    this.attachButton.addEventListener('click', () => void this.pickFiles());
    wirePlusMenu(this.plusButton, this.plusMenu, () => this.plusActions());
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
    byId('design-tile-slides').addEventListener('click', () => void this.create('slides'));
    byId('design-tile-whiteboard').addEventListener('click', () => void this.create('board'));
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
    this.pickButton.addEventListener('click', () => this.togglePick());
    this.editButton.addEventListener('click', () => this.toggleEdit());
    this.saveEditButton.addEventListener('click', () => void this.saveEdit());
    this.commentsButton.addEventListener('click', () => void this.openComments());
    this.exportButton.addEventListener('click', () => void this.exportDesign());
    this.codeButton.addEventListener('click', () => void this.copyPage());
    this.openButton.addEventListener('click', () => void this.openInBrowser());
    this.fullscreenButton.addEventListener('click', () => this.setFullscreen(!this.full));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.full) return;
      event.preventDefault();
      this.setFullscreen(false);
    });
    this.preview.addEventListener('load', () => {
      this.restorePreviewScroll();
      if (this.picking) this.preview.contentWindow?.postMessage({ relayPick: 'start' }, '*');
    });
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
    this.queued = [];
    this.gridSignature = '';
    this.resetCanvas();
    this.setFullscreen(false);
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
    this.setPicking(false);
    this.setFullscreen(false);
    this.mode = 'workspace';
    this.slug = slug;
    this.sessionId = undefined;
    this.versions = [];
    this.queued = [];
    this.resetCanvas();
    this.show();
    void this.ensureDesignTools();
  }

  back(): void {
    if (this.mode !== 'workspace') return;
    this.setPicking(false);
    this.setFullscreen(false);
    this.mode = 'home';
    this.slug = undefined;
    this.sessionId = undefined;
    this.versions = [];
    this.queued = [];
    this.busy = false;
    this.resetCanvas();
    this.renderQueue();
    this.applyMode();
    this.gridSignature = '';
    this.renderGrid();
    this.backButton.blur();
  }

  close(): void {
    if (!this.opened) return;
    this.setPicking(false);
    this.setFullscreen(false);
    this.resetCanvas();
    this.queued = [];
    this.renderQueue();
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
    this.resetCanvas();
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
    if (this.mode === 'workspace' && this.slug) {
      void this.loadPages();
      void this.refreshCommentCount();
      this.reloadTurnsSoon();
    }
  }

  /** Called for every session event; keeps the preview and the turn feed honest while the design task works. */
  noteSession(sessionId: string, idle: boolean): void {
    if (!this.slug || sessionId !== this.sessionId) return;
    if (idle) {
      this.busy = false;
      this.live = undefined;
      this.liveNode = undefined;
      this.syncBusy();
      this.loadPreview();
      void this.loadVersions();
      void this.loadPages();
      void this.loadTurns();
      void this.refreshCommentCount();
      void this.ensureDesignTools();
      this.drainQueue();
    } else {
      if (!this.busy) { this.busy = true; this.syncBusy(); }
      this.reloadTurnsSoon();
    }
  }

  /** A file in the open design changed on disk; refresh the preview in place. */
  filesChanged(slug: string, _stamp: number): void {
    if (!this.opened || this.mode !== 'workspace' || this.slug !== slug) return;
    if (this.editing) this.finishEdit();
    this.loadPreview(true);
    void this.loadPages();
    this.flashUpdated();
  }

  /** Live assistant text for the design task, so the turn visibly forms while it runs. */
  stream(sessionId: string, chunk: StreamChunk): void {
    if (!this.opened || this.mode !== 'workspace' || sessionId !== this.sessionId || chunk.kind !== 'text') return;
    this.live = appendStream(this.live, chunk);
    this.renderLive();
  }

  private flashUpdated(): void {
    const chip = byId('design-updated');
    chip.hidden = false;
    window.clearTimeout(this.updatedTimer);
    this.updatedTimer = window.setTimeout(() => { chip.hidden = true; }, 2200);
  }

  private reloadTurnsSoon(): void {
    if (this.turnTimer !== undefined) return;
    this.turnTimer = window.setTimeout(() => {
      this.turnTimer = undefined;
      void this.loadTurns();
    }, 180);
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
        void this.loadPages();
        void this.loadTurns();
      } else {
        this.sessionId = undefined;
        this.versions = [];
      }
      this.consume(view);
      if (this.mode === 'workspace') void this.loadModels();
      if (this.mode === 'workspace') void this.ensureDesignTools();
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
    const signature = `${this.sort}::${designs.map((design) => `${design.slug}:${design.title}:${design.kind ?? 'page'}:${design.versions}:${design.updatedAt}`).join(',')}`;
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
      el('span', 'design-card-meta', `${design.kind === 'slides' ? 'Deck · ' : design.kind === 'board' ? 'Whiteboard · ' : ''}${design.versions} ${design.versions === 1 ? 'version' : 'versions'} · ${stamp(design.updatedAt)}`),
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
    this.renderSuggestions();
  }

  private syncStage(): void {
    const ready = Boolean(this.slug) && this.mode === 'workspace';
    this.frame.hidden = !ready;
    this.stageEmpty.hidden = ready;
    this.implementButton.disabled = !ready || this.busy;
    byId<HTMLButtonElement>('design-save-version').disabled = !ready || this.busy;
    byId<HTMLButtonElement>('design-reload').disabled = !ready;
    byId<HTMLButtonElement>('design-reveal').disabled = !ready;
    this.fullscreenButton.disabled = !ready;
    this.syncBusy();
    if (!ready) {
      this.setFullscreen(false);
      this.artboardSignature = '';
      this.artboards.replaceChildren();
    }
    if (ready) this.loadPreview();
    else this.preview.removeAttribute('src');
  }

  private syncBusy(): void {
    this.sendButton.disabled = !this.slug;
    this.sendButton.textContent = this.busy ? 'Queue' : 'Generate';
    this.sendButton.title = this.busy ? 'Queue for after this turn' : 'Send';
    this.sendButton.setAttribute('aria-label', this.busy ? 'Queue message for after this turn' : 'Send message');
    this.cancelButton.hidden = !this.busy;
    this.implementButton.disabled = this.busy || !this.slug || this.mode !== 'workspace';
    byId<HTMLButtonElement>('design-save-version').disabled = this.busy || !this.slug;
    this.prompt.disabled = !this.slug;
    this.plusButton.disabled = !this.slug;
    this.attachButton.disabled = !this.slug;
    this.pickButton.disabled = !this.slug || this.mode !== 'workspace';
    this.editButton.disabled = !this.slug || this.mode !== 'workspace' || this.busy;
    this.codeButton.disabled = !this.slug || this.mode !== 'workspace';
    this.openButton.disabled = !this.slug || this.mode !== 'workspace';
    this.versionsSelect.disabled = this.busy || !this.versions.length;
    this.renderQueue();
    this.renderSuggestions();
    this.syncEdit();
  }

  private setViewport(viewport: Viewport): void {
    this.viewport = viewport;
    this.frame.dataset.viewport = viewport;
    for (const value of VIEWPORTS) {
      byId(`design-viewport-${value}`).setAttribute('aria-pressed', String(value === viewport));
    }
  }

  private resetCanvas(): void {
    this.pages = [];
    this.activeFile = DESIGN_ENTRY;
    this.artboardSignature = '';
    this.artboards.replaceChildren();
    this.setEditOff();
  }

  private setEditOff(): void {
    this.editing = false;
    this.editChanged = false;
    this.savingEdit = false;
    this.syncEdit();
  }

  private syncEdit(): void {
    this.editButton.setAttribute('aria-pressed', String(this.editing));
    this.editButton.title = this.editing ? 'Editing text — click to save' : 'Edit text directly in the preview';
    this.editButton.setAttribute('aria-label', this.editing ? 'Editing text — save the page' : 'Edit text in the preview');
    this.saveEditButton.hidden = !this.editing;
    this.saveEditButton.disabled = !this.editing || !this.editChanged || this.savingEdit || this.busy;
    this.frame.classList.toggle('editing', this.editing);
  }

  private toggleEdit(): void {
    if (!this.slug || this.busy || this.mode !== 'workspace' || !this.preview.getAttribute('src')) return;
    if (this.editing) { void this.saveEdit(); return; }
    if (this.picking) this.stopPick();
    this.editing = true;
    this.editChanged = false;
    this.syncEdit();
    this.preview.contentWindow?.postMessage({ relayEdit: 'start' }, '*');
    notify('Edit the text in the preview. Save with ⌘S or the check, Esc cancels.');
  }

  /** The page HTML from the preview runtime, or null when it does not answer in time. */
  private requestPageHTML(): Promise<string | null> {
    return new Promise((resolve) => {
      let timer = 0;
      const cleanup = (): void => {
        window.clearTimeout(timer);
        window.removeEventListener('message', onMessage);
      };
      const onMessage = (event: MessageEvent): void => {
        if (event.source !== this.preview.contentWindow) return;
        const data = event.data as Record<string, unknown> | null;
        if (!data || data.relayEdited !== 1 || typeof data.html !== 'string') return;
        cleanup();
        resolve(data.html);
      };
      timer = window.setTimeout(() => { cleanup(); resolve(null); }, 2000);
      window.addEventListener('message', onMessage);
      this.preview.contentWindow?.postMessage({ relayEdit: 'save' }, '*');
    });
  }

  private async saveEdit(): Promise<void> {
    if (!this.editing || this.savingEdit) return;
    const slug = this.slug;
    const file = this.activeFile;
    if (!slug) return;
    this.savingEdit = true;
    this.syncEdit();
    const html = await this.requestPageHTML();
    this.savingEdit = false;
    this.setEditOff();
    if (!html) { this.loadPreview(true); return; }
    try {
      const view = await window.relay.designSavePage(slug, file, html);
      this.consume(view);
      if (slug === this.slug && file === this.activeFile) this.loadPreview(true);
      notify(`${file} saved. The previous page is kept as a version.`);
    } catch (error) {
      report('The page edits were not saved', error);
      this.loadPreview(true);
    }
  }

  /** Commits unsaved preview edits before a prompt, artboard switch or restore. */
  private async saveEditIfChanged(): Promise<void> {
    if (!this.editing) return;
    if (this.editChanged) { await this.saveEdit(); return; }
    this.setEditOff();
    this.preview.contentWindow?.postMessage({ relayEdit: 'stop' }, '*');
  }

  /** Discards preview edits when the file changes on disk or the page goes away. */
  private finishEdit(): void {
    if (!this.editing) return;
    this.setEditOff();
    this.preview.contentWindow?.postMessage({ relayEdit: 'stop' }, '*');
  }

  private pageFromURL(href: string): string {
    try {
      const url = new URL(href);
      return url.pathname.split('/').filter(Boolean).slice(1).join('/');
    } catch { return ''; }
  }

  private async loadPages(): Promise<void> {
    const slug = this.slug;
    if (!slug || this.mode !== 'workspace') {
      this.pages = [];
      this.renderArtboards();
      return;
    }
    try {
      const pages = await window.relay.designPages(slug);
      if (slug !== this.slug || this.mode !== 'workspace') return;
      this.pages = pages;
      const current = pages.find((page) => page.file === this.activeFile) ?? pages[0];
      if (current && current.file !== this.activeFile) {
        this.activeFile = current.file;
        this.loadPreview(true);
      }
      this.renderArtboards();
    } catch (error) {
      report('Could not load the screens', error);
    }
  }

  private renderArtboards(): void {
    const slug = this.slug;
    if (!slug || this.mode !== 'workspace') {
      this.artboardSignature = '';
      this.artboards.replaceChildren();
      return;
    }
    const signature = `${slug}::${this.activeFile}::${this.pages.map((page) => `${page.file}:${page.name}`).join(',')}`;
    if (signature === this.artboardSignature) return;
    this.artboardSignature = signature;
    const nodes: HTMLElement[] = this.pages.map((page) => {
      const active = page.file === this.activeFile;
      const tab = el('button', 'design-artboard');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active));
      tab.title = `${page.name} — ${page.file}`;
      const shot = el('span', 'design-artboard-shot');
      if (active) shot.append(el('span', 'design-artboard-live', 'Live'));
      else {
        const frame = document.createElement('iframe');
        frame.className = 'design-artboard-frame';
        frame.title = `${page.name} screen`;
        frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('scrolling', 'no');
        frame.src = `relay-design://preview/${slug}/${page.file}`;
        shot.append(frame);
      }
      tab.append(shot, el('span', 'design-artboard-name', page.name));
      tab.addEventListener('click', () => void this.selectPage(page.file));
      return tab;
    });
    const add = button('', () => this.addScreen(), 'design-artboard-add');
    add.append(el('span', '', '+'), el('span', '', 'Add screen'));
    add.title = 'Add another screen to this design';
    nodes.push(add);
    this.artboards.replaceChildren(...nodes);
  }

  private async selectPage(file: string): Promise<void> {
    if (file === this.activeFile) return;
    if (this.editing) await this.saveEditIfChanged();
    this.setPicking(false);
    this.activeFile = file;
    this.renderArtboards();
    this.loadPreview(true);
  }

  private addScreen(): void {
    const slug = this.slug;
    if (!slug || this.busy || this.mode !== 'workspace') return;
    const modal = dialog('Add a screen');
    const input = el('input');
    input.placeholder = 'Order status';
    input.maxLength = 80;
    input.required = true;
    const form = el('form');
    const submit = el('button', 'button primary', 'Add screen');
    submit.type = 'submit';
    form.append(field('Screen name', input), submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name || submit.disabled) return;
      submit.disabled = true;
      modal.busy(true);
      void (async () => {
        try {
          const file = designPageFile(name);
          const view = await window.relay.designAddPage(slug, name);
          modal.root.close();
          this.consume(view);
          this.activeFile = file;
          await this.loadPages();
          this.renderArtboards();
          this.loadPreview(true);
          notify(`${name} added. Describe what belongs on it, or edit it directly.`);
        } catch (error) {
          modal.fail(error);
        } finally {
          submit.disabled = false;
          modal.busy(false);
        }
      })();
    });
    modal.add(form);
    input.focus();
  }

  private loadPreview(force = false): void {
    if (!this.slug) return;
    if (this.editing) this.finishEdit();
    const key = `${previewKey(this.active)}::${this.activeFile}`;
    if (!force && key && key === this.lastPreviewKey && this.preview.getAttribute('src')) return;
    this.lastPreviewKey = key;
    const saved = this.previewPos.get(`${this.slug}/${this.activeFile}`);
    const href = saved && this.pageFromURL(saved.href) === this.activeFile && sameDesignURL(saved.href, this.slug)
      ? saved.href
      : `relay-design://preview/${this.slug}/${this.activeFile}`;
    const target = new URL(href);
    target.searchParams.set('v', String(++this.previewStamp));
    this.pendingScroll = saved?.scrollY ?? 0;
    this.preview.src = target.toString();
  }

  /** The preview reports where the reader is, which element they picked and edits to save. */
  private notePreviewNavigation(event: MessageEvent): void {
    if (event.source !== this.preview.contentWindow || !this.slug) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data) return;
    if (data.relayDirty === 1) {
      if (!this.editing) return;
      this.editChanged = true;
      this.syncEdit();
      return;
    }
    if (data.relaySaveRequest === 1) { void this.saveEdit(); return; }
    if (data.relayEditEnded === 1) {
      if (!this.editing) return;
      this.setEditOff();
      this.loadPreview(true);
      return;
    }
    if (data.relayPickEnded === 1) { this.setPicking(false); return; }
    if (data.relayPicked === 1) {
      this.setPicking(false);
      const picked = pickedElement(data.element);
      if (!picked) { notify('That element could not be read. Try picking another.', true); return; }
      if (this.addContext(picked.label, picked.text)) {
        notify(`${picked.label} attached — describe the change you want.`);
        this.prompt.focus();
      }
      return;
    }
    if (data.relayPreview !== 1) return;
    const href = sameDesignURL(data.href, this.slug);
    if (!href) return;
    const page = this.pageFromURL(href);
    if (page && page !== this.activeFile) {
      this.activeFile = page;
      this.renderArtboards();
    }
    this.previewPos.set(`${this.slug}/${page || this.activeFile}`, { href, scrollY: previewScroll(data.scrollY) });
  }

  private togglePick(): void {
    if (this.busy || !this.slug || this.mode !== 'workspace') return;
    if (this.editing) { notify('Save or cancel your edits before selecting an element.', true); return; }
    if (this.picking) { this.stopPick(); return; }
    if (!this.preview.getAttribute('src')) return;
    this.setPicking(true);
    this.preview.contentWindow?.postMessage({ relayPick: 'start' }, '*');
    notify('Click an element in the preview to attach it to your next request.');
  }

  private stopPick(): void {
    this.setPicking(false);
    this.preview.contentWindow?.postMessage({ relayPick: 'stop' }, '*');
  }

  private setPicking(on: boolean): void {
    this.picking = on;
    this.pickButton.setAttribute('aria-pressed', String(on));
    this.pickButton.title = on ? 'Click an element in the preview — Esc cancels' : 'Select an element to attach it to the prompt';
  }

  /** Expands the preview over the whole window; Escape or the same button returns. */
  private setFullscreen(on: boolean): void {
    if (on && (this.mode !== 'workspace' || !this.slug)) return;
    this.full = on;
    this.workspacePage.classList.toggle('preview-full', on);
    this.fullscreenButton.setAttribute('aria-pressed', String(on));
    this.fullscreenButton.title = on ? 'Exit full screen preview (Esc)' : 'Fullscreen preview';
    this.fullscreenButton.setAttribute('aria-label', on ? 'Exit full screen preview' : 'Fullscreen preview');
  }

  private renderSuggestions(): void {
    const visible = this.opened && this.mode === 'workspace' && Boolean(this.slug) && !this.busy;
    if (!visible) { this.suggestions.replaceChildren(); return; }
    const items = designSuggestions({ versions: this.versions.length, context: this.context.length });
    this.suggestions.replaceChildren(...items.map((text) => {
      const chip = button(text, () => {
        this.prompt.value = text;
        this.prompt.focus();
        this.prompt.setSelectionRange(text.length, text.length);
      }, 'design-suggestion');
      chip.title = 'Fill the prompt with this';
      return chip;
    }));
  }

  private async copyPage(): Promise<void> {
    if (!this.slug) return;
    try {
      const page = await window.relay.designCode(this.slug, this.activeFile);
      await window.relay.copyText(page.text);
      notify(`${page.name} copied to the clipboard.`);
    } catch (error) {
      report('Could not copy the page code', error);
    }
  }

  private async openInBrowser(): Promise<void> {
    if (!this.slug) return;
    try {
      await window.relay.designOpenPreview(this.slug, this.activeFile);
    } catch (error) {
      report('Could not open the preview in the browser', error);
    }
  }

  private async refreshCommentCount(): Promise<void> {
    const slug = this.slug;
    if (!slug || this.mode !== 'workspace') { this.commentsBadge.hidden = true; return; }
    try {
      const comments = await window.relay.designComments(slug);
      if (slug !== this.slug) return;
      const open = comments.filter((comment) => comment.status === 'open').length;
      this.commentsBadge.hidden = open === 0;
      this.commentsBadge.textContent = String(open);
      this.commentsButton.title = open ? `${open} open review ${open === 1 ? 'comment' : 'comments'}` : 'Review comments';
    } catch {
      this.commentsBadge.hidden = true;
    }
  }

  /** Review notes on the page; sending them rides one agent turn. */
  private async openComments(): Promise<void> {
    const slug = this.slug;
    if (!slug || this.mode !== 'workspace') return;
    const modal = dialog('Review comments');
    if (!this.pages.length) {
      try { this.pages = await window.relay.designPages(slug); } catch { /* keeps the entry page */ }
    }
    let comments = await window.relay.designComments(slug).catch((error) => {
      modal.fail(error);
      return [] as DesignComment[];
    });
    const list = el('div', 'design-comment-list');
    const pageSelect = el('select');
    pageSelect.setAttribute('aria-label', 'Page for this comment');
    for (const page of this.pages.length ? this.pages : [{ file: this.activeFile, name: this.activeFile }]) {
      pageSelect.append(new Option(page.name, page.file));
    }
    pageSelect.value = this.activeFile;
    const note = el('textarea');
    note.rows = 3;
    note.maxLength = 2000;
    note.placeholder = 'What should change? Be specific — this goes to the agent verbatim.';
    const addButton = el('button', 'button', 'Add comment');
    addButton.type = 'button';
    addButton.disabled = true;
    note.addEventListener('input', () => { addButton.disabled = !note.value.trim(); });
    const draw = (): void => {
      list.replaceChildren();
      if (!comments.length) {
        list.append(el('p', 'small muted', 'No comments yet. Add one below, then send them to the agent together.'));
        return;
      }
      for (const comment of comments) {
        const row = el('div', `design-comment${comment.status === 'sent' ? ' sent' : ''}`);
        const meta = el('div', 'design-comment-meta');
        meta.append(
          el('span', 'design-comment-where', comment.selector ? `${comment.page} · ${comment.selector}` : comment.page),
          el('span', 'design-comment-state', comment.status === 'sent' ? 'Sent to agent' : 'Open'),
        );
        const remove = button('Resolve', async () => {
          comments = await window.relay.designResolveComment(slug, comment.id);
          draw();
          void this.refreshCommentCount();
        }, 'text-button');
        const head = el('div', 'design-comment-head');
        head.append(meta, remove);
        row.append(head, el('p', 'design-comment-note', comment.note));
        list.append(row);
      }
    };
    draw();
    addButton.addEventListener('click', () => {
      void run(addButton, async () => {
        try {
          comments = await window.relay.designAddComment(slug, { page: pageSelect.value, selector: '', note: note.value });
          note.value = '';
          draw();
          void this.refreshCommentCount();
        } catch (error) {
          modal.fail(error);
        }
      });
    });
    const open = (): number => comments.filter((comment) => comment.status === 'open').length;
    const send = el('button', 'button primary', 'Send to agent');
    send.type = 'button';
    const syncSend = (): void => { send.disabled = open() === 0; };
    syncSend();
    send.addEventListener('click', () => {
      void run(send, async () => {
        try {
          const count = open();
          const result = await window.relay.designSendComments(slug);
          this.sessionId = result.sessionId;
          modal.root.close();
          notify(`${count} ${count === 1 ? 'comment' : 'comments'} sent to the agent.`);
        } catch (error) {
          modal.fail(error);
        }
      });
    });
    const composer = el('div', 'design-comment-composer');
    composer.append(pageSelect, note, addButton);
    const actions = el('div', 'dialog-actions');
    actions.append(send, button('Done', () => modal.root.close(), 'button'));
    modal.add(list, composer, actions);
    const observer = new MutationObserver(() => syncSend());
    observer.observe(list, { childList: true });
    modal.root.addEventListener('close', () => observer.disconnect(), { once: true });
    note.focus();
  }

  private async exportDesign(): Promise<void> {
    const slug = this.slug;
    if (!slug) return;
    const modal = dialog('Export design');
    const act = (label: string, work: () => Promise<void>, primary = false): HTMLButtonElement => {
      const control = el('button', primary ? 'button primary' : 'button', label);
      control.type = 'button';
      control.addEventListener('click', () => void run(control, work, (error) => modal.fail(error)));
      return control;
    };
    const html = act('Export pages (HTML)', async () => {
      const folder = await window.relay.designExportHTML(slug);
      if (!folder) return;
      modal.root.close();
      notify('Pages exported — open the folder you chose to share them.');
    });
    const pdf = act('Export this page (PDF)', async () => {
      const file = await window.relay.designExportPDF(slug, this.activeFile);
      if (!file) return;
      modal.root.close();
      notify('PDF exported.');
    }, true);
    const actions = el('div', 'dialog-actions');
    actions.append(html, pdf, button('Cancel', () => modal.root.close(), 'button'));
    modal.add(
      el('p', '', 'Share the pages as they look in the preview. Versions and review notes stay in Relay.'),
      actions,
    );
    pdf.focus();
  }

  private async copyReply(text: string): Promise<void> {
    try {
      await window.relay.copyText(text);
      notify('Reply copied.');
    } catch (error) {
      report('Could not copy the reply', error);
    }
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
    this.liveNode = undefined;
    const nodes: HTMLElement[] = [];
    for (const message of messages.slice(-20)) nodes.push(...this.turnNodes(message));
    if (!nodes.length) nodes.push(this.turnEmpty());
    if (this.busy && !liveReplyText(this.live).trim()) nodes.push(el('p', 'design-working', 'Working on it…'));
    this.turns.replaceChildren(...nodes);
    if (this.busy) this.renderLive();
    this.turns.scrollTop = this.turns.scrollHeight;
  }

  private turnNodes(message: ChatMessage): HTMLElement[] {
    const card = el('article', `design-turn ${message.role}`);
    card.append(el('span', 'design-turn-role', message.role === 'user' ? 'You' : 'Relay'));
    let tools: ToolPart[] = [];
    const said: string[] = [];
    const flush = (): void => {
      if (!tools.length) return;
      card.append(this.toolBlock(tools));
      tools = [];
    };
    for (const part of message.parts) {
      if (part.type === 'text') {
        flush();
        const text = message.role === 'user' ? rawDesignRequest(part.text) : part.text.trim();
        if (text) { card.append(el('p', '', text)); said.push(text); }
      } else if (part.type === 'tool') {
        tools.push(part);
      }
    }
    flush();
    if (message.error) card.append(el('p', 'design-turn-error', message.error));
    const text = said.join('\n\n');
    if (text) {
      const actions = el('div', 'design-turn-actions');
      if (message.role === 'user') {
        actions.append(button('Use again', () => {
          this.prompt.value = text;
          this.prompt.focus();
          this.prompt.setSelectionRange(text.length, text.length);
        }, 'design-turn-action'));
      } else if (message.role === 'assistant') {
        actions.append(button('Copy', () => void this.copyReply(text), 'design-turn-action'));
      }
      if (actions.childElementCount) card.append(actions);
    }
    return card.childElementCount > 1 ? [card] : [];
  }

  private toolBlock(parts: ToolPart[]): HTMLElement {
    const summary = stepperSummary(parts);
    const detail = el('details', 'tool-stepper design-stepper');
    detail.dataset.state = summary.state;
    detail.open = summary.state !== 'completed';
    const head = el('summary', 'stepper-head');
    head.append(
      el('span', 'stepper-glyph', summary.state === 'error' ? '!' : summary.state === 'running' ? '◌' : '✓'),
      el('span', 'stepper-title', summary.label),
      el('span', 'stepper-detail', summary.detail),
      el('span', 'disclosure', '›'),
    );
    detail.append(head);
    const files = editedFiles(parts);
    if (files.length) {
      const edits = el('div', 'design-edits');
      for (const path of files) edits.append(el('span', 'design-edit', path));
      detail.append(edits);
    }
    const list = el('ol', 'stepper-list');
    for (const part of parts) {
      const item = el('li', 'step');
      item.dataset.state = part.state;
      const step = el('details', 'step-detail');
      step.open = part.state === 'error';
      const stepHead = el('summary');
      stepHead.append(el('span', 'step-name', part.name), el('span', 'step-state', toolState(part.state)));
      step.append(stepHead);
      const body = el('div', 'step-body');
      if (part.input) body.append(el('pre', '', part.input.slice(0, 2000)));
      if (part.output) body.append(el('pre', '', part.output.slice(0, 2000)));
      if (!part.input && !part.output) {
        body.append(el('p', 'small muted', part.state === 'running' || part.state === 'pending' ? 'Waiting for output…' : 'No output was returned.'));
      }
      step.append(body);
      item.append(el('span', 'step-dot', part.state === 'error' ? '!' : part.state === 'completed' ? '✓' : ''), step);
      list.append(item);
    }
    detail.append(list);
    return detail;
  }

  private renderLive(): void {
    const text = liveReplyText(this.live).trim();
    if (!text || !this.busy) {
      if (this.liveNode) this.liveNode.hidden = true;
      return;
    }
    if (!this.liveNode) {
      this.liveNode = el('article', 'design-turn assistant design-live');
      this.liveNode.append(el('span', 'design-turn-role', 'Relay'), el('p'));
      this.turns.append(this.liveNode);
    }
    const line = this.liveNode.querySelector('p');
    if (line) line.textContent = text;
    this.liveNode.hidden = false;
    this.turns.scrollTop = this.turns.scrollHeight;
  }

  private turnEmpty(): HTMLElement {
    return el('p', 'design-turns-empty', 'Describe the page below. The agent writes it in the sandbox and the preview updates when it saves.');
  }

  /** Loads skills, plugins and connectors once, then keeps the design defaults selected. */
  private async ensureDesignTools(): Promise<void> {
    await this.loadTools();
    if (!this.slug || this.busy) return;
    this.applyDefaultSkills();
  }

  private async loadTools(): Promise<void> {
    if (this.toolsLoading) return this.toolsLoading;
    this.toolsLoading = (async () => {
      const [skills, plugins, connectors] = await Promise.all([
        window.relay.listSkills().catch(() => [] as SkillOption[]),
        window.relay.listPlugins().catch(() => [] as PluginView[]),
        window.relay.listMcp().catch(() => [] as McpServer[]),
      ]);
      this.skills = skills;
      this.plugins = plugins;
      this.connectors = connectors;
    })();
    return this.toolsLoading;
  }

  private applyDefaultSkills(): void {
    const known = new Set(this.skills.map((skill) => skill.id));
    const next = [...new Set([...this.selectedSkills.filter((id) => known.has(id)), ...defaultDesignSkills(this.skills)])];
    if (next.length === this.selectedSkills.length && next.every((id, index) => id === this.selectedSkills[index])) return;
    this.selectedSkills = next;
    this.renderChips();
  }

  private renderChips(): void {
    const nodes: HTMLElement[] = [];
    for (const file of this.files) {
      const chip = button(`▤ ${file.name} ×`, () => {
        this.files = this.files.filter((item) => item.path !== file.path);
        this.renderChips();
      }, 'attachment');
      chip.title = file.path;
      chip.setAttribute('aria-label', `Remove file ${file.name}`);
      nodes.push(chip);
    }
    for (const id of this.selectedSkills) {
      const name = this.skills.find((skill) => skill.id === id)?.name ?? id;
      const chip = button(`✦ ${name} ×`, () => {
        this.selectedSkills = this.selectedSkills.filter((item) => item !== id);
        this.renderChips();
      }, 'attachment');
      chip.setAttribute('aria-label', `Remove skill ${name}`);
      nodes.push(chip);
    }
    this.context.forEach((block, index) => {
      const chip = button(`↩ ${block.label} ×`, () => {
        this.context = this.context.filter((_, position) => position !== index);
        this.renderChips();
      }, 'attachment');
      chip.setAttribute('aria-label', `Remove context ${block.label}`);
      nodes.push(chip);
    });
    this.chips.replaceChildren(...nodes);
    this.renderSuggestions();
  }

  private addFile(path: string, name = path.split('/').pop() || path): boolean {
    if (this.files.some((file) => file.path === path)) return false;
    if (this.files.length >= DESIGN_MAX_FILES) { notify(`A design turn can carry up to ${DESIGN_MAX_FILES} files.`, true); return false; }
    this.files.push({ path, name });
    this.renderChips();
    return true;
  }

  private addSkill(id: string): boolean {
    if (this.selectedSkills.includes(id) || !this.skills.some((skill) => skill.id === id)) return false;
    this.selectedSkills.push(id);
    this.renderChips();
    return true;
  }

  private addContext(label: string, text: string): boolean {
    if (this.context.length >= DESIGN_MAX_CONTEXT) { notify(`A design turn can carry up to ${DESIGN_MAX_CONTEXT} context notes.`, true); return false; }
    this.context.push({ label, text });
    this.renderChips();
    return true;
  }

  private clearTools(): void {
    this.files = [];
    this.context = [];
    this.selectedSkills = [];
    this.renderChips();
  }

  private async pickFiles(): Promise<void> {
    if (!this.slug) return;
    try {
      const staged = await window.relay.pickAttachments();
      for (const file of staged) this.addFile(file.path, file.name);
      this.prompt.focus();
    } catch (error) {
      report('Could not attach the chosen files', error);
    }
  }

  /** Screenshots, dropped files and long pasted text become design references. */
  private pasteFiles(event: ClipboardEvent): void {
    const data = event.clipboardData;
    if (!data || !this.slug || this.busy) return;
    if (data.files?.length) {
      event.preventDefault();
      void this.attachFiles([...data.files]);
      return;
    }
    const linked = data.getData('text/uri-list').split('\n').map((line) => line.trim()).find((line) => line.startsWith('file://'));
    const path = linked ? pathFromFileURL(linked) : '';
    if (path) {
      event.preventDefault();
      void this.attachPaths([path]);
      return;
    }
    const text = data.getData('text/plain');
    if (text.length >= PASTE_ATTACH_CHARS) {
      event.preventDefault();
      void this.attachPastedText(text);
    }
  }

  private async attachFiles(files: File[]): Promise<void> {
    if (!this.slug) { notify('Open a design before attaching references.', true); return; }
    const room = DESIGN_MAX_FILES - this.files.length;
    if (room <= 0) { notify(`A design turn can carry up to ${DESIGN_MAX_FILES} files.`, true); return; }
    for (const file of files.slice(0, room)) {
      try {
        if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be smaller than 2 MB.');
        const path = window.relay.filePath(file);
        const staged = path
          ? await window.relay.stageAttachment({ path })
          : await window.relay.stageAttachment({ name: file.name || 'attachment', data: await fileData(file) });
        this.addFile(staged.path, staged.name);
      } catch (error) {
        report(`Could not attach ${file.name || 'this file'}`, error);
      }
    }
    this.prompt.focus();
  }

  private async attachPaths(paths: string[]): Promise<void> {
    if (!this.slug) return;
    const room = Math.max(0, DESIGN_MAX_FILES - this.files.length);
    for (const path of paths.slice(0, room)) {
      try {
        const staged = await window.relay.stageAttachment({ path });
        this.addFile(staged.path, staged.name);
      } catch (error) {
        report(`Could not attach ${path.split('/').pop() || 'this file'}`, error);
      }
    }
    this.prompt.focus();
  }

  private async attachPastedText(text: string): Promise<void> {
    if (!this.slug) return;
    try {
      const staged = await window.relay.stageAttachment({ name: `pasted-${Date.now().toString(36)}.txt`, text });
      this.addFile(staged.path, staged.name);
    } catch (error) {
      report('Could not attach the pasted text', error);
    }
  }

  private async pickSkills(): Promise<void> {
    if (!this.slug) return;
    await this.loadTools();
    const modal = dialog('Design skills');
    modal.add(el('p', '', 'Skills add craft guidance to this design turn. Mention any other installed skill with @ in the prompt.'));
    const defaults = new Set(defaultDesignSkills(this.skills));
    const ordered = [...this.skills.filter((skill) => defaults.has(skill.id)), ...this.skills.filter((skill) => !defaults.has(skill.id))].slice(0, 40);
    const list = el('div', 'design-skill-list');
    const paint = (): void => {
      list.replaceChildren(...ordered.map((skill) => {
        const selected = this.selectedSkills.includes(skill.id);
        const row = button('', () => {
          if (selected) this.selectedSkills = this.selectedSkills.filter((id) => id !== skill.id);
          else this.addSkill(skill.id);
          this.renderChips();
          paint();
        }, `design-skill-row${selected ? ' selected' : ''}`);
        row.append(
          el('span', 'design-skill-check', selected ? '✓' : '＋'),
          el('span', 'design-skill-name', skill.name),
          el('span', 'design-skill-desc', skill.description || ''),
        );
        return row;
      }));
    };
    if (!ordered.length) list.append(el('p', '', 'No skills are installed yet. Add one in Settings, then try again.'));
    else paint();
    modal.add(list);
  }

  private async pickConnectors(): Promise<void> {
    if (!this.slug) return;
    await this.loadTools();
    const modal = dialog('Tools & connectors');
    const enabled = this.connectors.filter((server) => server.enabled);
    if (!enabled.length) {
      modal.add(el('p', '', 'No connectors are configured. Add one in Settings to use its tools in a design turn.'));
      return;
    }
    modal.add(el('p', '', 'A connector note rides with this turn so the agent prefers its tools while designing.'));
    for (const server of enabled) {
      const row = button('', () => {
        const described = server.type === 'local'
          ? `Local connector running ${(server.command ?? []).join(' ') || server.name}`
          : `Remote connector at ${server.url ?? server.name}`;
        this.addContext(`Connector: ${server.name}`, `${described}. Its tools are available in this task — prefer them when they fit.`);
        modal.root.close();
        this.prompt.focus();
      }, 'design-connector-row');
      row.append(el('strong', '', server.name), el('span', 'small muted', server.type === 'local' ? (server.command ?? []).join(' ') : server.url ?? ''));
      modal.add(row);
    }
  }

  private plusActions(): PlusAction[] {
    return [
      { label: 'Attach files', hint: 'Files', icon: 'attach', run: () => this.pickFiles() },
      { label: 'Mention a file, skill or tool', hint: '@', icon: 'spark', run: () => this.startMention() },
      { label: 'Design skills', icon: 'book', run: () => this.pickSkills() },
      { label: 'Tools & connectors', icon: 'terminal', run: () => this.pickConnectors() },
      { label: 'Clear this turn', icon: 'sliders', divider: true, run: () => this.clearTools() },
    ];
  }

  private startMention(): void {
    const caret = this.prompt.selectionStart ?? this.prompt.value.length;
    const before = this.prompt.value.slice(0, caret);
    const spacer = before && !/\s$/.test(before) ? ' ' : '';
    this.prompt.value = `${before}${spacer}@${this.prompt.value.slice(caret)}`;
    const position = before.length + spacer.length + 1;
    this.prompt.setSelectionRange(position, position);
    this.prompt.focus();
    this.refreshMention();
  }

  private refreshMention(): void {
    if (this.prompt.disabled) return;
    const token = parseMentionToken(this.prompt.value, this.prompt.selectionStart ?? this.prompt.value.length);
    if (!token) { this.closeMention(); return; }
    void this.openMention(token.query);
  }

  private async openMention(query: string): Promise<void> {
    const generation = ++this.mentionGeneration;
    await this.loadTools();
    if (generation !== this.mentionGeneration) return;
    const files = await window.relay.searchFiles(query, 'files').catch(() => []);
    if (generation !== this.mentionGeneration) return;
    const design = new Set(defaultDesignSkills(this.skills));
    const designSkills = this.skills.filter((skill) => design.has(skill.id) || this.selectedSkills.includes(skill.id));
    const skills = designSkills.length ? designSkills : this.skills;
    const sources: MentionSource[] = [
      ...files.slice(0, 6).map((result) => ({
        kind: 'file' as const, id: result.path,
        name: result.path.split('/').pop() || result.path, detail: result.path, path: result.path,
      })),
      ...skills.filter((skill) => !this.selectedSkills.includes(skill.id)).map((skill) => ({
        kind: 'skill' as const, id: skill.id, name: skill.name, detail: skill.description || 'Skill', skillId: skill.id,
      })),
      ...this.plugins.map((plugin) => ({
        kind: 'plugin' as const, id: plugin.id, name: plugin.name,
        detail: plugin.description || `v${plugin.version}`,
        pluginSkills: plugin.capabilities.skills.map((id) => ({ id, name: this.skills.find((skill) => skill.id === id)?.name ?? id })),
      })),
      ...this.connectors.filter((server) => server.enabled).map((server) => ({
        kind: 'connector' as const, id: server.name, name: server.name,
        detail: server.type === 'local' ? (server.command ?? []).join(' ') : server.url ?? '',
        connector: {
          name: server.name, type: server.type,
          ...(server.command ? { command: server.command } : {}),
          ...(server.url ? { url: server.url } : {}),
        },
      })),
    ];
    const matches = filterMentionables(sources, query);
    if (!matches.length) { this.closeMention(); return; }
    this.mentionSources = matches;
    this.mentionIndex = Math.min(this.mentionIndex, matches.length - 1);
    this.mentionOpen = true;
    this.renderMention();
  }

  private renderMention(): void {
    const labels: Record<MentionSource['kind'], string> = {
      atlas: 'Atlas', knowledge: 'Knowledge', file: 'Files', skill: 'Skills', plugin: 'Plugins', agent: 'Agents', connector: 'Connectors',
    };
    const rows: HTMLElement[] = [];
    let lastKind = '';
    this.mentionSources.forEach((source, index) => {
      if (source.kind !== lastKind) {
        lastKind = source.kind;
        rows.push(el('p', 'mention-label', labels[source.kind]));
      }
      const item = button('', () => this.chooseMention(source), `command-option${index === this.mentionIndex ? ' active' : ''}`);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === this.mentionIndex));
      item.append(el('span', 'command-name', source.name), el('span', 'command-description', source.detail || source.kind));
      item.addEventListener('mousedown', (event) => event.preventDefault());
      rows.push(item);
    });
    this.mentionMenu.replaceChildren(...rows);
    this.mentionMenu.hidden = false;
    this.mentionMenu.querySelectorAll('button')[this.mentionIndex]?.scrollIntoView({ block: 'nearest' });
  }

  private moveMention(delta: number): void {
    if (!this.mentionSources.length) return;
    this.mentionIndex = (this.mentionIndex + delta + this.mentionSources.length) % this.mentionSources.length;
    this.renderMention();
  }

  private closeMention(): void {
    this.mentionOpen = false;
    this.mentionSources = [];
    this.mentionIndex = 0;
    this.mentionGeneration++;
    this.mentionMenu.hidden = true;
  }

  private chooseMention(source: MentionSource): void {
    const caret = this.prompt.selectionStart ?? this.prompt.value.length;
    const token = parseMentionToken(this.prompt.value, caret);
    if (token) this.prompt.value = this.prompt.value.slice(0, token.start) + this.prompt.value.slice(Math.min(token.end, this.prompt.value.length));
    this.closeMention();
    if (source.kind === 'file' && source.path) {
      this.addFile(source.path);
    } else if (source.kind === 'skill' && source.skillId) {
      this.addSkill(source.skillId);
    } else if (source.kind === 'plugin') {
      const attachable = (source.pluginSkills ?? []).map((skill) => skill.id).filter((id) => this.skills.some((skill) => skill.id === id));
      if (!attachable.length) notify('This plugin has no skills to attach to a design turn.', true);
      for (const id of attachable) this.addSkill(id);
    } else if (source.kind === 'connector' && source.connector) {
      const server = source.connector;
      const described = server.type === 'local'
        ? `Local connector running ${(server.command ?? []).join(' ') || server.name}`
        : `Remote connector at ${server.url ?? server.name}`;
      this.addContext(`Connector: ${server.name}`, `${described}. Its tools are available in this task — prefer them when they fit.`);
    }
    this.renderChips();
    this.prompt.focus();
  }

  private async send(): Promise<void> {
    if (!this.slug) return;
    const request = this.prompt.value.trim();
    if (!request) return;
    if (this.editing) await this.saveEditIfChanged();
    const turn: DesignTurn = {
      request,
      files: this.files.map((file) => ({ path: file.path, name: file.name })),
      skills: [...this.selectedSkills],
      context: [...this.context],
    };
    this.closeMention();
    this.clearComposer();
    if (this.busy) {
      this.queued.push(turn);
      this.renderQueue();
      notify(this.queued.length === 1 ? 'Queued — it sends when this turn finishes.' : `Queued — ${this.queued.length} messages are waiting.`);
      this.prompt.focus();
      return;
    }
    await this.run(turn);
  }

  /** Sends one turn; the composer stays usable and later messages wait in the queue. */
  private async run(turn: DesignTurn): Promise<void> {
    if (!this.slug || this.dispatching) return;
    const slug = this.slug;
    this.dispatching = true;
    this.busy = true;
    this.live = undefined;
    this.liveNode = undefined;
    this.syncBusy();
    try {
      const result = await window.relay.designSend(slug, turn.request, {
        files: turn.files.map((file) => file.path),
        skills: turn.skills,
        context: turn.context,
      });
      this.sessionId = result.sessionId;
      this.renderVersions();
      notify('Designing — the preview updates as the agent saves.');
      void this.loadTurns();
    } catch (error) {
      this.busy = false;
      if (!this.prompt.value.trim()) {
        this.prompt.value = turn.request;
        this.files = turn.files;
        this.context = turn.context;
        this.selectedSkills = turn.skills;
        this.renderChips();
      }
      this.syncBusy();
      report('Could not start the design turn', error);
    } finally {
      this.dispatching = false;
      if (!this.busy) this.drainQueue();
      else this.renderQueue();
    }
  }

  private clearComposer(): void {
    this.prompt.value = '';
    this.files = [];
    this.context = [];
    this.selectedSkills = [];
    this.renderChips();
  }

  private drainQueue(): void {
    if (this.busy || this.dispatching || !this.slug) { this.renderQueue(); return; }
    const next = this.queued.shift();
    this.renderQueue();
    if (next) void this.run(next);
  }

  private renderQueue(): void {
    if (!this.queued.length) {
      this.queueNode.hidden = true;
      this.queueNode.replaceChildren();
      return;
    }
    const count = this.queued.length;
    const label = count === 1 ? '1 message queued — sends when this turn finishes.' : `${count} messages queued — they send when this turn finishes.`;
    const clear = button('Clear', () => { this.queued = []; this.renderQueue(); }, 'design-queue-clear');
    clear.title = 'Remove the queued messages';
    this.queueNode.replaceChildren(el('span', '', label), clear);
    this.queueNode.hidden = false;
  }

  private async cancel(): Promise<void> {
    if (!this.slug) return;
    this.queued = [];
    this.renderQueue();
    try {
      const stopped = await window.relay.designCancel(this.slug);
      notify(stopped ? 'Stopped — send a new direction whenever you like.' : 'Nothing was running.');
    } catch (error) {
      report('Could not stop the design turn', error);
    } finally {
      this.busy = false;
      this.live = undefined;
      this.liveNode = undefined;
      this.syncBusy();
      void this.loadTurns();
    }
  }

  private async create(kind: DesignKind = 'page'): Promise<void> {
    const choice = await this.askNewDesign(kind);
    if (!choice) return;
    try {
      const view = await window.relay.designCreate(choice.name, kind === 'page' ? undefined : kind);
      const slug = view.designs.find((design) => design.slug === designSlug(choice.name))?.slug ?? view.designs[0]?.slug;
      this.view = view;
      if (!slug) { this.consume(view); return; }
      this.mode = 'workspace';
      this.slug = slug;
      this.sessionId = view.designs.find((design) => design.slug === slug)?.sessionId;
      this.applyMode();
      void this.loadVersions();
      void this.loadTurns();
      void this.ensureDesignTools();
      this.consume(view);
      if (choice.template) {
        this.prompt.value = choice.template.brief;
        notify(`${choice.template.name} template ready — edit the brief, then Generate.`);
      }
      this.prompt.focus();
    } catch (error) {
      report('Could not create the design', error);
    }
  }

  private askNewDesign(kind: DesignKind = 'page'): Promise<{ name: string; template?: DesignTemplate } | undefined> {
    return new Promise((resolve) => {
      const label = kind === 'slides' ? 'slide deck' : kind === 'board' ? 'whiteboard' : 'design';
      const modal = dialog(kind === 'slides' ? 'New slide deck' : kind === 'board' ? 'New whiteboard' : 'New design');
      let picked = '';
      const input = el('input');
      input.placeholder = kind === 'slides' ? 'Series A deck' : kind === 'board' ? 'Onboarding flow' : 'Checkout flow';
      input.maxLength = 80;
      input.required = true;
      const cards: Array<{ template: DesignTemplate; card: HTMLButtonElement }> = [];
      const paint = (): void => {
        for (const entry of cards) entry.card.classList.toggle('selected', entry.template.id === picked);
      };
      for (const template of DESIGN_TEMPLATES) {
        const card = button('', () => {
          picked = picked === template.id ? '' : template.id;
          if (!input.value.trim() && picked) input.value = template.name;
          paint();
        }, 'design-template-card');
        card.append(el('strong', '', template.name), el('span', '', template.summary));
        cards.push({ template, card });
      }
      const grid = el('div', 'design-template-grid');
      grid.append(...cards.map((entry) => entry.card));
      const form = el('form');
      const submit = el('button', 'button primary', 'Create');
      submit.type = 'submit';
      const actions = el('div', 'dialog-actions');
      actions.append(button('Cancel', () => { resolve(undefined); modal.root.close(); }), submit);
      form.append(field(`${kind === 'page' ? 'Design' : kind === 'slides' ? 'Deck' : 'Board'} name`, input, 'Letters and numbers; this becomes the folder name.'), actions);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        resolve({ name: value, ...(picked ? { template: designTemplate(picked) } : {}) });
        modal.root.close();
      });
      modal.add(
        el('p', '', kind === 'slides'
          ? 'Name the deck, then describe it in the prompt box. The agent lays it out as slides you can walk with the arrow keys.'
          : kind === 'board'
            ? 'Name the board, then describe it in the prompt box. The agent sketches on a pannable canvas you can zoom.'
            : 'Start from a template or write your own prompt. Templates fill the brief; nothing is generated until you press Generate.'),
        ...(kind === 'page' ? [el('p', 'small muted', 'Templates'), grid] : []),
        form,
      );
      input.setAttribute('aria-label', `${label} name`);
      input.focus();
    });
  }

  private async saveVersion(): Promise<void> {
    if (!this.slug) return;
    if (this.editing) await this.saveEditIfChanged();
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
    this.finishEdit();
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
    if (this.editing) await this.saveEditIfChanged();
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
    const readSystem = (): DesignSystem => ({
      version: 1, name: name.value, notes: notes.value,
      colors: Object.fromEntries(colorInputs.map((entry) => [entry.role, entry.input.value])) as unknown as DesignColors,
      type: {
        heading: heading.value, body: bodyFont.value, mono: mono.value,
        base: Number(base.value), scale: Number(scale.value),
      },
      shape: { space: Number(space.value), radius: Number(radius.value), shadow: shadow.value },
    });
    const writeSystem = (next: DesignSystem): void => {
      for (const entry of colorInputs) entry.input.value = next.colors[entry.role];
      heading.value = next.type.heading;
      bodyFont.value = next.type.body;
      mono.value = next.type.mono;
      base.value = String(next.type.base);
      scale.value = String(next.type.scale);
      space.value = String(next.shape.space);
      radius.value = String(next.shape.radius);
      shadow.value = next.shape.shadow;
      notes.value = next.notes;
    };
    const presets = el('div', 'design-presets');
    for (const preset of DESIGN_SYSTEM_PRESETS) {
      const chip = button('', () => writeSystem(applyDesignSystemPreset(readSystem(), preset)), 'design-preset');
      chip.title = preset.summary;
      chip.append(el('strong', '', preset.name), el('span', '', preset.summary));
      presets.append(chip);
    }
    const actions = el('div', 'dialog-actions');
    const submit = el('button', 'button primary', 'Save');
    submit.type = 'submit';
    actions.append(button('Cancel', () => modal.root.close()), submit);
    const colorsBox = el('div', 'design-colors');
    colorsBox.append(...colorInputs.map((entry) => entry.label));

    const picker = el('select');
    picker.setAttribute('aria-label', 'Design system for this design');
    picker.addEventListener('change', () => {
      const slug = this.slug;
      if (!slug) return;
      void run(picker, async () => {
        try {
          this.view = await window.relay.designSetSystem(slug, picker.value);
          this.renderGrid();
          this.loadPreview(true);
        } catch (error) {
          picker.value = this.active?.systemId ?? '';
          modal.fail(error);
        }
      });
    });
    const library = el('div', 'design-library');
    const drawLibrary = (): void => {
      const systems = this.view?.systems ?? [];
      const bound = this.mode === 'workspace' ? this.active?.systemId ?? '' : '';
      picker.replaceChildren(new Option('Project system', ''));
      for (const entry of systems) picker.append(new Option(entry.name, entry.id));
      picker.value = systems.some((entry) => entry.id === bound) ? bound : '';
      library.replaceChildren();
      if (!systems.length) {
        library.append(el('p', 'small muted', 'No saved systems yet. Save one to reuse it on other designs.'));
        return;
      }
      for (const entry of systems) {
        const row = el('div', 'design-library-row');
        const label = el('span', 'design-library-name', entry.name);
        if (entry.id === bound) label.classList.add('bound');
        const remove = button('Delete', async () => {
          const accepted = await confirmAction('Delete design system', `“${entry.name}” is removed from the library. Designs using it fall back to the project system.`, 'Delete');
          if (!accepted) return;
          this.view = await window.relay.designDeleteSystem(entry.id);
          drawLibrary();
          this.renderGrid();
          this.loadPreview(true);
          notify(`Deleted “${entry.name}”.`);
        }, 'button small danger');
        remove.setAttribute('aria-label', `Delete ${entry.name}`);
        row.append(label, remove);
        library.append(row);
      }
    };
    drawLibrary();
    const saveToLibrary = button('Save as a library system', async () => {
      const next = readSystem();
      if (!next.name.trim()) { modal.fail(new Error('Name a system before saving it to the library.')); return; }
      this.view = await window.relay.saveLibrarySystem(next);
      drawLibrary();
      this.renderGrid();
      notify(`Saved “${next.name.trim()}” to the library.`);
    }, 'button small');
    const libraryBox = el('section', 'design-library-box');
    libraryBox.append(
      el('p', 'small muted', 'Library'),
      this.mode === 'workspace' ? field('Design system for this design', picker, 'Binding a library system overrides the project system for this design only.') : el('p', 'small muted', 'Open a design to bind a system to it.'),
      library,
      saveToLibrary,
    );

    form.append(
      el('p', 'small muted', 'Presets'),
      presets,
      libraryBox,
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
      const next = readSystem();
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
