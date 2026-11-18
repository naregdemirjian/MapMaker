// Times importing borders from maps of several dates (D120), as a real dataset gives them: today's 242 countries
// as the starting map, then maps of later "years" whose borders are the same lines drawn again a little apart
// (as two datasets digitised separately are), with countries joined and renamed. In memory, no browser.
// Usage: node --disable-warning=ExperimentalWarning bench/import.bench.ts [maps=4] [jitter-km=3]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { decodeCountries, type CountriesFile } from '../src/domain/countries.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { rng } from '../test/helpers.ts';
import type { CountryToAdd } from '../src/domain/commands.ts';

const maps = Number(process.argv[2] ?? 4), jitterKm = Number(process.argv[3] ?? 3);
const root = join(import.meta.dirname, '..');
const all = decodeCountries(JSON.parse(readFileSync(join(root, 'data', 'natural-earth', 'countries-50m.json'), 'utf8')) as CountriesFile);
const time = <T>(fn: () => T): [T, number] => { const t = performance.now(); const r = fn(); return [r, performance.now() - t]; };

const world = new World();
const space = cmd.seedProject(world, 'Import bench').result.spaceId;
const layer = world.all('layer')[0].id;
const engine = new Engine(world);
const arr = world.arrangement(space);
const points = all.reduce((n, c) => n + c.polygons.reduce((m, p) => m + p.reduce((k, r) => k + r.length, 0), 0), 0);
const out: Record<string, unknown> = { countries: all.length, points, maps, jitterKm };

// The same borders a little apart: each point moved by a smooth field (neighbours share their border's move).
const r = rng(7);
const waves = Array.from({ length: 6 }, () => ({ k: r.float(0.05, 0.3), a: r.float(0, Math.PI * 2), b: r.float(0, Math.PI * 2) }));
const moved = (lon: number, lat: number, m: number): [number, number] => {
  let dx = 0, dy = 0;
  for (const w of waves) { dx += Math.sin(lon * w.k + w.a + m) * Math.cos(lat * w.k * 1.3 + w.b); dy += Math.cos(lon * w.k * 0.7 + w.b + m) * Math.sin(lat * w.k + w.a); }
  const deg = jitterKm / 111 / waves.length;
  return [lon + (dx * deg) / Math.max(0.2, Math.cos((lat * Math.PI) / 180)), Math.max(-90, Math.min(90, lat + dy * deg))];
};
const mapOf = (m: number): CountryToAdd[] => {
  const list: CountryToAdd[] = all.map((c) => ({ name: c.name, polygons: c.polygons.map((p) => p.map((ring) => ring.map(([lon, lat]) => (m ? moved(lon, lat, m) : [lon, lat]) as [number, number]))) }));
  if (m) {
    // Some countries joined under one name (an empire of the time), one renamed.
    const join = (name: string, parts: string[]) => {
      const got = list.filter((c) => parts.includes(c.name));
      for (const g of got) list.splice(list.indexOf(g), 1);
      list.push({ name, polygons: got.flatMap((g) => g.polygons) });
    };
    if (m % 2) join('Austria-Hungary', ['Austria', 'Hungary', 'Czechia', 'Slovakia']);
    else join('Gran Colombia', ['Colombia', 'Venezuela', 'Ecuador', 'Panama']);
  }
  return list;
};

const imports: Array<Record<string, number>> = [];
for (let m = 0; m < maps; m++) {
  const countries = mapOf(m);
  const t = m === 0 ? NEG_INF : gregorian.fromCivil({ year: 1800 + m * 50 });
  const [res, ms] = time(() => cmd.importTerritories(world, engine, { spaceId: space, layerId: layer, t, countries, replace: true }));
  const [, compile] = time(() => engine.ensure());
  const [, state] = time(() => engine.partitionState(space, layer, t));
  imports.push({ map: m, importMs: Math.round(ms), compileMs: Math.round(compile), stateMs: Math.round(state), created: res.result.created, parcels: arr.leafFaces().length, segments: arr.segments.size });
  console.log(JSON.stringify(imports[imports.length - 1]));
}
out.imports = imports;
// Who holds a few capitals at each map's date (Vienna: Austria-Hungary in the odd maps, Bogotá: Gran Colombia in the even ones).
const { lonLatToVec } = await import('../src/geo-kernel/vec.ts');
const owner = (lon: number, lat: number, y: number) => { const id = engine.valueAtPoint(space, layer, lonLatToVec(lon, lat), y < 1800 ? NEG_INF : gregorian.fromCivil({ year: y })); return id ? world.get('entity', id)?.name ?? id : null; };
out.owners = Array.from({ length: maps }, (_, m) => { const y = m === 0 ? 1700 : 1800 + m * 50 + 1; return { year: y, paris: owner(2.35, 48.86, y), vienna: owner(16.37, 48.21, y), bogota: owner(-74.07, 4.71, y), lima: owner(-77.04, -12.05, y), tokyo: owner(139.69, 35.69, y) }; });
out.valid = arr.validate().length === 0;
console.log(JSON.stringify(out));
