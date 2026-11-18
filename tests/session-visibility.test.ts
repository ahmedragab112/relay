import assert from 'node:assert/strict';
import test from 'node:test';
import { atlasSessionTitle, isAtlasSession, visibleSessions } from '../src/main/session-visibility.js';

test('Atlas runs are recognised by their reserved title', () => {
  assert.equal(atlasSessionTitle('relay'), 'Atlas · relay');
  assert.equal(isAtlasSession({ title: 'Atlas · relay' }), true);
  assert.equal(isAtlasSession({ title: 'Atlas of the world' }), false);
  assert.equal(isAtlasSession({ title: 'Update Atlas pages' }), false);
});

test('hidden sessions are dropped from every listing', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(visibleSessions(items, new Set(['b'])), [{ id: 'a' }, { id: 'c' }]);
  assert.deepEqual(visibleSessions(items, new Set()), items);
});

test('existing Atlas runs are found by title for the legacy cleanup', () => {
  const items = [
    { id: 'a', title: 'Atlas · shop' },
    { id: 'b', title: 'Fix checkout' },
    { id: 'c', title: 'Atlas · dashboard' },
  ];
  assert.deepEqual(items.filter(isAtlasSession).map((item) => item.id), ['a', 'c']);
});
