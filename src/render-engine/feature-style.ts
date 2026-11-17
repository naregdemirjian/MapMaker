// How areas, lines and points on feature layers look (Stage 4): the defaults of each kind, the
// layer's style, then the feature's own. Read by the renderer and the interface; kept apart from the
// data, so that changing a look never touches history.

/** The kinds of feature layer: what each holds. */
export type FeatureKind = 'area' | 'line' | 'point';
export const FEATURE_KINDS: FeatureKind[] = ['area', 'line', 'point'];
export const isFeatureKind = (k: string): k is FeatureKind => k === 'area' || k === 'line' || k === 'point';

/**
 * How an area, line or point looks. A layer's style gives the look of all its features; a feature's
 * own style overrides it. `color` unset: the colour of the country or faction it belongs to, if any,
 * else the layer's.
 */
export interface FeatureStyle {
  color?: string;
  /** Areas: how opaque the fill is (0: outline only), and a pattern over it. */
  fillOpacity?: number;
  hatch?: 'none' | 'diagonal' | 'cross' | 'dots';
  /** Areas and lines: the width of the line (design pixels at 1920 wide) and its pattern. */
  width?: number;
  dash?: 'solid' | 'dashed' | 'dotted';
  /** Lines: teeth along the line (a front line: they point the way it faces), arrowheads. */
  teeth?: 'none' | 'left' | 'right';
  arrow?: 'none' | 'end' | 'both';
  /** Points: the symbol and its size (design pixels). */
  symbol?: 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'cross' | 'battle';
  size?: number;
  /** Whether the name is written on the map. */
  showName?: boolean;
}

export const DEFAULT_FEATURE_STYLE: Record<FeatureKind, FeatureStyle> = {
  area: { color: '#e0a030', fillOpacity: 0.25, hatch: 'none', width: 2, dash: 'dashed', showName: true },
  line: { color: '#e04848', width: 3, dash: 'solid', teeth: 'none', arrow: 'none', showName: false },
  point: { color: '#f2d06b', symbol: 'circle', size: 9, showName: true },
};

/** A feature's look: the defaults of its kind, its layer's style, then its own. */
export function featureStyle(kind: FeatureKind, layerStyle: string | undefined, own: string | undefined): FeatureStyle {
  const pick = (text: string | undefined) => {
    let o: Record<string, unknown> = {};
    try { o = text ? (JSON.parse(text) as Record<string, unknown>) ?? {} : {}; } catch { o = {}; }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(DEFAULT_FEATURE_STYLE.area).concat(Object.keys(DEFAULT_FEATURE_STYLE.line), Object.keys(DEFAULT_FEATURE_STYLE.point))) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
    return out as FeatureStyle;
  };
  return { ...DEFAULT_FEATURE_STYLE[kind], ...pick(layerStyle), ...pick(own) };
}

/**
 * The colour a feature is drawn in: its own, else that of the country or faction it belongs to,
 * else its layer's, else the default of its kind.
 */
export function featureColor(kind: FeatureKind, layerStyle: string | undefined, own: string | undefined, entityColor: string | null | undefined): string {
  const read = (text: string | undefined): string | undefined => {
    try { const c = text ? (JSON.parse(text) as { color?: unknown })?.color : undefined; return typeof c === 'string' && c ? c : undefined; } catch { return undefined; }
  };
  return read(own) ?? (entityColor || undefined) ?? read(layerStyle) ?? DEFAULT_FEATURE_STYLE[kind].color ?? '#e0a030';
}
