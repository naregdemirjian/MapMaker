// The Planet Studio (Stage 14.5, D156): a planet described in plain controls, step by step (its star and orbit,
// the planet, its interior and plates, its air and water, its history), what follows from them worked out and
// explained as they move, its history simulated in workers and explored layer by layer through time, and the
// planet used for a map whose land and sea follow its history on the map's time axis.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { definitionFromPreset, definitionProblems, PRESETS, type PlanetDefinition, type PresetId, type GeoEventKind } from '../../planet/model/definition.ts';
import { derive, type Derived } from '../../planet/model/physics.ts';
import { planetPipeline, simParams } from '../planet-engine.ts';
import { colourLayer } from '../planet-colors.ts';
import { simOf } from '../../world-model/world-settings.ts';
import { gregorian, PRESENT_YEAR } from '../../core-time/index.ts';
import type { LayerId as EngineLayer } from '../../planet/pipeline/stages.ts';
import { explain, cellAt, type Explanation } from '../../planet/explain.ts';
import { meshAt } from '../../planet/mesh/icosphere.ts';
import { climateSnapshot, historyClimateDiffers } from '../../planet/model/definition.ts';
/** The studio's layers: the engine's, and the land seen from space (the cover stage's picture, D160). */
type LayerId = EngineLayer | 'satellite';
import { CancelledError } from '../../planet/worker/pool.ts';

type StepId = 'star' | 'planet' | 'interior' | 'air' | 'life' | 'history' | 'explore' | 'edit';
const STEPS: Array<[StepId, string]> = [['star', '1 Star and orbit'], ['planet', '2 Planet'], ['interior', '3 Interior and plates'], ['air', '4 Air and water'], ['life', '5 Life and biomes'], ['history', '6 History'], ['explore', '7 Simulate and explore'], ['edit', '8 Edit']];
const LAYER_NAMES: Array<[LayerId, string]> = [
  ['elevation', 'Relief'], ['plates', 'Plates'], ['boundaries', 'Plate boundaries'], ['crust', 'Kind of crust'], ['crustAge', 'Age of the crust'],
  ['crustThickness', 'Thickness of the crust'], ['history', 'What made the crust'], ['sediment', 'Sediment'], ['drainage', 'Rivers (water draining)'],
  ['temperature', 'Temperature (yearly mean)'], ['temperatureMonth', 'Temperature by month'], ['precipitation', 'Rain and snow (a year)'], ['precipitationMonth', 'Rain and snow by month'],
  ['currents', 'The sea\'s currents'], ['ice', 'Ice and snow'], ['water', 'Lakes, rivers, wetlands and ice sheets'], ['rivers', 'Rivers (discharge)'],
  ['runoff', 'Water running off'], ['iceThickness', 'Ice sheets (thickness)'], ['koppen', 'Köppen-Geiger climates'], ['biome', 'Biomes'],
  ['satellite', 'Seen from space'], ['provenance', 'Simulated or edited'], ['insolation', 'Sunlight'],
];
const MONTHS = ['First month', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];
const EVENT_KINDS: Array<[GeoEventKind, string]> = [
  ['supercontinent', 'Continents gather into a supercontinent'], ['breakup', 'A supercontinent breaks up'], ['rift', 'A rift opens'], ['collision', 'Continents collide'],
  ['volcanic-period', 'A volcanic period'], ['lip', 'A flood basalt (large igneous province)'], ['hotspot', 'A new hotspot'], ['impact', 'An impact'], ['reorganisation', 'Plates change direction'],
  ['ice-age', 'An ice age (half the carbon dioxide per unit of strength)'], ['greenhouse', 'A greenhouse period (more carbon dioxide)'], ['sea-level', 'The sea rises (50 m per unit of strength)'],
];
/** Edits with their geological explanation (D161): the event placed, how long it lasts, what it does. */
type EditKind = 'hotspot' | 'range' | 'rift' | 'plateau' | 'crater' | 'sea';
const EDITS: Record<EditKind, { label: string; event: GeoEventKind; lasts: (when: number) => number; follows: string }> = {
  hotspot: { label: 'Volcanic islands: a hotspot under the moving plate', event: 'hotspot', lasts: (w) => w, follows: 'Volcanoes grow where the plate passes over the plume: at sea a chain of islands ageing away from it, on land a volcanic province; rain on their windward slopes.' },
  range: { label: 'A mountain range: continents pushed together here', event: 'collision', lasts: () => 60, follows: 'Continents near here move together and collide: the crust thickens into a range, with a rain shadow behind it, rivers turned aside and biomes shifted.' },
  rift: { label: 'An inland sea or a new ocean: a rift opening here', event: 'rift', lasts: () => 40, follows: 'The plate splits here: a rift valley with lakes, and a sea between the parts as they drift apart.' },
  plateau: { label: 'A volcanic plateau: a flood basalt', event: 'lip', lasts: () => 2, follows: 'Basalt several kilometres thick spreads about 800 km across; the land stands higher and wears down slowly.' },
  crater: { label: 'A crater: an impact', event: 'impact', lasts: () => 0, follows: 'A basin with a raised rim, a lake in it if the climate fills it; worn and filled with time.' },
  sea: { label: 'The sea rises (everywhere)', event: 'sea-level', lasts: (w) => Math.min(30, w), follows: 'The sea stands 50 m higher while it lasts: lowlands and shelves flooded in those moments\' pictures.' },
};
/** What each control does, in a sentence (shown as it is moved). */
const EXPLAIN: Record<string, string> = {
  starMass: 'A heavier star is far brighter (about as the fourth power of its mass), hotter and bluer, and lives much shorter; a light red dwarf is dim and red, and its habitable zone is close in, where tides may lock a planet.',
  distance: 'Farther from the star, less light (as the square of the distance): colder, more ice; closer, warmer, until the oceans would boil away.',
  eccentricity: 'A stretched orbit brings the planet nearer and farther in turn: one season gets more light than the other.',
  radius: 'A bigger rocky planet is much heavier (squeezed by its own weight): stronger gravity, lower mountains, thinner air for the same amount, more heat inside.',
  tilt: 'More tilt: stronger seasons, the poles get summer sun; past 54° the poles get more light than the equator over a year. Over 90° the planet turns backwards.',
  day: 'A slower turning planet has wider Hadley cells (fewer, broader wind belts) and gentler differences between the equator and the poles.',
  heat: 'More heat from radioactivity inside: faster plates, more volcanoes, more mountain building; too little and the plates stop (a stagnant lid).',
  plates: 'About how many plates the lithosphere starts broken into; they split and weld as the history goes on.',
  activity: 'How vigorous plate motion is, beyond what the interior\'s heat gives.',
  continents: 'How much of the surface the continents\' crust covers at the start (shelves included).',
  hotspots: 'Mantle plumes: they build island chains on moving plates, and huge shields on a stagnant lid.',
  pressure: 'More air: a stronger greenhouse, gentler temperature differences, more scattered light; none: the surface bakes by day and freezes by night.',
  co2: 'Carbon dioxide traps heat: more of it, warmer (Venus has 96 per cent and 92 bar: 460 °C).',
  clouds: 'More cloud reflects more light: cooler, though clouds also trap heat at night.',
  ocean: 'The share of the surface under the sea now. Water also weakens the lithosphere: without it plates rarely move.',
  age: 'An older planet has a brighter star (stars brighten as they age) and a cooler interior.',
  span: 'How much of the planet\'s history is simulated (ending today): longer takes longer.',
};

