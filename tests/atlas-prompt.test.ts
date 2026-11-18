import test from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_CONTEXT_LIMIT, atlasPrompt, atlasTaskContext } from '../src/shared/atlas.js';

test('atlasPrompt carries the targeted task conversation as context', () => {
  const prompt = atlasPrompt({
    projectName: 'Relay',
    language: 'en',
    context: 'User: Add the composer chip\nAssistant: Wired it in composer.ts.',
  });
  assert.match(prompt, /Task context/);
  assert.match(prompt, /Wired it in composer\.ts\./);
});

test('atlasPrompt omits the task context section when there is none', () => {
  const prompt = atlasPrompt({ projectName: 'Relay', language: 'en' });
  assert.doesNotMatch(prompt, /Task context/);
});

test('atlasTaskContext keeps the latest text parts with role labels', () => {
  const context = atlasTaskContext([
    { role: 'user', parts: [{ type: 'text', text: '  Add a project picker.  ' }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'Done.' }, { type: 'tool', text: 'ignored' }] },
    { role: 'system', parts: [{ type: 'text', text: 'ignored' }] },
  ]);
  assert.equal(context, 'User: Add a project picker.\nAssistant: Done.');
});

test('atlasTaskContext drops messages beyond the character budget', () => {
  const context = atlasTaskContext([
    { role: 'user', parts: [{ type: 'text', text: 'old '.repeat(2_000) }] },
    { role: 'assistant', parts: [{ type: 'text', text: 'Recent answer.' }] },
  ]);
  assert.ok(context.length <= ATLAS_CONTEXT_LIMIT);
  assert.match(context, /Recent answer\.$/);
  assert.doesNotMatch(context, /^User: old old old/);
});

test('atlasTaskContext returns nothing for messages without text', () => {
  assert.equal(atlasTaskContext([
    { role: 'user', parts: [{ type: 'tool', text: 'ignored' }] },
  ]), '');
});
