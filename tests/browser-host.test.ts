import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as Schema from 'effect/Schema';
import { Operations } from '@opencode/plugin-browser/rpc';
import { startBrowserHost, type BrowserControl, type BrowserRpc, type TabSummary } from '../src/main/browser.js';

const TAB_ID = `tab_${randomUUID()}`;
const WORKSPACE = '/tmp/relay-host-test-workspace';

function summary(over: Partial<TabSummary> = {}): TabSummary {
  return { id: TAB_ID, url: 'https://example.com/', title: 'Example', loading: false, canGoBack: false, canGoForward: false, generation: 0, ...over };
}

/** A driver whose every action returns a canned tab; individual actions can be overridden. */
function fakeDriver(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: Array<{ action: string; args: unknown[] }> = [];
  const driven = new Proxy({} as Record<string, unknown>, {
    get(_target, name: string) {
      return (...args: unknown[]) => {
        calls.push({ action: name, args });
        const override = overrides[name];
        return override ? override(...args) : Promise.resolve(summary());
      };
    },
  });
  return { driver: driven as unknown as import('../src/main/browser.js').BrowserPageDriver, calls };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Scriptable fake of the engine-side plugin RPC. */
function fakeRpc() {
  const calls: Array<{ method: string; input?: unknown; options?: unknown }> = [];
  const results: Array<{ type: string; code?: string; message?: string; result?: unknown }> = [];
  const states: Array<unknown> = [];
  const handlers: Array<(event: BrowserControl) => void> = [];
  const unsubscribes: Array<() => void> = [];
  const commandActions = new Map<string, unknown>();
  const attach = deferred<'closed' | 'replaced'>();
  let commandError: Error | undefined;

  const rpc: BrowserRpc = {
    attach: (input, options) => { calls.push({ method: 'attach', input, options }); return attach.promise; },
    state: async (input, options) => { calls.push({ method: 'state', input, options }); states.push(input.state); },
    command: async (input, options) => {
      calls.push({ method: 'command', input, options });
      if (commandError) throw commandError;
      const action = commandActions.get(input.requestID);
      if (action === undefined) throw new Error(`No action registered for ${input.requestID}`);
      return { action } as { action: never };
    },
    result: async (input, options) => {
      calls.push({ method: 'result', input, options });
      results.push(input.outcome as { type: string });
    },
    events: {
      on: (name, handler: (event: BrowserControl) => void, options) => {
        calls.push({ method: 'events.on', input: name, options });
        handlers.push(handler);
        const off = () => { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); };
        unsubscribes.push(off);
        return off;
      },
    },
  };

  const emit = (event: BrowserControl) => { for (const handler of [...handlers]) handler(event); };

  return { rpc, calls, results, states, emit, commandActions, attach, unsubscribes, setCommandError: (e?: Error) => { commandError = e; } };
}

const operationByAction = new Map(Operations.map((op) => [(op.action.ast.propertySignatures.find((p) => p.name === 'type')!.type as unknown as { literal: string }).literal, op]));

/** Driver calls for one action name, ignoring publishState's listTabs/focusedTabID polling. */
const driverCalled = (d: ReturnType<typeof fakeDriver>, name: string) => d.calls.filter((call) => call.action === name);

/** Validates an outcome against the real protocol schema for its action. */
function assertOutcomeFits(action: string, outcome: { type: string; result?: { value: unknown } }): void {
  const op = operationByAction.get(action);
  assert.ok(op, `operation ${action} must exist`);
  const decode = Schema.decodeUnknownSync(op.output);
  assert.doesNotThrow(() => decode(outcome.result?.value), `${action} output must match the protocol schema`);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test('attach handshake: registers with version 4 and publishes initial empty state', async () => {
  const f = fakeRpc();
  const d = fakeDriver({ listTabs: () => Promise.resolve([]), focusedTabID: () => Promise.resolve(null) });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'conn-1', location: { directory: WORKSPACE }, driver: d.driver });
  await flush();

  const attachCall = f.calls.find((c) => c.method === 'attach');
  assert.ok(attachCall);
  assert.deepEqual(attachCall.input, { sessionID: 'ses_1', connectionID: 'conn-1', version: 4 });
  assert.deepEqual(attachCall.options, { location: { directory: WORKSPACE } });
  assert.ok(f.states.length >= 1, 'initial state published');
  assert.deepEqual(f.states[0], { tabs: [], focusedTabID: null });
  host.dispose();
});

