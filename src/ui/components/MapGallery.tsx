// The gallery of maps (D235): every kind of map there is, as cards by family (planets, ready-made places, flat plans,
// space); the one chosen shows its settings, and Create makes it. A panel of Map Studio (from the New map dialog it
// replaces), in front when a project has no map yet; Map › New map… and the Maps list's "+ Map" open it.
import { useState } from 'react';
import { useStore, store } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { gregorian, PRESENT_YEAR } from '../../core-time/index.ts';
import { planetParamsOf, type PlanetParams } from '../../terrain/planet.ts';
import { spaceCamera } from '../../space/space-view.ts';
import { REGION_MAPS } from '../../domain/region-maps.ts';
import { makeRegionMap } from '../region-maps.ts';
import { PlanetChooser, newSeed } from './Dialogs.tsx';
import { VIEWER } from '../shell/dock.ts';

export type MapKind = 'earth' | 'round' | 'paleo' | 'planet' | 'sim' | 'flat' | 'stars' | 'solar' | 'invented' | 'milkyway' | 'galaxy' | `region:${string}`;
interface KindCard { id: MapKind; name: string; blurb: string; icon: string }

/** The kinds of map, by family, in the order of the gallery. */
export const GALLERY: Array<{ title: string; kinds: KindCard[] }> = [
  { title: 'Planets', kinds: [
    { id: 'earth', name: 'The Earth', blurb: 'Today’s land, seas, lakes and rivers: a globe to draw history on', icon: 'earth' },
    { id: 'paleo', name: 'The Earth through time', blurb: 'Its continents, seas and mountains as they were, from 540 million years ago to today', icon: 'paleo' },
    { id: 'planet', name: 'A planet of your own', blurb: 'Continents, seas and mountains generated from a seed', icon: 'planet' },
    { id: 'sim', name: 'A simulated planet', blurb: 'Its star, orbit, air and water described, its continents shaped over its history (the Planet Studio)', icon: 'sim' },
    { id: 'round', name: 'A blank world', blurb: 'A planet or moon of any size with nothing on it yet: the Moon, Mars, or one of your own', icon: 'blank' },
  ] },
  { title: 'Ready-made places', kinds: REGION_MAPS.map((m) => ({ id: `region:${m.id}` as MapKind, name: m.name, blurb: 'As photographed from space, at the finest detail, with a 4K shot', icon: 'region' })) },
  { title: 'Flat', kinds: [
    { id: 'flat', name: 'A plan', blurb: 'A city, a battlefield, a region: flat and true to scale', icon: 'flat' },
  ] },
  { title: 'Space', kinds: [
    { id: 'solar', name: 'The solar system', blurb: 'The Sun and the planets where they are on the date viewed', icon: 'solar' },
    { id: 'stars', name: 'The stars around the Sun', blurb: 'Every known star within 50 light-years, in three dimensions', icon: 'stars' },
    { id: 'invented', name: 'Stars of your own', blurb: 'An invented star map, made from a seed', icon: 'stars' },
    { id: 'milkyway', name: 'The Milky Way', blurb: 'The whole galaxy, its arms and best-known places, with star systems to hold', icon: 'galaxy' },
    { id: 'galaxy', name: 'A galaxy of your own', blurb: 'Spiral arms and star systems, made from a seed', icon: 'galaxy' },
  ] },
];

const WORLD_PRESETS = [
  { name: 'Earth', km: 6371.0088 }, { name: 'Moon', km: 1737.4 }, { name: 'Mars', km: 3389.5 }, { name: 'Mercury', km: 2439.7 },
  { name: 'Venus', km: 6051.8 }, { name: 'Ganymede', km: 2634.1 }, { name: 'Titan', km: 2574.7 },
];
const isSpaceKind = (k: MapKind) => k === 'stars' || k === 'solar' || k === 'invented' || k === 'milkyway' || k === 'galaxy';

