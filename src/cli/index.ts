import { readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, readlink, symlink, unlink } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, buildRequest, helpText, parseArgs } from './commands.js';
import {
  NOT_RUNNING, renderAutomationRun, renderAutomations, renderHealth, renderInstalled, renderOpened,
  renderServerError, renderSkills, renderTaskCreated, renderTasks,
  type AutomationsBody, type SkillSummary, type TaskSummary,
} from './render.js';

const TIMEOUT_MS = 15_000;

interface Control { port: number; token: string; pid?: number }

function controlPath(): string {
  if (process.env.RELAY_CONTROL) return process.env.RELAY_CONTROL;
  const home = os.homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'relay-workspace', 'control.json');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'relay-workspace', 'control.json');
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'relay-workspace', 'control.json');
}

function readControl(): Control {
  const path = controlPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(NOT_RUNNING);
  }
  try {
    const value = JSON.parse(raw) as Partial<Control>;
    if (typeof value.port !== 'number' || typeof value.token !== 'string') throw new Error('invalid');
    return { port: value.port, token: value.token, pid: value.pid };
  } catch {
    throw new Error(`Relay's control file at ${path} is unreadable. Restart Relay.app.`);
  }
}

function send(control: Control, method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request({
      host: '127.0.0.1',
      port: control.port,
      path,
      method,
      timeout: TIMEOUT_MS,
      headers: {
        'x-relay-token': control.token,
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { text += chunk; });
      response.on('end', () => {
        let data: unknown = undefined;
        try { data = text ? JSON.parse(text) : undefined; } catch { data = { error: text.trim() }; }
        resolvePromise({ status: response.statusCode ?? 0, data });
      });
    });
    request.on('timeout', () => request.destroy(new Error('Relay did not answer in time.')));
    request.on('error', (error: NodeJS.ErrnoException) => {
      const unreachable = ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH'];
      reject(new Error(unreachable.includes(error.code ?? '') ? NOT_RUNNING : error.message));
    });
    request.end(payload);
  });
}

function render(command: string, data: unknown, port: number): string {
  switch (command) {
    case 'health': return renderHealth(String((data as { version?: string } | undefined)?.version ?? 'Relay'), port);
    case 'tasks': return renderTasks((data ?? {}) as { tasks?: TaskSummary[] });
    case 'skills': return renderSkills((data ?? {}) as { skills?: SkillSummary[] });
    case 'automations': return renderAutomations((data ?? {}) as AutomationsBody);
    case 'create-task': return renderTaskCreated((data ?? {}) as { id?: string; title?: string });
    case 'open-page': return renderOpened((data ?? {}) as { opened?: string });
    case 'install-skill': return renderInstalled((data ?? {}) as { installed?: Array<{ name?: string }> });
    case 'run-automation': return renderAutomationRun((data ?? {}) as AutomationsBody);
    default: return JSON.stringify(data, null, 2) ?? '';
  }
}

async function install(): Promise<number> {
  const self = fileURLToPath(import.meta.url);
  if (process.platform === 'win32') {
    console.error(`Windows: add this folder to PATH and create relayctl.cmd: ${dirname(self)}`);
    return 1;
  }
  const directory = process.env.RELAYCTL_BIN_DIR ?? '/usr/local/bin';
  const target = join(directory, 'relayctl');
  await mkdir(directory, { recursive: true }).catch(() => undefined);
  await chmod(self, 0o755).catch(() => undefined);
  const existing = await lstat(target).catch(() => undefined);
  if (existing) {
    if (!existing.isSymbolicLink()) {
      console.error(`${target} already exists and is not a relayctl link. Remove it, then run install again.`);
      return 1;
    }
    const current = await readlink(target).catch(() => '');
    if (current && resolve(current) === resolve(self)) {
      console.log(`relayctl is already installed at ${target}`);
      return 0;
    }
    await unlink(target);
  }
  try {
    await symlink(self, target);
  } catch (error) {
    console.error(`Could not link ${target}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  console.log(`Installed relayctl at ${target}`);
  const pathDirs = (process.env.PATH ?? '').split(':');
  if (!pathDirs.includes(directory)) console.log(`Note: ${directory} is not on your PATH.`);
  return 0;
}

async function version(): Promise<number> {
  try {
    const control = readControl();
    const { status, data } = await send(control, 'GET', '/health');
    if (status === 200 && data && typeof data === 'object') {
      console.log(`relayctl (Relay ${String((data as { version?: string }).version ?? 'unknown')})`);
      return 0;
    }
  } catch { /* fall through to the offline line */ }
  console.log('relayctl (Relay is not running)');
  return 0;
}

async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.errors.length) {
    for (const error of parsed.errors) console.error(error);
    console.error('Run "relayctl --help" for usage.');
    return 2;
  }
  if (parsed.version) return version();
  if (parsed.help || !parsed.command) {
    console.log(helpText());
    return 0;
  }
  if (parsed.command === 'install') return install();
  const spec = COMMANDS[parsed.command];
  if (!spec) {
    console.error(`Unknown command "${parsed.command}". Run "relayctl --help".`);
    return 2;
  }
  const built = buildRequest(spec, parsed.flags, parsed.payload);
  if (built.error) {
    console.error(built.error);
    return 2;
  }
  const control = readControl();
  const response = await send(control, spec.method, spec.path, built.body);
  if (response.status >= 400) {
    console.error(renderServerError(response.status, (response.data ?? {}) as { error?: string }));
    return 1;
  }
  console.log(parsed.json
    ? JSON.stringify(response.data ?? {}, null, 2)
    : render(parsed.command, response.data, control.port));
  return 0;
}

run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
