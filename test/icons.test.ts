// The icon set for characters (D85): every icon's shapes are well formed and on its 64 by 64 grid,
// names and ids are unique, and each says how it turns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICONS, ICON_GROUPS, iconById } from '../src/render-engine/icons.ts';

/** The points an SVG path visits (absolute), or an error for anything malformed. */
function pathPoints(d: string): Array<[number, number]> {
  const tokens = d.match(/[MmLlHhVvQqCcAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  assert.equal(tokens.join('').length, d.replace(/[\s,]/g, '').length, `only commands and numbers in "${d.slice(0, 40)}…"`);
  const args: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, A: 7, Z: 0 };
  const pts: Array<[number, number]> = [];
  let x = 0, y = 0, sx = 0, sy = 0, i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    assert.ok(/^[A-Za-z]$/.test(cmd), `a command expected, not ${cmd}`);
    const up = cmd.toUpperCase(), rel = cmd !== up, n = args[up];
    if (up === 'Z') { x = sx; y = sy; continue; }
    let first = true;
    do {
      const v = tokens.slice(i, i + n).map(Number);
      assert.equal(v.length, n, `${cmd} takes ${n} numbers`);
      assert.ok(v.every(Number.isFinite), `${cmd} numbers`);
      i += n;
      if (up === 'H') x = rel ? x + v[0] : v[0];
      else if (up === 'V') y = rel ? y + v[0] : v[0];
      else { const ex = v[n - 2], ey = v[n - 1]; x = rel ? x + ex : ex; y = rel ? y + ey : ey; }
      if (up === 'M' && first) { sx = x; sy = y; }
      first = false;
      pts.push([x, y]);
    } while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]));
  }
  return pts;
}

test('icons: every shape is well formed and drawn on the 64 by 64 grid', () => {
  assert.ok(ICONS.length >= 40, `${ICONS.length} icons`);
  for (const icon of ICONS) {
    for (const part of ['solid', 'detail', 'top', 'line'] as const) {
      const d = icon[part];
      if (!d) continue;
      const pts = pathPoints(d);
      assert.ok(pts.length >= 2, `${icon.id} ${part} has points`);
      for (const [x, y] of pts) assert.ok(x >= -1 && x <= 65.5 && y >= -1 && y <= 65, `${icon.id} ${part}: (${x}, ${y}) on the grid`);
    }
  }
});

test('icons: unique ids and names, known groups, each turning its own way; ships, aircraft and land forces', () => {
  assert.equal(new Set(ICONS.map((i) => i.id)).size, ICONS.length);
  assert.equal(new Set(ICONS.map((i) => i.name)).size, ICONS.length);
  for (const i of ICONS) {
    assert.ok(ICON_GROUPS.includes(i.group), i.id);
    assert.ok(['rotate', 'mirror', 'none'].includes(i.turn), i.id);
    assert.equal(iconById(i.id), i);
  }
  // Seen from above, aircraft turn; seen from the side, ships and vehicles face east or west; signs stay.
  for (const id of ['airliner', 'fighter', 'bomber', 'helicopter', 'drone', 'missile']) assert.equal(iconById(id)!.turn, 'rotate', id);
  for (const id of ['sailing-ship', 'warship', 'carrier', 'submarine', 'freighter', 'tanker', 'liner', 'tank', 'truck', 'cavalry', 'train']) assert.equal(iconById(id)!.turn, 'mirror', id);
  for (const id of ['hq', 'fort', 'battle', 'star', 'crown']) assert.equal(iconById(id)!.turn, 'none', id);
  const count = (g: string) => ICONS.filter((i) => i.group === g).length;
  assert.ok(count('Ships') >= 8 && count('Aircraft') >= 8 && count('On land') >= 8 && count('Military signs') >= 10);
  assert.equal(iconById('unicorn'), undefined);
  assert.equal(iconById(null), undefined);
});
