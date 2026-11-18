// Downloads the HYG star database (v4.1, CC BY-SA 4.0) and keeps the stars within 50 light-years of the
// Sun, for space maps (Stage 11, D110): data/stars/nearby-50ly.json. The file is committed, so the app and
// the tests never need the network; run this only to update it.
//
//   node scripts/fetch-stars.mjs [--from <hygdata_v41.csv>]
//
// Format "mapmaker-stars-1": { format, radiusLy, axes, stars: [[id, name, x, y, z, absmag, spect, system, alt], ...] }
// - x, y, z: light-years from the Sun in galactic coordinates (x toward the galactic centre, y the way the
//   galaxy turns (longitude 90°), z toward the north galactic pole), rounded to 0.001 ly;
// - absmag: absolute visual magnitude (0.01); spect: the spectral type as HYG gives it;
// - name: the proper name, else the Bayer letter or Flamsteed number with the constellation, else the
//   Gliese, HD or Hipparcos number;
// - system: the id of the system's primary star when the star is a companion (0 otherwise);
// - alt: its other name: the Bayer letter or Flamsteed number with the constellation written out
//   ("Epsilon Eridani", "61 Cygni"), else the Gliese number ('' when the same as its name).
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const RADIUS_LY = 50;
const LY_PER_PC = 3.26156;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fromIdx = process.argv.indexOf('--from');
const text = fromIdx > 0 ? readFileSync(process.argv[fromIdx + 1], 'utf8') : await (async () => {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HYG: HTTP ${res.status}`);
  return res.text();
})();
const sha256 = createHash('sha256').update(text).digest('hex');

/** One CSV line into fields (quoted fields may hold commas). */
function fields(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const GREEK = { Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω' };
const SUP = { 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const LETTER = { Alp: 'Alpha', Bet: 'Beta', Gam: 'Gamma', Del: 'Delta', Eps: 'Epsilon', Zet: 'Zeta', Eta: 'Eta', The: 'Theta', Iot: 'Iota', Kap: 'Kappa', Lam: 'Lambda', Mu: 'Mu', Nu: 'Nu', Xi: 'Xi', Omi: 'Omicron', Pi: 'Pi', Rho: 'Rho', Sig: 'Sigma', Tau: 'Tau', Ups: 'Upsilon', Phi: 'Phi', Chi: 'Chi', Psi: 'Psi', Ome: 'Omega' };
/** The constellations' names in the genitive (for "Tau Ceti", "61 Cygni"). */
const GENITIVE = {
  And: 'Andromedae', Ant: 'Antliae', Aps: 'Apodis', Aqr: 'Aquarii', Aql: 'Aquilae', Ara: 'Arae', Ari: 'Arietis', Aur: 'Aurigae', Boo: 'Boötis', Cae: 'Caeli',
  Cam: 'Camelopardalis', Cnc: 'Cancri', CVn: 'Canum Venaticorum', CMa: 'Canis Majoris', CMi: 'Canis Minoris', Cap: 'Capricorni', Car: 'Carinae', Cas: 'Cassiopeiae',
  Cen: 'Centauri', Cep: 'Cephei', Cet: 'Ceti', Cha: 'Chamaeleontis', Cir: 'Circini', Col: 'Columbae', Com: 'Comae Berenices', CrA: 'Coronae Australis',
  CrB: 'Coronae Borealis', Crv: 'Corvi', Crt: 'Crateris', Cru: 'Crucis', Cyg: 'Cygni', Del: 'Delphini', Dor: 'Doradus', Dra: 'Draconis', Equ: 'Equulei',
  Eri: 'Eridani', For: 'Fornacis', Gem: 'Geminorum', Gru: 'Gruis', Her: 'Herculis', Hor: 'Horologii', Hya: 'Hydrae', Hyi: 'Hydri', Ind: 'Indi', Lac: 'Lacertae',
  Leo: 'Leonis', LMi: 'Leonis Minoris', Lep: 'Leporis', Lib: 'Librae', Lup: 'Lupi', Lyn: 'Lyncis', Lyr: 'Lyrae', Men: 'Mensae', Mic: 'Microscopii', Mon: 'Monocerotis',
  Mus: 'Muscae', Nor: 'Normae', Oct: 'Octantis', Oph: 'Ophiuchi', Ori: 'Orionis', Pav: 'Pavonis', Peg: 'Pegasi', Per: 'Persei', Phe: 'Phoenicis', Pic: 'Pictoris',
  Psc: 'Piscium', PsA: 'Piscis Austrini', Pup: 'Puppis', Pyx: 'Pyxidis', Ret: 'Reticuli', Sge: 'Sagittae', Sgr: 'Sagittarii', Sco: 'Scorpii', Scl: 'Sculptoris',
  Sct: 'Scuti', Ser: 'Serpentis', Sex: 'Sextantis', Tau: 'Tauri', Tel: 'Telescopii', Tri: 'Trianguli', TrA: 'Trianguli Australis', Tuc: 'Tucanae', UMa: 'Ursae Majoris',
  UMi: 'Ursae Minoris', Vel: 'Velorum', Vir: 'Virginis', Vol: 'Volantis', Vul: 'Vulpeculae',
};

/** A star's other name: its Bayer letter or Flamsteed number with the constellation written out ("Epsilon Eridani", "61 Cygni"), else its Gliese number. */
function altOf(r, name) {
  const con = GENITIVE[r.con.trim()];
  let alt = '';
  if (r.bayer.trim() && con) { const [letter, n] = r.bayer.trim().split('-'); alt = `${LETTER[letter] ?? letter}${n ? `-${n}` : ''} ${con}`; }
  else if (r.flam.trim() && con) alt = `${r.flam.trim()} ${con}`;
  else if (r.gl.trim()) alt = r.gl.trim().replace(/\s+/g, ' ');
  return alt && alt !== name ? alt : '';
}

function nameOf(r) {
  if (r.proper.trim()) return r.proper.trim();
  const con = r.con.trim();
  if (r.bayer.trim() && con) {
    const [letter, n] = r.bayer.trim().split('-');
    return `${GREEK[letter] ?? letter}${n ? SUP[n] ?? n : ''} ${con}`;
  }
  if (r.flam.trim() && con) return `${r.flam.trim()} ${con}`;
  if (r.gl.trim()) return r.gl.trim().replace(/\s+/g, ' ');
  if (r.hd.trim()) return `HD ${r.hd.trim()}`;
  if (r.hip.trim()) return `HIP ${r.hip.trim()}`;
  return `HYG ${r.id}`;
}

// Equatorial (J2000) to galactic axes (the IAU rotation).
const G = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
];

const lines = text.split(/\r?\n/);
const head = fields(lines[0]);
const at = Object.fromEntries(head.map((h, i) => [h, i]));
const stars = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const f = fields(lines[i]);
  const r = Object.fromEntries(head.map((h) => [h, f[at[h]] ?? '']));
  const dist = Number(r.dist);
  if (!(dist >= 0) || dist * LY_PER_PC > RADIUS_LY) continue;
  const e = [Number(r.x) * LY_PER_PC, Number(r.y) * LY_PER_PC, Number(r.z) * LY_PER_PC];
  const g = G.map((row) => row[0] * e[0] + row[1] * e[1] + row[2] * e[2]);
  const id = Number(r.id), primary = Number(r.comp_primary);
  const round = (v, k) => Math.round(v * k) / k;
  const name = nameOf(r);
  stars.push([id, name, round(g[0], 1000), round(g[1], 1000), round(g[2], 1000), round(Number(r.absmag), 100), r.spect.trim(), primary && primary !== id ? primary : 0, altOf(r, name)]);
}
// A companion named as its primary takes its letter ("61 Cyg B").
const byId = new Map(stars.map((s) => [s[0], s]));
const letters = new Map();
for (const s of stars) {
  const p = s[7] ? byId.get(s[7]) : null;
  if (!p || p[1] !== s[1]) continue;
  const n = (letters.get(p[0]) ?? 1) + 1;
  letters.set(p[0], n);
  s[1] = `${s[1]} ${String.fromCharCode(64 + n)}`;
}
stars.sort((a, b) => Math.hypot(a[2], a[3], a[4]) - Math.hypot(b[2], b[3], b[4]));
const out = join(root, 'data', 'stars', 'nearby-50ly.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ format: 'mapmaker-stars-1', radiusLy: RADIUS_LY, axes: 'galactic', stars }));
console.log(`wrote ${out}: ${stars.length} stars within ${RADIUS_LY} light-years`);

const datasetsFile = join(root, 'data', 'datasets.json');
if (existsSync(datasetsFile)) {
  const all = JSON.parse(readFileSync(datasetsFile, 'utf8'));
  const rec = {
    id: 'hyg',
    name: 'HYG star database',
    version: 'v4.1',
    source: 'https://www.astronexus.com/hyg (files from https://github.com/astronexus/HYG-Database)',
    licence: 'CC BY-SA 4.0',
    credit: 'Star positions: HYG database v4.1 by David Nash (astronexus.com), CC BY-SA 4.0.',
    usedFor: 'Space maps of the nearby stars: every star of the database within 50 light-years of the Sun (data/stars/nearby-50ly.json)',
    retrieved: new Date().toISOString().slice(0, 10),
    converted: 'Stars within 50 light-years kept; positions turned from parsecs on equatorial axes into light-years on galactic axes and rounded to 0.001 light-years; names made from the proper name, Bayer letter or Flamsteed number with the constellation, or the Gliese, HD or Hipparcos number, and a second name written out (\"Epsilon Eridani\"); nothing else changed. The converted file is under the same licence (CC BY-SA 4.0).',
    sources: [{ file: 'hygdata_v41.csv', sha256 }],
  };
  const i = all.findIndex((d) => d.id === rec.id);
  if (i >= 0) all[i] = rec; else all.push(rec);
  writeFileSync(datasetsFile, JSON.stringify(all, null, 2) + '\n');
  console.log(`updated ${datasetsFile}`);
}
