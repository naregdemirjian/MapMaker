// Popovers over the panels (D234). A popover is placed by its own style, next to what opened it; inside a docking
// panel it would be cut off at the panel's edge (the panels clip what they hold). There it is lifted out to the
// window's own layer at the same place, moved above what opened it if it would run off the bottom of the window,
// and kept within the window.
import { useLayoutEffect, type RefObject } from 'react';

export function useOverPanels(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !el.closest('.dock-panel-host')) return;
    const r = el.getBoundingClientRect(), over = el.parentElement?.getBoundingClientRect();
    const room = 4, W = window.innerWidth, H = window.innerHeight;
    let top = r.top;
    if (top + r.height > H - room && over && over.top - room - r.height >= room) top = over.top - room - r.height;
    top = Math.max(room, Math.min(top, H - room - r.height));
    const left = Math.max(room, Math.min(r.left, W - room - r.width));
    Object.assign(el.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto', zIndex: '1500' });
  }, []);
}
