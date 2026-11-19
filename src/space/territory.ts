// Realms as territories on space maps (D132). Every star a country or faction holds reaches out round it
// (its reach in pixels on the picture), most strongly at the star and fading to nothing a little beyond
// its reach; the reaches of one realm's stars add up, so stars near each other merge into one smooth
// space and a lone star holds a round one. A place belongs to the realm reaching it most strongly, when
// that is strong enough; where two realms reach it, the border runs between them; beyond every reach is
// free space. Worked out on a grid over the picture: who holds each cell, then where exactly each border
// crosses between two cells (from how strongly each side is reached), then how far every cell near the
// realms is from the nearest border (a distance transform within each realm's space and within free
// space). From these: the territory's fill with a glow along its edges (a picture of the cells), the
// border lines (traced through the crossings as lines, so that they are sharp at any size), and where
// each realm's name goes.

/**
 * A held star on the picture: where, how far it reaches (pixels), and who holds it (an index into the
 * owners; -1: nobody). While it changes hands (`grow` below 1, shots), the new holder's space grows out
 * from the star over the old one's (`from`); a star given up to nobody: its old holder's space shrinks
 * back to it.
 */
export interface TerritorySite { x: number; y: number; r: number; owner: number; from?: number; grow?: number }

export interface TerritoryField {
  cols: number; rows: number; cell: number;
  /** The realm holding each cell (index into the owners), or -1. */
  owner: Int16Array;
  /** Across the nearest border: for a held cell, the realm on the other side (-1: free space); for a free cell, the realm whose edge is nearest (-1: none). */
  other: Int16Array;
  /** How far the cell's middle is from the nearest border (pixels): inside a realm positive, in free space negative (-Infinity: far from any). */
  edge: Float32Array;
  /** Where a border crosses from each cell to the next one right (x), and to the next one down (y); NaN where none does. */
  crossH: Float32Array; crossV: Float32Array;
}

/** How far a star's reach fades out, as a share of its reach. */
const SUPPORT = 1.4;
/** How strongly a place must be reached to be held. A lone star holds a disc of about its reach. */
const THRESHOLD = 0.25;

