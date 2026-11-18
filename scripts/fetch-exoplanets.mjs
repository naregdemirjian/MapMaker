// Makes data/stars/exoplanets-50ly.json (D118): the known planets of the stars on the nearby star map
// (data/stars/nearby-50ly.json, within 50 light-years), from the Open Exoplanet Catalogue (Hanno Rein
// and contributors, MIT licence: its notice is written beside the data). Run: node scripts/fetch-exoplanets.mjs
//
// Each planet is given to the star of the map that hosts it: the star named as its host (names compared
// with "Gliese", "GJ" and "Gl" alike, spaces and case ignored) seen within 3° of the planet's system
// (the star catalogue's distances of faint stars can be some light-years out), else the star seen within
// 0.3° of it at a distance within 8% of its own. Planets on the catalogue's list of confirmed planets
// only. Hosts not on the map (too faint for the star catalogues, like TRAPPIST-1) are left out and listed.
//
// Format "mapmaker-exoplanets-1": { format, source, licence, planets: [[star id, name, period (days),
// distance from its star (au), mass (Earth masses), radius (Earth radii), year found, how found], ...] }
// (null where the catalogue has no value).
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://raw.githubusercontent.com/OpenExoplanetCatalogue/oec_gzip/master/systems.xml.gz';
const LY_PER_PC = 3.261563777;
const EARTH_PER_JUPITER_MASS = 317.828, EARTH_PER_JUPITER_RADIUS = 11.209;

const res = await fetch(URL);
if (!res.ok) throw new Error(`Could not download the Open Exoplanet Catalogue (${res.status}).`);
const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');

