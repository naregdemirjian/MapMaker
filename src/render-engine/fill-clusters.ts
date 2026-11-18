// How a picture (a flag) is laid over a country made of several pieces (fifth feedback round, D82):
// the pieces are gathered into clusters and each cluster gets its own copy of the picture, placed by
// the cluster's box. Mainland France and Corsica share a flag; French Guiana and Réunion have their
// own; the Canary Islands share one, apart from Spain's. Boxes and gaps are worked out on the sphere
// with longitudes taken the short way round, so Russia (across the 180th meridian) has one box.

/** A piece's box: west, south, east, north in degrees (east may exceed 180, the box running past it). */
export type GeoBox = [number, number, number, number];

/**
 * How pieces share a picture. auto: pieces close together share one (within about 110 km of each
 * other, or nearer than a sixth or so of the larger one's extent); whole: one picture over everything;
 * each: a picture for every piece; near: pieces closer than `gapKm` share one.
 */
export type FillPieces = 'auto' | 'whole' | 'each' | 'near';
export interface FillRule { pieces?: FillPieces; gapKm?: number }

const KM_PER_DEG = 111.195;
/** Pieces nearer than this always share a picture in 'auto' (an archipelago's islands). */
const AUTO_GAP_DEG = 1;
/** In 'auto', pieces also share a picture when the gap is at most this part of the larger one's extent. */
const AUTO_REL = 0.15;

const mid = (b: GeoBox) => (b[0] + b[2]) / 2;

/** b moved by whole turns so its middle is within half a turn of `ref`. */
function near(b: GeoBox, ref: number): GeoBox {
  const k = Math.round((ref - mid(b)) / 360) * 360;
  return k ? [b[0] + k, b[1], b[2] + k, b[3]] : b;
}

/** The box around two boxes, the short way round (the first box's longitudes kept). */
export function joinBoxes(a: GeoBox, b: GeoBox): GeoBox {
  const c = near(b, mid(a));
  const w = Math.min(a[0], c[0]), e = Math.max(a[2], c[2]);
  // A box all the way round: the whole circle.
  return e - w >= 360 ? [-180, Math.min(a[1], c[1]), 180, Math.max(a[3], c[3])] : [w, Math.min(a[1], c[1]), e, Math.max(a[3], c[3])];
}

/** Area-like size of a box: degrees of longitude shrunk by the cosine of its middle latitude, times degrees of latitude. */
function boxArea(b: GeoBox): number {
  const k = Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180);
  return Math.max(1e-6, (b[2] - b[0]) * k) * Math.max(1e-6, b[3] - b[1]);
}

/** The gap between two boxes, in degrees of a great circle (roughly), the short way round. */
export function boxGap(a: GeoBox, b: GeoBox): number {
  const c = near(b, mid(a));
  const dLon = Math.max(0, Math.max(a[0], c[0]) - Math.min(a[2], c[2]));
  const dLat = Math.max(0, Math.max(a[1], c[1]) - Math.min(a[3], c[3]));
  // Longitudes are measured at the latitude nearest the equator in the band where the two meet (or the gap between them).
  const p = Math.max(a[1], c[1]), q = Math.min(a[3], c[3]);
  const lo = Math.min(p, q), hi = Math.max(p, q);
  const lat = lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi));
  const k = Math.cos(Math.min(89, lat) * Math.PI / 180);
  return Math.hypot(dLon * k, dLat);
}

/** A piece counts towards where a cluster's picture is placed when it is at least this part of the cluster's largest piece. */
const CORE_SHARE = 0.05;

/**
 * Pieces (their boxes and areas) gathered into clusters by the rule: each cluster lists the pieces
 * in it, largest first, the box around them, and its core: the box around its pieces of some size,
 * which the picture is placed by (Russia's flag by its mainland, not stretched to the Arctic islands;
 * the picture still covers the rest). Clusters come largest first.
 */
