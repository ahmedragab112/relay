import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MOTION_RUNTIME_ID } from '../src/shared/motion.js';
import { Motions, motionSessionIds, type MotionProject } from '../src/main/motion.js';
import type { SendMessageInput } from '../src/shared/contracts.js';

async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'relay-motion-'));
  const project: MotionProject = { id: 'p1', name: 'Shop', path };
  const calls: SendMessageInput[] = [];
  const sessions: string[] = [];
  const shown: string[] = [];
  const deleted: string[] = [];
  const motions = new Motions({
    project: () => project,
    engine: () => ({
      createSession: async (title) => { const id = `s${sessions.length + 1}`; sessions.push(title); return { id }; },
      sendMessage: async (input) => { calls.push(input); },
      abortSession: async () => undefined,
      deleteSession: async (id) => { deleted.push(id); },
    }),
    model: () => ({ model: 'test/model', auto: false }),
    access: () => 'ask',
    emit: () => undefined,
    sessionsChanged: () => undefined,
    show: (id) => shown.push(id),
  });
  return { path, project, motions, calls, sessions, shown, deleted, done: () => rm(path, { recursive: true, force: true }) };
}

test('a new motion starts with a playable deterministic scene, version 1 and its own task', async () => {
  const world = await workspace();
  try {
    const view = await world.motions.create('Launch Teaser');
    assert.equal(view.motions.length, 1);
    assert.equal(view.motions[0].slug, 'launch-teaser');
    assert.equal(view.motions[0].title, 'Launch teaser');
    assert.equal(view.motions[0].versions, 1);
    assert.equal(view.motions[0].sessionId, 's1');
    assert.equal(view.motions[0].stage, 'portrait');
    assert.deepEqual(world.sessions, ['Motion · Launch teaser']);
    const html = await readFile(join(world.path, '.relay/motion/launch-teaser/index.html'), 'utf8');
    assert.ok(html.includes('window.motionScene'));
    assert.match(html, /duration:\s*6/);
    assert.ok(html.includes('update'));
    assert.ok(!html.includes('requestAnimationFrame'));
    assert.deepEqual(world.shown, ['s1']);
    assert.equal((await world.motions.versions('launch-teaser')).length, 1);
  } finally { await world.done(); }
});

test('a motion turn carries Motion.md, the stage and the scene contract, and reuses the task', async () => {
  const world = await workspace();
  try {
    await world.motions.create('Launch Teaser');
    const first = await world.motions.send('launch-teaser', 'A stamp hitting paper');
    const second = await world.motions.send('launch-teaser', 'Hold the last frame longer');
    assert.equal(first.sessionId, 's1');
    assert.equal(second.sessionId, 's1');
    assert.deepEqual(world.sessions, ['Motion · Launch teaser']);
    assert.match(world.calls[0].text, /Motion\.md/);
    assert.match(world.calls[0].text, /window\.motionScene/);
    assert.match(world.calls[0].text, /1080x1920/);
    assert.equal(world.calls[0].access, 'full');
    assert.match(world.calls[1].text, /Revise the existing motion/);
    assert.match(world.calls[1].text, /index\.html/);
  } finally { await world.done(); }
});

test('switching the stage changes the authored aspect ratio', async () => {
  const world = await workspace();
  try {
    await world.motions.create('Launch Teaser');
    const view = await world.motions.setStage('launch-teaser', 'landscape');
    assert.equal(view.motions[0].stage, 'landscape');
    await world.motions.send('launch-teaser', 'A product film');
    assert.match(world.calls[0].text, /1920x1080/);
    assert.equal(await world.motions.stage('launch-teaser'), 'landscape');
  } finally { await world.done(); }
});

test('a chosen model is stored per motion and drives its turns', async () => {
  const world = await workspace();
  try {
    await world.motions.create('Launch Teaser');
    await world.motions.setModel('launch-teaser', 'live/precise');
    await world.motions.send('launch-teaser', 'Start');
    assert.equal(world.calls.at(-1)?.model, 'live/precise');
    assert.equal(world.calls.at(-1)?.auto, undefined);
    await world.motions.setModel('launch-teaser', '');
    await world.motions.send('launch-teaser', 'Again');
    assert.equal(world.calls.at(-1)?.model, 'test/model');
  } finally { await world.done(); }
});

test('a finished scene turn becomes a version that can be restored', async () => {
  const world = await workspace();
  try {
    await world.motions.create('Launch Teaser');
    await world.motions.send('launch-teaser', 'A stamp');
    await writeFile(join(world.path, '.relay/motion/launch-teaser/scene.js'), 'window.motionScene={duration:4,update(){}}');
    await world.motions.noteIdle('s1');
    const versions = await world.motions.versions('launch-teaser');
    assert.deepEqual(versions.map((entry) => entry.version), [2, 1]);
    await world.motions.restore('launch-teaser', 1);
    const scene = await readFile(join(world.path, '.relay/motion/launch-teaser/index.html'), 'utf8');
    assert.ok(scene.includes('window.motionScene'));
  } finally { await world.done(); }
});

test('previews carry the seekable player and only serve this motion', async () => {
  const world = await workspace();
  try {
    await world.motions.create('Launch Teaser');
    const page = await world.motions.preview('relay-motion://preview/launch-teaser/index.html');
    assert.ok(page);
    assert.equal(page.type, 'text/html; charset=utf-8');
    assert.ok(String(page.body).includes(MOTION_RUNTIME_ID));
    assert.equal(await world.motions.preview('relay-motion://preview/other/index.html'), undefined);
    assert.equal(await world.motions.preview('https://example.com/index.html'), undefined);
  } finally { await world.done(); }
});

test('each motion maps back from its task, and deleting removes folder and task', async () => {
  const world = await workspace();
  try {
    await world.motions.create('Launch Teaser');
    await world.motions.create('Logo Sting');
    assert.equal(await world.motions.slugForSession('s2'), 'logo-sting');
    assert.equal(await world.motions.slugForSession('missing'), undefined);
    await world.motions.remove('launch-teaser');
    assert.deepEqual(world.deleted, ['s1']);
    assert.equal(await world.motions.slugForSession('s1'), undefined);
    await assert.rejects(stat(join(world.path, '.relay/motion/launch-teaser')), /ENOENT/);
    assert.deepEqual(await motionSessionIds(world.path), ['s2']);
  } finally { await world.done(); }
});
