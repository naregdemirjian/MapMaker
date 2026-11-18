// The SVG pen (Stage 10, D115): drawn on as a canvas is, it writes the same shapes and text as SVG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SvgPen, SvgPath, arcCurves, svgColour, esc, num, withSvgPaths } from '../src/export/svg-pen.ts';

/** The numbers of a path's data. */
const numbers = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const attr = (el: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(el)?.[1] ?? null;

test('numbers, text and colours as SVG writes them', () => {
  assert.equal(num(1.2345), '1.23');
  assert.equal(num(2.0), '2');
  assert.equal(num(-0.001), '0');
  assert.equal(num(10), '10');
  assert.equal(esc('Rhône & <Saône> "x"\u0001'), 'Rhône &amp; &lt;Saône&gt; &quot;x&quot;');
  assert.deepEqual(svgColour('#abc'), { color: '#aabbcc', opacity: 1 });
  assert.deepEqual(svgColour('#11223380'), { color: '#112233', opacity: 128 / 255 });
  assert.deepEqual(svgColour('rgba(10, 16, 24, 0.85)'), { color: '#0a1018', opacity: 0.85 });
  assert.deepEqual(svgColour('rgb(255,0,0)'), { color: '#ff0000', opacity: 1 });
  assert.equal(svgColour('transparent').opacity, 0);
  assert.deepEqual(SvgPen.fontParts('italic 600 14.5px "Segoe UI", Arial, sans-serif'), { style: 'italic', weight: '600', size: 14.5, family: '"Segoe UI", Arial, sans-serif' });
  assert.deepEqual(SvgPen.fontParts('500 12.0px Georgia, serif'), { style: 'normal', weight: '500', size: 12, family: 'Georgia, serif' });
});

test('arcs: on their circle, the way the canvas sweeps them', () => {
  const c = arcCurves(10, 20, 5, 5, 0, 0, Math.PI * 2, false);
  assert.equal(c.length, 2 + 4 * 6, 'a whole circle in four curves');
  for (let i = 0; i < c.length; i += 2) {
    // (End points lie on the circle; control points just outside.)
    const r = Math.hypot(c[i] - 10, c[i + 1] - 20);
    assert.ok(r >= 4.99 && r <= 5.75, `point ${i / 2} at ${r}`);
  }
  for (let i = 6; i < c.length; i += 6) assert.ok(Math.abs(Math.hypot(c[i] - 10, c[i + 1] - 20) - 5) < 1e-9);
  // Clockwise from 0 to a quarter turn: one curve, ending at the bottom (y down).
  const q = arcCurves(0, 0, 1, 1, 0, 0, Math.PI / 2, false);
  assert.equal(q.length, 8);
  assert.ok(Math.abs(q[6]) < 1e-9 && Math.abs(q[7] - 1) < 1e-9);
  // The other way round from 0 to a quarter turn: three quarters of the circle.
  assert.equal(arcCurves(0, 0, 1, 1, 0, 0, Math.PI / 2, true).length, 2 + 3 * 6);
});

test('shapes: filled and stroked through the transform of the moment, styles kept', () => {
  const pen = new SvgPen(100, 50);
  const ctx = pen.asContext();
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 10, 10);
  ctx.save();
  ctx.translate(20, 5);
  ctx.scale(2, 2);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(10, 0);
  ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.setLineDash([2, 1]);
  ctx.globalAlpha = 0.4;
  ctx.stroke();
  ctx.restore();
  const els = pen.body().split('\n');
  assert.equal(els.length, 2);
  assert.equal(attr(els[0], 'fill'), '#ff0000');
  assert.deepEqual(numbers(attr(els[0], 'd')!), [0, 0, 10, 0, 10, 10, 0, 10]);
  // The line: placed at (20,5)-(40,5), written in the units of the scaled transform.
  assert.equal(attr(els[1], 'transform'), 'matrix(2 0 0 2 20 5)');
  assert.deepEqual(numbers(attr(els[1], 'd')!), [0, 0, 10, 0]);
  assert.equal(attr(els[1], 'stroke'), '#0000ff');
  assert.equal(attr(els[1], 'stroke-opacity'), '0.5');
  assert.equal(attr(els[1], 'stroke-width'), '1.5');
  assert.equal(attr(els[1], 'stroke-linecap'), 'round');
  assert.equal(attr(els[1], 'stroke-dasharray'), '2 1');
  assert.equal(attr(els[1], 'opacity'), '0.4');
  assert.equal(attr(els[1], 'fill'), 'none');
  // Restored: back to plain painting.
  assert.equal(ctx.globalAlpha, 1);
  assert.equal(ctx.lineWidth, 1);
});

