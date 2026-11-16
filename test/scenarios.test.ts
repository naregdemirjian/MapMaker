// Realistic history scenarios, driven through the same commands the interface uses.
// Every assertion reads the reconstructed state from the engine; nothing is stored as a picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF, type Instant, instant, add } from '../src/core-time/index.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';
import { ring, square } from './helpers.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });
const T = (text: string) => gregorian.parse(text)!.instant;

function setup(radiusKm = 6371) {
  const world = new World();
  const { result } = cmd.seedProject(world, 'Scenario', { name: 'Test world', radiusKm });
  const spaceId = result.spaceId;
  const layerId = world.all('layer').find((l) => l.space_id === spaceId)!.id;
  const engine = new Engine(world);
  const s = {
    world, engine, spaceId, layerId,
    ent: (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result,
    event: (name: string, start: Instant, end: Instant | null = null, precedence = 0) => cmd.createEvent(world, { name, start, end, precedence }).result,
    paint: (pts: Array<[number, number]>, value: string | null, eventId: string, o: { at?: Instant | null; transition?: any; layer?: string; space?: string } = {}) =>
      cmd.paintTerritory(world, engine, { spaceId: o.space ?? spaceId, layerId: o.layer ?? layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'new', eventId, at: o.at ?? null }, transition: o.transition ?? null }),
    base: (pts: Array<[number, number]>, value: string | null, o: { layer?: string; space?: string } = {}) =>
      cmd.paintTerritory(world, engine, { spaceId: o.space ?? spaceId, layerId: o.layer ?? layerId, ring: ring(pts), value, snap: 1e-7, mode: { kind: 'correct', t: NEG_INF } }),
    at: (lon: number, lat: number, t: Instant, layer = layerId, space = spaceId) => engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), t),
    validate: () => assert.deepEqual(world.arrangement(spaceId).validate(), []),
  };
  return s;
}

/** Owners at a grid of probe points for several dates: a fingerprint of the whole history. */
function fingerprint(s: ReturnType<typeof setup>, times: Instant[]): string {
  const out: string[] = [];
  for (const t of times) for (let lon = 1; lon < 40; lon += 2.5) for (let lat = 31; lat < 60; lat += 2.5) out.push(String(s.at(lon, lat, t)));
  return out.join(',');
}

test('a region history: formation, secession, split, conquest, insertion, deletion and moving an event', () => {
  const s = setup();
  const empire = s.ent('Empire'), north = s.ent('Northern Kingdom'), west = s.ent('Western Republic');
  // Base world: the Empire holds a block of 30° by 30°.
  s.base([[0, 30], [30, 30], [30, 60], [0, 60]], empire);
  // 14 May 1203: the Northern Kingdom forms by secession in the north-east.
  const secession = s.event('Northern secession', Y(1203, 5, 14));
  s.paint([[15, 45], [30, 45], [30, 60], [15, 60]], north, secession);
  // 1240: the Empire splits; its western half becomes a republic.
  const split = s.event('Partition of the Empire', Y(1240));
  s.paint([[0, 30], [12, 30], [12, 60], [0, 60]], west, split);
  s.validate();

  const probe = { ne: [22, 52], sw: [5, 35], se: [22, 35], nw: [5, 55] } as const;
  const at = (k: keyof typeof probe, t: Instant) => s.at(probe[k][0], probe[k][1], t);
  assert.deepEqual([at('ne', Y(1200)), at('sw', Y(1200)), at('se', Y(1200))], [empire, empire, empire]);
  assert.deepEqual([at('ne', Y(1210)), at('sw', Y(1210))], [north, empire]);
  assert.deepEqual([at('ne', Y(1250)), at('sw', Y(1250)), at('nw', Y(1250)), at('se', Y(1250))], [north, west, west, empire]);

  // Insert an event between the two: 1220, the Northern Kingdom expands west across the north.
  const before1203 = fingerprint(s, [Y(1100), Y(1203, 5, 13)]);
  const expansion = s.event('Northern expansion', Y(1220));
  s.paint([[0, 52], [15, 52], [15, 60], [0, 60]], north, expansion);
  assert.equal(fingerprint(s, [Y(1100), Y(1203, 5, 13)]), before1203, 'history before the inserted event is untouched');
  assert.equal(at('nw', Y(1215)), empire);
  assert.equal(at('nw', Y(1225)), north);
  // The 1240 partition repaints the west, so the north-west goes to the republic again from 1240.
  assert.equal(at('nw', Y(1245)), west);
  s.validate();

  // Delete the partition: later states revert, earlier states do not move.
  const until1239 = fingerprint(s, [Y(1100), Y(1210), Y(1230), Y(1239, 12, 31)]);
  cmd.deleteEvent(s.world, split);
  assert.equal(fingerprint(s, [Y(1100), Y(1210), Y(1230), Y(1239, 12, 31)]), until1239);
  assert.equal(at('sw', Y(1250)), empire);
  assert.equal(at('nw', Y(1250)), north);

  // Move the expansion from 1220 to 1260: between those dates the north-west is the Empire's again.
  cmd.updateEvent(s.world, expansion, { start: Y(1260) });
  assert.equal(at('nw', Y(1230)), empire);
  assert.equal(at('nw', Y(1270)), north);
  assert.equal(at('ne', Y(1210)), north, 'the unrelated secession is unaffected');
  assert.deepEqual(s.engine.conflicts, []);
});

