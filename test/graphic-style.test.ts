// The look of a shot's graphics (D184): styles checked and kept in range, templates whole, lines coming in one after
// another, and the ways of coming in and going.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphicStyleOf, lineProgress, animState, withAlpha, GRAPHIC_TEMPLATES, DEFAULT_GRAPHIC, ANIMS_IN, ANIMS_OUT } from '../src/presentation/graphic-style.ts';
import { textBoxOf } from '../src/presentation/sequence.ts';

test('a graphic style as stored is checked: shapes known, values in range, missing parts from the defaults', () => {
  assert.deepEqual(graphicStyleOf(undefined), DEFAULT_GRAPHIC);
  const g = graphicStyleOf({ panel: { shape: 'star', glass: 999, grain: 2, accent: { side: 'left', width: 500 } }, text: { spacing: 99, upper: true, lineHeight: 0.1 }, stagger: -1 });
  assert.deepEqual([g.panel.shape, g.panel.glass, g.panel.grain, g.panel.accent.side, g.panel.accent.width], ['rounded', 60, 1, 'left', 60]);
  assert.deepEqual([g.text.spacing, g.text.upper, g.text.lineHeight, g.stagger], [60, true, 0.8, 0]);
  for (const t of GRAPHIC_TEMPLATES) assert.deepEqual(graphicStyleOf(t.style), t.style, `the ${t.name} template as it is`);
  assert.equal(withAlpha('#ff8000', 0.5), 'rgba(255,128,0,0.5)');
});

test('lines one after another: the first in first, the last when the whole is in', () => {
  assert.equal(lineProgress(0.5, 3, 4, 0, 1), 0.5, 'all together without a stagger');
  assert.equal(lineProgress(0, 0, 4, 0.2, 1), 0);
  assert.equal(lineProgress(1, 3, 4, 0.2, 1), 1, 'every line in at the end');
  assert.ok(lineProgress(0.3, 0, 4, 0.2, 1) > lineProgress(0.3, 3, 4, 0.2, 1), 'the first line ahead of the last');
});

test('ways of coming in and going: in place when done, away when not begun', () => {
  for (const k of [...ANIMS_IN, ...ANIMS_OUT]) {
    const done = animState(k, 1, 40);
    assert.deepEqual([done.dx, done.dy, done.scale, done.blur, done.alpha, done.wipe], [0, 0, 1, 0, 1, 1], `${k}: in place when done`);
  }
  assert.ok(animState('slide-left', 0, 40).dx < 0 && animState('slide-right', 0, 40).dx > 0);
  assert.ok(animState('blur', 0, 40).blur > 0 && animState('wipe', 0, 40).wipe === 0 && animState('scale', 0, 40).scale < 1);
  // A text box keeps the new ways when stored.
  assert.equal(textBoxOf({ enter: 'slide-left', exit: 'wipe' }).enter, 'slide-left');
  assert.equal(textBoxOf({ enter: 'slide-left', exit: 'wipe' }).exit, 'wipe');
  assert.equal(textBoxOf({ enter: 'cartwheel' as never }).enter, 'fade');
});