test('paths kept as Path2D, clipping, painting other than over left out', () => {
  const pen = new SvgPen(100, 100);
  const ctx = pen.asContext();
  const p = withSvgPaths(() => {
    const q = new Path2D();
    q.moveTo(1, 1); q.lineTo(5, 1); q.lineTo(5, 5); q.closePath();
    const r = new Path2D('M0 0L3 0L3 3Z');
    q.addPath(r);
    return q;
  });
  assert.ok(p instanceof SvgPath, 'Path2D stands for the pen\'s paths while drawing');
  assert.equal(typeof (globalThis as { Path2D?: unknown }).Path2D, 'undefined', 'and is put back');
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, 50, 50); ctx.clip();
  ctx.transform(10, 0, 0, 10, 0, 0);
  ctx.fillStyle = '#00ff00';
  ctx.fill(p as unknown as Path2D, 'evenodd');
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(0, 0, 10, 10);
  const body = pen.body();
  assert.match(body, /^<g clip-path="url\(#pc1\)">\n<path [^>]*fill-rule="evenodd"/);
  assert.match(body, /transform="matrix\(10 0 0 10 0 0\)"/);
  assert.match(pen.defs(), /<clipPath id="pc1" clipPathUnits="userSpaceOnUse"><path d="M0 0L50 0L50 50L0 50Z/);
  assert.equal(pen.drawnCount, 1, 'the erasing is left out');
  assert.equal(pen.skipped.get('painting by destination-out'), 1);
  // A Path2D not made by the pen cannot be read: left out, and a clip by one clips nothing away.
  const pen2 = new SvgPen(10, 10);
  pen2.asContext().clip({} as Path2D);
  pen2.asContext().fillRect(0, 0, 1, 1);
  assert.doesNotMatch(pen2.body(), /clip-path/);
});

test('text: placed, aligned and styled as on the canvas; halos as their own text', () => {
  const pen = new SvgPen(200, 100);
  const ctx = pen.asContext();
  ctx.font = 'italic 700 20.0px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '2.00px';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(10,16,24,0.8)';
  ctx.strokeText('Île-de-France & co', 100, 50);
  ctx.fillStyle = '#f4efe6';
  ctx.fillText('Île-de-France & co', 100, 50);
  const [halo, text] = pen.body().split('\n');
  for (const el of [halo, text]) {
    assert.equal(attr(el, 'text-anchor'), 'middle');
    assert.equal(attr(el, 'font-style'), 'italic');
    assert.equal(attr(el, 'font-weight'), '700');
    assert.equal(attr(el, 'font-size'), '20');
    assert.equal(attr(el, 'letter-spacing'), '2');
    assert.match(el, />Île-de-France &amp; co<\/text>$/);
    // (The middle of the text at y = 50: its baseline lower down.)
    assert.ok(Number(attr(el, 'y')) > 50 && Number(attr(el, 'y')) < 60);
  }
  assert.equal(attr(halo, 'fill'), 'none');
  assert.equal(attr(halo, 'stroke-width'), '4');
  assert.equal(attr(text, 'fill'), '#f4efe6');
  assert.ok(ctx.measureText('abc').width > 0);
});

test('gradients and patterns become definitions the shapes refer to', () => {
  const pen = new SvgPen(100, 100);
  const ctx = pen.asContext();
  const g = ctx.createRadialGradient(50, 50, 20, 50, 50, 40);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 100, 100);
  const defs = pen.defs();
  assert.match(defs, /<radialGradient id="pg1" gradientUnits="userSpaceOnUse" fx="50" fy="50" cx="50" cy="50" r="40">/);
  // (The inner radius kept: the first stop moved out to half way.)
  assert.match(defs, /<stop offset="0.5" stop-color="#000000" stop-opacity="0"\/><stop offset="1" stop-color="#000000" stop-opacity="0.5"\/>/);
  assert.match(pen.body(), /fill="url\(#pg1\)"/);
});
