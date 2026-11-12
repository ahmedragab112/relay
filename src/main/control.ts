import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppEvent } from '../shared/contracts.js';

export interface ControlOptions {
  /** Base directory for Relay's own state (userData/relay). */
  root: string;
  version: string;
  emit: (event: AppEvent) => void;
  listTasks: () => Promise<Array<{ id: string; title: string; status: string }>>;
  createTask: (title: string, prompt?: string) => Promise<{ id: string; title: string }>;
  listSkills: () => Promise<Array<{ id: string; name: string; description: string }>>;
  installSkill: (url: string, sha256?: string) => Promise<Array<{ id: string; name: string }>>;
  listAutomations: () => { jobs: unknown[]; runs: unknown[] };
  saveAutomation: (input: unknown) => Promise<{ jobs: unknown[]; runs: unknown[] }>;
  runAutomation: (id: string) => Promise<{ jobs: unknown[]; runs: unknown[] }>;
}
const CLI = `#!/usr/bin/env node
// relayctl — command line access to the running Relay app.
// Agents with shell access can drive Relay:
//   node relayctl.mjs health
//   node relayctl.mjs tasks
//   node relayctl.mjs create-task '{"title":"Triage the flaky suite","prompt":"Fix the flaky test"}'
//   node relayctl.mjs open-page '{"url":"https://example.com"}'
//   node relayctl.mjs skills
//   node relayctl.mjs install-skill '{"url":"https://github.com/owner/repo/tree/main/skills/foo"}'
//   node relayctl.mjs automations
//   node relayctl.mjs create-automation '{"name":"Daily triage","action":{"kind":"prompt","prompt":"Summarize failures","location":"local","output":"independent","access":"ask","model":"provider::model"},"schedule":{"kind":"daily","time":"09:00"},"timezone":"UTC","enabled":true}'
//   node relayctl.mjs run-automation '{"id":"<automation id>"}'
import { readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { join } from 'node:path';
const controlPath = process.env.RELAY_CONTROL || join(os.homedir(), 'Library', 'Application Support', 'relay-workspace', 'control.json');
const control = JSON.parse(readFileSync(controlPath, 'utf8'));
const [cmd, ...rest] = process.argv.slice(2);
const arg = rest.length ? JSON.parse(rest.join(' ')) : undefined;
const routes = {
  health: ['GET', '/health'],
  tasks: ['GET', '/tasks'],
  skills: ['GET', '/skills'],
  automations: ['GET', '/automations'],
  'create-task': ['POST', '/task'],
  'open-page': ['POST', '/open-page'],
  'install-skill': ['POST', '/skills/install'],
  'create-automation': ['POST', '/automations'],
  'run-automation': ['POST', '/automations/run'],
};
const route = routes[cmd];
if (!route) { console.error('Unknown command. Use: ' + Object.keys(routes).join(', ')); process.exit(1); }
const [method, path] = route;
const body = method === 'POST' ? JSON.stringify(arg ?? {}) : undefined;
const request = http.request(
  { host: '127.0.0.1', port: control.port, path, method, headers: { 'x-relay-token': control.token, ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) } },
  response => { let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; }); response.on('end', () => { console.log(text); process.exit(response.statusCode >= 400 ? 1 : 0); }); },
);
request.on('error', error => { console.error(String(error)); process.exit(1); });
request.write(body ?? '');
request.end();
`;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 64 * 1024) return undefined;
  }
  if (!data.trim()) return undefined;
  try { return JSON.parse(data) as Record<string, unknown>; } catch { return undefined; }
}

function httpURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

