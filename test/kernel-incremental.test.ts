// The geometry kernel keeps its half-edge structure between edits and updates only what changed.
// After every kind of edit, undo and redo, that structure must equal one rebuilt from scratch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { invertDiffs, type RowDiff } from '../src/world-model/schema.ts';
import { rng, ring } from './helpers.ts';

for (const seed of [1, 2, 3, 4]) {
  test(`kernel structure stays equal to a full rebuild through random edits, undo and redo (seed ${seed})`, () => {
    const world = new World();
    const space = cmd.seedProject(world, 'Incremental').result.spaceId;
    const layer = world.all('layer')[0].id;
    const engine = new Engine(world);
    const owners = [0, 1, 2].map((i) => cmd.createEntity(world, { type_id: 'polity', name: `P${i}` }).result);
    const arr = () => world.arrangement(space);
    const r = rng(seed);
    const history: RowDiff[][] = [];
    const undone: RowDiff[][] = [];
    const check = (what: string) => {
      assert.deepEqual(arr().checkTopology(), [], `after ${what}`);
      assert.deepEqual(arr().validate(), [], `valid after ${what}`);
    };
    for (let step = 0; step < 70; step++) {
      const op = r.float(0, 1);
      try {
        if (op < 0.45) {
          // Paint an outline: stars (simple) and scribbles (crossing themselves).
          const cx = r.float(-50, 50), cy = r.float(-40, 40), k = r.int(3, 10);
          const pts: Array<[number, number]> = [];
          for (let i = 0; i < k; i++) {
            if (r.bool(0.7)) { const a = (i / k) * Math.PI * 2, rad = r.float(3, 15); pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]); }
            else pts.push([cx + r.float(-12, 12), cy + r.float(-10, 10)]);
          }
          const res = cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(pts, 0.7), value: r.pick(owners), snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
          history.push(res.diffs); undone.length = 0;
          check(`painting (step ${step})`);
        } else if (op < 0.6) {
          // Move a border point a little (may be refused when it would cross something).
          const vs = [...arr().vertices.keys()];
          if (!vs.length) continue;
          const vid = r.pick(vs);
          const v = arr().vertices.get(vid)!;
          const to = lonLatToVec(v.lon / 1e7 + r.float(-0.5, 0.5), v.lat / 1e7 + r.float(-0.5, 0.5));
          if (!arr().canMoveVertex(vid, to, 1e-7).ok) continue;
          const res = cmd.moveVertex(world, { spaceId: space, vertexId: vid, to, snap: 1e-7 });
          history.push(res.diffs); undone.length = 0;
          check(`moving a point (step ${step})`);
        } else if (op < 0.7) {
          const ss = [...arr().segments.values()];
          if (!ss.length) continue;
          const s = r.pick(ss);
          const a = arr().vertices.get(s.a)!, b = arr().vertices.get(s.b)!;
          const res = cmd.insertBorderVertex(world, { spaceId: space, segmentId: s.id, at: lonLatToVec((a.lon + b.lon) / 2e7, (a.lat + b.lat) / 2e7) });
          history.push(res.diffs); undone.length = 0;
          check(`adding a point (step ${step})`);
        } else if (op < 0.78) {
          const vs = [...arr().vertices.keys()].filter((v) => [...arr().segments.values()].filter((s) => s.a === v || s.b === v).length === 2);
          if (!vs.length) continue;
          const res = cmd.removeBorderVertex(world, { spaceId: space, vertexId: r.pick(vs) });
          history.push(res.diffs); undone.length = 0;
          check(`removing a point (step ${step})`);
        } else if (op < 0.92) {
          const d = history.pop();
          if (!d) continue;
          world.applyDiffs(invertDiffs(d)); undone.push(d);
          check(`undo (step ${step})`);
        } else {
          const d = undone.pop();
          if (!d) continue;
          world.applyDiffs(d); history.push(d);
          check(`redo (step ${step})`);
        }
      } catch (e) {
        // Refused edits (too small, would cross a border...) roll back cleanly; anything else fails.
        if (e instanceof assert.AssertionError) throw e;
        assert.match((e as Error).message, /too small|encloses no area|cross|sweep|collapse|joins different|Only a point/, `step ${step}: ${(e as Error).message}`);
        check(`a refused edit (step ${step})`);
      }
    }
  });
}

test('regression: neighbours whose shared border differs by tiny offsets (imported data) insert cleanly', () => {
  for (const seed of [11, 12, 13]) {
    const world = new World();
    const space = cmd.seedProject(world, 'Overlap').result.spaceId;
    const r = rng(seed);
    // A wiggly shared border from (0,0) to (0,10), and two areas on either side of it. The right-hand
    // area repeats the border with offsets of about 2e-6 degrees (as rounding in real data does).
    const border: Array<[number, number]> = [];
    for (let i = 0; i <= 200; i++) border.push([Math.sin(i / 7) * 0.3, i * 0.05]);
    const jitter = () => r.float(-2e-6, 2e-6);
    const left = [...border, [-5, 10], [-5, 0]] as Array<[number, number]>;
    const right = [...border.map(([x, y]) => [x + jitter(), y + jitter()] as [number, number]).reverse(), [5, 0], [5, 10]] as Array<[number, number]>;
    // Left is drawn going north along the border: its inside (west) on the left after reversing.
    const rings = [ring([...left].reverse(), 0.5), ring(right, 0.5)];
    cmd.run(world, 'import', (tx) => tx.kernel(space, (arr) => arr.insertPaths(rings, { closed: true, snap: 1e-8 })));
    const arr = world.arrangement(space);
    assert.deepEqual(arr.validate(), [], `seed ${seed}`);
    assert.deepEqual(arr.checkTopology(), [], `seed ${seed}`);
  }
});
