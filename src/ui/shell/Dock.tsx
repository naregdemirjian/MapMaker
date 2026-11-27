// The docking panels drawn (S1, D234; the layout and what is done to it: dock.ts). Each group of panels has a row of
// tabs: a tab dragged into another group joins its tabs, to an edge of one splits it there, anywhere else floats; a
// click brings it to the front; its × closes it. The edges between groups are dragged to resize them. A floating
// window is moved by its title row and resized by its corner.
//
// Each panel's contents are drawn once, into an element of their own that is moved to wherever the panel's tab is
// (React portals): moving a panel, or opening another page, does not draw the map again from nothing.
import { Fragment, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useStore, store, type MenuItem } from '../store.ts';
import { dockPanel, floatPanel, placeFloat, resizeAt, activate, topStacks, visiblePanels, MIN_W, MIN_H, VIEWER, type DockNode, type DockSplit, type DockStack, type DockFloat, type Zone, type PanelId } from './dock.ts';
import { panelInfo, type Page } from './studios.ts';
import { PanelContent, panelTitle } from './panels.tsx';
import { openMenu } from '../components/ContextMenu.tsx';

// ---- each panel's own element, moved to where its tab is
const hosts = new Map<PanelId, HTMLDivElement>();
function hostFor(id: PanelId): HTMLDivElement {
  let h = hosts.get(id);
  if (!h) {
    h = document.createElement('div');
    h.className = 'dock-panel-host';
    h.dataset.panel = id;
    hosts.set(id, h);
  }
  return h;
}

/** Where a group shows the panel in front: that panel's element is put here. */
function PanelSlot({ id }: { id: PanelId }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!, h = hostFor(id);
    el.appendChild(h);
    return () => { if (h.parentNode === el) el.removeChild(h); };
  }, [id]);
  return <div className="dock-body" ref={ref} />;
}

// ---- a tab being dragged
type Target = { id: string; zone: Zone; rect: DOMRect } | { float: true };
interface Drag { panel: PanelId; x: number; y: number; target: Target | null }
let dragNow: Drag | null = null;
const dragListeners = new Set<() => void>();
function setDrag(d: Drag | null) { dragNow = d; for (const f of dragListeners) f(); }
const useDrag = () => useSyncExternalStore((f) => { dragListeners.add(f); return () => { dragListeners.delete(f); }; }, () => dragNow);

/**
 * What lies under the pointer for a tab dropped there: a group (into its tabs, or one of its sides), or nothing (it
 * floats). Held with Ctrl, it floats wherever it is let go (as in Premiere).
 */
function targetAt(x: number, y: number, float = false): Target {
  if (float) return { float: true };
  for (const el of document.elementsFromPoint(x, y)) {
    const holder = (el as HTMLElement).closest?.('[data-dock-holder]') as HTMLElement | null;
    if (!holder) continue;
    const rect = holder.getBoundingClientRect(), id = holder.dataset.dockHolder!;
    if (holder.dataset.float || (el as HTMLElement).closest('.dock-tabs')) return { id, zone: 'center', rect };
    const sides: Array<[Zone, number]> = [['left', (x - rect.left) / rect.width], ['right', (rect.right - x) / rect.width], ['top', (y - rect.top) / rect.height], ['bottom', (rect.bottom - y) / rect.height]];
    sides.sort((a, b) => a[1] - b[1]);
    return { id, zone: sides[0][1] < 0.25 ? sides[0][0] : 'center', rect };
  }
  return { float: true };
}

function drop(d: Drag) {
  const l = store.dockNow(), t = d.target;
  if (!t) return;
  if ('float' in t) {
    const area = document.querySelector('.dock-area')!.getBoundingClientRect();
    store.setDock(floatPanel(l, d.panel, { x: Math.round(d.x - area.left - 60), y: Math.round(d.y - area.top - 12), w: 320, h: 420 }));
    return;
  }
  const across = t.zone === 'left' || t.zone === 'right';
  const size = across ? Math.max(160, Math.min(420, t.rect.width / 2)) : Math.max(100, Math.min(400, t.rect.height / 2));
  store.setDock(dockPanel(l, d.panel, t.id, t.zone, size));
}

