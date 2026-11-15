// Renders a shot frame by frame, pass by pass, offscreen at the exact output size, and streams the
// pixels to the data service, which writes the image sequences. Frames are pure functions of
// (project state, shot, frame number): nothing depends on the screen, the window or timing.
import { Api } from '../ui/api.ts';
import type { World } from '../world-model/world.ts';
import type { Engine } from '../temporal-engine/engine.ts';
import { MapRenderer, DEFAULT_STYLE, type PassName } from '../render-engine/map-renderer.ts';
import { makeView } from '../render-engine/camera.ts';
import { type ShotSettings, timeAt, cameraAt, overlaysAt, drawOverlays } from './sequence.ts';
import { gregorian } from '../core-time/index.ts';

export interface ExportPassDef { name: string; label: string; blend: string; passes: PassName[]; overlays: boolean; background: boolean; note?: string }

export const PASS_DEFS: ExportPassDef[] = [
  { name: 'background', label: 'Background', blend: 'Normal', passes: ['background', 'graticule'], overlays: false, background: true, note: 'ocean and grid' },
  { name: 'fills', label: 'Territory fills', blend: 'Normal', passes: ['fills'], overlays: false, background: false, note: 'lower the opacity in Premiere to taste' },
  { name: 'borders', label: 'Borders', blend: 'Normal', passes: ['borders'], overlays: false, background: false },
  { name: 'labels', label: 'Labels', blend: 'Normal', passes: ['labels'], overlays: false, background: false },
  { name: 'overlays', label: 'Text overlays', blend: 'Normal', passes: [], overlays: true, background: false, note: 'dates and titles' },
  { name: 'beauty', label: 'Beauty (everything)', blend: 'Normal', passes: ['background', 'graticule', 'fills', 'borders', 'labels'], overlays: true, background: true, note: 'reference: compare your composite with this' },
];

export function visibleLayers(world: World, shot: ShotSettings): string[] {
  return world.all('layer')
    .filter((l) => l.space_id === shot.spaceId && l.kind === 'partition' && (shot.layers.length ? shot.layers.includes(l.id) : !!l.visible))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((l) => l.id);
}

/** Render one frame of one pass into a 2D context of the given size. */
export function renderFrame(ctx: CanvasRenderingContext2D, renderer: MapRenderer, world: World, engine: Engine, shot: ShotSettings, frame: number, def: ExportPassDef, width: number, height: number): void {
  const t = timeAt(shot, frame);
  const view = makeView(cameraAt(shot, frame), width, height);
  const passes = new Set<PassName>(def.passes.filter((p) => (p !== 'graticule' || shot.graticule) && (p !== 'labels' || shot.labels)));
  ctx.clearRect(0, 0, width, height);
  if (passes.size) {
    const transparent = def.name === 'beauty' ? shot.transparent : !def.background;
    renderer.render(ctx, view, world, engine, shot.spaceId, t, { passes, transparent, layerIds: visibleLayers(world, shot) });
  }
  if (def.overlays) drawOverlays(ctx, width, height, overlaysAt(shot, frame, t), width / 1920, DEFAULT_STYLE.font);
}

export interface ExportResult { dir: string; checksums: Record<string, Record<number, string>>; frames: number; seconds: number }

export async function runExport(o: {
  projectId: string; world: World; engine: Engine; shot: ShotSettings; shotName: string; passNames: string[]; scale: number;
  frameRange?: [number, number]; onProgress?: (done: number, total: number) => void; isCancelled?: () => boolean;
}): Promise<ExportResult> {
  const width = Math.max(16, Math.round(o.shot.width * o.scale));
  const height = Math.max(16, Math.round(o.shot.height * o.scale));
  const defs = PASS_DEFS.filter((d) => o.passNames.includes(d.name));
  if (!defs.length) throw new Error('Choose at least one pass to export.');
  const [f0, f1] = o.frameRange ?? [0, o.shot.frames - 1];
  const started = performance.now();
  const job = await Api.startExport(o.projectId, {
    shotName: o.scale === 1 ? o.shotName : `${o.shotName} (preview)`, width, height, fps: o.shot.fps, frameStart: f0, frameEnd: f1,
    passes: defs.map((d) => ({ name: d.name, label: d.label, blend: d.blend, note: d.note })), transparent: o.shot.transparent,
    historicalRange: [gregorian.format(timeAt(o.shot, f0), 'minute'), gregorian.format(timeAt(o.shot, f1), 'minute')],
  });
  // A fresh renderer per export: no state shared with the interface, so output never depends on it.
  const renderer = new MapRenderer();
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
  const total = (f1 - f0 + 1) * defs.length;
  let done = 0;
  for (let frame = f0; frame <= f1; frame++) {
    for (const def of defs) {
      if (o.isCancelled?.()) throw new Error('Export cancelled.');
      renderFrame(ctx, renderer, o.world, o.engine, o.shot, frame, def, width, height);
      const data = ctx.getImageData(0, 0, width, height).data;
      await Api.sendFrame(o.projectId, job.jobId, def.name, frame, width, height, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      o.onProgress?.(++done, total);
    }
  }
  const fin = await Api.finishExport(o.projectId, job.jobId);
  return { dir: fin.dir, checksums: fin.checksums, frames: f1 - f0 + 1, seconds: (performance.now() - started) / 1000 };
}
