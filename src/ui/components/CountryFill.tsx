// How a country's territory is filled: its colour, a picture (a flag or your own), or a video.
import { useEffect, useState } from 'react';
import { useStore } from '../store.ts';
import { Api } from '../api.ts';
import * as cmd from '../../domain/commands.ts';
import { assetUrl } from '../../render-engine/assets.ts';

interface Flag { code: string; name: string }
let flagList: Promise<Flag[]> | null = null;
const loadFlags = () => (flagList ??= fetch('data/flags/index.json').then((r) => r.json() as Promise<Flag[]>));

/** A small sample of a country's fill, for lists. */
export function FillSwatch({ entity }: { entity: { color: string; style?: string } }) {
  const fill = cmd.entityStyle(entity).fill;
  if (fill?.kind === 'image' && fill.asset) return <span className="swatch picture" style={{ backgroundImage: `url("${assetUrl(fill.asset)}")` }} />;
  if (fill?.kind === 'video') return <span className="swatch video" style={{ background: entity.color }} title="Video">▶</span>;
  return <span className="swatch" style={{ background: entity.color }} />;
}

function FlagPicker({ onPick, onClose, current }: { onPick: (code: string) => void; onClose: () => void; current?: string }) {
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { loadFlags().then(setFlags, () => setFlags([])); }, []);
  const shown = (flags ?? []).filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()) || f.code === q.trim().toLowerCase());
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Choose a flag" data-testid="flag-picker">
        <div className="modal-head"><h2>Flags of today's nations</h2><button className="close" onClick={onClose} aria-label="Close">×</button></div>
        <input autoFocus placeholder="Search, e.g. Japan" value={q} onChange={(e) => setQ(e.target.value)} data-testid="flag-search" />
        <div className="flag-grid">
          {!flags && <p className="muted">Loading…</p>}
          {shown.map((f) => (
            <button key={f.code} className={`flag ${current === `data/flags/${f.code}.svg` ? 'on' : ''}`} title={f.name} onClick={() => onPick(f.code)} data-testid={`flag-${f.code}`}>
              <img src={`data/flags/${f.code}.svg`} alt="" loading="lazy" /><span>{f.name}</span>
            </button>
          ))}
        </div>
        <p className="muted">Flag drawings: flag-icons (MIT). Using them is optional; you can also use any picture of your own.</p>
      </div>
    </div>
  );
}

export function CountryFillSection({ id }: { id: string }) {
  const s = useStore();
  const e = s.world!.get('entity', id);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!e) return null;
  const fill = cmd.entityStyle(e).fill;
  const kind = fill?.kind ?? 'color';
  const save = (next: cmd.CountryFill | null) => s.execute((wd) => cmd.setEntityStyle(wd, id, { fill: next }));
  const upload = async (file: File | undefined, k: 'image' | 'video') => {
    if (!file) return;
    setBusy(true);
    try {
      const a = await Api.uploadAsset(s.projectId!, file);
      save({ ...(fill ?? {}), kind: k, asset: a.file, fit: fill?.fit ?? 'cover', ...(k === 'video' ? { play: fill?.play ?? 'loop', speed: fill?.speed ?? 1, start: fill?.start ?? 0 } : {}) });
    } catch (err) { s.toast((err as Error).message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="country-fill" data-testid="country-fill">
      <h4>Fill</h4>
      <div className="fill-now">
        <FillSwatch entity={e} /> Filled with {kind === 'color' ? 'its colour' : kind === 'image' ? (fill?.asset?.startsWith('data/flags/') ? 'a flag' : 'a picture') : 'a video'}
        {kind !== 'color' && <button className="small" onClick={() => save(null)} data-testid="fill-color">Use the colour</button>}
      </div>
      <div className="buttons">
        <button className="small" onClick={() => setPicking(true)} data-testid="choose-flag">Choose a flag…</button>
        <label className="file-button small">Picture of your own…<input type="file" accept="image/*" onChange={(ev) => upload(ev.target.files?.[0], 'image')} data-testid="fill-upload-picture" /></label>
        <label className="file-button small">Video…<input type="file" accept="video/*" onChange={(ev) => upload(ev.target.files?.[0], 'video')} data-testid="fill-upload-video" /></label>
      </div>
      {busy && <p className="muted">Adding the file to the project…</p>}
      {fill && (fill.kind === 'image' || fill.kind === 'video') && <>
        <label>How it covers the territory<select value={fill.fit ?? 'cover'} onChange={(ev) => save({ ...fill, fit: ev.target.value as cmd.CountryFill['fit'] })} data-testid="fill-fit">
          <option value="cover">Cover the territory (cropped)</option><option value="contain">Fit inside the territory</option><option value="stretch">Stretch over the territory</option><option value="tile">Repeat as a pattern</option>
        </select></label>
        {fill.fit === 'tile' && <label>Pattern size (px)<input type="number" min={4} max={2000} value={fill.tileSize ?? 120} onChange={(ev) => Number(ev.target.value) > 0 && save({ ...fill, tileSize: Number(ev.target.value) })} /></label>}
        {fill.kind === 'video' && <>
          <label>Playback<select value={fill.play ?? 'loop'} onChange={(ev) => save({ ...fill, play: ev.target.value as 'loop' | 'once' })} data-testid="fill-play">
            <option value="loop">Loop</option><option value="once">Play once, then hold the last frame</option>
          </select></label>
          <div className="two">
            <label>Speed<input type="number" min={0.05} max={20} step={0.05} value={fill.speed ?? 1} onChange={(ev) => Number(ev.target.value) > 0 && save({ ...fill, speed: Number(ev.target.value) })} /></label>
            <label>Start at (s)<input type="number" min={0} step={0.1} value={fill.start ?? 0} onChange={(ev) => Number(ev.target.value) >= 0 && save({ ...fill, start: Number(ev.target.value) })} /></label>
          </div>
          <p className="muted">The video plays in Presentation and in exports, from the start of each shot. While drawing, its first frame is shown.</p>
        </>}
        <p className="muted">Where a picture cannot be shown yet, the country's colour is used.</p>
      </>}
      {picking && <FlagPicker current={fill?.asset} onClose={() => setPicking(false)} onPick={(code) => { save({ kind: 'image', asset: `data/flags/${code}.svg`, fit: fill?.kind === 'image' ? fill.fit ?? 'cover' : 'cover' }); setPicking(false); }} />}
    </div>
  );
}
