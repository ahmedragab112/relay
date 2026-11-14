/**
 * The agent-browser host: Relay acts as the desktop browser for the engine's
 * `opencode.browser` plugin. The host owns the attach handshake, the command
 * loop and outcome shaping; a `BrowserPageDriver` (Electron, in
 * browser-page.ts) owns the actual tabs and CDP.
 *
 * Protocol (verified against engine 2.2.6 in tests/browser-spike.mts):
 * - `attach` stays pending for the attachment's lifetime; resolving means closed.
 * - `state` publishes the tab inventory; its resolution is just an ack.
 * - control events arrive as `attached` / `command` / `cancel`.
 * - every call must carry `location: {directory}` or the engine rejects it.
 */

import { randomUUID } from 'node:crypto';

export interface TabSummary {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  loadError?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  generation: number;
}

export interface BrowserState {
  tabs: TabSummary[];
  focusedTabID: string | null;
}

export interface BrowserDialog {
  type: string;
  message: string;
  defaultValue: string;
}

export interface BrowserFile {
  name: string;
  mime: string;
  bytes: number;
  path: string;
}

export interface FormField {
  ref: string;
  type: string;
  value: string;
}

export type BrowserOutcome = {
  type: 'success';
  result: { value: unknown; files: Array<{ id: string; name: string; mime: string; data: Uint8Array }> };
}
  | {
    type: 'failure';
    code: string;
    message: string;
  }

export interface RpcOptions {
  location?: { directory: string };
}

export interface BrowserControl {
  type: 'attached' | 'command' | 'cancel';
  connectionID: string;
  version?: number;
  requestID?: string;
}

/** The slice of the engine's plugin RPC client that the host needs. */
export interface BrowserRpc {
  attach(input: { sessionID: string; connectionID: string; version: 4 }, options?: RpcOptions): Promise<'closed' | 'replaced'>;
  state(input: { sessionID: string; connectionID: string; state: BrowserState }, options?: RpcOptions): Promise<unknown>;
  command(input: { sessionID: string; connectionID: string; requestID: string }, options?: RpcOptions): Promise<{ action: BrowserAction }>;
  result(input: { sessionID: string; connectionID: string; requestID: string; outcome: BrowserOutcome }, options?: RpcOptions): Promise<unknown>;
  events: {
    on(name: 'control', handler: (event: BrowserControl) => void, options?: RpcOptions): () => void;
  };
}

export interface BrowserAction {
  type: string;
  [key: string]: unknown;
}

export interface ConsoleEntries {
  messages: Array<{ id: string; timestampMs: number; level: string; text: string; textTruncated: boolean; source?: { url: string; line: number; column: number } }>;
  truncated: boolean;
  dropped: number;
}

export interface NetworkList {
  requests: NetworkRequestSummary[];
  truncated: boolean;
  dropped: number;
}

export type NetworkRequestSummary = {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  timestampMs: number;
  state: string;
  [key: string]: unknown;
};

export interface NetworkGetResult {
  request: NetworkRequestSummary;
  requestHeaders: Array<{ name: string; value: string }>;
  responseHeaders: Array<{ name: string; value: string }>;
  headersTruncated: boolean;
  requestBody: { state: string; reason?: string };
  responseBody: { state: string; reason?: string; text?: string; truncated?: boolean };
}

/**
 * The Electron-side driver. Every method throws on failure; the host turns
 * throws into protocol failure outcomes. Tab-shaping returns `TabSummary`,
 * everything else returns domain values the host wraps into `{tab, ...}`.
 */