const newSeed = () => 1 + Math.floor(Math.random() * 999_999);
const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d }) : '∞');

/** A labelled slider, linear or logarithmic, with its value. */
function Slider({ id, label, value, min, max, step, log, unit, digits = 0, onChange, onFocus }: { id: string; label: string; value: number; min: number; max: number; step?: number; log?: boolean; unit?: string; digits?: number; onChange: (v: number) => void; onFocus: () => void }) {
  const toPos = (v: number) => (log ? (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (v - min) / (max - min));
  const fromPos = (p: number) => (log ? Math.exp(Math.log(min) + p * (Math.log(max) - Math.log(min))) : min + p * (max - min));
  const round = (v: number) => (step ? Math.round(v / step) * step : v);
  return (
    <label className="studio-slider">
      <span>{label}</span>
      <input type="range" min={0} max={1000} value={Math.round(toPos(value) * 1000)} data-testid={`studio-control-${id}`}
        onChange={(e) => { onFocus(); onChange(round(fromPos(Number(e.target.value) / 1000))); }} onFocus={onFocus} />
      <b data-testid={`studio-value-${id}`}>{fmt(value, digits)}{unit ? ` ${unit}` : ''}</b>
    </label>
  );
}

/** The orbit drawn over the habitable zone: where the planet is, and where liquid water could be. */
function OrbitDiagram({ def, x }: { def: PlanetDefinition; x: Derived }) {
  const a = def.orbit.semiMajorAu, e = def.orbit.eccentricity;
  const reach = Math.max(x.habitableZone.outer * 1.15, a * (1 + e) * 1.15);
  const k = 70 / reach;
  const star = x.stars[0].color;
  return (
    <svg width={160} height={160} viewBox="-80 -80 160 160" data-testid="studio-orbit" aria-label="The orbit and the habitable zone">
      <circle r={x.habitableZone.outer * k} fill="rgba(70,170,110,0.25)" />
      <circle r={x.habitableZone.inner * k} fill="var(--panel)" />
      <ellipse cx={-a * e * k} rx={a * k} ry={a * Math.sqrt(1 - e * e) * k} fill="none" stroke="#9fc4e8" strokeWidth={1.2} />
      <circle r={4 + Math.min(4, Math.log10(1 + x.luminositySun) * 2)} fill={`rgb(${star.join(',')})`} />
      <circle cx={a * (1 - e) * k} r={3} fill="#e3e9ef" />
    </svg>
  );
}

export function PlanetStudio() {
  const s = useStore();
  const editingId = s.studioSpaceId;
  const editing = editingId ? simOf(s.world?.get('map_space', editingId)) : null;
  const [def, setDef] = useState<PlanetDefinition>(() => editing ?? definitionFromPreset('earthlike', newSeed()));
  const [name, setName] = useState(() => editing?.name ?? s.studioName ?? '');
  const [step, setStep] = useState<StepId>('star');
  const [focus, setFocus] = useState('');
  const [more, setMore] = useState(false);
  const x = useMemo(() => derive(def), [def]);
  const problems = useMemo(() => definitionProblems(def), [def]);
  // The simulated history shown, and what it was simulated from.
  const [run, setRun] = useState<{ def: PlanetDefinition; key: string; times: number[]; seaLevels: number[]; ice: number[] } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [layer, setLayer] = useState<LayerId>('elevation');
  const [frame, setFrame] = useState(-1);
  // (For the temperature by month: which twelfth of the year, from the time Earth's calendar starts it.)
  const [month, setMonth] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [legend, setLegend] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null), before = useRef<HTMLCanvasElement>(null);
  const keyNow = useMemo(() => planetPipeline().keyOf('tectonics', def, simParams(def)), [def]);
  const stale = !!run && run.key !== keyNow;
  // Stage 14.10 (D161): a place's explanation, an edit's place and kind, its consequences, the run before the last.
  const [card, setCard] = useState<{ left: number; top: number; text: Explanation } | null>(null);
  const [place, setPlace] = useState<[number, number] | null>(null);
  const [editKind, setEditKind] = useState<EditKind>('hotspot');
  const [editWhen, setEditWhen] = useState(60);
  const [report, setReport] = useState<string[] | null>(null);
  const [previous, setPrevious] = useState<{ def: PlanetDefinition; key: string } | null>(null);
  const [compare, setCompare] = useState(false);
  const close = () => { abort.current?.abort(); s.set({ dialog: null, studioSpaceId: null }); };
  const patch = (f: (d: PlanetDefinition) => void) => setDef((d) => { const n = structuredClone(d); f(n); n.preset = 'custom'; return n; });
  const choosePreset = (id: PresetId) => { setDef(definitionFromPreset(id, def.seed)); setFocus(`preset:${id}`); };

  const simulate = async (from: PlanetDefinition = def) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setProgress(0);
    setReport(null); setCard(null);
    // The history keeps the climate settings it is simulated with (D161): later changes to the air or orbit then
    // recompute today's climate, water and life at once and leave the history until it is re-run with them.
    const d0: PlanetDefinition = { ...from, history: { ...from.history, climate: climateSnapshot(from) } };
    if (JSON.stringify(d0) !== JSON.stringify(def)) setDef(d0);
    const params = simParams(d0);
    try {
      const r = await planetPipeline().product('tectonics', d0, params, { signal: ac.signal, onProgress: (d, t) => setProgress(d / Math.max(1, t)) });
      const times = Array.from(r.data.times as Float64Array);
      if (run && run.key !== r.key) setPrevious({ def: run.def, key: run.key });
      const def = d0;
      setRun({ def, key: r.key, times, seaLevels: Array.from((r.data.seaLevels as Float32Array | undefined) ?? []), ice: Array.from((r.data.iceVolumes as Float32Array | undefined) ?? []) });
      setFrame(times.length - 1);
      if (layer === 'insolation') setLayer('elevation');
      if (step !== 'edit') setStep('explore');
    } catch (e) {
      if (!(e instanceof CancelledError)) s.toast((e as Error).message, 'error');
    } finally {
      if (abort.current === ac) { abort.current = null; setProgress(null); }
    }
  };

  // The picture: the layer at the moment chosen (sunlight needs no history).
  useEffect(() => {
    let live = true;
    const c = canvas.current;
    if (!c) return;
    // While the history still holds for the settings (D161), every layer follows the settings as they are now: the
    // climate, water and life are worked out again at once; otherwise the pictures stay those of the last history.
    const want = run && layer !== 'insolation' ? (stale ? run.def : def) : def;
    if (layer !== 'insolation' && !run) { const g = c.getContext('2d')!; g.fillStyle = '#10171f'; g.fillRect(0, 0, c.width, c.height); setLegend('Simulate the history to see its layers.'); return; }
    const monthly = layer === 'temperatureMonth' || layer === 'precipitationMonth';
    const base = { ...simParams(want), width: c.width, height: c.height };
    if (layer === 'satellite') {
      planetPipeline().product('cover', want, base).then((r) => {
        if (!live) return;
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data.pixels as Uint8Array), c.width, c.height), 0, 0);
        setLegend(`Today's land seen from space: its biomes, its plants coloured after its star's light${def.life.vegetation === 'red-dwarf' ? ' (a red dwarf: dark red)' : def.life.vegetation === 'blue-star' ? ' (a hot star: yellow to orange)' : def.life.vegetation === 'none' ? ' (no plants: bare ground)' : ''}`);
        c.dataset.drawn = `${layer}:-1:${r.key}`;
      }, (e: Error) => { if (live) s.toast(e.message, 'error'); });
      return () => { live = false; };
    }
    planetPipeline().product('raster', want, { ...base, layer, frame: monthly ? month : frame }).then((r) => {
      if (!live) return;
      const { pixels, legend: text } = colourLayer(layer, r.data.raster as Float32Array, c.width, c.height, { min: r.data.min as number, max: r.data.max as number });
      c.getContext('2d')!.putImageData(new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0);
      setLegend(text);
      c.dataset.drawn = `${layer}:${monthly ? month : frame}:${r.key}`;
    }, (e: Error) => { if (live) s.toast(e.message, 'error'); });
    return () => { live = false; };
  }, [run, layer, frame, month, stale ? null : def]);

  // The picture before the last change, beside it (D161).
  useEffect(() => {
    const c = before.current;
    if (!compare || !previous || !c || layer === 'satellite' || layer === 'insolation') return;
    let live = true;
    const monthly = layer === 'temperatureMonth' || layer === 'precipitationMonth';
    planetPipeline().product('raster', previous.def, { ...simParams(previous.def), width: c.width, height: c.height, layer, frame: monthly ? month : -1 }).then((r) => {
      if (!live) return;
      const { pixels } = colourLayer(layer, r.data.raster as Float32Array, c.width, c.height, { min: r.data.min as number, max: r.data.max as number });
      c.getContext('2d')!.putImageData(new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, c.width, c.height), 0, 0);
      c.dataset.drawn = `${layer}:${r.key}`;
    }, () => {});
    return () => { live = false; };
  }, [compare, previous, layer, month]);

  /** "Why is this here?": what the simulation knows about the place clicked, today (D161). */
  const explainAt = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvas.current;
    if (!c || !run) return;
    const rect = c.getBoundingClientRect();
    const lon = ((e.clientX - rect.left) / rect.width) * 360 - 180, lat = 90 - ((e.clientY - rect.top) / rect.height) * 180;
    if (step === 'edit') setPlace([Math.round(lon * 10) / 10, Math.round(lat * 10) / 10]);
    const want = stale ? run.def : def, p = simParams(want), pipe = planetPipeline();
    try {
      const [t, cl, w, b] = await Promise.all(['tectonics', 'climate', 'water', 'biomes'].map((id) => pipe.product(id, want, p)));
      const mesh = meshAt(p.level), n = mesh.n, H = t.data.heights as Int16Array, K = t.data.kinds as Uint8Array, last = H.length / n - 1;
      const text = explain({
        mesh, def: want, x: derive(want), heights: H.subarray(last * n, (last + 1) * n), kinds: K.subarray(last * n, (last + 1) * n),
        age: t.data.age as Float32Array, thickness: t.data.thickness as Float32Array, tags: t.data.tags as Uint8Array, boundary: t.data.boundary as Uint8Array, boundaryRate: t.data.boundaryRate as Float32Array,
        climate: cl.data as never, water: w.data as never, biomes: b.data as never,
      }, cellAt(mesh, lon, lat));
      setCard({ left: e.clientX - rect.left, top: e.clientY - rect.top, text });
    } catch (err) { s.toast((err as Error).message, 'error'); }
  };

  /** Places an edit in the history as the geological event the user chose, and says what follows (D161). */
  const addEdit = () => {
    const k = EDITS[editKind], when = Math.max(0, Math.min((def.simulation.spanMyr ?? 500) - 5, editWhen));
    patch((d) => {
      d.history.events.push({
        id: `edit-${Date.now().toString(36)}`, kind: k.event, startMa: when, durationMyr: k.lasts(when), strength: 1,
        ...(k.event !== 'sea-level' && place ? { at: place } : {}), note: k.label,
      });
    });
    setReport([
      `${k.label} ${k.event === 'sea-level' ? '' : `at ${fmt(Math.abs(place?.[1] ?? 0), 1)}° ${(place?.[1] ?? 0) >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(place?.[0] ?? 0), 1)}° ${(place?.[0] ?? 0) >= 0 ? 'E' : 'W'} `}from ${fmt(when)} million years ago.`,
      k.follows,
      'The history is simulated again with it (all of it, at this quality about as long as the first time), then today\'s climate, water and life on the new land.',
      'The crust it makes is marked as edited: see the layer "Simulated or edited".',
    ]);
  };

  // Playing the history: a picture every 0.4 s, round and round.
  useEffect(() => {
    if (!playing || !run) return;
    const id = setInterval(() => setFrame((f) => ((f < 0 ? run.times.length - 1 : f) + 1) % run.times.length), 400);
    return () => clearInterval(id);
  }, [playing, run]);

  const use = () => {
    if (problems.length) { s.toast(problems[0], 'error'); return; }
    const title = name.trim() || def.name || 'New planet';
    if (editingId) {
      if (s.execute((w) => cmd.setSimDefinition(w, editingId, { ...def, name: title })) !== null) close();
      return;
    }
    const id = s.execute((w) => cmd.createSimPlanet(w, title, def));
    if (!id) return;
    s.set({ spaceId: id, layerId: s.world!.all('layer').find((l) => l.space_id === id)?.id ?? '', selection: null });
    s.fitTimeline();
    s.setTime(gregorian.fromCivil({ year: PRESENT_YEAR }));
    close();
  };

  const control = (id: string, label: string, value: number, set: (v: number) => void, o: { min: number; max: number; step?: number; log?: boolean; unit?: string; digits?: number }) =>
    <Slider id={id} label={label} value={value} onChange={set} onFocus={() => setFocus(id)} {...o} />;

  const when = (f: number) => {
    if (!run) return '';
    const k = f < 0 ? run.times.length - 1 : f, t = run.times[k];
    // The sea's level then against today's (D159), and the ice on land.
    const sea = run.seaLevels[k], ice = run.ice[k];
    const extra = t === 0 || sea === undefined ? '' : ` · sea ${Math.abs(sea) < 5 ? 'as today' : `${fmt(Math.abs(sea))} m ${sea > 0 ? 'higher' : 'lower'}`}`;
    const iceText = ice ? ` · ice on land ${fmt(ice / 1e6, 1)} million km³` : '';
    return (t === 0 ? 'Today' : `${fmt(t)} million years ago`) + extra + iceText;
  };
  const frames = run?.times.length ?? 0;

  return (
    <div className="studio" role="dialog" aria-label="Planet Studio" data-testid="planet-studio">
      <header className="studio-head">
        <h2>Planet Studio{editing ? `: ${editing.name}` : ''}</h2>
        <div className="studio-presets">
          {(Object.keys(PRESETS) as PresetId[]).map((id) => (
            <button key={id} className={`small ${def.preset === id ? 'on' : ''}`} title={PRESETS[id].about} onClick={() => choosePreset(id)} data-testid={`studio-preset-${id}`}>{PRESETS[id].name}</button>
          ))}
        </div>
        <button className="close" onClick={close} aria-label="Close" data-testid="studio-close">×</button>
      </header>
      <nav className="studio-steps">
        {STEPS.map(([id, label]) => <button key={id} className={step === id ? 'on' : ''} onClick={() => { setStep(id); setCard(null); }} data-testid={`studio-step-${id}`}>{label}</button>)}
        <div className="studio-controls">
          {step === 'star' && <>
            {control('starMass', 'Star\'s mass (Suns)', def.star.stars[0].massSun, (v) => patch((d) => { d.star.stars[0].massSun = v; }), { min: 0.1, max: 3, log: true, digits: 2 })}
            {control('distance', 'Distance (AU)', def.orbit.semiMajorAu, (v) => patch((d) => { d.orbit.semiMajorAu = v; }), { min: 0.02, max: 10, log: true, digits: 3 })}
            {control('eccentricity', 'Eccentricity', def.orbit.eccentricity, (v) => patch((d) => { d.orbit.eccentricity = v; }), { min: 0, max: 0.6, digits: 3 })}
            {more && control('perihelion', 'Season at the nearest point (°)', def.orbit.perihelionDeg, (v) => patch((d) => { d.orbit.perihelionDeg = v; }), { min: 0, max: 359, step: 1 })}
          </>}
          {step === 'planet' && <>
            {control('radius', 'Radius (km)', def.body.radiusKm, (v) => patch((d) => { d.body.radiusKm = v; }), { min: 1000, max: 16000, step: 10 })}
            {control('tilt', 'Axial tilt (°)', def.body.tiltDeg, (v) => patch((d) => { d.body.tiltDeg = v; }), { min: 0, max: more ? 180 : 90, digits: 1 })}
            {control('day', 'A turn against the stars (hours)', def.body.dayHours, (v) => patch((d) => { d.body.dayHours = v; }), { min: 2, max: 6000, log: true, digits: 1 })}
            <label className="studio-slider"><span>Always one face to the star</span>
              <select value={String(def.body.tidallyLocked)} onChange={(e) => patch((d) => { d.body.tidallyLocked = e.target.value === 'auto' ? 'auto' : e.target.value === 'true'; })} data-testid="studio-control-locked">
                <option value="auto">As the tides would have it</option><option value="true">Yes</option><option value="false">No</option>
              </select></label>
          </>}
          {step === 'interior' && <>
            {control('heat', 'Heat from radioactivity (× Earth)', def.interior.heatProduction, (v) => patch((d) => { d.interior.heatProduction = v; }), { min: 0, max: 5, digits: 2 })}
            {control('plates', 'Plates', def.tectonics.plates, (v) => patch((d) => { d.tectonics.plates = Math.round(v); }), { min: 2, max: 30, step: 1 })}
            {control('activity', 'Tectonic activity', def.tectonics.activity, (v) => patch((d) => { d.tectonics.activity = v; }), { min: 0, max: 3, digits: 2 })}
            {control('continents', 'Continental crust (share)', def.tectonics.continentalFraction, (v) => patch((d) => { d.tectonics.continentalFraction = v; }), { min: 0, max: 0.9, digits: 2 })}
            {control('hotspots', 'Hotspots', def.tectonics.hotspots, (v) => patch((d) => { d.tectonics.hotspots = Math.round(v); }), { min: 0, max: 40, step: 1 })}
            <label className="studio-slider"><span>Regime</span>
              <select value={def.interior.regime} onChange={(e) => patch((d) => { d.interior.regime = e.target.value as PlanetDefinition['interior']['regime']; })} data-testid="studio-control-regime">
                <option value="auto">As the physics suggests</option><option value="mobile-lid">Moving plates</option><option value="stagnant-lid">A single rigid lid</option><option value="episodic">Plates moving in bursts</option>
              </select></label>
            {more && control('core', 'Core\'s share of the mass', def.interior.coreFraction, (v) => patch((d) => { d.interior.coreFraction = v; }), { min: 0, max: 0.8, digits: 2 })}
          </>}
          {step === 'air' && <>
            {control('pressure', 'Air at the surface (bar)', Math.max(0.001, def.atmosphere.pressureBar), (v) => patch((d) => { d.atmosphere.pressureBar = v; }), { min: 0.001, max: 100, log: true, digits: 3 })}
            {control('co2', 'Carbon dioxide (share)', Math.max(1e-6, def.atmosphere.co2), (v) => patch((d) => { d.atmosphere.co2 = v; }), { min: 1e-6, max: 0.97, log: true, digits: 5 })}
            {control('clouds', 'Cloud cover', def.atmosphere.clouds, (v) => patch((d) => { d.atmosphere.clouds = v; }), { min: 0, max: 1, digits: 2 })}
            {control('ocean', 'Sea (share of the surface)', def.water.oceanFraction, (v) => patch((d) => { d.water.oceanFraction = v; }), { min: 0, max: 1, digits: 2 })}
          </>}
          {step === 'life' && <>
            <label className="studio-slider"><span>Plants</span>
              <select value={def.life.vegetation} onChange={(e) => patch((d) => { d.life.vegetation = e.target.value as PlanetDefinition['life']['vegetation']; })} onFocus={() => setFocus('vegetation')} data-testid="studio-control-vegetation">
                <option value="earth">Green, as under the Sun</option><option value="red-dwarf">Dark red to black (under a red dwarf)</option>
                <option value="blue-star">Yellow to orange (under a hot white star)</option><option value="none">None: bare ground</option>
              </select></label>
            <label className="studio-slider"><span>Biomes</span>
              <select value={def.life.biomeSet} onChange={(e) => patch((d) => { d.life.biomeSet = e.target.value as PlanetDefinition['life']['biomeSet']; })} onFocus={() => setFocus('biomes')} data-testid="studio-control-biomes">
                <option value="earth">The Earth's</option><option value="custom">The planet's own (below), else the Earth's</option>
              </select></label>
            {def.life.biomeSet === 'custom' && <>
              {def.life.customBiomes.map((b, i) => (
                <div key={b.id} className="studio-event" data-testid={`studio-biome-${i}`}>
                  <input value={b.name} onChange={(e) => patch((d) => { d.life.customBiomes[i].name = e.target.value; })} placeholder="Name" />
                  <input type="color" value={`#${b.color.map((v) => v.toString(16).padStart(2, '0')).join('')}`} onChange={(e) => patch((d) => { const h = e.target.value; d.life.customBiomes[i].color = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) as [number, number, number]; })} title="Its colour from space" />
                  <label>°C<input type="number" value={b.tempC?.[0] ?? -50} onChange={(e) => patch((d) => { d.life.customBiomes[i].tempC = [Number(e.target.value) || 0, d.life.customBiomes[i].tempC?.[1] ?? 60]; })} />to<input type="number" value={b.tempC?.[1] ?? 60} onChange={(e) => patch((d) => { d.life.customBiomes[i].tempC = [d.life.customBiomes[i].tempC?.[0] ?? -50, Number(e.target.value) || 0]; })} /></label>
                  <label>mm<input type="number" value={b.precipMm?.[0] ?? 0} onChange={(e) => patch((d) => { d.life.customBiomes[i].precipMm = [Number(e.target.value) || 0, d.life.customBiomes[i].precipMm?.[1] ?? 10_000]; })} />to<input type="number" value={b.precipMm?.[1] ?? 10_000} onChange={(e) => patch((d) => { d.life.customBiomes[i].precipMm = [d.life.customBiomes[i].precipMm?.[0] ?? 0, Number(e.target.value) || 0]; })} /></label>
                  <button className="small" onClick={() => patch((d) => { d.life.customBiomes.splice(i, 1); d.life.customBiomes.forEach((x, k) => { x.priority = k; }); })} title="Remove this biome">×</button>
                </div>
              ))}
              <button className="small" data-testid="studio-add-biome" onClick={() => patch((d) => { d.life.customBiomes.push({ id: `biome-${Date.now().toString(36)}`, name: 'New biome', color: [180, 90, 160], tempC: [10, 30], precipMm: [500, 2000], priority: d.life.customBiomes.length }); })}>+ Biome</button>
              <p className="muted">Earlier biomes win where several fit; where none fits, the Earth's biome is kept.</p>
            </>}
          </>}
          {step === 'history' && <>
            {control('age', 'Age (billion years)', def.history.ageGyr, (v) => patch((d) => { d.history.ageGyr = v; }), { min: 0.1, max: 10, log: true, digits: 2 })}
            {control('span', 'Simulated (million years)', def.simulation.spanMyr ?? 500, (v) => patch((d) => { d.simulation.spanMyr = Math.round(v / 10) * 10; }), { min: 50, max: 1500, log: true })}
            <label className="studio-slider"><span>Detail</span>
              <select value={def.simulation.quality} onChange={(e) => patch((d) => { d.simulation.quality = e.target.value as PlanetDefinition['simulation']['quality']; })} data-testid="studio-control-quality">
                <option value="preview">Preview (fast; cells about 240 km)</option><option value="standard">Standard (cells about 110 km; several times slower)</option>
              </select></label>
            <h4>Events</h4>
            {def.history.events.map((e, i) => (
              <div key={e.id} className="studio-event" data-testid={`studio-event-${i}`}>
                <select value={e.kind} onChange={(ev) => patch((d) => { d.history.events[i].kind = ev.target.value as GeoEventKind; })}>{EVENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <label>From<input type="number" value={e.startMa} min={0} onChange={(ev) => patch((d) => { d.history.events[i].startMa = Math.max(0, Number(ev.target.value) || 0); })} /> Ma</label>
                <label>for<input type="number" value={e.durationMyr} min={0} onChange={(ev) => patch((d) => { d.history.events[i].durationMyr = Math.max(0, Number(ev.target.value) || 0); })} /> Myr</label>
                <label>strength<input type="number" step={0.1} value={e.strength} min={0} max={10} onChange={(ev) => patch((d) => { d.history.events[i].strength = Math.max(0, Number(ev.target.value) || 0); })} /></label>
                <button className="small" onClick={() => patch((d) => { d.history.events.splice(i, 1); })} title="Remove this event">×</button>
              </div>
            ))}
            <button className="small" data-testid="studio-add-event" onClick={() => patch((d) => { d.history.events.push({ id: `event-${Date.now().toString(36)}`, kind: 'rift', startMa: Math.min(200, (d.simulation.spanMyr ?? 500) / 2), durationMyr: 50, strength: 1 }); })}>+ Event</button>
          </>}
          {step === 'edit' && <>
            <p className="muted">Click the planet to choose a place, then say what happened there: the engine places it in the history as the geological event that makes it, and works out what follows.</p>
            <div data-testid="studio-edit-place">{place ? `Place: ${fmt(Math.abs(place[1]), 1)}° ${place[1] >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(place[0]), 1)}° ${place[0] >= 0 ? 'E' : 'W'}` : 'No place chosen yet.'}</div>
            <label className="studio-slider"><span>What happened</span>
              <select value={editKind} onChange={(e) => setEditKind(e.target.value as EditKind)} data-testid="studio-edit-kind">
                {(Object.keys(EDITS) as EditKind[]).map((k) => <option key={k} value={k}>{EDITS[k].label}</option>)}
              </select></label>
            <label className="studio-slider"><span>From (million years ago)</span><input type="number" min={0} value={editWhen} onChange={(e) => setEditWhen(Math.max(0, Number(e.target.value) || 0))} data-testid="studio-edit-when" /></label>
            <button className="primary" disabled={!run || (!place && editKind !== 'sea')} onClick={addEdit} data-testid="studio-edit-add">Place it in the history</button>
            {report && <div className="studio-report" data-testid="studio-report">
              <h4>What follows</h4>
              <ul>{report.map((l) => <li key={l}>{l}</li>)}</ul>
              <button className="primary" onClick={() => simulate()} data-testid="studio-recompute-all">Work it all out now</button>
              <button className="small" onClick={() => setReport(null)} data-testid="studio-recompute-later">Keep the pictures as they are for now</button>
            </div>}
          </>}
          {step === 'explore' && <>
            <label className="studio-slider"><span>Layer</span>
              <select value={layer} onChange={(e) => { setLayer(e.target.value as LayerId); setCard(null); }} data-testid="studio-layer">{LAYER_NAMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {(layer === 'temperatureMonth' || layer === 'precipitationMonth') && <label className="studio-slider"><span>Month</span>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="studio-month">{MONTHS.map((l, i) => <option key={l} value={i}>{l}{i === 0 ? ' (January on an Earth-like orbit)' : i === 6 ? ' (July)' : ''}</option>)}</select></label>}
            {['temperature', 'temperatureMonth', 'precipitation', 'precipitationMonth', 'currents', 'ice'].includes(layer) && <p className="muted">The climate of today over today's land and sea: a seasonal energy balance (D157), winds from the circulation cells, rain carried by them and raised by mountains, the sea's currents (D158, D159).</p>}
            {['koppen', 'biome', 'satellite'].includes(layer) && <p className="muted">Today's biomes (D160): Köppen-Geiger climates by Peel and others' rules; biomes by warmth and dryness (rain over the evaporation the warmth and sunlight allow), with wetlands, ice and mountains from the water and the heights; the planet's own biomes where they fit. Changing plants or biomes in step 4 redraws them at once.</p>}
            {['water', 'rivers', 'runoff', 'iceThickness'].includes(layer) && <p className="muted">Today's water (D159): what the rain leaves after evaporation runs off; hollows fill until they spill or their lakes evaporate all they get (salt lakes); rivers by how much water they carry; ice sheets grown in today's climate.</p>}
            <label className="studio-slider"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aster Prime" data-testid="studio-name" /></label>
            <button className="primary" onClick={use} disabled={problems.length > 0} data-testid="studio-use">{editingId ? 'Apply to this map' : 'Use this planet for a new map'}</button>
            <p className="muted">The map's land and sea follow the planet's simulated history on its timeline: today at the present, earlier dates further back.</p>
          </>}
          <label className="check studio-more"><input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} /> More settings</label>
          <label className="studio-slider"><span>Seed</span><input type="number" min={1} value={def.seed} onChange={(e) => patch((d) => { d.seed = Math.max(1, Math.round(Number(e.target.value) || 1)); })} data-testid="studio-seed" /></label>
        </div>
      </nav>
      <main className="studio-main">
        <div className={`studio-pictures ${compare && previous ? 'two' : ''}`}>
          <div className="studio-picture">
            <canvas ref={canvas} width={720} height={360} className="studio-canvas" data-testid="studio-canvas" onClick={explainAt} title={run ? (step === 'edit' ? 'Click to choose the place for an edit' : 'Click a place: why is it as it is?') : ''} />
            {card && (
              <div className="studio-card" style={{ left: Math.min(card.left, 420), top: Math.min(card.top, 160) }} data-testid="studio-card">
                <button className="close small" onClick={() => setCard(null)} aria-label="Close">×</button>
                <h4>{card.text.title}</h4>
                {card.text.sections.map((sec) => <div key={sec.heading}><b>{sec.heading}</b>{sec.lines.map((l) => <p key={l}>{l}</p>)}</div>)}
              </div>
            )}
          </div>
          {compare && previous && <div className="studio-picture"><canvas ref={before} width={720} height={360} className="studio-canvas" data-testid="studio-canvas-before" /><span className="muted">Before the last change</span></div>}
        </div>
        {previous && <label className="check"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} data-testid="studio-compare" /> Compare with the history before the last change</label>}
        <div className="studio-legend muted" data-testid="studio-legend">{legend}</div>
        <div className="studio-time">
          <button className="small" disabled={!run} onClick={() => setPlaying(!playing)} data-testid="studio-play">{playing ? 'Pause' : 'Play'}</button>
          <input type="range" min={0} max={Math.max(0, frames - 1)} value={frame < 0 ? Math.max(0, frames - 1) : frame} disabled={!run} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} data-testid="studio-frame" />
          <span data-testid="studio-when">{when(frame)}</span>
        </div>
        <div className="studio-run">
          {progress === null
            ? <button className="primary" onClick={() => simulate()} disabled={problems.length > 0} data-testid="studio-simulate">{run ? 'Simulate again' : 'Simulate the history'}</button>
            : <><progress value={progress} max={1} data-testid="studio-progress" /><button className="small" onClick={() => abort.current?.abort()} data-testid="studio-cancel">Cancel</button></>}
          {stale && progress === null && <span className="warn-text" data-testid="studio-stale">The settings have changed since this history was simulated.</span>}
          {!stale && run && historyClimateDiffers(def) && progress === null && <span className="muted" data-testid="studio-climate-note">Today's climate, water and life follow the new settings; the history's erosion and ice still follow those it was simulated with. <button className="small" onClick={() => simulate({ ...def, history: { ...def.history, climate: undefined } })} data-testid="studio-rerun-climate">Re-run the history with this climate</button></span>}
          <span className="muted">Simulated with simplified models: plate tectonics, isostasy, erosion and sediment where each moment's climate rains, ice on land and the sea's level from its water.</span>
        </div>
      </main>
      <aside className="studio-side">
        <h3>What follows</h3>
        <OrbitDiagram def={def} x={x} />
        <dl className="studio-readouts">
          <dt>Star</dt><dd data-testid="studio-readout-star">{x.stars[0].spectralClass}, {fmt(x.stars[0].teffK)} K, {fmt(x.luminositySun, 3)} × the Sun's light</dd>
          <dt>Sunlight</dt><dd data-testid="studio-readout-sunlight">{fmt(x.insolation)} W/m² ({fmt(x.insolationEarth, 2)} × Earth's)</dd>
          <dt>Habitable zone</dt><dd data-testid="studio-readout-zone">{fmt(x.habitableZone.inner, 2)} to {fmt(x.habitableZone.outer, 2)} AU: {x.zone === 'inside' ? 'the planet is in it' : x.zone === 'too-close' ? 'the planet is too close' : 'the planet is too far'}</dd>
          <dt>Year</dt><dd data-testid="studio-readout-year">{fmt(x.yearDays, 1)} days</dd>
          <dt>Day</dt><dd data-testid="studio-readout-day">{x.tidallyLocked ? 'none: one side always faces the star' : `${fmt(x.solarDayHours, 1)} hours from noon to noon`}</dd>
          <dt>Gravity</dt><dd data-testid="studio-readout-gravity">{fmt(x.gravityEarth, 2)} g ({fmt(x.massEarths, 2)} Earth masses, {fmt(x.densityKgM3 / 1000, 2)} t/m³)</dd>
          <dt>Temperature</dt><dd data-testid="studio-readout-temperature">{fmt(x.surfaceK - 273.15)} °C on average (without air {fmt(x.equilibriumK - 273.15)} °C; greenhouse +{fmt(x.greenhouseK)} °C; albedo {fmt(x.albedo, 2)})</dd>
          <dt>Winds</dt><dd data-testid="studio-readout-winds">{x.cellsPerHemisphere} circulation cell{x.cellsPerHemisphere > 1 ? 's' : ''} a hemisphere; the tropics' cells reach {fmt(x.hadleyEdgeDeg)}°</dd>
          <dt>Interior</dt><dd data-testid="studio-readout-interior">heat flow {fmt(x.heatFlowEarth, 2)} × Earth's; {x.regime === 'mobile-lid' ? 'moving plates' : x.regime === 'stagnant-lid' ? 'a single rigid lid' : 'plates moving in bursts'}. {x.regimeReason}</dd>
        </dl>
        {x.notes.map((n) => <p key={n} className="studio-note" data-testid="studio-note">{n}</p>)}
        {problems.map((p) => <p key={p} className="studio-problem" data-testid="studio-problem">{p}</p>)}
        <div className="studio-explain" data-testid="studio-explain">
          {focus.startsWith('preset:') ? PRESETS[focus.slice(7) as PresetId].about : EXPLAIN[focus] ?? 'Move a control to see what it changes, and why.'}
        </div>
      </aside>
    </div>
  );
}
