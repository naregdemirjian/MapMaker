// How the stars look (D130, D131, D132): presets to start from, each shown as a small picture of stars
// drawn as the map would draw them, a look made up by chance, and every part of the look to change: the
// stars, the sky, the lines and names, whether the map is seen in three dimensions or as a flat chart,
// and how realms are drawn. Docked at the side, so the map changes in view as the look does.
import { useLayoutEffect, useRef } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { spaceSettingsOf } from '../../world-model/world-settings.ts';
import { SKY_PRESETS, DEFAULT_SKY, presetLook, randomLook, skyLookOf, type SkyLook, type StarColours, type StarShape, type ChartGrid, type NameFont, type RealmStyle } from '../../space/sky-look.ts';
import { SpaceRenderer, type Holding } from '../../space/space-renderer.ts';
import { makeSpaceView, spaceCamera } from '../../space/space-view.ts';
import type { StarCatalogue, Star } from '../../space/catalogue.ts';
import { seeded } from '../../presentation/looks.ts';
import { Slider } from './LabelStyles.tsx';
import { NumberField } from './Panels.tsx';

/** A small patch of sky for the presets' pictures: stars of every kind, and two realms meeting. */
const SAMPLE = (() => {
  const rnd = seeded(31), stars: Star[] = [];
  const kinds = ['M5V', 'M2V', 'M4V', 'K7V', 'K5V', 'K1V', 'G2V', 'F5V', 'A1V', 'B8V'];
  const bright: Record<string, number> = { M: 11, K: 7, G: 4.8, F: 3.2, A: 1.4, B: -0.8 };
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2, r = 10 * Math.sqrt(rnd()), spect = kinds[Math.floor(rnd() * kinds.length)];
    stars.push({ id: i + 1, name: `S${i + 1}`, alt: '', x: r * Math.cos(a), y: r * Math.sin(a), z: (rnd() - 0.5) * 4, dist: r, absmag: bright[spect[0]] + (rnd() - 0.5) * 2, spect, system: 0 });
  }
  stars.push({ id: 0, name: 'Sun', alt: '', x: 0, y: 0, z: 0, dist: 0, absmag: 4.83, spect: 'G2V', system: 0 });
  const cat: StarCatalogue = { radiusLy: 10, stars, byId: new Map(stars.map((s) => [s.id, s])) };
  const holdings = new Map<number, Holding>();
  for (const s of stars) {
    if (s.x < -2.5 && s.y > -7) holdings.set(s.id, { owner: 'a', name: 'A', color: '#4f8cff' });
    else if (s.x > 2.5 && s.y < 7) holdings.set(s.id, { owner: 'b', name: 'B', color: '#ff6b5c' });
  }
  return { cat, holdings, wars: [['a', 'b']] as Array<[string, string]> };
})();

