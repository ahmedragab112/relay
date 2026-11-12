import test from 'node:test';
import assert from 'node:assert/strict';
import { stepperSummary, rememberExpansion } from '../src/renderer/tool-stepper.js';
import type { ToolPart } from '../src/shared/contracts.js';

const tool = (name: string, state: ToolPart['state']): ToolPart => ({
  type: 'tool', id: `${name}-${state}`, name, state, input: '', output: '',
});

test('completed steps summarize their count and tools', () => {
  assert.deepEqual(stepperSummary([tool('read', 'completed'), tool('edit', 'completed')]), {
    state: 'completed', label: '2 steps completed', detail: 'read · edit', completed: 2, remaining: 0,
  });
});

test('a running step keeps the whole stepper active', () => {
  assert.deepEqual(stepperSummary([tool('read', 'completed'), tool('bash', 'running')]), {
    state: 'running', label: '1 of 2 steps done · 1 remaining', detail: 'read · bash', completed: 1, remaining: 1,
  });
});

test('an error outranks running steps', () => {
  assert.deepEqual(stepperSummary([tool('bash', 'running'), tool('edit', 'error')]), {
    state: 'error', label: '0 of 2 steps done · 1 remaining', detail: 'bash · edit', completed: 0, remaining: 1,
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
  assert.equal(stepperSummary([tool('read', 'error')]).label, '0 of 1 step done · attention needed');
  assert.equal(stepperSummary([tool('read', 'running')]).label, '0 of 1 step done · 1 remaining');
  assert.equal(stepperSummary([
    tool('read', 'completed'), tool('edit', 'completed'), tool('bash', 'completed'), tool('grep', 'completed'), tool('read', 'completed'),
  ]).detail, 'read · edit · bash +1');
});
