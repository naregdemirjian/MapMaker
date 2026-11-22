// Shortcuts as written in menus, and the list of commands (D197).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches } from '../src/ui/shell/shortcuts.ts';

test('shortcuts: a key press is matched with what a menu writes', () => {
  assert.ok(matches({ key: 'z', ctrlKey: true }, 'Ctrl+Z'));
  assert.ok(matches({ key: 'Z', metaKey: true }, 'Ctrl+Z'), 'the Command key stands for Ctrl');
  assert.ok(!matches({ key: 'z', ctrlKey: true, shiftKey: true }, 'Ctrl+Z'), 'with Shift it is another shortcut');
  assert.ok(matches({ key: 'Z', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+Z'));
  assert.ok(!matches({ key: 'z' }, 'Ctrl+Z'));
  assert.ok(matches({ key: '1', altKey: true }, 'Alt+1'));
  assert.ok(!matches({ key: '1' }, 'Alt+1'));
  assert.ok(matches({ key: ' ' }, 'Space'));
  assert.ok(matches({ key: 'Delete' }, 'Delete'));
  assert.ok(matches({ key: ',' }, ','));
  assert.ok(matches({ key: '.', shiftKey: false }, '.'));
  assert.ok(!matches({ key: ',', ctrlKey: true }, ','));
});
