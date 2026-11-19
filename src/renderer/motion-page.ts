import { byId, button, el, field, notify, report } from './dom';
import { confirmAction, dialog } from './dialog';
import type { ChatMessage, ModelOption } from '../shared/contracts';
import type { MotionEntry, MotionStage, MotionVersion, MotionView } from '../shared/motion';
import { MOTION_STAGE_SIZE, motionClock, motionEvent, motionSlug } from '../shared/motion';
import { chosenModelLabel, groupModels } from './model-menu';

type Mode = 'home' | 'workspace';
type Sort = 'recent' | 'name';

interface MotionPageOptions {
  openTask: (sessionId: string) => void;
  /** A motion and its task were removed; task lists need a refresh. */
  deleted: () => void;
}

const stamp = (ms: number): string => ms
  ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'Saved earlier';

const stageLabel = (stage: MotionStage): string => stage === 'landscape' ? '16:9' : '9:16';

function textOf(message: ChatMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; id: string; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export class MotionPage {
  private page = byId('motion');
  private title = byId('motion-title');
  private summary = byId('motion-summary');
  private home = byId('motion-home');
  private workspacePage = byId('motion-workspace');
  private backButton = byId<HTMLButtonElement>('motion-back');
  private modelButton = byId<HTMLButtonElement>('motion-model');
  private modelMenu = byId('motion-model-menu');
  private grid = byId('motion-items');
  private sortButton = byId<HTMLButtonElement>('motion-sort');
  private frame = byId('motion-stage-frame');
  private preview = byId<HTMLIFrameElement>('motion-stage-preview');
  private transport = byId('motion-transport');
  private stageEmpty = byId('motion-stage-empty');
  private playButton = byId<HTMLButtonElement>('motion-play');
  private restartButton = byId<HTMLButtonElement>('motion-restart');
  private loopButton = byId<HTMLButtonElement>('motion-loop');
  private scrub = byId<HTMLInputElement>('motion-scrub');
  private clock = byId('motion-time');
  private turns = byId('motion-turns');
  private prompt = byId<HTMLTextAreaElement>('motion-prompt');
  private form = byId<HTMLFormElement>('motion-prompt-form');
  private sendButton = byId<HTMLButtonElement>('motion-send');
  private cancelButton = byId<HTMLButtonElement>('motion-cancel');
  private versionsSelect = byId<HTMLSelectElement>('motion-versions');
  private restoreButton = byId<HTMLButtonElement>('motion-restore');
  private exportButton = byId<HTMLButtonElement>('motion-export');
  private lazy: IntersectionObserver;
  private cardSizer: ResizeObserver;
  private stageSizer: ResizeObserver;
  private view?: MotionView;
  private mode: Mode = 'home';
  private slug?: string;
  private workspaceId?: string;
  private sessionId?: string;
  private versions: MotionVersion[] = [];
  private sort: Sort = 'recent';
  private stage: MotionStage = 'portrait';
  private opened = false;
  private enabled = false;
  private busy = false;
  private duration = 0;
  private time = 0;
  private playing = false;
  private loop = false;
  private scrubbing = false;
  private syncedLoop = false;
  private gridSignature = '';
  private generation = 0;
  private reloadStamp = 0;
  private turnRequest = 0;
  private lastPreviewKey = '';
  private models: ModelOption[] = [];
  private modelMenuOpen = false;
  private exporting?: number;

  constructor(private readonly options: MotionPageOptions) {
    this.form.addEventListener('submit', (event) => { event.preventDefault(); void this.send(); });
    this.prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    });
    byId('motion-stage-portrait').addEventListener('click', () => void this.setStage('portrait'));
    byId('motion-stage-landscape').addEventListener('click', () => void this.setStage('landscape'));
    byId('motion-new').addEventListener('click', () => void this.create());
    this.backButton.addEventListener('click', () => this.back());
    this.sortButton.addEventListener('click', () => this.toggleSort());
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
    byId('motion-save-version').addEventListener('click', () => void this.saveVersion());
    this.exportButton.addEventListener('click', () => void this.exportVideo());
    byId('motion-reload').addEventListener('click', () => this.loadPreview(true));
    byId('motion-reveal').addEventListener('click', () => void this.reveal());
    this.restoreButton.addEventListener('click', () => void this.restore());
    this.cancelButton.addEventListener('click', () => void this.cancel());
    this.versionsSelect.addEventListener('change', () => {
      this.restoreButton.disabled = !this.versionsSelect.value || this.busy;
    });
    this.playButton.addEventListener('click', () => this.command('toggle'));
    this.restartButton.addEventListener('click', () => this.command('restart'));
    this.loopButton.addEventListener('click', () => {
      this.loop = !this.loop;
      this.command('loop', { loop: this.loop });
      this.renderTransport();
    });
    this.scrub.addEventListener('pointerdown', () => this.command('pause'));
    this.scrub.addEventListener('input', () => {
      this.scrubbing = true;
      this.seekTo(Number(this.scrub.value));
    });
    this.scrub.addEventListener('change', () => { this.scrubbing = false; });
    this.preview.addEventListener('load', () => { this.syncedLoop = false; this.fitStage(); });
    window.addEventListener('message', (event) => this.noteMessage(event));
    this.lazy = this.observeCards();
    this.cardSizer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const shot = entry.target as HTMLElement;
        const frame = shot.querySelector('iframe');
        if (frame) this.fitCard(shot, frame);
      }
    });
    this.stageSizer = new ResizeObserver(() => this.fitStage());
    this.stageSizer.observe(this.frame);
  }

  get isOpen(): boolean { return this.opened; }

  get inWorkspace(): boolean { return this.mode === 'workspace'; }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
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
    byId('app').classList.add('motion-open');
    this.applyMode();
    void this.refresh();
    byId('motion-close').focus();
  }

  /** Opens the workspace for one motion; used by cards and by motion tasks in the sidebar. */
  openAt(slug: string): void {
    if (!this.enabled) return;
    if (this.opened && this.mode === 'workspace' && this.slug === slug) { void this.refresh(); return; }
    this.mode = 'workspace';
    this.slug = slug;
    this.sessionId = undefined;
    this.versions = [];
    this.show();
  }

  back(): void {
    if (this.mode !== 'workspace') return;
    this.command('pause');
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
    this.command('pause');
    this.opened = false;
    this.page.hidden = true;
    byId('app').classList.remove('motion-open');
    this.closeModelMenu();
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

  /** Fresh data pushed from the main process after a turn, snapshot or stage change. */
  consume(view: MotionView): void {
    this.view = view;
    if (this.mode === 'workspace' && this.slug && !view.motions.some((motion) => motion.slug === this.slug)) {
      this.slug = view.motions[0]?.slug;
      this.sessionId = this.slug ? this.active?.sessionId : undefined;
      this.versions = [];
      if (!this.slug) { this.mode = 'home'; this.busy = false; }
    }
    if (this.mode === 'workspace' && this.slug) {
      this.sessionId = this.active?.sessionId ?? this.sessionId;
      this.stage = this.active?.stage ?? this.stage;
    }
    if (this.mode === 'home') this.renderGrid();
    this.renderVersions();
    this.applyMode();
    if (this.busy) void this.loadTurns();
  }

  /** Called for every session event; keeps the stage honest while the motion task works. */
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

  private get active(): MotionEntry | undefined { return this.view?.motions.find((motion) => motion.slug === this.slug); }

  async refresh(): Promise<void> {
    if (!this.enabled) return;
    const generation = ++this.generation;
    try {
      const view = await window.relay.motionView();
      if (generation !== this.generation) return;
      this.view = view;
      if (this.mode === 'workspace') {
        if (!this.slug || !view.motions.some((motion) => motion.slug === this.slug)) this.slug = view.motions[0]?.slug;
        if (!this.slug) this.mode = 'home';
      }
      if (this.mode === 'workspace' && this.slug) {
        this.sessionId = this.active?.sessionId;
        this.stage = this.active?.stage ?? 'portrait';
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
      this.summary.textContent = 'Motions could not be loaded. Close and reopen the page to retry.';
      report('Could not load motions', error);
    }
  }

  private applyMode(): void {
    const workspace = this.mode === 'workspace';
    this.home.hidden = workspace;
    this.workspacePage.hidden = !workspace;
    this.backButton.hidden = !workspace;
    this.modelButton.hidden = !workspace;
    if (!workspace) this.closeModelMenu();
    this.applyText();
    this.syncStage();
  }

  private renderModelLabel(): void {
    const chosen = this.active?.model ?? '';
    this.modelButton.textContent = chosenModelLabel(this.models, chosen);
    this.modelButton.title = chosen
      ? `Model for this motion: ${this.modelButton.textContent}`
      : 'Model for this motion: Auto picks the best available';
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
      this.view = await window.relay.motionSetModel(slug, id);
      this.renderModelLabel();
      notify(id ? `Motion model set to ${chosenModelLabel(this.models, id)}` : 'Motion model set to Auto');
    } catch (error) {
      report('The motion model was not saved', error);
    }
  }

  private applyText(): void {
    const motions = this.view?.motions ?? [];
    if (this.mode === 'workspace') {
      const motion = this.active;
      this.title.textContent = motion?.title ?? 'Motion';
      this.summary.textContent = motion
        ? `${motion.versions} ${motion.versions === 1 ? 'version' : 'versions'} · saved ${stamp(motion.updatedAt)} · ${stageLabel(this.stage)} · .relay/motion/${motion.slug}/`
        : this.slug ? 'Loading this motion…' : 'This motion is no longer in the project.';
    } else {
      this.title.textContent = 'Motion';
      this.summary.textContent = motions.length
        ? `${motions.length} ${motions.length === 1 ? 'motion' : 'motions'} in this project. Open one to scrub the timeline, or make something new.`
        : 'Animated scenes for this project — written as code, played on a real timeline.';
    }
  }

  private toggleSort(): void {
    this.sort = this.sort === 'recent' ? 'name' : 'recent';
    this.sortButton.textContent = `Sort: ${this.sort === 'recent' ? 'Recent' : 'Name'}`;
    this.gridSignature = '';
    this.renderGrid();
  }

  private sortedMotions(): MotionEntry[] {
    const motions = [...(this.view?.motions ?? [])];
    return motions.sort((a, b) => this.sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt);
  }

  private observeCards(): IntersectionObserver {
    return new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const shot = entry.target as HTMLElement;
        this.lazy.unobserve(shot);
        const slug = shot.dataset.slug;
        const frame = shot.querySelector('iframe');
        if (!slug || !frame) continue;
        this.fitCard(shot, frame);
        if (!frame.getAttribute('src')) frame.src = `relay-motion://preview/${slug}/index.html`;
      }
    }, { root: this.home, rootMargin: '240px 0px' });
  }

  private renderGrid(): void {
    if (this.mode !== 'home') return;
    const motions = this.sortedMotions();
    const signature = `${this.sort}::${motions.map((motion) => `${motion.slug}:${motion.title}:${motion.versions}:${motion.updatedAt}:${motion.stage}`).join(',')}`;
    if (signature === this.gridSignature) return;
    this.gridSignature = signature;
    this.lazy.disconnect();
    this.lazy = this.observeCards();
    this.cardSizer.disconnect();
    if (!motions.length) {
      const empty = el('div', 'design-empty');
      empty.append(
        el('h3', '', 'No motion yet'),
        el('p', '', 'Describe a scene and Relay builds it in .relay/motion, plays it on a seekable timeline, and versions every turn.'),
        button('Create a motion', () => void this.create(), 'button primary'),
      );
      this.grid.replaceChildren(empty);
      return;
    }
    this.grid.replaceChildren(...motions.map((motion, index) => this.card(motion, index)));
  }

  private card(motion: MotionEntry, index: number): HTMLElement {
    const stage = motion.stage ?? 'portrait';
    const card = el('article', 'design-card');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Open ${motion.title}`);
    card.style.animationDelay = `${Math.min(index, 12) * 24}ms`;
    const shot = el('div', 'design-card-shot motion-card-shot');
    shot.dataset.slug = motion.slug;
    shot.dataset.stage = stage;
    const frame = document.createElement('iframe');
    frame.className = 'motion-card-frame';
    frame.title = `${motion.title} preview`;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('scrolling', 'no');
    shot.append(frame, el('span', 'motion-card-stage', stageLabel(stage)));
    const foot = el('div', 'design-card-foot');
    const copy = el('div', 'design-card-copy');
    copy.append(
      el('strong', 'design-card-name', motion.title),
      el('span', 'design-card-meta', `${motion.versions} ${motion.versions === 1 ? 'version' : 'versions'} · ${stamp(motion.updatedAt)}`),
    );
    const more = el('button', 'icon-button design-card-more', '⋯');
    more.type = 'button';
    more.title = `Actions for ${motion.title}`;
    more.setAttribute('aria-label', `Actions for ${motion.title}`);
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      this.menu(motion);
    });
    foot.append(copy, more);
    card.append(shot, foot);
    card.addEventListener('click', () => this.openAt(motion.slug));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.openAt(motion.slug);
    });
    this.cardSizer.observe(shot);
    this.lazy.observe(shot);
    return card;
  }

  private fitCard(shot: HTMLElement, frame: HTMLIFrameElement): void {
    const size = MOTION_STAGE_SIZE[shot.dataset.stage === 'landscape' ? 'landscape' : 'portrait'];
    const width = shot.clientWidth || 1;
    const height = shot.clientHeight || 1;
    const scale = Math.min(width / size.width, height / size.height);
    frame.style.width = `${size.width}px`;
    frame.style.height = `${size.height}px`;
    frame.style.transform = `scale(${scale})`;
    frame.style.left = `${Math.max(0, (width - size.width * scale) / 2)}px`;
    frame.style.top = `${Math.max(0, (height - size.height * scale) / 2)}px`;
  }

  private menu(motion: MotionEntry): void {
    const modal = dialog(motion.title);
    modal.add(el('p', 'small muted', `${motion.versions} ${motion.versions === 1 ? 'version' : 'versions'} · ${stamp(motion.updatedAt)} · ${stageLabel(motion.stage ?? 'portrait')}`));
    modal.add(button('Open motion', () => { modal.root.close(); this.openAt(motion.slug); }));
    modal.add(button('Show folder', async () => {
      modal.busy(true);
      try {
        await window.relay.motionReveal(motion.slug);
        modal.root.close();
      } catch (error) { modal.fail(error); }
      finally { modal.busy(false); }
    }));
    modal.add(button('Delete motion', async () => {
      const accepted = await confirmAction(
        'Delete this motion?',
        `“${motion.title}” is removed with its versions and its task. Files outside .relay/motion are not touched.`,
        'Delete motion',
      );
      if (!accepted) return;
      modal.busy(true);
      try {
        const view = await window.relay.motionDelete(motion.slug);
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
      const versions = await window.relay.motionVersions(slug);
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
    this.transport.hidden = !ready;
    this.stageEmpty.hidden = ready;
    byId<HTMLButtonElement>('motion-save-version').disabled = !ready || this.busy;
    byId<HTMLButtonElement>('motion-reload').disabled = !ready;
    byId<HTMLButtonElement>('motion-reveal').disabled = !ready;
    this.noteExport(this.exporting);
    byId('motion-stage-portrait').setAttribute('aria-pressed', String(this.stage === 'portrait'));
    byId('motion-stage-landscape').setAttribute('aria-pressed', String(this.stage === 'landscape'));
    this.syncBusy();
    if (ready) {
      this.loadPreview();
      requestAnimationFrame(() => this.fitStage());
    } else {
      this.preview.removeAttribute('src');
    }
  }

  private syncBusy(): void {
    this.sendButton.disabled = this.busy || !this.slug;
    this.cancelButton.hidden = !this.busy;
    this.prompt.disabled = this.busy;
    this.versionsSelect.disabled = this.busy || !this.versions.length;
    this.noteExport(this.exporting);
  }

  private fitStage(): void {
    if (!this.slug || this.mode !== 'workspace' || this.frame.hidden) return;
    const size = MOTION_STAGE_SIZE[this.stage];
    const box = this.frame.getBoundingClientRect();
    const width = Math.max(0, box.width - 28);
    const height = Math.max(0, box.height - 28);
    if (!width || !height) return;
    const scale = Math.min(width / size.width, height / size.height);
    this.preview.style.width = `${Math.round(size.width * scale)}px`;
    this.preview.style.height = `${Math.round(size.height * scale)}px`;
  }

  private loadPreview(force = false): void {
    if (!this.slug) return;
    const motion = this.active;
    const key = motion ? `${motion.slug}:${motion.versions}:${motion.updatedAt}` : '';
    if (!force && key && key === this.lastPreviewKey && this.preview.getAttribute('src')) return;
    this.lastPreviewKey = key;
    this.duration = 0;
    this.time = 0;
    this.playing = false;
    this.renderTransport();
    const target = new URL(`relay-motion://preview/${this.slug}/index.html`);
    target.searchParams.set('v', String(++this.reloadStamp));
    this.preview.src = target.toString();
  }

  /** The stage reports its duration, clock, play state and errors while it plays. */
  private noteMessage(event: MessageEvent): void {
    if (event.source !== this.preview.contentWindow || !this.slug) return;
    const message = motionEvent(event.data);
    if (!message) return;
    if (message.type === 'info') {
      this.duration = message.duration;
      if (!this.syncedLoop) {
        this.syncedLoop = true;
        this.command('loop', { loop: this.loop });
      }
      this.renderTransport();
    } else if (message.type === 'time') {
      this.time = message.time;
      this.playing = message.playing;
      this.renderTransport();
    } else if (message.type === 'state') {
      this.playing = message.playing;
      this.renderTransport();
    } else {
      this.playing = false;
      this.renderTransport();
      notify(`The scene stopped: ${message.message}`, true);
    }
  }

  private command(type: 'play' | 'pause' | 'toggle' | 'restart' | 'loop', extra: Record<string, unknown> = {}): void {
    this.preview.contentWindow?.postMessage({ relayMotionCommand: type, ...extra }, '*');
  }

  private seekTo(value: number): void {
    if (!this.duration) return;
    const time = Math.min(this.duration, Math.max(0, (value / 1000) * this.duration));
    this.time = time;
    this.renderClock();
    this.preview.contentWindow?.postMessage({ relayMotionSeek: time }, '*');
  }

  private renderTransport(): void {
    this.playButton.textContent = this.playing ? '⏸' : '▶';
    this.playButton.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    this.playButton.title = this.playing ? 'Pause' : 'Play';
    this.loopButton.setAttribute('aria-pressed', String(this.loop));
    this.scrub.disabled = !this.slug || this.duration <= 0;
    if (!this.scrubbing) this.scrub.value = String(this.duration ? Math.round((this.time / this.duration) * 1000) : 0);
    this.renderClock();
  }

  private renderClock(): void {
    this.clock.textContent = `${motionClock(this.time)} / ${motionClock(this.duration)}`;
  }

  private async setStage(stage: MotionStage): Promise<void> {
    const slug = this.slug;
    if (!slug || this.stage === stage) return;
    this.stage = stage;
    this.syncStage();
    this.applyText();
    try {
      this.view = await window.relay.motionSetStage(slug, stage);
      this.gridSignature = '';
    } catch (error) {
      this.stage = stage === 'landscape' ? 'portrait' : 'landscape';
      this.syncStage();
      report('The stage was not saved', error);
    }
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
      report('Could not load motion turns', error);
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
    return el('p', 'design-turns-empty', 'Describe the scene below. The agent writes it in the sandbox and the stage plays it when it saves.');
  }

  private async send(): Promise<void> {
    if (!this.slug || this.busy) return;
    const request = this.prompt.value.trim();
    if (!request) return;
    this.busy = true;
    this.syncBusy();
    this.turns.append(el('p', 'design-working', 'Working on it…'));
    try {
      const result = await window.relay.motionSend(this.slug, request);
      this.sessionId = result.sessionId;
      this.prompt.value = '';
      this.renderVersions();
      notify('Directing — the stage updates when the agent saves.');
      void this.loadTurns();
    } catch (error) {
      this.busy = false;
      this.syncBusy();
      report('Could not start the motion turn', error);
    }
  }

  private async cancel(): Promise<void> {
    if (!this.slug) return;
    try {
      await window.relay.motionCancel(this.slug);
    } catch (error) {
      report('Could not stop the motion turn', error);
    }
  }

  private async create(): Promise<void> {
    const name = await this.askName();
    if (!name) return;
    try {
      const view = await window.relay.motionCreate(name);
      const slug = view.motions.find((motion) => motion.slug === motionSlug(name))?.slug ?? view.motions[0]?.slug;
      this.view = view;
      if (!slug) { this.consume(view); return; }
      this.mode = 'workspace';
      this.slug = slug;
      this.sessionId = view.motions.find((motion) => motion.slug === slug)?.sessionId;
      this.stage = view.motions.find((motion) => motion.slug === slug)?.stage ?? 'portrait';
      this.applyMode();
      void this.loadVersions();
      void this.loadTurns();
      this.consume(view);
      this.prompt.focus();
    } catch (error) {
      report('Could not create the motion', error);
    }
  }

  private askName(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const modal = dialog('New motion');
      const input = el('input');
      input.placeholder = 'Product launch';
      input.maxLength = 80;
      input.required = true;
      const form = el('form');
      const submit = el('button', 'button primary', 'Create');
      submit.type = 'submit';
      const actions = el('div', 'dialog-actions');
      actions.append(button('Cancel', () => { resolve(undefined); modal.root.close(); }), submit);
      form.append(field('Motion name', input, 'Letters and numbers; this becomes the folder name.'), actions);
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
      const view = await window.relay.motionSnapshot(this.slug);
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
    const accepted = await confirmAction('Restore this version?', `The motion's files go back to v${value}. The current state stays in its own saved version if you saved one.`, 'Restore');
    if (!accepted) return;
    try {
      const view = await window.relay.motionRestore(this.slug, value);
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
      await window.relay.motionReveal(this.slug);
    } catch (error) {
      report('Could not show the motion folder', error);
    }
  }

  private async exportVideo(): Promise<void> {
    if (!this.slug || this.exporting !== undefined) return;
    const slug = this.slug;
    this.noteExport(0);
    try {
      const result = await window.relay.motionExport(slug);
      const name = result.file.split('/').pop() ?? result.file;
      notify(`Exported ${name} — ${result.frames} frames.`);
    } catch (error) {
      if (slug === this.slug) report('Could not export this motion', error);
    } finally {
      if (slug === this.slug) this.noteExport(undefined);
    }
  }

  /** Live export progress while the hidden stage renders frame by frame. */
  noteExport(progress: number | undefined): void {
    this.exporting = progress;
    this.exportButton.textContent = progress === undefined ? 'Export MP4' : `Exporting ${progress}%`;
    this.exportButton.disabled = progress !== undefined || !this.slug || this.mode !== 'workspace' || this.busy;
  }
}
