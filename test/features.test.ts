// Areas, lines and points on feature layers (Stage 4): independent of the parcel map, free to overlap,
// with lifespans and dated shapes. Made with or without an event, corrected for a period, ended at a
// date, reshaped; undo, deleting, reloading, broken references; followed change by change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { featureStyle, featureColor } from '../src/render-engine/feature-style.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });
type P = Array<[number, number]>;
const sq = (lon: number, lat: number, h: number): P => [[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h]];

function setup() {
  const world = new World();
  const space = cmd.seedProject(world, 'Features').result.spaceId;
  const territory = world.all('layer')[0].id;
  const engine = new Engine(world);
  const areas = cmd.createLayer(world, space, 'Claims', 'area').result;
  const lines = cmd.createLayer(world, space, 'Fronts', 'line').result;
  const points = cmd.createLayer(world, space, 'Battles', 'point').result;
  const shape = (layer: string, t: ReturnType<typeof Y>, id: string) => engine.featuresAt(layer, t).find((f) => f.feature === id)?.parts ?? null;
  return { world, space, territory, engine, areas, lines, points, shape };
}

test('feature layers: each kind holds its own shapes; the parcel map and territory are untouched', () => {
  const s = setup();
  const segments = s.world.arrangement(s.space).segments.size;
  const claim = cmd.createFeature(s.world, { layerId: s.areas, name: 'Northern claim', parts: [sq(10, 50, 2)], mode: { kind: 'correct', t: NEG_INF } }).result;
  // A second claim over the first: features overlap freely.
  const other = cmd.createFeature(s.world, { layerId: s.areas, name: 'Southern claim', parts: [sq(11, 49, 2)], mode: { kind: 'correct', t: NEG_INF } }).result;
  const front = cmd.createFeature(s.world, { layerId: s.lines, name: 'Front', parts: [[[0, 40], [5, 42], [10, 41]]], mode: { kind: 'change', t: Y(1914) } }).result;
  const battle = cmd.createFeature(s.world, { layerId: s.points, name: 'Battle of the Ford', parts: [[[3, 45]]], mode: { kind: 'change', t: Y(1915, 6) } }).result;
  assert.equal(s.world.arrangement(s.space).segments.size, segments, 'no borders were cut');
  assert.equal(s.engine.valueAtPoint(s.space, s.territory, [0.6, 0.1, 0.79] as never, Y(1950)), null, 'nobody owns land because of a feature');
  assert.deepEqual(s.engine.featuresAt(s.areas, Y(1000)).map((f) => f.feature).sort(), [claim, other].sort(), 'overlapping areas both exist');
  assert.equal(s.shape(s.lines, Y(1913), front), null, 'the front does not exist before 1914');
  assert.deepEqual(s.shape(s.lines, Y(1914), front), [[0, 40, 5, 42, 10, 41]]);
  assert.deepEqual(s.shape(s.points, Y(1916), battle), [[3, 45]]);
  assert.equal(s.shape(s.points, Y(1915), battle), null);
  // Each kind checks its shape.
  assert.throws(() => cmd.createFeature(s.world, { layerId: s.areas, name: 'x', parts: [[[0, 0], [1, 1]]], mode: { kind: 'correct', t: NEG_INF } }), /at least three/);
  assert.throws(() => cmd.createFeature(s.world, { layerId: s.lines, name: 'x', parts: [[[0, 0]]], mode: { kind: 'correct', t: NEG_INF } }), /at least two/);
  assert.throws(() => cmd.createFeature(s.world, { layerId: s.territory, name: 'x', parts: [sq(0, 0, 1)], mode: { kind: 'correct', t: NEG_INF } }), /layer of areas, lines or points/);
  assert.deepEqual(s.engine.conflicts, []);
});

