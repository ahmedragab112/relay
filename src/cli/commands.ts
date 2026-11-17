export type Method = 'GET' | 'POST';

export interface CommandSpec {
  method: Method;
  path: string;
  summary: string;
  usage: string;
  flags: readonly string[];
}

export const COMMANDS: Record<string, CommandSpec> = {
  health: { method: 'GET', path: '/health', summary: 'Check that Relay is running', usage: 'relayctl health', flags: [] },
  tasks: { method: 'GET', path: '/tasks', summary: 'List tasks', usage: 'relayctl tasks', flags: [] },
  skills: { method: 'GET', path: '/skills', summary: 'List installed skills', usage: 'relayctl skills', flags: [] },
  automations: { method: 'GET', path: '/automations', summary: 'List automations and recent runs', usage: 'relayctl automations', flags: [] },
  'create-task': {
    method: 'POST',
    path: '/task',
    summary: 'Create a task; it starts running as soon as --prompt is given',
    usage: 'relayctl create-task --title "Triage the flaky suite" [--prompt "Fix the flaky test"]',
    flags: ['title', 'prompt'],
  },
  'open-page': {
    method: 'POST',
    path: '/open-page',
    summary: 'Open an http(s) page in the in-app browser',
    usage: 'relayctl open-page --url https://example.com',
    flags: ['url'],
  },
  'install-skill': {
    method: 'POST',
    path: '/skills/install',
    summary: 'Install a skill from an http(s) URL',
    usage: 'relayctl install-skill --url https://github.com/owner/repo/tree/main/skills/foo [--sha256 <hash>]',
    flags: ['url', 'sha256'],
  },
  'create-automation': {
    method: 'POST',
    path: '/automations',
    summary: 'Create or update an automation from a JSON payload',
    usage: 'relayctl create-automation \'{"name":"Daily triage","action":{"kind":"prompt","prompt":"Summarize failures","location":"local","output":"independent","access":"ask","model":"provider::model"},"schedule":{"kind":"daily","time":"09:00"},"timezone":"UTC","enabled":true}\'',
    flags: [],
  },
  'run-automation': {
    method: 'POST',
    path: '/automations/run',
    summary: 'Run an automation now',
    usage: 'relayctl run-automation --id <automation id>',
    flags: ['id'],
  },
};

export const LOCAL_COMMANDS: Record<string, string> = {
  install: 'Put relayctl on your PATH',
};

export interface ParsedArgs {
  command?: string;
  flags: Record<string, string>;
  payload?: Record<string, unknown>;
  json: boolean;
  help: boolean;
  version: boolean;
  errors: string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = { flags: {}, json: false, help: false, version: false, errors: [] };
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? '';
    if (arg === '--json') { parsed.json = true; continue; }
    if (arg === '--help' || arg === '-h') { parsed.help = true; continue; }
    if (arg === '--version' || arg === '-v') { parsed.version = true; continue; }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      if (equals !== -1) {
        parsed.flags[arg.slice(2, equals)] = arg.slice(equals + 1);
        continue;
      }
      const name = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        parsed.errors.push(`Missing value for --${name}.`);
        continue;
      }
      parsed.flags[name] = value;
      index++;
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) { parsed.errors.push(`Unknown option ${arg}.`); continue; }
    if (parsed.command === undefined) parsed.command = arg;
    else positionals.push(arg);
  }
  if (positionals.length) {
    const raw = positionals.join(' ');
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed.payload = value as Record<string, unknown>;
      else parsed.errors.push('Positional arguments must be a JSON object.');
    } catch {
      parsed.errors.push('Positional arguments must be a JSON object, wrapped in single quotes.');
    }
  }
  return parsed;
}

export function httpURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface RequestBody {
  body?: Record<string, unknown>;
  error?: string;
}

export function buildRequest(
  spec: CommandSpec,
  flags: Record<string, string>,
  payload?: Record<string, unknown>,
): RequestBody {
  if (spec.method === 'GET') {
    if (payload || Object.keys(flags).length) return { error: `The ${spec.path} command takes no arguments.` };
    return {};
  }
  const allowed = new Set(spec.flags);
  const unknown = Object.keys(flags).find((name) => !allowed.has(name));
  if (unknown) return { error: `Unknown option --${unknown} for this command.` };
  const merged: Record<string, unknown> = { ...(payload ?? {}), ...flags };

  if (spec.path === '/task') {
    const title = text(merged.title);
    if (!title) return { error: 'A task title is required: --title "..."' };
    const prompt = text(merged.prompt);
    return { body: prompt ? { title, prompt } : { title } };
  }
  if (spec.path === '/open-page') {
    const raw = text(merged.url);
    if (!raw) return { error: 'A page URL is required: --url https://...' };
    const url = httpURL(raw);
    if (!url) return { error: 'Only http or https URLs can be opened.' };
    return { body: { url } };
  }
  if (spec.path === '/skills/install') {
    const raw = text(merged.url);
    if (!raw) return { error: 'A skill URL is required: --url https://...' };
    const url = httpURL(raw);
    if (!url) return { error: 'Only http or https skill URLs can be installed.' };
    const sha256 = text(merged.sha256);
    return { body: sha256 ? { url, sha256 } : { url } };
  }
  if (spec.path === '/automations/run') {
    const id = text(merged.id);
    if (!id) return { error: 'An automation id is required: --id <automation id>' };
    return { body: { id } };
  }
  if (spec.path === '/automations') {
    if (!payload || Object.keys(payload).length === 0) return { error: 'A JSON automation payload is required.' };
    return { body: payload };
  }
  return { body: merged };
}

export function helpText(): string {
  const commandLines = [
    ...Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(18)} ${spec.summary}`),
    ...Object.entries(LOCAL_COMMANDS).map(([name, summary]) => `  ${name.padEnd(18)} ${summary}`),
  ];
  const usageLines = Object.values(COMMANDS).map((spec) => `  ${spec.usage}`);
  return [
    'relayctl — drive the running Relay app from the shell',
    '',
    'Usage:',
    '  relayctl <command> [options]',
    '',
    'Commands:',
    ...commandLines,
    '',
    'Options:',
    '  --json             Print the raw JSON response',
    '  -h, --help         Show this help',
    '  -v, --version      Show whether Relay is reachable',
    '',
    'Examples:',
    ...usageLines,
    '  relayctl install',
  ].join('\n');
}
