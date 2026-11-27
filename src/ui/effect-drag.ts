// Dragging an effect out of the Effects panel (D238): a label follows the pointer naming what it would be given to; a
// country under it on the map is lit, a row of the lists or the Looks panel under it marked; let go there, the effect
// is given to it (one undo step). Escape, or letting go over nothing that takes it, gives it to nothing.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { store } from './store.ts';
import { countryAtPage } from './components/MapView.tsx';
import { give, chosenTargets, targetsText, type Target } from './effects.ts';
import type { EffectItem } from '../render-engine/effects-catalogue.ts';

/** What a point of the page offers an effect let go there: the things it would go to, and the element marked. */
export function dropTargetAt(x: number, y: number): { targets: Target[]; el: Element; onMap: boolean } | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-drop]');
  if (!el) return null;
  const d = el.getAttribute('data-drop') ?? '';
  if (d === 'map') {
    // (In Presentation, the shot open; on the working map, the country under the point.)
    if (store.mode === 'present') return { targets: store.shotId ? [{ kind: 'shot', id: store.shotId }] : [], el, onMap: true };
    const id = countryAtPage(x, y);
    return { targets: id ? [{ kind: 'entity', id }] : [], el, onMap: true };
  }
  if (d === 'looks') return { targets: chosenTargets(), el, onMap: false };
  const i = d.indexOf(':'), kind = d.slice(0, i), id = d.slice(i + 1);
  if (kind === 'entity' || kind === 'group' || kind === 'layer' || kind === 'event') return { targets: [{ kind, id }], el, onMap: false };
  return null;
}

/** Starts dragging an effect from its row (a press: moved a few pixels, it is being dragged). */
export function startEffectDrag(item: EffectItem, ev: ReactPointerEvent<HTMLElement>): void {
  if (ev.button !== 0) return;
  const src = ev.currentTarget, pid = ev.pointerId, x0 = ev.clientX, y0 = ev.clientY;
  let ghost: HTMLDivElement | null = null;
  let marked: Element | null = null;
  const mark = (el: Element | null) => { if (marked === el) return; marked?.classList.remove('drop-here'); marked = el; el?.classList.add('drop-here'); };
  const move = (e: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
      ghost = document.createElement('div');
      ghost.className = 'effect-ghost';
      ghost.setAttribute('data-testid', 'effect-ghost');
      document.body.appendChild(ghost);
    }
    ghost.style.left = `${e.clientX + 14}px`;
    ghost.style.top = `${e.clientY + 12}px`;
    const t = dropTargetAt(e.clientX, e.clientY);
    const hover = t?.onMap && t.targets[0]?.kind === 'entity' ? t.targets[0].id : null;
    if (store.effectHover !== hover) store.set({ effectHover: hover });
    mark(t && !t.onMap ? t.el : null);
    ghost.textContent = t?.targets.length ? `${item.name} → ${targetsText(t.targets)}` : item.name;
    ghost.classList.toggle('none', !t?.targets.length);
  };
  const finish = (e: PointerEvent | null) => {
    src.removeEventListener('pointermove', move);
    src.removeEventListener('pointerup', up);
    src.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    try { src.releasePointerCapture(pid); } catch { /* already released */ }
    const dragged = !!ghost;
    ghost?.remove();
    mark(null);
    if (store.effectHover) store.set({ effectHover: null });
    if (!e || !dragged) return;
    const t = dropTargetAt(e.clientX, e.clientY);
    if (!t) return;
    if (!t.targets.length) { store.toast(t.onMap ? `Let “${item.name}” go over a country.` : `Choose something first: “${item.name}” goes to what is chosen.`, 'error'); return; }
    const r = give(item, t.targets);
    store.toast(r.message, r.ok ? 'info' : 'error');
  };
  const up = (e: PointerEvent) => finish(e);
  const cancel = () => finish(null);
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
  src.setPointerCapture(pid);
  src.addEventListener('pointermove', move);
  src.addEventListener('pointerup', up);
  src.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}
