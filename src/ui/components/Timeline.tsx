import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, useLive, store } from '../store.ts';
import {
  type Instant, toApproxYear, fromApproxYear, gregorian, formatYear, floorTo, instant, add, compare, fromStore, MS_PER_DAY,
} from '../../core-time/index.ts';
import { BASE_EVENT_ID } from '../../world-model/schema.ts';
import * as cmd from '../../domain/commands.ts';
import { GroupFilter, eventFilterSet } from './EventGroups.tsx';
import { typeColor } from '../../domain/event-types.ts';

/** Widths of event names on the timeline (one font), measured once each. */
const labelWidths = new Map<string, number>();
function labelWidth(ctx: CanvasRenderingContext2D, label: string): number {
  let w = labelWidths.get(label);
  if (w === undefined) {
    if (labelWidths.size > 20000) labelWidths.clear();
    labelWidths.set(label, (w = ctx.measureText(label).width));
  }
  return w;
}

const RULER = 26;
const LANE = 20;

type Unit = { years: number; kind: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'ms'; step: number };

function chooseUnit(yearsPerPx: number): Unit {
  const minYears = yearsPerPx * 80;
  const yearSteps: number[] = [];
  for (let e = 12; e >= 0; e--) for (const m of [5, 2, 1]) yearSteps.push(m * 10 ** e);
  const fine: Unit[] = [
    { years: 1 / 12 * 6, kind: 'month', step: 6 }, { years: 1 / 12 * 3, kind: 'month', step: 3 }, { years: 1 / 12, kind: 'month', step: 1 },
    { years: 7 / 365.2425, kind: 'day', step: 7 }, { years: 1 / 365.2425, kind: 'day', step: 1 },
    { years: 6 / 8765.82, kind: 'hour', step: 6 }, { years: 1 / 8765.82, kind: 'hour', step: 1 },
    { years: 10 / 525949, kind: 'minute', step: 10 }, { years: 1 / 525949, kind: 'minute', step: 1 },
    { years: 10 / 31556952, kind: 'second', step: 10 }, { years: 1 / 31556952, kind: 'second', step: 1 },
    { years: 0.1 / 31556952, kind: 'ms', step: 100 }, { years: 0.01 / 31556952, kind: 'ms', step: 10 }, { years: 0.001 / 31556952, kind: 'ms', step: 1 },
  ];
  let best: Unit = { years: yearSteps[0], kind: 'year', step: yearSteps[0] };
  for (const y of yearSteps) if (y >= minYears) best = { years: y, kind: 'year', step: y };
  if (best.step === 1 && minYears < 1) for (const f of fine) if (f.years >= minYears) best = f;
  return best;
}

function ticks(start: number, end: number, u: Unit): Array<{ t: number; label: string }> {
  const out: Array<{ t: number; label: string }> = [];
  if (u.kind === 'year') {
    for (let y = Math.ceil(start / u.step) * u.step; y <= end && out.length < 400; y += u.step) {
      const yr = Math.round(y);
      out.push({ t: toApproxYear(gregorian.fromCivil({ year: yr })), label: formatYear(yr) });
    }
    return out;
  }
  let t: Instant;
  const s0 = fromApproxYear(start);
  if (u.kind === 'month') {
    const c = gregorian.toCivil(s0);
    let y = c.year, m = Math.floor((c.month - 1) / u.step) * u.step + 1;
    for (let i = 0; i < 400; i++) {
      t = gregorian.fromCivil({ year: y, month: m });
      const ty = toApproxYear(t);
      if (ty > end) break;
      if (ty >= start) out.push({ t: ty, label: m === 1 ? formatYear(y) : gregorian.format(t, 'month') });
      m += u.step;
      while (m > 12) { m -= 12; y++; }
    }
    return out;
  }
  const unitMs = u.kind === 'day' ? MS_PER_DAY : u.kind === 'hour' ? 3_600_000 : u.kind === 'minute' ? 60_000 : u.kind === 'second' ? 1000 : 1;
  const stepMs = unitMs * u.step;
  const base = floorTo(s0, u.kind === 'ms' ? 'second' : u.kind);
  for (let i = 0; i < 2000; i++) {
    t = add(base, 0, i * stepMs);
    const ty = toApproxYear(t);
    if (ty > end) break;
    if (ty < start) continue;
    const c = gregorian.toCivil(t);
    const label = u.kind === 'day' ? `${c.day} ${gregorian.format(t, 'month').split(' ')[0].slice(0, 3)}${c.day === 1 && c.month === 1 ? ' ' + formatYear(c.year) : ''}`
      : u.kind === 'ms' ? `${String(c.second).padStart(2, '0')}.${String(c.millisecond).padStart(3, '0')}`
      : `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}${u.kind === 'second' ? ':' + String(c.second).padStart(2, '0') : ''}`;
    out.push({ t: ty, label });
    if (out.length > 300) break;
  }
  return out;
}

