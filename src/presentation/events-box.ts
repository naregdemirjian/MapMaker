// The "current events" box of a shot: the events happening at the frame's date, with the date and
// time, in a box the user styles freely (or on a graphic of their own). Drawn with the text overlays.
import { graphicStyleOf, drawPanel, panelPath, writeText, accentInset, type GraphicStyle } from './graphic-style.ts';
import { type Instant, type Calendar, compare, fromStore, gregorian, type Precision } from '../core-time/index.ts';
import type { World } from '../world-model/world.ts';
import { isBaseEvent } from '../world-model/schema.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import { imageNow, drawImageFit } from '../render-engine/assets.ts';

export interface EventsBox {
  show: boolean;
  /** Where the box sits; 'custom' uses x and y (0..1 of the frame, the box's top-left corner). */
  corner: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' | 'custom';
  x: number; y: number;
  /** Width and inner spacing, in pixels of a 1920-wide frame. */
  width: number; padding: number; margin: number;
  title: string;
  showDate: boolean;
  datePrecision: Precision;
  /** At most this many events are listed (the most recent first). */
  maxEvents: number;
  /** How long an event without an end date stays listed, in screen seconds. */
  linger: number;
  /** Fade time for events appearing and leaving, in screen seconds. */
  fade: number;
  showDescription: boolean;
  /** Only events in these groups (null: every event). */
  groups: string[] | null;
  font: string;
  titleSize: number; dateSize: number; textSize: number;
  titleColor: string; dateColor: string; textColor: string; accentColor: string;
  background: string; backgroundOpacity: number;
  borderColor: string; borderWidth: number; radius: number;
  /**
   * A picture of the user's own behind the text (an asset name), and how it fills the box. 'wrap':
   * the graphic is the box: the box takes the graphic's shape (its width is `width`), with the text
   * laid on it, and no panel of its own.
   */
  image: string | null; imageFit: 'wrap' | 'stretch' | 'cover' | 'contain'; imageOpacity: number;
  /** Fixed height (design pixels); 0 grows with the content. Useful with a custom graphic. */
  height: number;
  /** Hidden while no event is listed (D176): no box with only its title and the date between events. */
  hideWhenEmpty: boolean;
  /** Its look (D184): panel and text; absent, as before. */
  style?: GraphicStyle;
  /** How an event comes into the list (D184). */
  itemEnter?: 'fade' | 'slide' | 'blur';
}

export const DEFAULT_EVENTS_BOX: EventsBox = {
  show: false, corner: 'bottom-right', x: 0.62, y: 0.7, width: 520, padding: 22, margin: 48,
  title: 'Now', showDate: true, datePrecision: 'day', maxEvents: 4, linger: 3, fade: 0.4, showDescription: false, groups: null,
  font: 'Segoe UI', titleSize: 18, dateSize: 30, textSize: 24,
  titleColor: '#ffd166', dateColor: '#f4efe6', textColor: '#e3e9ef', accentColor: '#ffd166',
  background: '#0a1018', backgroundOpacity: 0.72, borderColor: '#ffffff', borderWidth: 0, radius: 12,
  image: null, imageFit: 'cover', imageOpacity: 1, height: 0, hideWhenEmpty: false,
};

export function eventsBoxOf(stored: Partial<EventsBox> | null | undefined): EventsBox {
  return { ...DEFAULT_EVENTS_BOX, ...(stored ?? {}) };
}

export interface CurrentEvent { id: string; name: string; description: string; alpha: number }

/**
 * Events happening at instant t: started, and not yet ended (events without an end stay for
 * `linger` screen seconds). An event can hold several changes on different dates (a war gaining land
 * again and again): it shows again at each of them, as if it happened anew. `secondsSince` converts
 * history to screen time for this shot.
 */
