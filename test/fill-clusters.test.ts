// Pictures over countries in several pieces (fifth feedback round, D82): pieces far apart get their
// own copy, pieces close together share one; boxes the short way round the 180th meridian; flags fitted
// by covering with a little stretch rather than cropping their stripes away. Checked on today's countries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterPieces, joinBoxes, boxGap, fitScales, type GeoBox } from '../src/render-engine/fill-clusters.ts';
import { decodeCountries, type CountriesFile } from '../src/domain/countries.ts';

const countries = decodeCountries(JSON.parse(readFileSync(new URL('../data/natural-earth/countries-50m.json', import.meta.url), 'utf8')) as CountriesFile);
function piecesOf(name: string) {
  const c = countries.find((x) => x.name === name)!;
  return c.polygons.map((poly) => {
    const r = poly[0];
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity, a = 0;
    for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]) * Math.cos(((r[i][1] + r[j][1]) / 2) * Math.PI / 180);
    return { box: [w, s, e, n] as GeoBox, area: Math.abs(a) / 2 };
  });
}
const inBox = (b: GeoBox, lon: number, lat: number) => lat >= b[1] && lat <= b[3] && [lon, lon + 360, lon - 360].some((x) => x >= b[0] && x <= b[2]);

test('boxes the short way round: across the 180th meridian, joined and measured', () => {
  assert.deepEqual(joinBoxes([170, 50, 180, 60], [-180, 55, -170, 65]), [170, 50, 190, 65]);
  assert.equal(boxGap([170, 50, 180, 60], [-180, 55, -170, 65]), 0, 'touching at 180°');
  assert.ok(Math.abs(boxGap([0, 0, 1, 1], [3, 0, 4, 1]) - 2) < 1e-9, 'two degrees apart at the equator');
  assert.ok(Math.abs(boxGap([0, 60, 1, 61], [3, 60, 4, 61]) - 1) < 0.01, 'two degrees of longitude at 60° are about one degree');
});

test('today\'s countries: overseas pieces get their own picture; mainland, nearby islands and archipelagos share one', () => {
  const at = (name: string) => clusterPieces(piecesOf(name));
  // France: Europe (with Corsica), French Guiana, Réunion, Martinique, Guadeloupe, Mayotte.
  const fr = at('France');
  assert.equal(fr.length, 6);
  const europe = fr.find((c) => inBox(c.box, 2.35, 48.86))!;
  assert.ok(inBox(europe.box, 9.1, 42.2), 'Corsica shares mainland France\'s flag');
  assert.ok(!inBox(europe.box, -53, 4), 'French Guiana does not');
  // Spain: the mainland with the Balearic Islands; the Canary Islands together, apart from it.
  const es = at('Spain');
  assert.equal(es.length, 2);
  const canaries = es.find((c) => inBox(c.box, -15.5, 28))!;
  assert.ok(canaries.members.length >= 6, 'the Canary Islands share one flag');
  assert.ok(inBox(es.find((c) => c !== canaries)!.box, 2.9, 39.6), 'Mallorca shares the mainland\'s');
  // Russia: one box across the 180th meridian, placed by the mainland (not stretched to the Arctic islands).
  const ru = at('Russia');
  assert.equal(ru.length, 1);
  assert.ok(ru[0].box[2] - ru[0].box[0] < 180, `${ru[0].box}`);
  assert.ok(ru[0].core[3] < ru[0].box[3], 'the core leaves out the far northern islands');
  // The USA: the lower 48, Alaska (with the Aleutians across 180°), Hawaii.
  const us = at('United States of America');
  assert.equal(us.length, 3);
  // One picture: Indonesia, the Philippines, Greece, the UK, Canada, Italy; Japan's main islands
  // together (a far Pacific islet has its own).
  for (const n of ['Indonesia', 'Philippines', 'Greece', 'United Kingdom', 'Canada', 'Italy']) assert.equal(at(n).length, 1, n);
  const jp = at('Japan');
  assert.ok(inBox(jp[0].box, 139.7, 35.7) && inBox(jp[0].box, 141.3, 43.1) && inBox(jp[0].box, 127.7, 26.2), 'Honshu, Hokkaido and Okinawa together');
});

test('the rules to choose from: one over all, one per piece, a distance', () => {
  const p = piecesOf('Spain');
  assert.equal(clusterPieces(p, { pieces: 'whole' }).length, 1);
  assert.equal(clusterPieces(p, { pieces: 'each' }).length, p.length);
  // The Canaries are about 1,000 km from the mainland, their islands under 100 km apart.
  assert.equal(clusterPieces(p, { pieces: 'near', gapKm: 2000 }).length, 1);
  assert.equal(clusterPieces(p, { pieces: 'near', gapKm: 300 }).length, 2);
  assert.ok(clusterPieces(p, { pieces: 'near', gapKm: 10 }).length > 4);
});

test('fitting a picture: cover crops, fill stretches up to twice before cropping, contain fits inside', () => {
  // A 3:2 flag in a 6:1 box (a long country).
  assert.deepEqual(fitScales(300, 200, 600, 100, 'cover'), [2, 2]);
  assert.deepEqual(fitScales(300, 200, 600, 100, 'fill'), [2, 1], 'stretched twice across, a quarter of the height cropped');
  assert.deepEqual(fitScales(300, 200, 450, 200, 'fill'), [1.5, 1], 'a little long: stretched, nothing cropped');
  assert.deepEqual(fitScales(300, 200, 600, 100, 'contain'), [0.5, 0.5]);
  assert.deepEqual(fitScales(300, 200, 600, 100, 'stretch'), [2, 0.5]);
});
