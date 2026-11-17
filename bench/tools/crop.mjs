// Crop and enlarge a region of PNG files side by side (nearest neighbour), to look closely at pictures.
// Usage: node bench/tools/crop.mjs <out.png> <x> <y> <w> <h> <scale> <file.png>...
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [out, x, y, w, h, scale, ...files] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage({ viewport: { width: files.length * (w * scale + 10) + 10, height: h * scale + 20 } });
const imgs = files.map((f) => `<div style="width:${w * scale}px;height:${h * scale}px;overflow:hidden;display:inline-block;margin:5px"><img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="image-rendering:pixelated;transform-origin:0 0;transform:scale(${scale}) translate(${-x}px,${-y}px)"></div>`).join('');
await page.setContent(`<body style="margin:0;background:#444">${imgs}</body>`);
await page.screenshot({ path: out });
await b.close();
