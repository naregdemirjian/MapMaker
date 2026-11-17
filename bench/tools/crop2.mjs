// Crop two regions of one PNG side by side. Usage: node crop2.mjs out.png file.png x y w h  x2 y2 scale
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [out, file, x, y, w, h, x2, y2, scale] = process.argv.slice(2).map((v, i) => (i < 2 ? v : Number(v)));
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage({ viewport: { width: 2 * (w * scale + 10) + 10, height: h * scale + 20 } });
const data = readFileSync(file).toString('base64');
const box = (cx, cy) => `<div style="width:${w * scale}px;height:${h * scale}px;overflow:hidden;display:inline-block;margin:5px"><img src="data:image/png;base64,${data}" style="image-rendering:pixelated;transform-origin:0 0;transform:scale(${scale}) translate(${-cx}px,${-cy}px)"></div>`;
await page.setContent(`<body style="margin:0;background:#444">${box(x, y)}${box(x2, y2)}</body>`);
await page.screenshot({ path: out });
await b.close();