export interface BrowserPageDriver {
  listTabs(): Promise<TabSummary[]>;
  focusedTabID(): Promise<string | null>;
  openTab(url?: string, focus?: boolean): Promise<TabSummary>;
  focusTab(tabID: string): Promise<TabSummary>;
  closeTab(tabID: string): Promise<TabSummary[]>;
  navigate(tabID: string, url: string): Promise<TabSummary>;
  back(tabID: string): Promise<TabSummary>;
  forward(tabID: string): Promise<TabSummary>;
  reload(tabID: string): Promise<TabSummary>;
  stop(tabID: string): Promise<TabSummary>;
  snapshot(tabID: string, input: { ref?: string; depth?: number }): Promise<{ content: string; truncated: boolean }>;
  find(tabID: string, text: string): Promise<{ content: string; truncated: boolean }>;
  evaluate(tabID: string, script: string): Promise<unknown>;
  click(tabID: string, ref: string, input?: { button?: string; count?: number; modifiers?: string[] }): Promise<TabSummary>;
  hover(tabID: string, ref: string): Promise<TabSummary>;
  fill(tabID: string, ref: string, text: string): Promise<TabSummary>;
  fillForm(tabID: string, fields: FormField[]): Promise<TabSummary>;
  select(tabID: string, ref: string, values: string[]): Promise<TabSummary>;
  check(tabID: string, ref: string, checked: boolean): Promise<TabSummary>;
  press(tabID: string, key: string): Promise<TabSummary>;
  scroll(tabID: string, deltaY: number, deltaX?: number): Promise<TabSummary>;
  wait(tabID: string, condition: string, input: { text?: string; timeoutMs?: number }): Promise<TabSummary>;
  dialog(tabID: string, action: 'get' | 'accept' | 'dismiss', promptText?: string): Promise<{ dialog: BrowserDialog | null }>;
  screenshot(tabID: string, input: { fullPage?: boolean; format?: string; quality?: number; ref?: string; maxWidth?: number }): Promise<BrowserFile>;
  consoleEntries(tabID: string, input: { level?: string; limit?: number }): Promise<ConsoleEntries>;
  networkList(tabID: string, input: { urlContains?: string; resourceType?: string; limit?: number }): Promise<NetworkList>;
  networkGet(tabID: string, id: string, input: { includeBody?: boolean; maxBodyChars?: number }): Promise<NetworkGetResult>;
  tabSummary(tabID: string): Promise<TabSummary>;
  dispose(): void;
}

export interface BrowserHostInput {
  rpc: BrowserRpc;
  sessionID: string;
  connectionID: string;
  location: { directory: string };
  driver: BrowserPageDriver;
  /** Called when the attachment dies (engine closed it, or attach failed). */
  onError?: (cause: unknown) => void;
  /** Test hook: how long a dispatch may hang before answering with a timeout failure. */
  dispatchTimeoutMs?: number;
}

export interface BrowserHost {
  dispose(): void;
}

/** Actions Relay does not implement yet; they answer with a clear unsupported failure. */
const UNSUPPORTED = new Set([
  'drag', 'preview',
  'files.upload', 'files.drop', 'files.list', 'files.get',
  'trace.start', 'trace.stop', 'trace.analyze',
  'cpu.start', 'cpu.stop', 'cpu.analyze',
  'heap.snapshot', 'heap.summary', 'heap.query', 'heap.object', 'heap.compare',
  'lighthouse',
]);

const DEFAULT_DISPATCH_TIMEOUT_MS = 60_000;

const NAVIGATION_ACTIONS = new Set(['tabs.open', 'navigate', 'back', 'forward', 'reload']);