/** The territory field of a picture W x H pixels, in cells of `cell` pixels. */
export function territoryField(W: number, H: number, cell: number, sites: TerritorySite[], owners = maxOwner(sites) + 1): TerritoryField {
  const cols = Math.max(1, Math.ceil(W / cell)), rows = Math.max(1, Math.ceil(H / cell)), n = cols * rows;
  const owner = new Int16Array(n).fill(-1), other = new Int16Array(n).fill(-1);
  const edge = new Float32Array(n).fill(-Infinity);
  const crossH = new Float32Array(n).fill(NaN), crossV = new Float32Array(n).fill(NaN);
  // How much more strongly the holder reaches the cell than the next realm or than is needed (free cells: how much less than is needed).
  const margin = new Float32Array(n).fill(-THRESHOLD);
  const field: TerritoryField = { cols, rows, cell, owner, other, edge, crossH, crossV };
  // The sites by the squares of a coarse grid their reach overlaps; each square's cells look only at its sites.
  const B = 16, bc = Math.ceil(cols / B), br = Math.ceil(rows / B);
  const buckets: number[][] = Array.from({ length: bc * br }, () => []);
  sites.forEach((s, i) => {
    if (!(s.r > 0) || (s.owner < 0 && (s.from ?? -1) < 0)) return;
    const R = s.r * SUPPORT;
    const c0 = Math.max(0, Math.floor((s.x - R) / cell / B)), c1 = Math.min(bc - 1, Math.floor((s.x + R) / cell / B));
    const r0 = Math.max(0, Math.floor((s.y - R) / cell / B)), r1 = Math.min(br - 1, Math.floor((s.y + R) / cell / B));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * bc + c].push(i);
  });
  const acc = new Float32Array(Math.max(1, owners)), touched = new Int32Array(Math.max(1, owners));
  let minC = cols, maxC = -1, minR = rows, maxR = -1;
  for (let bj = 0; bj < br; bj++) for (let bi = 0; bi < bc; bi++) {
    const list = buckets[bj * bc + bi];
    if (!list.length) continue;
    const m = list.length, sx = new Float64Array(m), sy = new Float64Array(m), sR = new Float64Array(m), so = new Int16Array(m), sf = new Int16Array(m), sg = new Float64Array(m);
    list.forEach((i, k) => { const s = sites[i]; sx[k] = s.x; sy[k] = s.y; sR[k] = s.r * SUPPORT; so[k] = s.owner; sf[k] = s.from ?? -1; sg[k] = s.grow ?? 1; });
    const rEnd = Math.min(rows, (bj + 1) * B), cEnd = Math.min(cols, (bi + 1) * B);
    for (let row = bj * B; row < rEnd; row++) {
      const y = (row + 0.5) * cell;
      for (let col = bi * B; col < cEnd; col++) {
        const x = (col + 0.5) * cell;
        let nt = 0;
        for (let k = 0; k < m; k++) {
          const R = sR[k], dx = x - sx[k], dy = y - sy[k], d2 = dx * dx + dy * dy;
          if (d2 >= R * R) continue;
          // Whose this reach is here: the holder's, or (changing hands) the new holder's inside a growing
          // disc and the old one's beyond it; a star given up: the old holder's inside a shrinking disc.
          let o = so[k];
          const g = sg[k];
          if (g < 1) {
            const d = Math.sqrt(d2);
            if (o >= 0) { if (d >= g * R) o = sf[k]; } else o = d < (1 - g) * R ? sf[k] : -1;
          }
          if (o < 0) continue;
          const q2 = d2 / (R * R), w = (1 - q2) * (1 - q2);
          if (acc[o] === 0) touched[nt++] = o;
          acc[o] += w;
        }
        if (!nt) continue;
        let f1 = 0, o1 = -1, f2 = 0;
        for (let k = 0; k < nt; k++) {
          const o = touched[k], f = acc[o];
          acc[o] = 0;
          if (f > f1) { f2 = f1; f1 = f; o1 = o; } else if (f > f2) f2 = f;
        }
        const at = row * cols + col;
        if (f1 >= THRESHOLD) {
          owner[at] = o1; margin[at] = f1 - Math.max(f2, THRESHOLD);
          if (col < minC) minC = col; if (col > maxC) maxC = col; if (row < minR) minR = row; if (row > maxR) maxR = row;
        } else margin[at] = f1 - THRESHOLD;
      }
    }
  }
  if (maxC < 0) return field;
  // Only the realms and a little round them matter from here on.
  const c0 = Math.max(0, minC - 2), c1 = Math.min(cols - 1, maxC + 2), r0 = Math.max(0, minR - 2), r1 = Math.min(rows - 1, maxR + 2);
  // Where each border crosses between two neighbouring cells of different realms (or a realm and free space):
  // as far from each as how strongly it is held there says. Each cell starts from the nearest crossing by it.
  const px = new Float32Array(n), py = new Float32Array(n), dist = new Float32Array(n).fill(Infinity);
  const seed = (a: number, x: number, y: number, across: number) => {
    const ax = ((a % cols) + 0.5) * cell, ay = (Math.floor(a / cols) + 0.5) * cell, d = Math.hypot(x - ax, y - ay);
    if (d < dist[a]) { dist[a] = d; px[a] = x; py[a] = y; other[a] = across; }
  };
  const share = (a: number, b: number) => { const ma = Math.abs(margin[a]), mb = Math.abs(margin[b]); return ma + mb > 0 ? Math.min(1, Math.max(0, ma / (ma + mb))) : 0.5; };
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    const a = row * cols + col, oa = owner[a];
    if (col + 1 < cols && owner[a + 1] !== oa) {
      const x = (col + 0.5 + share(a, a + 1)) * cell, y = (row + 0.5) * cell;
      crossH[a] = x; seed(a, x, y, owner[a + 1]); seed(a + 1, x, y, oa);
    }
    if (row + 1 < rows && owner[a + cols] !== oa) {
      const x = (col + 0.5) * cell, y = (row + 0.5 + share(a, a + cols)) * cell;
      crossV[a] = y; seed(a, x, y, owner[a + cols]); seed(a + cols, x, y, oa);
    }
  }
  // The nearest crossing carried on through the cells of the same realm (or of free space, only a little way
  // out: free space needs no more than its edge smoothed): two passes, each cell taking a neighbour's
  // nearest crossing when nearer than its own.
  const freeCap = cell * 2.5, diag = cell * Math.SQRT2;
  // (Neighbour b offers its crossing to cell a, `step` away: taken when nearer than a's own.)
  const offer = (a: number, b: number, step: number, ax: number, ay: number, oa: number) => {
    if (owner[b] !== oa || dist[b] - step >= dist[a]) return;
    const ex = px[b] - ax, ey = py[b] - ay, d = Math.sqrt(ex * ex + ey * ey);
    if (d < dist[a] && (oa >= 0 || d <= freeCap)) { dist[a] = d; px[a] = px[b]; py[a] = py[b]; other[a] = other[b]; }
  };
  for (let row = r0; row <= r1; row++) {
    const ay = (row + 0.5) * cell;
    for (let col = c0; col <= c1; col++) {
      const a = row * cols + col, oa = owner[a], ax = (col + 0.5) * cell;
      if (col > c0) offer(a, a - 1, cell, ax, ay, oa);
      if (row > r0) {
        const b = a - cols;
        if (col > c0) offer(a, b - 1, diag, ax, ay, oa);
        offer(a, b, cell, ax, ay, oa);
        if (col < c1) offer(a, b + 1, diag, ax, ay, oa);
      }
    }
  }
  for (let row = r1; row >= r0; row--) {
    const ay = (row + 0.5) * cell;
    for (let col = c1; col >= c0; col--) {
      const a = row * cols + col, oa = owner[a], ax = (col + 0.5) * cell;
      if (col < c1) offer(a, a + 1, cell, ax, ay, oa);
      if (row < r1) {
        const b = a + cols;
        if (col < c1) offer(a, b + 1, diag, ax, ay, oa);
        offer(a, b, cell, ax, ay, oa);
        if (col > c0) offer(a, b - 1, diag, ax, ay, oa);
      }
    }
  }
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
    const a = row * cols + col;
    edge[a] = owner[a] >= 0 ? dist[a] : -dist[a];
  }
  return field;
}

