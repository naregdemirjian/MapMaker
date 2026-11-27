// The Looks studio's stage (S7, D249), as drawn: over the map, the thing designed, drawn alone or on the map, and
// framed far, middle or near (at the date viewed, from its outline then). Alone, the other countries are muted: their
// colours, looks, fills and names left out (stage.ts), so that what is designed stands out as it will look.
import { useStore, store } from '../store.ts';
import { makeView } from '../../render-engine/camera.ts';
import { territoryPolygons } from '../../domain/data-export.ts';
import { boxOf, middleOf, keptBy, FILL, type Framing } from '../stage.ts';

/** The thing designed framed in the map (D249): its outline at the date viewed, taking `FILL[which]` of the view. */
export function frameThing(which: Framing): boolean {
  const s = store, w = s.world, engine = s.engine;
  const keep = w ? keptBy(w, s.selection) : null;
  if (!w || !engine || !keep) return false;
  const polys = [...territoryPolygons(w, engine, s.spaceId, s.layerId, s.time)].filter(([owner]) => keep.has(owner)).flatMap(([, p]) => p);
  const box = boxOf(polys);
  if (!box) { s.toast('Nothing of it is on the map at the date viewed.'); return false; }
  const [lon, lat] = middleOf(box);
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="map-canvas"]');
  const width = canvas?.clientWidth || 1200, height = canvas?.clientHeight || 800;
  // Its outline at zoom 0, then the zoom that makes it take the share wanted (each step of zoom doubles the scale).
  const v = makeView({ ...s.camera, lon, lat, zoom: 0, meridian: undefined }, width, height);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const ring of p) for (const q of ring) {
    const xy = v.projection([q[0], q[1]]);
    if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) continue;
    x0 = Math.min(x0, xy[0]); x1 = Math.max(x1, xy[0]); y0 = Math.min(y0, xy[1]); y1 = Math.max(y1, xy[1]);
  }
  const ext = Math.max((x1 - x0) / width, (y1 - y0) / height);
  const zoom = Number.isFinite(ext) && ext > 0 ? Math.max(-1, Math.min(22, Math.log2(FILL[which] / ext))) : s.camera.zoom;
  s.setCamera({ ...s.camera, lon, lat, zoom, meridian: undefined });
  return true;
}

export function StageBar() {
  const s = useStore();
  const w = s.world;
  if (!w) return null;
  const keep = keptBy(w, s.selection);
  const sel = s.selection;
  const name = sel?.kind === 'entity' ? w.get('entity', sel.id)?.name : sel?.kind === 'group' ? w.get('entity_group', sel.id)?.name : null;
  return (
    <div className="stage-bar" data-testid="stage-bar">
      <span className="stage-name">{name ?? 'Choose something to design'}</span>
      <span className="seg" role="group" aria-label="How it is shown">
        <button className={`small ${s.stageAlone ? 'on' : ''}`} disabled={!keep} onClick={() => s.set({ stageAlone: true })} aria-pressed={s.stageAlone} title="It alone: the other countries muted, their looks and names left out" data-testid="stage-alone">Alone</button>
        <button className={`small ${!s.stageAlone ? 'on' : ''}`} onClick={() => s.set({ stageAlone: false })} aria-pressed={!s.stageAlone} title="On the map, with everything else as it is" data-testid="stage-on-map">On the map</button>
      </span>
      <span className="seg" role="group" aria-label="How close">
        {(['far', 'middle', 'near'] as const).map((f) => (
          <button key={f} className="small" disabled={!keep} onClick={() => frameThing(f)} title={f === 'far' ? 'Seen from afar, small among the rest' : f === 'middle' ? 'All of it, filling the view' : 'Closer than all of it: its borders and fill up close'} data-testid={`stage-${f}`}>{f === 'far' ? 'Far' : f === 'middle' ? 'Middle' : 'Near'}</button>
        ))}
      </span>
    </div>
  );
}
