import type {
  ActivityFileSource, ActivityMcp, ActivityMcpSuggestion, ActivitySkill, ActivitySkillSuggestion, ActivitySubagent, BackgroundRun, SessionActivity,
} from '../shared/contracts';
import { button, el, errorText, notify } from './dom';
import { fileIconElement } from './file-icons';
import { installSkillFromURL } from './skill-install';

const VISIBLE_SUGGESTIONS = 3;

const SOURCE_LABELS: Record<ActivityFileSource['kind'], string> = {
  pdf: 'PDF', image: 'Image', document: 'Doc', file: 'File',
};

function when(value: number): string {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

function meta(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' · ');
}

function elapsed(subagent: ActivitySubagent): string {
  if (subagent.completedAt === undefined) return subagent.status === 'running' ? 'running now' : subagent.status;
  const seconds = Math.max(0, Math.round((subagent.completedAt - subagent.startedAt) / 1000));
  if (seconds < 1) return 'under a second';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

function section(title: string, badge: string | undefined, rows: HTMLElement[], empty: string): HTMLElement {
  const wrapper = el('section', 'activity-section');
  const head = el('div', 'activity-section-head');
  head.append(el('span', 'activity-section-title', title));
  if (badge) head.append(el('span', 'pill', badge));
  wrapper.append(head, ...(rows.length ? rows : [el('p', 'activity-section-empty', empty)]));
  return wrapper;
}

function item(name: string, detail: string, options: { count?: number; suggested?: boolean } = {}): HTMLElement {
  const row = el('div', `activity-item${options.suggested ? ' suggested' : ''}`);
  const head = el('div', 'activity-item-head');
  head.append(el('span', 'activity-item-name truncate', name));
  if (options.count && options.count > 1) head.append(el('span', 'activity-item-count', `×${options.count}`));
  row.append(head);
  if (detail) row.append(el('p', 'activity-item-detail', detail));
  return row;
}

export class ActivityView {
  private sessionId = '';
  private ready = false;
  private generation = 0;
  private request = 0;
  private suggestedOpen = false;
  private disposed = false;
  private activity?: SessionActivity;
  private background: BackgroundRun[] = [];
  private openRuns = new Set<string>();

  constructor(
    private readonly host: HTMLElement,
    private readonly openFile: (path: string) => void,
    private readonly openTask: (id: string) => void = () => {},
  ) {
    host.replaceChildren(el('p', 'activity-section-empty', 'Select a task to see what it used.'));
  }

  setReady(ready: boolean): void {
    if (ready === this.ready) return;
    this.ready = ready;
    if (this.sessionId) void this.reload();
  }

  setSession(id: string): void {
    if (id === this.sessionId) return;
    this.sessionId = id;
    this.suggestedOpen = false;
    this.generation++;
    this.activity = undefined;
    void this.reload();
  }

  async reload(): Promise<void> {
    const sessionId = this.sessionId;
    if (!this.ready) {
      this.host.replaceChildren(el('p', 'activity-section-empty', 'Activity appears once the local engine is ready.'));
      return;
    }
    const request = ++this.request;
    const generation = this.generation;
    if (!this.activity) this.host.replaceChildren(el('p', 'activity-section-empty', sessionId ? 'Loading activity…' : 'Select a task to see what it used.'));
    try {
      const [activity, background] = await Promise.all([
        sessionId ? window.relay.getActivity(sessionId) : Promise.resolve(undefined),
        window.relay.backgroundActivity().catch(() => [] as BackgroundRun[]),
      ]);
      if (this.disposed || request !== this.request || generation !== this.generation) return;
      this.activity = activity;
      this.background = background;
      this.render();
    } catch (error) {
      if (this.disposed || request !== this.request || generation !== this.generation) return;
      this.host.replaceChildren(
        el('p', 'inline-error', `Activity unavailable: ${errorText(error)}`),
        button('Retry', () => void this.reload(), 'text-button'),
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.request++;
  }

  private render(): void {
    const background = this.backgroundSection();
    const activity = this.activity;
    if (!activity) {
      this.host.replaceChildren(
        ...(background ? [background] : []),
        el('p', 'activity-section-empty', 'Select a task to see what it used.'),
      );
      return;
    }
    this.host.replaceChildren(
      ...(background ? [background] : []),
      this.subagents(activity.subagents),
      this.skills(activity.skills.used, activity.skills.suggested),
      this.mcp(activity.mcp.used, activity.mcp.suggested),
      this.artifacts(activity.artifacts),
      this.web(activity.web),
      this.sources(activity.sources),
    );
  }

  private backgroundSection(): HTMLElement | null {
    if (!this.background.length) return null;
    return section('Background work', String(this.background.length), this.background.map(run => this.backgroundRun(run)), '');
  }

  private backgroundRun(run: BackgroundRun): HTMLElement {
    const row = el('details', 'activity-run');
    const summary = el('summary');
    const state = run.status === 'running' ? 'running' : run.status;
    summary.append(
      el('span', `activity-dot ${state}`),
      el('span', 'activity-run-title truncate', run.title),
      el('span', `activity-run-status ${state}`, run.status === 'running' ? 'Running' : run.status === 'error' ? 'Error' : 'Idle'),
    );
    const logs = run.logs.length ? run.logs.join('\n') : 'No output captured yet.';
    const actions = el('div', 'activity-run-actions');
    actions.append(button('Open task', () => this.openTask(run.id), 'text-button'));
    row.append(
      summary,
      el('p', 'activity-run-time', run.startedAt ? `Backgrounded ${when(run.startedAt)}` : ''),
      el('pre', 'activity-run-logs', logs),
      actions,
    );
    row.open = this.openRuns.has(run.id);
    row.addEventListener('toggle', () => {
      if (row.open) this.openRuns.add(run.id);
      else this.openRuns.delete(run.id);
    });
    return row;
  }

  private subagents(items: ActivitySubagent[]): HTMLElement {
    const rows = items.map(subagent => {
      const block = el('details', 'activity-block');
      const summary = el('summary', 'activity-summary');
      const name = el('span', 'activity-name truncate', subagent.title);
      name.title = subagent.description || subagent.title;
      summary.append(
        el('span', `activity-dot ${subagent.status}`),
        name,
        el('span', 'activity-meta', meta(subagent.agent, elapsed(subagent), subagent.messages.length ? `${subagent.messages.length} messages` : '')),
      );
      block.append(summary);
      const chat = el('div', 'activity-chat');
      if (subagent.messages.length) {
        for (const message of subagent.messages) {
          const line = el('div', `activity-line ${message.role}`);
          line.append(
            el('span', 'activity-role', message.role === 'user' ? 'Prompt' : 'Agent'),
            el('p', 'activity-msg', message.text),
          );
          chat.append(line);
        }
      } else chat.append(el('p', 'activity-note', 'No messages captured for this subagent.'));
      block.append(chat);
      return block;
    });
    return section('Subagents', items.length ? String(items.length) : undefined, rows, 'No subagents ran in this task.');
  }

  private skills(used: ActivitySkill[], suggested: ActivitySkillSuggestion[]): HTMLElement {
    const rows: HTMLElement[] = [];
    if (used.length) {
      rows.push(el('p', 'activity-group-label', 'Used'));
      for (const skill of used) rows.push(item(skill.name, skill.description || `Last used ${when(skill.lastUsed)}`, { count: skill.uses }));
    }
    if (suggested.length) {
      rows.push(el('p', 'activity-group-label', 'Suggested for this task'));
      for (const skill of this.visibleSuggestions(suggested)) {
        rows.push(skill.source === 'web' && skill.url
          ? this.webSuggestion(skill)
          : item(skill.name, meta(skill.reason, skill.description), { suggested: true }));
      }
      const hidden = suggested.length - VISIBLE_SUGGESTIONS;
      if (hidden > 0) {
        rows.push(button(
          this.suggestedOpen ? 'Show fewer suggestions' : `Show ${hidden} more suggestion${hidden === 1 ? '' : 's'}`,
          () => { this.suggestedOpen = !this.suggestedOpen; this.render(); },
          'text-button activity-more',
        ));
      }
    }
    return section('Skills', used.length + suggested.length ? String(used.length + suggested.length) : undefined, rows,
      'No skills used. Nothing matched this task yet.');
  }

  private webSuggestion(skill: ActivitySkillSuggestion): HTMLElement {
    const row = el('div', 'activity-item suggested');
    const head = el('div', 'activity-item-head');
    head.append(el('span', 'activity-tag web', 'Web'), el('span', 'activity-item-name truncate', skill.name));
    row.append(head, el('p', 'activity-item-detail', meta(skill.reason, skill.description)));
    const url = skill.url;
    if (url) {
      const actions = el('div', 'activity-item-actions');
      actions.append(button('Add', () => installSkillFromURL(url, skill.sha256, async () => {
        notify(`Added ${skill.name} to your skills.`);
        await this.reload();
      }), 'text-button'));
      row.append(actions);
    }
    return row;
  }

  private mcp(used: ActivityMcp[], suggested: ActivityMcpSuggestion[]): HTMLElement {
    const rows: HTMLElement[] = [];
    if (used.length) {
      rows.push(el('p', 'activity-group-label', 'Used'));
      for (const server of used) rows.push(item(server.name, meta(`Connected server · ${server.type}`, `Last used ${when(server.lastUsed)}`), { count: server.uses }));
    }
    if (suggested.length) {
      rows.push(el('p', 'activity-group-label', 'Suggested for this task'));
      for (const server of this.visibleSuggestions(suggested)) rows.push(item(server.name, server.reason, { suggested: true }));
    }
    return section('MCP servers', used.length + suggested.length ? String(used.length + suggested.length) : undefined, rows,
      'No MCP servers used. Nothing matched this task yet.');
  }

  private artifacts(artifacts: SessionActivity['artifacts']): HTMLElement {
    const rows = artifacts.map(artifact => {
      const row = item(artifact.title, meta(artifact.provider, artifact.entry, when(artifact.updatedAt)));
      const url = artifact.url;
      if (url) {
        const actions = el('div', 'activity-item-actions');
        actions.append(
          button('Copy link', async () => { await window.relay.copyText(url); notify('Copied artifact link.'); }, 'text-button'),
          button('Open', () => window.relay.openExternal(url), 'text-button'),
        );
        row.append(actions);
      }
      return row;
    });
    return section('Artifacts', artifacts.length ? String(artifacts.length) : undefined, rows, 'No artifacts produced yet.');
  }

  private web(sources: SessionActivity['web']): HTMLElement {
    const rows = sources.map(source => {
      const row = el('div', 'activity-item');
      const head = el('div', 'activity-item-head');
      head.append(
        el('span', `activity-tag ${source.kind}`, source.kind === 'fetch' ? 'Fetch' : 'Search'),
        el('span', 'activity-item-name truncate', source.label),
      );
      if (source.mentions > 1) head.append(el('span', 'activity-item-count', `×${source.mentions}`));
      row.append(head);
      const detail = meta(source.url ? hostOf(source.url) : '', when(source.lastUsed));
      if (detail) row.append(el('p', 'activity-item-detail', detail));
      const url = source.url;
      if (url) {
        const actions = el('div', 'activity-item-actions');
        actions.append(button('Open', () => window.relay.openExternal(url), 'text-button'));
        row.append(actions);
      }
      return row;
    });
    return section('Web reading', sources.length ? String(sources.length) : undefined, rows, 'Nothing read from the web yet.');
  }

  private sources(items: ActivityFileSource[]): HTMLElement {
    const rows = items.map(source => {
      const row = el('div', 'activity-item');
      const head = el('div', 'activity-item-head');
      head.append(
        fileIconElement(source.name, false),
        el('span', 'activity-item-name truncate', source.name),
        el('span', `activity-tag ${source.kind}`, SOURCE_LABELS[source.kind]),
      );
      if (source.mentions > 1) head.append(el('span', 'activity-item-count', `×${source.mentions}`));
      row.append(head, el('p', 'activity-item-detail', source.path));
      if (source.path.includes('/')) {
        const actions = el('div', 'activity-item-actions');
        actions.append(button('Open', () => this.openFile(source.path), 'text-button'));
        row.append(actions);
      }
      return row;
    });
    return section('Sources', items.length ? String(items.length) : undefined, rows,
      'No files, PDFs, or images referenced yet.');
  }

  private visibleSuggestions<T>(suggested: T[]): T[] {
    return this.suggestedOpen ? suggested : suggested.slice(0, VISIBLE_SUGGESTIONS);
  }
}
