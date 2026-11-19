// Where water runs on the mesh (Stage 14.4, D155). Every land cell drains to one neighbour; depressions are filled
// on the way (Priority-Flood, Barnes, Lehman and Mulla 2014): flooding the surface from its outlets upwards, each
// cell is reached first from its lowest neighbour on the filled surface, which becomes the cell it drains to. So
// water always finds a way to an outlet (the sea, or the lowest point of a closed basin on a world without one),
// crossing depressions at their sills, and the order cells are reached in puts every cell after the one it drains
// to (an order for solving downstream first; reversed, for summing what flows from upstream).
import type { Mesh } from '../mesh/icosphere.ts';

export interface Drainage {
  /** Per cell: the cell it drains to (itself for an outlet), and the distance to it (km). */
  receiver: Int32Array;
  length: Float64Array;
  /** Cells from the outlets upwards: each after the cell it drains to. */
  order: Int32Array;
  /** The surface with its depressions filled to their sills (km). */
  filled: Float64Array;
  /** Per cell: 1 for an outlet (sea, or a closed basin's lowest point). */
  outlet: Uint8Array;
}

/**
 * Drainage of a surface (heights in km). `sea` marks the cells that are outlets (under the sea); when there are
 * none, the lowest cell is the outlet of all the world's water.
 */
export function drainage(mesh: Mesh, z: ArrayLike<number>, sea: ArrayLike<number> | null, radiusKm: number): Drainage {
  const { n, nbrStart, nbr, edgeDist } = mesh;
  const receiver = new Int32Array(n).fill(-1), length = new Float64Array(n), order = new Int32Array(n);
  const filled = new Float64Array(n), outlet = new Uint8Array(n), done = new Uint8Array(n);
  // A binary heap of cells by filled height (ties by cell index, so the result never depends on the heap's order).
  const hk: number[] = [], hc: number[] = [];
  const push = (k: number, c: number) => {
    let i = hk.length;
    hk.push(k); hc.push(c);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] < k || (hk[p] === k && hc[p] < c)) break;
      hk[i] = hk[p]; hc[i] = hc[p]; i = p;
    }
    hk[i] = k; hc[i] = c;
  };
  const pop = (): number => {
    const top = hc[0], k = hk.pop()!, c = hc.pop()!;
    const m = hk.length;
    if (m) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let j = i, jk = k, jc = c;
        if (a < m && (hk[a] < jk || (hk[a] === jk && hc[a] < jc))) { j = a; jk = hk[a]; jc = hc[a]; }
        if (b < m && (hk[b] < jk || (hk[b] === jk && hc[b] < jc))) { j = b; }
        if (j === i) break;
        hk[i] = hk[j]; hc[i] = hc[j]; i = j;
      }
      hk[i] = k; hc[i] = c;
    }
    return top;
  };
  let any = false;
  if (sea) for (let c = 0; c < n; c++) if (sea[c]) { any = true; outlet[c] = 1; filled[c] = z[c]; receiver[c] = c; push(z[c], c); }
  if (!any) {
    let low = 0;
    for (let c = 1; c < n; c++) if (z[c] < z[low]) low = c;
    outlet[low] = 1; filled[low] = z[low]; receiver[low] = low; push(z[low], low);
  }
  // Flat or filled ground still drains: a tiny rise per cell keeps the way out downhill.
  const eps = 1e-7;
  let k = 0;
  while (hk.length) {
    const c = pop();
    if (done[c]) continue;
    done[c] = 1;
    order[k++] = c;
    for (let e = nbrStart[c]; e < nbrStart[c + 1]; e++) {
      const j = nbr[e];
      if (receiver[j] >= 0) continue;
      receiver[j] = c;
      length[j] = edgeDist[e] * radiusKm;
      filled[j] = Math.max(z[j], filled[c] + eps);
      push(filled[j], j);
    }
  }
  return { receiver, length, order, filled, outlet };
}

/** What flows through each cell: its own share plus everything upstream (e.g. area × rain), summed in reverse order. */
export function accumulate(d: Drainage, own: ArrayLike<number>): Float64Array {
  const n = d.order.length, acc = new Float64Array(n);
  for (let i = 0; i < n; i++) acc[i] = own[i];
  for (let k = n - 1; k >= 0; k--) {
    const c = d.order[k], r = d.receiver[c];
    if (r !== c) acc[r] += acc[c];
  }
  return acc;
}
