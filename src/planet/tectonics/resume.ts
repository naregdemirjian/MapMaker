// A history's checkpoints kept with it, compactly (Stage 15.1, D163), so a history with edits can be run again from
// the last checkpoint before the earliest edit instead of from its beginning. Each plate keeps only the cells of its
// own frame that it holds (with their crust), the world its per-cell state, and everything else that decides the next
// step: the random generator, the events and which have begun, the plumes, the welds, the moment's climate. Decoded,
// a checkpoint continues exactly as the history did (the tests compare every picture's bytes).
import { meshAt } from '../mesh/icosphere.ts';
import { newPlate } from './plates.ts';
import type { TectonicEvent, TectonicParams, TectonicState } from './state.ts';

/** A checkpoint as plain data (typed arrays, numbers, arrays and objects): what a product can carry. */
export type Packed = { [k: string]: unknown };

export function packState(s: TectonicState): Packed {
  const n = s.mesh.n;
  const plates = s.plates.map((p) => {
    let k = 0;
    for (let r = 0; r < n; r++) if (p.member[r]) k++;
    const cells = new Int32Array(k), kind = new Uint8Array(k), thickness = new Float32Array(k), age = new Float32Array(k);
    const orogeny = new Float32Array(k), sediment = new Float32Array(k), tags = new Uint8Array(k);
    k = 0;
    for (let r = 0; r < n; r++) {
      if (!p.member[r]) continue;
      cells[k] = r; kind[k] = p.kind[r]; thickness[k] = p.thickness[r]; age[k] = p.age[r];
      orogeny[k] = p.orogeny[r]; sediment[k] = p.sediment[r]; tags[k] = p.tags[r];
      k++;
    }
    return { id: p.id, q: Float64Array.from(p.q), omega: Float64Array.from(p.omega), cells, kind, thickness, age, orogeny, sediment, tags };
  });
  return {
    time: s.time, steps: s.steps, plates,
    owner: s.owner.slice(), ref: s.ref.slice(), boundary: s.boundary.slice(), boundaryRate: s.boundaryRate.slice(),
    subducting: s.subducting.slice(), trench: s.trench.slice(), height: s.height.slice(), seaLevel: s.seaLevel,
    nextReorganisation: s.nextReorganisation, totals: { ...s.totals }, discharge: s.discharge.slice(),
    group: s.group.slice(), contact: [...s.contact.entries()].flat(), weldTime: s.weldTime.slice(), born: s.born.slice(),
    rngState: s.rngState, hotspots: s.hotspots.map((h) => ({ ...h })), events: s.events.map((e) => ({ ...e, ...(e.at ? { at: [...e.at] } : {}) })),
    begun: s.begun.map((b) => (b ? 1 : 0)), gather: s.gather ? [...s.gather] : null, scatter: s.scatter ? [...s.scatter] : null,
    volcanism: s.volcanism,
    paleo: s.paleo ? { ...s.paleo, rain: s.paleo.rain.slice(), coarseK: s.paleo.coarseK.slice() } : null,
  };
}

type PackedPlate = { id: number; q: Float64Array; omega: Float64Array; cells: Int32Array; kind: Uint8Array; thickness: Float32Array; age: Float32Array; orogeny: Float32Array; sediment: Float32Array; tags: Uint8Array };

/** A checkpoint unpacked into a state that continues with `params` (the history's own, or with later events). */
export function unpackState(d: Packed, params: TectonicParams): TectonicState {
  const mesh = meshAt(params.level), n = mesh.n;
  const plates = (d.plates as PackedPlate[]).map((pp) => {
    const p = newPlate(pp.id, n);
    p.q.set(pp.q); p.omega.set(pp.omega);
    for (let k = 0; k < pp.cells.length; k++) {
      const r = pp.cells[k];
      p.member[r] = 1; p.kind[r] = pp.kind[k]; p.thickness[r] = pp.thickness[k]; p.age[r] = pp.age[k];
      p.orogeny[r] = pp.orogeny[k]; p.sediment[r] = pp.sediment[k]; p.tags[r] = pp.tags[k];
    }
    return p;
  });
  const contact = new Map<number, number>();
  const flat = d.contact as number[];
  for (let i = 0; i < flat.length; i += 2) contact.set(flat[i], flat[i + 1]);
  const paleo = d.paleo as TectonicState['paleo'];
  return {
    mesh, params, plates, time: d.time as number, steps: d.steps as number,
    owner: Int32Array.from(d.owner as Int32Array), ref: Int32Array.from(d.ref as Int32Array),
    boundary: Uint8Array.from(d.boundary as Uint8Array), boundaryRate: Float32Array.from(d.boundaryRate as Float32Array),
    subducting: Int32Array.from(d.subducting as Int32Array), trench: Uint8Array.from(d.trench as Uint8Array),
    height: Float32Array.from(d.height as Float32Array), seaLevel: d.seaLevel as number,
    nextReorganisation: d.nextReorganisation as number, totals: { ...(d.totals as TectonicState['totals']) },
    discharge: Float32Array.from(d.discharge as Float32Array),
    group: [...(d.group as number[])], contact, weldTime: [...(d.weldTime as number[])], born: [...(d.born as number[])],
    rngState: d.rngState as number, hotspots: (d.hotspots as TectonicState['hotspots']).map((h) => ({ ...h })),
    events: (d.events as TectonicEvent[]).map((e) => ({ ...e, ...(e.at ? { at: [...e.at] as [number, number] } : {}) })),
    begun: (d.begun as number[]).map((b) => b === 1),
    gather: d.gather ? [...(d.gather as number[])] as [number, number, number] : null,
    scatter: d.scatter ? [...(d.scatter as number[])] as [number, number, number] : null,
    volcanism: d.volcanism as number,
    paleo: paleo ? { ...paleo, rain: Float64Array.from(paleo.rain), coarseK: Float64Array.from(paleo.coarseK) } : null,
  };
}

/** The params of a history without its events, as text (two histories can share a beginning only if these are equal). */
export const paramsBesidesEvents = (p: TectonicParams) => JSON.stringify({ ...p, events: undefined });

/**
 * The earliest moment (Myr since the history began) at which two histories' events differ: before it both ran
 * through the same events, so the same steps. Infinity if their events are the same.
 */
export function firstDifference(a: TectonicEvent[], b: TectonicEvent[]): number {
  const sa = [...a].sort((x, y) => x.start - y.start), sb = [...b].sort((x, y) => x.start - y.start);
  const same = (x: TectonicEvent, y: TectonicEvent) => x.kind === y.kind && x.start === y.start && x.end === y.end && x.strength === y.strength && JSON.stringify(x.at ?? null) === JSON.stringify(y.at ?? null);
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const x = sa[i], y = sb[i];
    if (x && y && same(x, y)) continue;
    return Math.min(x ? x.start : Infinity, y ? y.start : Infinity);
  }
  return Infinity;
}
