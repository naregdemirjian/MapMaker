/**
 * Settings for the working view only: how the map is drawn on screen while editing and previewing.
 * They belong to this computer (kept in the browser's storage, never in the project) and never touch
 * an export, which always draws every frame afresh at its own, finest quality. None of them limits
 * what can be made: they only trade how sharp the screen is while working for speed.
 */

export interface ViewSettings {
  /** Canvas pixels per screen pixel, as a share of the screen's own (1: as sharp as the screen). */
  resolution: number;
  /** How closely shapes follow their true outline on screen. */
  detail: 'fine' | 'normal' | 'coarse';
  /** While the map moves: move the picture already drawn along (sharpened when it stops), or draw everything again each time. */
  whileMoving: 'carry' | 'redraw';
  /** Country names while the map moves: placed afresh each time, kept where they were on the map, or hidden. */
  names: 'place' | 'hold' | 'hide';
  /** The most detailed coastlines close up, or the medium ones at every zoom. */
  coast: 'full' | 'medium';
  /** Show how long the last frame took to draw. */
  showSpeed: boolean;
}

export type PresetName = 'best' | 'balanced' | 'fastest';

export const PRESETS: Record<PresetName, { name: string; about: string; settings: Omit<ViewSettings, 'showSpeed'> }> = {
  best: {
    name: 'Best looking',
    about: 'Everything is drawn again, at full sharpness, for every movement. For fast computers or small projects.',
    settings: { resolution: 1, detail: 'fine', whileMoving: 'redraw', names: 'place', coast: 'full' },
  },
  balanced: {
    name: 'Balanced',
    about: 'Full sharpness when the map is still; while it moves, the picture is moved along and sharpened when it stops.',
    settings: { resolution: 1, detail: 'normal', whileMoving: 'carry', names: 'hold', coast: 'full' },
  },
  fastest: {
    name: 'Fastest',
    about: 'For large projects on slower computers: a slightly softer picture, simpler outlines and coasts, names hidden while the map moves.',
    settings: { resolution: 0.75, detail: 'coarse', whileMoving: 'carry', names: 'hide', coast: 'medium' },
  },
};

export const DEFAULT_VIEW_SETTINGS: ViewSettings = { ...PRESETS.balanced.settings, showSpeed: false };

/** Pixels a drawn outline may stray from the true one, for each level of detail. */
export const DETAIL_TOLERANCE: Record<ViewSettings['detail'], number> = { fine: 0.2, normal: 0.35, coarse: 0.8 };

/** The preset these settings are, or null when they were chosen one by one. */
export function presetOf(v: ViewSettings): PresetName | null {
  for (const name of Object.keys(PRESETS) as PresetName[]) {
    const p = PRESETS[name].settings;
    if (p.resolution === v.resolution && p.detail === v.detail && p.whileMoving === v.whileMoving && p.names === v.names && p.coast === v.coast) return name;
  }
  return null;
}

const KEY = 'mapmaker.viewSettings';

/** Whatever was stored, made valid (unknown values fall back to the defaults). */
export function cleanViewSettings(raw: unknown): ViewSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ViewSettings, unknown>>;
  const d = DEFAULT_VIEW_SETTINGS;
  const one = <T,>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  return {
    resolution: one(r.resolution, [1, 0.75, 0.5] as const, d.resolution),
    detail: one(r.detail, ['fine', 'normal', 'coarse'] as const, d.detail),
    whileMoving: one(r.whileMoving, ['carry', 'redraw'] as const, d.whileMoving),
    names: one(r.names, ['place', 'hold', 'hide'] as const, d.names),
    coast: one(r.coast, ['full', 'medium'] as const, d.coast),
    showSpeed: r.showSpeed === true,
  };
}

export function loadViewSettings(): ViewSettings {
  try { return cleanViewSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return { ...DEFAULT_VIEW_SETTINGS }; }
}

export function saveViewSettings(v: ViewSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage may be unavailable */ }
}
