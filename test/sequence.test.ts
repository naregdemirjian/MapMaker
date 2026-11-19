// Shots: screen-time arithmetic used by transitions timed in screen seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultShot, screenSecondsSince, timeAt, shotTransitions, DEFAULT_TRANSITIONS, shotProgress, eventScreenSeconds, cameraAt, withStillCamera, unspun, steadyLayout, TRANSITION_LOOKS, withTransitionLook, eventTransitionLook } from '../src/presentation/sequence.ts';
import { World } from '../src/world-model/world.ts';
import * as cmd from '../src/domain/commands.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { gregorian } from '../src/core-time/index.ts';

const Y = (y: number) => gregorian.fromCivil({ year: y });
const cam = { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'equirectangular' as const };

test('screen seconds since a historical instant, with even and eased pacing', () => {
  for (const ease of ['linear', 'smooth'] as const) {
    const shot = defaultShot('space', cam, Y(1900), Y(2000), 25, 10); // 250 frames
    shot.time = shot.time.map((k) => ({ ...k, ease }));
    // The frame that shows 1950, and 2 seconds (50 frames) after it.
    let f50 = 0;
    for (let f = 0; f < shot.frames; f++) if (timeAt(shot, f).day <= Y(1950).day) f50 = f;
    const s = screenSecondsSince(shot, f50 + 50, Y(1950));
    assert.ok(Math.abs(s - 2) < 0.05, `${ease}: ${s}`);
    assert.ok(Math.abs(screenSecondsSince(shot, 0, Y(1900))) < 1e-3, 'at the very start');
    assert.equal(screenSecondsSince(shot, 10, Y(1800)), Infinity, 'changes before the shot are over');
    assert.equal(screenSecondsSince(shot, 10, Y(2100)), -Infinity, 'changes after the shot have not begun');
  }
});

test('shot transitions: defaults fill in, saved settings win', () => {
  const shot = defaultShot('space', cam, Y(1900), Y(2000));
  assert.deepEqual(shotTransitions(shot), DEFAULT_TRANSITIONS);
  shot.transitions = { ...DEFAULT_TRANSITIONS, mode: 'instant', front: { ...DEFAULT_TRANSITIONS.front, color: '#ff0000' } };
  assert.equal(shotTransitions(shot).mode, 'instant');
  assert.equal(shotTransitions(shot).front.color, '#ff0000');
  assert.equal(shotTransitions(shot).front.width, DEFAULT_TRANSITIONS.front.width);
});

test('transition styles: the advancing front from the border is the default; old wipes show as it', () => {
  const shot = defaultShot('space', { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'equirectangular' }, gregorian.fromCivil({ year: 1900 }), gregorian.fromCivil({ year: 1901 }));
  assert.equal(shotTransitions(shot).style, 'border');
  assert.equal(shotTransitions({ ...shot, transitions: { ...DEFAULT_TRANSITIONS, style: 'wipe', angle: 90 } }).style, 'border', 'a shot saved with the old wipe');
  assert.equal(shotTransitions({ ...shot, transitions: { ...DEFAULT_TRANSITIONS, style: 'advance' } }).style, 'advance', 'the expansion stays');
});

