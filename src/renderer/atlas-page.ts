import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { byId, el, report, run } from './dom';
import { ATLAS_LANGUAGE_KEY, isAtlasLanguage, type AtlasCard, type AtlasLanguage, type AtlasView } from '../shared/atlas';

type AtlasMode = 'pages' | 'cards';

function renderMarkdown(text: string, openFile: (path: string, line?: number) => void): HTMLElement {
  const node = el('div', 'markdown atlas-markdown');
  const fragment = DOMPurify.sanitize(marked.parse(text, { async: false }), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img'],
    ALLOWED_ATTR: ['href', 'title', 'start', 'src', 'alt', 'width', 'height', 'class'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  node.append(fragment);
  for (const diagram of [...node.querySelectorAll<HTMLElement>('pre > code.language-mermaid')]) {
    const source = diagram.textContent ?? '';
    const panel = el('div', 'atlas-diagram');
    panel.append(el('span', 'atlas-diagram-label', 'Mermaid diagram'), el('pre', 'atlas-diagram-source', source));
    diagram.parentElement?.replaceWith(panel);
  }
  for (const link of node.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = (link.getAttribute('href') ?? '').trim();
    if (/^https?:\/\//i.test(href)) {
      link.rel = 'noreferrer noopener';
      link.addEventListener('click', (event) => { event.preventDefault(); void window.relay.openExternal(href); });
      continue;
    }
    if (!href || href.startsWith('#')) continue;
    const [path, anchor] = href.split('#');
    const clean = decodeURIComponent(path).replace(/^\.\//, '');
    if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith('/') || clean.split('/').includes('..')) continue;
    const line = anchor?.match(/^L(\d+)/i)?.[1];
    link.classList.add('atlas-file-link');
    link.setAttribute('role', 'button');
    link.tabIndex = 0;
    const open = (): void => openFile(clean, line ? Number(line) : undefined);
    link.addEventListener('click', (event) => { event.preventDefault(); open(); });
    link.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  }
  return node;
}

export class AtlasPanel {
  private view?: AtlasView;
  private mode: AtlasMode = 'pages';
  private slug?: string;
  private workspace?: string;
  private loaded?: string;
  private source = '';
  private editing = false;
  private request = 0;
  private pageRequest = 0;
  private cardsRequest = 0;
  private cardsLoaded?: string;
  private treeSignature = '';

  constructor(private readonly openFile: (path: string, line?: number) => void) {
    byId('atlas-close').addEventListener('click', () => this.close());
    byId('atlas-refresh').addEventListener('click', () => void this.reload(true));
    byId('atlas-generate').addEventListener('click', () => void this.generate());
    byId('atlas-cancel').addEventListener('click', () => void this.cancel());
    byId('atlas-sync').addEventListener('click', () => void this.sync());
    byId('atlas-edit').addEventListener('click', () => this.startEdit());
    byId('atlas-save').addEventListener('click', () => void this.saveEdit());
    byId('atlas-cancel-edit').addEventListener('click', () => this.cancelEdit());
    byId('atlas-mode-pages').addEventListener('click', () => this.setMode('pages'));
    byId('atlas-mode-cards').addEventListener('click', () => this.setMode('cards'));
    byId<HTMLSelectElement>('atlas-language').addEventListener('change', () => {
      localStorage.setItem(ATLAS_LANGUAGE_KEY, this.language());
      this.stopEditing();
      this.slug = undefined;
      this.loaded = undefined;
      this.cardsLoaded = undefined;
      void this.reload();
    });
  }

  get isOpen(): boolean { return !byId('atlas-page').hidden; }

  open(): void {
    byId<HTMLButtonElement>('atlas-button').setAttribute('aria-pressed', 'true');
    byId('atlas-page').hidden = false;
    byId('app').classList.add('atlas-open');
    byId<HTMLSelectElement>('atlas-language').value = this.language();
    void this.reload();
  }

  close(): void {
    this.stopEditing();
    byId('atlas-page').hidden = true;
    byId('app').classList.remove('atlas-open');
    byId<HTMLButtonElement>('atlas-button').setAttribute('aria-pressed', 'false');
  }

  setWorkspace(workspaceId?: string): void {
    if (workspaceId === this.workspace) return;
    this.workspace = workspaceId;
    this.stopEditing();
    this.slug = undefined;
    this.loaded = undefined;
    this.cardsLoaded = undefined;
    this.treeSignature = '';
    if (this.isOpen) void this.reload();
  }

  consume(view: AtlasView): void {
    if (!this.isOpen || view.language !== this.language()) return;
    this.render(view);
  }

  private language(): AtlasLanguage {
    const stored = localStorage.getItem(ATLAS_LANGUAGE_KEY);
    if (isAtlasLanguage(stored)) return stored;
    return document.documentElement.lang === 'ar' ? 'ar' : 'en';
  }

  async reload(force = false): Promise<void> {
    if (force) this.loaded = undefined;
    if (!this.workspace) { this.renderEmpty('Open a project folder to give Atlas code to read.'); return; }
    const language = this.language();
    const request = ++this.request;
    try {
      const view = await window.relay.atlasView(language);
      if (request === this.request && view.language === this.language()) this.render(view);
    } catch (error) {
      if (request === this.request) report('Could not open Atlas', error);
    }
  }

  private async generate(): Promise<void> {
    const language = this.language();
    const button = byId<HTMLButtonElement>('atlas-generate');
    await run(button, async () => {
      try { this.render(await window.relay.generateAtlas(language)); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/canceled/i.test(message)) report('Atlas could not finish', error);
        await this.reload();
      }
    }, (error) => report('Atlas could not start', error));
  }

  private async cancel(): Promise<void> {
    const button = byId<HTMLButtonElement>('atlas-cancel');
    await run(button, () => window.relay.cancelAtlas(), (error) => report('Could not cancel Atlas', error));
  }

  private render(view: AtlasView): void {
    this.view = view;
    byId<HTMLSelectElement>('atlas-language').value = view.language;
    const busy = view.status.state === 'planning' || view.status.state === 'writing';
    const generate = byId<HTMLButtonElement>('atlas-generate');
    generate.textContent = view.manifest ? 'Update' : 'Generate';
    generate.disabled = busy || !this.workspace || this.editing;
    byId('atlas-cancel').hidden = !busy;
    byId<HTMLButtonElement>('atlas-sync').hidden = !view.manifest || busy || this.editing;
    byId<HTMLButtonElement>('atlas-mode-cards').disabled = !view.manifest;
    if (this.mode === 'cards' && !view.manifest) this.mode = 'pages';
    byId('atlas-mode-pages').setAttribute('aria-pressed', String(this.mode === 'pages'));
    byId('atlas-mode-cards').setAttribute('aria-pressed', String(this.mode === 'cards'));
    this.renderSummary(view);
    if (this.mode === 'pages') this.renderPage(view);
    else this.renderCardsMode(view);
    this.renderTree(view);
    this.renderActions(view);
  }

  private setMode(mode: AtlasMode): void {
    if (this.mode === mode || this.editing) return;
    this.mode = mode;
    byId('atlas-mode-pages').setAttribute('aria-pressed', String(mode === 'pages'));
    byId('atlas-mode-cards').setAttribute('aria-pressed', String(mode === 'cards'));
    if (!this.view) return;
    if (mode === 'cards') {
      this.cardsLoaded = undefined;
      this.renderCardsMode(this.view);
      this.renderActions(this.view);
      return;
    }
    this.loaded = undefined;
    this.render(this.view);
  }

  private renderActions(view: AtlasView): void {
    const busy = view.status.state === 'planning' || view.status.state === 'writing';
    const page = this.mode === 'pages' ? view.manifest?.pages.find((item) => item.slug === this.slug) : undefined;
    byId('atlas-page-label').textContent = page?.title ?? '';
    byId('atlas-page-badge').hidden = !page?.edited || this.editing;
    byId('atlas-edit').hidden = !page || busy || this.editing;
    byId('atlas-save').hidden = !this.editing;
    byId('atlas-cancel-edit').hidden = !this.editing;
  }

  private renderSummary(view: AtlasView): void {
    const parts: string[] = [];
    const state = view.status.state;
    if (state === 'planning') parts.push('Reading the project and planning pages…');
    else if (state === 'writing') parts.push(`Writing pages${view.status.writing ? ` — ${view.status.writing}` : ''}${view.status.total ? ` of ${view.status.total}` : ''}…`);
    else if (state === 'error') parts.push(`Stopped: ${view.status.error ?? 'unknown error'}`);
    else if (state === 'canceled') parts.push('Generation canceled.');
    else if (view.manifest) parts.push(`${view.status.detail ?? `${view.manifest.pages.length} ${view.manifest.pages.length === 1 ? 'page' : 'pages'}`} · built ${new Date(view.manifest.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`);
    else parts.push('No pages yet. Generate Atlas to map this project.');
    const edited = view.manifest?.pages.filter((page) => page.edited).length ?? 0;
    if (edited) parts.push(`${edited} ${edited === 1 ? 'page is' : 'pages are'} edited by hand; Update keeps ${edited === 1 ? 'it' : 'them'} as ${edited === 1 ? 'is' : 'are'}.`);
    if (view.plan.present) parts.push(`Plan file found (${view.plan.documents} ${view.plan.documents === 1 ? 'page' : 'pages'} requested).`);
    if (view.cards.present) parts.push(`${view.cards.count} knowledge ${view.cards.count === 1 ? 'card' : 'cards'}.`);
    if (view.baseline?.stale) parts.push('Code changed since this build — press Update.');
    byId('atlas-summary').textContent = parts.join(' ');
    byId('atlas-summary').title = view.plan.warnings.join('\n');
  }

  private renderTree(view: AtlasView): void {
    const tree = byId('atlas-tree');
    const pages = view.manifest?.pages ?? [];
    const signature = pages.map((page) => `${page.slug}:${page.title}:${page.parent ?? ''}`).join('|');
    if (signature !== this.treeSignature) {
      this.treeSignature = signature;
      tree.replaceChildren();
      if (!pages.length) {
        tree.append(el('p', 'atlas-tree-empty', view.status.state === 'error' ? 'Nothing was written.' : 'No pages yet.'));
      } else {
        const children = new Map<string, typeof pages>();
        for (const page of pages) if (page.parent) children.set(page.parent, [...(children.get(page.parent) ?? []), page]);
        for (const page of pages.filter((item) => !item.parent)) {
          tree.append(this.pageButton(page.slug, page.title, page.summary, false));
          for (const child of children.get(page.slug) ?? []) tree.append(this.pageButton(child.slug, child.title, child.summary, true));
        }
      }
    }
    for (const item of tree.querySelectorAll<HTMLButtonElement>('.atlas-page-link')) {
      item.classList.toggle('active', item.dataset.slug === this.slug);
      item.setAttribute('aria-current', item.dataset.slug === this.slug ? 'page' : 'false');
    }
  }

  private pageButton(slug: string, title: string, summary: string | undefined, child: boolean): HTMLButtonElement {
    const control = el('button', `atlas-page-link${child ? ' child' : ''}`, title);
    control.type = 'button';
    control.dataset.slug = slug;
    if (summary) control.title = summary;
    control.addEventListener('click', () => this.select(slug));
    return control;
  }

  private select(slug: string): void {
    if (this.editing) return;
    if (this.mode === 'cards') {
      this.mode = 'pages';
      byId('atlas-mode-pages').setAttribute('aria-pressed', 'true');
      byId('atlas-mode-cards').setAttribute('aria-pressed', 'false');
      this.slug = slug;
      this.source = '';
      this.loaded = undefined;
      if (this.view) this.render(this.view);
      return;
    }
    if (this.slug === slug) return;
    this.slug = slug;
    this.source = '';
    this.loaded = undefined;
    if (this.view) this.renderActions(this.view);
    for (const item of byId('atlas-tree').querySelectorAll<HTMLButtonElement>('.atlas-page-link')) {
      const active = item.dataset.slug === slug;
      item.classList.toggle('active', active);
      item.setAttribute('aria-current', active ? 'page' : 'false');
    }
    void this.loadPage();
  }

  private renderPage(view: AtlasView): void {
    if (this.editing) return;
    const pages = view.manifest?.pages ?? [];
    if (!pages.length) {
      this.source = '';
      this.renderEmpty(view.plan.present
        ? `Atlas will follow ${view.plan.documents} planned ${view.plan.documents === 1 ? 'page' : 'pages'}. Press ${view.manifest ? 'Update' : 'Generate'} to write them.`
        : view.status.state === 'error'
          ? 'Atlas stopped before writing a page. Press Generate to try again.'
          : 'Atlas turns this project into a set of linked pages: components, data flow, dependencies, and diagrams. Press Generate to build it. To choose the pages yourself, add .relay/atlas/atlas_plan.yaml.');
      return;
    }
    if (!this.slug || !pages.some((page) => page.slug === this.slug)) { this.slug = pages[0].slug; this.source = ''; }
    const loaded = `${this.slug}@${view.manifest?.generatedAt ?? 0}`;
    if (loaded !== this.loaded) { this.loaded = loaded; void this.loadPage(); }
  }

  private async loadPage(): Promise<void> {
    const slug = this.slug;
    if (!slug) return;
    const language = this.language();
    const request = ++this.pageRequest;
    const reader = byId('atlas-reader');
    this.source = '';
    reader.replaceChildren(el('p', 'atlas-reader-note', 'Loading page…'));
    try {
      const text = await window.relay.atlasPage(language, slug);
      if (request !== this.pageRequest || slug !== this.slug) return;
      this.source = text;
      reader.replaceChildren(renderMarkdown(text, this.openFile));
      reader.scrollTop = 0;
    } catch (error) {
      if (request !== this.pageRequest) return;
      this.source = '';
      reader.replaceChildren(el('p', 'atlas-reader-note', `This page could not be read: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private startEdit(): void {
    if (this.editing || !this.slug || !this.source.trim()) return;
    this.editing = true;
    const area = el('textarea', 'atlas-editor');
    area.value = this.source;
    area.spellcheck = false;
    area.setAttribute('aria-label', 'Page Markdown');
    area.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'Enter')) {
        event.preventDefault();
        void this.saveEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelEdit();
      }
    });
    byId('atlas-reader').replaceChildren(area);
    byId('atlas-edit').hidden = true;
    byId('atlas-save').hidden = false;
    byId('atlas-cancel-edit').hidden = false;
    byId('atlas-page-badge').hidden = true;
    byId<HTMLButtonElement>('atlas-generate').disabled = true;
    byId<HTMLButtonElement>('atlas-sync').hidden = true;
    area.focus();
    area.setSelectionRange(0, 0);
  }

  private async saveEdit(): Promise<void> {
    const slug = this.slug;
    if (!slug || !this.editing) return;
    const area = byId('atlas-reader').querySelector<HTMLTextAreaElement>('textarea.atlas-editor');
    const text = area?.value ?? '';
    if (!text.trim()) { report('Could not save the page', new Error('A page cannot be empty.')); return; }
    const button = byId<HTMLButtonElement>('atlas-save');
    await run(button, async () => {
      try {
        this.editing = false;
        this.source = text;
        this.loaded = undefined;
        const view = await window.relay.saveAtlasPage(this.language(), slug, text);
        this.render(view);
      } catch (error) {
        this.editing = true;
        report('Could not save the page', error);
      }
    }, (error) => report('Could not save the page', error));
  }

  private cancelEdit(): void {
    if (!this.editing) return;
    this.stopEditing();
    void this.reload(true);
  }

  private stopEditing(): void {
    this.editing = false;
    this.source = '';
    this.loaded = undefined;
  }

  private async sync(): Promise<void> {
    const button = byId<HTMLButtonElement>('atlas-sync');
    await run(button, async () => {
      try {
        const view = await window.relay.syncAtlas(this.language());
        this.loaded = undefined;
        this.source = '';
        this.cardsLoaded = undefined;
        this.render(view);
      } catch (error) {
        report('Could not sync Atlas', error);
        await this.reload(true);
      }
    }, (error) => report('Could not sync Atlas', error));
  }

  private renderCardsMode(view: AtlasView): void {
    const busy = view.status.state === 'planning' || view.status.state === 'writing';
    const reader = byId('atlas-reader');
    if (busy) {
      this.cardsLoaded = undefined;
      reader.replaceChildren(el('p', 'atlas-reader-note', 'Writing pages and cards…'));
      return;
    }
    if (!view.cards.present) {
      this.cardsLoaded = undefined;
      reader.replaceChildren(el('p', 'atlas-reader-note', 'No knowledge cards yet. Press Update to write them.'));
      return;
    }
    const signature = `${view.language}@${view.manifest?.generatedAt ?? 0}@${view.cards.count}`;
    if (signature === this.cardsLoaded) return;
    this.cardsLoaded = signature;
    void this.loadCards();
  }

  private async loadCards(): Promise<void> {
    const request = ++this.cardsRequest;
    const reader = byId('atlas-reader');
    reader.replaceChildren(el('p', 'atlas-reader-note', 'Loading cards…'));
    try {
      const cards = await window.relay.atlasCards(this.language());
      if (request !== this.cardsRequest || this.mode !== 'cards') return;
      this.renderCardList(cards);
    } catch (error) {
      if (request !== this.cardsRequest) return;
      reader.replaceChildren(el('p', 'atlas-reader-note', `Cards could not be read: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private renderCardList(cards: AtlasCard[]): void {
    const reader = byId('atlas-reader');
    if (!cards.length) {
      reader.replaceChildren(el('p', 'atlas-reader-note', 'These pages have no knowledge cards yet.'));
      return;
    }
    const grid = el('div', 'atlas-cards');
    const names = new Map(cards.map((card) => [card.name.toLowerCase(), card]));
    const titles = new Map((this.view?.manifest?.pages ?? []).map((page) => [page.slug, page.title]));
    for (const card of cards) {
      const node = el('article', 'atlas-card');
      node.dataset.name = card.name.toLowerCase();
      const head = el('div', 'atlas-card-head');
      head.append(el('h3', 'atlas-card-title', card.name));
      const path = card.path;
      if (path) {
        const open = el('button', 'atlas-card-path', path);
        open.type = 'button';
        open.title = `Open ${path}`;
        open.addEventListener('click', () => this.openFile(path));
        head.append(open);
      }
      node.append(head);
      if (card.summary) node.append(el('p', 'atlas-card-summary', card.summary));
      if (card.dependsOn.length || card.relatedTo.length) {
        const relations = el('div', 'atlas-card-relations');
        const add = (label: string, items: string[]): void => {
          if (!items.length) return;
          const row = el('div', 'atlas-relation');
          row.append(el('span', 'atlas-relation-label', label));
          for (const name of items) {
            const target = names.get(name.toLowerCase());
            if (target) {
              const chip = el('button', 'atlas-chip', name);
              chip.type = 'button';
              chip.title = `Show ${target.name}`;
              chip.addEventListener('click', () => this.focusCard(target.name));
              row.append(chip);
            } else row.append(el('span', 'atlas-chip', name));
          }
          relations.append(row);
        };
        add('Depends on', card.dependsOn);
        add('Related', card.relatedTo);
        node.append(relations);
      }
      const page = card.page;
      if (page) {
        const title = titles.get(page);
        const read = el('button', 'atlas-card-page', title ? `Read page — ${title}` : 'Read page');
        read.type = 'button';
        read.addEventListener('click', () => this.openCardPage(page));
        node.append(read);
      }
      grid.append(node);
    }
    reader.replaceChildren(grid);
    reader.scrollTop = 0;
  }

  private focusCard(name: string): void {
    for (const node of byId('atlas-reader').querySelectorAll<HTMLElement>('.atlas-card')) {
      if (node.dataset.name !== name.toLowerCase()) continue;
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node.classList.remove('flash');
      void node.offsetWidth;
      node.classList.add('flash');
    }
  }

  private openCardPage(slug: string): void {
    this.mode = 'pages';
    this.slug = slug;
    this.source = '';
    this.loaded = undefined;
    byId('atlas-mode-pages').setAttribute('aria-pressed', 'true');
    byId('atlas-mode-cards').setAttribute('aria-pressed', 'false');
    if (this.view) this.render(this.view);
    else void this.reload(true);
  }

  private renderEmpty(message: string): void {
    this.source = '';
    const reader = byId('atlas-reader');
    reader.replaceChildren(el('p', 'atlas-reader-note', message));
    byId('atlas-tree').replaceChildren();
    byId('atlas-page-label').textContent = '';
    byId('atlas-page-badge').hidden = true;
    byId('atlas-edit').hidden = true;
    byId('atlas-save').hidden = true;
    byId('atlas-cancel-edit').hidden = true;
    byId('atlas-sync').hidden = true;
    byId<HTMLButtonElement>('atlas-mode-cards').disabled = true;
    this.treeSignature = '';
  }
}
