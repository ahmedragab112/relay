import type { AttentionHistoryEntry, AttentionOutcome, AttentionOverview } from '../shared/contracts';
import { byId, button, el, errorText } from './dom';
import { permissionCard, questionCard } from './request-cards';
import { formatWorked } from './turn-time';

const OUTCOME_LABELS: Record<AttentionOutcome, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  answered: 'Answered',
  dismissed: 'Dismissed',
  expired: 'Expired',
};

function stamp(ms: number): string {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export class AttentionView {
  private page = byId('attention');
  private list = byId('attention-list');
  private summary = byId('attention-summary');
  private badge = byId('attention-count');
  private control = byId<HTMLButtonElement>('attention-button');
  private waitingTab = byId<HTMLButtonElement>('attention-tab-waiting');
  private historyTab = byId<HTMLButtonElement>('attention-tab-history');
  private waitingCount = byId('attention-waiting-count');
  private overview: AttentionOverview = { permissions: [], questions: [], history: [] };
  private tab: 'waiting' | 'history' = 'waiting';
  private open = false;
  private enabled = false;
  private generation = 0;

  constructor(private options: { openTask: (sessionId: string) => void }) {
    this.waitingTab.addEventListener('click', () => this.setTab('waiting'));
    this.historyTab.addEventListener('click', () => this.setTab('history'));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.control.disabled = !enabled;
    if (!enabled) this.close();
  }

  get isOpen(): boolean { return this.open; }

  show(): void {
    if (!this.enabled) return;
    this.open = true;
    this.page.hidden = false;
    byId('app').classList.add('attention-open');
    this.control.setAttribute('aria-pressed', 'true');
    void this.reload();
    byId('attention-close').focus();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.page.hidden = true;
    byId('app').classList.remove('attention-open');
    this.control.setAttribute('aria-pressed', 'false');
  }

  toggle(): void { if (this.open) this.close(); else this.show(); }

  setTab(tab: 'waiting' | 'history'): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.render();
  }

  async reload(): Promise<void> {
    if (!this.enabled) return;
    const generation = ++this.generation;
    try {
      const overview = await window.relay.attention();
      if (generation !== this.generation) return;
      this.overview = overview;
      this.render();
    } catch (error) {
      if (generation !== this.generation) return;
      this.summary.textContent = `Could not load requests: ${errorText(error)}`;
      if (this.open && !this.list.childElementCount) this.list.replaceChildren(el('p', 'inline-error', 'Requests could not be loaded. Use Refresh to try again.'));
    }
  }

  private total(): number { return this.overview.permissions.length + this.overview.questions.length; }

  private render(): void {
    const total = this.total();
    const history = this.overview.history.length;
    this.badge.textContent = total > 9 ? '9+' : String(total);
    this.badge.hidden = total === 0;
    this.control.classList.toggle('has-attention', total > 0);
    this.waitingCount.textContent = String(total);
    this.waitingCount.hidden = total === 0;
    this.waitingTab.setAttribute('aria-selected', String(this.tab === 'waiting'));
    this.historyTab.setAttribute('aria-selected', String(this.tab === 'history'));
    this.summary.textContent = this.tab === 'waiting'
      ? (total ? `${total} item${total === 1 ? '' : 's'} waiting across your tasks.` : 'Requests and questions from every agent, in one place.')
      : (history ? `${history} past request${history === 1 ? '' : 's'}, newest first.` : 'Every approval and answer you have given, in one place.');
    if (!this.open) return;
    if (this.tab === 'history') {
      this.renderHistory();
      return;
    }
    const nodes: HTMLElement[] = [];
    for (const item of this.overview.permissions) {
      nodes.push(this.row(item.sessionId, item.taskTitle, item.folder, permissionCard(item.request, () => { void this.reload(); })));
    }
    for (const item of this.overview.questions) {
      nodes.push(this.row(item.sessionId, item.taskTitle, item.folder, questionCard(item.request, () => { void this.reload(); })));
    }
    if (!nodes.length) {
      this.list.replaceChildren(this.empty('Nothing needs you right now', 'When an agent asks for access or a decision, it will appear here — from any project folder.'));
      return;
    }
    this.list.replaceChildren(...nodes);
  }

  private renderHistory(): void {
    const entries = this.overview.history;
    if (!entries.length) {
      this.list.replaceChildren(this.empty('No past requests yet', 'Approvals and answers you give stay here, so you can check what an agent asked and what you decided.'));
      return;
    }
    this.list.replaceChildren(...entries.map((entry) => this.historyRow(entry)));
  }

  private empty(title: string, copy: string): HTMLElement {
    const empty = el('div', 'attention-empty');
    empty.append(el('h3', '', title), el('p', '', copy));
    return empty;
  }

  private historyRow(entry: AttentionHistoryEntry): HTMLElement {
    const row = el('section', 'attention-item attention-history-item');
    const meta = el('div', 'attention-meta');
    meta.append(el('span', 'attention-folder', entry.folder));
    const open = button(`${entry.taskTitle} ↗`, () => this.options.openTask(entry.sessionId), 'attention-task');
    open.title = `Open ${entry.taskTitle}`;
    meta.append(open, el('span', `attention-outcome ${entry.outcome}`, OUTCOME_LABELS[entry.outcome]));
    const body = el('div', 'attention-history-body');
    body.append(el('p', 'attention-history-summary', entry.summary));
    if (entry.answer) body.append(el('p', 'attention-history-answer', `Answered: ${entry.answer}`));
    body.append(el('p', 'attention-history-when', `${stamp(entry.resolvedAt)} · waited ${formatWorked(entry.resolvedAt - entry.askedAt)}`));
    row.append(meta, body);
    return row;
  }

  private row(sessionId: string, title: string, folder: string, card: HTMLElement): HTMLElement {
    const row = el('section', 'attention-item');
    const meta = el('div', 'attention-meta');
    meta.append(el('span', 'attention-folder', folder));
    const open = button(`${title} ↗`, () => this.options.openTask(sessionId), 'attention-task');
    open.title = `Open ${title}`;
    meta.append(open, el('span', 'attention-session', sessionId.slice(0, 8)));
    row.append(meta, card);
    return row;
  }
}