/** A look drawn small, on the sample patch of sky. */
function SkyPicture({ look, w, h }: { look: SkyLook; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = { ...makeSpaceView({ ...spaceCamera(), lat: 32, zoom: 0.3 }, w, h, SAMPLE.cat.radiusLy, look.chart), unit: 0.34 };
    new SpaceRenderer().render(ctx, view, SAMPLE.cat, {
      transparent: false, grid: true, dropLines: true, names: 'none', holdings: SAMPLE.holdings, realmNames: false, wars: SAMPLE.wars,
      look, rings: [{ r: 5, label: '' }, { r: 10, label: '' }], axisLabel: null,
    });
  }, [look, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}

const COLOURINGS: Array<[StarColours, string]> = [['natural', 'Natural (by their light)'], ['vivid', 'Vivid'], ['pastel', 'Pastel'], ['mono', 'One colour'], ['temperature', 'By temperature (two colours)'], ['owner', 'By holder (realms\' colours)']];
const SHAPES: Array<[StarShape, string]> = [['disc', 'Disc'], ['soft', 'Soft blur'], ['dot', 'Small dot'], ['diamond', 'Diamond'], ['sparkle4', 'Four-pointed sparkle'], ['sparkle6', 'Six-pointed sparkle'], ['ring', 'Ring'], ['square', 'Square'], ['cross', 'Cross']];
const GRIDS: Array<[ChartGrid, string]> = [['rings', 'Rings'], ['squares', 'Squares'], ['hexes', 'Hexes (numbered sectors)'], ['none', 'None']];
const FONTS: Array<[NameFont, string]> = [['sans', 'Plain'], ['serif', 'Serif'], ['mono', 'Typewriter'], ['display', 'Rounded']];
const REALMS: Array<[RealmStyle, string]> = [['borders', 'Territories with borders'], ['glow', 'Soft glows round their stars'], ['none', 'Not drawn']];
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function SkyLookDialog() {
  const s = useStore();
  const space = s.world?.get('map_space', s.spaceId);
  const settings = spaceSettingsOf(space);
  const close = () => s.set({ dialog: null });
  if (!space || !settings) return null;
  const look = settings.look ?? DEFAULT_SKY;
  const save = (next: SkyLook, label?: string) => s.execute((w) => cmd.setSkyLook(w, space.id, next, label));
  const set = (patch: Partial<SkyLook>) => save({ ...look, ...patch });
  // (A preset of a look keeps the map flat or not as it is; a chart's preset makes it a chart.)
  const preset = (id: string) => { const p = presetLook(id); save({ ...p, chart: p.chart || look.chart }, `Stars: ${SKY_PRESETS.find((x) => x.id === id)?.name ?? id}`); };
  const looks = SKY_PRESETS.filter((p) => !p.look.chart), charts = SKY_PRESETS.filter((p) => p.look.chart);
  const presetButton = (p: (typeof SKY_PRESETS)[number]) => (
    <button key={p.id} className={`sky-preset ${look.preset === p.id ? 'on' : ''}`} onClick={() => preset(p.id)} title={p.name} data-testid={`sky-preset-${p.id}`}>
      <SkyPicture look={skyLookOf({ ...presetLook(p.id), chart: !!p.look.chart })} w={112} h={64} />
      <span>{p.name.replace(/ \(.*\)$/, '')}</span>
    </button>
  );
  const colour = (label: string, key: 'tint' | 'cool' | 'hot' | 'outlineColour' | 'background' | 'nebulaA' | 'nebulaB' | 'grid' | 'names', title?: string) => (
    <label className="sky-row" title={title}>{label}<input type="color" value={look[key]} onChange={(e) => set({ [key]: e.target.value })} data-testid={`sky-${key}`} /></label>
  );
  const slider = (label: string, key: keyof SkyLook, min: number, max: number, step: number, format: (v: number) => string = pct, title?: string) => (
    <label className="sky-row" title={title}>{label}<Slider value={look[key] as number} min={min} max={max} step={step} onCommit={(v) => set({ [key]: v })} format={format} testId={`sky-${key}`} /></label>
  );
  const choice = <T extends string>(label: string, key: keyof SkyLook, options: Array<[T, string]>, title?: string) => (
    <label className="sky-row" title={title}>{label}<select value={String(look[key])} onChange={(e) => set({ [key]: e.target.value })} data-testid={`sky-${key}`}>
      {options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
    </select></label>
  );
  return (
    <div className="modal-back see-through">
      <div className="modal sky-look" role="dialog" aria-label="How the stars look" data-testid="sky-look-dialog">
        <div className="modal-head"><h2>How the stars look</h2><button className="close" onClick={close} aria-label="Close">×</button></div>
        <p className="muted">Start from a look, then change any part of it. The map shows each change as you make it; shots and exports of this map draw it the same way.</p>
        <h4>Start from</h4>
        <div className="sky-presets">{looks.map(presetButton)}</div>
        <h4>Charts</h4>
        <div className="sky-presets">{charts.map(presetButton)}</div>
        <div className="sky-actions">
          <button onClick={() => save(randomLook(Math.random, look.chart), 'Stars: a look by chance')} data-testid="sky-surprise" title="A look made up by chance: sky, stars, lines and names (again for another)">Surprise me</button>
          {look.preset !== 'natural' && <button onClick={() => preset(SKY_PRESETS.some((p) => p.id === look.preset) ? look.preset : 'natural')} data-testid="sky-reset" title="Back to the look as its preset has it">Back to "{SKY_PRESETS.find((p) => p.id === look.preset)?.name.replace(/ \(.*\)$/, '') ?? 'Natural'}"</button>}
        </div>

        <h4>Seen as</h4>
        <div className="seg sky-seen">
          <button className={!look.chart ? 'on' : ''} onClick={() => set({ chart: false })} data-testid="sky-3d" title="Stars in their places in space, the view turning round them">In three dimensions</button>
          <button className={look.chart ? 'on' : ''} onClick={() => set({ chart: true })} data-testid="sky-chart" title="A flat map seen straight down on the plane: drag to move it, right-drag to turn it">As a flat chart</button>
        </div>
        {look.chart ? <>
          {choice('Grid', 'chartGrid', GRIDS, 'The chart\'s lines: rings round the middle, squares or numbered hexes')}
          {look.chartGrid !== 'rings' && look.chartGrid !== 'none' && (
            <label className="sky-row" title="Light-years between the lines (0: as the rings, every 10 light-years on a map of nearby stars)">Every (light-years)<NumberField value={look.chartSpacing} min={0} max={1e6} step={1} onCommit={(v) => set({ chartSpacing: v })} testId="sky-chartSpacing" /></label>
          )}
          {choice('Heights above the plane', 'heights', [['numbers', 'As numbers (light-years)'], ['symbols', 'As marks (filled: above)'], ['none', 'Not shown']], 'How far above or below the plane each star stands, beside it')}
        </> : (
          <label className="check"><input type="checkbox" checked={look.dropLines} onChange={(e) => set({ dropLines: e.target.checked })} data-testid="sky-dropLines" /> Lines down to the plane</label>
        )}

        <h4>Stars</h4>
        {choice('Colours', 'colours', COLOURINGS)}
        {look.colours === 'mono' && colour('Colour', 'tint')}
        {look.colours === 'owner' && colour('Stars no one holds', 'tint')}
        {look.colours === 'temperature' && <>{colour('Coolest', 'cool')}{colour('Hottest', 'hot')}</>}
        {look.colours !== 'mono' && look.colours !== 'owner' && <>
          {colour('Tinted with', 'tint')}
          {slider('Tint', 'tintAmount', 0, 1, 0.05)}
        </>}
        {choice('Shape', 'shape', SHAPES)}
        {slider('Size', 'size', 0.3, 3, 0.05)}
        {slider('Brighter, larger', 'sizeByBrightness', 0, 1, 0.05, pct, 'How much larger the brighter stars are drawn (0: all alike)')}
        {slider('Glow', 'glow', 0, 4, 0.1, (v) => (v ? v.toFixed(1) : 'none'), 'How far each star\'s glow reaches')}
        {look.glow > 0 && slider('Glow strength', 'glowStrength', 0, 1, 0.05)}
        <label className="sky-row" title="Rays of light from the brighter stars, as telescopes see them">Spikes<select value={look.spikes} onChange={(e) => set({ spikes: Number(e.target.value) })} data-testid="sky-spikes">
          {[0, 2, 4, 6, 8].map((n) => <option key={n} value={n}>{n ? `${n} spikes` : 'None'}</option>)}
        </select></label>
        {look.spikes > 0 && <>
          {slider('Spike length', 'spikeLength', 0.2, 4, 0.1, (v) => v.toFixed(1))}
          {slider('Spikes turned', 'spikeAngle', -90, 90, 5, (v) => `${v}°`)}
        </>}
        {slider('Halo', 'halo', 0, 1, 0.05, (v) => (v ? pct(v) : 'none'), 'A thin ring round the brighter stars')}
        {slider('Outline', 'outline', 0, 4, 0.1, (v) => (v ? v.toFixed(1) : 'none'), 'An edge round each star, as on a printed chart')}
        {look.outline > 0 && colour('Outline colour', 'outlineColour')}
        {slider('Twinkle (in shots)', 'twinkle', 0, 1, 0.05, (v) => (v ? pct(v) : 'none'), 'Stars flicker, each at its own pace, as a shot plays and in its exports')}

        <h4>Sky</h4>
        {colour('Background', 'background')}
        <label className="check sky-row-check"><input type="checkbox" checked={!!look.backgroundGlow} onChange={(e) => set({ backgroundGlow: e.target.checked ? '#1a1430' : null })} data-testid="sky-glow-middle" /> A glow toward the middle
          {look.backgroundGlow && <input type="color" value={look.backgroundGlow} onChange={(e) => set({ backgroundGlow: e.target.value })} data-testid="sky-backgroundGlow" />}</label>
        {slider('Nebulae', 'nebula', 0, 1, 0.05, (v) => (v ? pct(v) : 'none'), 'Soft clouds of colour across the sky (they turn with the view)')}
        {look.nebula > 0 && <>{colour('Nebula colour', 'nebulaA')}{colour('Second colour', 'nebulaB')}</>}
        {slider('Far stars', 'farStars', 0, 2, 0.1, (v) => (v ? pct(v) : 'none'), 'The faint stars far beyond the map')}

        <h4>Lines and names</h4>
        {colour('Lines', 'grid')}
        {slider('Lines\' strength', 'gridOpacity', 0, 1, 0.02)}
        {colour('Names', 'names')}
        {choice('Lettering', 'nameFont', FONTS)}

        <h4>Realms</h4>
        {choice('Drawn as', 'realms', REALMS, 'How the stars countries and factions hold are shown')}
        {look.realms !== 'none' && <>
          {slider('Fill', 'realmFill', 0, 1, 0.02)}
          {look.realms === 'borders' && slider('Border', 'realmBorder', 0, 8, 0.1, (v) => (v ? v.toFixed(1) : 'none'))}
          {look.realms === 'borders' && slider('Glow along the edges', 'realmGlow', 0, 2, 0.05, (v) => (v ? v.toFixed(2) : 'none'))}
        </>}
        {look.realms === 'borders' && <p className="muted small">Each held star reaches out round it; where realms meet, the border runs between their stars, and where two at war meet it is drawn as a front. A star changing hands is won over gradually in shots.</p>}
        <div className="modal-actions"><button className="primary" onClick={close} data-testid="sky-close">Close</button></div>
      </div>
    </div>
  );
}
