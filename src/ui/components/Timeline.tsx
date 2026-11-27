import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, useLive, store } from '../store.ts';
import {
  type Instant, type Calendar, toApproxYear, fromApproxYear, gregorian, formatYear, floorTo, instant, add, compare, fromStore, MS_PER_DAY, DEEP_BEFORE_YEAR, PRESENT_YEAR,
} from '../../core-time/index.ts';
import { calendarNow } from '../calendar-now.ts';
import { listedHere } from '../events-here.ts';
import { branchLine, branchStart } from '../../temporal-engine/branches.ts';
import * as cmd from '../../domain/commands.ts';
import { GroupFilter, eventFilterSet, sortedGroups } from './EventGroups.tsx';
import { layoutTracks, barAt, snap, LANE, BAR, type TLEvent, type TLTrack } from '../timeline-layout.ts';
import { openMenu, eventMenu } from './ContextMenu.tsx';
import type { MenuItem } from '../store.ts';
import { nameMatches } from '../name-match.ts';
import { changesAt, changeTime } from './ChangePanel.tsx';
import { typeColor } from '../../domain/event-types.ts';
import { eventFacts } from '../../domain/event-table.ts';

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

const RULER = 22;

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

/** A calendar's average year, in Gregorian years (its ticks are spaced by its own years). */
const yearShare = new WeakMap<Calendar, number>();
function yearsPerYear(cal: Calendar): number {
  let v = yearShare.get(cal);
  if (v === undefined) {
    let days = 0;
    for (let y = 1; y <= 400; y++) for (let m = 1; m <= cal.monthsIn(y); m++) days += cal.daysIn(y, m);
    v = (days / 400 / 365.2425) * (cal.hoursPerDay / 24);
    yearShare.set(cal, v);
  }
  return v;
}

/** Ticks along the timeline in a calendar of one's own (D149): its years, its months, its days. */
function ownTicks(start: number, end: number, u: Unit, cal: Calendar): Array<{ t: number; label: string }> {
  const out: Array<{ t: number; label: string }> = [];
  const s0 = fromApproxYear(start);
  if (u.kind === 'year') {
    const step = Math.max(1, Math.round(u.step / yearsPerYear(cal)));
    const y0 = cal.toCivil(s0).year;
    for (let y = Math.ceil(y0 / step) * step; out.length < 400; y += step) {
      const ty = toApproxYear(cal.fromCivil({ year: y }));
      if (ty > end) break;
      if (ty >= start) out.push({ t: ty, label: cal.yearLabel(y) });
    }
    return out;
  }
  if (u.kind === 'month') {
    // (Counted from each year's first month, which always has a tick, with the year.)
    const c = cal.toCivil(s0);
    let y = c.year, m = 1, n = 0;
    for (let i = 0; i < 800 && out.length < 400; i++) {
      if (cal.daysIn(y, m) > 0) {
        const t = cal.fromCivil({ year: y, month: m });
        const ty = toApproxYear(t);
        if (ty > end) break;
        const firstMonth = m === 1 || (m === 2 && cal.daysIn(y, 1) === 0);
        if (ty >= start && n % u.step === 0) out.push({ t: ty, label: firstMonth ? cal.yearLabel(y) : cal.monthName(y, m, true) });
        n++;
      }
      m++;
      if (m > cal.monthsIn(y)) { m = 1; y++; n = 0; }
    }
    return out;
  }
  const base = floorTo(s0, u.kind === 'ms' ? 'second' : u.kind, 1, cal);
  for (let i = 0; i < 2000 && out.length <= 300; i++) {
    const t = u.kind === 'day' ? cal.addDays(base, i * u.step) : add(base, 0, i * u.step * (u.kind === 'hour' ? 3_600_000 : u.kind === 'minute' ? 60_000 : u.kind === 'second' ? 1000 : 1));
    const ty = toApproxYear(t);
    if (ty > end) break;
    if (ty < start) continue;
    const c = cal.toCivil(t);
    const label = u.kind === 'day' ? `${c.day} ${cal.monthName(c.year, c.month, true)}${c.day === 1 && c.month === 1 ? ' ' + cal.yearLabel(c.year) : ''}`
      : u.kind === 'ms' ? `${String(c.second).padStart(2, '0')}.${String(c.millisecond).padStart(3, '0')}`
      : `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}${u.kind === 'second' ? ':' + String(c.second).padStart(2, '0') : ''}`;
    out.push({ t: ty, label });
  }
  return out;
}

