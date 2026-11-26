// Number boxes that can be dragged (D228): press anywhere in a number box and move the mouse up to raise the number,
// down to lower it, as in After Effects or Blender. Every number box of the app gets this, whichever panel made it.
// A press without moving puts the cursor in the box to type, with its text chosen; a press on the box's own arrows,
// or in a box already being typed in, is left to the browser.

/** Pixels of mouse movement for one step of the box. */
export const PX_PER_STEP = 4;
/** Movement smaller than this is a click, not a drag. */
const DEAD_PX = 3;

/** The number a drag reaches: `steps` steps of `step` from `start` (Shift: ten times as far; Alt: a tenth), kept within the box's limits. */
export function scrubValue(start: number, steps: number, opts: { step?: number; min?: number; max?: number; fast?: boolean; fine?: boolean }): number {
  const step = opts.step && opts.step > 0 ? opts.step : 1;
  const by = step * (opts.fast ? 10 : opts.fine ? 0.1 : 1);
  // (On the box's grid of steps from its least, as its own arrows go: a number between two steps goes first to the
  // next one in the direction moved.)
  const base = opts.min !== undefined && Number.isFinite(opts.min) ? opts.min : 0;
  const at = (start - base) / by;
  // (Shift and Alt move from where it is, off the grid.)
  const g = steps === 0 || opts.fast || opts.fine ? at + steps : steps > 0 ? Math.floor(at + 1e-9) + steps : Math.ceil(at - 1e-9) + steps;
  let v = steps === 0 ? start : opts.fast || opts.fine ? start + steps * by : base + g * by;
  if (opts.min !== undefined && Number.isFinite(opts.min)) v = Math.max(opts.min, v);
  if (opts.max !== undefined && Number.isFinite(opts.max)) v = Math.min(opts.max, v);
  // (Written without the float dust of adding 0.1 many times: as many decimals as the step has.)
  const decimals = Math.min(10, Math.max(decimalsOf(by), decimalsOf(start)));
  return Number(v.toFixed(decimals));
}

function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const e = s.match(/e-(\d+)$/);
  if (e) return Number(e[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

const num = (s: string | null): number | undefined => (s === null || s === '' || s === 'any' ? undefined : Number.isFinite(Number(s)) ? Number(s) : undefined);

/** Set a box's value as typing would, so the panel that owns it hears of it (React listens for 'input'). */
function setValue(input: HTMLInputElement, v: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, String(v));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Width of the box's own up and down arrows at its right edge (left to the browser). */
const SPINNER_PX = 18;

export function installNumberScrub(doc: Document = document) {
  doc.addEventListener('pointerdown', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'number' || input.disabled || input.readOnly) return;
    if (e.button !== 0 || doc.activeElement === input) return;
    const box = input.getBoundingClientRect();
    if (e.clientX > box.right - SPINNER_PX) return;
    e.preventDefault();
    const startY = e.clientY;
    const start = Number(input.value) || 0;
    const opts = { step: num(input.getAttribute('step')), min: num(input.getAttribute('min')), max: num(input.getAttribute('max')) };
    let moved = false;
    let last = start;
    try { input.setPointerCapture(e.pointerId); } catch { /* (a synthetic press) */ }
    const move = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      const dy = startY - m.clientY;
      if (!moved && Math.abs(dy) < DEAD_PX) return;
      if (!moved) { moved = true; doc.body.classList.add('number-scrubbing'); }
      const v = scrubValue(start, Math.round(dy / PX_PER_STEP), { ...opts, fast: m.shiftKey, fine: m.altKey });
      if (v !== last) { last = v; setValue(input, v); }
    };
    const up = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', up, true);
      doc.body.classList.remove('number-scrubbing');
      if (moved) input.dispatchEvent(new Event('change', { bubbles: true }));
      else { input.focus(); input.select(); }
    };
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', up, true);
  });
}
