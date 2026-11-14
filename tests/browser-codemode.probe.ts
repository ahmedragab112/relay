/**
 * Probe: prove the model → `execute` (Code Mode) → browser tool → host loop
 * against the real engine, with a fake OpenAI-compatible model and a fake
 * driver standing in for Electron. Run:
 *   node node_modules/tsx/dist/cli.mjs tests/browser-codemode.probe.ts
 */
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Browser } from '@opencode/plugin-browser/rpc';
import { Engine } from '../src/main/engine.js';
import { startBrowserHost, type BrowserPageDriver, type BrowserRpc, type TabSummary } from '../src/main/browser.js';

const verdicts: string[] = [];
const modelCalls: string[] = [];

const fakeModel = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    modelCalls.push(body.slice(0, 2_000_000));
    const base = { id: 'chatcmpl-probe', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'test-model' };
    const headers = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' };
    const stop = (text: string) => {
      response.writeHead(200, headers);
      response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    };
    const hasToolRole = body.includes('"role":"tool"') || body.includes('"role\\":\\"tool\\"');
    const port = (fakeModel.address() as { port: number }).port;
    if (body.includes('relay-browser') && !hasToolRole) {
      const code = [
        `const tab = await tools.browser.tabs.open({ url: "http://127.0.0.1:${pagePort}/page" })`,
        'await tools.browser.wait({ tabID: tab.id, condition: "load" })',
        'const snap = await tools.browser.snapshot({ tabID: tab.id })',
        'return snap.content',
      ].join('\n');
      response.writeHead(200, headers);
      response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_probe_execute', type: 'function', function: { name: 'execute', arguments: JSON.stringify({ code }) } }] }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
      return;
    }
    if (hasToolRole) {
      const ok = body.includes('Relay preview page');
      verdicts.push(ok ? 'SNAPSHOT_OK' : `SNAPSHOT_MISSING — tool result excerpt: ${body.match(/"content":"([^"]{0,300})/)?.[1] ?? body.slice(-400)}`);
      stop(ok ? 'Browser check: SNAPSHOT_OK' : 'Browser check: SNAPSHOT_MISSING');
      return;
    }
    stop('Hello from the probe model.');
  });
});

// A local page server for the browser to open; declared first so the code string above can use its port.
const pageServer = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>Relay Preview</title><h1>Relay preview page</h1>');
});

await new Promise<void>((resolveListen) => { fakeModel.listen(0, '127.0.0.1', () => resolveListen()); });
await new Promise<void>((resolveListen) => { pageServer.listen(0, '127.0.0.1', () => resolveListen()); });
const pagePort = (pageServer.address() as { port: number }).port;

const driverCalls: Array<{ action: string; args: unknown[] }> = [];
const tab: TabSummary = { id: `tab_11111111-2222-4333-8444-555566667777`, url: 'about:blank', title: '', loading: false, canGoBack: false, canGoForward: false, generation: 0 };
const driver: BrowserPageDriver = {
  listTabs: async () => [tab],
  focusedTabID: async () => tab.id,
  tabSummary: async () => tab,
  openTab: async (url) => { driverCalls.push({ action: 'openTab', args: [url] }); return { ...tab, url: String(url) }; },
  focusTab: async () => tab,
  closeTab: async () => [tab],
  navigate: async (_id, url) => { driverCalls.push({ action: 'navigate', args: [url] }); return { ...tab, url }; },
  back: async () => tab,
  forward: async () => tab,
  reload: async () => tab,
  stop: async () => tab,
  snapshot: async () => { driverCalls.push({ action: 'snapshot', args: [] }); return { content: '- heading "Relay preview page" [level=1]', truncated: false }; },
  find: async () => ({ content: '', truncated: false }),
  evaluate: async () => null,
  click: async () => tab,
  hover: async () => tab,
  fill: async () => tab,
  fillForm: async () => tab,
  select: async () => tab,
  check: async () => tab,
  press: async () => tab,
  scroll: async () => tab,
  wait: async (_id, condition) => { driverCalls.push({ action: 'wait', args: [condition] }); return tab; },
  dialog: async () => ({ dialog: null }),
  screenshot: async () => ({ name: 'shot.png', mime: 'image/png', bytes: 8, path: '/tmp/shot.png' }),
  consoleEntries: async () => ({ messages: [], truncated: false, dropped: 0 }),
  networkList: async () => ({ requests: [], truncated: false, dropped: 0 }),
  networkGet: async () => ({ request: { id: 'r', url: '', method: 'GET', resourceType: 'document', timestampMs: 0, state: 'pending' }, requestHeaders: [], responseHeaders: [], headersTruncated: false, requestBody: { state: 'notRequested' }, responseBody: { state: 'notRequested' } }),
  dispose() { driverCalls.push({ action: 'dispose', args: [] }); },
};

