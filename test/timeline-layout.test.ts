// The timeline's tracks and snapping (D201).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTrack, layoutTracks, barAt, snap, nest, LANE, FOLDED, TRACK_PAD, MAX_LANES, KID_MIN, type TLEvent } from '../src/ui/timeline-layout.ts';

const ev = (id: string, x0: number, x1: number, labelW = 60, track = 'a'): TLEvent => ({ id, x0, x1, labelW, track });

test('timeline: a track packs its events in lanes with their names, never overlapping', () => {
  const { bars, lanes } = layoutTrack([ev('a', 0, 50), ev('b', 20, 80), ev('c', 200, 240), ev('d', 60, 90)]);
  assert.equal(lanes, 3);
  assert.ok(bars.every((b) => b.label && b.ids.length === 1));
  for (const a of bars) for (const b of bars) if (a !== b && a.lane === b.lane) assert.ok(a.hit1 < b.x0 || b.hit1 < a.x0, `${a.ids} and ${b.ids} overlap`);
  assert.equal(bars.find((b) => b.ids[0] === 'c')!.lane, 0, 'a later event takes the first lane that is free again');
});

test('timeline: too many for its lanes, a track drops names, then runs events together into blocks', () => {
  // Twelve events a few pixels apart: named they need twelve lanes, bare they fit.
  const close = Array.from({ length: 12 }, (_, i) => ev(`e${i}`, i * 16, i * 16 + 8, 90));
  const bare = layoutTrack(close);
  assert.ok(bare.lanes <= MAX_LANES);
  assert.equal(bare.bars.length, 12);
  assert.equal(bare.bars.filter((b) => b.label).length, 1, 'only the last has room for its name');
  // Three hundred on top of one another: blocks, each saying how many it holds, and a lone event far off as itself.
  const many = [...Array.from({ length: 300 }, (_, i) => ev(`m${i}`, 100 + (i % 150), 100 + (i % 150) + 40)), ev('far', 900, 940)];
  const run = layoutTrack(many);
  assert.equal(run.lanes, 1);
  assert.deepEqual(run.bars.map((b) => b.ids.length), [300, 1]);
  assert.equal(run.bars[0].x0, 100);
  assert.equal(run.bars[1].ids[0], 'far');
});

test('timeline: tracks lie one under another; a folded one is a thin line of marks; bars are found by place', () => {
  const events = [ev('a', 0, 50, 60, 'wars'), ev('b', 20, 80, 60, 'wars'), ev('c', 10, 30, 60, 'treaties'), ev('d', 5, 9, 60, 'other')];
  const { tracks, height } = layoutTracks(events, [{ id: 'wars', folded: false }, { id: 'treaties', folded: true }, { id: 'other', folded: false }, { id: 'empty', folded: false }], 30);
  assert.deepEqual(tracks.map((t) => [t.id, t.y, t.height, t.count]), [
    ['wars', 30, 2 * LANE + TRACK_PAD, 2], ['treaties', 30 + 2 * LANE + TRACK_PAD, FOLDED, 1],
    ['other', 30 + 2 * LANE + TRACK_PAD + FOLDED, LANE + TRACK_PAD, 1], ['empty', 30 + 3 * LANE + 2 * TRACK_PAD + FOLDED, LANE + TRACK_PAD, 0]]);
  assert.equal(height, 4 * LANE + 3 * TRACK_PAD + FOLDED);
  assert.deepEqual(tracks[1].marks, [10]);
  assert.equal(barAt(tracks, 25, 30 + 3 + 5)?.bar.ids[0], 'a');
  assert.equal(barAt(tracks, 25, 30 + 3 + LANE + 5)?.bar.ids[0], 'b');
  assert.equal(barAt(tracks, 65, 30 + 3 + 5)?.bar.ids[0], 'a', 'its name counts as the bar');
  assert.equal(barAt(tracks, 15, tracks[1].y + 4), null, 'nothing to click in a folded track');
  assert.equal(barAt(tracks, 400, 35), null);
});

