import type { McpServer, Preferences, ProviderSummary } from '../shared/contracts';

export interface DiagnosticsInput {
  version: string;
  platform: string;
  arch: string;
  home: string;
  generatedAt?: Date;
  engine: { state: string; detail?: string; version?: string };
  workspaces: Array<{ name: string; path: string }>;
  providers: ProviderSummary[];
  mcp: McpServer[];
  knowledge: { entries: number };
  preferences: Preferences;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{10,}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{10,})\b/g, '[redacted]'],
  [/([A-Za-z0-9_]*(?:key|token|secret|password|passwd)[A-Za-z0-9_]*\s*[=:]\s*)(\S+)/gi, '$1[redacted]'],
];

function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function redactHome(value: string, home: string): string {
  if (!home) return value;
  return value.split(home).join('~');
}

function redact(value: string, home: string): string {
  return redactSecrets(redactHome(value, home));
}

// Providers may carry credentials or keys in the user info or query string; the report keeps only the address.
function safeURL(value: string, home: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
    url.search = url.searchParams.toString();
    return redact(url.toString().replace(/\/$/, ''), home);
  } catch {
    return redact(value, home);
  }
}

function line(label: string, value: string): string {
  return `${label.padEnd(10)}${value}`;
}

function indent(value: string): string {
  return `  ${value}`;
}

export function diagnosticsFileName(date = new Date()): string {
  const iso = date.toISOString();
  return `relay-diagnostics-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}.txt`;
}

export function buildDiagnostics(input: DiagnosticsInput): string {
  const generated = (input.generatedAt ?? new Date()).toISOString();
  const { home, preferences } = input;
  const general = preferences.general;
  const context = preferences.context;
  const out: string[] = [];

  out.push('Relay diagnostics');
  out.push(line('Generated', generated));
  out.push(line('App', `${input.version} · ${input.platform} ${input.arch}`));
  out.push(line('Engine', `${input.engine.state}${input.engine.version ? ` · ${input.engine.version}` : ''}${input.engine.detail ? ` — ${redact(input.engine.detail, home)}` : ''}`));
  out.push(line('Workspaces', String(input.workspaces.length)));
  for (const workspace of input.workspaces) out.push(indent(`${workspace.name}  ${redact(workspace.path, home)}`));
  out.push(line('Providers', String(input.providers.length)));
  for (const provider of input.providers) {
    const parts = [provider.id, provider.hasKey ? 'key set' : 'no key'];
    if (provider.baseURL) parts.push(safeURL(provider.baseURL, home));
    if (provider.models?.length) parts.push(`models: ${provider.models.join(', ')}`);
    out.push(indent(parts.join(' · ')));
  }
  out.push(line('MCP', String(input.mcp.length)));
  for (const server of input.mcp) {
    out.push(indent([server.name, server.type, server.enabled ? 'enabled' : 'disabled', server.status].filter(Boolean).join(' · ')));
  }
  out.push(line('Knowledge', `${input.knowledge.entries} ${input.knowledge.entries === 1 ? 'entry' : 'entries'}`));
  out.push('');
  out.push('Settings');
  out.push(indent(`${preferences.theme} theme · model ${preferences.defaultModel || 'none'} · access ${preferences.defaultAccess} · variant ${preferences.modelVariant || 'default'}`));
  out.push(indent(`language ${general.language} · layout ${general.layout} · accent ${general.accent} · display ${general.conversationDisplay}`));
  out.push(indent(`thinking ${onOff(general.showThinking)} · suggestions ${onOff(general.promptSuggestions)} · skill suggestions ${onOff(general.skillSuggestions)} · onboarding complete ${onOff(general.onboardingComplete)}`));
  out.push(indent(`auto-compact ${onOff(context.autoCompact)} (${context.compactThreshold}%) · share project ${onOff(context.shareProject)} · task budget ${onOff(context.costLimitEnabled)}${context.costLimitEnabled ? ` ($${context.costLimitUsd.toFixed(2)})` : ''}`));
  out.push(indent(`auto model: free ${onOff(preferences.auto.includeFree)} · engine-hosted ${onOff(preferences.auto.includeEngineHosted)} · max ${preferences.auto.maxTokens} tokens`));
  out.push(indent(`notifications ${onOff(general.turnNotifications)} · sound ${onOff(general.turnSound)} · requests ${onOff(general.requestNotifications)} · auto-update ${onOff(general.autoUpdate)}`));
  out.push(indent(`artifact folder  ${general.artifactDir ? redact(general.artifactDir, home) : 'not set'}`));
  out.push(indent(`skill registry  ${general.skillRegistry ? redact(general.skillRegistry, home) : 'not set'}`));
  out.push('');
  out.push('Provider keys, credentials and conversation text are not included in this report.');
  return `${out.join('\n')}\n`;
}

function onOff(value: boolean): string {
  return value ? 'on' : 'off';
}
