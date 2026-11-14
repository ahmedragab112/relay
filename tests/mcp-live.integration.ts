import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine } from '../src/main/engine.js';
import type { AppEvent } from '../src/shared/contracts.js';

// Proves a connector saved the way Relay saves it is actually connected by the
// engine — a working one reaches `connected`, a broken one reports `failed`
// with the real error, and a failed one can be retried.

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for connector status');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test('real engine connects a saved filesystem connector and reports a broken one as failed', { timeout: 150_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-mcp-live-'));
  const workspace = join(root, 'project');
  await mkdir(workspace);
  await writeFile(join(workspace, 'note.txt'), 'hello');
  const events: AppEvent[] = [];
  const engine = new Engine(join(root, 'engine'), resolve('node_modules/@opencode/cli/bin/opencode.exe'), (event) => events.push(event));
  try {
    await engine.start(workspace, [], [
      { name: 'Filesystem', type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '.'], enabled: true },
      { name: 'Broken', type: 'local', command: ['definitely-not-a-real-binary-9x7'], enabled: true },
    ]);
    assert.equal(engine.status.state, 'ready');

    // The engine connects config-file connectors on its own a few seconds after boot.
    await waitFor(async () => {
      const statuses = await engine.mcpStatuses();
      return statuses.some((entry) => entry.name === 'Filesystem' && entry.status === 'connected')
        && statuses.some((entry) => entry.name === 'Broken' && entry.status === 'failed');
    });
    const statuses = await engine.mcpStatuses();
    const filesystem = statuses.find((entry) => entry.name === 'Filesystem');
    const broken = statuses.find((entry) => entry.name === 'Broken');
    assert.equal(filesystem?.status, 'connected');
    assert.equal(broken?.status, 'failed');
    assert.ok(broken?.error && broken.error.length > 0, 'a failed connector surfaces a real error message');

    // Retrying a failed connector reports again instead of pretending.
    const retried = await engine.connectMcp('Broken');
    assert.equal(retried.find((entry) => entry.name === 'Broken')?.status, 'failed');
  } finally {
    await engine.stop();
    await rm(root, { recursive: true, force: true });
  }
});
