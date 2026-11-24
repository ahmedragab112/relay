import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnostics, diagnosticsFileName } from '../src/main/diagnostics.js';
import { contextDefaults, generalDefaults } from '../src/main/settings.js';
import type { Preferences } from '../src/shared/contracts.js';

const preferences: Preferences = {
  theme: 'dark',
  defaultModel: 'test-model',
  defaultAccess: 'ask',
  modelVariant: 'default',
  dictation: { provider: 'groq', model: 'whisper-large-v3-turbo' },
  general: { ...generalDefaults, artifactDir: '/Users/tester/Documents/artifacts', skillRegistry: 'https://example.com/skills.json' },
  context: { ...contextDefaults, costLimitEnabled: true, costLimitUsd: 2.5 },
  auto: { includeFree: true, includeEngineHosted: false, maxTokens: 4096, modelIds: [] },
  archivedSessions: [],
  hiddenSessions: [],
};

function input(overrides: Partial<Parameters<typeof buildDiagnostics>[0]> = {}): Parameters<typeof buildDiagnostics>[0] {
  return {
    version: '0.1.1',
    platform: 'darwin',
    arch: 'x64',
    home: '/Users/tester',
    generatedAt: new Date('2026-11-24T09:56:00.000Z'),
    engine: { state: 'ready', detail: 'Listening on a local port', version: '2.2.6' },
    workspaces: [{ name: 'relay', path: '/Users/tester/Documents/relay-project' }],
    providers: [{ id: 'custom', hasKey: true, baseURL: 'https://api.example.com/v1', models: ['a', 'b'] }],
    mcp: [{ name: 'filesystem', type: 'local', command: ['npx', '-y', 'server', '--token', 'SUPERSECRET'], enabled: true, status: 'connected' }],
    knowledge: { entries: 3 },
    preferences,
    ...overrides,
  };
}

test('a diagnostics report lists the app, engine, workspace and Knowledge facts', () => {
  const report = buildDiagnostics(input());
  assert.match(report, /^Relay diagnostics$/m);
  assert.match(report, /2026-11-24T09:56:00\.000Z/);
  assert.match(report, /App\s+0\.1\.1 · darwin x64/);
  assert.match(report, /Engine\s+ready · 2\.2\.6 — Listening on a local port/);
  assert.match(report, /relay\s+~\/Documents\/relay-project/);
  assert.match(report, /custom · key set · https:\/\/api\.example\.com\/v1 · models: a, b/);
  assert.match(report, /filesystem · local · enabled · connected/);
  assert.match(report, /Knowledge\s+3 entries/);
  assert.match(report, /task budget on \(\$2\.50\)/);
  assert.match(report, /artifact folder\s+~\/Documents\/artifacts/);
});

test('secrets, provider credentials and MCP command lines never reach the report', () => {
  const report = buildDiagnostics(input({
    home: '/Users/tester',
    engine: { state: 'error', detail: 'spawn failed: OPENAI_API_KEY=sk-proj-abcdef123456 gh_token ghp_abcdefghijklmnop' },
    providers: [{ id: 'custom', hasKey: true, baseURL: 'https://user:pass@api.example.com/v1?api_key=SECRET' }],
  }));
  assert.doesNotMatch(report, /sk-proj/);
  assert.doesNotMatch(report, /ghp_/);
  assert.doesNotMatch(report, /SUPERSECRET/);
  assert.doesNotMatch(report, /npx/);
  assert.doesNotMatch(report, /user:pass/);
  assert.doesNotMatch(report, /SECRET/);
  assert.doesNotMatch(report, /\/Users\/tester/);
  assert.match(report, /\[redacted\]/);
  assert.match(report, /https:\/\/api\.example\.com\/v1/);
});

test('the suggested file name is timestamped and shell safe', () => {
  const name = diagnosticsFileName(new Date('2026-11-24T09:56:07.000Z'));
  assert.equal(name, 'relay-diagnostics-20261124-095607.txt');
});
