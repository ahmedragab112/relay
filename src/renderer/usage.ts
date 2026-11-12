import type { UsageSummary } from '../shared/contracts';
import { byId, button, el, errorText, notify } from './dom';
import { confirmAction, dialog } from './dialog';
import { formatWorked } from './turn-time';

const CIRCUMFERENCE = 2 * Math.PI * 9;

function amount(value: number): string {
  return Math.round(value).toLocaleString();
}

export class UsageMeter {
  private control = byId<HTMLButtonElement>('usage-meter');
  private percent = byId('usage-percent');
  private fill = byId('usage-fill') as unknown as SVGCircleElement;
  private sessionId = '';
  private generation = 0;
  private request = 0;
  private latest?: UsageSummary;
  private loaded = false;
  private report?: HTMLElement;
  private compactButton?: HTMLButtonElement;

  constructor(private changed: () => void) {
    this.control.addEventListener('click', () => this.open());
  }

  setSession(id: string): void {
    if (id === this.sessionId) return;
    this.sessionId = id;
    this.generation++;
    this.request++;
    this.latest = undefined;
    this.loaded = false;
    this.render();
    if (id) void this.load();
  }

  apply(sessionId: string, usage: UsageSummary): void {
    if (sessionId !== this.sessionId) return;
    this.latest = usage;
    this.loaded = true;
    this.render();
  }

  async load(): Promise<void> {
    const id = this.sessionId;
    if (!id) return;
    const generation = this.generation;
    const request = ++this.request;
    try {
      const usage = await window.relay.getUsage(id);
      if (generation !== this.generation || request !== this.request) return;
      this.latest = usage;
      this.loaded = true;
      this.render();
    } catch {
      if (generation === this.generation && request === this.request) this.loaded = true;
      this.render();
    }
  }

  async compactNow(): Promise<void> {
    if (!this.sessionId) return;
    const accepted = await confirmAction(
      'Compact this conversation?',
      'Earlier turns are replaced with a summary so the task fits the model context. Relay keeps the compaction card in the conversation and the original task record.',
      'Compact conversation',
    );
    if (!accepted || !this.sessionId) return;
    try {
      await window.relay.compactSession(this.sessionId);
      await this.load();
      this.changed();
      notify('Conversation compacted. Earlier turns now show as a summary card.');
    } catch (error) {
      notify(`Could not compact this conversation: ${errorText(error)}`, true);
    }
  }

  open(): void {
    if (!this.sessionId) return;
    const modal = dialog('Usage & context');
    const report = el('div', 'usage-report');
    const note = el('p', 'usage-note', 'Context is measured after the most recent compaction. Compaction replaces earlier turns with a summary.');
    const actions = el('div', 'dialog-actions');
    const compact = button('Compact conversation', async () => {
      modal.root.close();
      await this.compactNow();
    }, 'button');
    actions.append(button('Close', () => modal.root.close()), compact);
    modal.add(report, note, actions);
    this.report = report;
    this.compactButton = compact;
    modal.root.addEventListener('close', () => { this.report = undefined; this.compactButton = undefined; }, { once: true });
    this.fillReport(report);
    compact.disabled = !this.latest || this.latest.total === 0;
  }

  private fillReport(report: HTMLElement): void {
    const usage = this.latest;
    report.replaceChildren();
    if (!usage) {
      report.append(el('p', 'small muted', this.loaded ? 'No token data yet. Send a message to start measuring context.' : 'Reading session usage…'));
      return;
    }
    const row = (label: string, value: string) => {
      const line = el('div', 'usage-row');
      line.append(el('span', '', label), el('span', '', value));
      report.append(line);
    };
    if (usage.model) row('Model', usage.model);
    row('Context used', usage.contextLimit
      ? `${amount(usage.contextUsed)} / ${amount(usage.contextLimit)} tokens · ${usage.percent}%`
      : `${amount(usage.contextUsed)} tokens`);
    row('Input', `${amount(usage.input)} tokens`);
    row('Output', `${amount(usage.output)} tokens`);
    if (usage.reasoning) row('Reasoning', `${amount(usage.reasoning)} tokens`);
    if (usage.cacheRead || usage.cacheWrite) row('Cache', `${amount(usage.cacheRead)} read · ${amount(usage.cacheWrite)} write`);
    row('Total', `${amount(usage.total)} tokens`);
    if (usage.worked) row('Time worked', formatWorked(usage.worked));
    if (usage.cost) row('Cost', `$${usage.cost.toFixed(4)}`);
    row('Compactions', String(usage.compactions));
  }

  private render(): void {
    if (this.report) this.fillReport(this.report);
    if (this.compactButton) this.compactButton.disabled = !this.latest || this.latest.total === 0;
    this.control.hidden = !this.sessionId;
    if (!this.sessionId) {
      this.percent.textContent = '0%';
      this.control.title = 'Context usage';
      this.control.classList.remove('warn', 'danger');
      this.paint(0);
      return;
    }
    const usage = this.latest;
    const value = usage?.percent ?? 0;
    this.percent.textContent = usage ? `${value}%` : '…';
    this.control.classList.toggle('warn', Boolean(usage && value >= 70 && value < 90));
    this.control.classList.toggle('danger', Boolean(usage && value >= 90));
    this.control.title = usage
      ? `${value}% of ${usage.contextLimit ? `${amount(usage.contextLimit)} tokens` : 'context'} used${usage.model ? ` · ${usage.model}` : ''}`
      : 'Context usage';
    this.paint(value);
  }

  private paint(percent: number): void {
    this.fill.style.strokeDasharray = `${CIRCUMFERENCE}`;
    this.fill.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, percent)) / 100)}`;
  }
}