const SKILL = `---
description: Drive the running Relay desktop app from the shell — open a page in its in-app browser, create or list tasks, install skills, and manage automations. Use when the user asks to use the Relay app, open something in Relay, or work with Relay tasks/skills/automations.
---
# Relay control
Relay runs a local control server. The CLI is written next to its state directory:

    ls ~/Library/Application\\ Support/relay-workspace/relayctl.mjs

Use it instead of any other tool when acting on the running Relay app:

    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs health
    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs tasks
    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs create-task '{"title":"Triage the flaky suite","prompt":"Fix the flaky test"}'
    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs open-page '{"url":"https://example.com"}'
    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs skills
    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs install-skill '{"url":"https://github.com/owner/repo/tree/main/skills/foo"}'
    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs automations
    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs create-automation '{"name":"Daily triage","action":{"kind":"prompt","prompt":"Summarize failures","location":"local","output":"independent","access":"ask","model":"provider::model"},"schedule":{"kind":"daily","time":"09:00"},"timezone":"UTC","enabled":true}'
    node ~/Library/Application\\ Support/relay-workspace/relayctl.mjs run-automation '{"id":"<automation id>"}'

Rules: only http/https pages can be opened; create-task starts a new Relay task; tasks created with a prompt start running immediately. install-skill installs immediately with no preview — only install a skill the user explicitly asked for. create-automation validates and schedules immediately. Never use this for changing Relay's configuration files — change settings in the app itself.
`;

export async function startControlServer(options: ControlOptions): Promise<void> {
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (req, res) => {
    try {
      if (req.headers['x-relay-token'] !== token) { json(res, 403, { error: 'Forbidden' }); return; }
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/health') { json(res, 200, { ok: true, version: options.version, app: 'relay' }); return; }
      if (req.method === 'GET' && path === '/tasks') { json(res, 200, { tasks: await options.listTasks() }); return; }
      if (req.method === 'POST' && path === '/task') {
        const body = await readBody(req);
        const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : undefined;
        if (!title) { json(res, 400, { error: 'title is required' }); return; }
        json(res, 200, await options.createTask(title, prompt));
        return;
      }
      if (req.method === 'POST' && path === '/open-page') {
        const body = await readBody(req);
        const url = typeof body?.url === 'string' ? body.url.trim() : '';
        const safe = httpURL(url);
        if (!safe) { json(res, 400, { error: 'Only http or https URLs can be opened.' }); return; }
        options.emit({ type: 'agent-open-page', url: safe });
        json(res, 200, { opened: safe });
        return;
      }
      if (req.method === 'GET' && path === '/skills') { json(res, 200, { skills: await options.listSkills() }); return; }
      if (req.method === 'POST' && path === '/skills/install') {
        const body = await readBody(req);
        const url = typeof body?.url === 'string' ? body.url.trim() : '';
        if (!url || !httpURL(url)) { json(res, 400, { error: 'Only http or https skill URLs can be installed.' }); return; }
        const sha256 = typeof body?.sha256 === 'string' ? body.sha256.trim() : undefined;
        json(res, 200, { installed: await options.installSkill(url, sha256) });
        return;
      }
      if (req.method === 'GET' && path === '/automations') { json(res, 200, options.listAutomations()); return; }
      if (req.method === 'POST' && path === '/automations') {
        const body = await readBody(req);
        if (!body) { json(res, 400, { error: 'JSON automation input is required.' }); return; }
        json(res, 200, await options.saveAutomation(body));
        return;
      }
      if (req.method === 'POST' && path === '/automations/run') {
        const body = await readBody(req);
        const id = typeof body?.id === 'string' ? body.id.trim() : '';
        if (!id) { json(res, 400, { error: 'id is required.' }); return; }
        json(res, 200, await options.runAutomation(id));
        return;
      }
      json(res, 404, { error: 'Not found. Available: /health, /tasks, /task, /skills, /skills/install, /automations, /automations/run, /open-page.' });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'Control server error' });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Relay control server could not bind.');
  const parent = dirname(options.root);
  await writeFile(join(parent, 'control.json'), JSON.stringify({ port: address.port, token, pid: process.pid }), { mode: 0o600 });
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await writeFile(join(parent, 'relayctl.mjs'), CLI, { mode: 0o700 });
  // Teach agents how to reach the app. Best effort — never block boot.
  try {
    const skillsDir = join(process.env.HOME ?? process.cwd(), '.config', 'opencode', 'skills', 'relay-control');
    await mkdir(skillsDir, { recursive: true });
    const skillPath = join(skillsDir, 'SKILL.md');
    try { await access(skillPath); } catch { await writeFile(skillPath, SKILL); }
  } catch { /* skill is optional */ }
}