function ticks(start: number, end: number, u: Unit, cal: Calendar = gregorian): Array<{ t: number; label: string }> {
  if (cal !== gregorian) return ownTicks(start, end, u, cal);
  const out: Array<{ t: number; label: string }> = [];
  if (u.kind === 'year') {
    for (let y = Math.ceil(start / u.step) * u.step; y <= end && out.length < 400; y += u.step) {
      let yr = Math.round(y);
      // (Deep time, D134: ticks at round numbers of years ago, as they are written.)
      if (yr < DEEP_BEFORE_YEAR && u.step >= 1000) yr = PRESENT_YEAR - Math.round((PRESENT_YEAR - yr) / u.step) * u.step;
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

const HEADS = 150, OTHER_FOLDED = 12, OTHER_OPEN = 46;
const FONT = '11px "Segoe UI", Inter, Arial, sans-serif';
let measurer: CanvasRenderingContext2D | null = null;
/** The width of a name on the timeline. */
function nameWidth(label: string): number {
  if (!measurer) { measurer = new OffscreenCanvas(1, 1).getContext('2d') as unknown as CanvasRenderingContext2D; measurer.font = FONT; }
  return labelWidth(measurer, label);
}

/** What the timeline shows, worked out once for each state of it. */
interface Laid {
  tracks: TLTrack[];
  height: number;
  /** A track's name, colour and how many events it has in all. */
  info: Map<string, { name: string; color: string; total: number }>;
  /** Where things snap to, in years, in order. */
  snaps: number[];
}

/**
 * The timeline (D201). Events come first: every group of events has a track of its own, with a head at the
 * left that folds it to a thin line; the tracks scroll when they are taller than their room. Under them, a
 * strip for everything else (the dates of changes, where branches split off), folded to a line until wanted.
 * Above, play, the date viewed, a find box, snapping and zoom.
 */
export function Timeline({ head }: { head?: React.ReactNode }) {
  const s = useLive();
  useHistoryPlayer();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(800);
  const [h, setH] = useState(150);
  const [scroll, setScroll] = useState(0);
  /** An event being dragged: where it would be, in years. */
  const [preview, setPreview] = useState<null | { id: string; ys: number; ye: number | null }>(null);
  /** The track an event is dragged onto (another group's), and a track's head being dragged to another place. */
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const [headDrag, setHeadDrag] = useState<null | { id: string; y0: number; dy: number; moved: boolean }>(null);
  const justDragged = useRef(false);
  type Drag = { kind: 'scrub' } | { kind: 'pan'; x: number; y: number; start: number; end: number; scroll: number }
    | { kind: 'bar'; id: string; mode: 'move' | 'start' | 'end'; x: number; y: number; ys: number; ye: number | null; moved: boolean; track: string; across: boolean };
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => { setW(el.clientWidth); setH(el.clientHeight); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { start, end } = s.timeline;
  const xOf = (y: number) => ((y - start) / (end - start)) * w;
  const yearAt = (x: number) => start + (x / w) * (end - start);
  const world = s.world!;
  const otherOpen = s.collapsed.includes('tl:other');
  const otherH = otherOpen ? OTHER_OPEN : OTHER_FOLDED;
  const tracksH = Math.max(0, h - RULER - otherH);
  const find = s.timelineFind.trim();

  const layKey = [world.serial, world.tableRevision('event'), world.tableRevision('event_group'), world.tableRevision('event_group_member'), world.tableRevision('branch'), s.branch, s.spaceId,
    (s.eventFilter ?? ['*']).join(','), s.collapsed.filter((k) => k.startsWith('tl:')).join(','), start, end, w, preview ? `${preview.id}:${preview.ys}:${preview.ye}` : '', s.engine?.revision ?? 0].join('|');
  const lay = useMemo((): Laid => {
    const filter = eventFilterSet();
    const groups = sortedGroups(world), order = new Map(groups.map((g, i) => [g.id, i]));
    const info: Laid['info'] = new Map();
    const evs: TLEvent[] = [], snaps: number[] = [];
    for (const e of world.all('event')) {
      if (!listedHere(e) || !cmd.eventShown(world, e.id, filter)) continue;
      // An event lies on the track of the first of its groups.
      const gs = cmd.groupsOfEvent(world, e.id).filter((g) => order.has(g)).sort((x, y) => order.get(x)! - order.get(y)!);
      const track = gs[0] ?? cmd.UNGROUPED;
      const t = info.get(track);
      if (t) t.total++; else { const g = groups.find((x) => x.id === track); info.set(track, { name: g?.name ?? 'Events', color: g?.color ?? '#4f7ca8', total: 1 }); }
      const moved = preview?.id === e.id ? preview : null;
      const ys = moved ? moved.ys : toApproxYear(fromStore(e.start_day, e.start_ms));
      const ye = moved ? moved.ye ?? ys : e.end_day !== null ? toApproxYear(fromStore(e.end_day, e.end_ms ?? 0)) : ys;
      if (!moved) { snaps.push(ys); if (ye !== ys) snaps.push(ye); }
      const x0 = xOf(ys), x1 = Math.max(xOf(ye), x0 + 8);
      if (x1 < -300 || x0 > w + 300) continue;
      evs.push({ id: e.id, x0, x1, labelW: nameWidth(e.variant_group && !e.variant_active ? `${e.name} (inactive alternative)` : e.name), track, span: [x0, xOf(ye)] });
    }
    for (const t of s.engine!.changeInstants()) snaps.push(toApproxYear(t));
    snaps.sort((x, y) => x - y);
    // The groups in their order, then the events in no group ("Other events" beside groups, "Events" alone).
    const ids = [...groups.map((g) => g.id).filter((id) => info.has(id)), ...(info.has(cmd.UNGROUPED) ? [cmd.UNGROUPED] : [])];
    if (info.has(cmd.UNGROUPED) && ids.length > 1) info.get(cmd.UNGROUPED)!.name = 'Other events';
    const laid = layoutTracks(evs, ids.map((id) => ({ id, folded: s.collapsed.includes(`tl:${id}`) })));
    return { ...laid, info, snaps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layKey]);
  const maxScroll = Math.max(0, lay.height - tracksH);
  const scrolled = Math.min(scroll, maxScroll);

  // (Where the bars lie, for whoever asks from outside: the tests, and lists that scroll the timeline to an event.)
  store.timelineLaid = { tracks: lay.tracks, top: RULER - scrolled };

  /** Everything but the playhead, kept as a picture until something it shows changes (dragging through time redraws the playhead only). */
  const still = useRef<{ key: string; canvas: OffscreenCanvas } | null>(null);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !s.world) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const key = [layKey, world.tableRevision('event_type'), world.tableRevision('map_space'), h, scrolled, otherOpen, find, s.selection?.kind === 'event' || s.selection?.kind === 'change' ? s.selection.id : '', world.tableRevision('effect'), s.recordEventId ?? ''].join('|');
    if (!still.current || still.current.key !== key) {
      const canvas = still.current && still.current.canvas.width === W && still.current.canvas.height === H ? still.current.canvas : new OffscreenCanvas(W, H);
      const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#10161d';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#18212b';
      ctx.fillRect(0, 0, w, RULER);
      const u = chooseUnit((end - start) / w);
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      for (const tk of ticks(start, end, u, calendarNow())) {
        const x = xOf(tk.t);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(x + 0.5, RULER); ctx.lineTo(x + 0.5, h); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.moveTo(x + 0.5, RULER - 7); ctx.lineTo(x + 0.5, RULER); ctx.stroke();
        ctx.fillStyle = '#aab6c3';
        ctx.fillText(tk.label, x + 4, 10);
      }
      // The events, track by track, in the room between the ruler and the strip below.
      ctx.save();
      ctx.beginPath(); ctx.rect(0, RULER, w, tracksH); ctx.clip();
      ctx.translate(0, RULER - scrolled);
      const groupColor = new Map(world.all('event_group').map((g) => [g.id, g.color]));
      // (Planned events, D243: nothing drawn into them yet, drawn as a dashed outline.)
      const drawn = eventFacts(world);
      lay.tracks.forEach((t, i) => {
        if (t.y + t.height < scrolled || t.y > scrolled + tracksH) return;
        const color = lay.info.get(t.id)?.color ?? '#4f7ca8';
        if (i % 2) { ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(0, t.y, w, t.height); }
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(0, t.y + t.height - 1, w, 1);
        if (t.folded) {
          // Folded: only where its events lie.
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.85;
          for (const x of t.marks) if (x > -4 && x < w + 4) ctx.fillRect(x, t.y + 3, 3, t.height - 6);
          ctx.globalAlpha = 1;
          return;
        }
        for (const b of t.bars) {
          if (b.hit1 < -4 || b.x0 > w + 4) continue;
          const y = t.y + 3 + b.lane * LANE;
          if (b.ids.length > 1) {
            // Events run together: a block that says how many.
            const hits = find ? b.ids.filter((id) => nameMatches(world.get('event', id)?.name ?? '', find)).length : b.ids.length;
            ctx.globalAlpha = find && !hits ? 0.25 : 1;
            ctx.fillStyle = '#31475c';
            ctx.beginPath(); ctx.roundRect(b.x0, y, b.x1 - b.x0, BAR, 3); ctx.fill();
            ctx.fillStyle = color;
            ctx.fillRect(b.x0, y, b.x1 - b.x0, 3);
            const label = find && hits ? `${hits} of ${b.ids.length} events` : `${b.ids.length} events`;
            ctx.fillStyle = '#e8eef4';
            if (b.x1 - b.x0 > nameWidth(label) + 8) ctx.fillText(label, Math.max(b.x0, 0) + 4, y + BAR / 2 + 1);
            else if (b.x1 - b.x0 > nameWidth(String(b.ids.length)) + 6) ctx.fillText(String(b.ids.length), b.x0 + 3, y + BAR / 2 + 1);
            ctx.globalAlpha = 1;
            continue;
          }
          const e = world.get('event', b.ids[0]);
          if (!e) continue;
          const inactive = !!e.variant_group && !e.variant_active;
          const selected = s.selection?.kind === 'event' && s.selection.id === e.id;
          ctx.globalAlpha = (inactive ? 0.4 : 1) * (find && !nameMatches(e.name, find) ? 0.25 : 1);
          const colour = s.recordEventId === e.id ? '#d1495b' : selected ? '#ffd166' : typeColor(world, e.type_id) ?? '#4f7ca8';
          const planned = !drawn.has(e.id);
          if (planned) {
            ctx.fillStyle = 'rgba(8,12,18,0.7)';
            ctx.beginPath(); ctx.roundRect(b.x0, y, b.x1 - b.x0, BAR, 3); ctx.fill();
            ctx.save(); ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = colour;
            ctx.beginPath(); ctx.roundRect(b.x0 + 0.75, y + 0.75, Math.max(1, b.x1 - b.x0 - 1.5), BAR - 1.5, 3); ctx.stroke(); ctx.restore();
          } else {
            ctx.fillStyle = colour;
            ctx.beginPath(); ctx.roundRect(b.x0, y, b.x1 - b.x0, BAR, 3); ctx.fill();
          }
          // The colours of its other groups, as stripes along the bar's top edge.
          const gs = cmd.groupsOfEvent(world, e.id).filter((g) => g !== t.id);
          gs.forEach((g, k) => { ctx.fillStyle = groupColor.get(g) ?? '#888'; const gw = (b.x1 - b.x0) / gs.length; ctx.fillRect(b.x0 + k * gw, y, gw, 3); });
          if (b.label) {
            // (Inside at its start where there is room before the first event within it; else after it.)
            const label = inactive ? `${e.name} (inactive alternative)` : e.name, tw = nameWidth(label);
            const inside = (b.kids?.[0]?.x0 ?? b.x1) - b.x0 > tw + 8;
            ctx.fillStyle = planned ? (selected ? '#ffd166' : '#e8eef4') : selected && inside ? '#1d1603' : '#e8eef4';
            ctx.fillText(label, inside ? Math.max(b.x0, 0) + 4 : b.x1 + 4, y + BAR / 2 + 1);
          }
          // The events inside it (D211): narrower bars within it, in their own colours, named where they fit.
          for (const k of b.kids ?? []) {
            const ke = world.get('event', k.ids[0]);
            if (!ke || k.x1 < -2 || k.x0 > w + 2) continue;
            const kSel = s.selection?.kind === 'event' && s.selection.id === ke.id;
            ctx.globalAlpha = (ke.variant_group && !ke.variant_active ? 0.4 : 1) * (find && !nameMatches(ke.name, find) ? 0.25 : 1);
            ctx.fillStyle = 'rgba(8,12,18,0.55)';
            ctx.fillRect(k.x0, y + 3, k.x1 - k.x0, BAR - 5);
            const kColour = s.recordEventId === ke.id ? '#d1495b' : kSel ? '#ffd166' : typeColor(world, ke.type_id) ?? '#7aa0c8';
            const kPlanned = !drawn.has(ke.id);
            if (kPlanned) {
              ctx.save(); ctx.setLineDash([3, 2]); ctx.lineWidth = 1; ctx.strokeStyle = kColour;
              ctx.strokeRect(k.x0 + 1.5, y + 4.5, Math.max(1, k.x1 - k.x0 - 3), BAR - 8); ctx.restore();
            } else {
              ctx.fillStyle = kColour;
              ctx.fillRect(k.x0 + 1, y + 4, Math.max(1, k.x1 - k.x0 - 2), BAR - 7);
              if (!kSel) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(k.x0 + 1, y + 4, Math.max(1, k.x1 - k.x0 - 2), BAR - 7); }
            }
            if (k.label) { ctx.fillStyle = kSel && !kPlanned ? '#1d1603' : '#ffffff'; ctx.fillText(ke.name, k.x0 + 3, y + BAR / 2 + 1); }
          }
          ctx.globalAlpha = 1;
        }
      });
      ctx.restore();
      // Under the events: the dates of changes and where branches split off (a line of ticks while folded).
      const oy = h - otherH;
      ctx.fillStyle = '#18212b';
      ctx.fillRect(0, oy, w, otherH);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(0, oy, w, 1);
      ctx.fillStyle = 'rgba(255,209,102,0.8)';
      for (const t of s.engine!.changeInstants()) {
        const x = xOf(toApproxYear(t));
        if (x >= 0 && x <= w) ctx.fillRect(x - 0.5, oy + 3, 1.5, otherOpen ? 16 : otherH - 5);
      }
      // (The change chosen, brighter and wider: D210.)
      const chosenAt = s.selection?.kind === 'change' ? (() => { const f = world.get('effect', (s.selection as { id: string }).id); return f ? changeTime(world, f) : null; })() : null;
      if (chosenAt) {
        const x = xOf(toApproxYear(chosenAt));
        ctx.fillStyle = '#ffffff';
        if (x >= -2 && x <= w + 2) ctx.fillRect(x - 1.5, oy + 2, 3, otherOpen ? 18 : otherH - 3);
      }
      // Where the branch viewed (and the branches it comes from) split off (D150): a line in its colour, its name below (on the ruler while the strip is folded).
      for (const id of branchLine(world, s.branch)) {
        const b = world.get('branch', id);
        if (!b) continue;
        const x = xOf(toApproxYear(branchStart(b)));
        if (x < -2 || x > w + 2) continue;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        const label = `⑂ ${b.name}`, lw = nameWidth(label), ly = otherOpen ? oy + 24 : 2;
        ctx.fillStyle = '#18212b';
        ctx.fillRect(x + 2, ly, lw + 6, 16);
        ctx.fillStyle = b.color;
        ctx.fillText(label, x + 5, ly + 8);
      }
      still.current = { key, canvas };
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(still.current.canvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A track an event is dragged onto: lit.
    const drop = dropTrack ? lay.tracks.find((t) => t.id === dropTrack) : null;
    if (drop) {
      const top = RULER - scrolled + drop.y;
      ctx.fillStyle = 'rgba(79,155,217,0.18)';
      ctx.fillRect(0, Math.max(RULER, top), w, Math.min(drop.height, h - otherH - top));
      ctx.strokeStyle = 'rgba(79,155,217,0.8)';
      ctx.strokeRect(0.5, Math.max(RULER, top) + 0.5, w - 1, Math.min(drop.height, h - otherH - top) - 1);
    }
    // The other date being compared (Stage 3): a dashed yellow line.
    if (s.compare.on && s.mode === 'world' && !s.compare.same) {
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

  /** A date for a place along the timeline, as fine as the zoom shows. */
  function timeAtYear(y: number): Instant {
    const t = fromApproxYear(y);
    const msPerPx = ((end - start) / w) * 365.2425 * MS_PER_DAY;
    if (msPerPx > MS_PER_DAY) return instant(Math.round(t.day + t.ms / MS_PER_DAY));
    if (msPerPx > 60_000) return instant(t.day, Math.round(t.ms / 60_000) * 60_000);
    if (msPerPx > 1000) return instant(t.day, Math.round(t.ms / 1000) * 1000);
    return t;
  }
  /** A year drawn to the nearest event's start or end or date of a change within a few pixels (Alt: as it is). */
  const snapped = (y: number, e: { altKey: boolean }) => (store.timelineSnap && !e.altKey ? snap(y, lay.snaps, (7 / w) * (end - start)) : y);
  const timeAtX = (x: number, e: { altKey: boolean }) => timeAtYear(snapped(yearAt(Math.max(0, Math.min(w, x))), e));

  const localX = (e: { clientX: number }) => e.clientX - ref.current!.getBoundingClientRect().left;
  const localY = (e: { clientY: number }) => e.clientY - ref.current!.getBoundingClientRect().top;

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = localX(e), y = localY(e);
    if (e.button === 1 || e.button === 2 || e.shiftKey) { drag.current = { kind: 'pan', x, y, start, end, scroll: scrolled }; return; }
    const hit = y >= RULER && y < h - otherH ? barAt(lay.tracks, x, y - RULER + scrolled) : null;
    if (hit && hit.bar.ids.length > 1) {
      // A block of events run together: closer in, to see them apart.
      const a = yearAt(hit.bar.x0), b = yearAt(hit.bar.x1), pad = Math.max((b - a) * 0.15, (end - start) * 0.01);
      store.set({ timeline: { start: a - pad, end: b + pad } });
      return;
    }
    if (hit) {
      const ev = store.world!.get('event', hit.bar.ids[0])!;
      const ys = toApproxYear(fromStore(ev.start_day, ev.start_ms)), ye = ev.end_day !== null ? toApproxYear(fromStore(ev.end_day, ev.end_ms ?? 0)) : null;
      // (Its ends are dragged to make it longer or shorter; the rest of it, to move it.)
      // (A bar too narrow to hold by its middle is only ever moved.)
      const ends = ye !== null && hit.bar.x1 - hit.bar.x0 >= 18;
      const mode = ends && Math.abs(x - hit.bar.x1) <= 5 && x <= hit.bar.x1 + 1 ? 'end' : ends && Math.abs(x - hit.bar.x0) <= 5 ? 'start' : 'move';
      drag.current = { kind: 'bar', id: ev.id, mode, x, y, ys, ye, moved: false, track: hit.track.id, across: false };
      return;
    }
    if (y >= h - otherH && pickChange(x)) return;
    drag.current = { kind: 'scrub' };
    store.setTime(timeAtX(x, e));
  }

  /** A change's tick in the strip under the events, clicked (D210): to its date, and the change chosen, in Properties. */
  function pickChange(x: number): boolean {
    let best: Instant | null = null, bd = 6;
    for (const t of store.engine!.changeInstants()) { const d = Math.abs(xOf(toApproxYear(t)) - x); if (d < bd) { bd = d; best = t; } }
    if (!best) return false;
    const sel = store.selection, world = store.world!;
    const prefer = sel?.kind === 'event' ? sel.id : sel?.kind === 'change' ? world.get('effect', sel.id)?.event_id ?? null : null;
    const here = changesAt(world, best, prefer);
    store.setTime(best);
    if (here.length) store.set({ selection: { kind: 'change', id: here[0].id } });
    return true;
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    const x = localX(e);
    if (d.kind === 'scrub') store.setTime(timeAtX(x, e), true);
    else if (d.kind === 'pan') {
      const dy = ((x - d.x) / w) * (d.end - d.start);
      setScroll(Math.max(0, Math.min(maxScroll, d.scroll - (localY(e) - d.y))));
      store.set({ timeline: { start: d.start - dy, end: d.end - dy } });
    } else {
      const yy = localY(e);
      // (Dragged up or down onto another group's track, D209: it goes to that group.)
      const over = d.mode === 'move' && yy >= RULER && yy < h - otherH ? lay.tracks.find((t) => yy - RULER + scrolled >= t.y && yy - RULER + scrolled < t.y + t.height) : undefined;
      const target = over && over.id !== d.track ? over.id : null;
      if (target !== dropTrack) setDropTrack(target);
      if (!d.moved && Math.abs(x - d.x) < 4 && Math.abs(yy - d.y) < 6) return;
      d.across = Math.abs(x - d.x) >= 4;
      d.moved = true;
      const by = ((x - d.x) / w) * (end - start);
      let ys = d.ys, ye = d.ye;
      if (d.mode === 'end') ye = Math.max(d.ys, snapped(d.ye! + by, e));
      else if (d.mode === 'start') ys = Math.min(d.ye!, snapped(d.ys + by, e));
      else { ys = snapped(d.ys + by, e); if (ye !== null) ye += ys - d.ys; }
      setPreview({ id: d.id, ys, ye });
    }
  }

  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== 'bar') return;
    const ev = store.world!.get('event', d.id);
    if (!ev) { setPreview(null); return; }
    const to = dropTrack;
    setDropTrack(null);
    if (to && d.moved) {
      // Onto another group's track: into that group (and out of the one it was in), and to where it was dragged if it went sideways too.
      store.execute((wd) => cmd.moveEventToGroup(wd, d.id, d.track === cmd.UNGROUPED ? null : d.track, to === cmd.UNGROUPED ? null : to));
      if (!d.across || !preview) { setPreview(null); store.set({ selection: { kind: 'event', id: d.id } }); return; }
    }
    if (!d.moved || !preview || !d.across) {
      // A click: the event chosen, at its start.
      setPreview(null);
      store.set({ selection: { kind: 'event', id: d.id }, time: fromStore(ev.start_day, ev.start_ms) });
      return;
    }
    const patch = d.mode === 'end' ? { end: timeAtYear(preview.ye!) } : d.mode === 'start' ? { start: timeAtYear(preview.ys) } : { start: timeAtYear(preview.ys), ...(preview.ye !== null ? { end: timeAtYear(preview.ye) } : {}) };
    store.execute((wd) => cmd.updateEvent(wd, d.id, patch));
    store.set({ selection: { kind: 'event', id: d.id } });
    setPreview(null);
  }

  useEffect(() => {
    const el = ref.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const x = localX(e);
      const { start: a, end: b } = store.timeline;
      // Ctrl or Alt: up and down through the tracks.
      if (e.ctrlKey || e.altKey) { setScroll((v) => Math.max(0, Math.min(maxScroll, v + e.deltaY))); return; }
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dy = ((e.deltaX || e.deltaY) / w) * (b - a);
        store.set({ timeline: { start: a + dy, end: b + dy } });
        return;
      }
      zoomBy(Math.exp(e.deltaY / 300), x);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  /** A group's track dropped at a height among the tracks (D209): its group goes there in the order. */
  function moveTrack(id: string, at: number) {
    const groups = lay.tracks.filter((t) => t.id !== cmd.UNGROUPED).map((t) => t.id);
    const others = groups.filter((g) => g !== id);
    const tracks = lay.tracks.filter((t) => t.id !== id && t.id !== cmd.UNGROUPED);
    let i = tracks.findIndex((t) => at < t.y + t.height / 2);
    if (i < 0) i = tracks.length;
    others.splice(i, 0, id);
    if (others.join() !== groups.join()) store.execute((wd) => cmd.orderEventGroups(wd, others));
  }
  /** What a track's head offers on a right-click. */
  function trackMenu(id: string): MenuItem[] {
    const groups = lay.tracks.filter((t) => t.id !== cmd.UNGROUPED).map((t) => t.id), i = groups.indexOf(id);
    const move = (to: number) => { const g = groups.filter((x) => x !== id); g.splice(to, 0, id); store.execute((wd) => cmd.orderEventGroups(wd, g)); };
    const items: MenuItem[] = [{ label: store.collapsed.includes(`tl:${id}`) ? 'Open the track' : 'Fold the track', run: () => store.toggleCollapsed(`tl:${id}`) }];
    if (id !== cmd.UNGROUPED) {
      items.push({ label: 'Move up', disabled: i <= 0, testId: 'track-move-up', run: () => move(i - 1) }, { label: 'Move down', disabled: i >= groups.length - 1, testId: 'track-move-down', run: () => move(i + 1) });
    }
    items.push('divider',
      { label: 'Show only this group', run: () => store.set({ eventFilter: [id] }) },
      { label: 'Show every group', disabled: !store.eventFilter, run: () => store.set({ eventFilter: null }) },
      { label: 'Fold the other tracks', run: () => store.set({ collapsed: [...store.collapsed.filter((k) => !k.startsWith('tl:') || k === 'tl:other'), ...lay.tracks.filter((t) => t.id !== id).map((t) => `tl:${t.id}`)] }) });
    return items;
  }
  /** Closer in or further out about a place along the timeline (its middle, from the buttons). */
  function zoomBy(f: number, x = w / 2) {
    const { start: a, end: b } = store.timeline;
    const pivot = a + (x / w) * (b - a);
    const span = Math.max(1e-12, Math.min(5e13, (b - a) * f));
    const na = pivot - ((pivot - a) / (b - a)) * span;
    store.set({ timeline: { start: na, end: na + span } });
  }

  return (
    <div className="timeline">
      <div className="tl-head" data-testid="timeline-head">
        <HistoryPlayControls />
        {head}
        <div className="spacer" />
        <input type="search" className="tl-find" placeholder="Find an event" value={s.timelineFind} onChange={(e) => store.set({ timelineFind: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') store.set({ timelineFind: '' }); }}
          title="Events whose names hold what is typed stand out; the others are dimmed" aria-label="Find an event on the timeline" data-testid="timeline-find" />
        <button className={`small ${s.timelineSnap ? 'on' : ''}`} onClick={() => store.set({ timelineSnap: !s.timelineSnap })} aria-pressed={s.timelineSnap} data-testid="timeline-snap"
          title="Snapping: the playhead and the events dragged are drawn to the starts and ends of events and the dates of changes nearby (hold Alt to go without)">Snap</button>
        <GroupFilter />
        <button className="small" onClick={() => zoomBy(1.6)} title="Further out" aria-label="Zoom the timeline out" data-testid="timeline-zoom-out">−</button>
        <button className="small" onClick={() => zoomBy(1 / 1.6)} title="Closer in" aria-label="Zoom the timeline in" data-testid="timeline-zoom-in">+</button>
        <button className="small" onClick={() => { store.fitTimeline(); store.notify(); }} title="The whole history (double-click the ruler)" data-testid="timeline-fit">Fit</button>
      </div>
      <div className="tl-body">
        <div className="tl-heads" style={{ width: HEADS }} onWheel={(e) => setScroll((v) => Math.max(0, Math.min(maxScroll, v + e.deltaY)))} data-testid="timeline-tracks">
          <div className="tl-heads-ruler" style={{ height: RULER }}>{lay.tracks.length > 1 ? `${lay.tracks.length} tracks` : ''}</div>
          <div className="tl-heads-tracks" style={{ height: tracksH }}>
            {lay.tracks.map((t) => {
              const info = lay.info.get(t.id)!;
              return (
                <button key={t.id} className={`tl-track-head ${t.folded ? 'folded' : ''} ${headDrag?.id === t.id && headDrag.moved ? 'dragging' : ''}`} style={{ top: t.y - scrolled + (headDrag?.id === t.id ? headDrag.dy : 0), height: t.height }} aria-expanded={!t.folded}
                  onPointerDown={(e) => { if (e.button !== 0 || t.id === cmd.UNGROUPED) return; e.currentTarget.setPointerCapture(e.pointerId); setHeadDrag({ id: t.id, y0: e.clientY, dy: 0, moved: false }); }}
                  onPointerMove={(e) => { if (headDrag?.id === t.id) { const dy = e.clientY - headDrag.y0; setHeadDrag({ ...headDrag, dy, moved: headDrag.moved || Math.abs(dy) > 4 }); } }}
                  onPointerUp={() => { const hd = headDrag; setHeadDrag(null); if (hd?.id === t.id && hd.moved) { justDragged.current = true; moveTrack(t.id, t.y + t.height / 2 + hd.dy); } }}
                  onClick={() => { if (justDragged.current) { justDragged.current = false; return; } store.toggleCollapsed(`tl:${t.id}`); }}
                  onContextMenu={(e) => openMenu(e, trackMenu(t.id), lay.info.get(t.id)?.name)}
                  title={`${info.name}: ${info.total} ${info.total === 1 ? 'event' : 'events'}. Click to ${t.folded ? 'open' : 'fold'} the track.`} data-testid={`track-${info.name}`}>
                  <span className="twisty" aria-hidden="true">{t.folded ? '▸' : '▾'}</span><span className="swatch" style={{ background: info.color }} /><span className="tl-track-name">{info.name}</span><span className="muted">{info.total}</span>
                </button>
              );
            })}
          </div>
          <button className="tl-other-head" style={{ height: otherH }} aria-expanded={otherOpen} onClick={() => store.toggleCollapsed('tl:other')} title="The dates of changes and where branches split off" data-testid="track-other">
            <span className="twisty" aria-hidden="true">{otherOpen ? '▾' : '▸'}</span>{otherOpen ? <span className="tl-other-names"><span>Changes</span><span>Branches</span></span> : <span>Changes, branches</span>}
          </button>
        </div>
        <div className="tl-canvas" ref={wrap}>
          <canvas
            ref={ref}
            style={{ width: w, height: h }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => { drag.current = null; setPreview(null); }}
            onDoubleClick={(e) => {
              // Empty time on the tracks: a new event there (D243); the ruler, a bar or the strip below: the whole history.
              const x = localX(e), y = localY(e);
              const onTracks = y >= RULER && y < h - otherH;
              if (onTracks && !barAt(lay.tracks, x, y - RULER + scrolled)) { store.setTime(timeAtYear(yearAt(x))); store.set({ dialog: 'new-event' }); return; }
              store.fitTimeline(); store.notify();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const x = localX(e), y = localY(e);
              const hit = y >= RULER && y < h - otherH ? barAt(lay.tracks, x, y - RULER + scrolled) : null;
              const t = timeAtYear(yearAt(x));
              const here: MenuItem[] = [
                { label: `New event on ${calendarNow().format(t, 'day')}…`, testId: 'timeline-new-event', run: () => { store.setTime(t); store.set({ dialog: 'new-event' }); } },
                { label: 'Go to this date', run: () => store.setTime(t) },
              ];
              if (hit && hit.bar.ids.length === 1) openMenu(e, [...eventMenu(store.world!, hit.bar.ids), 'divider', ...here], store.world!.get('event', hit.bar.ids[0])?.name);
              else if (hit) openMenu(e, [{ label: `Closer in on these ${hit.bar.ids.length} events`, run: () => { const a = yearAt(hit.bar.x0), b = yearAt(hit.bar.x1), pad = Math.max((b - a) * 0.15, (end - start) * 0.01); store.set({ timeline: { start: a - pad, end: b + pad } }); } }, 'divider', ...here]);
              else openMenu(e, here);
            }}
            data-testid="timeline"
          />
        </div>
      </div>
    </div>
  );
}

/** Speeds history can be played at, in years a second, with how they are written. */
export const HISTORY_SPEEDS: Array<{ yps: number; label: string }> = [
  // (Down to real time: a second of history a second.)
  { yps: 1 / 31556952, label: 'Real time (1 second/s)' }, { yps: 60 / 31556952, label: '1 minute/s' }, { yps: 3600 / 31556952, label: '1 hour/s' },
  { yps: 6 * 3600 / 31556952, label: '6 hours/s' }, { yps: 1 / 365.2425, label: '1 day/s' }, { yps: 7 / 365.2425, label: '1 week/s' },
  { yps: 1 / 12, label: '1 month/s' }, { yps: 0.25, label: '3 months/s' }, { yps: 1, label: '1 year/s' },
  { yps: 2, label: '2 years/s' }, { yps: 5, label: '5 years/s' }, { yps: 10, label: '10 years/s' },
  { yps: 25, label: '25 years/s' }, { yps: 50, label: '50 years/s' }, { yps: 100, label: '100 years/s' },
  { yps: 250, label: '250 years/s' }, { yps: 1000, label: '1,000 years/s' },
  // (Deep time, D134.)
  { yps: 10_000, label: '10,000 years/s' }, { yps: 100_000, label: '100,000 years/s' }, { yps: 1e6, label: '1 million years/s' }, { yps: 5e6, label: '5 million years/s' }, { yps: 2e7, label: '20 million years/s' },
];

/**
 * Plays history in the world-building view while it is on (improvement A, D119): the date viewed moves on at the speed
 * chosen, frame by frame, as fast as the map draws; dragging the playhead meanwhile carries on from there. At the end
 * of the timeline it stops (or, going round, starts again from its beginning). Whole days only, unless played
 * slower than a month a second.
 */
export function useHistoryPlayer(): void {
  const s = useLive();
  useEffect(() => {
    if (!s.historyPlay.on) return;
    // (Leaving world-building stops it: the Presentation button turns it off; this is for any other way.)
    if (s.mode !== 'world') { store.set({ historyPlay: { ...store.historyPlay, on: false } }); return; }
    let y = toApproxYear(store.time), prev = performance.now(), mine: Instant | null = null, raf = 0;
    // (From the beginning of the timeline when playing at its end.)
    if (y >= store.timeline.end - 1e-9) y = store.timeline.start;
    const tick = () => {
      const p = store.historyPlay;
      if (!p.on || store.mode !== 'world') return;
      const now = performance.now(), dt = Math.min(0.25, (now - prev) / 1000);
      prev = now;
      // The playhead moved by hand: carried on from there.
      if (mine && compare(store.time, mine) !== 0) y = toApproxYear(store.time);
      y += dt * p.yearsPerSecond;
      const { start, end } = store.timeline;
      if (y >= end) {
        if (!p.loop) { store.set({ historyPlay: { ...p, on: false } }); store.setTime(dayOf(fromApproxYear(end))); return; }
        y = start;
      }
      const t = fromApproxYear(y);
      mine = p.yearsPerSecond >= 1 / 12 ? dayOf(t) : t;
      store.setTime(mine, true);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); };
  }, [s.historyPlay.on, s.mode]);
}

/** An instant at the nearest midnight. */
const dayOf = (t: Instant): Instant => instant(Math.round(t.day + t.ms / MS_PER_DAY));

/** Playing history: on and off (Space), and how fast. */
export function HistoryPlayControls() {
  const s = useStore();
  const p = s.historyPlay;
  const toggle = () => { s.set({ historyPlay: { ...p, on: !p.on } }); if (p.on) s.setTime(s.time); };
  return (
    <>
      <button className={p.on ? 'on small' : 'small'} onClick={toggle} title={p.on ? 'Pause (Space)' : 'Play history from the date viewed (Space)'} data-testid="history-play">{p.on ? '⏸ Pause' : '⏵ Play'}</button>
      <select value={p.yearsPerSecond} onChange={(e) => s.set({ historyPlay: { ...p, yearsPerSecond: Number(e.target.value) } })} title="How fast history plays (years of history a second)" data-testid="history-speed">
        {HISTORY_SPEEDS.map((x) => <option key={x.yps} value={x.yps}>{x.label}</option>)}
      </select>
      <button className={p.loop ? 'on small' : 'small'} onClick={() => s.set({ historyPlay: { ...p, loop: !p.loop } })} title="At the end of the timeline, start again from its beginning" data-testid="history-loop">⟳</button>
    </>
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
