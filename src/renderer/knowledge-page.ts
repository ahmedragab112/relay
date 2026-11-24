import { byId, el, errorText, field, notify, report, run } from './dom';
import { confirmAction, dialog } from './dialog';
import type { KnowledgeMeta } from '../shared/knowledge';

export interface KnowledgePanelOptions {
  attach: (label: string, text: string) => boolean;
}

const KIND_LABEL: Record<KnowledgeMeta['kind'], string> = { note: 'Note', file: 'File', link: 'Link' };

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateLabel(ms: number): string {
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export class KnowledgePanel {
  private sources: KnowledgeMeta[] = [];
  private selected?: string;
  private text = '';
  private filter = '';
  private request = 0;
  private loading?: string;

  constructor(private readonly options: KnowledgePanelOptions) {
    byId('knowledge-add-note').addEventListener('click', () => this.addNote());
    byId('knowledge-add-file').addEventListener('click', () => void this.addFiles());
    byId('knowledge-add-link').addEventListener('click', () => this.addLink());
    byId('knowledge-reveal').addEventListener('click', () => {
      void run(byId<HTMLButtonElement>('knowledge-reveal'), () => window.relay.knowledgeReveal(), (error) => report('Could not open the Knowledge folder', error));
    });
    byId('knowledge-attach').addEventListener('click', () => void this.attach());
    byId('knowledge-delete').addEventListener('click', () => void this.remove());
    byId<HTMLInputElement>('knowledge-search').addEventListener('input', (event) => {
      this.filter = (event.target as HTMLInputElement).value.trim().toLowerCase();
      this.paintList();
    });
  }

  open(sourceId?: string): void {
    if (sourceId) this.selected = sourceId;
    void this.reload();
  }

  hide(): void { this.request++; }

  async reload(): Promise<void> {
    const token = ++this.request;
    try {
      const sources = await window.relay.knowledgeList();
      if (token !== this.request) return;
      this.sources = sources;
      if (this.selected && !sources.some(source => source.id === this.selected)) this.selected = undefined;
      if (!this.selected && sources.length) this.selected = sources[0].id;
      this.paintList();
    } catch (error) { report('Could not load Knowledge', error); }
    await this.loadSelected();
  }

  private paintList(): void {
    const list = byId('knowledge-list');
    const summary = byId('knowledge-summary');
    summary.textContent = this.sources.length
      ? `${this.sources.length} ${this.sources.length === 1 ? 'source' : 'sources'} · shared by every task in every folder`
      : 'Saved sources, shared by every task in every folder.';
    const matches = this.sources.filter(source => {
      if (!this.filter) return true;
      return [source.title, source.origin ?? '', source.excerpt].some(value => value.toLowerCase().includes(this.filter));
    });
    if (!matches.length) {
      list.replaceChildren(el('p', 'atlas-tree-empty', this.sources.length ? 'Nothing matches that search.' : 'No sources yet. Add a note, files, or a link — the agent can read them from any task.'));
      return;
    }
    list.replaceChildren(...matches.map(source => {
      const item = el('button', 'knowledge-item');
      item.type = 'button';
      if (source.id === this.selected) item.classList.add('active');
      const copy = el('span', 'knowledge-item-copy');
      copy.append(el('span', 'knowledge-item-title', source.title), el('span', 'knowledge-item-meta', `${KIND_LABEL[source.kind]}${source.origin ? ` · ${source.origin}` : ''}`));
      item.append(copy);
      item.addEventListener('click', () => {
        if (source.id === this.selected) return;
        this.selected = source.id;
        this.paintList();
        void this.loadSelected();
      });
      return item;
    }));
  }

  private async loadSelected(): Promise<void> {
    const reader = byId('knowledge-reader');
    const label = byId('knowledge-title-label');
    const source = this.sources.find(item => item.id === this.selected);
    byId('knowledge-attach').hidden = !source;
    byId('knowledge-delete').hidden = !source;
    if (!source) {
      label.textContent = '';
      reader.replaceChildren(el('p', 'atlas-reader-note', 'Every task you start gets a compact index of these sources, and you can attach any of them in full from the composer with @knowledge.'));
      return;
    }
    label.textContent = source.title;
    byId<HTMLButtonElement>('knowledge-attach').disabled = this.loading === source.id;
    byId<HTMLButtonElement>('knowledge-delete').disabled = this.loading === source.id;
    if (this.loading === source.id) return;
    this.loading = source.id;
    try {
      const text = await window.relay.knowledgeRead(source.id);
      if (this.selected !== source.id) return;
      this.text = text;
      const meta = el('p', 'knowledge-meta');
      meta.append(el('span', '', `${KIND_LABEL[source.kind]} · added ${dateLabel(source.createdAt)} · ${sizeLabel(source.size)}`));
      if (source.kind === 'link' && source.origin) {
        const href = source.origin;
        const link = el('a', 'atlas-file-link', href);
        link.setAttribute('href', href);
        link.addEventListener('click', (event) => { event.preventDefault(); void window.relay.openExternal(href); });
        meta.append(link);
      }
      const body = el('pre', 'knowledge-text', text);
      reader.replaceChildren(meta, body);
    } catch (error) {
      reader.replaceChildren(el('p', 'inline-error', errorText(error)));
    } finally {
      if (this.loading === source.id) this.loading = undefined;
      byId<HTMLButtonElement>('knowledge-attach').disabled = false;
      byId<HTMLButtonElement>('knowledge-delete').disabled = false;
    }
  }

  private async attach(): Promise<void> {
    const source = this.sources.find(item => item.id === this.selected);
    if (!source) return;
    try {
      const text = await window.relay.knowledgeRead(source.id);
      if (!this.options.attach(`Knowledge: ${source.title}`, text)) notify('Remove a context tag before adding another.', true);
    } catch (error) { report('Could not attach that source', error); }
  }

  private async remove(): Promise<void> {
    const source = this.sources.find(item => item.id === this.selected);
    if (!source) return;
    if (!await confirmAction('Delete this source?', `"${source.title}" will be removed from Knowledge. Tasks that already read it keep their conversation.`, 'Delete')) return;
    try {
      this.selected = undefined;
      this.sources = await window.relay.knowledgeRemove(source.id);
      if (this.sources.length) this.selected = this.sources[0].id;
      this.paintList();
      await this.loadSelected();
    } catch (error) { report('Could not delete that source', error); }
  }

  private addNote(): void {
    const modal = dialog('New note');
    const title = el('input');
    title.placeholder = 'Optional title — the first line is used when empty';
    title.maxLength = 120;
    const text = el('textarea');
    text.rows = 10;
    text.placeholder = 'Paste the text every task should know.';
    const save = el('button', 'button primary', 'Save note');
    save.type = 'submit';
    const form = el('form');
    form.append(field('Title', title), field('Text', text));
    const actions = el('div', 'dialog-actions');
    actions.append(save);
    form.append(actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!text.value.trim() || save.disabled) return;
      save.disabled = true;
      modal.busy(true);
      void window.relay.knowledgeAddNote({ title: title.value.trim() || undefined, text: text.value }).then(sources => {
        modal.root.close();
        this.sources = sources;
        this.selected = sources[0]?.id;
        this.paintList();
        void this.loadSelected();
        notify('Note saved to Knowledge');
      }).catch(modal.fail).finally(() => {
        save.disabled = false;
        modal.busy(false);
      });
    });
    modal.add(form);
    title.focus();
  }

  private async addFiles(): Promise<void> {
    const control = byId<HTMLButtonElement>('knowledge-add-file');
    await run(control, async () => {
      const result = await window.relay.knowledgeAddFile();
      this.sources = result.sources;
      if (result.sources.length) this.selected = result.sources[0].id;
      this.paintList();
      await this.loadSelected();
      const added = `${result.sources.length} ${result.sources.length === 1 ? 'file' : 'files'}`;
      if (result.skipped.length) notify(`Saved ${added}. Skipped: ${result.skipped.join(' · ')}`, true);
      else notify(`Saved ${added} to Knowledge`);
    }, (error) => report('Could not add those files', error));
  }

  private addLink(): void {
    const modal = dialog('Add a link');
    const input = el('input');
    input.type = 'url';
    input.placeholder = 'https://';
    input.required = true;
    const form = el('form');
    const save = el('button', 'button primary', 'Save link');
    save.type = 'submit';
    form.append(field('Address', input));
    form.append(save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!input.value.trim() || save.disabled) return;
      save.disabled = true;
      modal.busy(true);
      void window.relay.knowledgeAddLink(input.value.trim()).then(sources => {
        modal.root.close();
        this.sources = sources;
        this.selected = sources[0]?.id;
        this.paintList();
        void this.loadSelected();
        notify('Link saved to Knowledge');
      }).catch(modal.fail).finally(() => {
        save.disabled = false;
        modal.busy(false);
      });
    });
    modal.add(form);
    input.focus();
  }
}
