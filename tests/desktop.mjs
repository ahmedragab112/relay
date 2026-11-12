import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const root = process.cwd();
const packaged = process.env.RELAY_EXECUTABLE;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const sandbox = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [];
const data = await mkdtemp(join(tmpdir(), 'relay-desktop-data-'));
const project = await mkdtemp(join(tmpdir(), 'relay-project-'));
const pastProject = await mkdtemp(join(tmpdir(), 'relay-past-project-'));
const projectPath = await realpath(project);
const pastProjectPath = await realpath(pastProject);
const workspaceId = (path) => createHash('sha256').update(path).digest('hex').slice(0, 20);
const artifacts = await mkdtemp(join(tmpdir(), 'relay-artifacts-'));
await writeFile(join(project, 'README.md'), '# Relay test project\n\nOriginal readme.\n');
await writeFile(join(pastProject, 'README.md'), '# Past relay project\n');
await mkdir(join(project, 'src'));
await writeFile(join(project, 'src', 'app.ts'), 'export const greeting = "hello";\n');
const recordings = [];
const preview = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/v1/audio/transcriptions') {
    let size = 0;
    request.on('data', (chunk) => { size += chunk.length; });
    request.on('end', () => {
      recordings.push({ size, contentType: request.headers['content-type'] ?? '' });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ text: ' Dictated relay message. ' }));
    });
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      let model = 'test-model';
      try { model = JSON.parse(body).model ?? model; } catch { /* keep the default */ }
      const base = { id: 'chatcmpl-relay-test', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
      const headers = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' };
      const send = (content = 'Hello from the test model.') => {
        response.writeHead(200, headers);
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } })}\n\n`);
        response.end('data: [DONE]\n\n');
      };
      if (body.includes('relay-tool') && /"role":"tool"/.test(body) === false) {
        response.writeHead(200, headers);
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_relay_read', type: 'function', function: { name: 'read', arguments: '{"path":"README.md"}' } }] }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 } })}\n\n`);
        response.end('data: [DONE]\n\n');
        return;
      }
      if (body.includes('relay-tool')) send('The README describes the test project.');
      else if (body.includes('relay-hold')) setTimeout(() => send(), 10_000);
      else if (body.includes('relay-slow')) setTimeout(() => send(), 4000);
      else send();
    });
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>Relay Preview</title><h1>Relay preview page</h1>');
});
await new Promise((resolve) => preview.listen(0, '127.0.0.1', resolve));
const previewURL = `http://127.0.0.1:${preview.address().port}`;
const pluginZip = join(artifacts, 'relay-e2e-kit.zip');
await writeFile(pluginZip, zipSync({
  'relay-plugin.json': strToU8(JSON.stringify({ id: 'e2e-kit', name: 'E2E kit', version: '1.0.0', description: 'Desktop fixture plugin' })),
  'commands/check.md': strToU8('---\ndescription: Check the workspace\n---\nCheck the workspace and report findings.\n'),
  'skills/review/SKILL.md': strToU8('---\nname: review\ndescription: Review the working tree\n---\nReview the working tree carefully.\n'),
}));
execFileSync('git', ['init', '-q'], { cwd: project });
execFileSync('git', ['-c', 'user.name=Relay Test', '-c', 'user.email=relay@example.test', 'add', '.'], { cwd: project });
execFileSync('git', ['-c', 'user.name=Relay Test', '-c', 'user.email=relay@example.test', 'commit', '-qm', 'seed'], { cwd: project });
console.log(`Temporary project: ${project}`);
console.log(`Test artifacts: ${artifacts}`);

const errors = [];
let app;
let page;

async function launch() {
  const media = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  app = packaged
    ? await electron.launch({ executablePath: packaged, args: [`--user-data-dir=${data}`, ...media, ...sandbox] })
    : await electron.launch({ args: ['.', `--user-data-dir=${data}`, ...media, ...sandbox], cwd: root, env: process.env });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await app.evaluate(({ dialog }, { pluginZip }) => {
    dialog.showMessageBox = async (...args) => {
      const options = (args.length > 1 ? args[1] : args[0]) ?? {};
      return { response: options.title === 'Open a terminal?' ? 1 : 0, checkboxChecked: false };
    };
    dialog.showOpenDialog = async (...args) => {
      const options = (args.length > 1 ? args[1] : args[0]) ?? {};
      if (options.title === 'Choose a Relay plugin') return { canceled: false, filePaths: [pluginZip] };
      return { canceled: true, filePaths: [] };
    };
  }, { pluginZip });
  await page.waitForSelector('#engine-status');
  return page;
}

async function text(selector) {
  return (await page.locator(selector).textContent()) ?? '';
}

async function waitFor(expression, timeout = 30_000) {
  await page.waitForFunction(expression, undefined, { timeout });
}

async function dismissNotice(step) {
  const notice = await page.evaluate(() => {
    const node = document.querySelector('#notice');
    return {
      visible: node ? !node.hidden : false,
      error: node?.classList.contains('error') ?? false,
      text: document.querySelector('#notice-text')?.textContent ?? '',
    };
  });
  if (notice.visible) console.log(`Closing notice before ${step}: ${notice.error ? 'error' : 'info'} — ${notice.text}`);
  await page.evaluate(() => document.getElementById('dismiss-notice')?.click());
}

console.log('Launching onboarding state');
await launch();
assert.equal(await text('#workspace-path'), 'No project open');
assert.match(await text('#engine-status'), /Engine stopped/);
assert.match(await text('#conversation'), /A calmer place to build/);
assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
assert.equal(await page.evaluate(() => typeof window.relay), 'object');
await page.screenshot({ path: join(artifacts, 'onboarding.png') });
await app.close();

console.log('Seeding a workspace in isolated app data');
const settingsDir = join(data, 'relay', 'settings');
await mkdir(settingsDir, { recursive: true });
await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
  version: 1,
  preferences: { theme: 'dark', defaultModel: 'custom::test-model', activeWorkspaceId: workspaceId(projectPath), dictation: { provider: 'custom', model: 'whisper-1' } },
  workspaces: [
    { id: workspaceId(projectPath), path: projectPath, name: basename(projectPath), lastOpened: Date.now() },
    { id: workspaceId(pastProjectPath), path: pastProjectPath, name: basename(pastProjectPath), lastOpened: Date.now() - 60_000 },
  ],
  providers: [{ id: 'custom', baseURL: `${previewURL}/v1`, models: ['test-model', 'whisper-1'] }],
  mcp: [],
}, null, 2));

console.log('Launching workspace with the real engine');
await launch();
await waitFor(() => document.querySelector('#engine-status')?.textContent?.startsWith('Engine ready'));
assert.match(await text('#engine-status'), /2\.2\.6/);
assert.equal(await text('#workspace-path'), projectPath);
await waitFor(() => /No tasks/.test(document.querySelector('#task-list')?.textContent ?? ''));
await waitFor(() => document.querySelectorAll('#task-list .task-group').length === 1);
assert.equal(await text('#task-list .task-group-name'), basename(project), 'the open folder was not shown above its tasks');
assert.equal(await page.evaluate(() => document.querySelector('#task-list .task-group')?.classList.contains('current')), true);
assert.equal(
  await page.evaluate(() => document.querySelector('#task-list .task-group-toggle .file-icon svg') !== null),
  true,
  'the project folder in the sidebar had no folder icon',
);
await waitFor(() => /No changes|No file changes/.test(document.querySelector('#diff-view')?.textContent ?? ''));
assert.doesNotMatch(await text('body'), /Could not load tasks|Changes unavailable|Could not load agent requests/);
assert.equal(await page.locator('#notice').isVisible(), false, await text('#notice'));
await page.screenshot({ path: join(artifacts, 'workspace.png') });

console.log('Creating a task');
await page.click('#new-task');
await waitFor(() => document.querySelectorAll('#task-list .task-button').length > 0);
assert.match(await text('#task-list'), /New task/);
assert.equal(await text('#task-title'), 'New task');
assert.equal(await page.evaluate(() => document.querySelector('#tab-activity')?.getAttribute('aria-selected')), 'true', 'a new task did not open the Activity tab by default');
assert.equal(await page.locator('#activity-panel').isVisible(), true);
const likedSession = (await page.evaluate(async () => window.relay.listSessions()))[0].id;

console.log('Sending a message to the test model');
await waitFor(() => !document.querySelector('#prompt')?.disabled, 20_000);

