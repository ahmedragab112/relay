import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const packaged = process.env.RELAY_EXECUTABLE;
const data = await mkdtemp(join(tmpdir(), 'relay-motion-data-'));
const project = await mkdtemp(join(tmpdir(), 'relay-motion-project-'));
const workspaceId = (path) => createHash('sha256').update(path).digest('hex').slice(0, 20);
await writeFile(join(project, 'README.md'), '# Motion smoke project\n');
const settingsDir = join(data, 'relay', 'settings');
await mkdir(settingsDir, { recursive: true });
await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
  version: 1,
  preferences: { theme: 'dark', activeWorkspaceId: workspaceId(project) },
  workspaces: [{ id: workspaceId(project), path: project, name: basename(project), lastOpened: Date.now() }],
  providers: [],
  mcp: [],
}, null, 2));

const errors = [];
const app = packaged
  ? await electron.launch({ executablePath: packaged, args: [`--user-data-dir=${data}`] })
  : await electron.launch({ args: ['.', `--user-data-dir=${data}`], cwd: root, env: process.env });
const page = await app.firstWindow();
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

const text = async (selector) => (await page.locator(selector).textContent()) ?? '';
const waitFor = (expression, timeout = 30_000) => page.waitForFunction(expression, undefined, { timeout });

await page.waitForSelector('#engine-status');
await waitFor(() => document.querySelector('#engine-status')?.textContent?.startsWith('Engine ready'), 90_000);
await waitFor(() => document.querySelector('#design-button')?.disabled === false, 30_000);
console.log('engine ready, workspace active');

await page.click('#design-button');
await page.click('#design-tile-motion');
await waitFor(() => document.querySelector('#motion')?.hidden === false);
assert.match(await text('#motion-items'), /No motion yet/);
console.log('motion home shows the empty state');

await page.click('#motion-new');
await page.fill('dialog[aria-label="New motion"] input', 'Smoke Test');
await page.click('dialog[aria-label="New motion"] button[type="submit"]');
await waitFor(() => document.querySelector('#motion-workspace')?.hidden === false, 20_000);
await waitFor(() => /saved/.test(document.querySelector('#motion-summary')?.textContent ?? ''), 20_000);
assert.match(await text('#motion-summary'), /9:16/);
console.log('motion created in portrait');

await waitFor(() => {
  const clock = document.querySelector('#motion-time')?.textContent ?? '';
  return /^0:00\.0 \/ 0:0[1-9]\.\d$/.test(clock);
}, 30_000);
const initialClock = await text('#motion-time');
assert.equal(initialClock.startsWith('0:00.0 /'), true);
console.log('stage reported its duration:', initialClock);

await page.click('#motion-play');
await waitFor(() => {
  const [minutes, rest] = (document.querySelector('#motion-time')?.textContent ?? '0:00.0 /').split(' / ')[0].split(':');
  return Number(minutes) * 60 + Number(rest) >= 2;
}, 20_000);
await page.click('#motion-play');
await page.evaluate(() => {
  const scrub = document.querySelector('#motion-scrub');
  scrub.value = '500';
  scrub.dispatchEvent(new Event('input', { bubbles: true }));
  scrub.dispatchEvent(new Event('change', { bubbles: true }));
});
await waitFor(() => /^0:03\.\d \//.test(document.querySelector('#motion-time')?.textContent ?? ''), 10_000);
assert.equal((await text('#motion-time')).split(' / ')[0].startsWith('0:03.'), true);
assert.equal(await page.locator('#motion-loop').getAttribute('aria-pressed'), 'false');
await page.click('#motion-loop');
assert.equal(await page.locator('#motion-loop').getAttribute('aria-pressed'), 'true');
console.log('play, pause and scrub follow the timeline');

const portraitBox = await page.locator('#motion-stage-preview').boundingBox();
assert.ok(portraitBox && portraitBox.height > portraitBox.width, 'portrait stage is taller than wide');
await page.click('#motion-stage-landscape');
await waitFor(() => /16:9/.test(document.querySelector('#motion-summary')?.textContent ?? ''), 20_000);
await waitFor(() => {
  const box = document.querySelector('#motion-stage-preview')?.getBoundingClientRect();
  return box && box.width > box.height;
}, 20_000);
const landscapeBox = await page.locator('#motion-stage-preview').boundingBox();
assert.ok(landscapeBox && landscapeBox.width > landscapeBox.height, 'landscape stage is wider than tall');
console.log('stage switches between portrait and landscape');

await page.click('#motion-save-version');
await waitFor(() => document.querySelectorAll('#motion-versions option').length === 3, 15_000);
console.log('versions list current plus two saved states');

await page.click('#motion-model');
await waitFor(() => document.querySelector('#motion-model-menu')?.hidden === false, 10_000);
assert.match(await text('#motion-model-menu'), /Auto/);
await page.keyboard.press('Escape');
await waitFor(() => document.querySelector('#motion-model-menu')?.hidden === true, 10_000);
console.log('per-motion model menu opens and closes');

await waitFor(() => [...document.querySelectorAll('#task-list .task-name')].some((node) => node.textContent === 'Smoke test'), 30_000);
assert.ok(await page.evaluate(() => [...document.querySelectorAll('#task-list .task-name')].some((node) => node.textContent === 'Smoke test' && node.querySelector('svg'))), 'motion task carries its glyph');

await page.click('#motion-export');
await waitFor(() => /Exporting \d+%/.test(document.querySelector('#motion-export')?.textContent ?? '') || /Exported /.test(document.querySelector('#notice-text')?.textContent ?? ''), 60_000);
await waitFor(() => /Exported /.test(document.querySelector('#notice-text')?.textContent ?? ''), 240_000);
const notice = await text('#notice-text');
assert.match(notice, /Exported smoke-test-\d{8}-\d{6}\.mp4/);
await waitFor(() => document.querySelector('#motion-export')?.textContent === 'Export MP4', 15_000);

const exportsDir = join(project, '.relay', 'motion', 'smoke-test', 'exports');
const files = (await readdir(exportsDir)).filter((name) => name.endsWith('.mp4'));
assert.equal(files.length, 1);
const mp4 = join(exportsDir, files[0]);
const info = await stat(mp4);
assert.ok(info.size > 20_000, `mp4 is only ${info.size} bytes`);
const head = await readFile(mp4);
assert.equal(head.subarray(4, 8).toString('latin1'), 'ftyp');
console.log(`export wrote ${files[0]} (${Math.round(info.size / 1024)} KB)`);

await page.screenshot({ path: join(project, 'motion.png') });
assert.deepEqual(errors, []);
await app.close();
console.log('motion smoke passed');