test('transition looks (D137): each sets how fronts look and keeps when and how long; an event can have its own', () => {
  const shot = defaultShot('space', cam, Y(1900), Y(2000));
  const base = { ...shotTransitions(shot), mode: 'all' as const, timing: 'event' as const, seconds: 4 };
  // The default is the clean look.
  assert.equal(DEFAULT_TRANSITIONS.look, 'clean');
  const clean = TRANSITION_LOOKS.find((l) => l.id === 'clean')!.set;
  assert.equal(clean.roughness, DEFAULT_TRANSITIONS.roughness);
  assert.deepEqual(clean.front, DEFAULT_TRANSITIONS.front);
  // Every look: a name, a note, a style; settings within their ranges; ids not repeated.
  assert.equal(new Set(TRANSITION_LOOKS.map((l) => l.id)).size, TRANSITION_LOOKS.length);
  for (const l of TRANSITION_LOOKS) {
    assert.ok(l.name && l.note && l.set.style, l.id);
    for (const k of ['roughness', 'soft', 'wake'] as const) assert.ok((l.set[k] ?? 0) >= 0 && (l.set[k] ?? 0) <= 1, `${l.id} ${k}`);
    const t = withTransitionLook(base, l.id);
    assert.equal(t.look, l.id);
    assert.equal(t.style, l.set.style);
    // When and how long: kept.
    assert.equal(t.mode, 'all'); assert.equal(t.timing, 'event'); assert.equal(t.seconds, 4);
  }
  // Intense: Blitz is rough, glows behind and has a wide glowing line; Minimal has no line.
  const blitz = withTransitionLook(base, 'blitz');
  assert.ok(blitz.roughness! > 0.3 && blitz.wake! > 0.5 && blitz.front.show && blitz.front.glow > 20);
  assert.equal(withTransitionLook(base, 'minimal').front.show, false);
  assert.equal(withTransitionLook(base, 'dissolve').style, 'dissolve');
  assert.equal(withTransitionLook(base, 'nonsense'), base, 'an unknown look changes nothing');
  // Saved settings are kept within their ranges.
  const odd = shotTransitions({ ...shot, transitions: { ...DEFAULT_TRANSITIONS, roughness: 3, soft: -1, wake: Number.NaN } });
  assert.deepEqual([odd.roughness, odd.soft, odd.wake], [1, 0, 0]);
  // An older shot (none of these saved): the clean look's values.
  const older = shotTransitions({ ...shot, transitions: { mode: 'all', style: 'border', angle: 0, timing: 'seconds', seconds: 1.5, easing: 'smooth', restyleRecorded: false, front: { show: true, color: '#ffe9a6', width: 2.2, glow: 10 } } });
  assert.deepEqual([older.roughness, older.soft, older.wake], [0, 0, 0]);
  // An event's own look, kept in its presentation settings beside its own time on screen.
  const w = new World();
  const ev = cmd.createEvent(w, { name: 'Blitz', start: Y(1940), end: Y(1941) }).result as string;
  assert.equal(eventTransitionLook(w.get('event', ev)!.presentation), null);
  cmd.setEventScreenSeconds(w, ev, 3);
  const r = cmd.setEventLook(w, ev, 'blitz');
  const pres = w.get('event', ev)!.presentation;
  assert.equal(eventTransitionLook(pres), 'blitz');
  assert.equal(eventScreenSeconds(pres), 3, 'its own time on screen kept');
  assert.throws(() => cmd.setEventLook(w, ev, 'nonsense'));
  w.applyDiffs(invertDiffs(r.diffs));
  assert.equal(eventTransitionLook(w.get('event', ev)!.presentation), null, 'undone');
  cmd.setEventLook(w, ev, 'ink');
  cmd.setEventLook(w, ev, null);
  assert.equal(eventTransitionLook(w.get('event', ev)!.presentation), null, 'the shot\'s look again');
  assert.equal(eventScreenSeconds(w.get('event', ev)!.presentation), 3);
  assert.equal(eventTransitionLook('{"look":"nonsense"}'), null);
  assert.equal(eventTransitionLook('not json'), null);
});

test('still camera: framing sets one view for the whole shot; reset gives the whole map', async () => {
  const { withStillCamera, cameraMoves, resetCamera } = await import('../src/presentation/sequence.ts');
  const shot = defaultShot('space', cam, Y(1900), Y(2000), 25, 4);
  const moving = { ...shot, camera: [shot.camera[0], { ...shot.camera[shot.camera.length - 1], camera: { ...cam, zoom: 3, lon: 40 } }] };
  assert.ok(cameraMoves(moving), 'an older shot could move');
  const still = withStillCamera(moving, { ...cam, lon: 10, lat: 20, zoom: 2, projection: 'mercator' });
  assert.ok(!cameraMoves(still));
  assert.ok(still.camera.every((k) => k.camera.lon === 10 && k.camera.zoom === 2 && k.camera.projection === 'mercator'));
  assert.deepEqual(resetCamera(still), { lon: 0, lat: 0, zoom: 0, rotation: 0, projection: 'mercator' }, 'reset keeps the projection');
});

test('overlays move by fractions of the frame; the events box becomes freely placed', async () => {
  const { moveOverlay, EVENTS_BOX_ID } = await import('../src/presentation/sequence.ts');
  const shot = defaultShot('space', cam, Y(1900), Y(2000), 25, 4);
  const date = shot.overlays.find((o) => o.kind === 'date')!;
  const moved = moveOverlay(shot, date.id, 0.1, -0.05);
  const d2 = moved.overlays.find((o) => o.id === date.id)!;
  assert.ok(Math.abs(d2.x - (date.x + 0.1)) < 1e-9 && Math.abs(d2.y - Math.max(0, date.y - 0.05)) < 1e-9);
  assert.equal(moveOverlay(shot, date.id, 5, 5).overlays.find((o) => o.id === date.id)!.x, 1, 'kept inside the frame');
  const boxed = moveOverlay({ ...shot, eventsBox: { show: true, corner: 'bottom-right' } }, EVENTS_BOX_ID, -0.2, -0.1, { x: 0.7, y: 0.75 });
  assert.equal(boxed.eventsBox!.corner, 'custom');
  assert.ok(Math.abs(boxed.eventsBox!.x! - 0.5) < 1e-9 && Math.abs(boxed.eventsBox!.y! - 0.65) < 1e-9);
  assert.equal(boxed.eventsBox!.show, true, 'other settings kept');
});