console.log('Choosing the model from one dropdown that reveals its power');
await waitFor(() => /test-model/.test(document.querySelector('#model-label')?.textContent ?? ''), 20_000);
assert.equal(await page.locator('#model-select, #power-select').count(), 0, 'the composer still used separate model and power selects');
await page.click('#model-button');
await waitFor(() => document.querySelector('#model-menu')?.hidden === false, 10_000);
assert.equal(await page.locator('#model-menu .model-entry.selected').count(), 1, 'the model dropdown did not mark the active model');
const modelMenu = await page.evaluate(async () => {
  const models = await window.relay.listModels();
  const expected = models.filter(model => model.variants?.length).length;
  const selected = document.querySelector('#model-menu .model-entry.selected');
  return {
    expected,
    shown: document.querySelectorAll('#model-menu .model-power').length,
    selectedRows: selected ? [...selected.querySelectorAll('.model-power-option')].map(chip => chip.textContent ?? '') : [],
  };
});
assert.equal(modelMenu.shown, modelMenu.expected, 'models with power levels did not show them inline in the dropdown');
assert.equal(modelMenu.selectedRows.includes('Default'), modelMenu.selectedRows.length > 0, 'the selected model was missing its inline power choices');
await page.screenshot({ path: join(artifacts, 'model-menu.png') });
await page.click('#model-menu .model-option.selected');
await waitFor(() => document.querySelector('#model-menu')?.hidden === true, 10_000);
assert.match(await text('#model-label'), /test-model/);
assert.equal(await page.locator('#model-button').getAttribute('aria-expanded'), 'false');

await page.fill('#prompt', 'Say hello.');
await page.click('#send-message');
await waitFor(() => /Hello from the test model\./.test(document.querySelector('#conversation')?.textContent ?? ''), 40_000);
const assistant = page.locator('#conversation article.assistant-message').last();
await assistant.waitFor();
await assistant.hover();

