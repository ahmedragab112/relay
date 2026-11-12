import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followTab } from '../src/renderer/state.js';

test('a turn starting sends the inspector to the tool log', () => {
  assert.equal(followTab('turn-start', false), 'activity');
});

test('file edits send the inspector to the changes list', () => {
  assert.equal(followTab('edit', false), 'changes');
});

test('choosing a tab yourself stops the agent from moving the view', () => {
  assert.equal(followTab('turn-start', true), undefined);
  assert.equal(followTab('edit', true), undefined);
});

test('a page the agent opens always takes the view, even after a manual choice', () => {
  assert.equal(followTab('page', false), 'browser');
  assert.equal(followTab('page', true), 'browser');
});