test('commands for another connection are ignored', async () => {
  const f = fakeRpc();
  const d = fakeDriver();
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();
  f.emit({ type: 'command', connectionID: 'other', requestID: 'r1' });
  await flush();
  assert.equal(driverCalled(d, 'click').length, 0);
  assert.equal(f.results.length, 0);
  host.dispose();
});

test('tabs.list dispatches to the driver and answers with a schema-valid value', async () => {
  const f = fakeRpc();
  const d = fakeDriver({ listTabs: () => Promise.resolve([summary(), summary({ id: `tab_${randomUUID()}`, title: 'Second' })]), focusedTabID: () => Promise.resolve(TAB_ID) });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-1', { type: 'tabs.list' });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-1' });
  await flush();

  const fetch = f.calls.find((c) => c.method === 'command' && (c.input as { requestID?: string })?.requestID === 'req-1');
  assert.ok(fetch);
  assert.deepEqual((fetch.input as { sessionID?: string }).sessionID, 'ses_1');
  assert.deepEqual((fetch.options as { location?: unknown }).location, { directory: WORKSPACE });

  const answer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-1');
  assert.ok(answer);
  const outcome = answer.input as { outcome: { type: string; result?: { value: unknown } } };
  assert.equal(outcome.outcome.type, 'success');
  assertOutcomeFits('tabs.list', outcome.outcome);
  const value = outcome.outcome.result?.value as { tabs: TabSummary[]; focusedTabID: string | null };
  assert.equal(value.tabs.length, 2);
  assert.equal(value.focusedTabID, TAB_ID);
  host.dispose();
});

test('tabs.open passes url/focus and answers with the created tab summary', async () => {
  const f = fakeRpc();
  const created = summary({ url: 'https://example.org/x' });
  const d = fakeDriver({ openTab: (url: unknown, focus: unknown) => { assert.equal(url, 'https://example.org/x'); assert.equal(focus, true); return Promise.resolve(created); } });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-2', { type: 'tabs.open', url: 'https://example.org/x', focus: true });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-2' });
  await flush();

  const answer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-2');
  assert.ok(answer);
  const outcome = answer.input as { outcome: { type: string; result?: { value: unknown } } };
  assert.equal(outcome.outcome.type, 'success');
  assertOutcomeFits('tabs.open', outcome.outcome);
  assert.deepEqual(outcome.outcome.result?.value, created);
  host.dispose();
});

test('snapshot shapes {tab, content, truncated} from driver content', async () => {
  const f = fakeRpc();
  const d = fakeDriver({ snapshot: () => Promise.resolve({ content: '- heading "Example" [ref=e1]', truncated: false }) });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-3', { type: 'snapshot', tabID: TAB_ID });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-3' });
  await flush();

  const answer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-3');
  assert.ok(answer);
  const outcome = answer.input as { outcome: { type: string; result?: { value: unknown } } };
  assert.equal(outcome.outcome.type, 'success');
  assertOutcomeFits('snapshot', outcome.outcome);
  const value = outcome.outcome.result?.value as { tab: TabSummary; content: string; truncated: boolean };
  assert.equal(value.tab.id, TAB_ID);
  assert.match(value.content, /ref=e1/);
  assert.equal(value.truncated, false);
  host.dispose();
});

