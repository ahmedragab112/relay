import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, buildRequest, helpText, parseArgs } from '../src/cli/commands.js';
import {
  NOT_RUNNING, STALE_TOKEN, formatSchedule, renderAutomations, renderServerError, renderTasks, table, truncate,
} from '../src/cli/render.js';

const spec = (name: string) => COMMANDS[name]!;

test('parseArgs finds the command and long flags with space or equals', () => {
  assert.equal(parseArgs(['tasks']).command, 'tasks');
  const spaced = parseArgs(['create-task', '--title', 'Triage', '--prompt', 'Fix it']);
  assert.deepEqual(spaced.flags, { title: 'Triage', prompt: 'Fix it' });
  assert.equal(spaced.errors.length, 0);
  assert.deepEqual(parseArgs(['open-page', '--url=https://example.com']).flags, { url: 'https://example.com' });
  assert.equal(parseArgs(['tasks', '--json']).json, true);
});

test('parseArgs reports a flag without a value', () => {
  const parsed = parseArgs(['create-task', '--title']);
  assert.equal(parsed.flags.title, undefined);
  assert.match(parsed.errors[0] ?? '', /Missing value for --title/);
});

test('parseArgs keeps JSON positional arguments working', () => {
  const parsed = parseArgs(['run-automation', '{"id":"abc"}']);
  assert.deepEqual(parsed.payload, { id: 'abc' });
  assert.equal(parseArgs(['run-automation', 'not-json']).payload, undefined);
  assert.match(parseArgs(['run-automation', 'not-json']).errors[0] ?? '', /JSON object/);
});

test('create-task requires a title and carries an optional prompt', () => {
  assert.match(buildRequest(spec('create-task'), {}).error ?? '', /title is required/);
  assert.deepEqual(buildRequest(spec('create-task'), { title: '  Triage  ' }), { body: { title: 'Triage' } });
  assert.deepEqual(buildRequest(spec('create-task'), { title: 'Triage', prompt: 'Fix it' }), { body: { title: 'Triage', prompt: 'Fix it' } });
});

test('flags override a JSON payload and unknown flags are rejected', () => {
  const built = buildRequest(spec('create-task'), { title: 'From flag' }, { title: 'From json', prompt: 'p' });
  assert.deepEqual(built, { body: { title: 'From flag', prompt: 'p' } });
  assert.match(buildRequest(spec('create-task'), { titel: 'Typo' }).error ?? '', /Unknown option --titel/);
});

test('open-page and install-skill accept only http(s) URLs', () => {
  assert.deepEqual(buildRequest(spec('open-page'), { url: 'https://example.com/docs' }), { body: { url: 'https://example.com/docs' } });
  assert.match(buildRequest(spec('open-page'), { url: 'ftp://example.com' }).error ?? '', /Only http or https/);
  assert.match(buildRequest(spec('open-page'), { url: 'https://user:pass@example.com' }).error ?? '', /Only http or https/);
  assert.match(buildRequest(spec('install-skill'), {}).error ?? '', /skill URL is required/);
  assert.deepEqual(buildRequest(spec('install-skill'), { url: 'https://github.com/o/r', sha256: 'abc' }), { body: { url: 'https://github.com/o/r', sha256: 'abc' } });
});

test('run-automation requires an id and create-automation requires JSON', () => {
  assert.match(buildRequest(spec('run-automation'), {}).error ?? '', /automation id is required/);
  assert.deepEqual(buildRequest(spec('run-automation'), { id: 'job-1' }), { body: { id: 'job-1' } });
  assert.match(buildRequest(spec('create-automation'), {}).error ?? '', /JSON automation payload/);
  const payload = { name: 'Daily triage' };
  assert.deepEqual(buildRequest(spec('create-automation'), {}, payload), { body: payload });
});

test('read-only commands reject arguments', () => {
  assert.deepEqual(buildRequest(spec('tasks'), {}), {});
  assert.match(buildRequest(spec('tasks'), { limit: '5' }).error ?? '', /takes no arguments/);
});

test('table pads columns so rows line up', () => {
  const rendered = table(['NAME', 'STATUS'], [['Alpha', 'ok'], ['B', 'error']]);
  const lines = rendered.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[1], '-----  ------');
  assert.equal(lines[2], 'Alpha  ok');
  assert.equal(lines[3], 'B      error');
});

test('truncate keeps short values and shortens long ones', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('a very long title indeed', 10), 'a very lo…');
});

test('formatSchedule covers interval and daily jobs', () => {
  assert.equal(formatSchedule({ kind: 'interval', minutes: 30 }), 'every 30 min');
  assert.equal(formatSchedule({ kind: 'daily', time: '09:00' }), 'daily 09:00');
  assert.equal(formatSchedule(undefined), '—');
});

test('renderTasks explains an empty workspace', () => {
  assert.equal(renderTasks({ tasks: [] }), 'No tasks yet.');
  assert.match(renderTasks({ tasks: [{ id: 't1', title: 'Triage', status: 'running' }] }) ?? '', /t1\s+running\s+Triage/);
});

test('renderAutomations shows jobs and recent runs', () => {
  const rendered = renderAutomations({
    jobs: [{ id: 'job-1', name: 'Daily triage', enabled: true, schedule: { kind: 'daily', time: '09:00' }, nextRun: Date.now() + 60_000 }],
    runs: [{ id: 'run-1', jobName: 'Daily triage', startedAt: Date.now(), status: 'ok' }],
  });
  assert.match(rendered, /Daily triage/);
  assert.match(rendered, /daily 09:00/);
  assert.match(rendered, /Recent runs:/);
});

test('errors are one actionable line', () => {
  assert.match(NOT_RUNNING, /Open Relay\.app/);
  assert.equal(renderServerError(403, { error: 'Forbidden' }), STALE_TOKEN);
  assert.equal(renderServerError(500, { error: 'boom' }), 'Relay error (500): boom');
  assert.equal(renderServerError(500, {}), 'Relay error (500): Request failed.');
});

test('help lists every command and the install hint', () => {
  const help = helpText();
  for (const name of Object.keys(COMMANDS)) assert.match(help, new RegExp(`\\b${name}\\b`), name);
  assert.match(help, /relayctl install/);
  assert.match(help, /--json/);
});