test('the same date always reconstructs the same state, whatever order the history was entered in', () => {
  const build = (order: number[]) => {
    const s = setup();
    const a = s.ent('A'), b = s.ent('B'), c = s.ent('C');
    const ids = [a, b, c];
    s.base([[0, 30], [40, 30], [40, 60], [0, 60]], a);
    const steps = [
      () => s.paint([[10, 35], [25, 35], [25, 50], [10, 50]], ids[1], s.event('One', Y(1500))),
      () => s.paint([[20, 40], [35, 40], [35, 55], [20, 55]], ids[2], s.event('Two', Y(1600))),
      () => s.paint([[5, 45], [15, 45], [15, 58], [5, 58]], ids[1], s.event('Three', Y(1550))),
      () => s.paint([[12, 32], [30, 32], [30, 44], [12, 44]], null, s.event('Four', Y(1700))),
    ];
    for (const i of order) steps[i]();
    // Entity ids differ between builds; compare by name.
    const name = (v: string | null) => (v ? s.world.get('entity', v)!.name : '-');
    return [Y(1400), Y(1520), Y(1575), Y(1650), Y(1750)].map((t) => {
      const row: string[] = [];
      for (let lon = 1; lon < 40; lon += 3) for (let lat = 31; lat < 60; lat += 3) row.push(name(s.at(lon, lat, t)));
      return row.join('');
    }).join('|');
  };
  const reference = build([0, 1, 2, 3]);
  for (const order of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) assert.equal(build(order), reference, `order ${order}`);
});

test('simultaneous changes: different areas both apply; the same area follows precedence and is flagged', () => {
  const s = setup();
  const a = s.ent('A'), b = s.ent('B'), c = s.ent('C');
  s.base(square(20, 45, 15), a);
  const e1 = s.event('Treaty clause one', Y(1815, 6, 9), null, 0);
  const e2 = s.event('Treaty clause two', Y(1815, 6, 9), null, 0);
  s.paint(square(10, 40, 3), b, e1);
  s.paint(square(30, 50, 3), c, e2);
  assert.equal(s.at(10, 40, Y(1816)), b);
  assert.equal(s.at(30, 50, Y(1816)), c);
  assert.equal(s.engine.conflicts.length, 0, 'different areas at the same moment are not a conflict');

  // Same place, same moment, same precedence: unresolved, so it is reported.
  const e3 = s.event('Rival claim', Y(1815, 6, 9), null, 0);
  s.paint(square(10, 40, 2), c, e3);
  assert.ok(s.engine.conflicts.some((k) => k.kind === 'simultaneous'), 'the clash is reported');
  const first = s.at(10, 40, Y(1816));
  assert.ok(first === b || first === c, 'a consistent winner meanwhile');
  assert.equal(s.at(10, 40, Y(1816)), first, 'and the same one every time');
  // Setting which wins resolves it (the design's "set which wins"), and the report goes away.
  cmd.updateEvent(s.world, e3, { precedence: 5 });
  assert.equal(s.at(10, 40, Y(1816)), c, 'higher precedence wins');
  assert.ok(!s.engine.conflicts.some((k) => k.kind === 'simultaneous'), 'resolved, so no longer reported');
  cmd.updateEvent(s.world, e3, { precedence: -5 });
  assert.equal(s.at(10, 40, Y(1816)), b, 'changing the precedence changes the winner');
});