export function currentEvents(world: World, box: EventsBox, t: Instant, secondsSince: (t: Instant) => number, inGroups: (eventId: string) => boolean, engine?: Engine): CurrentEvent[] {
  // The dates of changes recorded in an event after its start (in the shot's timeline, D150: of an event the
  // branch shares, only those before it split off).
  const later = new Map<string, Instant[]>();
  for (const ef of world.all('effect')) {
    if (ef.at_day === null || isBaseEvent(ef.event_id)) continue;
    if (engine) { const ev = world.get('event', ef.event_id); if (!ev || !engine.inTimeline(ef, ev)) continue; }
    const l = later.get(ef.event_id) ?? [];
    l.push(fromStore(ef.at_day, ef.at_ms ?? 0));
    later.set(ef.event_id, l);
  }
  const out: Array<CurrentEvent & { start: Instant }> = [];
  for (const e of world.all('event')) {
    if (isBaseEvent(e.id) || (e.variant_group && !e.variant_active) || !inGroups(e.id) || (engine && !engine.lists(e))) continue;
    const start = fromStore(e.start_day, e.start_ms);
    if (compare(start, t) > 0) continue;
    // The latest moment of the event at or before t: its start, or a change recorded in it later.
    let last = start;
    for (const m of later.get(e.id) ?? []) if (compare(m, t) <= 0 && compare(m, last) > 0) last = m;
    const end = e.end_day !== null ? fromStore(e.end_day, e.end_ms ?? 0) : null;
    let alpha: number;
    if (end && compare(t, end) <= 0) {
      // Under way: shown throughout, fading in at the start.
      const sinceStart = secondsSince(start);
      alpha = box.fade > 0 && Number.isFinite(sinceStart) ? Math.min(1, Math.max(0, sinceStart) / box.fade) : 1;
    } else if (end && compare(last, end) <= 0) {
      // Ended, with nothing after: fades out over `fade` seconds after the end.
      const after = secondsSince(end);
      if (!(after <= box.fade) || box.fade <= 0) continue;
      alpha = 1 - after / box.fade;
    } else {
      // A moment of an event without an end (or a change after the end): shown for `linger` seconds.
      const since = secondsSince(last);
      if (!(since <= box.linger)) continue;
      alpha = box.fade > 0 && Number.isFinite(since) ? Math.min(1, Math.max(0, since) / box.fade) : 1;
      if (box.fade > 0) alpha = Math.min(alpha, Math.max(0, (box.linger - since) / box.fade));
    }
    if (alpha <= 0) continue;
    out.push({ id: e.id, name: e.name, description: e.description, alpha, start: last });
  }
  out.sort((a, b) => compare(b.start, a.start) || a.name.localeCompare(b.name));
  return out.slice(0, Math.max(0, box.maxEvents)).map(({ start: _s, ...rest }) => rest);
}

function wrap(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, width: number, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
  return lines;
}

const fontOf = (family: string, weight: number, size: number) => `${weight} ${size.toFixed(1)}px ${/[\s,]/.test(family) ? `"${family}"` : family}, "Segoe UI", Arial, sans-serif`;

