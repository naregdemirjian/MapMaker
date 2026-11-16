// Geometry edge cases, precision through saving and reopening, and independent worlds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec, type Vec3 } from '../src/geo-kernel/vec.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { ProjectRegistry } from '../src/server/projects.ts';
import { rng, ring, square } from './helpers.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });

function setup() {
  const world = new World();
  const { result } = cmd.seedProject(world, 'Geometry');
  const spaceId = result.spaceId;
  const layerId = world.all('layer').find((l) => l.space_id === spaceId)!.id;
  const engine = new Engine(world);
  const A = cmd.createEntity(world, { type_id: 'polity', name: 'A' }).result;
  const B = cmd.createEntity(world, { type_id: 'polity', name: 'B' }).result;
  const paintRing = (r: Vec3[], value: string | null, space = spaceId, layer = layerId) =>
    cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: r, value, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const at = (lon: number, lat: number, space = spaceId, layer = layerId) => engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), Y(2000));
  const valid = (space = spaceId) => assert.deepEqual(world.arrangement(space).validate(), []);
  return { world, engine, spaceId, layerId, A, B, paintRing, at, valid };
}

/** A failed command must leave the project exactly as it was. */
function refusedCleanly(s: ReturnType<typeof setup>, fn: () => unknown) {
  const before = JSON.stringify(s.world.snapshot());
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (threw) assert.equal(JSON.stringify(s.world.snapshot()), before, 'a refused edit changes nothing');
  s.valid();
  return threw;
}

test('degenerate shapes are refused without changing anything', () => {
  const s = setup();
  s.paintRing(ring(square(10, 10, 5)), s.A);
  const p = lonLatToVec(3, 3);
  assert.ok(refusedCleanly(s, () => s.paintRing([p, p, p, p], s.B)), 'all points identical');
  assert.ok(refusedCleanly(s, () => s.paintRing([lonLatToVec(0, 0), lonLatToVec(1, 0)], s.B)), 'two points');
  assert.ok(refusedCleanly(s, () => s.paintRing([lonLatToVec(0, 0), lonLatToVec(1, 0), lonLatToVec(2, 0), lonLatToVec(3, 0)], s.B)), 'points in a line');
  // A sliver thinner than the snapping distance collapses onto itself.
  assert.ok(refusedCleanly(s, () => cmd.paintTerritory(s.world, s.engine, { spaceId: s.spaceId, layerId: s.layerId, ring: ring([[20, 0], [30, 0], [30, 1e-6], [20, 1e-6]]), value: s.B, snap: 1e-6, mode: { kind: 'correct', t: NEG_INF } })), 'a collapsed sliver');
  assert.equal(s.at(10, 10), s.A);
  assert.equal(s.at(1, 0.001), null);
});

test('a self-crossing outline never produces invalid geometry', () => {
  const s = setup();
  // A bow tie: two lobes traversed in opposite directions.
  const bow: Array<[number, number]> = [[0, 0], [10, 10], [10, 0], [0, 10]];
  assert.ok(refusedCleanly(s, () => s.paintRing(ring(bow, 0.5), s.A)), 'a bow tie is refused rather than flooding the world');
  assert.equal(s.at(100, -40), null, 'far away nothing was painted');
  // A clockwise outline encloses everything outside it (the drawing tools always orient outlines inward).
  s.paintRing(ring([[40, 40], [40, 45], [45, 45], [45, 40]]), s.B);
  assert.equal(s.at(100, -40), s.B);
  assert.equal(s.at(42, 42), null);
  // Random self-crossing scribbles, many times over.
  const r = rng(42);
  for (let i = 0; i < 40; i++) {
    const cx = r.float(-170, 170), cy = r.float(-70, 70);
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < r.int(4, 12); k++) pts.push([cx + r.float(-8, 8), cy + r.float(-8, 8)]);
    refusedCleanly(s, () => s.paintRing(ring(pts, 0.5), r.bool() ? s.A : s.B));
  }
  s.valid();
});

