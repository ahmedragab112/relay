import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine } from '../src/main/engine.js';
import type { AppEvent } from '../src/shared/contracts.js';

async function waitFor<T>(check: () => Promise<T | undefined>, timeout = 30_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('Timed out waiting for the live engine');
}

test('live chat sends a prompt, receives a streamed reply and attaches a skill', { timeout: 180_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-live-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  await writeFile(join(workspace, 'README.md'), '# Live test\n');
  const events: AppEvent[] = [];
  const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), (event) => events.push(event));
  try {
    await engine.start(workspace, [], []);
    const skills = await waitFor(async () => {
      const found = await engine.listSkills();
      return found.length ? found : undefined;
    });
    assert.ok(skills.some((skill) => skill.id === 'opencode'), 'the built-in OpenCode skill is listed');
    const model = (await engine.listModels()).find((option) => option.connected && option.id.endsWith('-free'));
    assert.ok(model, 'a connected free model is available for the live test');
    const session = await engine.createSession('Live send test');
    await engine.sendMessage({
      sessionId: session.id,
      text: 'Reply with exactly RELAY_OK and nothing else. Do not use any tools.',
      model: model.id,
      variant: '',
      access: 'ask',
      files: [],
      skills: ['opencode'],
    });
    const messages = await waitFor(async () => {
      const current = await engine.getMessages(session.id);
      const assistant = current.filter((message) => message.role === 'assistant');
      return assistant.length ? current : undefined;
    }, 120_000);
    const assistant = messages.filter((message) => message.role === 'assistant');
    const reply = assistant.flatMap((message) => message.parts).map((part) => part.type === 'text' ? part.text : '').join('');
    assert.match(reply, /RELAY_OK/);
    assert.equal(messages[0].role, 'user');
    assert.ok(events.some((event) => event.type === 'session-changed' && event.sessionId === session.id), 'reply events reached the app');
    const raw = await engine.client.message.list({ sessionID: session.id, limit: 200, order: 'asc' });
    const user = raw.data.find((message) => message.type === 'user');
    assert.ok(user && 'skills' in user && user.skills?.some((skill) => skill.id === 'opencode'), 'the selected skill was attached to the prompt');
  } finally {
    await engine.stop();
    await rm(root, { recursive: true, force: true });
  }
});