test('overlapping changes with durations are flagged, not silently overwritten, and durations are respected', () => {
  const s = setup();
  const a = s.ent('A'), b = s.ent('B'), c = s.ent('C');
  s.base(square(20, 45, 15), a);
  const war = s.event('Long war', Y(1914, 7, 28), Y(1918, 11, 11));
  s.paint(square(20, 45, 6), b, war, { transition: { style: 'fade' } });
  const rising = s.event('Rising', Y(1916, 4, 24), Y(1916, 4, 29));
  s.paint(square(22, 47, 2), c, rising, { transition: { style: 'fade' } });
  const overlap = s.engine.conflicts.filter((k) => k.kind === 'overlap');
  assert.equal(overlap.length, 1, 'the overlap is reported in History Health');
  // During the war the area is in transition; its final owner is decided at the end of the war.
  const mid = s.engine.faceState(s.spaceId, s.layerId, s.world.arrangement(s.spaceId).locate(lonLatToVec(16, 41)), Y(1916));
  assert.ok(mid.transition && mid.transition.progress > 0.3 && mid.transition.progress < 0.7, 'halfway through the war');
  assert.equal(s.at(22, 47, Y(1916, 4, 23)), a, 'before the rising: the war\'s fade is under halfway, so A still holds it');
  assert.equal(s.at(16, 41, Y(1917, 1, 1)), b, 'past halfway through the war, B holds the war zone');
  assert.equal(s.at(22, 47, Y(1916, 5, 1)), c, 'after the rising: the later-starting change has taken over');
  assert.equal(s.at(16, 41, Y(1919)), b);
  assert.equal(s.at(22, 47, Y(1919)), c);
  assert.equal(s.at(16, 41, Y(1914, 7, 27)), a, 'nothing changes before the war starts');
});

test('changes seconds and milliseconds apart, and dates ten thousand years apart', () => {
  const s = setup();
  const a = s.ent('A'), b = s.ent('B'), c = s.ent('C');
  s.base(square(0, 0, 10), a);
  const t0 = T('1944-06-06T06:30');
  const e1 = s.event('First wave', t0);
  const e2 = s.event('Second wave', instant(t0.day, t0.ms + 1000));
  const e3 = s.event('Third wave', instant(t0.day, t0.ms + 1001));
  s.paint(square(-5, 0, 3), b, e1);
  s.paint(square(-5, 0, 3), c, e2);
  s.paint(square(-5, 0, 3), a, e3);
  assert.equal(s.at(-5, 0, instant(t0.day, t0.ms - 1)), a);
  assert.equal(s.at(-5, 0, t0), b);
  assert.equal(s.at(-5, 0, instant(t0.day, t0.ms + 999)), b);
  assert.equal(s.at(-5, 0, instant(t0.day, t0.ms + 1000)), c);
  assert.equal(s.at(-5, 0, instant(t0.day, t0.ms + 1001)), a);

  const ancient = s.event('Ancient migration', T('10000 BCE'));
  const future = s.event('Colony charter', T('12000'));
  s.paint(square(5, 0, 3), b, ancient);
  s.paint(square(5, 0, 3), c, future);
  assert.equal(s.at(5, 0, T('10001 BCE')), a);
  assert.equal(s.at(5, 0, T('1 CE')), b);
  assert.equal(s.at(5, 0, T('11999')), b);
  assert.equal(s.at(5, 0, T('12000')), c);
  assert.equal(s.at(-5, 0, T('1944-06-06T06:30')), b, 'the minute-scale history is unaffected by the millennial events');
});

test('an advancing front spreads over the event duration, and the event length can be anything from minutes to years', () => {
  for (const [start, end] of [[T('1453-04-06'), T('1453-05-29')], [T('2001-01-01T12:00'), T('2001-01-01T12:20')]] as const) {
    const s = setup();
    const a = s.ent('A'), b = s.ent('B');
    s.base(square(20, 45, 15), a);
    const ev = s.event('Advance', start, end);
    s.paint(square(20, 45, 8), b, ev, { transition: { style: 'advance', origin: [12, 37], easing: 'linear' } });
    const near = [13, 38] as const, far = [27, 52] as const;
    const midT = instant(start.day + Math.floor((end.day - start.day) / 2), Math.round((start.ms + end.ms) / 2));
    assert.equal(s.at(...near, start), a);
    assert.equal(s.at(...near, add(start, 0, 1)), a, 'the instant after the start the front has not reached a point 1.4° away');
    assert.equal(s.at(...near, midT), b, 'halfway: the near corner has been reached');
    assert.equal(s.at(...far, midT), a, 'halfway: the far corner has not');
    assert.equal(s.at(...far, end), b, 'at the end everything has been reached');
    // Arrival times grow with distance from the origin.
    const arr = s.world.arrangement(s.spaceId);
    const st = s.engine.faceState(s.spaceId, s.layerId, arr.locate(lonLatToVec(...far)), end);
    const tNear = s.engine.arrivalTime(st.assignment!, lonLatToVec(...near));
    const tFar = s.engine.arrivalTime(st.assignment!, lonLatToVec(...far));
    assert.ok(tNear.day * 864e5 + tNear.ms < tFar.day * 864e5 + tFar.ms);
  }
});

