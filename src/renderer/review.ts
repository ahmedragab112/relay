import type { FileChange } from '../shared/contracts';
import { byId, el, report } from './dom';

export class ReviewCard {
  private control = byId<HTMLButtonElement>('review-card');
  private sessionId = '';
  private generation = 0;
  private request = 0;
  private signature = '';

  constructor(private review: () => void) {
    this.control.addEventListener('click', () => { if (!this.control.hidden) this.review(); });
  }

  setSession(id: string): void {
    if (id === this.sessionId) return;
    this.sessionId = id;
    this.generation++;
    this.request++;
    this.signature = '';
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
    const signature = `${changes.length}:${additions}:${deletions}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const counts = el('span', 'review-counts');
    counts.append(el('span', 'added', `+${additions}`), document.createTextNode(' '), el('span', 'removed', `−${deletions}`));
    this.control.replaceChildren(
      el('span', 'review-icon', '✎'),
      el('span', 'review-title', `Edited ${changes.length} file${changes.length === 1 ? '' : 's'}`),
      counts,
      el('span', 'review-go', 'Review →'),
    );
    const list = changes.slice(0, 8).map(change => change.path);
    this.control.title = list.join('\n') + (changes.length > list.length ? `\n…${changes.length - list.length} more` : '');
  }
}
