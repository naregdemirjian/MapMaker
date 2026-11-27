// Looks that move (D185): settings changing between two dates of history, eased; pulses and flickers as time on screen
// passes; the light sweep; motion blur in exports; looks kept under names and shared in files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectOf, effectAt, lookAt, sweepAt, changesInHistory, movesOnScreen, lookPresetsOf, EFFECT_DEFAULTS, type Effect, type ShadowEffect } from '../src/render-engine/country-look.ts';
import { motionBlurOf, blurMoments, FrameAverage } from '../src/presentation/motion-blur.ts';

const glow = (extra: Partial<Effect>): Effect => effectOf({ ...EFFECT_DEFAULTS['outer-glow'], ...extra })!;

test('a setting changes between two dates of history: its first value before, its last after, eased between', () => {
  const e = glow({ motions: [{ field: 'blur', from: 0, to: 40, start: [100, 0], end: [200, 0], ease: 'linear' }] } as Partial<Effect>);
  const blur = (day: number) => (effectAt(e, day, 0) as unknown as { blur: number }).blur;
  assert.equal(blur(50), 0);
  assert.equal(blur(150), 20);
  assert.equal(blur(300), 40);
  const smooth = glow({ motions: [{ field: 'blur', from: 0, to: 40, start: [100, 0], end: [200, 0], ease: 'smooth' }] } as Partial<Effect>);
  assert.equal((effectAt(smooth, 150, 0) as unknown as { blur: number }).blur, 20, 'smooth: half way at the middle');
  assert.ok((effectAt(smooth, 110, 0) as unknown as { blur: number }).blur < 4, 'smooth: slow to start');
  // Two changes of the same setting one after the other: the later holds once its time comes, the earlier until then.
  const two = glow({ motions: [{ field: 'blur', from: 0, to: 10, start: [0, 0], end: [10, 0], ease: 'linear' }, { field: 'blur', from: 10, to: 50, start: [20, 0], end: [30, 0], ease: 'linear' }] } as Partial<Effect>);
  assert.deepEqual([5, 15, 25, 40].map((d) => (effectAt(two, d, 0) as unknown as { blur: number }).blur), [5, 10, 30, 50]);
  assert.ok(changesInHistory({ elevation: 0, opacity: 1, effects: [e] }) && !movesOnScreen({ elevation: 0, opacity: 1, effects: [e] }));
});

test('pulses move a setting about its value as time on screen passes, kept in its range', () => {
  const e = glow({ opacity: 0.5, pulses: [{ field: 'opacity', amount: 0.3, period: 2, kind: 'sine' }] } as Partial<Effect>);
  const at = (sec: number) => (effectAt(e, 0, sec) as unknown as { opacity: number }).opacity;
  assert.ok(Math.abs(at(0) - 0.5) < 1e-9 && Math.abs(at(0.5) - 0.8) < 1e-9 && Math.abs(at(1.5) - 0.2) < 1e-9);
  const big = glow({ opacity: 0.9, pulses: [{ field: 'opacity', amount: 1, period: 2, kind: 'sine' }] } as Partial<Effect>);
  assert.equal((effectAt(big, 0, 0.5) as unknown as { opacity: number }).opacity, 1, 'never past full strength');
  const flicker = glow({ pulses: [{ field: 'opacity', amount: 0.4, period: 1, kind: 'wiggle' }] } as Partial<Effect>);
  const seen = new Set([0.1, 0.37, 0.8, 1.3, 2.9].map((t) => (effectAt(flicker, 0, t) as unknown as { opacity: number }).opacity.toFixed(4)));
  assert.ok(seen.size > 3, 'a flicker is uneven');
  assert.equal((effectAt(flicker, 0, 1.3) as unknown as { opacity: number }).opacity, (effectAt(flicker, 0, 1.3) as unknown as { opacity: number }).opacity, 'and the same every time');
  const still: ShadowEffect = { ...(EFFECT_DEFAULTS.shadow as ShadowEffect) };
  assert.equal(effectAt(still, 5, 5), still, 'an effect without changes is itself');
  const l = { elevation: 0, opacity: 1, effects: [still] };
  assert.equal(lookAt(l, 0, 0), l);
});

test('changes and pulses as stored are checked: only number settings of the effect, values in range', () => {
  const e = effectOf({ ...EFFECT_DEFAULTS.shadow, motions: [{ field: 'color', from: 0, to: 1, start: [0, 0], end: [1, 0] }, { field: 'blur', from: -50, to: 9999, start: [0, 0], end: [1, 0], ease: 'zigzag' }, { field: 'blur', start: 'x' }], pulses: [{ field: 'opacity', amount: 5, period: 0, kind: 'odd' }, { field: 'nothing', amount: 1, period: 1 }] })!;
  assert.equal(e.motions!.length, 1, 'colours do not move; a change needs its dates');
  assert.deepEqual([e.motions![0].from, e.motions![0].to, e.motions![0].ease], [0, 200, 'smooth']);
  assert.deepEqual(e.pulses, [{ field: 'opacity', amount: 1, period: 0.05, kind: 'sine' }]);
  assert.equal(effectOf({ ...EFFECT_DEFAULTS.shadow })!.motions, undefined, 'none: none kept');
});

