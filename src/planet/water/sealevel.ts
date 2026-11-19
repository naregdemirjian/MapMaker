// Sea level from the water's volume (Stage 14.8, D159): the ocean's water is conserved, so the sea stands at the
// height at which the planet's hollows hold exactly that volume over its present heights (the area-height curve):
// it falls when ice sheets lock water up on land, rises when they melt, and rises when young, hot sea floor makes the
// ocean basins shallower (fast spreading: tectono-eustasy). Flooding follows from the level and the land alone, so
// raising the sea floods monotonically.

/** The volume of water below a level over cells of heights `h` and areas `area` (any consistent units). */
export function oceanVolume(h: ArrayLike<number>, area: ArrayLike<number>, level: number): number {
  let v = 0;
  for (let i = 0; i < h.length; i++) if (h[i] < level) v += (level - h[i]) * area[i];
  return v;
}

/**
 * The level at which the hollows hold `volume` (exact: between consecutive heights the volume grows linearly with
 * the level, at the rate of the area already under water). -Infinity for no water.
 */
export function seaLevelForVolume(h: ArrayLike<number>, area: ArrayLike<number>, volume: number): number {
  const n = h.length;
  if (!(volume > 0) || n === 0) return -Infinity;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => h[a] - h[b]);
  let A = 0, ZA = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    A += area[i]; ZA += h[i] * area[i];
    const next = k + 1 < n ? h[order[k + 1]] : Infinity;
    // With cells 0..k under water, the volume at a level L is L·A − ZA.
    if (next * A - ZA >= volume) return (volume + ZA) / A;
  }
  return (volume + ZA) / A;
}
