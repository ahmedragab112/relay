import type { editor, IDisposable } from 'monaco-editor';
import type { FileDocument } from '../shared/contracts';
import { byId, el, errorText } from './dom';
import { confirmAction } from './dialog';
import { isDirty } from './state';
import { language, loadMonaco } from './monaco';
import { shortcutLabel } from './shortcuts';

export class FileEditor {
  private host = byId('editor-host');
  private instance?: editor.IStandaloneCodeEditor;
  private model?: editor.ITextModel;
  private listener?: IDisposable;
  private observer?: ResizeObserver;
  private document?: FileDocument;
  private generation = 0;
  private saving = false;
  private opening = false;
  private disposed = false;

  constructor() {
    byId('save-file').addEventListener('click', () => void this.save());
    byId('reload-file').addEventListener('click', () => { if (this.document) void this.open(this.document.path, true); });
  }

  get path(): string | undefined { return this.document?.path; }
  get dirty(): boolean { return isDirty(this.document, this.model?.getValue() ?? ''); }
  async canLeave(): Promise<boolean> {
    if (this.saving) { byId('editor-state').textContent = 'Wait for the current save to finish before switching.'; return false; }
    return !this.dirty || await confirmAction('Discard unsaved edits?', `${this.path} has unsaved changes. Save the file first to keep them, or discard your edits.`, 'Discard edits');
  }

  async open(path: string, reload = false, line?: number): Promise<void> {
    if (this.opening || this.disposed || (this.path === path && !reload)) { if (line) this.reveal(line); return; }
    this.opening = true;
    try {
      if (!await this.canLeave()) return;
      const generation = ++this.generation;
      byId('editor-state').textContent = 'Loading file…';
      const [document, monaco] = await Promise.all([window.relay.readFile(path), loadMonaco()]);
      if (generation !== this.generation || this.disposed) return;
      this.disposeInstance();
      this.host.replaceChildren();
      this.document = document;
      this.model = monaco.editor.createModel(document.content, language(path));
      this.instance = monaco.editor.create(this.host, {
        model: this.model, fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 12,
        minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: false,
        padding: { top: 12 }, renderLineHighlight: 'none', lineNumbersMinChars: 3,
        wordWrap: 'off', links: false, contextmenu: false,
      });
      this.listener = this.model.onDidChangeContent(() => this.sync());
      this.observer = new ResizeObserver(() => this.instance?.layout());
      this.observer.observe(this.host);
      this.sync(); this.instance.focus();
      if (line) this.reveal(line);
    } catch (error) {
      byId('editor-state').textContent = `Could not open file: ${errorText(error)}. Select the file to retry.`;
    } finally { this.opening = false; }
  }

  reveal(line: number): void {
    if (!this.instance || !this.model) return;
    const target = Math.min(Math.max(1, Math.trunc(line)), this.model.getLineCount());
    this.instance.revealLineInCenter(target);
    this.instance.setPosition({ lineNumber: target, column: 1 });
    this.instance.focus();
  }

  async save(): Promise<void> {
    if (!this.document || !this.model || this.saving || !this.dirty) return;
    const document = this.document;
    const content = this.model.getValue();
    const generation = this.generation;
    this.saving = true; this.sync();
    try {
      const saved = await window.relay.saveFile(document.path, content, document.revision);
      if (generation !== this.generation) return;
      this.document = saved;
      // Keep keystrokes entered while IPC was saving the previous snapshot.
      if (this.model?.getValue() === content && saved.content !== content) this.model.setValue(saved.content);
      this.saving = false; this.sync();
      byId('editor-state').textContent = this.dirty ? 'Earlier revision saved. Newer edits are still unsaved.' : 'Saved';
    } catch (error) {
      this.saving = false; this.sync();
      byId('editor-state').textContent = `Save failed: ${errorText(error)}. Edits are preserved. If the file changed on disk, copy your edits before Reload; otherwise retry Save.`;
    } finally { this.saving = false; }
  }

  private sync(): void {
    const dirty = this.dirty;
    byId('editor-path').textContent = this.document ? `${this.document.path}${dirty ? ' •' : ''}` : 'No file selected';
    byId<HTMLButtonElement>('save-file').disabled = !dirty || this.saving;
    byId<HTMLButtonElement>('reload-file').disabled = !this.document || this.saving;
    byId('editor-state').textContent = this.saving ? 'Saving…' : dirty ? `Unsaved changes · ${shortcutLabel(document.documentElement.dataset.platform ?? 'darwin', 'Mod+S')} to save` : this.document ? 'All edits saved' : '';
  }

  reset(): void {
    this.generation++;
    this.document = undefined;
    this.disposeInstance();
    this.host.replaceChildren(el('p', 'panel-empty', 'Open a project file to edit.'));
    this.sync();
  }
  private disposeInstance(): void {
    this.observer?.disconnect(); this.listener?.dispose();
    this.instance?.dispose(); this.model?.dispose();
    this.observer = undefined; this.listener = undefined; this.instance = undefined; this.model = undefined;
  }
  dispose(): void { this.disposed = true; this.reset(); }
}
