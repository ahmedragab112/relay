import assert from 'node:assert/strict';
import test from 'node:test';
import { dragInspector, INSPECTOR_BOUNDS } from '../src/renderer/splitter';

test('dragging the handle left widens the inspector', () => {
  assert.deepEqual(dragInspector(420, -90, INSPECTOR_BOUNDS), { width: 510 });
});

test('dragging the handle right shrinks the inspector but keeps the minimum', () => {
  assert.deepEqual(dragInspector(420, 90, INSPECTOR_BOUNDS), { width: 330 });
  assert.deepEqual(dragInspector(300, 20, INSPECTOR_BOUNDS), { width: INSPECTOR_BOUNDS.min });
});

test('dragging past the collapse threshold hides the inspector so the chat fills the window', () => {
  assert.deepEqual(dragInspector(320, 100, INSPECTOR_BOUNDS), { collapsed: true });
});

test('the inspector never grows past the maximum width', () => {
  assert.deepEqual(dragInspector(600, -900, INSPECTOR_BOUNDS), { width: INSPECTOR_BOUNDS.max });
});