test('shapes across the 180° line, around a pole, larger than a hemisphere, and only metres across', () => {
  const s = setup();
  s.paintRing(ring(square(180, 0, 5)), s.A);
  assert.equal(s.at(179, 0), s.A);
  assert.equal(s.at(-179, 0), s.A);
  assert.equal(s.at(170, 0), null);
  // A polar cap: a ring at 75°N traversed eastward has the pole on its left.
  const cap: Array<[number, number]> = [];
  for (let lon = -180; lon < 180; lon += 10) cap.push([lon, 75]);
  s.paintRing(ring(cap), s.B);
  assert.equal(s.at(0, 89.9), s.B);
  assert.equal(s.at(123, 90), s.B);
  assert.equal(s.at(0, 70), null);
  // Larger than a hemisphere: a ring at 60°S traversed eastward has everything north of it on its left.
  const huge: Array<[number, number]> = [];
  for (let lon = -180; lon < 180; lon += 10) huge.push([lon, -60]);
  s.paintRing(ring(huge), s.A);
  assert.equal(s.at(0, 0), s.A);
  assert.equal(s.at(0, 89.9), s.A);
  assert.equal(s.at(0, -70), null);
  // About 20 metres across.
  s.paintRing(ring(square(-40, -80, 0.0001)), s.B);
  assert.equal(s.at(-40, -80), s.B);
  assert.equal(s.at(-40, -80.0003), null);
  s.valid();
});

test('splitting and merging: borders appear only between different owners, and history keeps the pieces', () => {
  const s = setup();
  // Corner points at lon 20 on both long sides, so the later halves share exactly the same border arcs.
  s.paintRing(ring([[10, 10], [20, 10], [30, 10], [30, 30], [20, 30], [10, 30]]), s.A);
  const ev = cmd.createEvent(s.world, { name: 'Split', start: Y(1500) }).result;
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.spaceId, layerId: s.layerId, ring: ring([[20, 10], [30, 10], [30, 30], [20, 30]]), value: s.B, snap: 1e-7, mode: { kind: 'new', eventId: ev } });
  const merge = cmd.createEvent(s.world, { name: 'Reunification', start: Y(1600) }).result;
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.spaceId, layerId: s.layerId, ring: ring([[20, 10], [30, 10], [30, 30], [20, 30]]), value: s.A, snap: 1e-7, mode: { kind: 'new', eventId: merge } });
  const arr = s.world.arrangement(s.spaceId);
  const borderSegments = (t: number) => {
    const st = s.engine.partitionState(s.spaceId, s.layerId, Y(t));
    let n = 0;
    for (const seg of arr.segments.values()) if ((st.get(seg.left_face)?.value ?? null) !== (st.get(seg.right_face)?.value ?? null)) n++;
    return n;
  };
  const outer = borderSegments(1400);
  assert.ok(borderSegments(1550) > outer, 'the split adds an internal border');
  assert.equal(borderSegments(1650), outer, 'after reunification only the outer border remains');
  assert.equal(s.at(25, 20), s.A);
  assert.equal(s.engine.valueAtPoint(s.spaceId, s.layerId, lonLatToVec(25, 20), Y(1550)), s.B, '...and 1550 still shows the split');
});

