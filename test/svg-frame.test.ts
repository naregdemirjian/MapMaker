// SVG frames (Stage 10, D115): the look's grade as an SVG filter, the border lines an owner draws, and
// the file written into the export folder. (Drawing a whole frame needs the browser: e2e/workflows.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geoLength } from 'd3-geo';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { NEG_INF } from '../src/core-time/index.ts';
import { gradeFilter, borderLines } from '../src/presentation/svg-frame.ts';
import { facesPolygons } from '../src/domain/data-export.ts';
import { writeSvgFrame } from '../src/export/writer.ts';
import { ring, square } from './helpers.ts';

test("a look's grade as an SVG filter: each CSS filter function by its SVG equivalent, in sRGB", () => {
  const f = gradeFilter('sepia(0.45) saturate(0.85)', 'g', 1920, 1080)!;
  assert.match(f, /^<filter id="g" filterUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080" color-interpolation-filters="sRGB">/);
  const [sepia, saturate] = [...f.matchAll(/<feColorMatrix [^>]*>/g)].map((m) => m[0]);
  // Sepia at 0.45: the first entry 0.393 + 0.607 x 0.55.
  assert.match(sepia, /type="matrix" values="0.72685 0.34605 0.08505 0 0 /);
  assert.match(saturate, /type="saturate" values="0.85"/);
  const c = gradeFilter('saturate(0.6) contrast(0.92) brightness(1.04)', 'h', 10, 10)!;
  assert.match(c, /<feFuncR type="linear" slope="0.92" intercept="0.04"\/>/, 'contrast: slope c, intercept (1 - c) / 2');
  assert.match(c, /<feFuncG type="linear" slope="1.04" intercept="0"\/>/, 'brightness: slope b');
  assert.match(gradeFilter('hue-rotate(-8deg)', 'k', 1, 1)!, /type="hueRotate" values="-8"/);
  assert.match(gradeFilter('grayscale(1) contrast(1.05)', 'm', 1, 1)!, /values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 /);
  assert.equal(gradeFilter('', 'n', 1, 1), null);
});

test('border lines: a border between two owners once, from one side; borders against nobody kept apart', () => {
  const world = new World();
  const space = cmd.seedProject(world, 'Borders').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Outer' }).result;
  const b = cmd.createEntity(world, { type_id: 'polity', name: 'Enclave' }).result;
  const paint = (owner: string, pts: Array<[number, number]>) => cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(pts), value: owner, snap: 1e-9, mode: { kind: 'correct', t: NEG_INF } });
  paint(a, square(10, 45, 6));
  paint(b, square(10, 45, 2));
  const states = engine.partitionState(space, layer, NEG_INF);
  const arr = world.arrangement(space);
  const faces = (o: string) => [...states].filter(([, st]) => st.value === o).map(([f]) => f);
  const la = borderLines(arr, states, a, faces(a)), lb = borderLines(arr, states, b, faces(b));
  const len = (ls: Array<[number, number]>[]) => (ls.length ? geoLength({ type: 'MultiLineString', coordinates: ls }) : 0);
  const outer = geoLength({ type: 'LineString', coordinates: [...square(10, 45, 6), square(10, 45, 6)[0]] });
  const inner = geoLength({ type: 'LineString', coordinates: [...square(10, 45, 2), square(10, 45, 2)[0]] });
  // The outer owner's border against nobody all round; the enclave has none.
  assert.ok(Math.abs(len(la.open) - outer) < outer * 0.01, `all round the outside (${len(la.open)} of ${outer})`);
  assert.equal(lb.open.length, 0);
  // The border between them drawn once, by one of the two.
  assert.ok(Math.abs(len(la.shared) + len(lb.shared) - inner) < inner * 0.01, `the enclave's border once (${len(la.shared) + len(lb.shared)} of ${inner})`);
  assert.ok(la.shared.length === 0 || lb.shared.length === 0, 'from one side only');
  // The outer owner's land: one polygon with a hole where the enclave is.
  const polys = facesPolygons(arr, faces(a));
  assert.equal(polys.length, 1);
  assert.equal(polys[0].length, 2, 'an outer ring and a hole');
});

test('an SVG frame is written into the export folder, numbered by its frame, never over another', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mm-svg-'));
  try {
    const svg = new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
    const a = writeSvgFrame(dir, null, 'The Front / 1914', 11, svg);
    assert.equal(a, join(dir, 'exports', 'The_Front_1914_frame000012.svg'));
    assert.equal(readFileSync(a, 'utf8').slice(0, 5), '<?xml');
    const b = writeSvgFrame(dir, null, 'The Front / 1914', 11, svg);
    assert.equal(b, join(dir, 'exports', 'The_Front_1914_frame000012_2.svg'), 'a second copy beside the first');
    const other = join(dir, 'elsewhere');
    assert.ok(existsSync(writeSvgFrame(dir, other, 'x', 0, svg)), 'a folder of the shot\'s own');
    assert.throws(() => writeSvgFrame(dir, null, 'x', 0, new TextEncoder().encode('<html></html>')), /Not an SVG/);
    assert.throws(() => writeSvgFrame(dir, 'relative/folder', 'x', 0, svg), /full folder path/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
