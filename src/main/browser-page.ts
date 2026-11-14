/**
 * Electron driver for the agent browser: real tabs as main-process
 * WebContentsViews on an in-memory partition, driven over CDP
 * (`webContents.debugger`). No Chrome anywhere — Relay's own Electron is the
 * browser. Implements the `BrowserPageDriver` contract from browser.ts.
 */

import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderA11ySnapshot, type A11yNode } from './browser-snapshot.js';
import type { BrowserDialog, BrowserFile, BrowserPageDriver, ConsoleEntries, FormField, NetworkGetResult, NetworkList, NetworkRequestSummary, TabSummary } from './browser.js';

const VIEWPORT = { width: 1280, height: 800 };
const CONSOLE_LIMIT = 500;
const NETWORK_LIMIT = 200;
const DEFAULT_WAIT_MS = 10_000;
const MAX_WAIT_MS = 30_000;

interface NetworkRecord {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  timestampMs: number;
  statusCode?: number;
  state: 'pending' | 'completed' | 'failed';
  durationMs?: number;
  failure?: string;
  requestHeaders?: Array<{ name: string; value: string }>;
  responseHeaders?: Array<{ name: string; value: string }>;
  responseMime?: string;
  responseEncoding?: string;
}

interface TabRecord {
  id: string;
  view: WebContentsView;
  wc: WebContents;
  generation: number;
  loadError?: string;
  refs: Map<string, number>;
  console: ConsoleEntries['messages'];
  consoleDropped: number;
  network: NetworkRecord[];
  networkDropped: number;
  dialog: BrowserDialog | null;
  attached: boolean;
}