test('geometry is stored exactly: precision survives saving and reopening', () => {
  const root = mkdtempSync(join(tmpdir(), 'mapmaker-geo-'));
  try {
    const reg = new ProjectRegistry(root);
    const info = reg.create('Precision');
    const db = reg.get(info.id);
    const world = World.fromSnapshot(db.snapshot());
    const engine = new Engine(world);
    const save = (r: cmd.CommandResult<any>) => { db.commit(r.label, r.diffs, db.journalState().head); return r.result; };
    const space = world.all('map_space')[0].id, layer = world.all('layer')[0].id;
    const A = save(cmd.createEntity(world, { type_id: 'polity', name: 'A' }));
    // Corners with seven decimals (about 1 cm on Earth).
    const pts: Array<[number, number]> = [[12.3456789, 45.1234567], [12.3466789, 45.1234567], [12.3466789, 45.1244567], [12.3456789, 45.1244567]];
    save(cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: pts.map((p) => lonLatToVec(...p)), value: A, snap: 1e-9, mode: { kind: 'correct', t: NEG_INF } }));
    const rowsBefore = JSON.stringify(world.arrangement(space).rows());
    reg.closeAll();
    const reg2 = new ProjectRegistry(root);
    const w2 = World.fromSnapshot(reg2.get(info.id).snapshot());
    assert.equal(JSON.stringify(w2.arrangement(space).rows()), rowsBefore, 'every vertex identical after reopening');
    const lons = [...w2.arrangement(space).vertices.values()].map((v) => v.lon).sort((a, b) => a - b);
    assert.equal(lons[0], 123456789, 'stored in units of 1e-7 degree');
    const e2 = new Engine(w2);
    // 1e-6 degree (about 10 cm) inside and outside the western border.
    assert.equal(e2.valueAtPoint(space, layer, lonLatToVec(12.3456799, 45.124), Y(2000)), A);
    assert.equal(e2.valueAtPoint(space, layer, lonLatToVec(12.3456779, 45.124), Y(2000)), null);
    reg2.closeAll();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worlds are independent: geography, layers and history never mix, whatever their size', () => {
  const s = setup();
  const aster = cmd.createWorld(s.world, 'Aster', 3000).result;
  const moon = cmd.createWorld(s.world, 'Moon', 1737.4).result;
  const asterLayer = s.world.all('layer').find((l) => l.space_id === aster)!.id;
  const moonLayer = s.world.all('layer').find((l) => l.space_id === moon)!.id;
  assert.notEqual(asterLayer, s.layerId);
  // The same coordinates in three worlds, three different owners.
  s.paintRing(ring(square(10, 10, 5)), s.A);
  s.paintRing(ring(square(10, 10, 5)), s.B, aster, asterLayer);
  const earthRows = JSON.stringify(s.world.arrangement(s.spaceId).rows());
  const ev = cmd.createEvent(s.world, { name: 'Aster war', start: Y(3000) }).result;
  cmd.paintTerritory(s.world, s.engine, { spaceId: aster, layerId: asterLayer, ring: ring(square(12, 12, 2)), value: s.A, snap: 1e-7, mode: { kind: 'new', eventId: ev } });
  assert.equal(JSON.stringify(s.world.arrangement(s.spaceId).rows()), earthRows, 'editing Aster never touches Earth\'s geometry');
  assert.equal(s.world.arrangement(moon).faces.size, 1, 'the Moon is still blank');
  assert.equal(s.world.arrangement(moon).segments.size, 0);
  assert.equal(s.at(10, 10), s.A);
  assert.equal(s.at(12, 12, s.spaceId), s.A);
  assert.equal(s.engine.valueAtPoint(aster, asterLayer, lonLatToVec(10, 10), Y(3001)), s.B);
  assert.equal(s.engine.valueAtPoint(aster, asterLayer, lonLatToVec(12, 12), Y(3001)), s.A, 'the Aster event changes Aster');
  assert.equal(s.engine.valueAtPoint(aster, asterLayer, lonLatToVec(12, 12), Y(2999)), s.B);
  assert.equal(s.engine.valueAtPoint(moon, moonLayer, lonLatToVec(10, 10), Y(3001)), null);
  // A layer of one world cannot be painted through another world's map.
  assert.throws(() => cmd.paintTerritory(s.world, s.engine, { spaceId: s.spaceId, layerId: asterLayer, ring: ring(square(50, 0, 2)), value: s.A, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } }));
  // Areas use each world's own radius: the same 10° square is smaller on a smaller world.
  const areaKm2 = (space: string, r: number) => {
    const arr = s.world.arrangement(space);
    return arr.faceArea(arr.locate(lonLatToVec(10, 10))) * r * r;
  };
  s.paintRing(ring(square(10, 10, 5)), s.B, moon, moonLayer);
  const ratio = areaKm2(moon, 1737.4) / areaKm2(s.spaceId, 6371.0088);
  assert.ok(Math.abs(ratio - (1737.4 / 6371.0088) ** 2) < 1e-9, `area ratio ${ratio}`);
  assert.ok(Math.abs(areaKm2(s.spaceId, 6371.0088) - 1.2e6) < 0.1e6, 'a 10° square near the equator is about 1.2 million km² on Earth');
  s.valid(); s.valid(aster);
});

test('undoing one world\'s edit restores exactly that world', () => {
  const s = setup();
  const aster = cmd.createWorld(s.world, 'Aster', 3000).result;
  const asterLayer = s.world.all('layer').find((l) => l.space_id === aster)!.id;
  s.paintRing(ring(square(0, 0, 5)), s.A);
  const sorted = () => { const snap = s.world.snapshot() as Record<string, any[]>; return JSON.stringify(Object.keys(snap).sort().map((k) => [k, [...snap[k]].map((r) => JSON.stringify(r)).sort()])); };
  const before = sorted();
  const r = s.paintRing(ring(square(0, 0, 5)), s.B, aster, asterLayer);
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(sorted(), before, 'the same rows (their order in memory may differ)');
  s.valid(); s.valid(aster);
});

test('regression: an outline that crosses itself next to an existing country never crashes the kernel', () => {
  const s = setup();
  s.paintRing(ring(square(10, 45, 8)), s.A);
  // A figure-eight drawn as one outline across A's border: its second half splits its first half.
  const r = ring([[12, 40], [20, 50], [20, 40], [12, 50]]);
  try {
    s.paintRing(r, s.A);
  } catch (e) {
    assert.ok(!(e instanceof TypeError), `a clean refusal at most, not ${(e as Error).message}`);
  }
  s.valid();
});