test('dated shapes and lifespans: reshape from a date, correct the period in view, end it, give it back', () => {
  const s = setup();
  const front = cmd.createFeature(s.world, { layerId: s.lines, name: 'Western Front', parts: [[[0, 50], [2, 47], [6, 45]]], mode: { kind: 'change', t: Y(1914, 9) } }).result;
  // The front moves in 1918 (no event): before, the first shape; after, the new one.
  cmd.reshapeFeature(s.world, s.engine, { feature: front, parts: [[[2, 50], [4, 47], [7, 45]]], mode: { kind: 'change', t: Y(1918, 7) } });
  assert.equal(s.shape(s.lines, Y(1916), front)![0][0], 0);
  assert.equal(s.shape(s.lines, Y(1918, 8), front)![0][0], 2);
  // Correcting the period in view (1916) redraws the 1914 shape where it stands, nothing else.
  const effects = s.world.all('effect').filter((f) => f.kind === 'shape').length;
  cmd.reshapeFeature(s.world, s.engine, { feature: front, parts: [[[1, 50], [2, 47], [6, 45]]], mode: { kind: 'correct', t: Y(1916) } });
  assert.equal(s.world.all('effect').filter((f) => f.kind === 'shape').length, effects, 'no new step');
  assert.equal(s.shape(s.lines, Y(1914, 10), front)![0][0], 1, 'the shape of 1914–1918 is corrected');
  assert.equal(s.shape(s.lines, Y(1919), front)![0][0], 2, 'the later shape is untouched');
  // It ends with the armistice; drawn again in 1939.
  cmd.endFeature(s.world, s.engine, { feature: front, mode: { kind: 'change', t: Y(1918, 11, 11) } });
  assert.equal(s.shape(s.lines, Y(1920), front), null, 'gone after the armistice');
  assert.equal(s.shape(s.lines, Y(1918, 11, 10), front)![0][0], 2);
  cmd.reshapeFeature(s.world, s.engine, { feature: front, parts: [[[5, 49], [7, 48]]], mode: { kind: 'correct', t: Y(1939, 9) } });
  assert.deepEqual(s.shape(s.lines, Y(1940), front), [[5, 49, 7, 48]], 'correcting where it does not exist gives it that shape from then on');
  assert.equal(s.shape(s.lines, Y(1930), front), null, 'not before');
  const steps = s.engine.featureHistory(front);
  assert.deepEqual(steps.map((x) => (x.parts ? 'shape' : 'off')), ['shape', 'shape', 'off', 'shape']);
  // Reshaping again at the same moment replaces that step.
  cmd.reshapeFeature(s.world, s.engine, { feature: front, parts: [[[3, 50], [4, 47]]], mode: { kind: 'change', t: Y(1918, 7) } });
  assert.equal(s.engine.featureHistory(front).length, 4);
  assert.equal(s.shape(s.lines, Y(1918, 8), front)![0][0], 3);
  assert.throws(() => cmd.endFeature(s.world, s.engine, { feature: front, mode: { kind: 'correct', t: NEG_INF } }), /delete it/);
});

test('features in an event: taking place at its start, undone, reloaded; a variant switched off hides them', () => {
  const s = setup();
  const ev = cmd.createEvent(s.world, { name: 'Siege of Arden', start: Y(1203, 5, 14), end: Y(1203, 9, 1) }).result;
  const r = cmd.createFeature(s.world, { layerId: s.points, name: 'Siege camp', parts: [[[12, 48]]], mode: { kind: 'new', eventId: ev } });
  const camp = r.result;
  assert.equal(s.shape(s.points, Y(1203, 5, 13), camp), null);
  assert.deepEqual(s.shape(s.points, Y(1203, 6), camp), [[12, 48]]);
  // The event moved: the feature moves with it.
  cmd.updateEvent(s.world, ev, { start: Y(1210), end: Y(1210, 9) });
  assert.equal(s.shape(s.points, Y(1205), camp), null);
  assert.ok(s.shape(s.points, Y(1211), camp));
  // Undo and redo.
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(s.engine.featuresAt(s.points, Y(1300)).length, 0);
  assert.equal(s.world.get('feature', camp), undefined);
  s.world.applyDiffs(r.diffs);
  assert.ok(s.shape(s.points, Y(1300), camp));
  // Reloaded from a snapshot.
  const copy = World.fromSnapshot(JSON.parse(JSON.stringify(s.world.snapshot())));
  assert.deepEqual(new Engine(copy).featuresAt(s.points, Y(1300)).map((f) => f.feature), [camp]);
  // An alternative version of the event without the camp.
  const alt = cmd.createVariant(s.world, ev, 'Siege that never happened').result;
  s.world.all('effect').filter((f) => f.event_id === alt && f.kind === 'shape').forEach((f) => cmd.deleteEffect(s.world, f.id));
  assert.equal(s.shape(s.points, Y(1300), camp), null, 'the active version has no camp');
  cmd.activateVariant(s.world, ev);
  assert.ok(s.shape(s.points, Y(1300), camp), 'switched back');
  // Deleting the event takes the shape with it: the feature is left without one (shown nowhere).
  cmd.deleteEvent(s.world, ev);
  assert.equal(s.shape(s.points, Y(1300), camp), null);
  assert.deepEqual(s.engine.conflicts, []);
});

