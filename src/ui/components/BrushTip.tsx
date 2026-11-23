// The terrain brush's tip (D218): how it fades toward its edge and what shape it is, with a picture of it. A button
// in the options bar shows the tip in use; it opens a panel of tips to start from and every part of the tip.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TIP_PRESETS, ROUND_TIP, tipWeight, type BrushTip } from '../../terrain/sculpt.ts';
import { simplex3 } from '../../terrain/planet.ts';
import { RangeReset } from '../shell/Reset.tsx';

const previewNoise = simplex3(11);

/**
 * The tip drawn as the brush would paint a short stroke to the right: white where it is at full strength, fading to
 * the background. (Drawn in the plane, as the sculpting works it out on the globe.)
 */
function TipPicture({ tip, size, testId }: { tip: BrushTip; size: number; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!, img = g.createImageData(size, size), d = img.data;
    const A = 1, B = tip.roundness, turn = (tip.angle * Math.PI) / 180;
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      // From -1.5 to 1.5 brush sizes across, north up; the stroke runs along x (so "turns with the stroke" is measured from east here too).
      const x = ((px + 0.5) / size) * 3 - 1.5, y = 1.5 - ((py + 0.5) / size) * 3;
      const vm = x * Math.cos(turn) + y * Math.sin(turn), vn = -x * Math.sin(turn) + y * Math.cos(turn);
      let u = Math.sqrt((vm / A) ** 2 + (vn / B) ** 2);
      if (tip.ragged > 0) u /= 1 + tip.ragged * 0.5 * (0.75 * previewNoise(x * 1.8, y * 1.8, 0.5) + 0.25 * previewNoise(x * 4.5 + 31, y * 4.5, 0.5));
      let w = tipWeight(u, tip.hardness);
      if (tip.texture > 0 && w > 0) w *= 1 - tip.texture * (0.5 + 0.5 * previewNoise(x * 14 + 77, y * 14, 2.5));
      const k = (py * size + px) * 4, v = Math.round(36 + 214 * w);
      d[k] = v; d[k + 1] = v; d[k + 2] = Math.round(v * 0.97 + 6); d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, [tip, size]);
  return <canvas ref={ref} width={size} height={size} className="tip-picture" data-testid={testId} />;
}

const same = (a: BrushTip, b: BrushTip) => (Object.keys(a) as Array<keyof BrushTip>).every((k) => a[k] === b[k]);

export function BrushTipControl({ tip, onChange }: { tip: BrushTip; onChange: (tip: BrushTip) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  const preset = TIP_PRESETS.find((p) => same(p.tip, tip));
  const set = (patch: Partial<BrushTip>) => onChange({ ...tip, ...patch });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const slider = (label: string, value: number, min: number, max: number, step: number, def: number, show: string, onSet: (v: number) => void, testId: string, title: string) => (
    <label className="range-row" title={title}>{label}: <b>{show}</b>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onSet(Number(e.target.value))} data-testid={testId} /><RangeReset def={def} value={value} />
    </label>
  );
  return (
    <>
      <button ref={button} className={`small tip-button ${open ? 'on' : ''}`} onClick={() => { const r = button.current!.getBoundingClientRect(); setAt({ x: r.left, y: r.bottom + 4 }); setOpen(!open); }} title="The brush's tip: how it fades toward its edge and its shape" data-testid="sculpt-tip">
        <TipPicture tip={tip} size={20} /> {preset?.name ?? 'Tip of your own'}
      </button>
      {open && (
        <div ref={panel} className="tip-panel" style={{ left: at.x, top: at.y }} data-testid="sculpt-tip-panel">
          <div className="tip-presets">
            {TIP_PRESETS.map((p) => (
              <button key={p.id} className={preset?.id === p.id ? 'on' : ''} onClick={() => onChange(p.tip)} title={p.name} data-testid={`sculpt-tip-preset-${p.id}`}>
                <TipPicture tip={p.tip} size={40} /><span>{p.name}</span>
              </button>
            ))}
          </div>
          <div className="tip-edit">
            <TipPicture tip={tip} size={96} testId="sculpt-tip-picture" />
            <div className="tip-sliders">
              {slider('Fades over', 1 - tip.hardness, 0.05, 1, 0.05, 1, pct(1 - tip.hardness), (v) => set({ hardness: Math.round((1 - v) * 100) / 100 }), 'sculpt-tip-fade', 'How much of the way from its edge to its middle the brush fades over (100%: it fades from its middle; little: a hard edge)')}
              {slider('Round', tip.roundness, 0.1, 1, 0.05, 1, pct(tip.roundness), (v) => set({ roundness: v }), 'sculpt-tip-roundness', 'Its short side against its long one (100%: round; less: an oval, flatter and flatter)')}
              {tip.roundness < 1 && <>
                {slider('Turned', tip.angle, -90, 90, 5, 0, `${tip.angle}°`, (v) => set({ angle: v }), 'sculpt-tip-angle', 'How its long side is turned: from east, or from the stroke\'s own direction')}
                <label className="check"><input type="checkbox" checked={tip.follow} onChange={(e) => set({ follow: e.target.checked })} data-testid="sculpt-tip-follow" /> Turns with the stroke</label>
              </>}
              {slider('Ragged edge', tip.ragged, 0, 1, 0.05, 0, pct(tip.ragged), (v) => set({ ragged: v }), 'sculpt-tip-ragged', 'How ragged its outline is: in and out by up to half its size, in lumps')}
              {slider('Texture', tip.texture, 0, 1, 0.05, 0, pct(tip.texture), (v) => set({ texture: v }), 'sculpt-tip-texture', 'Grain inside it: specks of strength and weakness')}
              {!same(tip, ROUND_TIP) && <button className="link" onClick={() => onChange(ROUND_TIP)} data-testid="sculpt-tip-reset">Back to soft round</button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