export function clusterPieces(pieces: ReadonlyArray<{ box: GeoBox; area: number }>, rule: FillRule = {}): Array<{ members: number[]; box: GeoBox; core: GeoBox }> {
  return gather(pieces, rule).map((c) => {
    const big = pieces[c.members[0]].area;
    let core = pieces[c.members[0]].box;
    for (const m of c.members.slice(1)) if (pieces[m].area >= CORE_SHARE * big) core = joinBoxes(core, pieces[m].box);
    return { ...c, core };
  });
}

function gather(pieces: ReadonlyArray<{ box: GeoBox; area: number }>, rule: FillRule): Array<{ members: number[]; box: GeoBox }> {
  const mode = rule.pieces ?? 'auto';
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[b].area - pieces[a].area);
  if (!order.length) return [];
  if (mode === 'whole') {
    let box = pieces[order[0]].box;
    for (const i of order.slice(1)) box = joinBoxes(box, pieces[i].box);
    return [{ members: order, box }];
  }
  if (mode === 'each') return order.map((i) => ({ members: [i], box: pieces[i].box }));
  const gapDeg = mode === 'near' ? Math.max(0, rule.gapKm ?? 500) / KM_PER_DEG : AUTO_GAP_DEG;
  // The gap between two clusters: between their nearest pieces (a chain of islands reaching out from
  // one does not bring its box near the other). The extent compared with it: the larger cluster's box.
  type Cluster = { members: number[]; box: GeoBox };
  const gapBetween = (a: Cluster, b: Cluster) => {
    let g = Infinity;
    for (const i of a.members) for (const j of b.members) { const d = boxGap(pieces[i].box, pieces[j].box); if (d < g) g = d; if (g === 0) return 0; }
    return g;
  };
  const joins = (a: Cluster, b: Cluster) => {
    const gap = gapBetween(a, b);
    if (gap <= gapDeg) return true;
    return mode === 'auto' && gap <= AUTO_REL * Math.sqrt(Math.max(boxArea(a.box), boxArea(b.box)));
  };
  // Largest first: each piece joins the first cluster it belongs with; then clusters that have
  // come to belong together are joined (until nothing changes).
  let clusters: Cluster[] = [];
  for (const i of order) {
    const one: Cluster = { members: [i], box: pieces[i].box };
    const c = clusters.find((k) => joins(k, one));
    if (c) { c.members.push(i); c.box = joinBoxes(c.box, pieces[i].box); }
    else clusters.push(one);
  }
  for (let again = true; again;) {
    again = false;
    outer: for (let a = 0; a < clusters.length; a++) for (let b = a + 1; b < clusters.length; b++) {
      if (!joins(clusters[a], clusters[b])) continue;
      clusters[a] = { members: [...clusters[a].members, ...clusters[b].members], box: joinBoxes(clusters[a].box, clusters[b].box) };
      clusters = clusters.filter((_, i) => i !== b);
      again = true;
      break outer;
    }
  }
  // (Each cluster's members largest first.)
  for (const c of clusters) c.members.sort((a, b) => pieces[b].area - pieces[a].area);
  return clusters;
}

/**
 * The scales to draw a picture of size iw × ih with, filling a box w × h: 'cover' crops, 'contain'
 * fits inside, 'stretch' distorts, and 'fill' covers but may stretch the picture up to `maxStretch`
 * times one way rather than crop it, so a flag's stripes stay in view on a long country (Russia).
 */
export function fitScales(iw: number, ih: number, w: number, h: number, fit: 'cover' | 'contain' | 'stretch' | 'fill', maxStretch = 2): [number, number] {
  const sx = w / iw, sy = h / ih;
  if (fit === 'stretch') return [sx, sy];
  if (fit === 'contain') { const s = Math.min(sx, sy); return [s, s]; }
  if (fit === 'cover') { const s = Math.max(sx, sy); return [s, s]; }
  // fill: each way covered; the shorter way stretched at most maxStretch times beyond the other's scale.
  if (sx >= sy) return [sx, Math.max(sy, sx / maxStretch)];
  return [Math.max(sx, sy / maxStretch), sy];
}
