// History's compact time bar (S6, D244): one line of time under the map, as agreed in the drawing of the History
// studio. Its row: the event what is drawn goes into (chosen here, or none), a new event, the date viewed with the steps
// to the changes before and after it and comparing two dates, playing history and its speed, and "Open Timeline".
// Under it a strip: the changes near the date (ticks), the event recorded into (else the one chosen) as a bar with its
// name, the date as a line. A click or a drag along it moves the date (drawn to the changes and the event's ends
// nearby, as on the timeline; Alt goes without), the date under the pointer is shown while it hovers, the wheel zooms
// about the pointer (Shift moves along), a double-click shows the whole history. Organising events is the Timeline
// studio's work; this bar is for drawing at the right moment.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, useLive, store } from '../store.ts';
import { DateBar } from '../shell/Bars.tsx';
import { HistoryPlayControls } from './Timeline.tsx';
import { eventsHere } from '../events-here.ts';
import { calendarNow } from '../calendar-now.ts';
import { snap } from '../timeline-layout.ts';
import { typeColor } from '../../domain/event-types.ts';
import { eventFacts } from '../../domain/event-table.ts';
import { toApproxYear, fromApproxYear, instant, fromStore, MS_PER_DAY, type Instant } from '../../core-time/index.ts';

/** Which event what is drawn goes into: none, or one of the timeline viewed (by date). */
function RecordChooser() {
  const s = useStore();
  const rec = s.recordEventId ? s.world?.get('event', s.recordEventId) : null;
  const cal = calendarNow();
  return (
    <label className={`tb-record ${rec ? 'on' : ''}`} title={rec ? `What you draw goes into "${rec.name}", without asking` : 'Choose an event to draw into: what you draw then goes into it without asking'}>
      <span className="tb-rec-dot" aria-hidden="true">●</span>
      {rec && <span className="tb-rec-label">Recording into:</span>}
      <select value={rec?.id ?? ''} onChange={(e) => s.recordInto(e.target.value || null)} aria-label="The event what you draw goes into" data-testid="timebar-record">
        <option value="">Not recording into an event</option>
        {eventsHere().map((e) => <option key={e.id} value={e.id}>{e.name} · {cal.format(fromStore(e.start_day, e.start_ms), 'year')}</option>)}
      </select>
    </label>
  );
}

const FONT = '600 10.5px "Segoe UI", Inter, Arial, sans-serif';
const H = 26;

