import test from 'node:test';
import assert from 'node:assert/strict';
import { stepperSummary, rememberExpansion } from '../src/renderer/tool-stepper.js';
import type { ToolPart } from '../src/shared/contracts.js';

const tool = (name: string, state: ToolPart['state']): ToolPart => ({
  type: 'tool', id: `${name}-${state}`, name, state, input: '', output: '',
});

test('completed steps summarize their count and tools', () => {
  assert.deepEqual(stepperSummary([tool('read', 'completed'), tool('edit', 'completed')]), {
    state: 'completed', label: '2 steps completed', detail: 'read · edit',
  });
});

test('a running step keeps the whole stepper active', () => {
  assert.deepEqual(stepperSummary([tool('read', 'completed'), tool('bash', 'running')]), {
    state: 'running', label: '2 steps in progress', detail: 'read · bash',
  });
});

test('an error outranks running steps', () => {
  assert.deepEqual(stepperSummary([tool('bash', 'running'), tool('edit', 'error')]), {
    state: 'error', label: '2 steps need attention', detail: 'bash · edit',
  });
});

test('only deltas from the default open state count as a remembered choice', () => {
  assert.equal(rememberExpansion(true, true), undefined);
  assert.equal(rememberExpansion(false, false), undefined);
  assert.equal(rememberExpansion(true, false), true);
  assert.equal(rememberExpansion(false, true), false);
});

test('one step reads naturally and long names are capped', () => {
  assert.equal(stepperSummary([tool('read', 'completed')]).label, '1 step completed');
  assert.equal(stepperSummary([tool('read', 'error')]).label, '1 step needs attention');
  assert.equal(stepperSummary([tool('read', 'running')]).label, '1 step in progress');
  assert.equal(stepperSummary([
    tool('read', 'completed'), tool('edit', 'completed'), tool('bash', 'completed'), tool('grep', 'completed'), tool('read', 'completed'),
  ]).detail, 'read · edit · bash +1');
});