console.log('Copying, reacting to and branching an assistant response');
await assistant.locator('button[aria-label="Copy response"]').click();
assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Hello from the test model.');
const like = assistant.locator('button[aria-label="Like response"]');
const dislike = assistant.locator('button[aria-label="Dislike response"]');
await like.click();
await waitFor(() => document.querySelector('article.assistant-message button[aria-label="Like response"]')?.getAttribute('aria-pressed') === 'true', 20_000);
await dislike.click();
await waitFor(() => document.querySelector('article.assistant-message button[aria-label="Dislike response"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('article.assistant-message button[aria-label="Like response"]')?.getAttribute('aria-pressed') === 'false', 20_000);
await like.click();
await waitFor(() => document.querySelector('article.assistant-message button[aria-label="Like response"]')?.getAttribute('aria-pressed') === 'true', 20_000);
let storedReaction = false;
for (let attempt = 0; attempt < 60 && !storedReaction; attempt++) {
  const stored = JSON.parse(await readFile(join(settingsDir, 'settings.json'), 'utf8'));
  storedReaction = Array.isArray(stored.reactions) && stored.reactions.some((item) => item.value === 'like');
  if (!storedReaction) await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.ok(storedReaction, 'the like was not saved in settings');

await assistant.hover();
await assistant.locator('button[aria-label="More actions"]').click();
await waitFor(() => document.querySelector('.action-menu') !== null);
assert.match(await text('.action-menu'), /Copy as plain text/);
assert.match(await text('.action-menu'), /Add response to task/);
await page.locator('.action-menu button', { hasText: 'Copy as plain text' }).click();
assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Hello from the test model.');
await waitFor(() => document.querySelector('.action-menu') === null);

await assistant.hover();
await assistant.locator('button[aria-label="More actions"]').click();
await waitFor(() => document.querySelector('.action-menu') !== null);
await page.locator('.action-menu button', { hasText: 'Add response to task' }).click();
await waitFor(() => /Response ·/.test(document.querySelector('#context-chips')?.textContent ?? ''), 10_000);
await page.screenshot({ path: join(artifacts, 'message-actions.png') });
await page.locator('#context-chips .attachment').click();
await waitFor(() => (document.querySelector('#context-chips')?.textContent ?? '').length === 0);

await assistant.hover();
await assistant.locator('button[aria-label="Branch into a new task"]').click();
await waitFor(() => document.querySelectorAll('#task-list .task-button').length === 2, 40_000);
await waitFor(() => /Hello from the test model\./.test(document.querySelector('#conversation')?.textContent ?? ''), 40_000);
assert.equal(await page.locator('#task-list .task-button.active').count(), 1);
assert.equal(await page.locator('#task-list .task-node[data-depth="1"] .task-button.forked').count(), 1, 'the fork was not nested under its origin');
assert.equal(await page.locator('#task-list .task-node[data-depth="0"] .task-branch-count').count(), 1, 'the origin did not show its branch count');
assert.equal(await page.locator('#task-list .task-elbow').count(), 1, 'the sidebar did not draw a branch lane');
assert.equal(await page.locator('#branch-bar').isVisible(), true, 'the branch bar was hidden on a forked task');
assert.match(await text('#branch-bar'), /Branched from/);
console.log('Returning to the origin and back through the branch bar');
await page.screenshot({ path: join(artifacts, 'fork-graph.png') });
await page.locator('#branch-bar .branch-link').click();
await waitFor(() => /^Branch(es)?$/.test(document.querySelector('#branch-bar .branch-caption')?.textContent ?? ''), 20_000);
assert.equal(await page.locator('#branch-bar .branch-link').count(), 1);
await page.locator('#branch-bar .branch-link').click();
await waitFor(() => /Branched from/.test(document.querySelector('#branch-bar')?.textContent ?? ''), 20_000);
assert.equal(await page.locator('#task-list .task-button.forked.active').count(), 1, 'the fork was not active after returning from the origin');
await page.locator('#task-list .task-button').nth(1).click();
await waitFor(() => /Hello from the test model\./.test(document.querySelector('#conversation')?.textContent ?? ''), 40_000);

console.log('Keeping a running task going while work finishes');
assert.equal(await page.locator('#background-task').count(), 0, 'the composer still had a separate background button');
await page.fill('#prompt', 'relay-slow background check');
await page.keyboard.press('Enter');
await waitFor(() => document.querySelector('#thinking')?.hidden === false, 20_000);
const backgroundedId = await page.evaluate(() => document.querySelector('#task-list .task-button.active')?.dataset.session ?? '');
const backgroundedTitle = (await text('#task-title')).trim();
assert.ok(backgroundedId, 'no active task was running to leave');
console.log('Showing live agent activity while the model works');
await waitFor(() => document.querySelector('#thinking')?.hidden === false, 20_000);
await page.waitForTimeout(1_400);
const thinkingState = await page.evaluate(() => ({
  label: document.querySelector('#thinking-label')?.textContent ?? '',
  elapsed: document.querySelector('#thinking-elapsed')?.textContent ?? '',
  orbit: document.querySelectorAll('#thinking .thinking-orbit i').length,
  hidden: document.querySelector('#thinking')?.hidden,
}));
assert.equal(thinkingState.hidden, false, 'thinking indicator was hidden during a running task');
assert.equal(thinkingState.label, 'Thinking…', `expected the first status phrase, got "${thinkingState.label}"`);
assert.match(thinkingState.elapsed, /^\d+s$/, `expected a ticking elapsed timer, got "${thinkingState.elapsed}"`);
assert.equal(thinkingState.orbit, 3);
const sidebarTasks = await page.evaluate(() => [...document.querySelectorAll('#task-list .task-button')].map(button => ({
  title: button.querySelector('.task-name')?.textContent ?? '',
  running: /Running/.test(button.querySelector('.task-time')?.textContent ?? ''),
  loaders: button.querySelectorAll('.task-loader i').length,
  dots: button.querySelectorAll('.task-dot').length,
})));
const runningTasks = sidebarTasks.filter(task => task.running);
assert.ok(runningTasks.length > 0, 'no running task was listed in the sidebar');
for (const task of runningTasks) assert.equal(task.loaders, 3, `running task "${task.title}" did not show a working loader`);
for (const task of sidebarTasks.filter(task => !task.running)) assert.equal(task.loaders, 0, `idle task "${task.title}" showed a working loader`);
await page.screenshot({ path: join(artifacts, 'thinking.png') });

console.log('Leaving a running task backgrounds it automatically');
await page.locator('#task-list .task-group.current .task-button:not(.active)').first().click();
await page.waitForFunction(async (id) => {
  const runs = await window.relay.backgroundActivity();
  return runs.some((run) => run.id === id && run.status === 'running');
}, backgroundedId, { timeout: 20_000 });
await page.click('#tab-activity');
await waitFor(() => /Background work/.test(document.querySelector('#activity-body')?.textContent ?? ''), 20_000);
assert.equal(await page.locator('#activity-body .activity-run').count(), 1, 'Activity did not list the backgrounded task');
const backgroundRun = page.locator('#activity-body .activity-run').first();
assert.equal((await backgroundRun.locator('.activity-run-title').textContent() ?? '').trim(), backgroundedTitle);
assert.match(await backgroundRun.locator('.activity-run-status').textContent(), /Running|Idle/);
await backgroundRun.locator('summary').click();
await waitFor(() => document.querySelector('#activity-body .activity-run')?.open === true, 10_000);
assert.match(await backgroundRun.locator('.activity-run-logs').textContent(), /relay-slow background check/);
await page.screenshot({ path: join(artifacts, 'background-work.png') });
await page.waitForFunction(async (id) => {
  const runs = await window.relay.backgroundActivity();
  return runs.some((run) => run.id === id && run.status !== 'running');
}, backgroundedId, { timeout: 40_000 });
await waitFor(() => document.querySelector('#activity-body .activity-run .activity-run-status')?.textContent === 'Idle', 40_000);
assert.equal(await page.locator('#activity-body .activity-run').evaluate((node) => node.open), true, 'the open background run collapsed after it updated');
assert.match(await backgroundRun.locator('.activity-run-logs').textContent(), /Hello from the test model\./);
await backgroundRun.locator('.activity-run-actions button', { hasText: 'Open task' }).click();
await page.waitForFunction((id) => document.querySelector('#task-list .task-button.active')?.dataset.session === id, backgroundedId, { timeout: 20_000 });
await waitFor(() => document.querySelector('#thinking')?.hidden === true, 40_000);

console.log('Queuing messages while the model works, then editing, removing and steering them');
await page.fill('#prompt', 'relay-hold queued flow');
await page.keyboard.press('Enter');
await waitFor(() => document.querySelector('#thinking')?.hidden === false, 20_000);

await page.fill('#prompt', 'Edit me from the queue');
await page.keyboard.press('Enter');
await waitFor(() => document.querySelectorAll('#queued-messages .queued-message').length === 1, 20_000);
assert.match(await text('#queued-messages .queued-text'), /Edit me from the queue/);
assert.match(await text('#queued-messages .queued-meta'), /Sends when this reply finishes/);
await page.screenshot({ path: join(artifacts, 'queued-message.png') });
await page.locator('#queued-messages .queued-message').first().locator('button', { hasText: 'Edit' }).click();
await waitFor(() => document.querySelectorAll('#queued-messages .queued-message').length === 0, 10_000);
assert.equal(await page.inputValue('#prompt'), 'Edit me from the queue', 'editing a queued message did not restore its text');
await page.fill('#prompt', '');

await page.fill('#prompt', 'Remove me from the queue');
await page.keyboard.press('Enter');
await waitFor(() => document.querySelectorAll('#queued-messages .queued-message').length === 1, 20_000);
await page.locator('#queued-messages .queued-message').first().locator('button', { hasText: 'Remove' }).click();
await waitFor(() => document.querySelectorAll('#queued-messages .queued-message').length === 0, 10_000);
const inboxAfterRemove = await page.evaluate(async () => {
  const running = (await window.relay.listSessions()).find(session => session.status === 'running');
  return running ? (await window.relay.listQueuedMessages(running.id)).length : 0;
});
assert.equal(inboxAfterRemove, 0, 'removing a queued message left it in the engine inbox');

await page.fill('#prompt', 'Auto send after the reply');
await page.keyboard.press('Enter');
await waitFor(() => document.querySelectorAll('#queued-messages .queued-message').length === 1, 20_000);
await page.waitForFunction(() => {
  const queued = document.querySelectorAll('#queued-messages .queued-message').length;
  const sent = Array.from(document.querySelectorAll('#conversation article.user-message .user-text')).some(node => node.textContent?.includes('Auto send after the reply'));
  return queued === 0 && sent;
}, undefined, { timeout: 45_000 });
await waitFor(() => document.querySelector('#thinking')?.hidden === true, 45_000);

await page.fill('#prompt', 'relay-hold steer check');
await page.keyboard.press('Enter');
await waitFor(() => document.querySelector('#thinking')?.hidden === false, 20_000);
await page.fill('#prompt', 'Steer straight to the model');
await page.keyboard.press('Enter');
await waitFor(() => document.querySelectorAll('#queued-messages .queued-message').length === 1, 20_000);
const steerStart = Date.now();
await page.locator('#queued-messages .queued-message').first().locator('button', { hasText: 'Send now' }).click();
await page.waitForFunction(() => {
  const queued = document.querySelectorAll('#queued-messages .queued-message').length;
  const sent = Array.from(document.querySelectorAll('#conversation article.user-message .user-text')).some(node => node.textContent?.includes('Steer straight to the model'));
  return queued === 0 && sent;
}, undefined, { timeout: 20_000 });
assert.ok(Date.now() - steerStart < 9_000, 'steering waited for the running reply to finish');
await waitFor(() => document.querySelector('#thinking')?.hidden === true, 45_000);
await waitFor(() => document.querySelectorAll('#queued-messages .queued-message').length === 0, 10_000);

console.log('Offering follow-up suggestions only under the latest reply');
await page.waitForFunction(() => document.querySelectorAll('#conversation article.assistant-message details.reply-suggestions').length > 0, undefined, { timeout: 20_000 });
const anchoredToLastReply = await page.evaluate(() => {
  const replies = Array.from(document.querySelectorAll('#conversation article.assistant-message'));
  const sections = Array.from(document.querySelectorAll('#conversation article.assistant-message details.reply-suggestions'));
  const last = replies[replies.length - 1];
  return { replies: replies.length, sections: sections.length, onLast: replies.length > 1 && sections.length === 1 && last?.contains(sections[0] ?? null) };
});
assert.equal(anchoredToLastReply.sections, 1, 'follow-up suggestions appeared under more than the latest reply');
assert.ok(anchoredToLastReply.onLast, 'follow-up suggestions were not attached to the latest reply');
const suggestions = page.locator('#conversation article.assistant-message details.reply-suggestions').first();
assert.equal(await suggestions.locator('.suggestion-toggle .dotted-rule').count(), 2);
assert.match(await suggestions.locator('.suggestion-toggle').textContent(), /Follow-ups/);
await suggestions.locator('.suggestion-toggle').click();
await waitFor(() => document.querySelector('article.assistant-message details.reply-suggestions')?.open === true);
const suggestion = (await suggestions.locator('.suggestion-chip').first().textContent() ?? '').trim();
assert.ok(suggestion.length > 0, 'no follow-up suggestion was offered');
await suggestions.locator('.suggestion-chip').first().click();
await page.waitForFunction((expected) => Array.from(document.querySelectorAll('#conversation article.user-message .user-text')).some(node => node.textContent?.trim() === expected), suggestion, { timeout: 20_000 });
await page.waitForFunction(() => {
  const replies = Array.from(document.querySelectorAll('#conversation article.assistant-message'));
  const sections = Array.from(document.querySelectorAll('#conversation article.assistant-message details.reply-suggestions'));
  return sections.length === 1 && replies[replies.length - 1]?.contains(sections[0] ?? null);
}, undefined, { timeout: 40_000 });

console.log('Jumping back to the latest message from a scrolled-up chat');
await dismissNotice('the scroll check');
for (let index = 0; index < 3; index++) {
  const before = await page.locator('#conversation article.assistant-message').count();
  await page.fill('#prompt', `Scroll filler ${index}`);
  await page.click('#send-message');
  await page.waitForFunction((count) => document.querySelectorAll('#conversation article.assistant-message').length > count, before, { timeout: 40_000 });
}
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(860, 620));
await page.waitForTimeout(400);
assert.ok(await page.evaluate(() => { const conversation = document.querySelector('#conversation'); return conversation.scrollHeight > conversation.clientHeight; }), 'the conversation was too short to scroll');
await page.evaluate(() => document.querySelector('#conversation').scrollTop = 0);
await waitFor(() => document.querySelector('#scroll-bottom')?.hidden === false, 10_000);
assert.equal(await page.locator('#scroll-bottom').isVisible(), true);
await page.screenshot({ path: join(artifacts, 'scroll-bottom.png') });
await page.click('#scroll-bottom');
await waitFor(() => document.querySelector('#scroll-bottom')?.hidden === true, 10_000);
await page.waitForFunction(() => {
  const conversation = document.querySelector('#conversation');
  return conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight <= 96;
}, undefined, { timeout: 10_000 });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 940));

