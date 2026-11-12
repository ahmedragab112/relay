import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutomationStore, Scheduler, nextRunAt, validateJobInput, validateSchedule } from '../src/main/schedules.js';
import type { AutomationExecution, AutomationInput } from '../src/shared/contracts.js';

const promptJob = (overrides: Partial<AutomationInput> = {}): AutomationInput => ({
  name: 'Nightly review',
  timezone: 'UTC',
  schedule: { kind: 'interval', minutes: 30 },
  enabled: true,
  action: {
    kind: 'prompt', prompt: 'Review the latest commits and summarize risks.', steps: 'Check tests, then migrations.',
    location: 'local', output: 'independent', access: 'ask', model: 'openai::gpt-test',
  },
  ...overrides,
});

test('schedules compute interval and timezone-aware daily next runs', () => {
  const from = new Date(2026, 0, 5, 10, 0, 0).getTime();
  assert.equal(nextRunAt({ kind: 'interval', minutes: 5 }, from), from + 5 * 60_000);

  const tokyoFrom = Date.UTC(2026, 0, 5, 10, 0, 0);
  assert.equal(nextRunAt({ kind: 'daily', time: '18:30' }, tokyoFrom, 'Asia/Tokyo'), Date.UTC(2026, 0, 6, 9, 30));

  const newYorkFrom = Date.UTC(2026, 0, 5, 10, 0, 0);
  assert.equal(nextRunAt({ kind: 'daily', time: '07:05' }, newYorkFrom, 'America/New_York'), Date.UTC(2026, 0, 5, 12, 5));

  assert.throws(() => nextRunAt({ kind: 'daily', time: '09:00' }, from, 'Not/AZone'), /timezone/i);
});

test('automation input validates prompts, endpoints, schedules and timezones', () => {
  const valid = validateJobInput(promptJob());
  assert.equal(valid.action.kind, 'prompt');
  assert.equal(valid.timezone, 'UTC');
  assert.throws(() => validateJobInput({ ...promptJob(), name: '  ' }), /name/i);
  assert.throws(() => validateJobInput({ ...promptJob(), timezone: 'Mars/Olympus' }), /timezone/i);
  assert.throws(() => validateJobInput({ ...promptJob(), action: { kind: 'prompt', prompt: '  ', location: 'local', output: 'independent', access: 'ask', model: 'x' } }), /prompt/i);
  assert.throws(() => validateJobInput({ ...promptJob(), action: { ...promptJob().action, location: 'cloud' } }), /cloud/i);
  assert.throws(() => validateJobInput({ ...promptJob(), action: { ...promptJob().action, output: 'split' } }), /output/i);
  assert.throws(() => validateJobInput({ ...promptJob(), action: { ...promptJob().action, model: '' } }), /model/i);
  assert.throws(() => validateJobInput({ ...promptJob(), action: { kind: 'page', url: 'file:///etc/passwd' } }), /HTTP/i);
  assert.throws(() => validateJobInput({ ...promptJob(), action: { kind: 'page', url: 'javascript:alert(1)' } }), /HTTP/i);
  assert.throws(() => validateJobInput({ ...promptJob(), enabled: 'yes' }), /enabled/i);
  assert.throws(() => validateJobInput({ ...promptJob(), id: '../escape' }), /identifier/i);
  assert.throws(() => validateJobInput({ ...promptJob(), expiresAt: 'later' }), /expir/i);
  assert.throws(() => validateSchedule({ kind: 'interval', minutes: 0 }), /minute/i);
  assert.throws(() => validateSchedule({ kind: 'interval', minutes: 10_081 }), /minute/i);
  assert.throws(() => validateSchedule({ kind: 'daily', time: '24:00' }), /HH:MM/i);
  assert.deepEqual(validateSchedule({ kind: 'daily', time: '07:05' }), { kind: 'daily', time: '07:05' });
});

test('scheduler runs due prompt jobs once and records history', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-jobs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new AutomationStore(join(root, 'automation.json'));
  const job = await store.upsert(promptJob({ schedule: { kind: 'interval', minutes: 10 } }), 1_000_000);
  const calls: string[] = [];
  let opened = 0;
  const scheduler = new Scheduler(store, async (target) => {
    opened++;
    calls.push(target.id);
    return { detail: 'Reviewed 4 commits', sessionId: 'session-1' } satisfies AutomationExecution;
  }, () => {});
  await scheduler.tick(1_000_000);
  assert.equal(opened, 0);
  const due = job.nextRun;
  await scheduler.tick(due);
  assert.equal(opened, 1);
  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0].status, 'ok');
  assert.equal(store.runs[0].detail, 'Reviewed 4 commits');
  assert.equal(store.runs[0].sessionId, 'session-1');
  assert.equal(store.jobs[0].sessionId, 'session-1');
  assert.ok(store.jobs[0].lastRun && store.jobs[0].nextRun > store.jobs[0].lastRun);
  await scheduler.tick(due);
  assert.equal(opened, 1);
  const before = store.jobs[0].nextRun;
  await scheduler.runNow(job.id);
  assert.equal(opened, 2);
  assert.equal(store.jobs[0].nextRun, before);
  const paused = await store.upsert({ ...promptJob({ id: job.id }), enabled: false }, Date.now());
  assert.equal(paused.nextRun, 0);
});

test('scheduler stops expired jobs and keeps legacy page jobs working', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-jobs-expiry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new AutomationStore(join(root, 'automation.json'));
  const expired = await store.upsert(promptJob({ expiresAt: 2_000_000 }), 1_000_000);
  let ran = 0;
  const scheduler = new Scheduler(store, async () => { ran++; return { detail: 'ran' }; }, () => {});
  await scheduler.tick(2_000_001);
  assert.equal(ran, 0);
  assert.equal(store.find(expired.id)?.enabled, false);
  assert.equal(store.find(expired.id)?.nextRun, 0);

  const page = await store.upsert({ name: 'Status board', timezone: 'UTC', schedule: { kind: 'interval', minutes: 5 }, enabled: true, action: { kind: 'page', url: 'https://example.com/status' } }, 1_000_000);
  assert.equal(page.action.kind, 'page');
});

test('automation store drops malformed records and caps history', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relay-jobs-load-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'automation.json');
  await writeFile(file, JSON.stringify({
    jobs: [
      { id: 'bad', name: '', action: { kind: 'page', url: 'file:///etc/passwd' }, schedule: { kind: 'interval', minutes: 5 }, timezone: 'UTC', enabled: true, createdAt: 1, nextRun: 2 },
      { id: 'legacy', name: 'Old board', url: 'https://example.com/old', schedule: { kind: 'interval', minutes: 5 }, enabled: true, createdAt: 1, nextRun: 2 },
    ],
    runs: [{ id: 'run-1', jobId: 'gone', jobName: 'Old', startedAt: 1, status: 'ok', detail: 'ok' }, { id: 4 }],
  }));
  const store = new AutomationStore(file);
  await store.load();
  assert.equal(store.jobs.length, 1);
  assert.equal(store.jobs[0].id, 'legacy');
  assert.deepEqual(store.jobs[0].action, { kind: 'page', url: 'https://example.com/old' });
  assert.equal(store.jobs[0].timezone, 'UTC');
  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0].jobName, 'Old');
});