/** A small picture of a kind of map, drawn in lines. */
function KindIcon({ icon }: { icon: string }) {
  const c = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" className="map-card-icon">
      {icon === 'earth' && <><circle cx="16" cy="16" r="12" {...c} /><path d="M9 11c3 1 4 4 7 3s3-4 6-3M8 20c3-1 5 2 8 1s4 2 7 1" {...c} /></>}
      {icon === 'paleo' && <><circle cx="16" cy="16" r="12" {...c} /><path d="M10 13c4-3 8 3 12 0M11 20c3 2 6-2 10 1" {...c} /><path d="M24 5l3-2M27 8l3-1" {...c} /></>}
      {icon === 'planet' && <><circle cx="16" cy="16" r="10" {...c} /><ellipse cx="16" cy="16" rx="15" ry="4.5" {...c} /></>}
      {icon === 'sim' && <><circle cx="16" cy="16" r="10" {...c} /><path d="M16 6v20M6 16h20M9 9l14 14" {...c} /></>}
      {icon === 'blank' && <circle cx="16" cy="16" r="12" {...c} strokeDasharray="3 2.5" />}
      {icon === 'region' && <><rect x="4" y="7" width="24" height="18" rx="2" {...c} /><path d="M7 21l6-7 5 5 3-3 5 5" {...c} /></>}
      {icon === 'flat' && <><rect x="5" y="5" width="22" height="22" {...c} /><path d="M5 12h22M5 19h22M12 5v22M19 5v22" {...c} strokeWidth={1} /></>}
      {icon === 'solar' && <><circle cx="16" cy="16" r="3" {...c} /><circle cx="16" cy="16" r="8" {...c} strokeWidth={1} /><circle cx="16" cy="16" r="13" {...c} strokeWidth={1} /><circle cx="24" cy="16" r="1.8" fill="currentColor" /><circle cx="7" cy="9" r="1.5" fill="currentColor" /></>}
      {icon === 'stars' && <path d="M8 8l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM22 6l.8 1.6 1.6.8-1.6.8L22 11l-.8-1.6-1.6-.8 1.6-.8zM20 20l1.2 2.4 2.4 1.2-2.4 1.2L20 27l-1.2-2.2-2.4-1.2 2.4-1.2z" {...c} />}
      {icon === 'galaxy' && <path d="M16 16c2-3 7-2 7 2s-5 8-10 6-7-9-3-14 13-5 15 1M16 16c-2 3-7 2-7-2" {...c} />}
    </svg>
  );
}

