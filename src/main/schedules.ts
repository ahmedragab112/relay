import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AccessLevel, AutomationAction, AutomationExecution, AutomationInput, AutomationJob, JobRun, JobSchedule } from '../shared/contracts.js';
import { identifier, text, validateExternalURL } from './security.js';

const MAX_JOBS = 30;
const MAX_RUNS = 50;
const accessLevels: AccessLevel[] = ['read', 'ask', 'auto', 'full'];

export function validateTimezone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) throw new Error('Choose a valid timezone.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); } catch { throw new Error('Choose a valid timezone.'); }
  return value;
}

function zoneParts(ms: number, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day'), hour: pick('hour'), minute: pick('minute'), second: pick('second') };
}

function zoneOffset(ms: number, timeZone: string): number {
  const parts = zoneParts(ms, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms;
}

function wallTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(first, timeZone);
}

export function nextRunAt(schedule: JobSchedule, from: number, timezone = 'UTC'): number {
  if (schedule.kind === 'interval') return from + schedule.minutes * 60_000;
  const zone = validateTimezone(timezone);
  const [hours, minutes] = schedule.time.split(':').map(Number);
  const now = zoneParts(from, zone);
  for (let added = 0; added <= 2; added++) {
    const candidate = wallTime(now.year, now.month, now.day + added, hours, minutes, zone);
    if (candidate > from) return candidate;
  }
  throw new Error('Could not compute the next run for this schedule.');
}

export function validateSchedule(value: unknown): JobSchedule {
  if (!value || typeof value !== 'object') throw new Error('Choose a schedule.');
  const candidate = value as { kind?: unknown; minutes?: unknown; time?: unknown };
  if (candidate.kind === 'interval') {
    const minutes = Number(candidate.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10_080) throw new Error('Run every 1 minute to 7 days.');
    return { kind: 'interval', minutes };
  }
  if (candidate.kind === 'daily') {
    const time = String(candidate.time ?? '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a daily time in HH:MM format.');
    return { kind: 'daily', time };
  }
  throw new Error('Choose an interval or daily schedule.');
}

function validatePromptAction(action: Record<string, unknown>): AutomationAction {
  const prompt = text(action.prompt, 'Prompt', 20_000).trim();
  if (!prompt) throw new Error('Write a prompt for this automation.');
  if (action.location !== 'local') {
    if (action.location === 'cloud') throw new Error('Cloud execution needs a Relay cloud runner, which is not available yet.');
    throw new Error('Choose local execution.');
  }
  const output = action.output;
  if (output !== 'independent' && output !== 'merged') throw new Error('Choose independent or merged output.');
  if (!accessLevels.includes(action.access as AccessLevel)) throw new Error('Choose a valid access level.');
  const model = text(action.model, 'Model', 512).trim();
  if (!model) throw new Error('Choose a model for this automation.');
  const steps = action.steps === undefined || action.steps === '' ? undefined : text(action.steps, 'Steps', 20_000).trim();
  const context = action.context === undefined || action.context === '' ? undefined : text(action.context, 'Context', 20_000).trim();
  return {
    kind: 'prompt', prompt, location: 'local', output, access: action.access as AccessLevel, model,
    ...(steps ? { steps } : {}), ...(context ? { context } : {}),
  };
}

export function validateAction(value: unknown): AutomationAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose what this automation runs.');
  const action = value as Record<string, unknown>;
  if (action.kind === 'page') return { kind: 'page', url: validateExternalURL(action.url) };
  if (action.kind === 'prompt') return validatePromptAction(action);
  throw new Error('Choose a page or prompt automation.');
}

export function validateJobInput(value: unknown): AutomationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid automation.');
  const input = value as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80) throw new Error('Automation names must be 1 to 80 characters.');
  if (typeof input.enabled !== 'boolean') throw new Error('Choose whether this automation is enabled.');
  let expiresAt: number | undefined;
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    if (typeof input.expiresAt !== 'number' || !Number.isFinite(input.expiresAt) || input.expiresAt <= 0) throw new Error('Expiration must be a valid future date.');
    expiresAt = input.expiresAt;
  }
  return {
    name,
    action: validateAction(input.action),
    schedule: validateSchedule(input.schedule),
    timezone: validateTimezone(input.timezone ?? 'UTC'),
    enabled: input.enabled,
    id: input.id === undefined ? undefined : identifier(input.id),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function storedJob(value: unknown, now: number): AutomationJob | undefined {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    const candidate = {
      ...raw,
      action: raw.action ?? (typeof raw.url === 'string' ? { kind: 'page', url: raw.url } : undefined),
      timezone: raw.timezone ?? 'UTC',
    };
    const input = validateJobInput(candidate);
    if (!input.id) return undefined;
    const job = candidate as Partial<AutomationJob>;
    return {
      id: input.id, name: input.name, action: input.action, schedule: input.schedule, timezone: input.timezone,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      enabled: input.enabled,
      createdAt: typeof job.createdAt === 'number' ? job.createdAt : now,
      lastRun: typeof job.lastRun === 'number' ? job.lastRun : undefined,
      nextRun: typeof job.nextRun === 'number' && job.nextRun > 0 ? job.nextRun : input.enabled ? nextRunAt(input.schedule, now, input.timezone) : 0,
      ...(typeof job.sessionId === 'string' ? { sessionId: job.sessionId } : {}),
      ...(typeof job.artifactPath === 'string' ? { artifactPath: job.artifactPath } : {}),
    };
  } catch { return undefined; }
}

