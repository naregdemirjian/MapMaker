// Generated border shifts (D195): between a change's before and after, the land the gainer holds at each step
// of time, as real changes of who holds what: growing on the whole from its own border, giving back a piece
// here and there when the other side pushes back, all of it at the end; made again, taken away, undone in one
// step, refused where it makes no sense; the history followed change by change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { buildFrontField } from '../src/render-engine/front-field.ts';
import { borderShiftSteps, shareHeld, shiftDates, MAX_SHIFT_STEPS } from '../src/domain/border-shifts.ts';
import { ring } from './helpers.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });
const box = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test('the steps of a shift: more land at every step, from the gainer\'s border; land given back only when the other side pushes back', () => {
  // A country 20° by 20°, taken from its west border.
  const field = buildFrontField([box(10, -10, 30, 10)], { kind: 'lines', lonlat: [10, -10, 10, 10] }, { roughness: 0.3, seed: 3, cells: 120 })!;
  assert.ok(field);
  const heldCells = (s: { field: typeof field; level: number }) => { const out = new Uint8Array(field.inside.length); for (let k = 0; k < out.length; k++) out[k] = field.inside[k] && s.field.at[k] <= s.level ? 1 : 0; return out; };
  const lost = (steps: ReturnType<typeof borderShiftSteps>) => { let n = 0; for (let i = 1; i < steps.length; i++) { const a = heldCells(steps[i - 1]), b = heldCells(steps[i]); for (let k = 0; k < a.length; k++) if (a[k] && !b[k]) n++; } return n; };
  // Never pushed back: every step holds all the step before held, and more.
  const steady = borderShiftSteps(field, { steps: 10, pushBack: 0, seed: 7 });
  assert.equal(steady.length, 10);
  assert.equal(lost(steady), 0, 'nothing given back');
  // Pushed back: land is given back here and there, yet every step holds more than the last.
  const fought = borderShiftSteps(field, { steps: 10, pushBack: 0.8, seed: 7 });
  assert.ok(lost(fought) > 30, `land given back (${lost(fought)} cells over the steps)`);
  for (const steps of [steady, fought]) {
    const shares = steps.map((s) => shareHeld(field, s));
    for (let i = 1; i < shares.length; i++) assert.ok(shares[i] > shares[i - 1], `more at every step (${shares.map((v) => v.toFixed(2)).join(', ')})`);
    assert.ok(shares[0] > 0.01 && shares[0] < 0.3 && shares[9] > 0.7 && shares[9] < 1, `from a little to nearly all (${shares[0].toFixed(2)} to ${shares[9].toFixed(2)})`);
  }
  // From the gainer's border: early on the west is held and the east is not.
  const early = heldCells(fought[1]);
  const at = (lon: number, lat: number) => early[Math.floor((field.north - lat) / field.dlat) * field.nx + Math.floor((lon - field.west) / field.dlon)];
  assert.equal(at(10.6, 0), 1); assert.equal(at(29, 0), 0); assert.equal(at(29, 8), 0);
  // The same number, the same shifts; another number, others.
  assert.deepEqual(borderShiftSteps(field, { steps: 10, pushBack: 0.8, seed: 7 }).map((s) => s.cells), fought.map((s) => s.cells));
  assert.notDeepEqual(borderShiftSteps(field, { steps: 10, pushBack: 0.8, seed: 8 }).map((s) => s.cells), fought.map((s) => s.cells));
  // The steps' dates: from the start, while before the end.
  assert.deepEqual(shiftDates(0, 10, (t) => t + 3, (a, b) => a < b), [0, 3, 6, 9]);
  assert.equal(borderShiftSteps(field, { steps: 500, pushBack: 0, seed: 1 }).length, MAX_SHIFT_STEPS);
});

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Shifts').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const country = (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result;
  const A = country('Aldmark'), B = country('Bergholt'), C = country('Corvia');
  const start = (owner: string, pts: Array<[number, number]>) => cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(pts), value: owner, snap: 1e-9, mode: { kind: 'correct', t: NEG_INF } });
  start(A, box(-10, -10, 10, 10));
  start(B, box(10, -10, 30, 10));
  start(C, box(-10, 20, 30, 30));
  // The war: Aldmark takes all of Bergholt, drawn as one change on 1 January 1900.
  const war = cmd.createEvent(world, { name: 'The Bergholt War', type_id: 'war', start: Y(1900), end: null } as never).result;
  cmd.paintTerritory(world, engine, { spaceId: space, layerId: layer, ring: ring(box(10, -10, 30, 10)), value: A, snap: 1e-9, mode: { kind: 'new', eventId: war } });
  const change = world.all('effect').find((f) => f.event_id === war)!.id;
  const at = (lon: number, lat: number, t = Y(2000)) => engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), t);
  /** The share of Bergholt's old land Aldmark holds at a moment, looked at in 900 places. */
  const share = (t: ReturnType<typeof Y>) => { let n = 0; for (let j = 0; j < 30; j++) for (let i = 0; i < 30; i++) if (at(10 + ((i + 0.5) / 30) * 20, -10 + ((j + 0.5) / 30) * 20, t) === A) n++; return n / 900; };
  return { world, engine, space, layer, A, B, C, war, change, at, share };
}

