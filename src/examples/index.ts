// Example projects (D171): each built by a script through the same commands the interface uses, into the
// projects folder, when it is chosen in the Projects dialog.
import type { ProjectRegistry, ProjectInfo } from '../server/projects.ts';
import { GREATER_ARMENIA, buildGreaterArmenia } from './greater-armenia.ts';

export interface Example { id: string; name: string; about: string; build(reg: ProjectRegistry, dataDir: string): ProjectInfo }

export const EXAMPLES: Example[] = [
  { ...GREATER_ARMENIA, build: (reg, dataDir) => buildGreaterArmenia(reg, dataDir, 'Greater Armenia (example)') },
];