export class AutomationStore {
  jobs: AutomationJob[] = [];
  runs: JobRun[] = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(readonly file: string) {}

  async load(): Promise<void> {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); } catch { return; }
    try {
      const data = JSON.parse(raw) as { jobs?: unknown; runs?: unknown };
      const now = Date.now();
      const jobs = Array.isArray(data.jobs) ? data.jobs.flatMap(item => { const job = storedJob(item, now); return job ? [job] : []; }) : [];
      this.jobs = jobs.slice(0, MAX_JOBS);
      this.runs = Array.isArray(data.runs)
        ? data.runs.filter((run): run is JobRun => Boolean(run) && typeof run === 'object'
          && typeof (run as JobRun).id === 'string' && typeof (run as JobRun).jobName === 'string'
          && typeof (run as JobRun).startedAt === 'number' && ((run as JobRun).status === 'ok' || (run as JobRun).status === 'error')).slice(0, MAX_RUNS)
        : [];
    } catch { this.jobs = []; this.runs = []; }
  }

  find(id: string): AutomationJob | undefined {
    return this.jobs.find(job => job.id === id);
  }

  async upsert(input: AutomationInput, now = Date.now()): Promise<AutomationJob> {
    const existing = input.id ? this.find(input.id) : undefined;
    const job: AutomationJob = {
      id: existing?.id ?? randomUUID(), name: input.name, action: input.action, schedule: input.schedule,
      timezone: input.timezone, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      enabled: input.enabled, createdAt: existing?.createdAt ?? now, lastRun: existing?.lastRun, nextRun: 0,
      ...(existing?.sessionId ? { sessionId: existing.sessionId } : {}),
      ...(existing?.artifactPath ? { artifactPath: existing.artifactPath } : {}),
    };
    const preserved = existing && existing.enabled && input.enabled
      && JSON.stringify(existing.schedule) === JSON.stringify(input.schedule)
      && existing.timezone === input.timezone && existing.expiresAt === input.expiresAt
      && existing.nextRun > now ? existing.nextRun : 0;
    job.nextRun = input.enabled ? preserved || nextRunAt(job.schedule, now, job.timezone) : 0;
    this.jobs = [job, ...this.jobs.filter(item => item.id !== job.id)].slice(0, MAX_JOBS);
    await this.persist();
    return job;
  }

  async remove(id: string): Promise<void> {
    this.jobs = this.jobs.filter(job => job.id !== id);
    await this.persist();
  }

  persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(this.file, JSON.stringify({ jobs: this.jobs, runs: this.runs }, null, 2), { mode: 0o600 });
    });
    return this.writing;
  }
}

export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;

  constructor(
    readonly store: AutomationStore,
    private execute: (job: AutomationJob) => Promise<AutomationExecution>,
    private changed: () => void,
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 15_000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.ticking) return this.ticking;
    this.ticking = (async () => {
      let expiredAny = false;
      for (const job of this.store.jobs) {
        if (!job.enabled || !job.expiresAt || job.expiresAt > now) continue;
        job.enabled = false;
        job.nextRun = 0;
        expiredAny = true;
      }
      if (expiredAny) { await this.store.persist(); this.changed(); }
      for (const job of this.store.jobs.filter(job => job.enabled && job.nextRun > 0 && job.nextRun <= now)) {
        await this.runJob(job, false);
      }
    })();
    try { await this.ticking; } finally { this.ticking = undefined; }
  }

  async runNow(id: string): Promise<JobRun> {
    const job = this.store.find(id);
    if (!job) throw new Error('That automation no longer exists.');
    if (job.expiresAt && job.expiresAt <= Date.now()) throw new Error('This automation has expired.');
    return this.runJob(job, true);
  }

  private async runJob(job: AutomationJob, manual: boolean): Promise<JobRun> {
    const startedAt = Date.now();
    job.lastRun = startedAt;
    if (!manual) job.nextRun = job.enabled ? nextRunAt(job.schedule, startedAt, job.timezone) : 0;
    let status: JobRun['status'] = 'ok';
    let detail: string;
    let sessionId: string | undefined;
    try {
      const result = await this.execute(job);
      detail = result.detail;
      sessionId = result.sessionId;
      if (result.sessionId) job.sessionId = result.sessionId;
      if (result.artifactPath) job.artifactPath = result.artifactPath;
    } catch (error) {
      status = 'error';
      detail = error instanceof Error ? error.message : String(error);
    }
    const run: JobRun = {
      id: randomUUID(), jobId: job.id, jobName: job.name, startedAt, status, detail,
      ...(job.action.kind === 'page' ? { url: job.action.url } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
    this.store.runs = [run, ...this.store.runs].slice(0, MAX_RUNS);
    await this.store.persist();
    this.changed();
    return run;
  }
}