/** The elements named `tag` directly or deeply inside a piece of XML, with their content (the catalogue does not nest an element in one of its own name, except systems in nothing). */
function blocks(text, tag) {
  const out = [];
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, 'g');
  let m;
  while ((m = open.exec(text))) {
    // (Nested elements of the same name: count them.)
    let depth = 1, i = open.lastIndex;
    const any = new RegExp(`<(/?)${tag}(\\s[^>]*)?>`, 'g');
    any.lastIndex = i;
    let n;
    while (depth && (n = any.exec(text))) depth += n[1] ? -1 : 1;
    const end = n ? n.index : text.length;
    out.push(text.slice(i, end));
    open.lastIndex = n ? any.lastIndex : text.length;
  }
  return out;
}
/** The text of the child elements named `tag` that come before any element of `stop` (its own, not its children's). */
function own(text, tag) {
  // (Children's elements are cut out first.)
  const flat = text.replace(/<(star|planet|binary)(\s[^>]*)?>[\s\S]*?<\/\1>/g, '');
  return [...flat.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => m[1].trim());
}
const num = (v) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Names compared alike: "GL 551", "Gliese 551" and "GJ 551" the same; spaces, dashes and case ignored. */
const norm = (s) => decode(s).toLowerCase().replace(/^(gliese|gl|gj)\s*/, 'gj').replace(/[\s\-_.']/g, '');

/** Right ascension "hh mm ss.s" and declination "±dd mm ss" to galactic x, y, z (light-years) at a distance (parsecs). */
function galactic(ra, dec, pc) {
  const [h, m, s] = ra.split(/\s+/).map(Number), [d, dm, ds] = dec.split(/\s+/).map(Number);
  const sign = dec.trim().startsWith('-') ? -1 : 1;
  const a = ((h + (m || 0) / 60 + (s || 0) / 3600) * 15 * Math.PI) / 180;
  const delta = (sign * (Math.abs(d) + (dm || 0) / 60 + (ds || 0) / 3600) * Math.PI) / 180;
  const aG = (192.85948 * Math.PI) / 180, dG = (27.12825 * Math.PI) / 180, lNCP = (122.93192 * Math.PI) / 180;
  const sb = Math.sin(delta) * Math.sin(dG) + Math.cos(delta) * Math.cos(dG) * Math.cos(a - aG);
  const b = Math.asin(sb);
  const y = Math.cos(delta) * Math.sin(a - aG), x = Math.sin(delta) * Math.cos(dG) - Math.cos(delta) * Math.sin(dG) * Math.cos(a - aG);
  const l = lNCP - Math.atan2(y, x);
  const r = pc * LY_PER_PC;
  return [r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b)];
}

const map = JSON.parse(readFileSync(join(ROOT, 'data', 'stars', 'nearby-50ly.json'), 'utf8'));
const stars = map.stars.map(([id, name, x, y, z, , , , alt]) => ({ id, name, alt: alt ?? '', p: [x, y, z], keys: new Set([norm(name), ...(alt ? [norm(alt)] : [])]) }));

const planets = [], left = [];
for (const sys of blocks(xml, 'system')) {
  const dist = num(own(sys, 'distance')[0]);
  const ra = own(sys, 'rightascension')[0], dec = own(sys, 'declination')[0];
  if (dist === null || !ra || !dec || dist * LY_PER_PC > map.radiusLy + 0.5) continue;
  const at = galactic(ra, dec, dist), far = Math.hypot(...at);
  // (Degrees between a star of the map and the system, as seen from the Sun.)
  const angle = (s) => { const r = Math.hypot(...s.p); return r ? (Math.acos(Math.max(-1, Math.min(1, (s.p[0] * at[0] + s.p[1] * at[1] + s.p[2] * at[2]) / (r * far)))) * 180) / Math.PI : 180; };
  const near = stars.filter((s) => s.id !== 0 && angle(s) < 3).sort((a, b) => angle(a) - angle(b));
  const sysNames = own(sys, 'name');
  // Hosts: each star with planets, and the system itself for planets round two stars.
  const hosts = blocks(sys, 'star').map((st) => ({ names: own(st, 'name'), planets: blocks(st, 'planet') }));
  const loose = blocks(sys.replace(/<star(\s[^>]*)?>[\s\S]*?<\/star>/g, ''), 'planet');
  if (loose.length) hosts.push({ names: sysNames, planets: loose });
  for (const h of hosts) {
    const confirmed = h.planets.filter((p) => own(p, 'list').includes('Confirmed planets'));
    if (!confirmed.length) continue;
    // (Names with and without a last component letter: "GJ 667 C", "gamma Cephei A".)
    const keys = new Set(h.names.flatMap((n) => [norm(n), norm(n.replace(/\s+[A-D]$/, ''))]));
    let star = near.find((s) => [...s.keys].some((k) => keys.has(k)));
    star ??= near.find((s) => angle(s) < 0.3 && Math.abs(Math.hypot(...s.p) - far) < 0.08 * far);
    if (!star) { left.push(`${decode(h.names[0] ?? sysNames[0])} (${(dist * LY_PER_PC).toFixed(1)} ly, ${confirmed.length} planets)`); continue; }
    for (const p of confirmed) {
      const mass = num(own(p, 'mass')[0]), radius = num(own(p, 'radius')[0]);
      planets.push([star.id, decode(own(p, 'name')[0]), num(own(p, 'period')[0]), num(own(p, 'semimajoraxis')[0]),
        mass === null ? null : Math.round(mass * EARTH_PER_JUPITER_MASS * 1000) / 1000, radius === null ? null : Math.round(radius * EARTH_PER_JUPITER_RADIUS * 1000) / 1000,
        num(own(p, 'discoveryyear')[0]), own(p, 'discoverymethod')[0] ?? null]);
    }
  }
}
planets.sort((a, b) => a[0] - b[0] || (a[2] ?? 1e9) - (b[2] ?? 1e9) || a[1].localeCompare(b[1]));
const file = {
  format: 'mapmaker-exoplanets-1',
  source: 'Open Exoplanet Catalogue, https://github.com/OpenExoplanetCatalogue/open_exoplanet_catalogue (oec_gzip, downloaded ' + new Date().toISOString().slice(0, 10) + ')',
  licence: 'MIT (see LICENSE-open-exoplanet-catalogue.txt)',
  planets,
};
writeFileSync(join(ROOT, 'data', 'stars', 'exoplanets-50ly.json'), JSON.stringify(file) + '\n');
writeFileSync(join(ROOT, 'data', 'stars', 'LICENSE-open-exoplanet-catalogue.txt'), `The Open Exoplanet Catalogue (exoplanets-50ly.json is taken from it)
https://github.com/OpenExoplanetCatalogue/open_exoplanet_catalogue

Copyright (C) 2012 Hanno Rein

Permission is hereby granted, free of charge, to any person obtaining a copy of this database and associated scripts (the "Database"), to deal in the Database without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Database, and to permit persons to whom the Database is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Database.
A reference to the Database shall be included in all scientific publications that make use of the Database.

THE DATABASE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE DATABASE OR THE USE OR OTHER DEALINGS IN THE DATABASE.
`);
const hosts = new Set(planets.map((p) => p[0]));
console.log(`${planets.length} planets of ${hosts.size} stars on the map; ${left.length} hosts not on the map:`);
for (const l of left) console.log(`  ${l}`);