test('occupation on a separate layer leaves ownership untouched', () => {
  const s = setup();
  const a = s.ent('A'), b = s.ent('B');
  const control = cmd.createLayer(s.world, s.spaceId, 'Military control').result;
  s.base(square(20, 45, 15), a);
  s.base(square(20, 45, 15), a, { layer: control });
  const occupation = s.event('Occupation', Y(1940, 6, 14), null);
  s.paint(square(15, 48, 5), b, occupation, { layer: control });
  const liberation = s.event('Liberation', Y(1944, 8, 25), null);
  s.paint(square(15, 48, 5), a, liberation, { layer: control });
  assert.equal(s.at(15, 48, Y(1942)), a, 'still legally A');
  assert.equal(s.at(15, 48, Y(1942), control), b, 'but controlled by B');
  assert.equal(s.at(15, 48, Y(1945), control), a);
  assert.equal(s.at(15, 48, Y(1939), control), a);
});

test('editing one event never corrupts another event, an entity, or another layer', () => {
  const s = setup();
  const a = s.ent('A'), b = s.ent('B'), c = s.ent('C');
  const religion = cmd.createLayer(s.world, s.spaceId, 'Religion').result;
  s.base(square(20, 45, 15), a);
  s.base(square(20, 45, 15), c, { layer: religion });
  const e1 = s.event('One', Y(1600));
  s.paint(square(12, 40, 4), b, e1);
  const e2 = s.event('Two', Y(1700));
  s.paint(square(28, 50, 4), b, e2);
  const snapshot = () => JSON.stringify({
    events: s.world.all('event').filter((e) => e.id !== e2).map((e) => [e.id, e.name, e.start_day, e.end_day]),
    effects: s.world.all('effect').filter((f) => f.event_id !== e2).map((f) => [f.id, f.resolution]),
    entities: s.world.all('entity').map((e) => [e.id, e.name, e.color]),
    religion: [Y(1500), Y(1800)].map((t) => s.at(28, 50, t, religion)),
  });
  const before = snapshot();
  cmd.updateEvent(s.world, e2, { start: Y(1650), name: 'Two (redated)' });
  cmd.setEffectTransition(s.world, s.world.all('effect').find((f) => f.event_id === e2)!.id, { style: 'fade' });
  cmd.updateEvent(s.world, e2, { end: Y(1660) });
  assert.equal(snapshot(), before);
  assert.equal(s.at(12, 40, Y(1610)), b);
  assert.equal(s.at(28, 50, Y(1661)), b);
});

test('countries forming from nothing, fragmenting into many pieces and collapsing to nobody', () => {
  const s = setup();
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  const ids = names.map((n) => s.ent(n));
  const founding = s.event('Founding', Y(800));
  s.paint(square(20, 45, 12), ids[0], founding);
  // Fragmentation: five successor states carve it up at the same moment.
  const breakup = s.event('Fragmentation', Y(900));
  for (let i = 1; i < 6; i++) s.paint([[8 + (i - 1) * 4.8, 33], [8 + i * 4.8, 33], [8 + i * 4.8, 57], [8 + (i - 1) * 4.8, 57]], ids[i], breakup);
  const collapse = s.event('Collapse', Y(1000));
  s.paint(square(20, 45, 12), null, collapse);
  assert.equal(s.at(20, 45, Y(700)), null);
  assert.equal(s.at(20, 45, Y(850)), ids[0]);
  const at900 = [10, 15, 20, 25, 30].map((lon) => s.at(lon, 45, Y(950)));
  assert.deepEqual(at900, ids.slice(1));
  assert.equal(s.at(20, 45, Y(1001)), null);
  s.validate();
  assert.deepEqual(s.engine.conflicts, []);
});
