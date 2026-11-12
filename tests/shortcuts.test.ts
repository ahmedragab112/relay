import test from 'node:test';
import assert from 'node:assert/strict';
import { modifierLabel, shortcutLabel } from '../src/renderer/shortcuts.js';

test('the modifier follows the OS', () => {
  assert.equal(modifierLabel('darwin'), '⌘');
  assert.equal(modifierLabel('win32'), 'Ctrl');
  assert.equal(modifierLabel('linux'), 'Ctrl');
});

test('shortcuts render with native notation', () => {
  assert.equal(shortcutLabel('darwin', 'Mod+K'), '⌘K');
  assert.equal(shortcutLabel('darwin', 'Mod+,'), '⌘,');
  assert.equal(shortcutLabel('win32', 'Mod+K'), 'Ctrl+K');
  assert.equal(shortcutLabel('linux', 'Mod+Shift+Enter'), 'Ctrl+Shift+Enter');
  assert.equal(shortcutLabel('darwin', 'Mod+Shift+Enter'), '⌘⇧Enter');
  assert.equal(shortcutLabel('win32', 'Escape'), 'Escape');
});
