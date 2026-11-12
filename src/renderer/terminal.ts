import type { Terminal, IDisposable } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { AppEvent } from '../shared/contracts';
import { byId, errorText, report } from './dom';
import '@xterm/xterm/css/xterm.css';

export class TerminalView {
  private terminal?: Terminal;
  private fit?: FitAddon;
  private id?: string;
  private opening?: Promise<void>;
  private closing = false;
  private observer?: ResizeObserver;
  private subscriptions: IDisposable[] = [];
  private pending: Array<Extract<AppEvent, { type: 'terminal-data' | 'terminal-exit' }>> = [];
  private writes: Promise<void> = Promise.resolve();
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private exited = false;
  private disposed = false;

  constructor() {
    byId('close-terminal').addEventListener('click', () => void this.close().catch(error => report('Could not close terminal. Try again', error)));
  }
  get active(): boolean { return !!this.id || !!this.opening; }

  async open(): Promise<void> {
    if (this.disposed || this.closing) return;
    if (this.id && !this.exited) { this.terminal?.focus(); return; }
    if (this.opening) return this.opening;
    if (this.exited) await this.close();
    this.opening = this.start();
    try { await this.opening; } finally { this.opening = undefined; this.pending = []; }
  }

  private async start(): Promise<void> {
    byId('terminal').hidden = false;
    byId('app').classList.add('terminal-open');
    byId('terminal-status').textContent = 'Opening shell…';
    try {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (this.disposed) return;
      this.terminal = new Terminal({ fontFamily: 'SFMono-Regular, Menlo, monospace', fontSize: 11, cursorBlink: false, scrollback: 5000, allowProposedApi: false, screenReaderMode: true });
      this.fit = new FitAddon(); this.terminal.loadAddon(this.fit);
      byId('terminal-host').replaceChildren();
      this.terminal.open(byId('terminal-host'));
      this.theme(); this.fit.fit();
      const { id } = await window.relay.createTerminal(this.terminal.cols, this.terminal.rows);
      if (this.disposed) { await window.relay.closeTerminal(id); return; }
      this.id = id; this.exited = false;
      this.subscriptions.push(this.terminal.onData(data => {
        this.writes = this.writes.then(async () => {
          if (this.id === id && !this.exited) await window.relay.writeTerminal(id, data);
        }).catch(error => { byId('terminal-status').textContent = `Input failed: ${errorText(error)}. Retry input or reopen terminal.`; });
      }));
      this.subscriptions.push(this.terminal.onResize(size => this.resize(size.cols, size.rows)));
      this.observer = new ResizeObserver(() => this.fit?.fit()); this.observer.observe(byId('terminal-host'));
      byId('terminal-status').textContent = 'Local shell';
      byId('terminal-button').setAttribute('aria-label', 'Focus terminal');
      this.pending.forEach(event => this.event(event)); this.pending = [];
      this.terminal.focus();
    } catch (error) {
      this.cleanup();
      byId('terminal-status').textContent = `Terminal could not open: ${errorText(error)}. Use Open terminal to retry.`;
      throw error;
    }
  }

  private resize(cols: number, rows: number): void {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      if (!this.id || this.exited) return;
      void window.relay.resizeTerminal(this.id, cols, rows).catch(error => {
        byId('terminal-status').textContent = `Resize failed: ${errorText(error)}. Resize the panel to retry.`;
      });
    }, 60);
  }

  event(event: AppEvent): void {
    if (event.type !== 'terminal-data' && event.type !== 'terminal-exit') return;
    if (!this.id && this.opening) {
      if (this.pending.length < 1000) this.pending.push(event);
      return;
    }
    if (event.id !== this.id) return;
    if (event.type === 'terminal-data') this.terminal?.write(event.data);
    else {
      this.exited = true;
      if (this.terminal) this.terminal.options.disableStdin = true;
      byId('terminal-status').textContent = `Shell exited (${event.code}) · Open terminal to restart`;
    }
  }

  theme(): void {
    if (!this.terminal) return;
    const style = getComputedStyle(document.documentElement);
    this.terminal.options.theme = {
      background: style.getPropertyValue('--panel').trim(), foreground: style.getPropertyValue('--text').trim(),
      cursor: style.getPropertyValue('--blue').trim(), selectionBackground: style.getPropertyValue('--blue-fill').trim(),
    };
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const control = byId<HTMLButtonElement>('close-terminal'); control.disabled = true;
    try {
      await this.opening;
      if (this.id && !this.exited) await window.relay.closeTerminal(this.id);
      this.id = undefined; this.exited = false;
      this.cleanup(); byId('terminal').hidden = true; byId('app').classList.remove('terminal-open');
      byId('terminal-button').setAttribute('aria-label', 'Open terminal');
    } finally { this.closing = false; control.disabled = false; }
  }
  private cleanup(): void {
    clearTimeout(this.resizeTimer); this.observer?.disconnect(); this.observer = undefined;
    this.subscriptions.forEach(subscription => subscription.dispose()); this.subscriptions = [];
    this.terminal?.dispose(); this.terminal = undefined; this.fit = undefined;
  }
  dispose(): void {
    this.disposed = true;
    if (this.id && !this.exited) void window.relay.closeTerminal(this.id).catch(() => {});
    this.id = undefined; this.cleanup();
  }
}
