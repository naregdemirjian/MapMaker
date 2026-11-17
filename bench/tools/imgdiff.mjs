// How many pixels differ between two PNG files (and where). Usage: node imgdiff.mjs a.png b.png   (run from the project folder)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [fa, fb] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage();
const res = await page.evaluate(async ([a, c]) => {
  const load = async (d) => { const i = new Image(); i.src = 'data:image/png;base64,' + d; await i.decode(); const cv = new OffscreenCanvas(i.width, i.height); const x = cv.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height); };
  const A = await load(a), B = await load(c);
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0, p = 0; i < A.data.length; i += 4, p++) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 60) { n++; const x = p % A.width, y = Math.floor(p / A.width); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { differing: n, box: n ? [x0, y0, x1, y1] : null, size: [A.width, A.height] };
}, [readFileSync(fa).toString('base64'), readFileSync(fb).toString('base64')]);
console.log(JSON.stringify(res));
await b.close();
