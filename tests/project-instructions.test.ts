import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectInstructions, PROJECT_INSTRUCTION_FILES } from '../src/main/context.js';

async function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'relay-instructions-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('returns nothing when no instructions file exists', async () => {
  await withRoot(async root => {
    assert.equal(await loadProjectInstructions(root), undefined);
  });
});

test('reads RELAY.md with its label', async () => {
  await withRoot(async root => {
    await writeFile(join(root, 'RELAY.md'), 'Use pnpm, never npm.\n');
    const result = await loadProjectInstructions(root);
    assert.equal(result?.label, 'RELAY.md');
    assert.match(result?.text ?? '', /pnpm/);
  });
});

test('AGENTS.md is used only when RELAY.md is absent', async () => {
  await withRoot(async root => {
    await writeFile(join(root, 'AGENTS.md'), 'Agency rules here.\n');
    const result = await loadProjectInstructions(root);
    assert.equal(result?.label, 'AGENTS.md');
  });
});

test('given both, RELAY.md wins', async () => {
  await withRoot(async root => {
    await writeFile(join(root, 'RELAY.md'), 'relay wins\n');
    await writeFile(join(root, 'AGENTS.md'), 'agents loses\n');
    assert.equal((await loadProjectInstructions(root))?.label, 'RELAY.md');
  });
});

test('caps very large instruction files', async () => {
  await withRoot(async root => {
    await writeFile(join(root, 'CLAUDE.md'), 'x'.repeat(64 * 1024));
    const result = await loadProjectInstructions(root);
    assert.ok(result && result.text.length <= 17_000, `instruction text exceeded cap: ${result?.text.length}`);
  });
});

test('exports the expected filename order', () => {
  assert.deepEqual([...PROJECT_INSTRUCTION_FILES], ['RELAY.md', 'AGENTS.md', 'CLAUDE.md', '.relay.md']);
});