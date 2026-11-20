// An example project (D171): "Greater Armenia", a future history from 2039 to 2178 built from an outline,
// through the same commands the interface uses. Today's countries; a revolution in Armenia; a week-long war
// across Anatolia and the Caucasus; the Gulf; a golden age; Pakistan; an embargo; a world war; a nuclear
// exchange; the aftermath. Statistics count in its shots, missiles fly in its salvos, fronts advance in its
// conquests. The data service builds it into the projects folder when it is chosen among the examples.
import type { ProjectRegistry, ProjectInfo } from '../server/projects.ts';
import * as cmd from '../domain/commands.ts';
import { startProject, todaysCountries } from './kit.ts';
import { story } from './greater-armenia-story.ts';

export const GREATER_ARMENIA = { id: 'greater-armenia', name: 'Greater Armenia, 2039 to 2178', about: 'A future history from an outline: a revolution in Armenia, the Week War, the Gulf, a golden age in space mining, Pakistan, a world war and a nuclear exchange, and what was left. Nine shots, statistics counting, missiles flying.' };

/** Build the example into the registry's folder; returns the project made. */
export function buildGreaterArmenia(reg: ProjectRegistry, dataDir: string, name = 'Greater Armenia (example)'): ProjectInfo {
  const { info, b } = startProject(reg, dataDir, name);
  // The map: the Earth's geography, today's countries as they are drawn in 2026.
  b.commit(cmd.setWorldBasemap(b.world, b.space, 'natural-earth'));
  b.commit(cmd.updateLayer(b.world, b.layer, { name: 'Countries' }));
  b.commit(cmd.setLayerClipToLand(b.world, b.layer, true));
  b.commit(cmd.setWorldShow(b.world, b.space, { minLakeKm2: 1000 }));
  todaysCountries(b);
  story(b);
  return info;
}