function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Draw the box. `unit` = frame width / 1920. Returns the box rectangle (for tests), or null. */
export function drawEventsBox(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number, unit: number, box: EventsBox, t: Instant, events: CurrentEvent[], cal: Calendar = gregorian): { x: number; y: number; w: number; h: number } | null {
  if (!box.show || (box.hideWhenEmpty && !events.length)) return null;
  const u = unit, pad = box.padding * u, w = box.width * u;
  const inner = w - 2 * pad;
  // Lay out first, to know the height.
  const rows: Array<{ kind: 'title' | 'date' | 'event' | 'desc'; text: string; size: number; alpha: number }> = [];
  if (box.title.trim()) rows.push({ kind: 'title', text: box.title.trim().toLocaleUpperCase(), size: box.titleSize * u, alpha: 1 });
  if (box.showDate) rows.push({ kind: 'date', text: cal.format(t, box.datePrecision), size: box.dateSize * u, alpha: 1 });
  ctx.save();
  for (const e of events) {
    ctx.font = fontOf(box.font, 600, box.textSize * u);
    for (const l of wrap(ctx, e.name, inner - 16 * u)) rows.push({ kind: 'event', text: l, size: box.textSize * u, alpha: e.alpha });
    if (box.showDescription && e.description.trim()) {
      ctx.font = fontOf(box.font, 400, box.textSize * 0.72 * u);
      for (const l of wrap(ctx, e.description.trim().split('\n')[0], inner - 16 * u, 2)) rows.push({ kind: 'desc', text: l, size: box.textSize * 0.72 * u, alpha: e.alpha });
    }
  }
  const lineH = (r: { size: number; kind: string }) => r.size * (r.kind === 'title' ? 1.5 : 1.3);
  const contentH = rows.reduce((h, r) => h + lineH(r), 0) * (box.style ? graphicStyleOf(box.style).text.lineHeight / 1.25 : 1);
  const img = imageNow(box.image);
  // Wrapped around the graphic: the box has the graphic's proportions (until the picture has loaded,
  // it fits the text).
  const iw = img ? img.naturalWidth || img.width : 0, ih = img ? img.naturalHeight || img.height : 0;
  const wrapped = box.imageFit === 'wrap' && !!box.image && iw > 0 && ih > 0;
  const h = wrapped ? (w * ih) / iw : box.height > 0 ? box.height * u : contentH + 2 * pad;
  const m = box.margin * u;
  const x = box.corner === 'custom' ? box.x * width : box.corner.endsWith('left') ? m : width - m - w;
  const y = box.corner === 'custom' ? box.y * height : box.corner.startsWith('top') ? m : height - m - h;
  // Background: the user's graphic, and/or a coloured panel.
  if (wrapped) {
    // The graphic is the box: drawn whole, in its own shape; no panel, corners or frame of ours.
    ctx.save();
    ctx.globalAlpha = box.imageOpacity;
    ctx.drawImage(img!, x, y, w, h);
    ctx.restore();
  } else if (box.style) {
    // In a style of its own (D184): shaped, with its gradient, glass, grain, shadow, glow and accent bar.
    const gs = graphicStyleOf(box.style);
    drawPanel(ctx, x, y, w, h, box.radius * u, box.backgroundOpacity > 0 ? withAlpha(box.background, box.backgroundOpacity) : null, gs.panel, u, box.borderWidth > 0 ? { color: box.borderColor, width: box.borderWidth * u } : undefined);
    if (img) {
      ctx.save();
      panelPath(ctx, x, y, w, h, box.radius * u, gs.panel.shape);
      ctx.clip();
      ctx.globalAlpha = box.imageOpacity;
      drawImageFit(ctx, img, x, y, w, h, box.imageFit === 'wrap' ? 'stretch' : box.imageFit);
      ctx.restore();
    }
  } else {
    const r = Math.min(box.radius * u, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    if (box.backgroundOpacity > 0) { ctx.fillStyle = withAlpha(box.background, box.backgroundOpacity); ctx.fill(); }
    if (img) {
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = box.imageOpacity;
      drawImageFit(ctx, img, x, y, w, h, box.imageFit === 'wrap' ? 'stretch' : box.imageFit);
      ctx.restore();
    }
    if (box.borderWidth > 0) { ctx.lineWidth = box.borderWidth * u; ctx.strokeStyle = box.borderColor; ctx.stroke(); }
  }
  // Text that does not fit in a graphic's own shape is cut at its edge.
  if (wrapped) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
  // Text.
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let cy = y + pad;
  let firstLineOfEvent = true;
  let prevKind = '';
  const gs = box.style ? graphicStyleOf(box.style) : null;
  const inset = gs ? accentInset(gs.panel, u) : 0;
  for (const row of rows) {
    const lh = lineH(row) * (gs ? gs.text.lineHeight / 1.25 : 1);
    const mid = cy + lh / 2;
    ctx.globalAlpha = row.alpha;
    if (gs) {
      // (Styled, D184: an event coming in slides or comes into focus as it fades in.)
      ctx.save();
      const p = row.alpha, ix = box.itemEnter === 'slide' && p < 1 ? -(1 - p) * (1 - p) * 40 * u : 0;
      if (box.itemEnter === 'blur' && p < 1) ctx.filter = `blur(${((1 - p) * 6 * u).toFixed(1)}px)`;
      const left = x + pad + inset + ix;
      if (row.kind === 'title') { ctx.font = fontOf(box.font, 700, row.size); writeText(ctx, row.text, left, mid, row.size, box.titleColor, { ...gs.text, spacing: gs.text.spacing + 12 }, u); }
      else if (row.kind === 'date') { ctx.font = fontOf(box.font, 600, row.size); writeText(ctx, row.text, left, mid, row.size, box.dateColor, gs.text, u); }
      else {
        if (row.kind === 'event' && prevKind !== 'event-cont') { ctx.fillStyle = box.accentColor; ctx.beginPath(); ctx.arc(left + 4 * u, mid, 4 * u, 0, Math.PI * 2); ctx.fill(); }
        ctx.font = fontOf(box.font, row.kind === 'event' ? 600 : 400, row.size);
        writeText(ctx, row.text, left + 16 * u, mid, row.size, box.textColor, row.kind === 'event' ? gs.text : { ...gs.text, upper: false }, u);
      }
      ctx.restore();
      prevKind = row.kind === 'event' ? 'event-cont' : row.kind;
      cy += lh;
      continue;
    }
    if (row.kind === 'title') { ctx.font = fontOf(box.font, 700, row.size); ctx.fillStyle = box.titleColor; (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(row.size * 0.12).toFixed(1)}px`; ctx.fillText(row.text, x + pad, mid); (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px'; }
    else if (row.kind === 'date') { ctx.font = fontOf(box.font, 600, row.size); ctx.fillStyle = box.dateColor; ctx.fillText(row.text, x + pad, mid); }
    else {
      firstLineOfEvent = row.kind === 'event' && prevKind !== 'event-cont';
      if (row.kind === 'event' && firstLineOfEvent) { ctx.fillStyle = box.accentColor; ctx.beginPath(); ctx.arc(x + pad + 4 * u, mid, 4 * u, 0, Math.PI * 2); ctx.fill(); }
      ctx.font = fontOf(box.font, row.kind === 'event' ? 600 : 400, row.size);
      ctx.fillStyle = box.textColor;
      ctx.fillText(row.text, x + pad + 16 * u, mid);
    }
    prevKind = row.kind === 'event' ? 'event-cont' : row.kind;
    cy += lh;
  }
  ctx.restore();
  return { x, y, w, h };
}