const root = await mkdtemp(join(tmpdir(), 'relay-codemode-probe-'));
const workspace = join(root, 'project');
await mkdir(workspace, { recursive: true });
const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), () => {});
let host: ReturnType<typeof startBrowserHost> | undefined;
try {
  const previewPort = (fakeModel.address() as { port: number }).port;
  await engine.start(workspace, [{ id: 'custom', baseURL: `http://127.0.0.1:${previewPort}/v1`, models: ['test-model'] }], []);
  const session = await engine.createSession('probe');
  const rpc = (engine.client as unknown as { rpc: (definition: unknown) => BrowserRpc }).rpc(Browser.Definition) as BrowserRpc;
  const options = { location: { directory: workspace } };
  const bridged: BrowserRpc = {
    attach: (input, opts) => rpc.attach(input, opts ?? options),
    state: (input, opts) => rpc.state(input, opts ?? options),
    command: (input, opts) => rpc.command(input, opts ?? options),
    result: (input, opts) => rpc.result(input, opts ?? options),
    events: { on: (name, handler, opts) => rpc.events.on(name, handler, opts ?? options) },
  };
  host = startBrowserHost({ rpc: bridged, sessionID: session.id, connectionID: 'probe-conn', location: { directory: workspace }, driver, dispatchTimeoutMs: 30_000 });
  await new Promise((r) => setTimeout(r, 800));

  try {
    await engine.sendMessage({ sessionId: session.id, text: 'relay-browser open the preview page', model: 'custom::test-model', variant: '', access: 'full', files: [], skills: [] } as never);
  } catch (error) {
    console.log('SEND FAILED:', error instanceof Error ? error.message : error);
  }

  // Poll session messages until an assistant text contains the verdict.
  const deadline = Date.now() + 60_000;
  let seen = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const messages = await engine.getMessages(session.id).catch(() => []);
    const parts = messages.flatMap((message: { parts?: Array<{ type: string; text?: string; tool?: string; state?: { status?: string } }> }) => message.parts ?? []);
    const texts = parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join(' | ');
    if (texts) seen = texts;
    const toolParts = parts.filter((part) => part.type === 'tool');
    if (verdicts.length && texts.includes('SNAPSHOT')) break;
    if (toolParts.some((part) => part.state?.status === 'error')) {
      console.log('TOOL ERROR PART:', JSON.stringify(parts.filter((part) => part.type === 'tool'), null, 1).slice(0, 3000));
      break;
    }
  }
  console.log('VERDICTS:', verdicts.length ? verdicts : ['(none within 60s)']);
  console.log('LAST ASSISTANT TEXT:', seen.slice(-300));
  console.log('DRIVER CALLS:', JSON.stringify(driverCalls));
  console.log('MODEL CALL COUNT:', modelCalls.length);
  if (verdicts[0] !== 'SNAPSHOT_OK') {
    const last = modelCalls[modelCalls.length - 1] ?? '';
    const at = last.indexOf('"tool"');
    console.log('--- tool result region:', at >= 0 ? last.slice(at - 200, at + 1600) : '(no tool part found)');
  }
} catch (error) {
  console.log('PROBE FAILED:', error instanceof Error ? error.stack : error);
} finally {
  host?.dispose();
  await engine.stop().catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
  fakeModel.close();
  pageServer.close();
  // Drain stdout before exiting so piped output is not truncated.
  await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
  process.exit(0);
}
