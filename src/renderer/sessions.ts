import type { SessionSummary, Workspace } from '../shared/contracts';
import { byId, button, el, errorText } from './dom';
import { askText, confirmAction, dialog } from './dialog';
import { fileIconElement } from './file-icons';
import { groupTasks, type TaskGroup } from './task-groups';
import { forkForest, type ForkNode } from './fork-graph';

const DOT_CENTER = 15;
const LANE_GAP = 14;
const LANE_LEFT = 10;

function taskLoader(): HTMLElement {
  const loader = el('span', 'task-loader');
  loader.setAttribute('aria-hidden', 'true');
  loader.append(el('i'), el('i'), el('i'));
  return loader;
}

function branchGlyph(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const [tag, attrs] of [
    ['line', { x1: '6', y1: '4', x2: '6', y2: '14' }],
    ['circle', { cx: '18', cy: '6', r: '2.5' }],
    ['circle', { cx: '6', cy: '18', r: '2.5' }],
    ['path', { d: 'M18 8.5a9 9 0 0 1-9 9' }],
  ] as Array<[string, Record<string, string>]>) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}


export class Sessions {
  items: SessionSummary[] = [];
  groups: TaskGroup[] = [];
  active?: SessionSummary;
  private workspaces: Workspace[] = [];
  private currentId = '';
  private queued = '';
  private collapsed = new Set<string>();
  private generation = 0;
  private request = 0;
  private creating = false;
  private workspace = false;
  private signature = '';
  private disposed = false;

  constructor(
    private selected: (session?: SessionSummary, userInitiated?: boolean) => void,
    private openFolder: (workspaceId: string) => Promise<boolean> = async () => false,
  ) {}

  reset(hasWorkspace: boolean, workspaces: Workspace[] = [], currentId = ''): void {
    this.generation++; this.request++; this.workspace = hasWorkspace;
    this.workspaces = workspaces; this.currentId = currentId;
    this.items = []; this.groups = []; this.active = undefined; this.signature = '';
    byId('task-list').replaceChildren(el('p', 'small muted', hasWorkspace ? 'Loading tasks…' : 'Open a project to begin.'));
    this.selected(undefined);
  }

  async reload(): Promise<void> {
    if (!this.workspace || this.disposed) return;
    const generation = this.generation;
    const request = ++this.request;
    try {
      const items = await window.relay.listAllSessions();
      if (generation !== this.generation || request !== this.request || this.disposed) return;
      this.items = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
      this.groups = groupTasks(this.items, this.workspaces, this.currentId);
      const wanted = this.queued || this.active?.id;
      this.queued = '';
      this.active = this.items.find(item => item.id === wanted) ?? this.groups[0]?.sessions[0];
      this.render(); this.selected(this.active);
    } catch (error) {
      if (generation !== this.generation || request !== this.request || this.disposed) return;
      this.signature = '';
      const failure = el('div');
      failure.append(el('p', 'inline-error', `Could not load tasks: ${errorText(error)}`), button('Retry', () => this.reload()));
      byId('task-list').replaceChildren(failure);
    }
  }

  select(id: string): void {
    const session = this.items.find(item => item.id === id);
    if (!session) return;
    this.active = session; this.render(); this.selected(session, true);
  }

  open(id: string): void {
    const session = this.items.find(item => item.id === id);
    if (!session) return;
    const group = this.groups.find(item => item.sessions.some(candidate => candidate.id === id));
    if (group && !group.current && group.path) {
      this.queued = id;
      void this.openFolder(group.id).then(opened => { if (!opened) this.queued = ''; });
      return;
    }
    this.select(id);
  }

  async create(): Promise<void> {
    if (!this.workspace || this.creating) return;
    this.creating = true;
    const generation = this.generation;
    try {
      const session = await window.relay.createSession();
      if (generation !== this.generation || this.disposed) return;
      this.items = [session, ...this.items.filter(item => item.id !== session.id)];
      this.regroup();
      this.active = session; this.render(); this.selected(session, true);
    } finally { this.creating = false; }
  }