test('export choices: "All" alone unless chosen otherwise; sizes written for people', async () => {
  const { exportPassesOf, formatBytes, PASS_DEFS } = await import('../src/presentation/export-driver.ts');
  const shot = defaultShot('space', cam, Y(1900), Y(2000), 25, 4);
  assert.deepEqual(exportPassesOf(shot), ['all']);
  assert.deepEqual(exportPassesOf({ ...shot, exportPasses: ['fills', 'nonsense', 'all'] }), ['fills', 'all']);
  assert.equal(PASS_DEFS[0].name, 'all', '"All" comes first');
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(850 * 1024 * 1024), '850 MB');
  assert.equal(formatBytes(2.4 * 1024 ** 3), '2.4 GB');
});

test('each layer on its own (D124): a pass per layer the shot shows, after the land, drawing that layer only', async () => {
  const { layerPassDefs, passDefsFor, exportPassesOf, frameSetup } = await import('../src/presentation/export-driver.ts');
  const world = new World();
  const space = cmd.seedProject(world, 'Layers').result.spaceId;
  const political = world.all('layer')[0].id;
  const occupation = cmd.createLayer(world, space, 'Occupation').result;
  const roads = cmd.createLayer(world, space, 'Roads', 'line').result;
  const shot = defaultShot(space, cam, Y(1900), Y(2000), 25, 4);
  const defs = layerPassDefs(world, shot);
  assert.deepEqual(defs.map((d) => [d.label, d.passes.join('+'), d.layerId]), [['Layer: ' + world.get('layer', political)!.name, 'fills+borders', political], ['Layer: Occupation', 'fills+borders', occupation], ['Layer: Roads', 'features', roads]]);
  const order = passDefsFor(world, shot).map((d) => d.name);
  assert.deepEqual(order.slice(0, 3), ['all', 'background', 'land'], 'after the land');
  assert.equal(order[3], `layer-${political}`);
  assert.ok(order.indexOf('fills') > order.indexOf(`layer-${roads}`), 'before the kinds of everything');
  // Kept as chosen; only that layer drawn in its frames.
  assert.deepEqual(exportPassesOf({ ...shot, exportPasses: [`layer-${occupation}`, 'all'] }), [`layer-${occupation}`, 'all']);
  const def = defs[1];
  assert.deepEqual(frameSetup(world, shot, 0, def, 640, 360).options.layerIds, [occupation]);
  // A hidden layer has no pass; a shot naming its layers has theirs only.
  cmd.updateLayer(world, occupation, { visible: 0 });
  assert.deepEqual(layerPassDefs(world, shot).map((d) => d.layerId), [political, roads]);
  assert.deepEqual(layerPassDefs(world, { ...shot, layers: [political] }).map((d) => d.layerId), [political]);
});

test('an event out of sync with the clock (D92): its changes take its own screen seconds, whatever the shot\'s pace', () => {
  const D = (y: number) => gregorian.fromCivil({ year: y, month: 1, day: 1 });
  // A shot where a year passes in a hundredth of a second: a change at 1900 is over at once by the clock.
  const secondsSince = (t0: ReturnType<typeof D>) => ((D(1901).day - t0.day) / 365) * 0.01;
  const change = { t: D(1900), end: D(1900) };
  const shot = { timing: 'seconds' as const, seconds: 1.5, secondsSince };
  assert.ok(shotProgress(change, D(1901), shot) < 0.01, 'the shot\'s own 1.5 s from the change');
  assert.ok(Math.abs(shotProgress(change, D(1901), shot, 0.02) - 0.5) < 0.01, 'half of its own 0.02 s');
  // Timed by events: the change's span in history, unless the event takes its own time.
  const long = { t: D(1900), end: D(1902) };
  assert.ok(Math.abs(shotProgress(long, D(1901), { ...shot, timing: 'event' }) - 0.5) < 0.01);
  assert.ok(Math.abs(shotProgress(long, D(1901), { ...shot, timing: 'event' }, 0.04) - 0.25) < 0.01);
  // Stored with the event's presentation settings; checked; cleared; undone.
  const world = new World();
  cmd.seedProject(world, 'Sync');
  const ev = cmd.createEvent(world, { name: 'Battle of the Ford', start: D(1900) }).result;
  const own = () => eventScreenSeconds(world.get('event', ev)!.presentation);
  assert.equal(own(), null, 'follows the clock to begin with');
  const r = cmd.setEventScreenSeconds(world, ev, 3);
  assert.equal(own(), 3);
  assert.throws(() => cmd.setEventScreenSeconds(world, ev, 0), /tenth of a second/);
  cmd.setEventScreenSeconds(world, ev, null);
  assert.equal(own(), null);
  const again = cmd.setEventScreenSeconds(world, ev, 2.5);
  world.applyDiffs(invertDiffs(again.diffs));
  assert.equal(own(), null);
  assert.ok(r.diffs.length > 0);
  assert.equal(eventScreenSeconds('not json'), null);
  assert.equal(eventScreenSeconds('{"screen":{"seconds":-1}}'), null);
});