test('border shifts generated for a change: real changes month by month, all of it at the end; undone in one step', () => {
  const s = setup();
  Engine.verify = true;
  Engine.verifyFailures = [];
  try {
    assert.equal(s.share(Y(1900, 1, 2)), 1, 'as drawn: all at once');
    const r = cmd.generateBorderShifts(s.world, s.engine, { effectId: s.change, every: { n: 1, unit: 'month' }, until: Y(1901), pushBack: 0.7, roughness: 0.3, seed: 5, snap: 1e-9 });
    assert.equal(r.result.steps, 12, 'a step a month from January to December');
    assert.equal(r.label, 'Generate border shifts');
    // Before, Bergholt holds its land; month by month Aldmark holds more; from 1901 all of it.
    assert.equal(s.share(Y(1899, 12, 31)), 0);
    const shares = Array.from({ length: 12 }, (_, m) => s.share(Y(1900, m + 1, 15)));
    for (let m = 1; m < 12; m++) assert.ok(shares[m] > shares[m - 1], `more every month (${shares.map((v) => v.toFixed(2)).join(', ')})`);
    assert.ok(shares[0] > 0 && shares[0] < 0.3 && shares[11] > 0.7 && shares[11] < 1, `from a little to nearly all (${shares[0].toFixed(2)} to ${shares[11].toFixed(2)})`);
    assert.equal(s.share(Y(1901, 1, 2)), 1, 'all of it at the end');
    assert.equal(s.at(11, 0, Y(1900, 2, 15)), s.A, 'from Aldmark\'s own border first');
    assert.equal(s.at(29, 0, Y(1900, 2, 15)), s.B, 'the far side still Bergholt\'s');
    // The other side pushes back: somewhere land Aldmark held one month is Bergholt's again the next.
    let back = 0;
    for (let m = 1; m < 12; m++) for (let j = 0; j < 30; j++) for (let i = 0; i < 30; i++) {
      const lon = 10 + ((i + 0.5) / 30) * 20, lat = -10 + ((j + 0.5) / 30) * 20;
      if (s.at(lon, lat, Y(1900, m, 15)) === s.A && s.at(lon, lat, Y(1900, m + 1, 15)) === s.B) back++;
    }
    assert.ok(back > 5, `land retaken by Bergholt here and there (${back} of the places looked at)`);
    // Nobody else's land is touched, at any time.
    for (const t of [Y(1900, 3, 15), Y(1900, 9, 15), Y(1950)]) { assert.equal(s.at(0, 0, t), s.A); assert.equal(s.at(10, 25, t), s.C); assert.equal(s.at(40, 0, t), null); }
    // What was written: dated changes in the war, the change itself at the end, the war lasting until then.
    const made = cmd.generatedShifts(s.world, s.change);
    assert.ok(made.length >= 10 && made.length <= 12, `${made.length} changes`);
    assert.ok(made.every((f) => f.event_id === s.war && f.kind === 'assign'));
    const kept = cmd.borderShiftsOf(s.world, s.change)!;
    assert.deepEqual([kept.steps, kept.every, kept.pushBack, kept.seed], [12, { n: 1, unit: 'month' }, 0.7, 5]);
    const ev = s.world.get('event', s.war)!, ef = s.world.get('effect', s.change)!;
    assert.deepEqual([ef.at_day, ev.end_day], [Y(1901).day, Y(1901).day]);
    assert.deepEqual(Engine.verifyFailures, [], 'history followed change by change is history worked out afresh');
    // Undone in one step: the change as drawn, no generated ones.
    s.world.applyDiffs(invertDiffs(r.diffs));
    assert.equal(cmd.generatedShifts(s.world, s.change).length, 0);
    assert.equal(cmd.borderShiftsOf(s.world, s.change), null);
    assert.equal(s.share(Y(1900, 1, 2)), 1, 'undone: all at once again');
  } finally { Engine.verify = false; }
});

