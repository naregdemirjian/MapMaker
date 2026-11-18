// Looks for shots (Stage 10, D108): presets with their own colours and finish, changed per shot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, LOOK_IDS, GRADES, resolveLook, isPlainLook, mapStyleOf, basemapStyleOf, seeded, paperTexture, stainTexture } from '../src/presentation/looks.ts';

test('a shot\'s look: the preset chosen, with its own changes; classic as it is changes nothing', () => {
  const classic = resolveLook(null);
  assert.equal(classic.id, 'classic');
  assert.ok(isPlainLook(classic), 'no look: drawn exactly as before');
  assert.ok(isPlainLook(resolveLook({ id: 'classic' })));
  assert.equal(resolveLook({ id: 'nonsense' as never }).id, 'classic', 'an unknown look is the classic one');
  const parchment = resolveLook({ id: 'parchment' });
  assert.deepEqual({ ...parchment, id: undefined }, { ...LOOKS.parchment.look, id: undefined });
  assert.ok(!isPlainLook(parchment));
  // Changes of its own: kept where they make sense, the look's own where not.
  const own = resolveLook({ id: 'atlas', ocean: '#123456', vignette: 2, grade: 'bogus' as never, borderWidth: -1, border: 'not a colour' });
  assert.equal(own.ocean, '#123456');
  assert.equal(own.lake, '#123456', 'lakes follow the sea');
  assert.equal(own.vignette, 1);
  assert.equal(own.grade, LOOKS.atlas.look.grade);
  assert.equal(own.borderWidth, 0);
  assert.equal(own.border, LOOKS.atlas.look.border);
  assert.ok(!isPlainLook(resolveLook({ id: 'classic', vignette: 0.3 })), 'classic with darker edges is not plain');
  for (const id of LOOK_IDS) {
    const l = LOOKS[id].look;
    assert.ok(l.grade in GRADES, id);
    assert.ok(LOOKS[id].name && LOOKS[id].about, id);
  }
});

test('a look\'s colours for the renderer and the basemap; the rest kept', () => {
  const l = resolveLook({ id: 'night' });
  const base = { ocean: '#000', graticule: 'x', border: '#111', borderWidth: 1, frontGlow: '#fff', labelColor: '#eee', labelHalo: '#000', font: 'Arial' };
  const st = mapStyleOf(l, base);
  assert.equal(st.ocean, l.ocean);
  assert.equal(st.border, l.border);
  assert.equal(st.borderWidth, l.borderWidth);
  assert.equal(st.graticule, l.graticule);
  assert.equal(st.font, 'Arial', 'the font kept');
  const bm = basemapStyleOf(l, { land: '#1', coast: '#2', lake: '#3', reference: 'ref' });
  assert.deepEqual(bm, { land: l.land, coast: l.coast, lake: l.lake, reference: 'ref' });
});

test('paper: the same grain every time, specks light and dark; stains of brown, the same every time', () => {
  const a = seeded(42), b = seeded(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
  const grain = paperTexture(64), again = paperTexture(64);
  assert.deepEqual(grain, again, 'the same in every frame and export');
  let light = 0, dark = 0;
  for (let i = 0; i < grain.length; i += 4) { if (grain[i] === 255) light++; else if (grain[i] === 0) dark++; assert.ok(grain[i + 3] <= 120); }
  assert.ok(light > 1000 && dark > 1000, `both kinds of speck (${light} light, ${dark} dark)`);
  const stains = stainTexture(24, 14);
  assert.deepEqual(stains, stainTexture(24, 14));
  let stained = 0, clear = 0;
  for (let i = 0; i < stains.length; i += 4) { assert.ok(stains[i] > stains[i + 2], 'brown'); if (stains[i + 3] > 20) stained++; else clear++; }
  assert.ok(stained > 10 && clear > 50, `stains here and there (${stained} of ${stains.length / 4} cells)`);
});