console.log('Resizing, hiding and reopening the project inspector');
const inspectorWidth = () => page.evaluate(() => Math.round(document.querySelector('#inspector')?.getBoundingClientRect().width ?? 0));
const chatWidth = () => page.evaluate(() => Math.round(document.querySelector('.chat')?.getBoundingClientRect().width ?? 0));
async function dragResizer(dx) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.waitForFunction(() => (document.querySelector('#inspector-resizer')?.getBoundingClientRect().width ?? 0) > 0, undefined, { timeout: 10_000 });
    const box = await page.locator('#inspector-resizer').boundingBox();
    assert.ok(box && box.width > 0, 'the inspector resize handle was not visible');
    const x = box.x + box.width / 2;
    const y = box.y + 60;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const started = await page.waitForFunction(
      () => document.querySelector('#app')?.classList.contains('splitter-active') === true,
      undefined,
      { timeout: 2_000 },
    ).then(() => true, () => false);
    if (!started) { await page.mouse.up(); continue; }
    await page.mouse.move(x + dx, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    return;
  }
  throw new Error(`the inspector resize drag by ${dx}px never started (inspector ${await inspectorWidth()}px)`);
}
const beforeWidth = await inspectorWidth();
const beforeChat = await chatWidth();
await dragResizer(-120);
const widerWidth = await inspectorWidth();
assert.ok(widerWidth >= beforeWidth + 100, `dragging left did not widen the inspector (${beforeWidth} → ${widerWidth})`);
assert.ok(await chatWidth() < beforeChat, 'the chat did not give space to a wider inspector');
await page.screenshot({ path: join(artifacts, 'inspector-resized.png') });
await dragResizer(600);
if (!await page.evaluate(() => document.querySelector('#app').classList.contains('inspector-hidden'))) {
  console.log(`The inspector stayed at ${await inspectorWidth()}px; retrying the collapse drag`);
  await dragResizer(600);
}
assert.equal(await page.evaluate(() => document.querySelector('#app').classList.contains('inspector-hidden')), true, `dragging the inspector past its minimum did not hide it (inspector ${await inspectorWidth()}px)`);
assert.equal(await page.locator('#inspector').isVisible(), false);
assert.equal(await page.evaluate(() => document.querySelector('#inspector-button')?.getAttribute('aria-pressed')), 'false');
const fullWidth = await chatWidth();
const viewport = await page.evaluate(() => window.innerWidth);
assert.ok(fullWidth >= viewport - 230, `the chat did not take the space of the hidden inspector (${fullWidth} of ${viewport})`);
await page.screenshot({ path: join(artifacts, 'inspector-collapsed.png') });
await page.click('#inspector-button');
await waitFor(() => !document.querySelector('#app').classList.contains('inspector-hidden'));
assert.equal(await page.locator('#inspector').isVisible(), true);
assert.equal(await inspectorWidth(), widerWidth, 'reopening the inspector did not restore the dragged width');

console.log('Collapsing and reopening the task sidebar');
const chatLeft = () => page.evaluate(() => Math.round(document.querySelector('.chat')?.getBoundingClientRect().left ?? -1));
assert.ok(await chatLeft() > 150, 'the sidebar was not taking space before collapsing');
await page.click('#sidebar-button');
await waitFor(() => document.querySelector('#app')?.classList.contains('sidebar-hidden'));
await page.waitForFunction(() => {
  const sidebar = document.querySelector('.sidebar');
  const chat = document.querySelector('.chat');
  return !!sidebar && sidebar.getBoundingClientRect().width === 0 && (chat?.getBoundingClientRect().left ?? 999) < 0.5;
}, undefined, { timeout: 5_000 });
assert.equal(await page.evaluate(() => document.querySelector('#sidebar-button')?.getAttribute('aria-pressed')), 'false');
assert.equal(await page.locator('.sidebar').isVisible(), false);
await page.screenshot({ path: join(artifacts, 'sidebar-collapsed.png') });
await page.keyboard.press(`${mod}+b`);
await waitFor(() => !document.querySelector('#app')?.classList.contains('sidebar-hidden'));
await page.waitForFunction(() => (document.querySelector('.sidebar')?.getBoundingClientRect().width ?? 0) > 150, undefined, { timeout: 5_000 });
assert.equal(await page.evaluate(() => document.querySelector('#sidebar-button')?.getAttribute('aria-pressed')), 'true');
assert.equal(await page.locator('.sidebar').isVisible(), true);

console.log('Running a real tool step and collapsing its vertical stepper');
const toolSession = (await page.evaluate(async () => window.relay.listSessions()))[0].id;
await page.evaluate((sessionId) => window.relay.sendMessage({
  sessionId, text: 'relay-tool read the README', model: 'custom::test-model', variant: '', access: 'full', files: [], skills: [],
}), toolSession);
await waitFor(() => document.querySelector('article.assistant-message details.tool-stepper'), 60_000);
await waitFor(() => document.querySelector('details.tool-stepper')?.dataset.state === 'completed', 40_000);
const stepper = await page.evaluate(() => {
  const details = document.querySelector('details.tool-stepper');
  return {
    open: details.open,
    label: details.querySelector('.stepper-title')?.textContent ?? '',
    detail: details.querySelector('.stepper-detail')?.textContent ?? '',
    steps: details.querySelectorAll('.stepper-list .step').length,
  };
});
assert.equal(stepper.open, false, 'a completed stepper stayed expanded');
assert.match(stepper.label, /^1 step completed$/);
assert.equal(stepper.detail, 'read');
assert.equal(stepper.steps, 1);
await page.locator('details.tool-stepper > .stepper-head').click();
await waitFor(() => document.querySelector('details.tool-stepper')?.open === true);
assert.match(await text('details.tool-stepper .step-detail'), /read/);
assert.match(await text('details.tool-stepper .step-body'), /Original readme\./);
await page.screenshot({ path: join(artifacts, 'tool-stepper.png') });
await page.locator('details.tool-stepper > .stepper-head').click();
await waitFor(() => document.querySelector('details.tool-stepper')?.open === false, 10_000);

console.log('Reading what the task used from the Activity panel');
await page.click('#tab-activity');
await waitFor(() => document.querySelector('#activity-panel')?.hidden === false, 10_000);
const activitySections = await page.evaluate(() => [...document.querySelectorAll('#activity-body .activity-section-title')].map(node => node.textContent ?? ''));
for (const title of ['Subagents', 'Skills', 'MCP servers', 'Artifacts', 'Web reading', 'Sources']) {
  assert.ok(activitySections.includes(title), `the activity panel was missing its ${title} section`);
}
await waitFor(() => /README\.md/.test(document.querySelector('#activity-body')?.textContent ?? ''), 20_000);
const readSource = page.locator('#activity-body .activity-item', { hasText: 'README.md' }).first();
assert.match(await readSource.textContent(), /readme\.md/i);
await page.screenshot({ path: join(artifacts, 'activity.png') });

console.log('Collecting an approval and answering it from the Attention page');
await page.click('#new-task');
await waitFor(() => document.querySelectorAll('#task-list .task-button').length === 3, 20_000);
const approvalSession = (await page.evaluate(async () => window.relay.listSessions()))[0].id;
await page.evaluate((sessionId) => window.relay.sendMessage({
  sessionId, text: 'relay-tool read the README', model: 'custom::test-model', variant: '', access: 'ask', files: [], skills: [],
}), approvalSession);
await waitFor(() => document.querySelector('#requests .request-card') !== null, 60_000);
await waitFor(() => {
  const count = document.querySelector('#attention-button .attention-count');
  return count !== null && !count.hidden && Number(count.textContent) >= 1;
}, 60_000);
assert.equal(await page.locator('#attention-button').isDisabled(), false);
await page.click('#attention-button');
await waitFor(() => document.querySelector('#app').classList.contains('attention-open'));
const attentionItem = page.locator('#attention-list .attention-item').first();
await attentionItem.waitFor();
assert.match(await attentionItem.textContent(), /Permission/);
assert.equal(await attentionItem.locator('.attention-folder').textContent(), basename(project));
await page.waitForTimeout(250);
await page.screenshot({ path: join(artifacts, 'attention.png') });
await attentionItem.locator('button', { hasText: 'Allow once' }).click();
await waitFor(() => /Nothing needs you right now/.test(document.querySelector('#attention-list')?.textContent ?? ''), 30_000);
assert.equal(await page.evaluate(() => document.querySelector('#attention-button .attention-count')?.hidden), true);
await page.waitForTimeout(1500);
assert.equal(await page.locator('#attention').isVisible(), true, 'a task update closed the attention page');
await page.keyboard.press('Escape');
await waitFor(() => !document.querySelector('#app').classList.contains('attention-open'));
assert.equal(await page.locator('#attention').isVisible(), false);

