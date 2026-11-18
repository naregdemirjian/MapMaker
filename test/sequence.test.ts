// Shots: screen-time arithmetic used by transitions timed in screen seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultShot, screenSecondsSince, timeAt, shotTransitions, DEFAULT_TRANSITIONS, shotProgress, eventScreenSeconds } from '../src/presentation/sequence.ts';
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