  async fork(messageId: string): Promise<void> {
    const session = this.active;
    if (!session || this.disposed) return;
    const forked = await window.relay.forkSession(session.id, messageId);
    if (this.disposed) return;
    const linked = forked.fork ? forked : { ...forked, fork: { sessionId: session.id } };
    this.items = [linked, ...this.items.filter(item => item.id !== linked.id)];
    this.regroup();
    this.active = linked; this.render(); this.selected(linked, true);
  }

  menu(): void {
    const session = this.active;
    if (!session) return;
    const generation = this.generation;
    const modal = dialog('Task');
    modal.add(el('p', '', session.title));
    modal.add(button('Rename task', () => {
      modal.root.close();
      askText('Rename task', session.title, async title => {
        await window.relay.renameSession(session.id, title);
        if (generation === this.generation) await this.reload();
      });
    }), button('Archive task', async () => {
      modal.busy(true);
      try {
        await window.relay.archiveSession(session.id);
        modal.root.close();
        if (generation === this.generation) {
          this.items = this.items.filter(item => item.id !== session.id);
          if (this.active?.id === session.id) this.active = undefined;
          await this.reload();
        }
      } catch (error) { modal.fail(error); }
      finally { modal.busy(false); }
    }), button('Delete task', async () => {
      if (!await confirmAction('Delete task?', `Delete “${session.title}” and its conversation? This cannot be undone. Workspace files are not reverted.`, 'Delete task')) return;
      modal.busy(true);
      try {
        await window.relay.deleteSession(session.id);
        modal.root.close();
        if (generation === this.generation) {
          this.items = this.items.filter(item => item.id !== session.id);
          if (this.active?.id === session.id) this.active = undefined;
          await this.reload();
        }
      } catch (error) { modal.fail(error); }
      finally { modal.busy(false); }
    }, 'button danger'));
  }

  private regroup(): void {
    this.groups = groupTasks(this.items, this.workspaces, this.currentId);
  }

  private render(): void {
    const signature = this.snapshot();
    if (signature === this.signature) return;
    this.signature = signature;
    const list = byId('task-list');
    if (!this.groups.length) { list.replaceChildren(el('p', 'small muted', 'No tasks yet. Create your first task.')); return; }
    list.replaceChildren(...this.groups.map(group => this.group(group)));
  }

  private snapshot(): string {
    return JSON.stringify([this.groups, this.active?.id, [...this.collapsed].sort()]);
  }