export function Timeline() {
  const s = useLive();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(800);
  const [h, setH] = useState(150);
  const drag = useRef<null | { kind: 'scrub' } | { kind: 'pan'; x: number; start: number; end: number }>(null);
  const bars = useRef<Array<{ id: string; x0: number; x1: number; y: number }>>([]);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => { setW(el.clientWidth); setH(el.clientHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { start, end } = s.timeline;
  const xOf = (y: number) => ((y - start) / (end - start)) * w;
  const yearAt = (x: number) => start + (x / w) * (end - start);

  /** Everything but the playhead, kept as a picture until something it shows changes (dragging through time redraws the playhead only). */
  const still = useRef<{ key: string; canvas: OffscreenCanvas; bars: Array<{ id: string; x0: number; x1: number; y: number }> } | null>(null);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !s.world) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const world = s.world;
    const key = [world.serial, world.tableRevision('event'), world.tableRevision('event_type'), world.tableRevision('event_group'), world.tableRevision('event_group_member'), s.engine!.revision, start, end, W, H, dpr,
      s.selection?.kind === 'event' ? s.selection.id : '', s.recordEventId ?? '', (s.eventFilter ?? ['*']).join(',')].join('|');
    if (!still.current || still.current.key !== key) {
      const canvas = still.current && still.current.canvas.width === W && still.current.canvas.height === H ? still.current.canvas : new OffscreenCanvas(W, H);
      const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#10161d';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#18212b';
    ctx.fillRect(0, 0, w, RULER);
    const u = chooseUnit((end - start) / w);
    ctx.font = '11px "Segoe UI", Inter, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    for (const tk of ticks(start, end, u)) {
      const x = xOf(tk.t);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.moveTo(x + 0.5, RULER); ctx.lineTo(x + 0.5, h); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.moveTo(x + 0.5, RULER - 7); ctx.lineTo(x + 0.5, RULER); ctx.stroke();
      ctx.fillStyle = '#aab6c3';
      ctx.fillText(tk.label, x + 4, 11);
    }
    // change markers
    ctx.fillStyle = 'rgba(255,209,102,0.7)';
    for (const t of s.engine!.changeInstants()) {
      const x = xOf(toApproxYear(t));
      if (x >= 0 && x <= w) ctx.fillRect(x - 0.5, RULER - 4, 1.5, 4);
    }
    // event bars in lanes
    const filter = eventFilterSet();
    const events = s.world.all('event').filter((e) => e.id !== BASE_EVENT_ID && cmd.eventShown(s.world!, e.id, filter)).sort((a, b) => a.start_day - b.start_day || a.start_ms - b.start_ms);
    const groupColor = new Map(s.world.all('event_group').map((g) => [g.id, g.color]));
    const laneEnds: number[] = [];
    const found: Array<{ id: string; x0: number; x1: number; y: number }> = [];
    for (const e of events) {
      const ys = toApproxYear(fromStore(e.start_day, e.start_ms));
      const ye = e.end_day !== null ? toApproxYear(fromStore(e.end_day, e.end_ms ?? 0)) : ys;
      const x0 = xOf(ys), x1 = Math.max(xOf(ye), x0 + 8);
      if (x1 < -200 || x0 > w + 200) continue;
      let lane = laneEnds.findIndex((le) => le < x0 - 4);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      ctx.font = '11px "Segoe UI", Inter, Arial, sans-serif';
      const label = e.variant_group && !e.variant_active ? `${e.name} (inactive alternative)` : e.name;
      const tw = labelWidth(ctx, label);
      laneEnds[lane] = Math.max(x1, x0 + tw + 10);
      const y = RULER + 6 + lane * LANE;
      if (y + LANE > h) continue;
      const selected = s.selection?.kind === 'event' && s.selection.id === e.id;
      const recording = s.recordEventId === e.id;
      ctx.globalAlpha = e.variant_group && !e.variant_active ? 0.4 : 1;
      ctx.fillStyle = recording ? '#d1495b' : selected ? '#ffd166' : typeColor(world, e.type_id) ?? '#4f7ca8';
      ctx.beginPath(); ctx.roundRect(x0, y, x1 - x0, LANE - 6, 3); ctx.fill();
      // The colours of the event's groups, as stripes along the bar's top edge.
      const gs = cmd.groupsOfEvent(s.world, e.id);
      gs.forEach((g, i) => { ctx.fillStyle = groupColor.get(g) ?? '#888'; const gw = (x1 - x0) / gs.length; ctx.fillRect(x0 + i * gw, y, gw, 3); });
      ctx.fillStyle = '#e8eef4';
      ctx.fillText(label, Math.max(x0, 0) + (x1 - x0 > tw + 8 ? 4 : x1 - x0 + 4), y + (LANE - 6) / 2);
      ctx.globalAlpha = 1;
      found.push({ id: e.id, x0, x1: Math.max(x1, x0 + tw + 8), y });
    }
      still.current = { key, canvas, bars: found };
    }
    bars.current = still.current.bars;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(still.current.canvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The other date being compared (Stage 3): a dashed yellow line.
    if (s.compare.on && s.mode === 'world') {
      const cx = xOf(toApproxYear(s.compare.time));
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
      ctx.setLineDash([]);
    }
    // playhead
    const px = xOf(toApproxYear(s.time));
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath(); ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px, 8); ctx.fill();
  });

  function timeAtX(x: number): Instant {
    const y = yearAt(Math.max(0, Math.min(w, x)));
    const t = fromApproxYear(y);
    const msPerPx = ((end - start) / w) * 365.2425 * MS_PER_DAY;
    if (msPerPx > MS_PER_DAY) return instant(Math.round(t.day + t.ms / MS_PER_DAY));
    if (msPerPx > 60_000) return instant(t.day, Math.round(t.ms / 60_000) * 60_000);
    if (msPerPx > 1000) return instant(t.day, Math.round(t.ms / 1000) * 1000);
    return t;
  }

  const localX = (e: { clientX: number }) => e.clientX - ref.current!.getBoundingClientRect().left;
  const localY = (e: { clientY: number }) => e.clientY - ref.current!.getBoundingClientRect().top;

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = localX(e), y = localY(e);
    if (e.button === 1 || e.button === 2 || e.shiftKey) { drag.current = { kind: 'pan', x, start, end }; return; }
    const hit = bars.current.find((b) => x >= b.x0 && x <= b.x1 && y >= b.y && y <= b.y + LANE - 6);
    if (hit) {
      const ev = store.world!.get('event', hit.id)!;
      store.set({ selection: { kind: 'event', id: hit.id }, time: fromStore(ev.start_day, ev.start_ms) });
      return;
    }
    drag.current = { kind: 'scrub' };
    store.setTime(timeAtX(x));
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    const x = localX(e);
    if (d.kind === 'scrub') store.setTime(timeAtX(x), true);
    else {
      const dy = ((x - d.x) / w) * (d.end - d.start);
      store.set({ timeline: { start: d.start - dy, end: d.end - dy } });
    }
  }

  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const x = localX(e);
      const { start: a, end: b } = store.timeline;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dy = ((e.deltaX || e.deltaY) / w) * (b - a);
        store.set({ timeline: { start: a + dy, end: b + dy } });
        return;
      }
      const f = Math.exp(e.deltaY / 300);
      const pivot = a + (x / w) * (b - a);
      let span = (b - a) * f;
      span = Math.max(1e-12, Math.min(5e13, span));
      const na = pivot - ((pivot - a) / (b - a)) * span;
      store.set({ timeline: { start: na, end: na + span } });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  return (
    <div className="timeline" ref={wrap}>
      <canvas
        ref={ref}
        style={{ width: w, height: h }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => { store.fitTimeline(); store.notify(); }}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="timeline"
      />
      <GroupFilter />
    </div>
  );
}

export function stepChange(dir: 1 | -1) {
  const e = store.engine;
  if (!e) return;
  const times = e.changeInstants();
  const t = store.time;
  const next = dir > 0 ? times.find((x) => compare(x, t) > 0) : [...times].reverse().find((x) => compare(x, t) < 0);
  if (next) store.setTime(next);
}