console.log('Browsing, installing and removing curated skills on the Toolkit page');
await waitFor(() => !document.querySelector('#tools-button')?.disabled, 20_000);
await page.click('#tools-button');
await waitFor(() => document.querySelector('#tools-page')?.hidden === false && /Curated skills · 100/.test(document.querySelector('#tools-body')?.textContent ?? ''), 30_000);
assert.equal(await page.locator('dialog[aria-label="Extensions"]').count(), 0, 'the toolkit opened a dialog instead of a page');
assert.equal(await page.locator('#tools-button').getAttribute('aria-pressed'), 'true');
assert.equal(await page.locator('#tools-tab-skills').getAttribute('aria-selected'), 'true');
assert.match(await text('#tools-summary'), /bundled with Relay/);
assert.equal(await page.locator('.tools-grid .tools-card').count(), 100, 'the curated skill catalog did not list 100 skills');
assert.match(await text('.tools-section:first-of-type'), /No skills installed yet/);
await page.screenshot({ path: join(artifacts, 'skills.png') });

await page.fill('#tools-search', 'Code review');
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 1, 20_000);
const skillCard = page.locator('.tools-grid .tools-card').first();
assert.match(await skillCard.textContent(), /Code review/);
assert.ok(!/Installed/.test(await skillCard.textContent()), 'a curated skill started installed');
await skillCard.locator('button', { hasText: 'Install' }).click();
await waitFor(() => /Code review/.test(document.querySelector('.tools-installed')?.textContent ?? ''), 30_000);
assert.match(await text('#tools-summary'), /^1 installed/);
assert.match(await page.locator('.tools-grid .tools-card').first().textContent(), /Installed/);

console.log('Removing the installed skill from its catalog card');
await page.locator('.tools-grid .tools-card').first().locator('button', { hasText: 'Remove' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Remove skill?"]') !== null);
await page.locator('dialog[aria-label="Remove skill?"] button', { hasText: 'Remove skill' }).click();
await waitFor(() => /No skills installed yet/.test(document.querySelector('#tools-body')?.textContent ?? ''), 30_000);
assert.ok(!/Installed/.test(await page.locator('.tools-grid .tools-card').first().textContent()), 'the removed skill still showed as installed');

console.log('Installing every matching skill at once');
await waitFor(() => document.querySelector('#tools-primary')?.textContent === 'Install all 1', 20_000);
await page.click('#tools-primary');
await waitFor(() => /Code review/.test(document.querySelector('.tools-installed')?.textContent ?? ''), 30_000);
await page.locator('.tools-installed .integration-row', { hasText: 'Code review' }).locator('button', { hasText: 'Remove' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Remove skill?"]') !== null);
await page.locator('dialog[aria-label="Remove skill?"] button', { hasText: 'Remove skill' }).click();
await waitFor(() => !/Code review/.test(document.querySelector('.tools-installed')?.textContent ?? ''), 30_000);

console.log('Filtering skills by category and searching');
await page.fill('#tools-search', '');
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 100, 20_000);
const categoryChip = page.locator('#tools-chips .extension-chip').nth(1);
const categoryLabel = await categoryChip.textContent();
await categoryChip.click();
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length > 0 && document.querySelectorAll('.tools-grid .tools-card').length < 100, 20_000);
assert.match(await text('.tools-section:last-of-type h3'), /Curated skills · \d+/);
await page.locator('#tools-chips .extension-chip:text-is("All")').click();
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 100, 20_000);
console.log(`Category chip ${categoryLabel} filtered the catalog`);

console.log('Finding a project and a task from the Toolkit search');
await page.fill('#tools-search', basename(project));
await waitFor(() => /Projects · \d+/.test(document.querySelector('#tools-body')?.textContent ?? ''), 20_000);
const projectsSection = page.locator('section.tools-results').filter({ has: page.locator('h3', { hasText: /^Projects/ }) });
const projectResult = projectsSection.locator('.tools-result').first();
assert.match(await projectResult.textContent(), /Current/);
await page.screenshot({ path: join(artifacts, 'toolkit-search.png') });
await projectResult.click();
await waitFor(() => document.querySelector('#tools-page')?.hidden === true, 10_000);
await page.click('#tools-button');
await waitFor(() => document.querySelector('#tools-page')?.hidden === false, 20_000);
const activeTaskTitle = (await text('#task-title')).trim();
await page.fill('#tools-search', activeTaskTitle);
await waitFor(() => /Tasks · \d+/.test(document.querySelector('#tools-body')?.textContent ?? ''), 20_000);
const tasksSection = page.locator('section.tools-results').filter({ has: page.locator('h3', { hasText: /^Tasks/ }) });
const foundTaskTitle = (await tasksSection.locator('.tools-result-name').first().textContent() ?? '').trim();
await tasksSection.locator('.tools-result').first().click();
await waitFor(() => document.querySelector('#tools-page')?.hidden === true, 10_000);
await page.waitForFunction((title) => document.querySelector('#task-list .task-button.active .task-name')?.textContent?.trim() === title, foundTaskTitle, { timeout: 20_000 });
assert.equal(await text('#task-title'), foundTaskTitle);
await page.keyboard.press('Escape');
await waitFor(() => document.querySelector('#tools-page')?.hidden === true);
assert.equal(await page.locator('#tools-button').getAttribute('aria-pressed'), 'false');

console.log('Attaching a workspace skill to the message from the composer');
await page.click('#attach-file');
await page.locator('#plus-menu .plus-option', { hasText: 'Add skill' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Skills"]') !== null, 20_000);
const skillPicker = page.locator('dialog[aria-label="Skills"]');
await waitFor(() => !/Loading skills/.test(document.querySelector('dialog[aria-label="Skills"]')?.textContent ?? ''), 20_000);
await skillPicker.locator('.choice', { hasText: 'OpenCode' }).first().locator('input').check();
await skillPicker.locator('button', { hasText: 'Add to message' }).click();
await waitFor(() => (document.querySelector('#skill-chips')?.textContent ?? '').includes('OpenCode'));
await page.locator('#skill-chips .attachment').click();
await waitFor(() => (document.querySelector('#skill-chips')?.textContent ?? '').length === 0);

console.log('Tagging the composer with plan mode and an agent');
await page.click('#attach-file');
await page.locator('#plus-menu .plus-option', { hasText: 'Plan only' }).click();
await waitFor(() => (document.querySelector('#mode-chips')?.textContent ?? '').includes('Plan only'));
await page.click('#attach-file');
await page.locator('#plus-menu .plus-option', { hasText: 'Tools & agents' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Tools & agents"]') !== null, 20_000);
const agents = page.locator('dialog[aria-label="Tools & agents"]');
await waitFor(() => !/Loading agents/.test(document.querySelector('dialog[aria-label="Tools & agents"]')?.textContent ?? ''), 20_000);
assert.ok(await agents.locator('.choice').count() > 0, 'no agents were listed');
await agents.locator('.choice input').first().check();
await agents.locator('button', { hasText: 'Use agents' }).click();
await waitFor(() => (document.querySelector('#agent-chips')?.textContent ?? '').length > 0);
await page.screenshot({ path: join(artifacts, 'composer-tags.png') });
await page.locator('#mode-chips .attachment').click();
await waitFor(() => (document.querySelector('#mode-chips')?.textContent ?? '').length === 0);
await page.locator('#agent-chips .attachment').first().click();
await waitFor(() => (document.querySelector('#agent-chips')?.textContent ?? '').length === 0);

console.log('Toggling to the plugin catalog on the same Toolkit page');
await page.click('#tools-button');
await waitFor(() => document.querySelector('#tools-page')?.hidden === false, 20_000);
await page.click('#tools-tab-plugins');
await waitFor(() => /Curated plugins · 100/.test(document.querySelector('#tools-body')?.textContent ?? ''), 30_000);
assert.equal(await page.locator('dialog[aria-label="Extensions"]').count(), 0, 'the toolkit opened a dialog instead of a page');
assert.equal(await page.locator('#tools-button').getAttribute('aria-pressed'), 'true');
assert.equal(await page.locator('#tools-tab-plugins').getAttribute('aria-selected'), 'true');
assert.equal(await page.locator('#tools-tab-skills').getAttribute('aria-selected'), 'false');
assert.match(await text('#tools-summary'), /0 installed · 100 plugin packs bundled with Relay/);
assert.equal(await page.locator('.tools-grid .tools-card').count(), 100, 'the curated plugin catalog did not list 100 packs');
assert.match(await text('.tools-section:first-of-type'), /No plugins installed yet/);
await page.screenshot({ path: join(artifacts, 'plugins.png') });

await page.fill('#tools-search', 'Docs suite');
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 1, 20_000);
const pluginCard = page.locator('.tools-grid .tools-card').first();
assert.match(await pluginCard.textContent(), /Docs suite/);
assert.match(await pluginCard.textContent(), /2 commands/);
assert.match(await pluginCard.textContent(), /\/document/);
await pluginCard.locator('button', { hasText: 'Install' }).click();
await waitFor(() => /Docs suite/.test(document.querySelector('.tools-installed')?.textContent ?? '') && /Enabled/.test(document.querySelector('.tools-installed')?.textContent ?? ''), 60_000);
assert.match(await text('#tools-summary'), /^1 installed/);
assert.match(await page.locator('.tools-grid .tools-card').first().textContent(), /Installed/);

console.log('Installing a declarative plugin from a ZIP');
await page.fill('#tools-search', '');
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 100, 20_000);
await page.click('#tools-file');
await waitFor(() => document.querySelector('dialog[aria-label="Install E2E kit"]') !== null, 20_000);
assert.match(await text('dialog[aria-label="Install E2E kit"]'), /1 command · 1 skill/);
assert.match(await text('dialog[aria-label="Install E2E kit"]'), /Commands: \/check/);
assert.match(await text('dialog[aria-label="Install E2E kit"]'), /SHA-256 [a-f0-9]{64}/);
await page.locator('dialog[aria-label="Install E2E kit"] button', { hasText: 'Install plugin' }).click();
await waitFor(() => /E2E kit/.test(document.querySelector('.tools-installed')?.textContent ?? '') && /Enabled/.test(document.querySelector('.tools-installed')?.textContent ?? ''), 60_000);
assert.match(await text('.tools-installed'), /1 command · 1 skill/);

console.log('Rejecting an insecure web plugin import');
await page.click('#tools-secondary');
await waitFor(() => document.querySelector('dialog[aria-label="Import plugin from web"]') !== null);
const importer = page.locator('dialog[aria-label="Import plugin from web"]');
await importer.getByLabel('Plugin ZIP URL').fill('http://example.com/plugin.zip');
await importer.locator('button', { hasText: 'Download and preview' }).click();
await waitFor(() => /HTTPS/.test(document.querySelector('dialog[aria-label="Import plugin from web"]')?.textContent ?? ''), 20_000);
await importer.locator('button[aria-label="Close dialog"]').click();

console.log('Filtering the plugin catalog by install state');
await page.locator('#tools-chips .extension-chip:text-is("Installed")').click();
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 1, 20_000);
await page.locator('#tools-chips .extension-chip:text-is("Available")').click();
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 99, 20_000);
await page.locator('#tools-chips .extension-chip:text-is("All")').click();
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 100, 20_000);
await page.fill('#tools-search', 'no-such-plugin');
await waitFor(() => /No installed plugins match that search/.test(document.querySelector('#tools-body')?.textContent ?? '') && /No plugins match that search/.test(document.querySelector('#tools-body')?.textContent ?? ''), 20_000);
await page.fill('#tools-search', '');
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 100, 20_000);
await page.click('#tools-close');
await waitFor(() => document.querySelector('#tools-page')?.hidden === true);
assert.equal(await page.locator('#tools-button').getAttribute('aria-pressed'), 'false');
assert.equal(await page.locator('#tools-tab-plugins').getAttribute('aria-selected'), 'false');
await waitFor(() => document.querySelector('#engine-status')?.textContent?.startsWith('Engine ready'), 60_000);