export function createBrowserDriver(input: { capturesDirectory: string }): BrowserPageDriver {
  const tabs = new Map<string, TabRecord>();
  let focused: string | null = null;
  let window: BrowserWindow | null = null;
  let captureSequence = 0;
  const capturesDirectory = input.capturesDirectory;
  const partition = `agent-browser-${randomUUID()}`;

  const summary = (tab: TabRecord): TabSummary => ({
    id: tab.id,
    url: tab.wc.getURL(),
    title: tab.wc.getTitle(),
    loading: tab.wc.isLoading(),
    ...(tab.loadError ? { loadError: tab.loadError } : {}),
    canGoBack: tab.wc.navigationHistory.canGoBack(),
    canGoForward: tab.wc.navigationHistory.canGoForward(),
    generation: tab.generation,
  });

  const summaryOf = (tabID: string): Promise<TabSummary> => {
    const tab = requireTab(tabID);
    return Promise.resolve(summary(tab));
  };

  function requireTab(tabID: string): TabRecord {
    const tab = tabs.get(tabID);
    if (!tab) throw new Error(`Unknown tab ${JSON.stringify(tabID)}. Call browser.tabs.list({}) for current tabs; a tab may have been closed.`);
    return tab;
  }

  function requireFocused(tabID: string): TabRecord {
    const tab = requireTab(tabID);
    if (focused !== tabID) {
      throw new Error(`Tab ${JSON.stringify(tabID)} is not the focused, visible tab. Call browser.tabs.focus({tabID: ${JSON.stringify(tabID)}}) first; screenshots need a visible page.`);
    }
    return tab;
  }

  /** CDP send with lazy (re)attach — the debugger can detach when targets go away. */
  async function cdp<T = unknown>(tab: TabRecord, method: string, params?: Record<string, unknown>): Promise<T> {
    if (!tab.attached) {
      tab.wc.debugger.attach('1.3');
      tab.wc.debugger.sendCommand('Page.enable').catch(() => undefined);
      tab.wc.debugger.sendCommand('Network.enable').catch(() => undefined);
      tab.attached = true;
    }
    return await tab.wc.debugger.sendCommand(method, params ?? {}) as T;
  }

  function createTab(url?: string): TabRecord {
    const id = `tab_${randomUUID()}`;
    const view = new WebContentsView({
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        devTools: false,
        backgroundThrottling: false,
        // Agent navigation must never steal the user's keyboard focus.
        focusOnNavigation: false,
      },
    });
    view.setBounds({ x: 0, y: 0, ...VIEWPORT });
    const wc = view.webContents;
    const tab: TabRecord = {
      id, view, wc, generation: 0, refs: new Map(),
      console: [], consoleDropped: 0, network: [], networkDropped: 0, dialog: null, attached: false,
    };
    tabs.set(id, tab);

    wc.setWindowOpenHandler(({ url: target }) => {
      // Popups become tabs of the same browser instead of OS windows.
      openNewTab(target);
      return { action: 'deny' };
    });

    wc.on('did-start-navigation', (electronEvent) => {
      const event = electronEvent as unknown as { isMainFrame?: boolean };
      if (!event.isMainFrame) return;
      tab.loadError = undefined;
      tab.dialog = null;
    });
    wc.on('did-navigate', () => { if (wc.getURL()) tab.generation += 1; });
    wc.on('did-navigate-in-page', () => { tab.generation += 1; });
    wc.on('did-fail-load', (electronEvent) => {
      const event = electronEvent as unknown as { isMainFrame?: boolean; errorCode?: number; errorDescription?: string };
      if (!event.isMainFrame || event.errorCode === -3) return; // -3 = aborted navigation
      tab.loadError = event.errorDescription || `Load failed (code ${event.errorCode})`;
    });
    wc.on('console-message', (event) => {
      const level = typeof event.level === 'string' ? event.level : 'info';
      const text = String(event.message ?? '').slice(0, 4000);
      if (tab.console.length >= CONSOLE_LIMIT) { tab.console.shift(); tab.consoleDropped += 1; }
      tab.console.push({
        id: `c${tab.console.length + tab.consoleDropped + 1}`,
        timestampMs: Date.now(),
        level: level === 'warning' ? 'warning' : level === 'error' ? 'error' : level === 'debug' ? 'debug' : 'info',
        text,
        textTruncated: text.length >= 4000,
        ...(event.sourceId ? { source: { url: String(event.sourceId), line: Number(event.lineNumber ?? 0), column: 0 } } : {}),
      });
    });

    wc.debugger.on('message', (_event: unknown, method: string, params: Record<string, unknown>) => {
      if (method === 'Page.javascriptDialogOpening') {
        tab.dialog = {
          type: String(params.type ?? 'alert'),
          message: String(params.message ?? '').slice(0, 10_000),
          defaultValue: String(params.defaultPrompt ?? ''),
        };
      } else if (method === 'Page.javascriptDialogClosed') {
        tab.dialog = null;
      } else if (method === 'Network.requestWillBeSent') {
      const incoming: NetworkRecord = {
        id: String(params.requestId),
        url: String((params.request as { url?: string })?.url ?? ''),
        method: String((params.request as { method?: string })?.method ?? 'GET'),
        resourceType: mapResourceType(String((params as { type?: string }).type ?? 'Other')),
        timestampMs: Number(params.timestamp ?? 0) * 1000,
        state: 'pending',
        requestHeaders: headerList((params.request as { headers?: Record<string, string> })?.headers),
      };
      const existing = tab.network.find((entry) => entry.id === incoming.id);
      if (existing) Object.assign(existing, incoming); // redirect chain: same requestId
      else pushNetwork(tab, incoming);
    } else if (method === 'Network.responseReceived') {
        const record = tab.network.find((entry) => entry.id === String(params.requestId));
        const response = params.response as { status?: number; headers?: Record<string, string>; mimeType?: string; encoding?: string };
        if (record) {
          record.state = 'completed';
          record.statusCode = response?.status;
          record.responseMime = response?.mimeType;
          record.responseEncoding = response?.encoding;
          record.durationMs = Math.max(0, Math.round((Number(params.timestamp ?? 0) * 1000) - record.timestampMs));
          record.responseHeaders = headerList(response?.headers);
        }
      } else if (method === 'Network.loadingFailed') {
        const record = tab.network.find((entry) => entry.id === String(params.requestId));
        if (record) {
          record.state = 'failed';
          record.durationMs = Math.max(0, Math.round((Number(params.timestamp ?? 0) * 1000) - record.timestampMs));
          record.failure = String(params.errorText ?? 'Failed');
        }
      }
    });
    wc.debugger.on('detach', () => { tab.attached = false; });

    if (url) void wc.loadURL(url).catch(() => undefined);
    // Capture network and dialogs from the very first request, not just from the first CDP action.
    void cdp(tab, 'Page.enable').catch(() => undefined);
    void cdp(tab, 'Network.enable').catch(() => undefined);
    return tab;
  }

  function pushNetwork(tab: TabRecord, record: NetworkRecord): void {
    if (tab.network.length >= NETWORK_LIMIT) { tab.network.shift(); tab.networkDropped += 1; }
    tab.network.push(record);
  }

  function headerList(headers: Record<string, string> | undefined): Array<{ name: string; value: string }> {
    if (!headers) return [];
    return Object.entries(headers).slice(0, 60).map(([name, value]) => ({ name, value: String(value).slice(0, 500) }));
  }

  function mapResourceType(type: string): string {
    const map: Record<string, string> = {
      Document: 'document', Stylesheet: 'stylesheet', Image: 'image', Media: 'media', Font: 'font',
      Script: 'script', XHR: 'xhr', Fetch: 'fetch', EventSource: 'eventsource', WebSocket: 'websocket',
      Manifest: 'manifest', Other: 'other',
    };
    return map[type] ?? 'other';
  }

  function ensureWindow(): BrowserWindow {
    if (window && !window.isDestroyed()) return window;
    window = new BrowserWindow({
      show: false,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      title: 'Relay Agent Browser',
      backgroundColor: '#ffffff',
    });
    window.on('closed', () => {
      window = null;
      focused = null;
    });
    return window;
  }

  function showTab(tab: TabRecord): void {
    const win = ensureWindow();
    const current = win.getContentView().children ?? [];
    for (const child of current) win.contentView.removeChildView(child as WebContentsView);
    win.contentView.addChildView(tab.view);
    win.show();
    focused = tab.id;
  }

  // ---- ref targeting (CDP) -------------------------------------------------

  function requireRef(tab: TabRecord, ref: string): number {
    const backendID = tab.refs.get(ref.replace(/^@/, ''));
    if (backendID === undefined) {
      throw new Error(`Element ref is stale or belongs to another tab. Call browser.snapshot({tabID}) and use a ref from that tab's newest snapshot. Do not reuse refs after navigation or a newer snapshot.`);
    }
    return backendID;
  }

  async function callOnElement<T>(tab: TabRecord, backendID: number, functionDeclaration: string, args: unknown[] = []): Promise<T> {
    const object = await cdp<{ object: { objectId?: string } }>(tab, 'DOM.resolveNode', { backendNodeId: backendID });
    if (!object.object.objectId) {
      throw new Error('Element is no longer available. Call browser.snapshot({tabID}) and use a fresh ref; the page may have replaced the element.');
    }
    try {
      const result = await cdp<{ result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
        tab, 'Runtime.callFunctionOn',
        { objectId: object.object.objectId, functionDeclaration, arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true, userGesture: true },
      );
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value as T;
    } finally {
      cdp(tab, 'Runtime.releaseObject', { objectId: object.object.objectId }).catch(() => undefined);
    }
  }

  async function elementBox(tab: TabRecord, backendID: number): Promise<{ x: number; y: number; width: number; height: number }> {
    await cdp(tab, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: backendID }).catch(() => undefined);
    const box = await callOnElement<{ x: number; y: number; width: number; height: number }>(
      tab, backendID,
      'function() { const r = this.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }',
    );
    if (!box || ![box.x, box.y, box.width, box.height].every((value) => Number.isFinite(value))) {
      throw new Error('Element has no visible box. Take a fresh snapshot and choose a visible element.');
    }
    return box;
  }

  async function elementPoint(tab: TabRecord, backendID: number): Promise<{ x: number; y: number }> {
    const box = await elementBox(tab, backendID);
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  }

  async function click(tab: TabRecord, backendID: number, button = 'left', count = 1, modifiers: string[] = []): Promise<void> {
    const position = await elementPoint(tab, backendID);
    const flags = modifiers.reduce((mask, key) => mask | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[key] ?? 0), 0);
    await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...position, modifiers: flags });
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button, clickCount, modifiers: flags });
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button, clickCount, modifiers: flags });
    }
  }

  async function key(tab: TabRecord, chord: string): Promise<void> {
    if (!chord) throw new Error('A key is required. Use a named key such as Enter or ArrowDown, a single character, or a chord such as Control+A.');
    const parts = (chord.endsWith('+') ? chord.slice(0, -1) : chord).split('+');
    const name = parts.pop() || '+';
    const modifiers = parts.reduce((mask, part) => {
      const bit = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }[part];
      if (!bit) throw new Error(`Unknown key modifier ${JSON.stringify(part)}. Supported modifiers are Alt, Control, Meta, and Shift; for example Control+A.`);
      return mask | bit;
    }, 0);
    const codes: Record<string, number> = {
      Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37,
      ArrowRight: 39, PageUp: 33, PageDown: 34, Home: 36, End: 35, Space: 32,
    };
    const code = codes[name]
      ?? (name.length === 1 ? name.toUpperCase().charCodeAt(0) : undefined)
      ?? (/^F([1-9]|1[0-2])$/.test(name) ? 111 + Number(name.slice(1)) : undefined);
    if (code === undefined) {
      throw new Error(`Unknown key ${JSON.stringify(name)}. Use Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/Down, Home, End, Space, F1–F12, or one character.`);
    }
    const text = name === 'Enter' ? '\r' : name === 'Space' ? ' ' : name.length === 1 ? name : undefined;
    const event = { key: name === 'Space' ? ' ' : name, windowsVirtualKeyCode: code, modifiers };
    const params = text !== undefined && !(modifiers & 6) ? { ...event, text } : event;
    await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params });
    await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  }

  async function fill(tab: TabRecord, backendID: number, value: string): Promise<void> {
    const kind = await callOnElement<string | undefined>(
      tab, backendID,
      'function() { if (this.disabled || this.readOnly) return; if (this instanceof HTMLTextAreaElement || this.isContentEditable) return \'text\'; if (!(this instanceof HTMLInputElement)) return; if ([\'date\',\'time\',\'datetime-local\',\'month\',\'week\'].includes(this.type)) return \'structured\'; if (![\'file\',\'checkbox\',\'radio\',\'button\',\'submit\',\'reset\',\'image\',\'hidden\',\'range\',\'color\'].includes(this.type)) return \'text\'; }',
    );
    if (!kind) {
      throw new Error('Target is not an enabled editable text field. Take a fresh snapshot and choose a textbox; use browser.select for dropdowns and browser.check for checkboxes/radios.');
    }
    if (kind === 'structured') {
      // Keyboard input cannot compose a date or time control's value; Chromium clears a malformed one.
      await callOnElement(
        tab, backendID,
        'function(value) { const previous = this.value; this.focus(); this.value = value; if (this.value !== value) { this.value = previous; throw new Error(\'The \' + this.type + \' input rejected this value. Use its required format, for example 2026-09-07 for date.\'); } this.dispatchEvent(new Event(\'input\',{bubbles:true})); this.dispatchEvent(new Event(\'change\',{bubbles:true})); }',
        [value],
      );
      return;
    }
    await cdp(tab, 'DOM.focus', { backendNodeId: backendID });
    await key(tab, process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await key(tab, 'Backspace');
    await cdp(tab, 'Input.insertText', { text: value });
  }

  // ---- driver contract ------------------------------------------------------

  return {
    async listTabs() { return [...tabs.values()].map(summary); },
    async focusedTabID() { return focused; },
    tabSummary: summaryOf,

    async openTab(url?: string, focus = true) {
      const tab = openNewTab(url);
      if (focus) showTab(tab);
      return summary(tab);
    },

    async focusTab(tabID: string) {
      const tab = requireTab(tabID);
      showTab(tab);
      return summary(tab);
    },

    async closeTab(tabID: string) {
      const tab = requireTab(tabID);
      if (focused === tabID) focused = null;
      if (window && !window.isDestroyed()) window.contentView.removeChildView(tab.view);
      tabs.delete(tabID);
      try { tab.wc.close(); } catch { /* already gone */ }
      return [...tabs.values()].map(summary);
    },

    async navigate(tabID: string, url: string) {
      const tab = requireTab(tabID);
      await tab.wc.loadURL(url);
      return summary(tab);
    },

    async back(tabID: string) {
      const tab = requireTab(tabID);
      if (tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack();
      return summary(tab);
    },

    async forward(tabID: string) {
      const tab = requireTab(tabID);
      if (tab.wc.navigationHistory.canGoForward()) tab.wc.navigationHistory.goForward();
      return summary(tab);
    },

    async reload(tabID: string) {
      const tab = requireTab(tabID);
      tab.wc.reload();
      return summary(tab);
    },

    async stop(tabID: string) {
      const tab = requireTab(tabID);
      tab.wc.stop();
      return summary(tab);
    },

    async snapshot(tabID: string, opts: { ref?: string; depth?: number }) {
      const tab = requireTab(tabID);
      const tree = await cdp<{ nodes: A11yNode[] }>(tab, 'Accessibility.getFullAXTree', { depth: opts.depth ?? 8 });
      const nodes = tree.nodes ?? [];
      const rootNodeId = opts.ref ? nodeIdFor(tab, opts.ref, nodes) : undefined;
      const rendered = renderA11ySnapshot(nodes, { depth: opts.depth ?? 8, rootNodeId });
      tab.refs = rendered.refs;
      return { content: rendered.content, truncated: rendered.truncated };
    },

    async find(tabID: string, text: string) {
      const tab = requireTab(tabID);
      const tree = await cdp<{ nodes: A11yNode[] }>(tab, 'Accessibility.getFullAXTree', {});
      const rendered = renderA11ySnapshot(tree.nodes ?? [], { find: text });
      tab.refs = rendered.refs;
      return { content: rendered.content, truncated: rendered.truncated };
    },

    async evaluate(tabID: string, script: string) {
      const tab = requireTab(tabID);
      const result = await cdp<{ result?: { value?: unknown; type?: string }; exceptionDetails?: { exception?: { description?: string }; text?: string } }>(
        tab, 'Runtime.evaluate',
        { expression: script, returnByValue: true, awaitPromise: true, userGesture: true },
      );
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    },

    async click(tabID: string, ref: string, input = {}) {
      const tab = requireTab(tabID);
      await click(tab, requireRef(tab, ref), input.button ?? 'left', input.count ?? 1, input.modifiers ?? []);
      return summary(tab);
    },

    async hover(tabID: string, ref: string) {
      const tab = requireTab(tabID);
      const position = await elementPoint(tab, requireRef(tab, ref));
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
      return summary(tab);
    },

    async fill(tabID: string, ref: string, text: string) {
      const tab = requireTab(tabID);
      await fill(tab, requireRef(tab, ref), text);
      return summary(tab);
    },

    async fillForm(tabID: string, fields: FormField[]) {
      const tab = requireTab(tabID);
      for (const field of fields) {
        const backendID = requireRef(tab, field.ref);
        if (field.type === 'select') {
          await select(tab, backendID, [field.value]);
        } else if (field.type === 'checkbox' || field.type === 'radio') {
          await check(tab, backendID, field.value === 'true');
        } else {
          await fill(tab, backendID, field.value);
        }
      }
      return summary(tab);
    },

    async select(tabID: string, ref: string, values: string[]) {
      const tab = requireTab(tabID);
      await select(tab, requireRef(tab, ref), values);
      return summary(tab);
    },

    async check(tabID: string, ref: string, checked: boolean) {
      const tab = requireTab(tabID);
      await check(tab, requireRef(tab, ref), checked);
      return summary(tab);
    },

    async press(tabID: string, keyName: string) {
      const tab = requireTab(tabID);
      await key(tab, keyName);
      return summary(tab);
    },

    async scroll(tabID: string, deltaY: number, deltaX = 0) {
      const tab = requireTab(tabID);
      await cdp(tab, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: Math.floor(VIEWPORT.width / 2), y: Math.floor(VIEWPORT.height / 2),
        deltaX, deltaY,
      });
      return summary(tab);
    },

    async wait(tabID: string, condition: string, input: { text?: string; timeoutMs?: number }) {
      const tab = requireTab(tabID);
      const deadline = Date.now() + Math.min(Math.max(input.timeoutMs ?? DEFAULT_WAIT_MS, 0), MAX_WAIT_MS);
      for (;;) {
        if (condition === 'load') {
          if (!tab.wc.isLoading() && !tab.loadError) return summary(tab);
        } else if (condition === 'text' || condition === 'textGone') {
          const body = await tab.wc.executeJavaScript('document.body ? document.body.innerText : ""', true).catch(() => '');
          const has = String(body).includes(String(input.text ?? ''));
          if (condition === 'text' ? has : !has) return summary(tab);
        } else {
          throw new Error(`Unknown wait condition ${JSON.stringify(condition)}. Use "load", "text", or "textGone".`);
        }
        if (Date.now() >= deadline) {
          throw new Error(`browser.wait failed for condition ${JSON.stringify(condition)} (timeoutMs: ${input.timeoutMs ?? DEFAULT_WAIT_MS}). Inspect browser.snapshot({tabID}) and check the page state before retrying.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    },

    async dialog(tabID: string, action: 'get' | 'accept' | 'dismiss', promptText?: string) {
      const tab = requireTab(tabID);
      if (action !== 'get') {
        if (!tab.dialog) {
          throw new Error('This tab has no JavaScript dialog to handle. browser.dialog({tabID,action:"get"}) returns null when none is open; continue without accepting or dismissing one.');
        }
        await cdp(tab, 'Page.handleJavaScriptDialog', { accept: action === 'accept', promptText });
        tab.dialog = null;
      }
      return { dialog: tab.dialog };
    },

    async screenshot(tabID: string, input: { fullPage?: boolean; format?: string; quality?: number; ref?: string; maxWidth?: number }) {
      const tab = requireFocused(tabID);
      const format = input.format === 'jpeg' || input.format === 'webp' ? input.format : 'png';
      const params: Record<string, unknown> = { format };
      if (format === 'jpeg' || format === 'webp') params.quality = Math.min(Math.max(Math.round(input.quality ?? 90), 0), 100);
      if (input.ref) {
        const box = await elementBox(tab, requireRef(tab, input.ref));
        params.clip = { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 };
      } else if (input.fullPage) {
        const size = await tab.wc.executeJavaScript('({width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight})', true) as { width?: number; height?: number } | null;
        const width = Number(size?.width ?? VIEWPORT.width);
        const height = Number(size?.height ?? VIEWPORT.height);
        params.captureBeyondViewport = true;
        if (input.maxWidth && width > input.maxWidth) params.clip = { x: 0, y: 0, width, height, scale: input.maxWidth / width };
      }
      const shot = await cdp<{ data: string }>(tab, 'Page.captureScreenshot', params);
      await mkdir(capturesDirectory, { recursive: true });
      const extension = format === 'jpeg' ? 'jpg' : format;
      const name = `browser-${tab.id.slice(4, 12)}-${String(++captureSequence).padStart(3, '0')}.${extension}`;
      const path = join(capturesDirectory, name);
      const data = Buffer.from(shot.data, 'base64');
      await writeFile(path, data);
      const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
      const file: BrowserFile = { name, mime, bytes: data.byteLength, path };
      return file;
    },

    async consoleEntries(tabID: string, input: { level?: string; limit?: number }) {
      const tab = requireTab(tabID);
      const order = { debug: 0, info: 1, warning: 2, error: 3 } as Record<string, number>;
      const threshold = order[input.level ?? 'debug'] ?? 0;
      const matching = tab.console.filter((entry) => (order[entry.level] ?? 1) >= threshold);
      const limit = Math.max(input.limit ?? 100, 0);
      const kept = limit ? matching.slice(-limit) : matching;
      const omitted = matching.length - kept.length;
      return { messages: kept, truncated: omitted > 0 || tab.consoleDropped > 0, dropped: tab.consoleDropped };
    },

    async networkList(tabID: string, input: { urlContains?: string; resourceType?: string; limit?: number }) {
      const tab = requireTab(tabID);
      const matching = tab.network
        .filter((record) => (input.urlContains ? record.url.includes(input.urlContains) : true))
        .filter((record) => (input.resourceType ? record.resourceType === input.resourceType : true))
        .map(toNetworkSummary);
      const limit = Math.max(input.limit ?? 50, 0);
      const kept = limit ? matching.slice(-limit) : matching;
      const omitted = matching.length - kept.length;
      return { requests: kept, truncated: omitted > 0 || tab.networkDropped > 0, dropped: tab.networkDropped };
    },

    async networkGet(tabID: string, id: string, input: { includeBody?: boolean; maxBodyChars?: number }) {
      const tab = requireTab(tabID);
      const record = tab.network.find((entry) => entry.id === id);
      if (!record) throw new Error(`Unknown network request ${JSON.stringify(id)}. Call browser.network.list({tabID}) for captured requests.`);
      const request = toNetworkSummary(record);
      const requestHeaders = record.requestHeaders ?? [];
      const responseHeaders = record.responseHeaders ?? [];
      let responseBody: NetworkGetResult['responseBody'] = { state: 'notRequested' };
      if (input.includeBody) {
        if (record.state !== 'completed') {
          responseBody = record.state === 'failed' ? { state: 'unavailable', reason: 'backendUnavailable' } : { state: 'pending' };
        } else {
          try {
            const body = await cdp<{ body?: string; base64Encoded?: boolean }>(tab, 'Network.getResponseBody', { requestId: record.id });
            if (body.base64Encoded) responseBody = { state: 'unavailable', reason: 'binary' };
            else {
              const limit = Math.max(input.maxBodyChars ?? 100_000, 0);
              const text = String(body.body ?? '');
              responseBody = { state: 'text', text: text.slice(0, limit), truncated: text.length > limit };
            }
          } catch {
            responseBody = { state: 'unavailable', reason: 'backendUnavailable' };
          }
        }
      }
      const result: NetworkGetResult = {
        request,
        requestHeaders,
        responseHeaders,
        headersTruncated: requestHeaders.length >= 60 || responseHeaders.length >= 60,
        requestBody: { state: 'unavailable', reason: 'notCaptured' },
        responseBody,
      };
      return result;
    },

    dispose() {
      for (const tab of [...tabs.values()]) {
        try { tab.wc.removeAllListeners(); tab.wc.debugger.removeAllListeners?.(); } catch { /* gone */ }
        try { if (tab.attached) tab.wc.debugger.detach(); } catch { /* gone */ }
        try { tab.wc.close(); } catch { /* gone */ }
      }
      tabs.clear();
      focused = null;
      if (window && !window.isDestroyed()) window.destroy();
      window = null;
    },
  };

  /** Creates a tab record; used by tabs.open and by popup interception. */
  function openNewTab(url?: string): TabRecord {
    const tab = createTab(url);
    return tab;
  }

  // Helpers referenced before their definitions run fine (function hoisting).
  function nodeIdFor(tab: TabRecord, ref: string, nodes: A11yNode[]): string | undefined {
    const backendID = tab.refs.get(ref.replace(/^@/, ''));
    if (backendID === undefined) {
      throw new Error('Element ref is stale or belongs to another tab. Call browser.snapshot({tabID}) without a ref to refresh, then choose a returned ref.');
    }
    const match = nodes.find((node) => node.backendDOMNodeId === backendID);
    if (!match) {
      throw new Error('Element is absent from this frame\'s accessibility snapshot. Retry browser.snapshot with the same tabID and no ref to refresh, then choose a returned ref.');
    }
    return match.nodeId;
  }

  function toNetworkSummary(record: NetworkRecord): NetworkRequestSummary {
    const { requestHeaders, responseHeaders, responseMime, responseEncoding, ...rest } = record;
    return { ...rest } as NetworkRequestSummary;
  }

  async function select(tab: TabRecord, backendID: number, values: string[]): Promise<void> {
    await callOnElement(
      tab, backendID,
      `function(values) { if (!(this instanceof HTMLSelectElement) || this.disabled) throw new Error('Target is not an enabled HTML select. Take a fresh snapshot and choose an enabled dropdown ref.'); if (!this.multiple && values.length !== 1) throw new Error('This dropdown accepts exactly one value; pass a one-item values array.'); for (const value of values) if (!Array.from(this.options).some(option => option.value === value && !option.disabled)) throw new Error('Option value was not found or is disabled. Inspect option values with browser.evaluate before retrying browser.select; values are not visible labels.'); for (const option of this.options) option.selected = values.includes(option.value); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
      [values],
    );
  }

  async function check(tab: TabRecord, backendID: number, checked: boolean): Promise<void> {
    const current = await callOnElement<boolean>(
      tab, backendID,
      'function(checked) { if (!(this instanceof HTMLInputElement) || ![\'checkbox\',\'radio\'].includes(this.type) || this.disabled) throw new Error(\'Target is not an enabled checkbox or radio. Take a fresh snapshot and choose the correct ref.\'); if (this.type === \'radio\' && this.checked && !checked) throw new Error(\'A selected radio cannot be cleared by clicking it. Select a different radio in its group instead.\'); return this.checked; }',
      [checked],
    );
    if (current !== checked) await click(tab, backendID);
    if ((await callOnElement<boolean>(tab, backendID, 'function() { return this.checked; }')) !== checked) {
      throw new Error('The page did not keep the requested checked state. Inspect the current snapshot and page validation before retrying; do not blindly toggle the control again.');
    }
  }
}
