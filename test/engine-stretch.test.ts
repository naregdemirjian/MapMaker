// The engine works out every parcel's state once per stretch of time between changes and shares it
// between the instants of the stretch; while changes animate, only the parcels changing hands are
// worked out again. The answers must equal a fresh, parcel-by-parcel computation at every instant.
// Restyling and other changes that cannot alter history must not cost a recompile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF, type Instant } from '../src/core-time/index.ts';
import { rng, ring, square } from './helpers.ts';

const D = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });

function build(seed: number) {
  const world = new World();
  const space = cmd.seedProject(world, 'Stretches').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const owners = ['A', 'B', 'C', 'D'].map((name) => cmd.createEntity(world, { type_id: 'polity', name }).result);
  const r = rng(seed);
  cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(square(0, 0, 30)), value: owners[0], snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } });
  const instants: Instant[] = [D(1000), D(3000)];
  for (let i = 0; i < 14; i++) {
    const y = 1500 + i * 10 + r.int(0, 5);
    const animated = r.bool(0.6);
    const ev = cmd.createEvent(world, { name: `E${i}`, start: D(y), end: animated ? D(y + r.int(1, 14)) : null }).result;
    try {
      cmd.paintTerritory(world, engine, {
        spaceId: space, layerId: layer, ring: ring(square(r.float(-20, 20), r.float(-20, 20), r.float(3, 9))), value: r.pick([...owners, null]), snap: 1e-7,
        mode: { kind: 'new', eventId: ev }, transition: animated ? { style: r.pick(['fade', 'advance', 'border'] as const) } : null,
      });
    } catch { /* a refused shape leaves an event without changes */ }
    // Instants at the change, just around it, and inside the animation.
    instants.push(D(y), D(y - 1, 12, 31), D(y, 1, 2), D(y + 1, 6, 15), D(y + 3), D(y + 7, 3, 3));
  }
  return { world, engine, space, layer, owners, instants, r };
}

for (const seed of [1, 2, 3]) {
  test(`shared states of a stretch of time equal a fresh computation at every instant (seed ${seed})`, () => {
    const s = build(seed);
    const arr = s.world.arrangement(s.space);
    let animatedInstants = 0;
    // Asked in a scattered order, some instants twice, as scrubbing does.
    const order = [...s.instants, ...s.instants.slice(3, 20)].sort(() => s.r.next() - 0.5);
    for (const t of order) {
      const states = s.engine.partitionState(s.space, s.layer, t);
      assert.equal(states.size, arr.leafFaces().length);
      let animating = false;
      for (const f of arr.leafFaces()) {
        const fresh = s.engine.faceState(s.space, s.layer, f, t);
        const got = states.get(f)!;
        assert.equal(got.value, fresh.value, `value of parcel ${f} at ${gregorian.format(t, 'day')}`);
        assert.equal(got.assignment, fresh.assignment);
        assert.equal(!!got.transition, !!fresh.transition);
        if (fresh.transition) {
          animating = true;
          assert.equal(got.transition!.from, fresh.transition.from);
          assert.ok(Math.abs(got.transition!.progress - fresh.transition.progress) < 1e-12, 'progress at this very instant');
        }
      }
      if (animating) animatedInstants++;
    }
    assert.ok(animatedInstants > 5, `${animatedInstants} instants inside an animation`);
    // Two instants of one quiet stretch share the very same answer (no work per frame).
    const a = s.engine.partitionState(s.space, s.layer, D(1200)), b = s.engine.partitionState(s.space, s.layer, D(1300, 5, 5));
    assert.equal(a, b);
    assert.equal(s.engine.stretchOf(D(1200)), s.engine.stretchOf(D(1300)));
    assert.notEqual(s.engine.stretchOf(D(1200)), s.engine.stretchOf(D(2900)));
  });
}

test('restyling, renaming and shots do not recompile history; real changes do', () => {
  const s = build(4);
  // (History is brought up to date either by compiling everything or by following the changes.)
  const updates = () => s.engine.stats.compiled + s.engine.stats.followed;
  s.engine.ensure();
  const before = updates();
  cmd.updateEntity(s.world, s.owners[0], { color: '#123456', name: 'Renamed' });
  cmd.setEntityStyle(s.world, s.owners[1], { label: { color: '#ff0000' } });
  cmd.setGeneralLabelStyle(s.world, { sizeScale: 1.2 });
  const shot = cmd.createSequence(s.world, 'Shot', { any: 1 }).result;
  cmd.updateSequence(s.world, shot, { name: 'Shot 2' });
  cmd.updateLayer(s.world, s.layer, { name: 'Politics' });
  s.engine.ensure();
  assert.equal(updates(), before, 'no recompile');
  // The states are still right (and still shared).
  assert.equal(s.engine.partitionState(s.space, s.layer, D(1200)), s.engine.partitionState(s.space, s.layer, D(1201)));
  cmd.createEvent(s.world, { name: 'New', start: D(1700) });
  s.engine.ensure();
  assert.equal(updates(), before + 1, 'a new event recompiles');
  const ev = s.world.all('event').find((e) => e.name === 'E3')!;
  cmd.updateEvent(s.world, ev.id, { start: D(1444) });
  s.engine.ensure();
  assert.equal(updates(), before + 2);
  cmd.deleteEntities(s.world, [s.owners[3]]);
  s.engine.ensure();
  assert.equal(updates(), before + 3, 'deleting a country recompiles');
  assert.deepEqual(s.engine.conflicts.filter((c) => c.kind === 'broken'), []);
});
