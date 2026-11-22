// Keyboard shortcuts as they are written in menus ("Ctrl+Shift+Z", "Alt+1", ",", "Space", "Delete") (D197).

export interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }

const NAMED: Record<string, string> = { space: ' ', del: 'delete', esc: 'escape', left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown' };

/** Whether a key press is the shortcut written. Ctrl stands for the Command key too. */
export function matches(e: KeyLike, shortcut: string): boolean {
  const parts = shortcut.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  // ("Ctrl++" is Ctrl with the plus key.)
  const key = shortcut.endsWith('+') ? '+' : parts.pop() ?? '';
  const want = (m: string) => parts.includes(m);
  if (!!(e.ctrlKey || e.metaKey) !== want('ctrl') || !!e.altKey !== want('alt')) return false;
  // (Shift is part of how some signs are typed: it counts only for letters, digits and named keys.)
  const plain = key.length > 1 || /[a-z0-9]/.test(key);
  if (plain && !!e.shiftKey !== want('shift')) return false;
  return e.key.toLowerCase() === (NAMED[key] ?? key);
}
