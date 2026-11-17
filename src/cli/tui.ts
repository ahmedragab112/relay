import type { AccessLevel } from '../shared/contracts.js';

export interface LauncherDescriptor {
  version: string;
  binary: string;
  root: string;
  config: string;
  access: AccessLevel;
  pid?: number;
}

export interface LauncherArguments {
  help: boolean;
  version: boolean;
  install: boolean;
  force: boolean;
  auto?: boolean;
  rest: string[];
}

export const APP_OPEN = 'Relay.app is open. Quit it first, or pass --force.';
export const NEEDS_TTY = 'relay needs an interactive terminal. Pass a command instead, for example: relay run "describe the task"';
export const SETUP_REQUIRED = 'Relay has not set up its terminal launcher yet. Open Relay.app once, then run relay again.';
export const CONFIG_MISSING = 'Relay\'s terminal configuration is missing. Open Relay.app once, quit it, then run relay again.';

const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'ask', 'auto', 'full'];

export function parseLauncherArgs(argv: string[]): LauncherArguments {
  const parsed: LauncherArguments = { help: false, version: false, install: false, force: false, rest: [] };
  let index = 0;
  for (; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '-h' || arg === '--help') parsed.help = true;
    else if (arg === '-v' || arg === '--version') parsed.version = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--auto') parsed.auto = true;
    else if (arg === '--no-auto') parsed.auto = false;
    else break;
  }
  parsed.rest = argv.slice(index);
  parsed.install = parsed.rest.length === 1 && parsed.rest[0] === 'install';
  return parsed;
}

export function parseDescriptor(raw: string): LauncherDescriptor {
  let record: Record<string, unknown> | undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object') record = value as Record<string, unknown>;
  } catch { /* reported below */ }
  if (!record) throw new Error(SETUP_REQUIRED);
  const required = (key: string): string => {
    const item = record![key];
    if (typeof item !== 'string' || !item) throw new Error(SETUP_REQUIRED);
    return item;
  };
  const access = typeof record.access === 'string' && (ACCESS_LEVELS as readonly string[]).includes(record.access)
    ? record.access as AccessLevel
    : 'ask';
  return {
    version: typeof record.version === 'string' && record.version ? record.version : 'unknown',
    binary: required('binary'),
    root: required('root'),
    config: required('config'),
    access,
    pid: typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0 ? record.pid : undefined,
  };
}

export function autoApproval(access: AccessLevel, override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  return access === 'auto' || access === 'full';
}

export function opencodeArgs(rest: string[], auto: boolean): string[] {
  if (!rest.length) return ['--standalone', ...(auto ? ['--auto'] : [])];
  const [command, ...tail] = rest;
  // `--auto` exists on the interactive command and on `run`, but not on other subcommands.
  return ['--standalone', command, ...(auto && command === 'run' ? ['--auto'] : []), ...tail];
}

export interface Workspace {
  directory?: string;
  rest: string[];
  error?: string;
}

export function resolveWorkspace(rest: string[], isDirectory: (path: string) => boolean): Workspace {
  const first = rest[0];
  if (first === undefined) return { rest };
  if (isDirectory(first)) return { directory: first, rest: rest.slice(1) };
  if (first.includes('/') || first.includes('\\') || first.startsWith('.')) return { rest, error: `No folder at "${first}".` };
  return { rest };
}

export function appGate(input: { force: boolean; appRunning: boolean }): string | undefined {
  return input.appRunning && !input.force ? APP_OPEN : undefined;
}

export function ttyGate(input: { interactive: boolean; engineArgs: string[] }): string | undefined {
  return !input.interactive && input.engineArgs.length === 0 ? NEEDS_TTY : undefined;
}

export function helpText(): string {
  return [
    'relay — Relay\'s coding agent in your terminal',
    '',
    'Usage:',
    '  relay                      Start the agent in the current folder',
    '  relay <folder>             Start it in <folder>',
    '  relay <command> [...]      Run an engine command (run, models, session, …)',
    '  relay install              Put relay on your PATH',
    '',
    'Options:',
    '  --auto                     Approve actions without asking (default from Relay\'s access setting)',
    '  --no-auto                  Always ask before acting',
    '  --force                    Run while Relay.app is open (not recommended)',
    '  -h, --help                 Show this help',
    '  -v, --version              Show the version',
    '',
    'The agent uses Relay\'s providers, skills, and workspace history.',
    'Quit Relay.app first: both share the same sessions.',
  ].join('\n');
}