test('a light sweep crosses, then waits for the next', () => {
  assert.equal(sweepAt(2, 1, 0), 0);
  assert.equal(sweepAt(2, 1, 1), 0.5);
  assert.equal(sweepAt(2, 1, 2.5), null, 'waiting');
  assert.equal(sweepAt(2, 1, 4), 0.5, 'the next sweep');
  const shine = effectOf({ kind: 'shine' })!;
  assert.ok(movesOnScreen({ elevation: 0, opacity: 1, effects: [shine] }));
});

test('motion blur: pictures spread over the shutter about the frame, averaged with their transparency', () => {
  assert.equal(motionBlurOf(undefined), null);
  assert.equal(motionBlurOf({ samples: 1 }), null, 'one picture: no blur');
  assert.deepEqual(motionBlurOf({ samples: 99, shutter: 7 }), { samples: 32, shutter: 1 });
  assert.deepEqual(blurMoments(10, { samples: 3, shutter: 0.5 }, 100), [9.75, 10, 10.25]);
  assert.deepEqual(blurMoments(0, { samples: 3, shutter: 0.5 }, 100), [0, 0, 0.25], 'kept within the shot');
  const avg = new FrameAverage(8);
  avg.add(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]));
  avg.add(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 255, 255]));
  const out = new Uint8ClampedArray(8);
  avg.write(out);
  assert.deepEqual([...out], [255, 0, 0, 128, 0, 0, 255, 255], 'red and clear: red at half strength, not dark red');
});

test('looks kept under names: replaced by name, given to several countries in one step, shared in files', async () => {
  const { World } = await import('../src/world-model/world.ts');
  const cmd = await import('../src/domain/commands.ts');
  const { invertDiffs } = await import('../src/world-model/schema.ts');
  const world = new World();
  cmd.seedProject(world, 'Presets');
  const a = cmd.createEntity(world, { type_id: 'polity', name: 'Arcadia' }).result, b = cmd.createEntity(world, { type_id: 'polity', name: 'Boeotia' }).result;
  const raised = { elevation: 3, opacity: 1, effects: [EFFECT_DEFAULTS.shadow as Effect] };
  cmd.saveLookPreset(world, 'Raised', raised);
  cmd.saveLookPreset(world, 'raised', { ...raised, elevation: 5 });
  assert.equal(cmd.lookPresets(world).length, 1, 'one of the same name replaced');
  assert.equal(cmd.lookPresets(world)[0].look.elevation, 5);
  const r = cmd.setCountriesLook(world, [a, b], cmd.lookPresets(world)[0].look, 'the look "Raised"');
  assert.deepEqual([a, b].map((id) => cmd.entityStyle(world.get('entity', id)!).look?.elevation), [5, 5]);
  world.applyDiffs(invertDiffs(r.diffs));
  assert.deepEqual([a, b].map((id) => cmd.entityStyle(world.get('entity', id)!).look), [undefined, undefined], 'undone in one step');
  const file = { kind: 'map-maker-looks', presets: [{ name: 'Glowing', look: { elevation: 0, opacity: 1, effects: [EFFECT_DEFAULTS['outer-glow']] } }, { name: 'Raised', look: raised }, { name: '', look: raised }, { name: 'Broken' }] };
  assert.equal(lookPresetsOf(file).length, 2, 'named looks only');
  assert.equal(cmd.importLookPresets(world, file).result, 2);
  assert.deepEqual(cmd.lookPresets(world).map((p) => [p.name, p.look.elevation]), [['Raised', 3], ['Glowing', 0]]);
  // Renamed (D250): a name another one has refused.
  const glowing = cmd.lookPresets(world)[1].id;
  cmd.renameLookPreset(world, glowing, 'Soft glow');
  assert.deepEqual(cmd.lookPresets(world).map((p) => p.name), ['Raised', 'Soft glow']);
  assert.throws(() => cmd.renameLookPreset(world, glowing, 'raised'), /already kept/);
  assert.throws(() => cmd.renameLookPreset(world, 'gone', 'X'), /no longer kept/);
  cmd.deleteLookPreset(world, cmd.lookPresets(world)[1].id);
  assert.deepEqual(cmd.lookPresets(world).map((p) => p.name), ['Raised']);
  assert.throws(() => cmd.importLookPresets(world, { presets: [] }), /no looks/);
});