test('a globe turning on its own (D127): its middle moves west at the speed set, a view framed at a frame is kept as it was before the turn, flat maps never turn', () => {
  const t = gregorian.fromCivil({ year: 1900 });
  const shot = defaultShot('space', { lon: 170, lat: 30, zoom: 0, rotation: 0, projection: 'globe' }, t, t, 24, 10);
  assert.equal(cameraAt(shot, 48).lon, 170, 'still without a spin');
  shot.spin = 15;
  assert.ok(Math.abs(cameraAt(shot, 0).lon - 170) < 1e-9);
  assert.ok(Math.abs(cameraAt(shot, 48).lon - 140) < 1e-9, `two seconds at 15° a second (${cameraAt(shot, 48).lon})`);
  // Across 180°: on round the other side.
  shot.spin = -30;
  assert.ok(Math.abs(cameraAt(shot, 48).lon - -130) < 1e-9, `the other way, across 180° (${cameraAt(shot, 48).lon})`);
  // Framed at frame 48 and kept: at that frame the view is the one framed, and it turns on from there.
  const framed = { ...cameraAt(shot, 48), lon: 10 };
  const kept = withStillCamera(shot, unspun(shot, framed, 48));
  assert.ok(Math.abs(cameraAt(kept, 48).lon - 10) < 1e-9 && Math.abs(cameraAt(kept, 72).lon - 40) < 1e-9, `${cameraAt(kept, 48).lon}, then ${cameraAt(kept, 72).lon} a second later (turning east at 30° a second)`);
  // A flat map's camera never turns.
  const flatShot = { ...shot, camera: shot.camera.map((k) => ({ ...k, camera: { ...k.camera, projection: 'equirectangular' as const } })) };
  assert.equal(cameraAt(flatShot, 48).lon, 170);
});

test('a date laid out steady keeps its day and its year in their places as it changes (shot overlays)', () => {
  // A stand-in for a canvas: proportional widths (1 is narrow, 0 wide; letters of their own widths).
  const widths: Record<string, number> = { '0': 10, '1': 5, '2': 9, '3': 9, '4': 9.5, '5': 9, '6': 9.5, '7': 8, '8': 9.5, '9': 9.5, ' ': 4 };
  const ctx = { measureText: (t: string) => ({ width: [...t].reduce((w, ch) => w + (widths[ch] ?? (ch === ch.toUpperCase() ? 11 : 7)), 0) }) } as unknown as CanvasRenderingContext2D;
  const a = steadyLayout(ctx, '1 May 1833'), b = steadyLayout(ctx, '28 September 1866');
  assert.equal(a.width, b.width, 'the same width for every date');
  const yearAt = (l: ReturnType<typeof steadyLayout>) => l.runs.filter((r) => r.cell !== null && /\d/.test(r.text)).slice(-4)[0].x;
  assert.equal(yearAt(a), yearAt(b), 'the year starts at the same place');
  const dayEnd = (l: ReturnType<typeof steadyLayout>, digits: number) => { const r = l.runs.filter((q) => q.cell !== null)[digits - 1]; return r.x + r.cell!; };
  assert.equal(dayEnd(a, 1), dayEnd(b, 2), 'the day ends at the same place, one figure or two (two figures\' room, set right)');
  // Other text is drawn as it is.
  assert.deepEqual(steadyLayout(ctx, 'The Hundred Years').runs.map((r) => r.cell), [null]);
});