test('deleting: features take their shapes; countries leave their features unowned; broken references are reported', () => {
  const s = setup();
  const kingdom = cmd.createEntity(s.world, { type_id: 'polity', name: 'Kingdom of Testa', color: '#aa3344' }).result;
  const a = cmd.createFeature(s.world, { layerId: s.areas, name: 'Testan claim', entity: kingdom, parts: [sq(0, 0, 3)], mode: { kind: 'correct', t: NEG_INF } }).result;
  const b = cmd.createFeature(s.world, { layerId: s.areas, name: 'Old march', parts: [sq(8, 8, 1)], mode: { kind: 'change', t: Y(800) } }).result;
  cmd.reshapeFeature(s.world, s.engine, { feature: b, parts: [sq(8, 8, 2)], mode: { kind: 'change', t: Y(900) } });
  const layer = s.world.get('layer', s.areas)!;
  assert.equal(featureColor('area', layer.style, s.world.get('feature', a)!.style, '#aa3344'), '#aa3344', "the country's colour");
  cmd.deleteEntity(s.world, kingdom);
  assert.equal(s.world.get('feature', a)!.entity_id, '', 'the claim stays, belonging to nothing');
  assert.ok(s.shape(s.areas, Y(1000), a));
  cmd.deleteFeatures(s.world, [b]);
  assert.equal(s.world.all('effect').filter((f) => f.kind === 'shape').length, 1, 'its two shapes went with it');
  assert.deepEqual(s.engine.featuresAt(s.areas, Y(1000)).map((f) => f.feature), [a]);
  // A shape left behind by a feature removed without its shapes (an old file, a damaged one): reported.
  s.world.applyDiffs([{ table: 'feature', before: s.world.get('feature', a)!, after: null }]);
  assert.equal(s.engine.conflicts.length, 1);
  assert.match(s.engine.conflicts[0].message, /no longer exists/);
  assert.deepEqual(s.engine.featuresAt(s.areas, Y(1000)), []);
});

test('shapes are kept tidy: longitudes continuous across 180°, rings open, repeats dropped', () => {
  const p = cmd.shapeParts('area', [[[179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0]]]);
  assert.deepEqual(p, [[179, 0, 181, 0, 181, 2, 179, 2]], 'across 180° the ring carries on east instead of jumping back, and is kept open');
  assert.deepEqual(cmd.shapeParts('line', [[[10, 10], [10, 10], [11, 10]]]), [[10, 10, 11, 10]]);
  assert.deepEqual(cmd.shapeParts('point', [[[370, 95]]]), [[10, 90]]);
});

test('looks: kind defaults, then the layer, then the feature itself', () => {
  assert.equal(featureStyle('line', '{}', '{}').width, 3);
  assert.equal(featureStyle('line', '{"width":5}', '{}').width, 5);
  assert.equal(featureStyle('line', '{"width":5}', '{"width":1.5,"teeth":"left"}').width, 1.5);
  assert.equal(featureStyle('line', '{}', '{"teeth":"left"}').teeth, 'left');
  assert.equal(featureStyle('area', 'not json', '').fillOpacity, 0.25, 'damaged looks fall back');
  assert.equal(featureColor('point', '{"color":"#123456"}', '{}', null), '#123456', "the layer's colour");
  assert.equal(featureColor('point', '{"color":"#123456"}', '{"color":"#abcdef"}', '#999999'), '#abcdef', 'its own colour first');
});

test('the engine follows feature edits one by one and agrees with a fresh compile (random edits, undo)', () => {
  const s = setup();
  Engine.verify = true;
  Engine.verifyFailures = [];
  try {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const done: Array<ReturnType<typeof cmd.createFeature>> = [];
    const ev = cmd.createEvent(s.world, { name: 'A war', start: Y(1500) }).result;
    for (let i = 0; i < 120; i++) {
      const feats = s.world.all('feature');
      const pick = feats[Math.floor(rnd() * feats.length)];
      const t = Y(1400 + Math.floor(rnd() * 300));
      const lon = rnd() * 40 - 20, lat = rnd() * 40 - 20;
      const r = rnd();
      let res: ReturnType<typeof cmd.createFeature> | null = null;
      if (r < 0.25 || !pick) res = cmd.createFeature(s.world, { layerId: [s.areas, s.lines, s.points][i % 3], name: `F${i}`, parts: i % 3 === 0 ? [sq(lon, lat, 1)] : i % 3 === 1 ? [[[lon, lat], [lon + 2, lat + 1]]] : [[[lon, lat]]], mode: rnd() < 0.3 ? { kind: 'new', eventId: ev } : { kind: 'change', t } });
      else {
        const kind = cmd.featureKind(s.world, pick)!;
        const parts: P[] = kind === 'area' ? [sq(lon, lat, 1)] : kind === 'line' ? [[[lon, lat], [lon + 1, lat]]] : [[[lon, lat]]];
        if (r < 0.55) res = cmd.reshapeFeature(s.world, s.engine, { feature: pick.id, parts, mode: rnd() < 0.5 ? { kind: 'change', t } : { kind: 'correct', t } });
        else if (r < 0.7) res = cmd.endFeature(s.world, s.engine, { feature: pick.id, mode: { kind: 'change', t } });
        else if (r < 0.8) res = cmd.deleteFeatures(s.world, [pick.id]) as never;
        else if (r < 0.9) res = cmd.updateFeature(s.world, pick.id, { name: `renamed ${i}`, style: { width: 1 + (i % 4) } }) as never;
        else if (done.length) { const last = done.pop()!; s.world.applyDiffs(invertDiffs(last.diffs)); }
      }
      if (res) done.push(res);
      // Ask the engine something every step (it follows the changes, and verify compares with a fresh compile).
      for (const l of [s.areas, s.lines, s.points]) s.engine.featuresAt(l, t);
    }
    assert.deepEqual(Engine.verifyFailures, []);
    assert.ok(s.engine.stats.followed > 50, `followed change by change ${s.engine.stats.followed} times`);
  } finally {
    Engine.verify = false;
  }
});

