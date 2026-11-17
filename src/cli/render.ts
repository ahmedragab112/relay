export const NOT_RUNNING = 'Relay is not running. Open Relay.app, then try again.';
export const STALE_TOKEN = 'Relay rejected the request: its control token changed. Restart Relay.app.';

export interface TaskSummary { id: string; title: string; status: string }
export interface SkillSummary { id: string; name: string; description: string }
export interface AutomationSchedule { kind?: string; minutes?: number; time?: string }
export interface AutomationJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule?: AutomationSchedule;
  nextRun?: number;
}
export interface JobRun { id: string; jobName: string; startedAt: number; status: string }
export interface AutomationsBody { jobs?: AutomationJob[]; runs?: JobRun[] }

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)));
  const line = (cells: readonly string[]) => cells.map((cell, column) => (cell ?? '').padEnd(widths[column] ?? 0)).join('  ').trimEnd();
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

export function formatTime(ms: number | undefined): string {
  if (typeof ms !== 'number' || !ms) return '—';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatSchedule(schedule: AutomationSchedule | undefined): string {
  if (!schedule) return '—';
  if (schedule.kind === 'interval' && typeof schedule.minutes === 'number') return `every ${schedule.minutes} min`;
  if (schedule.kind === 'daily' && typeof schedule.time === 'string') return `daily ${schedule.time}`;
  return '—';
}

export function renderHealth(version: string, port: number): string {
  return `Relay ${version} is running on 127.0.0.1:${port}`;
}

export function renderTasks(body: { tasks?: TaskSummary[] }): string {
  const tasks = body.tasks ?? [];
  if (!tasks.length) return 'No tasks yet.';
  return table(['ID', 'STATUS', 'TITLE'], tasks.map((task) => [task.id, task.status, truncate(task.title, 60)]));
}

export function renderSkills(body: { skills?: SkillSummary[] }): string {
  const skills = body.skills ?? [];
  if (!skills.length) return 'No skills installed.';
  return table(['NAME', 'DESCRIPTION'], skills.map((skill) => [skill.name, truncate(skill.description, 70)]));
}

export function renderAutomations(body: AutomationsBody): string {
  const jobs = body.jobs ?? [];
  const runs = body.runs ?? [];
  const blocks: string[] = [];
  blocks.push(jobs.length
    ? table(
      ['NAME', 'SCHEDULE', 'NEXT RUN', 'ENABLED', 'ID'],
      jobs.map((job) => [job.name, formatSchedule(job.schedule), formatTime(job.nextRun), job.enabled ? 'yes' : 'no', job.id]),
    )
    : 'No automations yet.');
  if (runs.length) {
    blocks.push('', 'Recent runs:', table(
      ['JOB', 'STARTED', 'STATUS'],
      runs.slice(0, 5).map((run) => [run.jobName, formatTime(run.startedAt), run.status]),
    ));
  }
  return blocks.join('\n');
}

export function renderTaskCreated(body: { id?: string; title?: string }): string {
  return `Created "${body.title ?? 'task'}" (${body.id ?? 'no id'})`;
}

export function renderOpened(body: { opened?: string }): string {
  return `Opened ${body.opened ?? 'page'}`;
}

export function renderInstalled(body: { installed?: Array<{ name?: string }> }): string {
  const names = (body.installed ?? []).map((entry) => entry.name ?? 'skill');
  return names.length ? `Installed: ${names.join(', ')}` : 'Nothing was installed.';
}

export function renderAutomationRun(body: AutomationsBody): string {
  const run = body.runs?.[0];
  return run ? `Ran ${run.jobName} — ${run.status}` : 'Automation finished.';
}

export function renderServerError(status: number, body: { error?: string }): string {
  if (status === 403) return STALE_TOKEN;
  const message = typeof body.error === 'string' && body.error ? body.error : 'Request failed.';
  return `Relay error (${status}): ${message}`;
}