/** A tab pressed: a click brings its panel to the front; dragged past a few pixels, it is carried to where it is let go. */
function pressTab(e: React.PointerEvent, panel: PanelId, holderId: string) {
  if (e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  // (Held by the tab while it is carried: what it passes over is not hovered.)
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  let moving = false;
  const move = (m: PointerEvent) => {
    if (!moving && Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
    if (!moving) { moving = true; document.body.classList.add('dock-dragging'); }
    setDrag({ panel, x: m.clientX, y: m.clientY, target: targetAt(m.clientX, m.clientY, m.ctrlKey || m.metaKey) });
  };
  const end = (u: PointerEvent, cancelled: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    document.body.classList.remove('dock-dragging');
    const d = dragNow;
    setDrag(null);
    if (cancelled) return;
    if (moving && d) drop({ ...d, x: u.clientX, y: u.clientY, target: targetAt(u.clientX, u.clientY, u.ctrlKey || u.metaKey) });
    else if (!moving) store.setDock(activate(store.dockNow(), holderId, panel));
  };
  const up = (u: PointerEvent) => end(u, false), cancel = (u: PointerEvent) => end(u, true);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

/** Where a dragged tab would go, shown while it is dragged. */
function DropMark() {
  const d = useDrag();
  if (!d) return null;
  const t = d.target;
  let box: { left: number; top: number; width: number; height: number } | null = null;
  if (t && !('float' in t)) {
    const r = t.rect;
    box = t.zone === 'left' ? { left: r.left, top: r.top, width: r.width / 2, height: r.height }
      : t.zone === 'right' ? { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height }
      : t.zone === 'top' ? { left: r.left, top: r.top, width: r.width, height: r.height / 2 }
      : t.zone === 'bottom' ? { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 }
      : { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return <>
    {box && <div className="dock-drop-mark" style={box} data-testid="dock-drop-mark" />}
    <div className="dock-drag-ghost" style={{ left: d.x + 12, top: d.y + 10 }}>{panelTitle(d.panel, store.pageNow())}{t && 'float' in t ? ' · floating' : ''}</div>
  </>;
}

// ---- sizes
const leastOf = (n: DockNode, along: 'w' | 'h'): number => {
  if (n.kind === 'stack') return Math.max(...n.panels.map((p) => (along === 'w' ? panelInfo(p)?.minW ?? MIN_W : panelInfo(p)?.minH ?? MIN_H)));
  const kids = n.children.map((c) => leastOf(c, along));
  return (n.dir === 'row') === (along === 'w') ? kids.reduce((a, b) => a + b + 4, -4) : Math.max(...kids);
};

/** The edge between two groups, dragged to resize them (shown as it goes, kept when let go). */
function Edge({ node, index }: { node: DockSplit; index: number }) {
  const row = node.dir === 'row';
  const press = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget, a = el.previousElementSibling as HTMLElement, b = el.nextElementSibling as HTMLElement;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const measured: [number, number] = row ? [ra.width, rb.width] : [ra.height, rb.height];
    const least: [number, number] = [Number(a.dataset.least) || 0, Number(b.dataset.least) || 0];
    const was = [a.style.flex, b.style.flex], start = row ? e.clientX : e.clientY;
    el.setPointerCapture(e.pointerId);
    let by = 0;
    const move = (m: PointerEvent) => {
      by = Math.max(Math.min(least[0], measured[0]) - measured[0], Math.min(measured[1] - Math.min(least[1], measured[1]), (row ? m.clientX : m.clientY) - start));
      a.style.flex = `0 0 ${measured[0] + by}px`;
      b.style.flex = `0 0 ${measured[1] - by}px`;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      a.style.flex = was[0]; b.style.flex = was[1];
      if (by) store.setDock(resizeAt(store.dockNow(), node.id, index, by, measured, least));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return <div className={`dock-edge ${row ? 'across' : 'down'}`} onPointerDown={press} data-testid={`dock-edge-${node.id}-${index}`} title="Drag to resize" />;
}

function NodeView({ node, page, top }: { node: DockNode; page: Page; top: Set<string> }) {
  if (node.kind === 'stack') return <StackView s={node} page={page} top={top.has(node.id)} />;
  const row = node.dir === 'row';
  return (
    <div className={`dock-split ${row ? 'dock-row' : 'dock-col'}`}>
      {node.children.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 && <Edge node={node} index={i - 1} />}
          <div className="dock-cell" data-least={leastOf(c, row ? 'w' : 'h')}
            style={{ flex: c.size > 0 ? `0 0 ${c.size}px` : '1 1 0px', [row ? 'minWidth' : 'minHeight']: leastOf(c, row ? 'w' : 'h') }}>
            <NodeView node={c} page={page} top={top} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A group's row of tabs. Tabs keep their width: more than fit, the row scrolls (the wheel scrolls it; the tab in front is
 * kept in view), and the group's menu lists them all.
 */
function Tabs({ holder, page, onEmptyPress }: { holder: DockStack | DockFloat; page: Page; onEmptyPress?: (e: React.PointerEvent<HTMLDivElement>) => void }) {
  const lone = holder.panels.length === 1 && (panelInfo(holder.panels[0])?.minW ?? MIN_W) < 80;
  const strip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = strip.current, on = el?.querySelector<HTMLElement>('.dock-tab.on');
    if (!el || !on) return;
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < el.scrollLeft) el.scrollLeft = l;
    else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth;
  }, [holder.active, holder.panels.length]);
  const menu = (e: React.MouseEvent) => {
    const p = holder.active;
    openMenu(e, [
      ...(holder.panels.length > 1 ? [
        ...holder.panels.map((q): MenuItem => ({ label: panelTitle(q, page), checked: q === p, run: () => store.setDock(activate(store.dockNow(), holder.id, q)), testId: `dock-menu-show-${q}` })),
        'divider' as const,
      ] : []),
      { label: `Float ${panelTitle(p, page)}`, run: () => { const r = (e.target as HTMLElement).closest('[data-dock-holder]')!.getBoundingClientRect(), area = document.querySelector('.dock-area')!.getBoundingClientRect(); store.setDock(floatPanel(store.dockNow(), p, { x: Math.round(r.left - area.left + 30), y: Math.round(r.top - area.top + 30), w: Math.max(260, Math.min(420, r.width)), h: Math.max(200, Math.min(520, r.height)) })); }, testId: 'dock-menu-float' },
      { label: `Close ${panelTitle(p, page)}`, run: () => store.closePanel(p), disabled: panelInfo(p)?.closable === false, testId: 'dock-menu-close' },
      { label: 'Close the group', run: () => { for (const q of holder.panels) store.closePanel(q); }, disabled: holder.panels.some((q) => panelInfo(q)?.closable === false), testId: 'dock-menu-close-group' },
    ], panelTitle(p, page));
  };
  const empty = (e: React.PointerEvent<HTMLDivElement>) => { if (e.target === e.currentTarget || e.target === strip.current) onEmptyPress?.(e); };
  return (
    <div className={`dock-tabs ${lone ? 'lone' : ''}`} onPointerDown={empty}>
      <div className="dock-tab-strip" role="tablist" ref={strip} onWheel={(e) => { if (strip.current) strip.current.scrollLeft += e.deltaY || e.deltaX; }}>
        {holder.panels.map((p) => {
          const title = panelTitle(p, page), on = p === holder.active;
          return (
            <div key={p} role="tab" tabIndex={0} aria-selected={on} className={`dock-tab ${on ? 'on' : ''}`} title={panelInfo(p)?.hint ?? title} data-testid={`dock-tab-${p}`}
              onPointerDown={(e) => pressTab(e, p, holder.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') store.setDock(activate(store.dockNow(), holder.id, p)); }}>
              <span className="dock-tab-name">{lone ? '⋮⋮' : title}</span>
              {!lone && on && panelInfo(p)?.closable !== false && <button className="dock-tab-close" aria-label={`Close ${title}`} title={`Close ${title}`} data-testid={`dock-close-${p}`}
                onPointerDown={(e) => e.stopPropagation()} onClick={() => store.closePanel(p)}>×</button>}
            </div>
          );
        })}
      </div>
      {!lone && <button className="dock-menu-button" aria-label="Panel menu" title={holder.panels.length > 1 ? 'The panels of this group; float or close one' : 'Float or close this panel'} data-testid={`dock-menu-${holder.active}`} onPointerDown={(e) => e.stopPropagation()} onClick={menu}>≡</button>}
    </div>
  );
}

function StackView({ s, page, top }: { s: DockStack; page: Page; top: boolean }) {
  return (
    <div className={`dock-stack ${top ? 'top' : ''} ${s.panels.includes(VIEWER) ? 'viewer-stack' : ''}`} data-dock-holder={s.id} data-testid={`dock-stack-${s.panels.join('-')}`}>
      <Tabs holder={s} page={page} />
      <PanelSlot id={s.active} />
    </div>
  );
}

/** A floating window: moved by its row of tabs (where there is no tab), resized by its corner. */
function FloatView({ f, page }: { f: DockFloat; page: Page }) {
  const ref = useRef<HTMLDivElement>(null);
  const press = (e: React.PointerEvent, kind: 'move' | 'size') => {
    if (e.button !== 0) return;
    // (From where it is shown, which may be kept within the area rather than where it was put.)
    const el = ref.current!, x0 = e.clientX, y0 = e.clientY, bx = el.offsetLeft, by = el.offsetTop;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    let dx = 0, dy = 0;
    const at = () => ({ x: Math.max(0, bx + dx), y: Math.max(0, by + dy) }), size = () => ({ w: Math.max(MIN_W + 40, f.w + dx), h: Math.max(MIN_H + 60, f.h + dy) });
    const move = (m: PointerEvent) => {
      dx = m.clientX - x0; dy = m.clientY - y0;
      if (kind === 'move') { el.style.left = `${at().x}px`; el.style.top = `${at().y}px`; }
      else { el.style.width = `${size().w}px`; el.style.height = `${size().h}px`; }
    };
    const t = e.target as HTMLElement;
    const up = () => {
      t.removeEventListener('pointermove', move);
      t.removeEventListener('pointerup', up);
      t.removeEventListener('pointercancel', up);
      if (dx || dy) store.setDock(placeFloat(store.dockNow(), f.id, kind === 'move' ? at() : size()));
    };
    t.addEventListener('pointermove', move);
    t.addEventListener('pointerup', up);
    t.addEventListener('pointercancel', up);
  };
  return (
    // (Kept within the area, should it have become smaller since.)
    <div className="dock-float" ref={ref} style={{ left: `clamp(0px, ${f.x}px, calc(100% - 80px))`, top: `clamp(0px, ${f.y}px, calc(100% - 30px))`, width: f.w, height: f.h }} data-dock-holder={f.id} data-float="1" data-testid={`dock-float-${f.panels.join('-')}`}>
      <Tabs holder={f} page={page} onEmptyPress={(e) => press(e, 'move')} />
      <PanelSlot id={f.active} />
      <div className="dock-float-corner" onPointerDown={(e) => press(e, 'size')} title="Drag to resize" />
    </div>
  );
}

/** The panels of the page worked in, as arranged: the groups, the floating windows, and the panels' contents. */
export function DockArea() {
  const s = useStore();
  const page = s.pageNow(), layout = s.dockNow();
  const top = topStacks(layout.root);
  return (
    <div className="dock-area" data-page={page} data-testid="dock-area">
      <div className="dock-root"><NodeView node={layout.root} page={page} top={top} /></div>
      {layout.floats.map((f) => <FloatView key={f.id} f={f} page={page} />)}
      <DropMark />
      {visiblePanels(layout).map((id) => createPortal(<PanelContent id={id} />, hostFor(id), id))}
    </div>
  );
}
