import type { editor } from 'monaco-editor';
import type { FileChange, FileEntry } from '../shared/contracts';
import { ActivityView } from './activity';
import { byId, button, el, errorText, notify } from './dom';
import { confirmAction } from './dialog';
import { BrowserPane } from './browser';
import { FileEditor } from './editor';
import { fileIconElement } from './file-icons';
import { language, loadMonaco } from './monaco';
import { followTab, parsePatch } from './state';

const TABS = ['activity', 'changes', 'files', 'browser'] as const;
type InspectorTab = typeof TABS[number];

export class Inspector {
  readonly editor = new FileEditor();
  readonly browser = new BrowserPane();
  readonly activity: ActivityView;
  private workspaceId = '';
  private sessionId = '';
  private generation = 0;
  private diffGeneration = 0;
  private diffRequest = 0;
  private diff?: editor.IStandaloneDiffEditor;
  private models: editor.ITextModel[] = [];
  private observer?: ResizeObserver;
  private selectedPath = '';
  private signature = '';
  private peekTimer?: number;
  private changes: FileChange[] = [];
  private scope = byId<HTMLSelectElement>('diff-scope');
  private ready = false;
  private disposed = false;
  private userSelectedTab = false;
  private turnActive = false;
  private browserUsed = false;
  private active: InspectorTab = 'activity';

  get currentTab(): InspectorTab { return this.active; }

