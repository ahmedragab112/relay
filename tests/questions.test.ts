import test from 'node:test';
import assert from 'node:assert/strict';
import { questionValues } from '../src/renderer/questions.js';
import type { AgentQuestion } from '../src/shared/contracts.js';

type Spec = AgentQuestion['questions'][number];

const choice = (overrides: Partial<Spec> = {}): Spec => ({
  header: 'Target', question: 'Which architecture?', multiple: false, custom: true, required: false,
  kind: 'choice', placeholder: 'Or type your own answer…',
  options: [
    { label: 'Apple Silicon', description: 'arm64', value: 'arm64' },
    { label: 'Intel', description: 'x64', value: 'x64' },
  ],
  ...overrides,
});

test('choice answers return selected protocol values', () => {
  assert.deepEqual(questionValues(choice(), ['x64'], ''), ['x64']);
  assert.deepEqual(questionValues(choice({ multiple: true }), ['arm64', 'x64'], ''), ['arm64', 'x64']);
});

test('custom text replaces nothing but joins selected values', () => {
  assert.deepEqual(questionValues(choice(), [], '  riscv  '), ['riscv']);
  assert.deepEqual(questionValues(choice({ multiple: true }), ['x64'], 'riscv'), ['x64', 'riscv']);
});

test('custom text is ignored when the form disallows it', () => {
  assert.deepEqual(questionValues(choice({ custom: false }), ['arm64'], 'riscv'), ['arm64']);
});

test('free-text and number questions use the typed value', () => {
  const text = choice({ kind: 'text', options: [], custom: true });
  assert.deepEqual(questionValues(text, [], '12'), ['12']);
  assert.deepEqual(questionValues(text, [], '   '), []);
});

test('boolean questions return protocol true and false values', () => {
  const bool = choice({ kind: 'choice', custom: false, options: [
    { label: 'Yes', description: '', value: 'true' },
    { label: 'No', description: '', value: 'false' },
  ] });
  assert.deepEqual(questionValues(bool, ['true'], ''), ['true']);
});