export function startBrowserHost(input: BrowserHostInput): BrowserHost {
  const { rpc, sessionID, connectionID, location, driver } = input;
  const options: RpcOptions = { location };
  const attachment = { sessionID, connectionID };

  let disposed = false;
  const pending = new Set<string>(); // requestIDs fetched but not yet answered
  const cancelled = new Set<string>();
  let queue: Promise<void> = Promise.resolve();

  const call = {
    attach: () => rpc.attach({ ...attachment, version: 4 }, options),
    state: (state: BrowserState) => rpc.state({ ...attachment, state }, options),
    command: (requestID: string) => rpc.command({ ...attachment, requestID }, options),
    result: (requestID: string, outcome: BrowserOutcome) => rpc.result({ ...attachment, requestID, outcome }, options),
  };

  const publishState = (): Promise<void> => (async () => {
    const [tabs, focusedTabID] = await Promise.all([driver.listTabs(), driver.focusedTabID()]);
    await call.state({ tabs, focusedTabID });
  })().catch(() => undefined);

  const failure = (code: string, message: string): BrowserOutcome => ({ type: 'failure', code, message: message.slice(0, 2048) });

  const outcomeFor = (action: BrowserAction, cause: unknown): BrowserOutcome => {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const network = NAVIGATION_ACTIONS.has(action.type) ? detail.match(/\bERR_[A-Z_]+\b/)?.[0] : undefined;
    const hint = network === 'ERR_NAME_NOT_RESOLVED'
      ? 'Check the URL spelling and the DNS/network connection.'
      : network === 'ERR_CONNECTION_REFUSED'
        ? 'Check the site hostname/port; localhost means this machine.'
        : network
          ? 'The site failed to load. Check the URL/network before retrying.'
          : undefined;
    const code = network ? 'navigation_failed' : 'operation_failed';
    return failure(code, `browser.${action.type} failed.${hint ? ` ${hint}` : ''} Details: ${detail.slice(0, 400)}`);
  };

  async function dispatch(action: BrowserAction): Promise<BrowserOutcome> {
    if (UNSUPPORTED.has(action.type)) {
      return failure('unsupported', `browser.${action.type} is not supported by Relay's agent browser yet. Use tabs, navigation, snapshot/find, evaluate, click/hover/fill/select/check/press/scroll, dialog, wait, console, network and screenshot instead.`);
    }

    switch (action.type) {
      case 'tabs.list': {
        const [tabs, focusedTabID] = await Promise.all([driver.listTabs(), driver.focusedTabID()]);
        return success({ tabs, focusedTabID });
      }
      case 'tabs.open':
        return success(await driver.openTab(action.url as string | undefined, action.focus as boolean | undefined));
      case 'tabs.focus':
        return success(await driver.focusTab(String(action.tabID)));
      case 'tabs.close':
        return success({ tabs: await driver.closeTab(String(action.tabID)), focusedTabID: await driver.focusedTabID() });
      case 'navigate':
        return success(await driver.navigate(String(action.tabID), String(action.url)));
      case 'back':
        return success(await driver.back(String(action.tabID)));
      case 'forward':
        return success(await driver.forward(String(action.tabID)));
      case 'reload':
        return success(await driver.reload(String(action.tabID)));
      case 'stop':
        return success(await driver.stop(String(action.tabID)));
      case 'snapshot':
        return success({ tab: await driver.tabSummary(String(action.tabID)), ...(await driver.snapshot(String(action.tabID), { ref: action.ref as string | undefined, depth: action.depth as number | undefined })) });
      case 'find':
        return success({ tab: await driver.tabSummary(String(action.tabID)), ...(await driver.find(String(action.tabID), String(action.text))) });
      case 'evaluate':
        return success({ tab: await driver.tabSummary(String(action.tabID)), value: await driver.evaluate(String(action.tabID), String(action.script)) });
      case 'click':
        return success(await driver.click(String(action.tabID), String(action.ref), { button: action.button as string | undefined, count: action.count as number | undefined, modifiers: action.modifiers as string[] | undefined }));
      case 'hover':
        return success(await driver.hover(String(action.tabID), String(action.ref)));
      case 'fill':
        return success(await driver.fill(String(action.tabID), String(action.ref), String(action.text)));
      case 'fill_form':
        return success(await driver.fillForm(String(action.tabID), (action.fields ?? []) as FormField[]));
      case 'select':
        return success(await driver.select(String(action.tabID), String(action.ref), (action.values ?? []) as string[]));
      case 'check':
        return success(await driver.check(String(action.tabID), String(action.ref), action.checked === true));
      case 'press':
        return success(await driver.press(String(action.tabID), String(action.key)));
      case 'scroll':
        return success(await driver.scroll(String(action.tabID), Number(action.deltaY ?? 0), action.deltaX as number | undefined));
      case 'wait':
        return success(await driver.wait(String(action.tabID), String(action.condition), { text: action.text as string | undefined, timeoutMs: action.timeoutMs as number | undefined }));
      case 'dialog': {
        const { dialog } = await driver.dialog(String(action.tabID), action.action as 'get' | 'accept' | 'dismiss', action.promptText as string | undefined);
        return success({ tab: await driver.tabSummary(String(action.tabID)), dialog });
      }
      case 'screenshot': {
        const file = await driver.screenshot(String(action.tabID), { fullPage: action.fullPage as boolean | undefined, format: action.format as string | undefined, quality: action.quality as number | undefined });
        return success({ tab: await driver.tabSummary(String(action.tabID)), files: [{ id: newFileID(), ...file }] });
      }
      case 'console': {
        const entries = await driver.consoleEntries(String(action.tabID), { level: action.level as string | undefined, limit: action.limit as number | undefined });
        return success({ tab: await driver.tabSummary(String(action.tabID)), ...entries });
      }
      case 'network.list': {
        const list = await driver.networkList(String(action.tabID), { urlContains: action.urlContains as string | undefined, resourceType: action.resourceType as string | undefined, limit: action.limit as number | undefined });
        return success({ tab: await driver.tabSummary(String(action.tabID)), ...list });
      }
      case 'network.get':
        return success({ tab: await driver.tabSummary(String(action.tabID)), ...(await driver.networkGet(String(action.tabID), String(action.id), { includeBody: action.includeBody as boolean | undefined, maxBodyChars: action.maxBodyChars as number | undefined })) });
      default:
        return failure('unsupported', `Unknown browser action ${JSON.stringify(action.type)}.`);
    }
  }

  function handleCommand(requestID: string): void {
    if (pending.has(requestID)) return; // duplicate notification
    pending.add(requestID);
    cancelled.delete(requestID);
    queue = queue.then(async () => {
      pending.delete(requestID);
      if (disposed || cancelled.has(requestID)) return;
      let outcome: BrowserOutcome;
      try {
        const { action } = await call.command(requestID);
        try {
          outcome = await withTimeout(dispatch(action), `browser.${action.type} timed out`, input.dispatchTimeoutMs);
        } catch (cause) {
          outcome = outcomeFor(action, cause);
        }
      } catch (cause) {
        outcome = failure('operation_failed', cause instanceof Error ? cause.message : String(cause));
      }
      if (cancelled.has(requestID)) return;
      try {
        // The server validates tabIDs against the state we publish, so the fresh
        // inventory must land BEFORE the result unblocks the model's next call
        // (otherwise tabs.open → wait races the state update and tab_unavailable).
        await publishState();
        await call.result(requestID, outcome);
      } catch (cause) {
        input.onError?.(cause);
      }
    }).catch((cause) => input.onError?.(cause));
  }

  const unsubscribe = rpc.events.on('control', (event) => {
    // The client delivers `{type: 'rpc.experimental.browser.control', data: <control>}`;
    // tolerate the bare control too (unit fakes).
    const envelope = event as { type?: string; data?: BrowserControl };
    const control = envelope.type === 'rpc.experimental.browser.control' ? envelope.data : event;
    if (!control || control.connectionID !== connectionID || disposed) return;
    if (control.type === 'command') handleCommand(String(control.requestID));
    else if (control.type === 'cancel') {
      if (control.requestID) { cancelled.add(String(control.requestID)); pending.delete(String(control.requestID)); }
    }
    // `attached` needs no action: attach's own resolution signals closed/replaced.
  }, options);

  const attachPromise = call.attach().then(
    () => undefined,
    (cause: unknown) => {
      if (!disposed) input.onError?.(cause);
    },
  );
  void publishState();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      driver.dispose();
      // Let the engine settle the attachment; nothing depends on the resolution.
      void attachPromise.catch(() => undefined);
    },
  };
}

function withTimeout<T>(promise: Promise<T>, message: string, limit = DEFAULT_DISPATCH_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), limit); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function success(value: unknown): BrowserOutcome {
  return { type: 'success', result: { value, files: [] } };
}

function newFileID(): string {
  return `file_${randomUUID()}`;
}
