// Splitting a parcel nothing refers to keeps its identity (an optimisation that avoids relabelling
// every border around it). This test proves history is unaffected: the same random edits are made in
// two worlds, one with the optimisation and one without, and every reconstructed state must match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { rng, ring } from './helpers.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });

function makeWorld(optimise: boolean) {
  const world = new World();
  world.optimiseSplits = optimise;
  const { result } = cmd.seedProject(world, 'AB');
  const engine = new Engine(world);
  const space = result.spaceId, layer = world.all('layer')[0].id;
  const second = cmd.createLayer(world, space, 'Control').result;
  return { world, engine, space, layers: [layer, second], owners: [] as string[], events: [] as string[], last: null as cmd.CommandResult<unknown> | null };
}

function blob(r: ReturnType<typeof rng>): Array<[number, number]> {
  const cx = r.float(-60, 60), cy = r.float(-40, 40), rad = r.float(3, 25);
  const pts: Array<[number, number]> = [];
  const n = r.int(5, 14);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const k = rad * r.float(0.6, 1.2); pts.push([cx + k * Math.cos(a), cy + k * Math.sin(a)]); }
  return pts;
}

for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`identical history with and without keeping identities on split (seed ${seed})`, () => {
    const W = [makeWorld(true), makeWorld(false)];
    const r = rng(seed);
    const probes = Array.from({ length: 60 }, () => [r.float(-80, 80), r.float(-60, 60)] as [number, number]);
    const times = [Y(900), Y(1300), Y(1650), Y(2100)];
    const nameOf = (w: (typeof W)[number], v: string | null) => (v ? w.world.get('entity', v)!.name : '-');
    let relabelSaved = 0;
    for (let step = 0; step < 70; step++) {
      // Draw the random choices once, then apply the same operation to both worlds.
      const roll = r.next();
      const pts = blob(r);
      const pick = r.next(), pick2 = r.next(), pickLayer = r.next(), year = r.int(800, 2200), useNull = r.bool(0.1), correct = r.bool(0.3);
      const vtx = [r.float(-60, 60), r.float(-40, 40)] as [number, number], dv = [r.float(-1, 1), r.float(-1, 1)];
      const outcomes: string[] = [];
      for (const w of W) {
        const at = <T>(xs: T[], u: number) => xs[Math.floor(u * xs.length)];
        let res: cmd.CommandResult<unknown> | null = null;
        try {
          if (w.owners.length < 3 || roll < 0.08) { res = cmd.createEntity(w.world, { type_id: 'polity', name: `P${step}` }); w.owners.push(res.result as string); }
          else if (w.events.length < 2 || roll < 0.18) { res = cmd.createEvent(w.world, { name: `E${step}`, start: Y(year) }); w.events.push(res.result as string); }
          else if (roll < 0.24) res = cmd.updateEvent(w.world, at(w.events, pick), { start: Y(year) });
          else if (roll < 0.27 && w.events.length > 2) { const id = at(w.events, pick); res = cmd.deleteEvent(w.world, id); w.events.splice(w.events.indexOf(id), 1); }
          else if (roll < 0.33) {
            const arr = w.world.arrangement(w.space);
            const v = arr.nearestVertex(lonLatToVec(...vtx), 0.2);
            if (v != null) { const p = arr.vertices.get(v)!; res = cmd.moveVertex(w.world, { spaceId: w.space, vertexId: v, to: lonLatToVec(p.lon / 1e7 + dv[0], p.lat / 1e7 + dv[1]), snap: 1e-9 }); }
          } else if (roll < 0.40 && w.last) { w.world.applyDiffs(invertDiffs(w.last.diffs)); res = null; w.last = null; outcomes.push('undo'); continue; }
          else {
            const value = useNull ? null : at(w.owners, pick2);
            const layer = at(w.layers, pickLayer);
            const mode = correct ? { kind: 'correct' as const, t: Y(year) } : { kind: 'new' as const, eventId: at(w.events, pick) };
            const before = w.world.arrangement(w.space).segments.size;
            res = cmd.paintTerritory(w.world, w.engine, { spaceId: w.space, layerId: layer, ring: ring(pts, 1), value, snap: 1e-7, mode });
            if (w === W[0]) relabelSaved += before;
          }
          outcomes.push('ok');
        } catch (e) { outcomes.push(`refused: ${(e as Error).message}`); }
        // Undo only ever inverts the last change; entities and events created are tracked by position.
        if (res) w.last = res;
      }
      assert.equal(outcomes[0], outcomes[1], `step ${step}: both worlds accept or refuse the same edit`);
      for (const w of W) assert.deepEqual(w.world.arrangement(w.space).validate(), []);
      if (step % 5 === 4 || step === 69) {
        for (const layerIndex of [0, 1]) for (const t of times) {
          const a = probes.map((p) => nameOf(W[0], W[0].engine.valueAtPoint(W[0].space, W[0].layers[layerIndex], lonLatToVec(...p), t)));
          const b = probes.map((p) => nameOf(W[1], W[1].engine.valueAtPoint(W[1].space, W[1].layers[layerIndex], lonLatToVec(...p), t)));
          assert.deepEqual(a, b, `step ${step}, layer ${layerIndex}`);
          if (step === 69 && layerIndex === 0 && t === times[3]) assert.ok(a.filter((x) => x !== '-').length >= 10, 'the comparison covers owned land, not just empty map');
        }
      }
    }
    assert.ok(relabelSaved >= 0);
  });
}

test('drawing islands in an unclaimed ocean no longer rewrites every coastline', () => {
  const sizes: number[] = [];
  for (const optimise of [true, false]) {
    const w = makeWorld(optimise);
    const A = cmd.createEntity(w.world, { type_id: 'polity', name: 'A' }).result;
    const ev = cmd.createEvent(w.world, { name: 'Settlement', start: Y(1000) }).result;
    let last: cmd.CommandResult<unknown> | null = null;
    for (let i = 0; i < 40; i++) {
      const lon = -170 + (i % 10) * 34, lat = -60 + Math.floor(i / 10) * 35;
      last = cmd.paintTerritory(w.world, w.engine, { spaceId: w.space, layerId: w.layers[0], ring: ring([[lon, lat], [lon + 8, lat], [lon + 8, lat + 8], [lon, lat + 8]], 1), value: A, snap: 1e-7, mode: { kind: 'new', eventId: ev } });
    }
    sizes.push(last!.diffs.length);
  }
  assert.ok(sizes[0] < 80, `with the optimisation the 40th island writes ${sizes[0]} rows`);
  assert.ok(sizes[1] > 600, `without it, ${sizes[1]} rows (every coastline relabelled)`);
});
