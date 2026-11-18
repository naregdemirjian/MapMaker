// A character's icon (fifth feedback round, D85): the round marker, an icon of the set (ships, aircraft,
// land forces, military signs, people and places), or a picture of one's own; plain or on a disc of
// its colour; its size; and whether it faces where it travels.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { Api } from '../api.ts';
import { ICONS, ICON_GROUPS, iconById, drawIcon, type IconDef } from '../../render-engine/icons.ts';
import { assetUrl } from '../../render-engine/assets.ts';

/** An icon of the set drawn as it shows on the map (plain, or on a disc of the colour). */
export function IconPicture({ icon, color, look = 'plain', size = 32 }: { icon: IconDef; color: string; look?: 'plain' | 'badge'; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (look === 'badge') {
      ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 1.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      drawIcon(ctx, icon, size / 2, size / 2, size * 0.64, { color: '#ffffff', detail: color });
    } else drawIcon(ctx, icon, size / 2, size / 2, size * 0.9, { color, detail: 'rgba(10,16,24,0.88)', halo: 3.5 });
  }, [icon, color, look, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} />;
}

export function CharacterIconSection({ id }: { id: string }) {
  const s = useStore();
  const e = s.world!.get('entity', id);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  // The size while its slider is dragged; saved (one change to undo) on release.
  const [sizeDrag, setSizeDrag] = useState<number | null>(null);
  if (!e) return null;
  const icon = cmd.entityStyle(e).icon ?? null;
  const def = iconById(icon?.set);
  const save = (next: cmd.CharacterIcon | null) => s.execute((wd) => cmd.setEntityStyle(wd, id, { icon: next }));
  const keep = { look: icon?.look, size: icon?.size, turn: icon?.turn };
  const choose = (setId: string) => { save({ ...keep, set: setId }); setChoosing(false); };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const a = await Api.uploadAsset(s.projectId!, file);
      save({ ...keep, asset: a.file });
      setChoosing(false);
    } catch (err) { s.toast((err as Error).message, 'error'); }
    setBusy(false);
  };
  const commitSize = () => {
    if (sizeDrag === null || !icon) return;
    const v = sizeDrag / 100;
    setSizeDrag(null);
    if (v !== (icon.size ?? 1)) save({ ...icon, size: v });
  };
  const what = def ? def.name : icon?.asset ? 'your picture' : 'a round marker';
  return (
    <div className="character-icon" data-testid="character-icon">
      <h4>Icon</h4>
      <div className="fill-now">
        {def ? <IconPicture icon={def} color={e.color} look={icon?.look ?? 'plain'} size={30} />
          : icon?.asset ? <img className="icon-own" src={assetUrl(icon.asset)} alt="" />
          : <span className="swatch round" style={{ background: e.color }} />}
        <span data-testid="character-icon-now">Shown as {what}</span>
        <button className="small" onClick={() => setChoosing(!choosing)} data-testid="icon-choose">{choosing ? 'Done' : 'Change…'}</button>
      </div>
      {choosing && (
        <div className="icon-chooser" data-testid="icon-grid">
          <button className={`icon-option ${!icon ? 'on' : ''}`} onClick={() => { save(null); setChoosing(false); }} title="A round marker in its colour" data-testid="icon-marker">
            <span className="swatch round" style={{ background: e.color }} /><span>Round marker</span>
          </button>
          {ICON_GROUPS.map((g) => (
            <div key={g} className="icon-group">
              <div className="muted icon-group-name">{g}</div>
              <div className="icon-row">
                {ICONS.filter((i) => i.group === g).map((i) => (
                  <button key={i.id} className={`icon-option ${icon?.set === i.id ? 'on' : ''}`} onClick={() => choose(i.id)} title={i.name} aria-label={i.name} data-testid={`icon-option-${i.id}`}>
                    <IconPicture icon={i} color={e.color} size={30} />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label className="file-button small" title="A picture of your own (PNG, JPEG, SVG, WebP): a portrait, a unit's emblem, a vehicle">
            {busy ? 'Adding…' : 'A picture of your own…'}
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" onChange={(ev) => upload(ev.target.files?.[0])} disabled={busy} data-testid="icon-picture-input" />
          </label>
        </div>
      )}
      {icon && <>
        <label>Look<select value={icon.look ?? 'plain'} onChange={(ev) => save({ ...icon, look: ev.target.value as 'plain' | 'badge' })} data-testid="icon-look">
          <option value="plain">The icon itself, in its colour</option>
          <option value="badge">On a disc of its colour</option>
        </select></label>
        <label className="range-row">Size: <b>{sizeDrag ?? Math.round((icon.size ?? 1) * 100)}%</b>
          <input type="range" min={50} max={300} step={10} value={sizeDrag ?? Math.round((icon.size ?? 1) * 100)} onChange={(ev) => setSizeDrag(Number(ev.target.value))}
            onPointerUp={commitSize} onKeyUp={commitSize} onBlur={commitSize} data-testid="icon-size" />
        </label>
        <label>Faces where it travels<select value={icon.turn ?? 'auto'} onChange={(ev) => save({ ...icon, turn: ev.target.value as NonNullable<cmd.CharacterIcon['turn']> })} data-testid="icon-turn">
          <option value="auto">{def ? (def.turn === 'rotate' ? 'Yes: turns to face the way it goes' : def.turn === 'mirror' ? 'Yes: faces east or west, the way it goes' : 'No (a sign stays upright)') : 'No'}</option>
          <option value="rotate">Turns to face the way it goes</option>
          <option value="mirror">Faces east or west, the way it goes</option>
          <option value="none">Never</option>
        </select></label>
      </>}
    </div>
  );
}