test('screenshot returns files with an assigned file id and path', async () => {
  const f = fakeRpc();
  const capture = { name: 'shot-1.png', mime: 'image/png', bytes: 1024, path: '/captures/shot-1.png' };
  const d = fakeDriver({ screenshot: () => Promise.resolve(capture) });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-4', { type: 'screenshot', tabID: TAB_ID });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-4' });
  await flush();

  const answer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-4');
  assert.ok(answer);
  const outcome = answer.input as { outcome: { type: string; result?: { value: unknown } } };
  assert.equal(outcome.outcome.type, 'success');
  assertOutcomeFits('screenshot', outcome.outcome);
  const value = outcome.outcome.result?.value as { files: Array<{ id: string; path: string }> };
  assert.match(value.files[0].id, /^file_[a-f0-9-]{36}$/);
  assert.equal(value.files[0].path, capture.path);
  host.dispose();
});

test('evaluate answers with the script value', async () => {
  const f = fakeRpc();
  const d = fakeDriver({ evaluate: (tabID: unknown, script: unknown) => { assert.equal(script, '1 + 1'); return Promise.resolve(2); } });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-5', { type: 'evaluate', tabID: TAB_ID, script: '1 + 1' });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-5' });
  await flush();

  const answer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-5');
  assert.ok(answer);
  const outcome = answer.input as { outcome: { type: string; result?: { value: unknown } } };
  assertOutcomeFits('evaluate', outcome.outcome);
  const evaluateValue = outcome.outcome.result?.value as { tab: { id: string }; value: unknown };
  assert.equal(evaluateValue.value, 2);
  assert.equal(evaluateValue.tab.id, TAB_ID);
  host.dispose();
});

test('console and network list shape entries under tab', async () => {
  const f = fakeRpc();
  const entry = { id: 'c1', timestampMs: 1, level: 'error', text: 'boom', textTruncated: false };
  const request = { id: 'r1', url: 'https://example.com/a.js', method: 'GET', resourceType: 'script', timestampMs: 2, state: 'completed', durationMs: 5 };
  const d = fakeDriver({
    consoleEntries: () => Promise.resolve({ tab: summary(), messages: [entry], truncated: false, dropped: 0 }),
    networkList: () => Promise.resolve({ tab: summary(), requests: [request], truncated: false, dropped: 0 }),
  });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-6', { type: 'console', tabID: TAB_ID });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-6' });
  await flush();
  f.commandActions.set('req-7', { type: 'network.list', tabID: TAB_ID });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-7' });
  await flush();

  const consoleAnswer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-6');
  assert.ok(consoleAnswer);
  assertOutcomeFits('console', (consoleAnswer.input as { outcome: { type: string; result?: { value: unknown } } }).outcome);
  assert.deepEqual(((consoleAnswer.input as { outcome: { result?: { value: { messages?: unknown[] } } } }).outcome.result?.value)?.messages, [entry]);

  const networkAnswer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-7');
  assert.ok(networkAnswer);
  assertOutcomeFits('network.list', (networkAnswer.input as { outcome: { type: string; result?: { value: unknown } } }).outcome);
  host.dispose();
});

test('navigation failure becomes navigation_failed outcome', async () => {
  const f = fakeRpc();
  const d = fakeDriver({ navigate: () => Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED at https://nope.example')) });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-8', { type: 'navigate', tabID: TAB_ID, url: 'https://nope.example' });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-8' });
  await flush();

  const answer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-8');
  assert.ok(answer);
  const outcome = answer.input as { outcome: { type: string; code?: string; message?: string } };
  assert.equal(outcome.outcome.type, 'failure');
  assert.equal(outcome.outcome.code, 'navigation_failed');
  assert.match(outcome.outcome.message ?? '', /ERR_NAME_NOT_RESOLVED/);
  host.dispose();
});

test('generic driver error becomes operation_failed outcome', async () => {
  const f = fakeRpc();
  const d = fakeDriver({ click: () => Promise.reject(new Error('Element ref is stale')) });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-9', { type: 'click', tabID: TAB_ID, ref: 'e9' });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-9' });
  await flush();

  const answer = f.calls.find((c) => c.method === 'result' && (c.input as { requestID?: string })?.requestID === 'req-9');
  assert.ok(answer);
  const outcome = answer.input as { outcome: { type: string; code?: string } };
  assert.equal(outcome.outcome.type, 'failure');
  assert.equal(outcome.outcome.code, 'operation_failed');
  host.dispose();
});

