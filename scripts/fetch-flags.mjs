// Fetches the flags of today's nations (the 193 UN members, Vatican City, Palestine, Kosovo and
// Taiwan), and of the territories that have flags of their own (Greenland, Puerto Rico, the Faroe
// Islands…; marked `territory`, with the nation they belong to), as SVG drawings from the flag-icons
// package (MIT), with English names from Natural Earth, into data/flags/. The files are committed;
// run this only to update them.
//
//   node scripts/fetch-flags.mjs [--countries <ne_10m_admin_0_countries.geojson>] [--package <flag-icons folder>]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAG_ICONS = '7.6.0';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'data', 'flags');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

const countriesText = arg('--countries') ? readFileSync(arg('--countries'), 'utf8') : await (await fetch(NE)).text();
let pkg = arg('--package');
if (!pkg) {
  const tmp = mkdtempSync(join(tmpdir(), 'flags-'));
  execFileSync('npm', ['pack', `flag-icons@${FLAG_ICONS}`, '--silent'], { cwd: tmp });
  const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  execFileSync('tar', ['xzf', tgz], { cwd: tmp });
  pkg = join(tmp, 'package');
}

// Nations: Natural Earth's sovereign states, plus Israel, Kosovo and Palestine (listed there as
// disputed or indeterminate); not Somaliland or Northern Cyprus (not generally recognised).
const nations = [];
for (const f of JSON.parse(countriesText).features) {
  const p = f.properties;
  const sovereign = p.TYPE === 'Sovereign country' || p.TYPE === 'Sovereignty' || (p.TYPE === 'Country' && p.SOVEREIGNT === p.ADMIN) || ['Israel', 'Kosovo', 'Palestine'].includes(p.NAME);
  const code = String(p.ISO_A2_EH ?? '').toLowerCase();
  if (!sovereign || !/^[a-z]{2}$/.test(code)) continue;
  if (nations.some((n) => n.code === code)) continue;
  const name = p.NAME_EN === "People's Republic of China" ? 'China' : p.NAME_EN === 'East Timor' ? 'Timor-Leste' : p.NAME_EN;
  nations.push({ code, name });
}
// Territories with a flag of their own (Natural Earth's other units with a two-letter code).
for (const f of JSON.parse(countriesText).features) {
  const p = f.properties;
  const code = String(p.ISO_A2_EH ?? '').toLowerCase();
  // (Not Western Sahara, whose status is disputed and whose drawing is one side's flag, nor
  // Antarctica, whose drawing is an unofficial design.)
  if (!/^[a-z]{2}$/.test(code) || nations.some((n) => n.code === code) || code === 'eh' || code === 'aq') continue;
  nations.push({ code, name: p.NAME_EN, territory: true, of: p.SOVEREIGNT });
}
nations.sort((a, b) => a.name.localeCompare(b.name));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const missing = [];
for (const n of nations) {
  const src = join(pkg, 'flags', '4x3', `${n.code}.svg`);
  if (existsSync(src)) copyFileSync(src, join(out, `${n.code}.svg`)); else missing.push(n.name);
}
const list = nations.filter((n) => !missing.includes(n.name));
writeFileSync(join(out, 'index.json'), JSON.stringify(list, null, 1) + '\n');
copyFileSync(join(pkg, 'LICENSE'), join(out, 'LICENSE-flag-icons.txt'));
console.log(`${list.length} flags written to ${out}${missing.length ? `; no drawing for: ${missing.join(', ')}` : ''}`);

const record = {
  id: 'flag-icons',
  name: 'flag-icons',
  version: FLAG_ICONS,
  source: 'https://github.com/lipis/flag-icons (npm package flag-icons); nation names from Natural Earth',
  licence: 'MIT (the drawings); national flags themselves are generally not subject to copyright',
  credit: 'Flag drawings: flag-icons by Panayiotis Lipiridis and contributors, MIT licence.',
  usedFor: `Flags of today's ${list.filter((n) => !n.territory).length} nations and ${list.filter((n) => n.territory).length} territories, offered as country fills (optional)`,
  retrieved: new Date().toISOString().slice(0, 10),
};
const datasetsFile = join(root, 'data', 'datasets.json');
const all = existsSync(datasetsFile) ? JSON.parse(readFileSync(datasetsFile, 'utf8')).filter((d) => d.id !== record.id) : [];
all.push(record);
writeFileSync(datasetsFile, JSON.stringify(all, null, 2) + '\n');
console.log(`updated ${datasetsFile}`);