test('border shifts made again, without push-back, taken away; refused where they make no sense', () => {
  const s = setup();
  const gen = (o: Partial<Parameters<typeof cmd.generateBorderShifts>[2]> = {}) => cmd.generateBorderShifts(s.world, s.engine, { effectId: s.change, every: { n: 2, unit: 'month' }, until: Y(1901), pushBack: 0.7, roughness: 0.3, seed: 5, snap: 1e-9, ...o });
  assert.equal(gen().result.steps, 6);
  const first = [3, 7, 11].map((m) => s.share(Y(1900, m, 15)));
  // Again with another number: other shifts in place of the first (not on top of them).
  gen({ seed: 6 });
  assert.ok(cmd.generatedShifts(s.world, s.change).length <= 6);
  assert.notDeepEqual([3, 7, 11].map((m) => s.share(Y(1900, m, 15))), first);
  assert.equal(s.share(Y(1899, 12, 31)), 0); assert.equal(s.share(Y(1901, 1, 2)), 1);
  // Without push-back: what Aldmark holds it keeps.
  gen({ pushBack: 0, every: { n: 1, unit: 'month' } });
  for (let m = 1; m < 12; m++) for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) {
    const lon = 10 + ((i + 0.5) / 20) * 20, lat = -10 + ((j + 0.5) / 20) * 20;
    assert.ok(!(s.at(lon, lat, Y(1900, m, 15)) === s.A && s.at(lon, lat, Y(1900, m + 1, 15)) === s.B), `nothing given back at ${lon}, ${lat} in month ${m + 1}`);
  }
  // By weeks and by days.
  assert.equal(gen({ every: { n: 3, unit: 'week' }, until: Y(1900, 3, 1) }).result.steps, 3);
  assert.equal(gen({ every: { n: 10, unit: 'day' }, until: Y(1900, 2, 1) }).result.steps, 4);
  // Taken away: the change as it was drawn.
  const before = s.world.get('effect', s.change)!.transition;
  cmd.removeBorderShifts(s.world, s.change);
  assert.equal(cmd.generatedShifts(s.world, s.change).length, 0);
  assert.equal(s.world.get('effect', s.change)!.at_day, Y(1900).day);
  assert.equal(s.world.get('effect', s.change)!.transition, before);
  assert.equal(s.share(Y(1900, 1, 2)), 1);
  assert.throws(() => cmd.removeBorderShifts(s.world, s.change), /no generated border shifts/);
  // Refused: an end not after the change, too many steps, a step itself, land given to nobody, a locked country.
  assert.throws(() => gen({ until: Y(1900) }), /an end after/);
  assert.throws(() => gen({ every: { n: 1, unit: 'day' }, until: Y(1901) }), /more than 60 steps/);
  gen();
  assert.throws(() => cmd.generateBorderShifts(s.world, s.engine, { effectId: cmd.generatedShifts(s.world, s.change)[0].id, every: { n: 1, unit: 'month' }, until: Y(1902), pushBack: 0, roughness: 0, seed: 1, snap: 1e-9 }), /one of the generated shifts/);
  cmd.removeBorderShifts(s.world, s.change);
  cmd.setLocked(s.world, [s.B], true);
  assert.throws(() => gen(), /Bergholt.*locked/);
  cmd.setLocked(s.world, [s.B], false);
  const peace = cmd.createEvent(s.world, { name: 'Withdrawal', type_id: 'war', start: Y(1950), end: null } as never).result;
  cmd.paintTerritory(s.world, s.engine, { spaceId: s.space, layerId: s.layer, ring: ring(box(-10, 20, 30, 30)), value: null, snap: 1e-9, mode: { kind: 'new', eventId: peace } });
  assert.throws(() => cmd.generateBorderShifts(s.world, s.engine, { effectId: s.world.all('effect').find((f) => f.event_id === peace)!.id, every: { n: 1, unit: 'month' }, until: Y(1951), pushBack: 0, roughness: 0, seed: 1, snap: 1e-9 }), /one country gains/);
});
