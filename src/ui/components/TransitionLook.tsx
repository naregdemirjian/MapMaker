// How changes look in a shot (D137): a look to start from, a live preview of it, and every part of it to adjust.
// The preview is a small sample drawn by the map's own renderer: a country taking its neighbour's land through
// the land, round a bay and across to an island, again and again, in the look chosen.
import { useEffect, useRef, useState } from 'react';
import { World } from '../../world-model/world.ts';
import { Engine, type TransitionSpec } from '../../temporal-engine/engine.ts';
import * as cmd from '../../domain/commands.ts';
import { MapRenderer } from '../../render-engine/map-renderer.ts';
import { makeView, lonLatToScreen } from '../../render-engine/camera.ts';
import type { ElevationGrid } from '../../terrain/grid.ts';
import { lonLatToVec } from '../../geo-kernel/vec.ts';
import { gregorian, lerp, NEG_INF, type Instant } from '../../core-time/index.ts';
import { TRANSITION_LOOKS, withTransitionLook, type ShotTransitions } from '../../presentation/sequence.ts';
import { NumberField } from './Panels.tsx';

interface Sample { world: World; engine: Engine; space: string; layer: string; start: Instant; end: Instant }
let sample: Sample | null = null;

/** The sample change, made once: West takes East's land (a C round a bay, and an island beyond it). */
function sampleOf(): Sample {
  if (sample) return sample;
  const world = new World();
  const space = cmd.seedProject(world, 'Preview').result.spaceId;
  const layer = world.all('layer')[0].id;
  const engine = new Engine(world);
  const west = cmd.createEntity(world, { type_id: 'polity', name: 'West', color: '#b5473a' }).result as string;
  const east = cmd.createEntity(world, { type_id: 'polity', name: 'East', color: '#2f6f9a' }).result as string;
  const ring = (pts: Array<[number, number]>) => pts.map(([lon, lat]) => lonLatToVec(lon, lat));
  const always = { kind: 'correct' as const, t: NEG_INF };
  const base = { spaceId: space, layerId: layer, snap: 1e-7 };
  const land = ring([[0, -9], [22, -9], [22, -2.5], [8, -2.5], [8, 2.5], [22, 2.5], [22, 9], [0, 9]]);
  const island = ring([[25.5, -2], [29.5, -2], [29.5, 2], [25.5, 2]]);
  cmd.paintTerritory(world, engine, { ...base, ring: ring([[-26, -9], [0, -9], [0, 9], [-26, 9]]), value: west, mode: always });
  cmd.paintTerritory(world, engine, { ...base, rings: [land, island], value: east, mode: always });
  const start = gregorian.fromCivil({ year: 2000 }), end = gregorian.fromCivil({ year: 2001 });
  const ev = cmd.createEvent(world, { name: 'West takes the east', start, end }).result as string;
  const transition: TransitionSpec = { style: 'border', easing: 'linear' };
  cmd.paintTerritory(world, engine, { ...base, rings: [land, island], value: west, mode: { kind: 'new', eventId: ev }, transition });
  sample = { world, engine, space, layer, start, end };
  return sample;
}

/** Where the sample's mountains are (D142): a range across the northern arm of the east. */
const RANGE = { lon: 14.5, south: 2.5, north: 9, halfWidth: 1.6, height: 2600 };
let ground: { grid: ElevationGrid; key: string; seaLevel: number } | null = null;
/** The sample's heights, made once: plains everywhere, and the range. */
function groundOf(): { grid: ElevationGrid; key: string; seaLevel: number } {
  if (ground) return ground;
  const width = 720, height = 360, data = new Int16Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const lon = -180 + (i + 0.5) * 0.5, lat = 90 - (j + 0.5) * 0.5;
    const range = lat > RANGE.south && lat <= RANGE.north + 2 ? RANGE.height * Math.exp(-(((lon - RANGE.lon) / RANGE.halfWidth) ** 2)) : 0;
    data[j * width + i] = Math.round(150 + range);
  }
  ground = { grid: { width, height, step: 1, data }, key: 'preview-ground', seaLevel: 0 };
  return ground;
}

/** The sample taken again and again in the look given (held a moment before and after). */
export function TransitionPreview({ tr }: { tr: ShotTransitions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const look = useRef(tr);
  look.current = tr;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let s: Sample;
    try { s = sampleOf(); } catch { return; }
    const W = Math.max(160, canvas.clientWidth || 280), H = Math.round(W * 0.42), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d')!;
    const renderer = new MapRenderer();
    // (The sample, about 58 degrees across, fills the frame whatever its width.)
    const view = makeView({ lon: 2, lat: 0, zoom: 2.55, rotation: 0, projection: 'equirectangular' }, W, H);
    const CYCLE = 3.8, HOLD = 0.55;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // (Nothing drawn while it cannot be seen.)
      if (document.hidden || canvas.offsetParent === null) return;
      const t = ((now - t0) / 1000) % CYCLE;
      const k = Math.max(0, Math.min(1, (t - HOLD) / (CYCLE - 2 * HOLD)));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const minds = (look.current.terrain ?? 0) > 0 && look.current.style !== 'fade' && look.current.style !== 'dissolve';
      try {
        renderer.render(ctx, view, s.world, s.engine, s.space, k >= 1 ? lerp(s.start, s.end, 0.9999) : lerp(s.start, s.end, k), {
          passes: new Set(['background', 'fills', 'borders']), transparent: false, layerIds: [s.layer], basemap: null, show: { rivers: false },
          frontGround: minds ? groundOf() : null,
          transitions: { ...look.current, mode: 'recorded', restyleRecorded: true, timing: 'event', secondsSince: () => 0 },
        });
        // (Where the sample's mountains are, when the look minds them.)
        if (minds) {
          ctx.save();
          ctx.strokeStyle = 'rgba(20, 16, 12, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          for (let k = 0; k < 4; k++) {
            const p = lonLatToScreen(view, RANGE.lon + (k % 2 ? 0.7 : -0.7), RANGE.south + 1.1 + 1.5 * k);
            if (!p) continue;
            const r = W / 70;
            ctx.moveTo(p[0] - r, p[1] + r * 0.7); ctx.lineTo(p[0], p[1] - r * 0.7); ctx.lineTo(p[0] + r, p[1] + r * 0.7);
          }
          ctx.stroke();
          ctx.restore();
        }
      } catch { /* a preview never stops the editor */ }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="transition-preview" data-testid="transition-preview" title="A sample change in this look: West takes East's land, round the bay and across to the island (the marks: mountains, when the look minds the land)" />;
}

