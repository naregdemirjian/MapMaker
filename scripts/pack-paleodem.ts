// Earth through geological time (D134, D135): the cells written by scripts/paleodem-extract.py, and the crust's
// motion between the maps written by scripts/paleo-motion.py, packed into data/paleo/paleodem-1deg.bin in the
// "MMP2" format of src/terrain/paleo.ts ("MMP1" without the motion; each map coded as terrain files are,
// src/terrain/grid.ts).
//
//   node scripts/pack-paleodem.ts <cells.i16> <out.bin> [motion.i8]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { encodePaleo } from '../src/terrain/paleo.ts';

const [cellsPath, out, motionPath] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(cellsPath + '.json', 'utf8')) as { ages: number[]; labels: string[] };
const raw = readFileSync(cellsPath);
const all = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const W = 360, H = 180, n = W * H;
if (all.length !== meta.ages.length * n) throw new Error('The cells and their ages do not match.');
const grids = meta.ages.map((_, i) => ({ width: W, height: H, step: 1, data: all.slice(i * n, (i + 1) * n) }));
let motion: Int8Array[] | undefined;
if (motionPath) {
  const m = readFileSync(motionPath), all = new Int8Array(m.buffer, m.byteOffset, m.byteLength);
  if (all.length !== (meta.ages.length - 1) * 2 * n) throw new Error('The motion and the maps do not match.');
  motion = Array.from({ length: meta.ages.length - 1 }, (_, i) => all.slice(i * 2 * n, (i + 1) * 2 * n));
}
const bytes = encodePaleo({ ages: meta.ages, labels: meta.labels, grids, motion }, (b) => deflateSync(b, { level: 9 }));
writeFileSync(out, bytes);
console.log(`${meta.ages.length} maps${motion ? ' and the motion between them' : ''}, ${(bytes.length / 1e6).toFixed(2)} MB`);