  private group(group: TaskGroup): HTMLElement {
    const node = el('section', 'task-group');
    node.dataset.group = group.id;
    if (group.current) node.classList.add('current');
    const head = el('div', 'task-group-head');
    const toggle = el('button', 'task-group-toggle');
    toggle.type = 'button';
    const body = el('div', 'task-group-body');
    const inner = el('div', 'task-group-inner');
    const syncBody = (open: boolean) => {
      body.classList.toggle('collapsed', !open);
      body.toggleAttribute('inert', !open);
      body.setAttribute('aria-hidden', String(!open));
    };
    const syncToggle = (open: boolean) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.title = open ? `Hide tasks in ${group.name}` : `Show tasks in ${group.name}`;
      toggle.replaceChildren(
        el('span', `task-group-chevron${open ? ' open' : ''}`, '›'),
        fileIconElement(group.name, true, open),
        el('span', 'task-group-name', group.name),
      );
      if (group.sessions.length) toggle.append(el('span', 'task-group-count', String(group.sessions.length)));
    };
    const expanded = !this.collapsed.has(group.id);
    syncToggle(expanded);
    syncBody(expanded);
    toggle.addEventListener('click', () => {
      const open = !this.collapsed.has(group.id);
      if (open) this.collapsed.add(group.id); else this.collapsed.delete(group.id);
      syncToggle(!open);
      syncBody(!open);
      this.signature = this.snapshot();
    });
    head.append(toggle);
    if (!group.current && group.path) {
      const open = button('↗', () => { this.openFolderGroup(group); }, 'task-group-open');
      open.title = `Open ${group.path}`;
      open.setAttribute('aria-label', `Switch to folder ${group.name}`);
      head.append(open);
    }
    node.append(head);
    const forest = forkForest(group.sessions);
    if (forest.length) {
      const titles = new Map(group.sessions.map(session => [session.id, session.title]));
      forest.forEach(node => inner.append(this.task(node, titles)));
    } else inner.append(el('p', 'small muted task-group-empty', group.current ? 'No tasks in this folder yet.' : 'No tasks yet.'));
    body.append(inner);
    node.append(body);
    return node;
  }

  private openFolderGroup(group: TaskGroup): void {
    this.queued = group.sessions[0]?.id ?? '';
    void this.openFolder(group.id).then(opened => { if (!opened) this.queued = ''; });
  }

  private task(node: ForkNode, titles: Map<string, string>): HTMLElement {
    const { session, depth, last, lanes, branches } = node;
    const wrapper = el('div', 'task-node');
    wrapper.dataset.session = session.id;
    wrapper.dataset.depth = String(depth);
    wrapper.dataset.last = String(last);
    if (depth) wrapper.style.paddingLeft = `${depth * LANE_GAP}px`;
    lanes.forEach((open, index) => {
      if (!open) return;
      const lane = el('span', 'task-rail');
      lane.style.left = `${index * LANE_GAP + LANE_LEFT}px`;
      wrapper.append(lane);
    });
    if (depth > 0) {
      const from = (depth - 1) * LANE_GAP + LANE_LEFT;
      const elbow = el('span', 'task-elbow');
      elbow.style.left = `${from}px`;
      elbow.style.width = `${LANE_GAP}px`;
      wrapper.append(elbow);
      if (!last) {
        const lane = el('span', 'task-rail continuing');
        lane.style.left = `${from}px`;
        lane.style.top = `${DOT_CENTER}px`;
        wrapper.append(lane);
      }
    }
    if (branches > 0) {
      const lane = el('span', 'task-rail continuing');
      lane.style.left = `${depth * LANE_GAP + LANE_LEFT}px`;
      lane.style.top = `${DOT_CENTER}px`;
      wrapper.append(lane);
    }
    const control = button('', () => this.open(session.id), 'task-button');
    control.dataset.session = session.id;
    const active = session.id === this.active?.id;
    control.classList.toggle('active', active);
    if (active) control.setAttribute('aria-current', 'true');
    const forked = Boolean(session.fork);
    if (forked) control.classList.add('forked');
    control.append(session.status === 'running' ? taskLoader() : el('span', `task-dot ${session.status}${forked ? ' forked' : ''}`));
    const copy = el('span', 'task-copy');
    const date = new Date(session.updatedAt);
    const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const state = session.status === 'running' ? 'Running' : session.status === 'error' ? 'Error' : 'Idle';
    const parentTitle = session.fork ? titles.get(session.fork.sessionId) ?? 'an earlier task' : '';
    const meta = parentTitle ? `⑂ ${parentTitle}${state === 'Idle' ? '' : ` · ${state}`}` : state;
    copy.append(el('span', 'task-name', session.title), el('span', 'task-time', `${meta}${when ? ` · ${when}` : ''}`));
    control.append(copy);
    if (branches) {
      const badge = el('span', 'task-branch-count');
      badge.append(branchGlyph(), el('span', '', String(branches)));
      badge.title = `${branches} branch${branches === 1 ? '' : 'es'} from this task`;
      control.append(badge);
    }
    control.title = parentTitle ? `${session.title} — branched from ${parentTitle}` : session.title;
    wrapper.append(control);
    return wrapper;
  }

  dispose(): void { this.disposed = true; this.generation++; }
}
