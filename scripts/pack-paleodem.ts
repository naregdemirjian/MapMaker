// Earth through geological time (D134), step 2 of 2: the cells written by scripts/paleodem-extract.py packed
// into data/paleo/paleodem-1deg.bin, in the "MMP1" format of src/terrain/paleo.ts (each map coded as
// terrain files are, src/terrain/grid.ts).
//
//   node scripts/pack-paleodem.ts <cells.i16> <out.bin>
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { encodePaleo } from '../src/terrain/paleo.ts';

const [cellsPath, out] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(cellsPath + '.json', 'utf8')) as { ages: number[]; labels: string[] };
const raw = readFileSync(cellsPath);
const all = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const W = 360, H = 180, n = W * H;
if (all.length !== meta.ages.length * n) throw new Error('The cells and their ages do not match.');
const grids = meta.ages.map((_, i) => ({ width: W, height: H, step: 1, data: all.slice(i * n, (i + 1) * n) }));
const bytes = encodePaleo({ ages: meta.ages, labels: meta.labels, grids }, (b) => deflateSync(b, { level: 9 }));
writeFileSync(out, bytes);
console.log(`${meta.ages.length} maps, ${(bytes.length / 1e6).toFixed(2)} MB`);
