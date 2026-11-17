import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { chmod, lstat, mkdir, readlink, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sidecarEnvironment } from '../shared/sidecar.js';
import {
  CONFIG_MISSING, SETUP_REQUIRED, appGate, autoApproval, helpText, opencodeArgs, parseDescriptor,
  parseLauncherArgs, resolveWorkspace, ttyGate, type LauncherDescriptor,
} from './tui.js';

function stateDirectory(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'relay-workspace');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'relay-workspace');
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'relay-workspace');
}

function readDescriptor(): LauncherDescriptor {
  let raw: string;
  try {
    raw = readFileSync(join(stateDirectory(), 'relay.json'), 'utf8');
  } catch {
    throw new Error(SETUP_REQUIRED);
  }
  return parseDescriptor(raw);
}

function appRunning(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function enableTerminal(): Promise<void> {
  const directory = stateDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 }).catch(() => undefined);
  await writeFile(join(directory, 'terminal-enabled'), '', { mode: 0o600 }).catch(() => undefined);
}

async function install(): Promise<number> {
  const self = fileURLToPath(import.meta.url);
  if (process.platform === 'win32') {
    console.error(`Windows: add this folder to PATH and create relay.cmd: ${dirname(self)}`);
    return 1;
  }
  const directory = process.env.RELAY_BIN_DIR ?? '/usr/local/bin';
  const target = join(directory, 'relay');
  await mkdir(directory, { recursive: true }).catch(() => undefined);
  await chmod(self, 0o755).catch(() => undefined);
  const existing = await lstat(target).catch(() => undefined);
  if (existing && !existing.isSymbolicLink()) {
    console.error(`${target} already exists and is not a relay link. Remove it, then run install again.`);
    return 1;
  }
  if (existing) {
    const current = await readlink(target).catch(() => '');
    if (current && resolve(current) === resolve(self)) {
      await enableTerminal();
      console.log(`relay is already installed at ${target}`);
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
  await enableTerminal();
  console.log(`Installed relay at ${target}`);
  console.log('Relay now keeps its generated engine config (mode 0600) so relay works while Relay.app is closed.');
  const pathDirs = (process.env.PATH ?? '').split(':');
  if (!pathDirs.includes(directory)) console.log(`Note: ${directory} is not on your PATH.`);
  return 0;
}

function version(): number {
  try {
    console.log(`relay ${readDescriptor().version}`);
  } catch {
    console.log('relay (Relay has not been launched yet)');
  }
  return 0;
}

async function run(argv: string[]): Promise<number> {
  const flags = parseLauncherArgs(argv);
  if (flags.help) {
    console.log(helpText());
    return 0;
  }
  if (flags.version) return version();
  if (flags.install) return install();
  const descriptor = readDescriptor();
  const blocked = appGate({ force: flags.force, appRunning: appRunning(descriptor.pid) });
  if (blocked) {
    console.error(blocked);
    return 1;
  }
  if (!existsSync(descriptor.config)) {
    console.error(CONFIG_MISSING);
    return 1;
  }
  const workspace = resolveWorkspace(flags.rest, (path) => {
    try { return statSync(path).isDirectory(); } catch { return false; }
  });
  if (workspace.error) {
    console.error(workspace.error);
    return 2;
  }
  const needsTerminal = ttyGate({ interactive: Boolean(process.stdin.isTTY), engineArgs: workspace.rest });
  if (needsTerminal) {
    console.error(needsTerminal);
    return 1;
  }
  const args = opencodeArgs(workspace.rest, autoApproval(descriptor.access, flags.auto));
  const env = { ...process.env, ...sidecarEnvironment(descriptor.root, randomBytes(32).toString('base64url'), descriptor.config) };
  const engine = spawnSync(descriptor.binary, args, { cwd: workspace.directory ?? process.cwd(), env, stdio: 'inherit' });
  if (engine.error) {
    const code = (engine.error as NodeJS.ErrnoException).code;
    console.error(code === 'ENOENT'
      ? `Relay's engine binary is missing at ${descriptor.binary}. Reinstall Relay.app.`
      : engine.error.message);
    return 1;
  }
  return engine.status ?? (engine.signal ? 1 : 0);
}

run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