test('animated features (Stage 6, D79): a line draws itself over its event, a new shape fades the old one out; at once without an event', () => {
  const s = setup();
  Engine.verify = true;
  Engine.verifyFailures = [];
  try {
    const war = cmd.createEvent(s.world, { name: 'Advance', start: Y(1700), end: Y(1710) }).result;
    const arrow = cmd.createFeature(s.world, { layerId: s.lines, name: 'Thrust', parts: [[[0, 40], [10, 40]]], mode: { kind: 'new', eventId: war }, anim: 'draw' }).result;
    const at = (t: ReturnType<typeof Y>) => s.engine.featuresAt(s.lines, t).find((f) => f.feature === arrow);
    assert.equal(at(Y(1699)), undefined, 'not before its event');
    const mid = at(Y(1705))!;
    assert.equal(mid.style, 'draw');
    assert.ok(mid.progress! > 0.45 && mid.progress! < 0.55, `half way (eased): ${mid.progress}`);
    assert.equal(mid.before, null, 'nothing before it');
    assert.ok(at(Y(1701))!.progress! < 0.05, 'eased: slow at first');
    assert.equal(at(Y(1711))!.progress, undefined, 'complete after the event');
    // The end of the animation is a time of change (stepping, timeline).
    assert.ok(s.engine.changeInstants().some((t) => t.day === Y(1710).day));
    // A later shape in another event, fading in: the old one fades out meanwhile.
    const retreat = cmd.createEvent(s.world, { name: 'Retreat', start: Y(1720), end: Y(1730) }).result;
    cmd.reshapeFeature(s.world, s.engine, { feature: arrow, parts: [[[0, 40], [4, 40]]], mode: { kind: 'new', eventId: retreat }, anim: 'fade' });
    const fading = at(Y(1725))!;
    assert.equal(fading.style, 'fade');
    assert.deepEqual(fading.before, [[0, 40, 10, 40]]);
    // Changed afterwards from its panel: at once, then grown; the event made instantaneous: at once.
    const step = s.engine.featureHistory(arrow)[1];
    cmd.setShapeAnimation(s.world, step.effectId, null);
    assert.equal(at(Y(1725))!.progress, undefined);
    cmd.setShapeAnimation(s.world, step.effectId, 'grow');
    assert.equal(at(Y(1725))!.style, 'grow');
    cmd.updateEvent(s.world, retreat, { end: null });
    assert.equal(at(Y(1725))!.progress, undefined, 'an event without a length has nothing to animate over');
    // Without an event (from a date): at once, whatever is asked.
    const sign = cmd.createFeature(s.world, { layerId: s.points, name: 'Camp', parts: [[[3, 3]]], mode: { kind: 'change', t: Y(1800) }, anim: 'fade' }).result;
    assert.equal(s.engine.featuresAt(s.points, Y(1800, 6)).find((f) => f.feature === sign)!.progress, undefined);
    assert.throws(() => cmd.setShapeAnimation(s.world, 'nope', 'draw'), /no longer exists/);
    assert.deepEqual(Engine.verifyFailures, []);
  } finally {
    Engine.verify = false;
  }
});

test('a line drawn part of the way along its length (the renderer, D79)', async () => {
  const { cutLine } = await import('../src/render-engine/map-renderer.ts');
  const l = Float32Array.from([0, 0, 10, 0, 10, 10]); // 20 long
  assert.deepEqual([...cutLine(l, 0.25)], [0, 0, 5, 0]);
  assert.deepEqual([...cutLine(l, 0.75)], [0, 0, 10, 0, 10, 5]);
  assert.equal(cutLine(l, 1), l);
  assert.deepEqual([...cutLine(l, 0)], [0, 0]);
});