/** The strip: the changes near the date, the event recorded into (or chosen), the date. */
function TimeStrip() {
  const s = useLive();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [w, setW] = useState(600);
  /** Where the pointer hovers (pixels from the left), for the date under it. */
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef(false);
  const drawn = useRef('');
  const { start, end } = s.timeline;
  const world = s.world!;
  const id = s.recordEventId ?? (s.selection?.kind === 'event' ? s.selection.id : null);
  const ev = id ? world.get('event', id) : null;
  const ys = ev ? toApproxYear(fromStore(ev.start_day, ev.start_ms)) : 0;
  const ye = ev && ev.end_day !== null ? toApproxYear(fromStore(ev.end_day, ev.end_ms ?? 0)) : ys;
  const xOf = (y: number) => ((y - start) / Math.max(1e-12, end - start)) * w;

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    // (The wheel zooms here rather than scrolling what holds the bar.)
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      const { start: a, end: b } = store.timeline;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = ((e.deltaX || e.deltaY) / Math.max(1, r.width)) * (b - a);
        store.set({ timeline: { start: a + d, end: b + d } });
        return;
      }
      const span = Math.max(1e-12, Math.min(5e13, (b - a) * (e.deltaY > 0 ? 1.25 : 0.8))), mid = a + f * (b - a);
      store.set({ timeline: { start: mid - f * span, end: mid + (1 - f) * span } });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', wheel); };
  }, []);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    // (Drawn again only when something it shows changes: not as the map is moved.)
    const key = [w, start, end, s.time.day, s.time.ms, hover, ev?.id, ev?.name, ys, ye, ev?.type_id, s.recordEventId, world.serial, world.tableRevision('event_type'), world.tableRevision('effect'), s.engine?.revision ?? 0].join('|');
    if (drawn.current === key) return;
    drawn.current = key;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, w, H);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    // The changes near the date.
    ctx.fillStyle = '#ffd166';
    for (const t of s.engine?.changeInstants() ?? []) {
      const x = xOf(toApproxYear(t));
      if (x >= -2 && x <= w + 2) ctx.fillRect(Math.round(x), 6, 2, 14);
    }
    // The event recorded into (red, as on the timeline), else the one chosen in its type's colour; dashed while
    // nothing is drawn into it yet (planned, D243). Its name on it where it fits.
    if (ev) {
      const a = xOf(ys), b = Math.max(xOf(ye), a + 6);
      if (b > -4 && a < w + 4) {
        const colour = s.recordEventId === ev.id ? '#d1495b' : typeColor(world, ev.type_id) ?? '#4f9bd9';
        const planned = !eventFacts(world).has(ev.id);
        ctx.beginPath(); ctx.roundRect(a, 5, b - a, 16, 4);
        if (planned) {
          ctx.fillStyle = 'rgba(8,12,18,0.75)'; ctx.fill();
          ctx.setLineDash([4, 3]); ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        } else { ctx.fillStyle = colour; ctx.fill(); }
        const x0 = Math.max(a, 0) + 6, room = Math.min(b, w) - x0 - 4;
        if (room > 24) {
          ctx.save();
          ctx.beginPath(); ctx.rect(x0, 5, room, 16); ctx.clip();
          ctx.fillStyle = planned ? '#e8eef4' : '#06121e';
          ctx.fillText(ev.name, x0, 13.5);
          ctx.restore();
        }
      }
    }
    // The date viewed.
    const now = xOf(toApproxYear(s.time));
    ctx.fillStyle = '#ff5d6c';
    ctx.fillRect(Math.round(now) - 1, 0, 2, H);
    // The date under the pointer.
    if (hover !== null && !drag.current) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(Math.round(hover), 0, 1, H);
      const label = calendarNow().format(timeAt(hover), unitOf() === 'day' ? 'day' : 'year');
      const tw = ctx.measureText(label).width + 10, lx = hover + 6 + tw > w ? hover - 6 - tw : hover + 6;
      ctx.fillStyle = 'rgba(16,24,32,0.92)';
      ctx.beginPath(); ctx.roundRect(lx, 4, tw, 18, 3); ctx.fill();
      ctx.fillStyle = '#e3e9ef';
      ctx.fillText(label, lx + 5, 13.5);
    }
  });

  /** How fine a date a pixel holds here: days when zoomed in, else years. */
  function unitOf(): 'day' | 'year' { return ((end - start) / Math.max(1, w)) * 365.2425 < 30 ? 'day' : 'year'; }
  /** The date at a place along the strip: whole days unless a pixel holds less than a day. */
  function timeAt(x: number, e?: { altKey: boolean }): Instant {
    let y = start + (Math.max(0, Math.min(w, x)) / Math.max(1, w)) * (end - start);
    if (e && store.timelineSnap && !e.altKey) {
      const snaps = [...(store.engine?.changeInstants() ?? []).map(toApproxYear), ...(ev ? [ys, ye] : [])].sort((p, q) => p - q);
      y = snap(y, snaps, (7 / Math.max(1, w)) * (end - start));
    }
    const t = fromApproxYear(y);
    return ((end - start) / Math.max(1, w)) * 365.2425 > 1 ? instant(Math.round(t.day + t.ms / MS_PER_DAY)) : t;
  }
  const local = (e: { clientX: number }) => e.clientX - ref.current!.getBoundingClientRect().left;

  return (
    <canvas ref={ref} className="tb-strip" style={{ height: H }} data-testid="timebar-strip" data-event={ev?.id ?? ''}
      title="The changes near the date: click or drag to move the date there; the wheel zooms, double-click for the whole history"
      onPointerDown={(e) => { if (e.button !== 0) return; drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); if (store.historyPlay.on) store.set({ historyPlay: { ...store.historyPlay, on: false } }); store.setTime(timeAt(local(e), e), true); }}
      onPointerMove={(e) => { if (drag.current) store.setTime(timeAt(local(e), e), true); else setHover(local(e)); }}
      onPointerUp={() => { drag.current = false; }}
      onPointerCancel={() => { drag.current = false; }}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={() => { store.fitTimeline(); store.notify(); }} />
  );
}

export function TimeBar() {
  const s = useStore();
  return (
    <div className="timebar" data-testid="timebar">
      <div className="tb-row">
        <RecordChooser />
        <button className="small" onClick={() => s.set({ dialog: 'new-event' })} title="A new event at the date viewed (recorded into, to draw its changes)" data-testid="timebar-new-event">+ Event</button>
        <span className="vsep" />
        <DateBar />
        <HistoryPlayControls />
        <span className="spacer" />
        <button className="small" onClick={() => s.setPage('timeline')} title="Events in order, their groups and types, the table: the Timeline studio" data-testid="open-timeline">Open Timeline ↗</button>
      </div>
      <TimeStrip />
    </div>
  );
}
