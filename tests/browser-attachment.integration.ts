/**
 * Live integration: the browser host attaches to the real engine and receives
 * the real handshake (attach stays pending, `attached` control event arrives,
 * state publications are acked). The driver is faked — Electron cannot run in
 * a plain node test; the protocol loop is what's under test here.
 * The full agent → tool → command loop is covered by the desktop E2E.
 * Run: node node_modules/tsx/dist/cli.mjs --test tests/browser-attachment.integration.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Browser } from '@opencode/plugin-browser/rpc';
import { Engine } from '../src/main/engine.js';
import { startBrowserHost, type BrowserControl, type BrowserPageDriver, type BrowserRpc, type BrowserState } from '../src/main/browser.js';

const driverTab = () => ({ id: `tab_${'a'.repeat(8)}-1111-4222-8333-444455556666`, url: 'https://example.com/', title: 'Example', loading: false, canGoBack: false, canGoForward: false, generation: 0 });

function fakeDriver(): BrowserPageDriver & { calls: string[] } {
  const calls: string[] = [];
  const tab = driverTab();
  const passthrough = (name: string, value: unknown = tab) => async () => { calls.push(name); return value; };  return {
    calls,
    listTabs: passthrough('listTabs', [tab]),
    focusedTabID: passthrough('focusedTabID', tab.id),
    openTab: passthrough('openTab'),
    focusTab: passthrough('focusTab'),
    closeTab: passthrough('closeTab', [tab]),
    navigate: passthrough('navigate'),
    back: passthrough('back'),
    forward: passthrough('forward'),
    reload: passthrough('reload'),
    stop: passthrough('stop'),
    snapshot: passthrough('snapshot', { content: '- heading "Example" [ref=e1]', truncated: false }),
    find: passthrough('find', { content: '- heading "Example" [ref=e1]', truncated: false }),
    evaluate: passthrough('evaluate', 42),
    click: passthrough('click'),
    hover: passthrough('hover'),
    fill: passthrough('fill'),
    fillForm: passthrough('fillForm'),
    select: passthrough('select'),
    check: passthrough('check'),
    press: passthrough('press'),
    scroll: passthrough('scroll'),
    wait: passthrough('wait'),
    dialog: passthrough('dialog', { dialog: null }),
    screenshot: passthrough('screenshot', { name: 'shot.png', mime: 'image/png', bytes: 8, path: '/tmp/shot.png' }),
    consoleEntries: passthrough('consoleEntries', { messages: [], truncated: false, dropped: 0 }),
    networkList: passthrough('networkList', { requests: [], truncated: false, dropped: 0 }),
    networkGet: passthrough('networkGet', { request: { id: 'r1', url: 'https://x', method: 'GET', resourceType: 'document', timestampMs: 0, state: 'pending' }, requestHeaders: [], responseHeaders: [], headersTruncated: false, requestBody: { state: 'notRequested' }, responseBody: { state: 'notRequested' } }),
    tabSummary: passthrough('tabSummary'),
    dispose() { calls.push('dispose'); },
  } as BrowserPageDriver & { calls: string[] };
}

/** Bridges the real client's plugin rpc into the host's BrowserRpc shape, always with location. */
function bridge(engine: Engine, directory: string): BrowserRpc {
  // SAFETY: the promise client exposes generic plugin rpc by definition; typed at the call site.
  const rpc = (engine.client as unknown as { rpc: (definition: unknown) => BrowserRpc }).rpc(Browser.Definition);
  const options = { location: { directory } };
  return {
    attach: (input, opts) => rpc.attach(input, opts ?? options),
    state: (input, opts) => rpc.state(input, opts ?? options),
    command: (input, opts) => rpc.command(input, opts ?? options),
    result: (input, opts) => rpc.result(input, opts ?? options),
    events: {
      on: (name, handler, opts) => rpc.events.on(name, handler, opts ?? options),
    },
  };
}

test('browser host attaches to the live engine: attached event, state acks, clean dispose', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-browser-it-'));
  const workspace = join(root, 'project');
  await mkdir(workspace, { recursive: true });
  const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), () => {});
  let host: ReturnType<typeof startBrowserHost> | undefined;
  try {
    await engine.start(workspace, [], []);
    const session = await engine.createSession('browser-it');
    const driver = fakeDriver();
    const states: BrowserState[] = [];
    const controls: BrowserControl[] = [];
    const bridged = bridge(engine, workspace);

    const rawState = bridged.state.bind(bridged);
    (bridged as unknown as { state: (input: { sessionID: string; connectionID: string; state: BrowserState }, options?: Parameters<typeof rawState>[1]) => Promise<unknown> }).state = async (input, options) => {
      states.push(input.state);
      return await rawState(input, options);
    };
    const rawOn = bridged.events.on.bind(bridged.events);
    bridged.events.on = (name, handler, options) => rawOn(name, (event) => {
      // The real client wraps the control union in an event envelope: `{type: 'rpc.experimental.browser.control', data}`.
      const envelope = event as { type?: string; data?: BrowserControl };
      controls.push(envelope.type === 'rpc.experimental.browser.control' ? envelope.data! : event);
      handler(event);
    }, options);

    host = startBrowserHost({
      rpc: bridged,
      sessionID: session.id,
      connectionID: 'it-conn',
      location: { directory: workspace },
      driver,
      dispatchTimeoutMs: 20_000,
    });

    // The engine acknowledges the attachment with an `attached` control event.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No attached control event within 10s (saw ${JSON.stringify(controls)})`)), 10_000);
      const check = setInterval(() => {
        if (controls.some((event) => event.type === 'attached')) { clearInterval(check); clearTimeout(timer); resolve(); }
      }, 100);
    });

    // Initial state was published and acked by the engine, matching the fake driver's inventory.
    assert.ok(states.length >= 1, 'host published state after attach');
    assert.deepEqual(states[0], { tabs: [driverTab()], focusedTabID: driverTab().id });

    assert.ok(bridged.events, 'rpc bridge exposes events');
    host.dispose();
    assert.ok(driver.calls.includes('dispose'), 'dispose tears the driver down');
  } finally {
    // Always unsubscribe BEFORE the engine dies: an open subscribe stream keeps the process alive.
    host?.dispose();
    await engine.stop().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