test('unsupported actions answer with a failure and never touch the driver', async () => {
  const f = fakeRpc();
  const d = fakeDriver();
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  const unsupported = ['files.upload', 'files.drop', 'files.list', 'files.get', 'trace.start', 'trace.stop', 'trace.analyze', 'cpu.start', 'cpu.stop', 'cpu.analyze', 'heap.snapshot', 'heap.summary', 'heap.query', 'heap.object', 'heap.compare', 'lighthouse', 'drag', 'preview'];
  for (const [index, action] of unsupported.entries()) {
    const requestID = `req-u${index}`;
    f.commandActions.set(requestID, { type: action, tabID: TAB_ID });
    f.emit({ type: 'command', connectionID: 'mine', requestID });
  }
  await flush();

  assert.equal(f.results.length, unsupported.length);
  for (const outcome of f.results) {
    assert.equal(outcome.type, 'failure');
    assert.equal((outcome as { code?: string }).code, 'unsupported');
  }
  assert.equal(d.calls.filter((call) => !['listTabs', 'focusedTabID', 'tabSummary', 'dispose'].includes(call.action)).length, 0, 'driver untouched by unsupported actions');
  host.dispose();
});

test('cancel drops a queued command without answering', async () => {
  const f = fakeRpc();
  const d = fakeDriver({ click: () => new Promise<TabSummary>(() => {}), tab: () => summary() });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-10', { type: 'click', tabID: TAB_ID, ref: 'e1' });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-10' });
  f.emit({ type: 'cancel', connectionID: 'mine', requestID: 'req-10' });
  await flush();
  assert.equal(f.results.length, 0, 'cancelled request is not answered');
  host.dispose();
});

test('dispose unsubscribes control events', async () => {
  const f = fakeRpc();
  const d = fakeDriver();
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();
  host.dispose();
  for (const off of f.unsubscribes) off();
  assert.ok(f.unsubscribes.length >= 1);
});

test('commands are dispatched one at a time in arrival order', async () => {
  const f = fakeRpc();
  const order: string[] = [];
  const release: Array<() => void> = [];
  const gate = () => new Promise<void>((resolve) => release.push(resolve));
  const d = fakeDriver({
    navigate: (tabID: unknown, url: unknown) => { order.push(String(url)); return gate().then(() => summary({ url: String(url) })); },
  });
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();

  f.commandActions.set('req-a', { type: 'navigate', tabID: TAB_ID, url: 'https://a.example/' });
  f.commandActions.set('req-b', { type: 'navigate', tabID: TAB_ID, url: 'https://b.example/' });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-a' });
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-b' });
  await flush();
  assert.equal(driverCalled(d, 'navigate').length, 1, 'second command waits for the first');
  release[0]();
  await flush();
  assert.equal(driverCalled(d, 'navigate').length, 2, 'second command dispatched after the first completes');
  release[1]();
  await flush();
  assert.deepEqual(order, ['https://a.example/', 'https://b.example/']);
  assert.equal(f.results.length, 2);
  host.dispose();
});

test('errors fetching a command answer with a failure outcome', async () => {
  const f = fakeRpc();
  const d = fakeDriver();
  const host = startBrowserHost({ rpc: f.rpc, sessionID: 'ses_1', connectionID: 'mine', location: { directory: WORKSPACE }, driver: d.driver, dispatchTimeoutMs: 100 });
  await flush();
  f.setCommandError(new Error('engine hiccup'));
  f.emit({ type: 'command', connectionID: 'mine', requestID: 'req-11' });
  await flush();
  assert.equal(f.results.length, 1);
  assert.equal((f.results[0] as { type?: string }).type, 'failure');
  assert.match((f.results[0] as { message?: string }).message ?? '', /hiccup/);
  host.dispose();
});