  constructor(private readonly openTask: (id: string) => void = () => {}) {
    this.activity = new ActivityView(byId('activity-body'), path => this.openPath(path), openTask);
    TABS.forEach(tab => {
      const control = byId(`tab-${tab}`);
      control.addEventListener('click', () => this.tab(tab));
      control.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const available = TABS.filter(name => !byId(`tab-${name}`).hidden);
        const index = available.indexOf(tab);
        if (index < 0) return;
        const next = event.key === 'Home' ? available[0] : event.key === 'End' ? available[available.length - 1]
          : available[(index + (event.key === 'ArrowRight' ? 1 : available.length - 1)) % available.length];
        this.tab(next); byId(`tab-${next}`).focus();
      });
    });
    this.scope.addEventListener('change', () => { this.signature = ''; void this.reloadChanges(); });
    byId('refresh-files').addEventListener('click', () => void this.refresh());
    byId('diff-open').addEventListener('click', () => this.openSelected());
    this.syncBrowserTab();
  }

  openSelected(): void {
    if (!this.selectedPath) return;
    this.tab('files');
    void this.editor.open(this.selectedPath);
  }

  reviewSession(): void {
    this.scope.value = 'session';
    this.signature = '';
    this.clearDiff();
    this.tab('changes');
    byId('diff-view').focus();
  }

  openPath(path: string, line?: number): void {
    this.tab('files');
    void this.editor.open(path, false, line);
  }

  // Clicking a tab is the reader taking control: the agent stops steering the view for the
  // rest of the turn.
  tab(tab: InspectorTab): void {
    this.userSelectedTab = true;
    this.show(tab);
  }

  private show(tab: InspectorTab): void {
    if (tab === 'browser') this.browserUsed = true;
    this.syncBrowserTab();
    this.showTab(tab);
    this.refreshTab(tab);
  }

  // A turn starting resets the reader's override so the inspector can follow the agent
  // again. Further signals within the turn respect it.
  beginTurn(): void {
    if (this.turnActive) return;
    this.turnActive = true;
    this.userSelectedTab = false;
    this.follow('turn-start');
  }

  endTurn(): void { this.turnActive = false; }

  follow(signal: 'turn-start' | 'edit' | 'page'): void {
    if (signal !== 'page' && !this.turnActive) return;
    const target = followTab(signal, this.userSelectedTab);
    if (target) this.show(target);
  }

  // The agent (or an automation) opened a page: the browser tab appears and takes the view.
  openPage(url: string): void {
    this.browserUsed = true;
    this.show('browser');
    this.browser.open(url);
  }

  // "Open in-app browser" from the palette is a reader action, so it also hands control over.
  openBrowser(): void {
    this.userSelectedTab = true;
    this.browserUsed = true;
    this.show('browser');
    this.browser.focus();
  }

  private syncBrowserTab(): void {
    byId<HTMLButtonElement>('tab-browser').hidden = !this.browserUsed;
    if (!this.browserUsed && this.active === 'browser') this.showTab('activity');
  }

  private refreshTab(tab: InspectorTab): void {
    if (tab === 'activity') void this.activity.reload();
    else if (tab === 'changes') { this.signature = ''; void this.reloadChanges(); }
    else if (tab === 'files') void this.reloadTree();
  }

  private showTab(tab: InspectorTab): void {
    this.active = tab;
    for (const name of TABS) {
      byId(`${name}-panel`).hidden = name !== tab;
      byId(`tab-${name}`).setAttribute('aria-selected', String(name === tab));
      byId(`tab-${name}`).tabIndex = name === tab ? 0 : -1;
    }
    this.browser.setActive(tab === 'browser');
  }

  setReady(ready: boolean): void {
    if (ready === this.ready) return;
    this.ready = ready;
    if (this.workspaceId) void this.reloadChanges();
    this.activity.setReady(ready);
  }

  setWorkspace(id: string): void {
    if (id === this.workspaceId) return;
    this.workspaceId = id; this.sessionId = ''; this.generation++;
    this.editor.reset(); this.clearDiff(); this.selectedPath = ''; this.signature = '';
    byId('file-tree').replaceChildren(); byId('change-list').replaceChildren();
    this.activity.setSession('');
    this.browserUsed = false; this.turnActive = false; this.userSelectedTab = false;
    this.syncBrowserTab();
    void this.refresh();
  }
  setSession(id: string): void {
    if (id === this.sessionId) return;
    this.sessionId = id;
    this.activity.setSession(id);
    if (id && !this.userSelectedTab) this.showTab('activity');
    if (this.scope.value === 'session') { this.signature = ''; this.clearDiff(); }
    void this.reloadChanges();
  }

  async refresh(): Promise<void> {
    await Promise.all([this.reloadTree(), this.reloadChanges(), this.activity.reload()]);
  }
  async reloadChanges(): Promise<void> {
    const request = ++this.diffRequest;
    if (!this.ready) {
      this.clearDiff(); this.signature = '';
      byId('change-list').replaceChildren();
      byId('diff-path').textContent = this.workspaceId ? 'Engine starting' : 'No file selected';
      byId('diff-view').replaceChildren(el('p', 'panel-empty', this.workspaceId ? 'Changes appear once the local engine is ready.' : 'Open a project to inspect changes.'));
      return;
    }
    if (!this.workspaceId || (this.scope.value === 'session' && !this.sessionId)) {
      byId('change-list').replaceChildren();
      this.clearDiff();
      byId('diff-view').replaceChildren(el('p', 'panel-empty', this.workspaceId ? 'Select a task to inspect its changes.' : 'Open a project to inspect changes.'));
      return;
    }
    const generation = this.generation;
    const list = byId('change-list');
    if (!this.changes.length) list.replaceChildren(el('p', 'small muted', 'Loading changes…'));
    try {
      // Empty session ID requests the current workspace diff through preload.
      const changes = await window.relay.getChanges(this.scope.value === 'workspace' ? '' : this.sessionId);
      if (request !== this.diffRequest || generation !== this.generation || this.disposed) return;
      this.changes = changes;
      list.replaceChildren(...changes.map(change => {
        const row = el('div', 'change-row');
        const control = button('', () => this.showChange(change), 'file-row');
        control.classList.toggle('active', change.path === this.selectedPath);
        control.append(fileIconElement(change.path.split('/').pop() ?? change.path, false), el('span', 'truncate', change.path));
        const counts = el('span', 'counts');
        counts.append(el('span', 'added', `+${change.additions}`), document.createTextNode(' '), el('span', 'removed', `−${change.deletions}`));
        control.append(counts); control.title = change.path;
        control.addEventListener('mouseenter', () => this.showPeek(change));
        control.addEventListener('focus', () => this.showPeek(change));
        control.addEventListener('mouseleave', () => this.hidePeek());
        control.addEventListener('blur', () => this.hidePeek());
        const review = button('Review', () => { void this.showChange(change); byId('diff-view').focus(); }, 'change-action');
        review.setAttribute('aria-label', `Review ${change.path}`);
        const undo = button('Undo', () => void this.undo(change), 'change-action undo');
        undo.setAttribute('aria-label', `Undo changes to ${change.path}`);
        const actions = el('div', 'change-actions');
        actions.append(review, undo);
        row.append(control, actions);
        return row;
      }));
      if (!changes.length) {
        this.clearDiff(); this.signature = '';
        byId('diff-path').textContent = 'No changes';
        byId('diff-view').replaceChildren(el('p', 'panel-empty', 'No file changes in this scope.'));
      } else await this.showChange(changes.find(change => change.path === this.selectedPath) ?? changes[0]);
    } catch (error) {
      if (request !== this.diffRequest || generation !== this.generation) return;
      list.replaceChildren(el('p', 'inline-error', `Changes unavailable: ${errorText(error)}`), button('Retry', () => this.reloadChanges()));
    }
  }

  private async undo(change: FileChange): Promise<void> {
    if (this.editor.path === change.path && this.editor.dirty && !await this.editor.canLeave()) return;
    this.hidePeek();
    const confirmed = await confirmAction(
      'Undo changes?',
      `Relay restores ${change.path} to its last committed version. A new file is removed. This cannot be undone.`,
      'Undo changes',
    );
    if (!confirmed) return;
    try {
      const result = await window.relay.undoChange(change.path);
      this.signature = '';
      await Promise.all([this.reloadChanges(), this.reloadTree()]);
      notify(result === 'deleted' ? `Removed ${change.path}.` : `Restored ${change.path}.`);
    } catch (error) {
      notify(`Could not undo ${change.path}. ${errorText(error)}`, true);
    }
  }

  private async showChange(change: FileChange): Promise<void> {
    const signature = JSON.stringify(change);
    if (signature === this.signature) return;
    this.signature = signature; this.selectedPath = change.path;
    this.hidePeek();
    this.clearDiff();
    byId<HTMLButtonElement>('diff-open').disabled = false;
    const generation = this.diffGeneration;
    byId('diff-path').textContent = change.path;
    const host = byId('diff-view');
    host.replaceChildren();
    Array.from(byId('change-list').querySelectorAll('.file-row')).forEach((row, index) => row.classList.toggle('active', this.changes[index]?.path === change.path));
    const patch = (change as FileChange & { patch?: string }).patch;
    if (patch !== undefined) {
      host.append(...parsePatch(patch).map(line => el('div', `patch-line ${line.kind}`, line.text)));
      return;
    }
    host.append(el('p', 'panel-empty', 'Loading diff editor…'));
    try {
      const monaco = await loadMonaco();
      if (generation !== this.diffGeneration || this.disposed) return;
      host.replaceChildren();
      this.models = [monaco.editor.createModel(change.before, language(change.path)), monaco.editor.createModel(change.after, language(change.path))];
      this.diff = monaco.editor.createDiffEditor(host, {
        readOnly: true, originalEditable: false, renderSideBySide: false, minimap: { enabled: false },
        fontSize: 11, fontFamily: 'SFMono-Regular, Menlo, monospace', scrollBeyondLastLine: false,
        automaticLayout: false, contextmenu: false, links: false,
      });
      this.diff.setModel({ original: this.models[0], modified: this.models[1] });
      this.observer = new ResizeObserver(() => this.diff?.layout()); this.observer.observe(host);
    } catch (error) {
      if (generation !== this.diffGeneration) return;
      this.signature = '';
      host.replaceChildren(el('p', 'inline-error', `Diff editor failed: ${errorText(error)}`), button('Retry', () => this.showChange(change)));
    }
  }

  // Hover/focus preview avoids re-creating the full Monaco diff on every row.
  private showPeek(change: FileChange): void {
    if (change.path === this.selectedPath) return;
    window.clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => this.renderPeek(change), 140);
  }

  private hidePeek(): void {
    window.clearTimeout(this.peekTimer);
    const peek = byId('diff-peek');
    if (peek.hidden) return;
    peek.hidden = true;
    peek.replaceChildren();
  }

  private renderPeek(change: FileChange): void {
    if (this.disposed || change.path === this.selectedPath) return;
    const peek = byId('diff-peek');
    const head = el('div', 'peek-head');
    head.append(el('span', 'truncate', change.path));
    const counts = el('span', 'counts');
    counts.append(el('span', 'added', `+${change.additions}`), document.createTextNode(' '), el('span', 'removed', `−${change.deletions}`));
    head.append(counts);
    const body = el('div', 'peek-body');
    const patch = (change as FileChange & { patch?: string }).patch;
    if (patch === undefined) {
      body.append(el('p', 'small muted', 'Select this file to load its full diff.'));
    } else {
      const lines = parsePatch(patch).filter(line => line.kind !== 'meta');
      body.append(...lines.slice(0, 16).map(line => el('div', `patch-line ${line.kind}`, line.text)));
      if (lines.length > 16) body.append(el('p', 'peek-more small muted', `${lines.length - 16} more lines · select the file for the full diff`));
    }
    peek.replaceChildren(head, body);
    peek.hidden = false;
  }

  private async reloadTree(): Promise<void> {
    const root = byId('file-tree');
    const generation = this.generation;
    if (!this.workspaceId) { root.replaceChildren(el('p', 'small muted', 'Open a project to browse files.')); return; }
    root.replaceChildren(el('p', 'small muted', 'Loading project files…'));
    try {
      const files = await window.relay.listFiles();
      if (generation !== this.generation || this.disposed) return;
      root.replaceChildren(files.length ? this.tree(files, generation) : el('p', 'small muted', 'This folder is empty.'));
    } catch (error) {
      if (generation === this.generation) root.replaceChildren(el('p', 'inline-error', errorText(error)), button('Retry files', () => this.reloadTree()));
    }
  }

  private tree(files: FileEntry[], generation: number): HTMLElement {
    const list = el('ul');
    for (const file of [...files].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))) {
      const item = el('li');
      if (!file.directory) {
        const control = button('', () => this.editor.open(file.path), 'file-row');
        control.append(fileIconElement(file.name, false), el('span', 'file-name', file.name));
        control.title = file.path; item.append(control);
      } else {
        const details = el('details');
        const summary = el('summary');
        const closed = fileIconElement(file.name, true, false);
        const opened = fileIconElement(file.name, true, true);
        opened.hidden = true;
        summary.append(closed, opened, el('span', 'folder-name', file.name));
        details.append(summary);
        const children = el('div'); details.append(children);
        let loaded = false;
        let loading = false;
        const load = async () => {
          if (loading) return;
          loading = true;
          children.replaceChildren(el('p', 'small muted', 'Loading…'));
          try {
            const entries = await window.relay.listFiles(file.path);
            if (generation !== this.generation || this.disposed) return;
            children.replaceChildren(entries.length ? this.tree(entries, generation) : el('p', 'small muted', 'Empty folder'));
            loaded = true;
          } catch (error) { children.replaceChildren(el('p', 'inline-error', errorText(error)), button('Retry folder', load)); }
          finally { loading = false; }
        };
        details.addEventListener('toggle', () => {
          closed.hidden = details.open;
          opened.hidden = !details.open;
          if (details.open && !loaded) void load();
        });
        item.append(details);
      }
      list.append(item);
    }
    return list;
  }

  private clearDiff(): void {
    this.hidePeek();
    byId<HTMLButtonElement>('diff-open').disabled = true;
    this.diffGeneration++;
    this.observer?.disconnect(); this.diff?.dispose(); this.models.forEach(model => model.dispose());
    this.models = []; this.diff = undefined; this.observer = undefined;
  }
  dispose(): void {
    this.disposed = true; this.generation++;
    this.clearDiff(); this.activity.dispose(); this.browser.dispose(); this.editor.dispose();
  }
}
