import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AtlasRunner, type AtlasEngine, type AtlasProject } from '../src/main/atlas.js';
import type { ChatMessage } from '../src/shared/contracts.js';

const say = (role: ChatMessage['role'], text: string): ChatMessage => ({
  id: `${role}-1`, role, createdAt: 1, parts: [{ type: 'text', id: `${role}-part`, text }],
});

async function project(): Promise<AtlasProject> {
  return { id: 'p1', name: 'Sample', path: await mkdtemp(join(tmpdir(), 'relay-atlas-')) };
}

function engine(messages: ChatMessage[]): { api: AtlasEngine; sent: { text: string } } {
  const sent = { text: '' };
  const api: AtlasEngine = {
    createSession: async () => ({ id: 'ses_atlas' }),
    sendMessage: async (input) => { sent.text = input.text; },
    waitForIdle: async () => undefined,
    abortSession: async () => undefined,
    getMessages: async () => messages,
  };
  return { api, sent };
}

function runner(api: AtlasEngine, target: AtlasProject, hidden: string[] = []): AtlasRunner {
  return new AtlasRunner({
    project: () => target,
    engine: () => api,
    model: () => ({ model: 'test-model', auto: false }),
    emit: () => undefined,
    sessionsChanged: () => undefined,
    hidden: (sessionId) => { hidden.push(sessionId); },
  });
}

/** A fake agent that writes a page plan and one page per entry, like a successful run. */
function writer(target: AtlasProject, pages: { slug: string; title: string }[]): AtlasEngine {
  return {
    createSession: async () => ({ id: 'ses_atlas' }),
    sendMessage: async () => {
      const dir = join(target.path, '.relay', 'atlas', 'en');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'plan.json'), JSON.stringify({ pages }));
      for (const page of pages) await writeFile(join(dir, `${page.slug}.md`), `# ${page.title}\n\nBody.`);
    },
    waitForIdle: async () => undefined,
    abortSession: async () => undefined,
    getMessages: async () => [],
  };
}

test('a task target appends its conversation as Atlas context', async () => {
  const target = await project();
  const { api, sent } = engine([say('user', 'Explain how the composer sends messages')]);
  try {
    // The fake agent writes no page plan, so the run fails after the prompt is sent.
    await assert.rejects(runner(api, target).generate('en', 'ses_task'), /page plan/i);
    assert.match(sent.text, /Task context/);
    assert.match(sent.text, /User: Explain how the composer sends messages/);
    assert.match(sent.text, /do not echo it into pages/);
  } finally { await rm(target.path, { recursive: true, force: true }); }
});

test('a folder target builds without a task transcript', async () => {
  const target = await project();
  const { api, sent } = engine([say('user', 'This should not be read')]);
  try {
    await assert.rejects(runner(api, target).generate('en'), /page plan/i);
    assert.doesNotMatch(sent.text, /Task context/);
    assert.doesNotMatch(sent.text, /This should not be read/);
  } finally { await rm(target.path, { recursive: true, force: true }); }
});

test('an Atlas run hides its session from the task lists', async () => {
  const target = await project();
  const { api } = engine([]);
  const hidden: string[] = [];
  try {
    await assert.rejects(runner(api, target, hidden).generate('en'), /page plan/i);
    assert.deepEqual(hidden, ['ses_atlas']);
  } finally { await rm(target.path, { recursive: true, force: true }); }
});

test('the manifest records the task a build came from', async () => {
  const target = await project();
  try {
    const view = await runner(writer(target, [{ slug: 'overview', title: 'Overview' }]), target).generate('en', 'ses_task', 'Fix login');
    assert.deepEqual(view.manifest?.source, { kind: 'task', title: 'Fix login' });
    const saved = JSON.parse(await readFile(join(target.path, '.relay', 'atlas', 'en', 'manifest.json'), 'utf8')) as { source?: unknown };
    assert.deepEqual(saved.source, { kind: 'task', title: 'Fix login' });
  } finally { await rm(target.path, { recursive: true, force: true }); }
});

test('a project-wide build records the project as its source', async () => {
  const target = await project();
  try {
    const view = await runner(writer(target, [{ slug: 'overview', title: 'Overview' }]), target).generate('en');
    assert.deepEqual(view.manifest?.source, { kind: 'project' });
  } finally { await rm(target.path, { recursive: true, force: true }); }
});