console.log('Selecting plugin commands from the slash menu');
await page.fill('#prompt', '/document');
await waitFor(() => !document.querySelector('#command-menu')?.hidden && /\/document/.test(document.querySelector('#command-menu')?.textContent ?? ''), 30_000);
assert.match(await text('#command-menu'), /Document code in place/);
await page.keyboard.press('Escape');
await page.fill('#prompt', '/');
await waitFor(() => !document.querySelector('#command-menu')?.hidden && /\/check/.test(document.querySelector('#command-menu')?.textContent ?? ''), 30_000);
assert.match(await text('#command-menu'), /Check the workspace/);
await page.fill('#prompt', '/che');
await page.keyboard.press('Enter');
await waitFor(() => (document.querySelector('#command-chips')?.textContent ?? '').includes('/check'));
assert.equal(await page.inputValue('#prompt'), '');
await page.screenshot({ path: join(artifacts, 'commands.png') });
await page.keyboard.press('Escape');
await waitFor(() => (document.querySelector('#command-chips')?.textContent ?? '').length === 0);

console.log('Disabling, enabling and removing the installed plugins');
await page.click('#tools-button');
await waitFor(() => document.querySelector('#tools-page')?.hidden === false, 20_000);
await page.click('#tools-tab-plugins');
await waitFor(() => /E2E kit/.test(document.querySelector('.tools-installed')?.textContent ?? ''), 30_000);
const installedPlugins = page.locator('.tools-installed');
await installedPlugins.locator('.integration-row', { hasText: 'E2E kit' }).locator('button', { hasText: 'Disable' }).click();
await waitFor(() => {
  const row = [...document.querySelectorAll('.tools-installed .integration-row')].find((item) => /E2E kit/.test(item.textContent ?? ''));
  return /Disabled/.test(row?.textContent ?? '');
}, 60_000);
await installedPlugins.locator('.integration-row', { hasText: 'E2E kit' }).locator('button', { hasText: 'Enable' }).click();
await waitFor(() => {
  const row = [...document.querySelectorAll('.tools-installed .integration-row')].find((item) => /E2E kit/.test(item.textContent ?? ''));
  return /Enabled/.test(row?.textContent ?? '');
}, 60_000);
await installedPlugins.locator('.integration-row', { hasText: 'E2E kit' }).locator('button', { hasText: 'Remove' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Remove plugin?"]') !== null);
await page.locator('dialog[aria-label="Remove plugin?"] button', { hasText: 'Remove plugin' }).click();
await waitFor(() => /Docs suite/.test(document.querySelector('.tools-installed')?.textContent ?? '') && !/E2E kit/.test(document.querySelector('.tools-installed')?.textContent ?? ''), 60_000);
await installedPlugins.locator('.integration-row', { hasText: 'Docs suite' }).locator('button', { hasText: 'Remove' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Remove plugin?"]') !== null);
await page.locator('dialog[aria-label="Remove plugin?"] button', { hasText: 'Remove plugin' }).click();
await waitFor(() => /No plugins installed yet/.test(document.querySelector('#tools-body')?.textContent ?? ''), 60_000);

console.log('Installing every matching plugin at once');
await page.fill('#tools-search', 'Testing suite');
await waitFor(() => document.querySelectorAll('.tools-grid .tools-card').length === 1, 20_000);
await waitFor(() => document.querySelector('#tools-primary')?.textContent === 'Install all 1', 20_000);
await page.click('#tools-primary');
await waitFor(() => /Testing suite/.test(document.querySelector('.tools-installed')?.textContent ?? ''), 60_000);
await page.locator('.tools-installed .integration-row', { hasText: 'Testing suite' }).locator('button', { hasText: 'Remove' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Remove plugin?"]') !== null);
await page.locator('dialog[aria-label="Remove plugin?"] button', { hasText: 'Remove plugin' }).click();
await waitFor(() => /No plugins installed yet/.test(document.querySelector('#tools-body')?.textContent ?? ''), 60_000);
await page.click('#tools-close');
await waitFor(() => document.querySelector('#engine-status')?.textContent?.startsWith('Engine ready'), 60_000);

console.log('Checking connectors on the same Toolkit page');
await page.click('#tools-button');
await waitFor(() => document.querySelector('#tools-page')?.hidden === false, 20_000);
await page.click('#tools-tab-connectors');
await waitFor(() => /Connectors ·/.test(document.querySelector('#tools-body')?.textContent ?? '') && !/Loading connectors/.test(document.querySelector('#tools-body')?.textContent ?? ''), 30_000);
assert.equal(await page.locator('#tools-chips .extension-chip').count(), 4);
await page.fill('#tools-search', 'no-such-connector');
await waitFor(() => /No connectors match that search|No connectors configured yet/.test(document.querySelector('#tools-body')?.textContent ?? ''));
await page.fill('#tools-search', '');
await page.click('#tools-close');
await waitFor(() => document.querySelector('#tools-page')?.hidden === true);

await page.fill('#prompt', '/');
await waitFor(() => {
  const menu = document.querySelector('#command-menu')?.textContent ?? '';
  return !document.querySelector('#command-menu')?.hidden && /\/init/.test(menu) && !/\/check/.test(menu) && !/\/document/.test(menu);
}, 30_000);
await page.keyboard.press('Escape');

console.log('Opening project files and editing through the inspector');
await page.click('#tab-files');
await waitFor(() => document.querySelectorAll('#file-tree .file-row').length > 0);
const fileIcons = await page.evaluate(() => ({
  files: document.querySelectorAll('#file-tree .file-row .file-icon svg').length,
  folders: document.querySelectorAll('#file-tree summary .file-icon svg').length,
  readme: [...document.querySelectorAll('#file-tree .file-row')].find(row => /README\.md/.test(row.textContent ?? ''))?.querySelector('.file-icon text')?.textContent,
  folderOpacity: document.querySelector('#file-tree summary .file-icon:not([hidden]) path')?.getAttribute('fill-opacity'),
}));
assert.ok(fileIcons.files > 0, 'files in the tree have no Material icons');
assert.ok(fileIcons.folders > 1, 'folders in the tree have no Material icons');
assert.equal(fileIcons.readme, 'M↓', 'markdown files should use the markdown icon');
assert.equal(fileIcons.folderOpacity, '.9', 'closed folders should use the closed folder icon');
await page.locator('#file-tree summary', { hasText: 'src' }).first().click();
await waitFor(() => document.querySelector('#file-tree summary .file-icon:not([hidden]) path')?.getAttribute('fill-opacity') === '.55', 20_000);
await page.screenshot({ path: join(artifacts, 'files.png') });
await page.locator('#file-tree .file-row', { hasText: 'README.md' }).click();
await waitFor(() => document.querySelectorAll('#editor-host .monaco-editor').length > 0, 45_000);
await page.locator('#editor-host .monaco-editor .view-lines').click({ position: { x: 40, y: 10 } });
await page.keyboard.press(`${mod}+A`);
await page.keyboard.type('# Relay test project\n\nEdited in Relay.\n');
await waitFor(() => !document.querySelector('#save-file')?.disabled);
await page.click('#save-file');
await waitFor(() => /saved/i.test(document.querySelector('#editor-state')?.textContent ?? ''), 15_000);
assert.match(await readFile(join(project, 'README.md'), 'utf8'), /Edited in Relay\./);

console.log('Reviewing the real diff');
await page.click('#tab-changes');
await page.click('#refresh-files');
await waitFor(() => document.querySelectorAll('#change-list .file-row').length > 0, 20_000);
assert.match(await text('#change-list'), /README\.md/);
assert.ok(await page.locator('#change-list .file-row .file-icon svg').count() > 0, 'changed files are missing their Material icons');
await waitFor(() => document.querySelectorAll('#diff-view .patch-line.added').length > 0, 20_000);
assert.match(await text('#diff-view'), /Edited in Relay\./);
await page.screenshot({ path: join(artifacts, 'diff.png') });

console.log('Reviewing and undoing a change from the change list');
const readmeRow = page.locator('#change-list .change-row', { hasText: 'README.md' });
assert.equal(await readmeRow.locator('.change-action').count(), 2);
assert.equal(await readmeRow.locator('.change-action.undo').count(), 1);
await readmeRow.locator('button', { hasText: 'Review' }).click();
await waitFor(() => document.activeElement?.id === 'diff-view');
assert.match(await text('#diff-path'), /README\.md/);
await readmeRow.locator('button', { hasText: 'Undo' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Undo changes?"]') !== null);
assert.match(await text('dialog[aria-label="Undo changes?"]'), /README\.md/);
await page.locator('dialog[aria-label="Undo changes?"] button', { hasText: 'Undo changes' }).click();
await waitFor(() => /Restored README\.md\./.test(document.querySelector('#notice-text')?.textContent ?? ''), 20_000);
await waitFor(() => !/README\.md/.test(document.querySelector('#change-list')?.textContent ?? ''), 20_000);
assert.doesNotMatch(await readFile(join(project, 'README.md'), 'utf8'), /Edited in Relay\./);

console.log('Streaming a real workspace terminal');
await page.click('#terminal-button');
await waitFor(() => document.querySelector('#terminal-status')?.textContent === 'Local shell', 30_000);
await page.locator('#terminal-host .xterm-helper-textarea').click();
await page.keyboard.type('echo RELAY_DESKTOP_OK');
await page.keyboard.press('Enter');
await waitFor(() => document.querySelector('#terminal-host')?.textContent?.includes('RELAY_DESKTOP_OK'), 20_000);
await page.screenshot({ path: join(artifacts, 'terminal.png') });

console.log('Opening the command palette and switching appearance');
await page.click('#palette-button');
await waitFor(() => document.querySelector('dialog[aria-label="Search tasks and commands"]') !== null);
assert.match(await text('dialog[aria-label="Search tasks and commands"]'), /New task/);
assert.match(await text('dialog[aria-label="Search tasks and commands"]'), /Open terminal/);
await page.keyboard.press('Escape');
await page.click('#settings-button');
await waitFor(() => document.querySelector('dialog[aria-label="Settings"]') !== null);
const settings = page.locator('dialog[aria-label="Settings"]');
assert.match(await settings.locator('.settings-pane').textContent(), /Input while running/);
assert.match(await settings.locator('.settings-pane').textContent(), /Turn completion notifications/);
assert.equal(await settings.locator('.settings-nav-item').count(), 7);
await settings.getByRole('tab', { name: 'Appearance' }).click();
await settings.locator('.theme-card.light').click();
await waitFor(() => document.documentElement.dataset.theme === 'light');
await page.screenshot({ path: join(artifacts, 'light.png') });
await settings.getByRole('tab', { name: 'Context & usage' }).click();
assert.match(await settings.locator('.settings-pane').textContent(), /Auto-compact long conversations/);
await settings.locator('button[aria-label="Close dialog"]').click();

console.log('Searching file contents and previewing a diff on focus');
await page.click('#conversation');
await page.keyboard.press(`${mod}+f`);
await waitFor(() => document.querySelector('dialog[aria-label="Search in files"]') !== null);
await page.fill('dialog[aria-label="Search in files"] input[type="search"]', 'greeting');
await waitFor(() => /src\/app\.ts/.test(document.querySelector('dialog[aria-label="Search in files"]')?.textContent ?? ''), 20_000);
await page.locator('dialog[aria-label="Search in files"] .search-result').first().click();
await waitFor(() => (document.querySelector('#editor-path')?.textContent ?? '').includes('app.ts'), 30_000);
await page.click('#tab-changes');
await writeFile(join(project, 'src', 'app.ts'), 'export const greeting = "hello from Relay";\n');
await writeFile(join(project, 'notes.md'), 'temporary notes\n');
await page.click('#refresh-files');
await waitFor(() => document.querySelectorAll('#change-list .file-row').length >= 2, 20_000);
assert.match(await text('#change-list'), /app\.ts/);
await page.locator('#change-list .file-row', { hasText: 'app.ts' }).click();
await waitFor(() => /app\.ts/.test(document.querySelector('#diff-path')?.textContent ?? ''), 20_000);
await page.locator('#change-list .file-row', { hasText: 'notes.md' }).hover();
await waitFor(() => !document.querySelector('#diff-peek')?.hidden, 10_000);
assert.match(await text('#diff-peek'), /temporary notes/);
await page.screenshot({ path: join(artifacts, 'diff-peek.png') });

console.log('Removing a brand-new file through Undo');
await page.locator('#change-list .change-row', { hasText: 'notes.md' }).locator('button', { hasText: 'Undo' }).click();
await waitFor(() => document.querySelector('dialog[aria-label="Undo changes?"]') !== null);
await page.locator('dialog[aria-label="Undo changes?"] button', { hasText: 'Undo changes' }).click();
await waitFor(() => /Removed notes\.md\./.test(document.querySelector('#notice-text')?.textContent ?? ''), 20_000);
await assert.rejects(readFile(join(project, 'notes.md'), 'utf8'));

console.log('Opening a live page in the embedded browser');
await page.click('#tab-browser');
await page.fill('#browser-url', `${previewURL}/page`);
await page.press('#browser-url', 'Enter');
await waitFor(() => /Relay Preview/.test(document.querySelector('#browser-status')?.textContent ?? ''), 20_000);
assert.match(await page.evaluate(() => document.querySelector('#browser-stage webview')?.getAttribute('src') ?? ''), /\/page$/);
await page.screenshot({ path: join(artifacts, 'browser.png') });

console.log('Creating an automation from the prompt scheduler');
await page.click('#automation-button');
await waitFor(() => document.querySelector('dialog[aria-label="Create automation"]') !== null);
const automation = page.locator('dialog[aria-label="Create automation"]');
await automation.getByLabel('Objective').waitFor();
await automation.getByLabel('Context').waitFor();
await automation.getByLabel('Steps').waitFor();
assert.equal(await automation.getByLabel('Objective').isVisible(), true);
assert.equal(await automation.getByLabel('Page address').isVisible(), false);
assert.equal(await automation.getByLabel('Execution location').locator('option[value="cloud"]').evaluate(option => option.disabled), true);
assert.notEqual(await automation.getByLabel('Time zone', { exact: true }).inputValue(), '');
assert.equal(await automation.getByLabel('Expiration').isVisible(), true);
await automation.getByLabel('Action').selectOption('page');
assert.equal(await automation.getByLabel('Objective').isVisible(), false);
await automation.getByLabel('Name').fill('Preview check');
await automation.getByLabel('Page address').fill(`${previewURL}/dashboard`);
await automation.locator('button', { hasText: 'Create automation' }).click();
await waitFor(() => /Preview check/.test(document.querySelector('dialog[aria-label="Create automation"]')?.textContent ?? ''), 20_000);
assert.match(await text('.automation-row'), /Opens 127\.0\.0\.1/);
await automation.locator('.automation-row', { hasText: 'Preview check' }).locator('button', { hasText: 'Run now' }).click();
await waitFor(() => /Completed/.test(document.querySelector('.automation-run')?.textContent ?? ''), 20_000);
assert.match(await text('.automation-run'), /Completed/);
await page.screenshot({ path: join(artifacts, 'automation.png') });
await page.locator('dialog[aria-label="Create automation"] button[aria-label="Close dialog"]').click();

console.log('Recording and transcribing a voice dictation');
await page.fill('#prompt', '');
await page.click('#dictate');
await waitFor(() => document.querySelector('#dictate')?.getAttribute('aria-pressed') === 'true', 20_000);
await page.waitForTimeout(1_200);
await page.click('#dictate');
await waitFor(() => (document.querySelector('#prompt')?.value ?? '').includes('Dictated relay message.'), 30_000);
assert.equal(recordings.length, 1);
assert.ok(recordings[0].size > 1_000, 'recording payload was too small');
assert.match(recordings[0].contentType, /multipart\/form-data/);
await page.screenshot({ path: join(artifacts, 'dictation.png') });
await page.fill('#prompt', '');

console.log('Restarting to verify task persistence');
await app.close();
await launch();
await waitFor(() => document.querySelector('#engine-status')?.textContent?.startsWith('Engine ready'));
await waitFor(() => document.querySelectorAll('#task-list .task-button').length === 3, 20_000);
assert.match(await text('#task-list'), /New task/);
const persistedTask = page.locator(`#task-list .task-button[data-session="${likedSession}"]`);
await persistedTask.waitFor({ timeout: 20_000 });
await persistedTask.click();
await waitFor(() => document.querySelector('article.assistant-message button[aria-label="Like response"]')?.getAttribute('aria-pressed') === 'true', 20_000);

console.log('Listing tasks from a previous project folder under that folder');
await page.evaluate(() => document.querySelector('#close-terminal')?.click());
await waitFor(() => document.querySelector('#terminal')?.hidden === true);
await page.click('#workspace-button');
await waitFor(() => document.querySelector('dialog[aria-label="Local projects"]') !== null);
await page.locator('dialog[aria-label="Local projects"] .palette-option', { hasText: basename(pastProject) }).click();
await page.waitForFunction(path => (document.querySelector('#workspace-path')?.textContent ?? '') === path, pastProjectPath, { timeout: 90_000 });
await waitFor(() => !document.querySelector('#new-task')?.disabled, 90_000);
await page.click('#new-task');
await waitFor(() => (document.querySelector('#task-title')?.textContent ?? '') === 'New task', 30_000);
await waitFor(() => document.querySelectorAll('#task-list .task-group').length === 2, 60_000);
assert.equal(await page.locator('#task-list .task-group-name').first().textContent(), basename(pastProject));
assert.equal(await page.locator('#task-list .task-group.current .task-button').count(), 1);

await page.click('#workspace-button');
await waitFor(() => document.querySelector('dialog[aria-label="Local projects"]') !== null);
await page.locator('dialog[aria-label="Local projects"] .palette-option', { hasText: basename(project) }).click();
await page.waitForFunction(path => (document.querySelector('#workspace-path')?.textContent ?? '') === path, projectPath, { timeout: 90_000 });
await waitFor(() => document.querySelectorAll('#task-list .task-group').length === 2, 60_000);
const groupNames = await page.evaluate(() => [...document.querySelectorAll('#task-list .task-group-name')].map(node => node.textContent));
assert.deepEqual(groupNames, [basename(project), basename(pastProject)]);
const projectGroup = page.locator('#task-list .task-group').nth(0);
const pastGroup = page.locator('#task-list .task-group').nth(1);
assert.equal(await projectGroup.locator('.task-button').count(), 3);
assert.equal(await pastGroup.locator('.task-button').count(), 1);
assert.match(await pastGroup.locator('.task-button .task-name').textContent(), /New task/);
await pastGroup.locator('.task-group-toggle').click();
await waitFor(() => document.querySelectorAll('#task-list .task-group')[1]?.querySelector('.task-group-body')?.classList.contains('collapsed') === true);
assert.equal(await pastGroup.locator('.task-group-toggle').getAttribute('aria-expanded'), 'false');
await page.screenshot({ path: join(artifacts, 'folders.png') });
await pastGroup.locator('.task-group-toggle').click();
await waitFor(() => document.querySelectorAll('#task-list .task-group')[1]?.querySelector('.task-group-body')?.classList.contains('collapsed') === false);
assert.equal(await pastGroup.locator('.task-group-toggle').getAttribute('aria-expanded'), 'true');

console.log('Opening a task from a previous folder switches projects');
await pastGroup.locator('.task-button').click();
await page.waitForFunction(path => (document.querySelector('#workspace-path')?.textContent ?? '') === path, pastProjectPath, { timeout: 90_000 });
await waitFor(() => (document.querySelector('#task-title')?.textContent ?? '') === 'New task', 30_000);
await waitFor(() => document.querySelectorAll('#task-list .task-group').length === 2, 60_000);
assert.equal(await page.locator('#task-list .task-group-name').first().textContent(), basename(pastProject));
assert.match(await text('#task-list .task-group.current .task-button.active .task-name'), /New task/);
await app.close();

console.log('Verifying unreadable credentials surface as an engine error');
const storedSettings = JSON.parse(await readFile(join(settingsDir, 'settings.json'), 'utf8'));
storedSettings.providers = [{ id: 'openai', encryptedKey: 'v0:not-readable' }];
await writeFile(join(settingsDir, 'settings.json'), JSON.stringify(storedSettings, null, 2));
await launch();
await waitFor(() => /Engine error/.test(document.querySelector('#engine-status')?.textContent ?? ''), 20_000);
assert.match(await text('#engine-status'), /unsupported format/i);
await app.close();

assert.deepEqual(errors, [], `Renderer errors:\n${errors.join('\n')}`);
console.log('Desktop verification passed');
await new Promise((resolve) => preview.close(resolve));
await rm(data, { recursive: true, force: true });
await rm(project, { recursive: true, force: true });
