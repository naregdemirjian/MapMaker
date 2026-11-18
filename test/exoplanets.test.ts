// Planets of other stars (Stage 11, D118): the list taken from the Open Exoplanet Catalogue, each planet
// given to its star on the nearby star map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeStars } from '../src/space/catalogue.ts';
import { decodeExoplanets, planetSize, foundBy } from '../src/space/exoplanets.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stars = decodeStars(JSON.parse(readFileSync(join(root, 'data', 'stars', 'nearby-50ly.json'), 'utf8')));
const list = decodeExoplanets(JSON.parse(readFileSync(join(root, 'data', 'stars', 'exoplanets-50ly.json'), 'utf8')));
const star = (name: string) => stars.stars.find((s) => s.name === name)!;
const of = (name: string) => (list.byStar.get(star(name).id) ?? []).map((p) => p.name);

test('the planets of the nearby stars: on stars of the map, with the licence beside them', () => {
  assert.ok(list.planets.length > 120, `${list.planets.length} planets`);
  assert.ok(list.byStar.size > 70, `${list.byStar.size} stars with planets`);
  assert.ok(list.planets.every((p) => stars.byId.has(p.star) && p.star !== 0), 'each on a star of the map (not the Sun)');
  assert.equal(new Set(list.planets.map((p) => p.name)).size, list.planets.length, 'every planet once');
  assert.ok(existsSync(join(root, 'data', 'stars', 'LICENSE-open-exoplanet-catalogue.txt')));
  assert.match(readFileSync(join(root, 'data', 'stars', 'LICENSE-open-exoplanet-catalogue.txt'), 'utf8'), /Copyright \(C\) 2012 Hanno Rein/);
  assert.equal(JSON.parse(readFileSync(join(root, 'data', 'datasets.json'), 'utf8')).find((d: { id: string }) => d.id === 'oec').licence, 'MIT');
});

test('well-known planets on their stars, with their years and sizes', () => {
  const proxima = list.byStar.get(star('Proxima Centauri').id)!;
  const b = proxima.find((p) => p.name === 'Proxima Centauri b')!;
  assert.ok(Math.abs(b.days! - 11.18) < 0.01, `Proxima b goes round in ${b.days} days`);
  assert.ok(b.mass! > 1 && b.mass! < 1.5, `about the Earth's mass (${b.mass})`);
  assert.equal(b.year, 2016);
  assert.equal(foundBy(b.method), 'by the wobble it gives its star');
  assert.match(planetSize(b), /× the Earth's mass \(at least\)$/);
  assert.ok(of('τ Cet').length >= 4, 'Tau Ceti\'s planets');
  assert.ok(of('Copernicus').filter((n) => /55 Cancri/.test(n)).length === 5, '55 Cancri\'s five');
  assert.deepEqual(of('Errai'), ['Gamma Cephei b'], 'found by its place in the sky (named differently)');
  // Planets nearest their star first.
  for (const l of list.byStar.values()) for (let i = 1; i < l.length; i++) assert.ok((l[i].days ?? Infinity) >= (l[i - 1].days ?? Infinity) || l[i - 1].days === null);
});
