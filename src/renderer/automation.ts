import type { AccessLevel, AutomationAction, AutomationInput, AutomationJob, AutomationState, JobSchedule, ModelOption } from '../shared/contracts';
import { byId, button, el, errorText, field, option } from './dom';
import { confirmAction } from './dialog';
import { normalizeAddress } from './browser';

const accessLevels: Array<[AccessLevel, string]> = [
  ['read', 'Read only'],
  ['ask', 'Ask before acting'],
  ['auto', 'Auto-edit'],
  ['full', 'Full access'],
];

export function scheduleLabel(schedule: JobSchedule): string {
  if (schedule.kind === 'daily') return `Daily at ${schedule.time}`;
  const minutes = schedule.minutes;
  if (minutes % 1440 === 0) return `Every ${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `Every ${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function when(value: number): string {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

function dateInputValue(value: number): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function expirationFrom(value: string): number | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) throw new Error('Choose a valid expiration date.');
  const end = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  if (!Number.isFinite(end) || end <= Date.now()) throw new Error('Choose a future expiration date.');
  return end;
}

function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function actionLabel(action: AutomationAction): string {
  if (action.kind === 'page') {
    try { return `Opens ${new URL(action.url).host}`; } catch { return 'Opens a page'; }
  }
  const output = action.output === 'merged' ? 'Continues one task' : 'New task each run';
  const access = accessLevels.find(([value]) => value === action.access)?.[1] ?? action.access;
  return `${output} · ${access}`;
}

let automationWired = false;
let automationUnsubscribe: (() => void) | undefined;

export function closeAutomation(): void {
  byId('automation-shell').replaceChildren();
  byId('automation-page').hidden = true;
  byId('app').classList.remove('automation-open');
  automationUnsubscribe?.();
  automationUnsubscribe = undefined;
  byId('automation-button').focus();
}

export function showAutomation(openSession: (id: string) => void | Promise<void>): void {
  const page = byId('automation-page');
  if (!automationWired) {
    automationWired = true;
    byId('automation-close').addEventListener('click', () => closeAutomation());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !page.hidden) { event.preventDefault(); closeAutomation(); }
    });
  }
  page.hidden = false;
  byId('app').classList.add('automation-open');
  const modal = {
    busy(value: boolean) { byId('automation-close').toggleAttribute('disabled', value); },
    fail(value: unknown) { error.textContent = errorText(value); },
  };
  const list = el('div', 'automation-list');
  const history = el('div', 'automation-history');
  const status = el('p', 'small muted');

  const name = el('input');
  name.maxLength = 80;
  name.placeholder = 'Morning dashboard';
  name.required = true;

  const actionKind = el('select');
  actionKind.append(option('prompt', 'Prompt an agent'), option('page', 'Open a page'));

  const objective = el('textarea');
  objective.rows = 3;
  objective.maxLength = 20_000;
  objective.placeholder = 'Summarize yesterday’s build failures and list what to fix first.';

  const context = el('textarea');
  context.rows = 2;
  context.maxLength = 20_000;
  context.placeholder = 'Team conventions, links, or background the agent should know.';

  const steps = el('textarea');
  steps.rows = 2;
  steps.maxLength = 20_000;
  steps.placeholder = 'Check the latest test run. Group failures by cause. Suggest the next action.';

  const location = el('select');
  location.append(option('local', 'This Mac (Relay runs while open)'));
  const cloud = option('cloud', 'Cloud runner · not available');
  cloud.disabled = true;
  location.append(cloud);

  const output = el('select');
  output.append(option('independent', 'Independent — a fresh task every run'), option('merged', 'Merged — continue one task across runs'));

  const model = el('select');

  const access = el('select');
  for (const [value, label] of accessLevels) access.append(option(value, label));
  access.value = 'ask';

  const url = el('input');
  url.placeholder = 'https://intranet.example.com/overview';
  url.spellcheck = false;

  const kind = el('select');
  kind.append(option('daily', 'Once a day'), option('interval', 'Every few minutes'));

  const minutes = el('input');
  minutes.type = 'number';
  minutes.min = '1';
  minutes.max = '10080';
  minutes.value = '60';

  const time = el('input');
  time.type = 'time';
  time.value = '09:00';

  const timezone = el('select');
  const detected = localZone();
  const zones = [...new Set([detected, 'UTC', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
    'Australia/Sydney', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Cairo',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'])];
  for (const zone of zones) timezone.append(option(zone, zone === 'UTC' ? 'UTC (GMT)' : zone));
  timezone.value = detected;

  const expires = el('input');
  expires.type = 'date';

  const enabled = el('input');
  enabled.type = 'checkbox';
  enabled.checked = true;

  const controls: Array<[HTMLElement, string]> = [
    [name, 'Name'], [actionKind, 'Action'], [objective, 'Objective'], [context, 'Context'], [steps, 'Steps'],
    [location, 'Execution location'], [output, 'Output'], [model, 'Model'], [access, 'Execution authorization'],
    [url, 'Page address'], [kind, 'Repeats'], [minutes, 'Minutes between runs'], [time, 'Time each day'],
    [timezone, 'Time zone'], [expires, 'Expiration'], [enabled, 'Enabled'],
  ];
  for (const [control, label] of controls) control.setAttribute('aria-label', label);

  const promptFields = el('div', 'automation-section');
  promptFields.append(
    el('h3', '', 'Prompt'),
    field('Objective', objective, 'What the agent should accomplish on every run.'),
    field('Context', context, 'Optional background the agent should read before acting.'),
    field('Steps', steps, 'Optional instructions the agent should follow in order.'),
    field('Execution location', location, 'Prompt automations run inside Relay on this Mac. Cloud runners are not available yet.'),
    field('Output', output, 'Independent runs start a fresh task. Merged runs continue one task so the agent remembers earlier results.'),
    field('Model', model, 'Pick the model that runs this automation.'),
    field('Execution authorization', access, 'Read only inspects files. Ask approves each action. Auto-edit changes project files. Full access also runs commands.'),
  );

  const pageFields = el('div', 'automation-section');
  pageFields.append(
    el('h3', '', 'Page'),
    field('Page address', url, 'Pages open in Relay’s in-editor browser with no access to your files, terminal, or agent.'),
  );

  const minutesField = field('Minutes between runs', minutes, 'Between 1 minute and 7 days.');
  const timeField = field('Time each day', time, 'Local wall-clock time in the selected time zone.');
  const scheduleFields = el('div', 'automation-grid');
  scheduleFields.append(minutesField, timeField);

  const scheduleSection = el('div', 'automation-section');
  scheduleSection.append(
    el('h3', '', 'Schedule'),
    field('Repeats', kind),
    scheduleFields,
    field('Time zone', timezone, 'Daily runs use this zone. Interval runs count real minutes.'),
    field('Expiration', expires, 'Optional. The automation pauses after this day.'),
    field('Enabled', enabled),
  );

  const formTitle = el('h3', '', 'Create automation');
  const submit = el('button', 'button primary', 'Create automation');
  submit.type = 'submit';
  const cancel = button('Cancel edit', () => resetForm(), 'text-button');
  cancel.hidden = true;
  const submitRow = el('div', 'automation-submit');
  submitRow.append(submit, cancel);
  const form = el('form');
  form.className = 'automation-form';
  const basics = el('div', 'automation-section');
  basics.append(formTitle, field('Name', name), field('Action', actionKind));
  form.append(basics, promptFields, pageFields, scheduleSection, submitRow);

  let editing = '';
  let pendingModel = '';

  const syncAction = () => {
    const prompt = actionKind.value === 'prompt';
    promptFields.hidden = !prompt;
    pageFields.hidden = prompt;
    formTitle.textContent = editing ? 'Edit automation' : 'Create automation';
  };
  actionKind.addEventListener('change', syncAction);

  const syncSchedule = () => {
    const daily = kind.value === 'daily';
    minutesField.hidden = daily;
    timeField.hidden = !daily;
  };
  kind.addEventListener('change', syncSchedule);

  const renderModels = (models: ModelOption[], preferred: string) => {
    const current = pendingModel || model.value;
    model.replaceChildren();
    if (!models.length) {
      model.append(option('', 'Configure a model in Settings'));
      model.value = '';
      return;
    }
    const group = (label: string, entries: ModelOption[]) => {
      if (!entries.length) return;
      const set = el('optgroup');
      set.label = label;
      for (const item of entries) set.append(option(item.id, `${item.name} · ${item.providerID}${item.free ? ' · free' : ''}`));
      model.append(set);
    };
    group('Free models', models.filter(item => item.free));
    group('Available models', models.filter(item => !item.free));
    const wanted = [current, preferred].find(value => value && models.some(item => item.id === value));
    const fallback = models.find(item => item.free) ?? models[0];
    model.value = wanted ?? fallback.id;
  };

  const perform = async (control: HTMLButtonElement | null, work: () => Promise<AutomationState>) => {
    if (control) control.disabled = true;
    modal.fail('');
    try { render(await work()); }
    catch (error) { modal.fail(error); }
    finally { if (control) control.disabled = false; }
  };

  const revealArtifact = async (control: HTMLButtonElement, job: AutomationJob) => {
    if (control.disabled) return;
    control.disabled = true;
    modal.fail('');
    try {
      await window.relay.revealAutomationArtifact(job.id);
      status.textContent = 'Output revealed in Finder.';
    } catch (error) { modal.fail(error); }
    finally { control.disabled = false; }
  };

  const resetForm = () => {
    editing = '';
    pendingModel = '';
    formTitle.textContent = 'Create automation';
    submit.textContent = 'Create automation';
    cancel.hidden = true;
    name.value = '';
    actionKind.value = 'prompt';
    objective.value = '';
    context.value = '';
    steps.value = '';
    location.value = 'local';
    output.value = 'independent';
    access.value = 'ask';
    url.value = '';
    kind.value = 'daily';
    minutes.value = '60';
    time.value = '09:00';
    timezone.value = detected;
    expires.value = '';
    enabled.checked = true;
    syncAction();
    syncSchedule();
    name.focus();
  };

  const edit = (job: AutomationJob) => {
    editing = job.id;
    formTitle.textContent = 'Edit automation';
    submit.textContent = 'Save changes';
    cancel.hidden = false;
    name.value = job.name;
    actionKind.value = job.action.kind;
    if (job.action.kind === 'prompt') {
      const prompt = job.action;
      objective.value = prompt.prompt;
      context.value = prompt.context ?? '';
      steps.value = prompt.steps ?? '';
      output.value = prompt.output;
      access.value = prompt.access;
      pendingModel = prompt.model;
      if (prompt.model) {
        if (!Array.from(model.options).some(entry => entry.value === prompt.model)) {
          model.append(option(prompt.model, prompt.model));
        }
        model.value = prompt.model;
      }
    } else {
      url.value = job.action.url;
    }
    location.value = 'local';
    kind.value = job.schedule.kind;
    if (job.schedule.kind === 'interval') minutes.value = String(job.schedule.minutes);
    else time.value = job.schedule.time;
    if (!Array.from(timezone.options).some(entry => entry.value === job.timezone)) {
      timezone.append(option(job.timezone, job.timezone));
    }
    timezone.value = job.timezone;
    expires.value = job.expiresAt ? dateInputValue(job.expiresAt) : '';
    enabled.checked = job.enabled;
    syncAction();
    syncSchedule();
    name.focus();
  };

  const render = (state: AutomationState) => {
    list.replaceChildren();
    if (!state.jobs.length) list.append(el('p', 'small muted', 'No automations yet. Create one below.'));
    for (const job of state.jobs) {
      const row = el('div', 'automation-row');
      const copy = el('div', 'automation-copy');
      copy.append(el('span', 'automation-name', job.name));
      copy.append(el('span', 'automation-meta', `${actionLabel(job.action)} · ${scheduleLabel(job.schedule)} · ${job.timezone}`));
      copy.append(el('span', 'automation-meta', `${job.enabled ? `next ${when(job.nextRun)}` : 'paused'}${job.lastRun ? ` · last ${when(job.lastRun)}` : ''}${job.expiresAt ? ` · expires ${when(job.expiresAt)}` : ''}`));
      row.append(copy);
      const controls = el('div', 'automation-actions');
      const runNow = button('Run now', () => perform(runNow, () => window.relay.runAutomation(job.id)), 'text-button');
      let revealButton: HTMLButtonElement | undefined;
      if (job.artifactPath) {
        revealButton = button('Open output', () => { if (revealButton) void revealArtifact(revealButton, job); }, 'text-button');
      }
      controls.append(
        button(job.enabled ? 'Pause' : 'Resume', () => perform(null, () => window.relay.saveAutomation({ id: job.id, name: job.name, action: job.action, schedule: job.schedule, timezone: job.timezone, expiresAt: job.expiresAt, enabled: !job.enabled })), 'text-button'),
        runNow,
        ...(revealButton ? [revealButton] : []),
        button('Edit', () => edit(job), 'text-button'),
        button('Remove', async () => {
          if (!await confirmAction('Remove automation?', `“${job.name}” will stop running on its schedule. Its history stays in this list until Relay restarts.`, 'Remove')) return;
          await perform(null, () => window.relay.removeAutomation(job.id));
        }, 'text-button danger'),
      );
      row.append(controls);
      list.append(row);
    }

    const jobs = new Map(state.jobs.map(job => [job.id, job]));
    history.replaceChildren(el('h3', '', 'Recent runs'));
    if (!state.runs.length) history.append(el('p', 'small muted', 'Runs appear here after an automation starts.'));
    for (const run of state.runs.slice(0, 8)) {
      const job = jobs.get(run.jobId);
      const row = el('div', 'automation-run');
      const main = el('div', 'automation-run-main');
      main.append(el('span', 'truncate', run.jobName), el('span', 'automation-meta truncate', `${when(run.startedAt)} · ${run.detail}`));
      row.append(main, el('span', `pill ${run.status === 'ok' ? 'ok' : 'error'}`, run.status === 'ok' ? 'Completed' : 'Failed'));
      const actions = el('div', 'automation-run-actions');
      if (run.sessionId) {
        const sessionId = run.sessionId;
        actions.append(button('Open task', () => { closeAutomation(); void openSession(sessionId); }, 'text-button'));
      }
      if (job && run.status === 'ok' && job.artifactPath && job.lastRun === run.startedAt) {
        let outputButton: HTMLButtonElement | undefined;
        outputButton = button('Open output', () => { if (outputButton) void revealArtifact(outputButton, job); }, 'text-button');
        actions.append(outputButton);
      }
      row.append(actions);
      history.append(row);
    }
  };

  const save = async (input: AutomationInput) => {
    const next = await window.relay.saveAutomation(input);
    status.textContent = editing ? 'Changes saved.' : 'Automation created.';
    resetForm();
    return next;
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!name.value.trim()) { modal.fail('Give this automation a name.'); name.focus(); return; }
    let action: AutomationAction;
    if (actionKind.value === 'page') {
      const target = normalizeAddress(url.value);
      if (!target) { modal.fail('Enter an http or https page address.'); url.focus(); return; }
      action = { kind: 'page', url: target };
    } else {
      const prompt = objective.value.trim();
      if (!prompt) { modal.fail('Write an objective for this automation.'); objective.focus(); return; }
      if (!model.value) { modal.fail('Choose a model. Connect a provider in Settings if none are listed.'); model.focus(); return; }
      action = {
        kind: 'prompt', prompt, location: 'local',
        output: output.value === 'merged' ? 'merged' : 'independent',
        access: access.value as AccessLevel,
        model: model.value,
        ...(context.value.trim() ? { context: context.value.trim() } : {}),
        ...(steps.value.trim() ? { steps: steps.value.trim() } : {}),
      };
    }
    const schedule: JobSchedule = kind.value === 'daily'
      ? { kind: 'daily', time: time.value }
      : { kind: 'interval', minutes: Number(minutes.value) };
    let expiresAt: number | undefined;
    try { expiresAt = expirationFrom(expires.value); }
    catch (error) { modal.fail(error); expires.focus(); return; }
    const input: AutomationInput = {
      id: editing || undefined,
      name: name.value.trim(),
      action,
      schedule,
      timezone: timezone.value,
      ...(expiresAt ? { expiresAt } : {}),
      enabled: enabled.checked,
    };
    void perform(submit, () => save(input));
  });

  const error = el('p', 'dialog-error settings-error', '');
  error.setAttribute('role', 'alert');
  const shell = el('div', 'automation-shell');
  shell.append(
    el('p', 'small muted', 'Run an agent prompt or open an internal page on a schedule. Jobs run while Relay is open.'),
    list, history, form, status,
  );
  byId('automation-shell').replaceChildren(error, shell);
  automationUnsubscribe?.();
  automationUnsubscribe = window.relay.onEvent(event => {
    if (event.type === 'automation') render({ jobs: event.jobs, runs: event.runs });
  });

  syncAction();
  syncSchedule();
  void window.relay.listAutomation().then(render).catch(modal.fail);
  void Promise.all([window.relay.getState(), window.relay.listModels()])
    .then(([state, models]) => renderModels(models, state.preferences.defaultModel))
    .catch(() => renderModels([], ''));
  name.focus();
}
