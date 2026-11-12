import type { FileChange } from '../shared/contracts';
import { byId, el, report } from './dom';

const PREVIEW = 3;

export class ReviewCard {
  private control = byId<HTMLDivElement>('review-card');
  private sessionId = '';
  private generation = 0;
  private request = 0;
  private signature = '';
  private changes: FileChange[] = [];
  private expanded = false;

  constructor(private review: () => void, private onChanges: () => void = () => {}) {
  }

  setSession(id: string): void {
    if (id === this.sessionId) return;
    this.sessionId = id;
    this.generation++;
    this.request++;
    this.signature = '';
    this.expanded = false;
    this.render([]);
    if (id) void this.reload();
  }

  async reload(): Promise<void> {
    const id = this.sessionId;
    if (!id) { this.render([]); return; }
    const generation = this.generation;
    const request = ++this.request;
    try {
      const changes = await window.relay.getChanges(id);
      if (generation !== this.generation || request !== this.request) return;
      this.render(changes);
    } catch (error) {
      if (generation === this.generation && request === this.request) this.render([]);
      report('Could not read task changes. Use Review to retry', error);
    }
  }

  private render(changes: FileChange[]): void {
    this.changes = changes;
    this.control.hidden = !changes.length;
    if (!changes.length) {
      this.signature = '';
      this.control.replaceChildren();
      this.control.removeAttribute('title');
      return;
    }
    let additions = 0;
    let deletions = 0;
    for (const change of changes) { additions += change.additions; deletions += change.deletions; }
    const signature = `${changes.length}:${additions}:${deletions}:${changes.map(change => change.path).join(',')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.onChanges();

    const counts = el('span', 'review-counts');
    counts.append(el('span', 'added', `+${additions}`), document.createTextNode(' '), el('span', 'removed', `−${deletions}`));

    const head = el('div', 'review-head');
    head.append(
      el('span', 'review-icon', '✎'),
      el('span', 'review-title', `Edited ${changes.length} file${changes.length === 1 ? '' : 's'}`),
      counts,
      el('span', 'review-spacer'),
      this.actionButton('Undo', () => void this.undoAll()),
      this.actionButton('Review', () => this.review(), 'primary'),
    );

    const list = el('div', 'review-list');
    const shown = this.expanded ? changes : changes.slice(0, PREVIEW);
    for (const change of shown) {
      const row = el('div', 'review-row');
      row.append(el('span', 'review-path truncate', change.path));
      const c = el('span', 'review-row-counts');
      c.append(el('span', 'added', `+${change.additions}`), document.createTextNode(' '), el('span', 'removed', `−${change.deletions}`));
      row.append(c);
      list.append(row);
    }
    const rest = changes.length - shown.length;
    if (rest > 0) {
      const more = el('button', 'review-more', `Show ${rest} more file${rest === 1 ? '' : 's'}`);
      more.type = 'button';
      more.addEventListener('click', () => { this.expanded = true; this.signature = ''; this.render(this.changes); });
      list.append(more);
    }

    this.control.replaceChildren(head, list);
    const paths = changes.slice(0, 8).map(change => change.path);
    this.control.title = paths.join('\n') + (changes.length > paths.length ? `\n…${changes.length - paths.length} more` : '');
  }

  private actionButton(label: string, onClick: () => void, className = ''): HTMLButtonElement {
    const button = el('button', `review-action ${className}`.trim(), label);
    button.type = 'button';
    button.addEventListener('click', () => onClick());
    return button;
  }

  private async undoAll(): Promise<void> {
    const paths = [...this.changes].reverse().map(change => change.path);
    for (const path of paths) {
      try { await window.relay.undoChange(path); } catch (error) { report(`Could not undo ${path}`, error); }
    }
    this.signature = '';
    await this.reload();
  }
}
