// How a country's territory is filled: its colour, a picture (a flag or your own), or a video.
import { useEffect, useState } from 'react';
import { useStore, store } from '../store.ts';
import { Api } from '../api.ts';
import { IconPicture } from './CharacterIcons.tsx';
import { iconById } from '../../render-engine/icons.ts';
import * as cmd from '../../domain/commands.ts';
import { assetUrl } from '../../render-engine/assets.ts';

interface Flag { code: string; name: string }
let flagList: Promise<Flag[]> | null = null;
const loadFlags = () => (flagList ??= fetch('data/flags/index.json').then((r) => r.json() as Promise<Flag[]>));

/** A small sample of a country's fill, for lists. */
/** The distance slider (0 to 100) runs from 10 km to 20,000 km, evenly by orders of size. */
const kmToSlider = (km: number) => Math.round((Math.log10(Math.max(10, Math.min(20000, km))) - 1) / (Math.log10(20000) - 1) * 100);
const sliderToKm = (v: number) => { const km = 10 ** (1 + (v / 100) * (Math.log10(20000) - 1)); const step = km < 100 ? 5 : km < 1000 ? 25 : 250; return Math.round(km / step) * step; };

export function FillSwatch({ entity }: { entity: { color: string; style?: string } }) {
  const { fill, icon, side } = cmd.entityStyle(entity);
  // A character with an icon: the icon (D85), in the colour of the country it belongs to if it is a unit (D90).
  const def = iconById(icon?.set);
  const color = (side && store.world?.get('entity', side)?.color) || entity.color;
  if (def) return <span className="swatch-icon"><IconPicture icon={def} color={color} look={icon?.look} size={16} /></span>;
  if (side) return <span className="swatch round" style={{ background: color }} />;
  if (icon?.asset) return <span className="swatch picture" style={{ backgroundImage: `url("${assetUrl(icon.asset)}")` }} />;
  if (fill?.off) return <span className="swatch" style={{ background: entity.color }} />;
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
      save({ ...(fill ?? {}), kind: k, asset: a.file, fit: fill?.fit ?? 'fill', ...(k === 'video' ? { play: fill?.play ?? 'loop', speed: fill?.speed ?? 1, start: fill?.start ?? 0 } : {}) });
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
      {kind !== 'color' && fill?.asset && (
        <label className="check" title="Switch the picture off for now: the colour shows, and the picture is kept">
          <input type="checkbox" checked={!fill.off} onChange={(ev) => s.execute((wd) => cmd.setFillsShown(wd, [id], ev.target.checked))} data-testid="fill-shown" /> Show the {kind === 'video' ? 'video' : 'picture'} (off: its colour, the {kind === 'video' ? 'video' : 'picture'} is kept)
        </label>
      )}
      <div className="buttons">
        <button className="small" onClick={() => setPicking(true)} data-testid="choose-flag">Choose a flag…</button>
        <label className="file-button small">Picture of your own…<input type="file" accept="image/*" onChange={(ev) => upload(ev.target.files?.[0], 'image')} data-testid="fill-upload-picture" /></label>
        <label className="file-button small">Video…<input type="file" accept="video/*" onChange={(ev) => upload(ev.target.files?.[0], 'video')} data-testid="fill-upload-video" /></label>
      </div>
      {busy && <p className="muted">Adding the file to the project…</p>}
      {fill && (fill.kind === 'image' || fill.kind === 'video') && <>
        <label>How it covers the territory<select value={fill.fit === 'cover' && fill.asset?.startsWith('data/flags/') ? 'fill' : fill.fit ?? 'fill'} onChange={(ev) => save({ ...fill, fit: ev.target.value as cmd.CountryFill['fit'] })} data-testid="fill-fit">
          <option value="fill">Cover it, stretched a little rather than cropped</option><option value="cover">Cover it (cropped)</option><option value="contain">Fit inside the territory</option><option value="stretch">Stretch over the territory</option><option value="tile">Repeat as a pattern</option>
        </select></label>
        {fill.fit !== 'tile' && <>
          <label>Land in several pieces<select value={fill.pieces ?? 'auto'} onChange={(ev) => save({ ...fill, pieces: ev.target.value as cmd.CountryFill['pieces'] })} data-testid="fill-pieces">
            <option value="auto">Automatic: pieces far from the rest get their own copy</option>
            <option value="whole">One picture over all of it</option>
            <option value="each">A copy for every separate piece</option>
            <option value="near">One picture, and a copy for pieces farther than…</option>
          </select></label>
          {fill.pieces === 'near' && <label className="range-row">Pieces farther apart than <b>{(fill.gapKm ?? 500).toLocaleString()} km</b> get their own copy
            <input type="range" min={0} max={100} step={1} value={kmToSlider(fill.gapKm ?? 500)} onChange={(ev) => save({ ...fill, gapKm: sliderToKm(Number(ev.target.value)) })} data-testid="fill-gap" />
          </label>}
        </>}
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
      {picking && <FlagPicker current={fill?.asset} onClose={() => setPicking(false)} onPick={(code) => { save({ ...(fill?.kind === 'image' ? fill : {}), kind: 'image', asset: `data/flags/${code}.svg`, fit: fill?.kind === 'image' ? fill.fit ?? 'fill' : 'fill' }); setPicking(false); }} />}
    </div>
  );
}