/** A setting from 0 to 1 as a slider (0 to 100): shown at once while dragged, kept when let go. */
function Amount({ label, value, hint, onDraft, onCommit, testId }: { label: string; value: number; hint: string; onDraft: (v: number | null) => void; onCommit: (v: number) => void; testId: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? Math.round(value * 100);
  const commit = () => { if (drag !== null) { onCommit(drag / 100); setDrag(null); onDraft(null); } };
  return (
    <label title={hint}>{label}
      <span className="row-inline amount">
        <input type="range" min={0} max={100} step={1} value={shown} data-testid={testId}
          onChange={(e) => { const v = Number(e.target.value); setDrag(v); onDraft(v / 100); }}
          onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
        <span className="muted amount-value">{shown}</span>
      </span>
    </label>
  );
}

/**
 * The look of a shot's changes: chosen from the looks, previewed, adjusted. Changing any part of it makes it the
 * shot's own ("Custom"); choosing a look again sets every part of it.
 */
export function TransitionLookControls({ tr, onChange }: { tr: ShotTransitions; onChange: (t: ShotTransitions) => void }) {
  const known = TRANSITION_LOOKS.find((l) => l.id === tr.look);
  const [draft, setDraft] = useState<Partial<ShotTransitions> | null>(null);
  const own = (patch: Partial<ShotTransitions>) => onChange({ ...tr, ...patch, look: 'custom' });
  const amount = (key: 'roughness' | 'soft' | 'wake' | 'terrain') => ({
    value: tr[key] ?? 0,
    onDraft: (v: number | null) => setDraft(v === null ? null : { [key]: v }),
    onCommit: (v: number) => own({ [key]: v }),
  });
  const front = tr.front;
  return (
    <div className="transition-look">
      <label>Look
        <select value={known ? known.id : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') onChange(withTransitionLook(tr, e.target.value)); }} data-testid="transition-look">
          {TRANSITION_LOOKS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="custom" disabled={!!known}>Custom (your own)</option>
        </select>
      </label>
      <p className="muted" data-testid="transition-look-note">{known ? known.note : 'Your own look: change any part of it below, or choose a look to start again.'}</p>
      <TransitionPreview tr={draft ? { ...tr, ...draft } : tr} />
      <details className="own-look" data-testid="transition-adjust">
        <summary>Adjust the look</summary>
        <Amount label="Ragged edge" hint="0: a clean front; higher: the front advances in fingers and bays, the same way each time" testId="transition-roughness" {...amount('roughness')} />
        <Amount label="Soft edge" hint="0: a sharp edge; higher: the new colour runs softly ahead of the front" testId="transition-soft" {...amount('soft')} />
        <Amount label="Glow behind the front" hint="0: none; higher: the land just taken glows, fading behind the front" testId="transition-wake" {...amount('wake')} />
        <Amount label="Slowed by mountains and water" hint="0: the land makes no difference; higher: fronts are slower over mountains and over water to cross, and go round them where that is quicker (on maps with heights: the Earth and generated planets)" testId="transition-terrain" {...amount('terrain')} />
        <label className="check"><input type="checkbox" checked={front.show} onChange={(e) => own({ front: { ...front, show: e.target.checked } })} data-testid="transition-front-show" /> A line along the front</label>
        {(front.show || (tr.wake ?? 0) > 0) && (
          <label>{front.show ? 'Colour of the line and glow' : 'Colour of the glow'}
            <span className="row-inline">
              <select value={front.color === 'auto' ? 'auto' : 'own'} onChange={(e) => own({ front: { ...front, color: e.target.value === 'auto' ? 'auto' : '#ffe9a6' } })} data-testid="transition-front-colour">
                <option value="auto">The new owner's, lighter</option>
                <option value="own">Choose…</option>
              </select>
              {front.color !== 'auto' && <input type="color" value={front.color} onChange={(e) => own({ front: { ...front, color: e.target.value } })} data-testid="transition-front-pick" />}
            </span>
          </label>
        )}
        {front.show && <div className="two">
          <label>Line width<NumberField min={0} max={40} step={0.5} value={front.width} onCommit={(n) => own({ front: { ...front, width: n } })} testId="transition-front-width" /></label>
          <label>Glow<NumberField min={0} max={80} step={1} value={front.glow} onCommit={(n) => own({ front: { ...front, glow: n } })} testId="transition-front-glow" /></label>
        </div>}
      </details>
    </div>
  );
}