test('timeline: an event inside a longer one of its track is drawn within it, not on a lane of its own (D211)', () => {
  // A war from 0 to 300; two battles and a truce inside it; a treaty after it; a short skirmish too short to hold anything.
  const war = { ...ev('war', 0, 300, 40), span: [0, 300] as [number, number] };
  const battle1 = { ...ev('b1', 20, 60, 30), span: [20, 60] as [number, number] };
  const battle2 = { ...ev('b2', 40, 120, 30), span: [40, 120] as [number, number] };
  const truce = { ...ev('truce', 200, 208, 30), span: [200, 200] as [number, number] }; // a point, drawn 8 wide
  const treaty = { ...ev('treaty', 310, 330, 40), span: [310, 330] as [number, number] };
  const skirmish = { ...ev('sk', 400, 420, 20), span: [400, 420] as [number, number] };
  const inSk = { ...ev('in', 405, 410, 20), span: [405, 410] as [number, number] };
  const n = nest([war, battle1, battle2, truce, treaty, skirmish, inSk]);
  assert.deepEqual(n.top.map((e) => e.id).sort(), ['in', 'sk', 'treaty', 'war']);
  assert.deepEqual(n.kids.get('war')!.map((e) => e.id), ['b1', 'b2', 'truce'], 'in order, the outermost holding them');
  assert.equal(n.kids.get('sk'), undefined, 'a bar narrower than 30 pixels holds nothing');
  const same = nest([ev('x', 0, 100), ev('y', 0, 100)]);
  assert.equal(same.top.length, 2, 'two of the same length do not hold each other');

  const { bars, lanes } = layoutTrack([war, battle1, battle2, truce, treaty]);
  const w = bars.find((b) => b.ids[0] === 'war')!;
  assert.deepEqual(w.kids!.map((k) => k.ids[0]), ['b1', 'b2', 'truce']);
  assert.ok(w.kids!.every((k) => k.lane === w.lane && k.x0 >= w.x0 && k.x1 <= w.x1));
  assert.equal(w.kids![2].x1 - w.kids![2].x0, KID_MIN, 'a point inside is drawn narrow');
  assert.ok(w.kids![0].label && !w.kids![2].label, 'names inside only where they fit');
  // Its name has no room before the first battle, so it goes after the bar, where the treaty would be: the treaty takes the next lane.
  assert.equal(w.hit1, 300 + 40 + 12);
  assert.equal(lanes, 2);
  // A click on a battle finds the battle; elsewhere on the war, the war.
  const { tracks } = layoutTracks([war, battle1, battle2, truce, treaty].map((e) => ({ ...e, track: 't' })), [{ id: 't', folded: false }]);
  assert.equal(barAt(tracks, 30, 3 + 5)?.bar.ids[0], 'b1');
  assert.equal(barAt(tracks, 100, 3 + 5)?.bar.ids[0], 'b2', 'the later of two overlapping, drawn on top');
  assert.equal(barAt(tracks, 160, 3 + 5)?.bar.ids[0], 'war');
  // A long event holding three hundred: one bar, every event counted once.
  const m = (i: number) => ({ ...ev(`m${i}`, 100 + (i % 150), 100 + (i % 150) + 40), span: [100 + (i % 150), 100 + (i % 150) + 40] as [number, number] });
  const held = layoutTrack([...Array.from({ length: 300 }, (_, i) => m(i)), { ...ev('long', 90, 400), span: [90, 400] as [number, number] }]);
  assert.equal(held.bars.length, 1);
  assert.equal(held.bars[0].kids!.length, 300);
  // Run together into a block, the events inside are counted in it.
  const run = layoutTrack([...Array.from({ length: 300 }, (_, i) => m(i)), { ...ev('k', 110, 115), span: [110, 115] as [number, number] }]);
  assert.deepEqual(run.bars.map((b) => b.ids.length), [301]);
});

test('timeline: a value snaps to the nearest of some values within reach, else stays', () => {
  const at = [10, 50, 53, 200];
  assert.equal(snap(12, at, 5), 10);
  assert.equal(snap(51.4, at, 5), 50);
  assert.equal(snap(51.6, at, 5), 53);
  assert.equal(snap(100, at, 5), 100);
  assert.equal(snap(204, at, 5), 200);
  assert.equal(snap(7, [], 5), 7);
});