function maxOwner(sites: TerritorySite[]): number {
  let m = -1;
  for (const s of sites) m = Math.max(m, s.owner, s.from ?? -1);
  return m;
}

export interface TerritoryPaint {
  colours: Array<[number, number, number]>;
  /** How strongly space is filled (0 to 1) and how much it glows along its edges. */
  fill: number; glow: number;
  /** Pixels per design pixel (the glow's width grows with it). */
  unit: number;
}

/** The territory's fill as a picture of the field's cells (RGBA, straight alpha), to be drawn scaled up over the map; its edges smoothed. */
export function paintTerritory(f: TerritoryField, p: TerritoryPaint): ImageData {
  const img = new ImageData(f.cols, f.rows);
  const d = img.data, cell = f.cell, glowWidth = 9 * p.unit;
  for (let k = 0; k < f.owner.length; k++) {
    const held = f.owner[k] >= 0, o = held ? f.owner[k] : f.other[k], e = f.edge[k];
    if (o < 0 || e < -cell) continue;
    const cover = Math.max(0, Math.min(1, 0.5 + e / cell));
    const a = cover * (p.fill + p.glow * 0.35 * Math.exp(-Math.max(0, e) / glowWidth));
    if (a <= 0) continue;
    const [r, g, b] = p.colours[o], i = k * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.round(Math.min(1, a) * 255);
  }
  return img;
}

/**
 * The border lines: for each pair of sides (a realm, and the realm or free space (-1) beyond it), line
 * pieces (x0, y0, x1, y1 in turn, pixels) through the crossings. In each square of four neighbouring
 * cells a border passes straight through, or, where three or four sides meet, every crossing joins
 * the square's middle.
 */
export function territoryBorders(f: TerritoryField): Array<{ a: number; b: number; segs: number[] }> {
  const { cols, rows, cell, owner, crossH, crossV } = f;
  const out = new Map<number, { a: number; b: number; segs: number[] }>();
  const add = (p: number, q: number, x0: number, y0: number, x1: number, y1: number) => {
    const a = Math.max(p, q), b = Math.min(p, q), key = (a + 1) * 65536 + (b + 1);
    let e = out.get(key);
    if (!e) out.set(key, (e = { a, b, segs: [] }));
    e.segs.push(x0, y0, x1, y1);
  };
  const xs = [0, 0, 0, 0], ys = [0, 0, 0, 0], ps = [0, 0, 0, 0], qs = [0, 0, 0, 0];
  for (let r = 0; r + 1 < rows; r++) for (let c = 0; c + 1 < cols; c++) {
    const i00 = r * cols + c, i10 = i00 + 1, i01 = i00 + cols, i11 = i01 + 1;
    const o00 = owner[i00], o10 = owner[i10], o01 = owner[i01], o11 = owner[i11];
    if (o00 === o10 && o00 === o01 && o00 === o11) continue;
    let k = 0;
    const put = (x: number, y: number, p: number, q: number) => { xs[k] = x; ys[k] = y; ps[k] = p; qs[k] = q; k++; };
    if (o00 !== o10) put(crossH[i00], (r + 0.5) * cell, o00, o10);
    if (o01 !== o11) put(crossH[i01], (r + 1.5) * cell, o01, o11);
    if (o00 !== o01) put((c + 0.5) * cell, crossV[i00], o00, o01);
    if (o10 !== o11) put((c + 1.5) * cell, crossV[i10], o10, o11);
    if (k === 2) { add(ps[0], qs[0], xs[0], ys[0], xs[1], ys[1]); continue; }
    let mx = 0, my = 0;
    for (let i = 0; i < k; i++) { mx += xs[i] / k; my += ys[i] / k; }
    for (let i = 0; i < k; i++) add(ps[i], qs[i], xs[i], ys[i], mx, my);
  }
  return [...out.values()];
}

/** Where each realm's name goes: the place of its largest space farthest from its edges, with how roomy that is and how many cells it holds. */
export function realmLabels(f: TerritoryField, owners: number): Array<{ x: number; y: number; room: number; cells: number } | null> {
  const best: Array<{ x: number; y: number; room: number; cells: number } | null> = Array.from({ length: owners }, () => null);
  const count = new Int32Array(owners);
  for (let k = 0; k < f.owner.length; k++) {
    const o = f.owner[k];
    if (o < 0) continue;
    count[o]++;
    const room = f.edge[k];
    if (!best[o] || room > best[o]!.room) best[o] = { x: ((k % f.cols) + 0.5) * f.cell, y: (Math.floor(k / f.cols) + 0.5) * f.cell, room, cells: 0 };
  }
  best.forEach((b, o) => { if (b) b.cells = count[o]; });
  return best;
}
