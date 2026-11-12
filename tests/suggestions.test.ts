import test from 'node:test';
import assert from 'node:assert/strict';
import { followUpSuggestions } from '../src/renderer/suggestions.js';
import type { ToolPart } from '../src/shared/contracts.js';

const tool = (name: string, state: ToolPart['state'] = 'completed'): ToolPart => ({
  type: 'tool', id: `${name}-${state}`, name, state, input: '', output: '',
});

test('file edits suggest reviewing and testing the work', () => {
  const suggestions = followUpSuggestions({
    userText: 'Add a save button to the composer.',
    replyText: 'Updated the composer and saved the change.',
    tools: [tool('edit')],
  });
  assert.ok(suggestions.includes('Review the changes and flag anything risky.'));
  assert.ok(suggestions.includes('Run the tests and fix any failures.'));
  assert.ok(suggestions.length <= 3);
});

test('a failed step is suggested first', () => {
  const suggestions = followUpSuggestions({
    userText: 'Build the app.',
    replyText: 'The build failed on the type check.',
    tools: [tool('bash', 'error')],
  });
  assert.equal(suggestions[0], 'Investigate the failed step and fix it.');
});

test('an explanation request offers a concrete deeper answer', () => {
  const suggestions = followUpSuggestions({
    userText: 'Explain how the engine starts.',
    replyText: 'The engine starts a local server and waits for it to become ready.',
    tools: [],
  });
  assert.equal(suggestions[0], 'Go deeper with a concrete example.');
  assert.ok(suggestions.length >= 2);
});

test('suggestions are unique, bounded, and never empty', () => {
  const suggestions = followUpSuggestions({
    userText: 'Why did this fail?',
    replyText: 'The command failed. Should I retry with a longer timeout?',
    tools: [tool('bash', 'error'), tool('edit'), tool('read'), tool('grep')],
  });
  assert.equal(new Set(suggestions).size, suggestions.length);
  assert.ok(suggestions.length >= 2 && suggestions.length <= 3);
  assert.ok(suggestions.every(value => value.trim().length > 0 && value.endsWith('.')));
});
