import test from 'node:test';
import assert from 'node:assert/strict';
import { missingAnswer, questionStep, questionValues } from '../src/renderer/questions.js';
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

test('a pager labels the visible question and knows the last step', () => {
  assert.deepEqual(questionStep(0, 2), { position: 0, label: '1 / 2', last: false });
  assert.deepEqual(questionStep(1, 2), { position: 1, label: '2 / 2', last: true });
  assert.deepEqual(questionStep(0, 1), { position: 0, label: '1 / 1', last: true });
});

test('a pager clamps out-of-range positions and empty totals', () => {
  assert.deepEqual(questionStep(5, 2), { position: 1, label: '2 / 2', last: true });
  assert.deepEqual(questionStep(-3, 2), { position: 0, label: '1 / 2', last: false });
  assert.deepEqual(questionStep(0, 0), { position: 0, label: '1 / 1', last: true });
});

test('a required question blocks its step until answered', () => {
  assert.equal(missingAnswer(choice({ required: true }), []), true);
  assert.equal(missingAnswer(choice({ required: true }), ['x64']), false);
  assert.equal(missingAnswer(choice({ required: false }), []), false);
});

