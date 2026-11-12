import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMessage, CONTEXT_BLOCK_LIMIT, CONTEXT_TOTAL_LIMIT, MAX_CONTEXT_BLOCKS } from '../src/main/context.js';

test('messages without tags pass through unchanged', () => {
  assert.equal(composeMessage('Fix the failing test', []), 'Fix the failing test');
  assert.throws(() => composeMessage('   ', []), /message/i);
});

test('tagged context is appended with labelled headers', () => {
  const text = composeMessage('Summarize this', [
    { label: 'Task: Billing bug', text: 'The invoice total is wrong.' },
    { label: 'Project notes', text: 'Uses a Postgres ledger.' },
  ]);
  assert.match(text, /^Summarize this\n\n\[Context from Task: Billing bug\]\nThe invoice total is wrong\.\n\n\[Context from Project notes\]\nUses a Postgres ledger\.$/);
});

test('oversized context is truncated per block and in total', () => {
  const block = composeMessage('Question', [{ label: 'Huge', text: 'x'.repeat(CONTEXT_BLOCK_LIMIT + 500) }]);
  assert.ok(block.includes('(truncated)'));
  assert.ok(block.includes('x'.repeat(CONTEXT_BLOCK_LIMIT)));
  assert.ok(!block.includes('x'.repeat(CONTEXT_BLOCK_LIMIT + 1)));

  const many = Array.from({ length: 10 }, (_, index) => ({ label: `Task ${index}`, text: 'y'.repeat(6000) }));
  const packed = composeMessage('Question', many);
  const blocks = (packed.match(/\[Context from /g) ?? []).length;
  assert.ok(blocks <= MAX_CONTEXT_BLOCKS);
  assert.equal(blocks, 3);
  assert.ok(packed.length <= CONTEXT_TOTAL_LIMIT + 200);
  assert.doesNotMatch(packed, /Task 7/);
});