/** The gallery panel: the cards, the chosen kind's settings, and Create. */
export function MapGallery() {
  const s = useStore();
  const [kind, setKind] = useState<MapKind>(() => (s.world?.all('map_space').length ? 'round' : 'earth'));
  const [name, setName] = useState('');
  const [km, setKm] = useState('6371');
  const [inv, setInv] = useState({ seed: newSeed(), count: 300, radiusLy: 50, shape: 'sphere' as 'sphere' | 'disc' });
  const [gal, setGal] = useState({ seed: newSeed(), systems: 600, arms: 4, pitch: 14, radiusLy: 50000, bar: true });
  const [widthKm, setWidthKm] = useState('20');
  const [planet, setPlanet] = useState<PlanetParams>(() => planetParamsOf({ seed: newSeed(), preset: 'earthlike' })!);
  const empty = !s.world?.all('map_space').length;
  const create = () => {
    // A simulated planet (D156) is described in the Planet Studio, which makes its map.
    if (kind === 'sim') { s.set({ dialog: 'planet-studio', studioSpaceId: null, studioName: name.trim() }); return; }
    // A ready-made map of a region (D175).
    if (kind.startsWith('region:')) { void makeRegionMap(kind.slice(7)).then(() => shown()); return; }
    const id = kind === 'milkyway' || kind === 'galaxy'
      ? s.execute((w) => cmd.createSpaceMap(w, name.trim() || (kind === 'milkyway' ? 'The Milky Way' : 'A galaxy'), 'galaxy', undefined, { ...gal, kind: kind === 'milkyway' ? 'milkyway' : 'invented', seed: kind === 'milkyway' ? 1 : gal.seed }))
      : kind === 'stars' || kind === 'solar' || kind === 'invented'
      ? s.execute((w) => cmd.createSpaceMap(w, name.trim() || (kind === 'solar' ? 'The solar system' : kind === 'invented' ? 'Invented stars' : 'Nearby stars'), kind === 'stars' ? 'nearby' : kind, kind === 'invented' ? inv : undefined))
      : kind === 'flat'
      ? s.execute((w) => cmd.createFlatMap(w, name.trim() || 'New flat map', Number(widthKm)))
      : kind === 'paleo'
      ? s.execute((w) => cmd.createPaleoEarth(w, name.trim() || 'The Earth through time'))
      : kind === 'planet'
      ? s.execute((w) => cmd.createPlanet(w, name.trim() || 'New planet', Number(km), planet))
      : kind === 'earth'
      ? s.execute((w) => cmd.createWorld(w, name.trim() || 'Earth', 6371.0088, 'natural-earth'))
      : s.execute((w) => cmd.createWorld(w, name.trim() || 'New map', Number(km), 'none'));
    if (!id) return;
    const space = isSpaceKind(kind);
    s.set({ spaceId: id, layerId: s.world!.all('layer').find((l) => l.space_id === id && l.kind === 'partition')?.id ?? s.world!.all('layer').find((l) => l.space_id === id)?.id ?? '', selection: null, ...(space ? { tool: 'select' as const } : {}) });
    // A map of space opens looking down at its plane at an angle, all of it in view.
    if (space) s.setCamera(spaceCamera());
    // The Earth through geological time (D134): its timeline from 540 million years ago to today, at Pangaea.
    if (kind === 'paleo') { s.fitTimeline(); s.setTime(gregorian.fromCivil({ year: PRESENT_YEAR - 250_000_000 })); }
    setName('');
    shown();
  };
  /** The map made: in front, where the gallery was. */
  const shown = () => store.openPanel(VIEWER);
  const pick = (k: MapKind) => {
    setKind(k);
    if (k === 'round') setKm('3000');
    if (k === 'planet') setKm('6371');
  };
  return (
    <div className="map-gallery" data-testid="map-gallery">
      <div className="map-gallery-head">
        <h3>{empty ? 'Choose the first map of this project' : 'A new map'}</h3>
        <p className="muted">Each map has its own ground, layers and territorial history; events and countries are shared by the whole project.</p>
      </div>
      {GALLERY.map((sec) => (
        <section key={sec.title} className="map-gallery-section">
          <h4>{sec.title}</h4>
          <div className="map-cards" role="radiogroup" aria-label={sec.title}>
            {sec.kinds.map((k) => (
              <label key={k.id} className={`map-card ${k.id === kind ? 'on' : ''}`} title={k.blurb}>
                {/* (The card is a choice like any other: its radio covers it.) */}
                <input type="radio" name="map-kind" checked={k.id === kind} onChange={() => pick(k.id)} data-testid={k.id.startsWith('region:') ? `new-map-region-${k.id.slice(7)}` : `new-map-${k.id}`} />
                <KindIcon icon={k.icon} />
                <span className="map-card-name">{k.name}</span>
                <span className="map-card-blurb">{k.blurb}</span>
              </label>
            ))}
          </div>
        </section>
      ))}
      <div className="map-gallery-form" data-testid="map-gallery-form">
        <h4>{GALLERY.flatMap((sec) => sec.kinds).find((k) => k.id === kind)?.name}</h4>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'flat' ? 'e.g. Old Town' : kind === 'earth' ? 'Earth' : kind === 'stars' ? 'e.g. Nearby stars' : kind === 'solar' ? 'e.g. The solar system' : kind === 'invented' ? 'e.g. The Veyran Reach' : kind === 'milkyway' ? 'e.g. The Milky Way' : kind === 'galaxy' ? 'e.g. The Far Spiral' : 'e.g. Aster Prime'} data-testid="new-map-name" /></label>
        {kind === 'milkyway' || kind === 'galaxy' ? <>
          <div className="two">
            <label>Star systems<input type="number" min={0} max={5000} value={gal.systems} onChange={(e) => setGal({ ...gal, systems: Math.max(0, Math.min(5000, Number(e.target.value) || 0)) })} data-testid="new-map-galaxy-systems" /></label>
            {kind === 'galaxy' && <>
              <label>Arms<input type="number" min={1} max={8} value={gal.arms} onChange={(e) => setGal({ ...gal, arms: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} data-testid="new-map-galaxy-arms" /></label>
              <label>Winding (degrees)<input type="number" min={4} max={40} value={gal.pitch} onChange={(e) => setGal({ ...gal, pitch: Math.max(4, Math.min(40, Number(e.target.value) || 4)) })} title="How far the arms open out: small, tightly wound; large, open" /></label>
              <label>Radius (light-years)<input type="number" min={1000} max={500000} step={1000} value={gal.radiusLy} onChange={(e) => setGal({ ...gal, radiusLy: Math.max(1000, Math.min(500000, Number(e.target.value) || 1000)) })} /></label>
              <label>Seed<input type="number" min={1} value={gal.seed} onChange={(e) => setGal({ ...gal, seed: Math.max(1, Math.round(Number(e.target.value) || 1)) })} data-testid="new-map-galaxy-seed" /></label>
              <label className="check"><input type="checkbox" checked={gal.bar} onChange={(e) => setGal({ ...gal, bar: e.target.checked })} /> A bar across the middle</label>
            </>}
          </div>
          <p className="muted" data-testid="new-map-galaxy-note">{kind === 'milkyway'
            ? 'Its arms as mapped by radio astronomers, the Sun where it is, and 33 places (nebulae, clusters, remnants, notable stars, the black hole at the middle, the Magellanic Clouds), with star systems of your own along the arms to give to countries and factions and join with lanes.'
            : 'A spiral galaxy made from the seed, with a home system half way out and star systems along its arms to give to countries and factions and join with lanes.'}</p>
        </> : kind === 'invented' ? <>
          <div className="two">
            <label>Stars<input type="number" min={2} max={3000} value={inv.count} onChange={(e) => setInv({ ...inv, count: Math.max(2, Math.min(3000, Number(e.target.value) || 2)) })} data-testid="new-map-invented-count" /></label>
            <label>Reaching (light-years)<input type="number" min={5} max={5000} value={inv.radiusLy} onChange={(e) => setInv({ ...inv, radiusLy: Math.max(5, Math.min(5000, Number(e.target.value) || 5)) })} data-testid="new-map-invented-radius" /></label>
            <label>Seed<input type="number" min={1} value={inv.seed} onChange={(e) => setInv({ ...inv, seed: Math.max(1, Math.round(Number(e.target.value) || 1)) })} data-testid="new-map-invented-seed" /></label>
            <label>Shape<select value={inv.shape} onChange={(e) => setInv({ ...inv, shape: e.target.value as 'sphere' | 'disc' })}><option value="sphere">A sphere round the home star</option><option value="disc">A flat disc</option></select></label>
          </div>
          <p className="muted" data-testid="new-map-invented-note">Stars round a home star, most of them red dwarfs as around the Sun, with names of their own (the faintest numbered). The same seed gives the same stars; held stars and lanes work as on the real map.</p>
        </> : kind.startsWith('region:') ? <p className="muted" data-testid="new-map-region-note">{REGION_MAPS.find((m) => `region:${m.id}` === kind)?.about} The photographs (Sentinel-2 cloudless, about 10 m a pixel) and the finer heights (about 40 m) are downloaded as you close in or export, and kept on this computer.</p>
        : kind === 'sim' ? <p className="muted" data-testid="new-map-sim-note">The Planet Studio opens: choose a starting point (Earth-like, a supercontinent, a young volcanic world, a frozen or desert world, an ocean world, a tidally locked planet, a super-Earth, a hothouse…), change what you like step by step, see what follows (its year, gravity, sunlight, temperature, winds, interior) and why, simulate its history and explore it, then use it for a map whose land and sea follow its history through time.</p>
        : kind === 'paleo' ? <p className="muted" data-testid="new-map-paleo-note">The Earth's land and sea floor at 109 moments from 540 million years ago to today (the PALEOMAP PaleoDEMs of C. R. Scotese and N. Wright, 2018), changing steadily between them: Pangaea coming together and breaking up, oceans opening and closing, mountains rising; over the last 128,000 years the seas of the ice ages (land bridges where the sea was lower). Coasts are where the land meets the sea of each moment. Dates before 10,000 BCE are written as how long ago they were: type "250 Ma" or "21,000 years ago".</p>
        : kind === 'solar' ? <p className="muted" data-testid="new-map-solar-note">The planets and Pluto on their orbits, where they are on any date from their orbital elements (JPL): they move as the date changes. Give them to countries and factions, join them with lanes, as on a star map.</p>
        : kind === 'stars' ? <p className="muted" data-testid="new-map-stars-note">982 stars from the HYG database: real positions, colours by type, names. Drag to turn the view, scroll to zoom, click a star to see what it is.</p>
        : kind === 'earth' ? <p className="muted" data-testid="new-map-earth-note">The Earth as it is today (Natural Earth): land, seas, lakes, rivers and coastlines, with today's country borders as a guide to draw over. Its terrain, sea level and calendar are set up here in Map Studio; its history is drawn in History.</p>
        : kind === 'flat' ? <>
          <label>Width (km)<input type="number" min={0.01} max={5000} value={widthKm} onChange={(e) => setWidthKm(e.target.value)} data-testid="new-map-width" /></label>
          <p className="muted">Borders on a flat map are straight lines; the scale bar reads in metres and kilometres.</p>
        </> : <>
          <label>Radius (km)<input type="number" value={km} onChange={(e) => setKm(e.target.value)} data-testid="new-map-radius" /></label>
          {kind === 'round' && <div className="presets">{WORLD_PRESETS.map((p) => <button key={p.name} className="small" onClick={() => { setName(p.name); setKm(String(p.km)); }}>{p.name}</button>)}</div>}
          {kind === 'planet' && <PlanetChooser value={planet} onChange={setPlanet} />}
        </>}
        <div className="map-gallery-actions">
          <button className="primary" onClick={create} data-testid="new-map-create">{kind === 'sim' ? 'Open the Planet Studio' : 'Create map'}</button>
        </div>
      </div>
    </div>
  );
}
