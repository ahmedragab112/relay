import test from 'node:test';
import assert from 'node:assert/strict';
import { nearBottom, chooseModel, resolveInitialModel, isDirty, externalURL, parsePatch, reloadTransition, shouldDismissAttention } from '../src/renderer/state.js';

// These catch forced scrolling, unavailable model selection, lost edits, unsafe
// navigation, incorrect diff classification, and dropped streaming reloads.
test('scroll follows only when the reader is near the bottom', () => {
  assert.equal(nearBottom({ scrollTop: 800, scrollHeight: 1200, clientHeight: 320 }), true);
  assert.equal(nearBottom({ scrollTop: 100, scrollHeight: 1200, clientHeight: 320 }), false);
  assert.equal(nearBottom({ scrollTop: 0, scrollHeight: 100, clientHeight: 320 }), true);
});

test('model selection uses only actual connected models', () => {
  const models = [
    { id: 'offline/m', providerID: 'offline', modelID: 'm', name: 'Offline', connected: false },
    { id: 'live/a', providerID: 'live', modelID: 'a', name: 'A', connected: true },
    { id: 'live/b', providerID: 'live', modelID: 'b', name: 'B', connected: true },
  ];
  assert.equal(chooseModel(models, 'live/b'), 'live/b');
  assert.equal(chooseModel(models, 'offline/m'), 'live/a');
  assert.equal(chooseModel([], 'imaginary/model'), '');
});

test('initial selection defaults to Auto and settles on an explicit pick', () => {
  const models = [
    { id: 'live/a', providerID: 'live', modelID: 'a', name: 'A', connected: true },
    { id: 'live/b', providerID: 'live', modelID: 'b', name: 'B', connected: true },
    { id: 'offline/m', providerID: 'offline', modelID: 'm', name: 'Offline', connected: false },
  ];
  // Nothing saved, nothing picked: the composer starts on Auto and lets the engine pick.
  assert.deepEqual(resolveInitialModel(models, '', ''), { modelId: '', autoModel: true });
  // A saved preference wins over the Auto default.
  assert.deepEqual(resolveInitialModel(models, 'live/b', ''), { modelId: 'live/b', autoModel: false });
  // A session pick whose preference is still saving is kept, not clobbered back to Auto.
  assert.deepEqual(resolveInitialModel(models, '', 'live/a'), { modelId: 'live/a', autoModel: false });
  // An invalid saved preference falls back to the first connected model, not Auto.
  assert.deepEqual(resolveInitialModel(models, 'imaginary/model', ''), { modelId: 'live/a', autoModel: false });
  // No connected models: Auto is still the honest initial state; the composer keeps send disabled.
  assert.deepEqual(resolveInitialModel([], '', ''), { modelId: '', autoModel: true });
});

test('dirty detection preserves edits made while a save is pending', () => {
  assert.equal(isDirty(undefined, ''), false);
  assert.equal(isDirty({ content: 'original' }, 'original'), false);
  assert.equal(isDirty({ content: 'original' }, 'changed'), true);
  assert.equal(isDirty({ content: 'saved snapshot' }, 'newer edit'), true);
});

test('external navigation rejects local, script, relative and credential URLs', () => {
  assert.equal(externalURL('https://example.com/docs'), 'https://example.com/docs');
  assert.equal(externalURL('http://localhost:3000'), 'http://localhost:3000/');
  for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//example.com', '/readme', 'https://user:secret@example.com']) {
    assert.equal(externalURL(value), null);
  }
});

test('unified patches distinguish metadata from additions and deletions', () => {
  assert.deepEqual(parsePatch('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n context'), [
    { kind: 'meta', text: '--- a/a.ts' },
    { kind: 'meta', text: '+++ b/a.ts' },
    { kind: 'hunk', text: '@@ -1 +1 @@' },
    { kind: 'removed', text: '-old' },
    { kind: 'added', text: '+new' },
    { kind: 'context', text: ' context' },
  ]);
});

test('a background task refresh leaves the attention page open', () => {
  assert.equal(shouldDismissAttention('s1', 's1', false), false);
  assert.equal(shouldDismissAttention('', '', false), false);
});

test('choosing a task dismisses attention even when it is already selected', () => {
  assert.equal(shouldDismissAttention('s1', 's1', true), true);
  assert.equal(shouldDismissAttention('s1', 's2', false), true);
});

test('reload state coalesces a burst and retains events during an in-flight request', () => {
  let state = { running: false, queued: false };
  state = reloadTransition(state, 'request');
  state = reloadTransition(state, 'request');
  assert.deepEqual(state, { running: false, queued: true });
  state = reloadTransition(state, 'start');
  assert.deepEqual(state, { running: true, queued: false });
  state = reloadTransition(state, 'request');
  state = reloadTransition(state, 'start');
  assert.deepEqual(state, { running: true, queued: true });
  state = reloadTransition(state, 'finish');
  assert.deepEqual(state, { running: false, queued: true });
  state = reloadTransition(state, 'start');
  state = reloadTransition(state, 'finish');
  assert.deepEqual(state, { running: false, queued: false });
});
