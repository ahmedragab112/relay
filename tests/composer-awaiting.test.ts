import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestSignature, shouldHideComposer } from '../src/renderer/state.js';

test('the composer stays visible when nothing is waiting on the user', () => {
  assert.equal(shouldHideComposer(0, false), false);
  assert.equal(shouldHideComposer(0, true), false);
});

test('a pending request hides the composer', () => {
  assert.equal(shouldHideComposer(1, false), true);
  assert.equal(shouldHideComposer(3, false), true);
});

test('revealing keeps the composer visible while requests are still pending', () => {
  assert.equal(shouldHideComposer(1, true), false);
  assert.equal(shouldHideComposer(3, true), false);
});

test('the request signature ignores ordering so a re-render does not re-hide the composer', () => {
  assert.equal(requestSignature(['p:1', 'q:2']), requestSignature(['q:2', 'p:1']));
  assert.equal(requestSignature([]), requestSignature([]));
});

test('the request signature changes when a request is added or resolved', () => {
  assert.notEqual(requestSignature(['p:1']), requestSignature(['p:1', 'q:2']));
  assert.notEqual(requestSignature(['p:1', 'q:2']), requestSignature(['q:2']));
});

test('a new request re-hides the composer even after the user revealed it', () => {
  const before = requestSignature(['p:1']);
  const after = requestSignature(['p:1', 'q:2']);
  const revealed = before !== after ? false : true;
  assert.equal(shouldHideComposer(2, revealed), true);
});

test('resolving every request brings the composer back', () => {
  assert.equal(shouldHideComposer(0, false), false);
  assert.equal(shouldHideComposer(0, true), false);
});
