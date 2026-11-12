import { byId, errorText } from './dom';

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void;
}

type NavigationEvent = Event & { title?: string; errorDescription?: string; isMainFrame?: boolean };

export function normalizeAddress(input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  const accept = (url: URL) => url.protocol === 'http:' || url.protocol === 'https:'
    ? (url.username || url.password ? undefined : url.href)
    : undefined;
  let parsed: URL | undefined;
  try { parsed = new URL(value); } catch { /* shorthand address */ }
  if (parsed) {
    const direct = accept(parsed);
    if (direct) return direct;
    // Bare host:port parses as a scheme; still treat it as an address.
    if (!/^[a-z0-9.-]+:\d+(?:\/|$)/i.test(value)) return undefined;
  }
  try { return accept(new URL(`https://${value}`)); } catch { return undefined; }
}

export class BrowserPane {
  private stage = byId('browser-stage');
  private form = byId<HTMLFormElement>('browser-bar');
  private address = byId<HTMLInputElement>('browser-url');
  private status = byId('browser-status');
  private back = byId<HTMLButtonElement>('browser-back');
  private forward = byId<HTMLButtonElement>('browser-forward');
  private reload = byId<HTMLButtonElement>('browser-reload');
  private view?: WebviewElement;
  private current = '';
  private title = '';
  private loading = false;
  private failed = false;
  private ready = false;
  private pending = '';

  constructor() {
    this.form.addEventListener('submit', event => { event.preventDefault(); this.open(this.address.value); });
    this.back.addEventListener('click', () => this.view?.goBack());
    this.forward.addEventListener('click', () => this.view?.goForward());
    this.reload.addEventListener('click', () => {
      if (!this.view) return;
      if (this.loading) this.view.stop(); else this.view.reload();
    });
    this.address.addEventListener('focus', () => this.address.select());
  }

  setActive(active: boolean): void {
    if (active && !this.view) this.create();
  }

  focus(): void {
    this.create();
    this.address.focus();
  }

  open(input: string): void {
    const target = normalizeAddress(input);
    if (!target) {
      this.status.textContent = 'Enter an http or https address.';
      this.status.classList.add('error');
      this.address.focus();
      return;
    }
    this.create();
    this.stage.classList.add('live');
    this.status.classList.remove('error');
    this.status.textContent = 'Loading…';
    this.current = target;
    this.address.value = target;
    this.navigate(target);
  }

  private navigate(target: string): void {
    const view = this.view;
    if (!view) return;
    if (!this.ready) { this.pending = target; return; }
    try { void view.loadURL(target).catch(error => this.fail(error)); }
    catch (error) { this.fail(error); }
  }

  private fail(error: unknown): void {
    this.failed = true;
    this.status.classList.add('error');
    this.status.textContent = `Could not open the page: ${errorText(error)}`;
  }

  private create(): void {
    if (this.view) return;
    const view = document.createElement('webview') as WebviewElement;
    view.setAttribute('partition', 'persist:relay-browser');
    view.setAttribute('src', 'about:blank');
    view.setAttribute('aria-label', 'Embedded web page');
    view.addEventListener('did-start-loading', () => {
      this.loading = true;
      this.failed = false;      this.title = '';
      this.reload.textContent = '×';
      this.reload.setAttribute('aria-label', 'Stop loading');
      this.status.classList.remove('error');
      this.status.textContent = 'Loading…';
    });
    view.addEventListener('did-stop-loading', () => {
      this.loading = false;
      this.reload.textContent = '↻';
      this.reload.setAttribute('aria-label', 'Reload page');
      this.sync();
      if (!this.failed) this.status.textContent = this.title || this.current;
    });
    view.addEventListener('did-navigate', () => this.sync());
    view.addEventListener('did-navigate-in-page', () => this.sync());
    view.addEventListener('page-title-updated', event => {
      const title = (event as NavigationEvent).title?.trim();
      if (!title) return;
      this.title = title;
      if (!this.failed) this.status.textContent = title;
    });
    view.addEventListener('did-fail-load', event => {
      const failure = event as NavigationEvent;
      if (failure.isMainFrame === false) return;
      this.failed = true;
      this.status.classList.add('error');
      this.status.textContent = `Could not load the page: ${failure.errorDescription ?? 'unknown error'}.`;
    });
    view.addEventListener('dom-ready', () => {
      this.ready = true;
      const pending = this.pending;
      this.pending = '';
      if (pending) this.navigate(pending);
    });
    this.stage.append(view);
    this.view = view;
    this.sync();
  }

  private sync(): void {
    if (!this.view || !this.ready) return;
    const url = this.view.getURL();
    if (url && url !== 'about:blank') {
      this.current = url;
      if (document.activeElement !== this.address) this.address.value = url;
    }
    this.back.disabled = !this.view.canGoBack();
    this.forward.disabled = !this.view.canGoForward();
    this.reload.disabled = !this.current;
  }

  dispose(): void {
    this.view?.remove();
    this.view = undefined;
    this.ready = false;
    this.pending = '';
  }
}
