// Example projects (D171): each built by a script through the same commands the interface uses, into the
// projects folder, when it is chosen in the Projects dialog.
import type { ProjectRegistry, ProjectInfo } from '../server/projects.ts';
import { GREATER_ARMENIA, buildGreaterArmenia } from './greater-armenia.ts';
import { buildConstantinople } from './constantinople.ts';
import { buildMongols } from './mongols.ts';

export interface Example { id: string; name: string; about: string; build(reg: ProjectRegistry, dataDir: string): ProjectInfo }

export const EXAMPLES: Example[] = [
  { ...GREATER_ARMENIA, build: (reg, dataDir) => buildGreaterArmenia(reg, dataDir, 'Greater Armenia (example)') },
  {
    id: 'constantinople-1453', name: 'The Fall of Constantinople, 1453',
    about: 'A medieval city close up: the Theodosian walls, the Golden Horn and its chain, Galata, the Ottoman camps and batteries, every day of cannon fire, the ships hauled over the hill, the mines, the assaults and the fall hour by hour on 29 May 1453, in the Julian calendar; then the Ottoman conquests to 1468. Ten shots.',
    build: (reg, dataDir) => buildConstantinople(reg, dataDir),
  },
  {
    id: 'mongols', name: 'The Mongol Empire, 1206 to 1405',
    about: 'A continent conquered and divided: Genghis Khan\'s campaigns province by province, Khwarazm, the Rus\', Hungary taken and given up, Baghdad, Ain Jalut, the Song, the fleets to Japan and Java, four khanates, the Ming, Lithuania and Moscow, and Timur; campaign arrows, battles, capitals, Marco Polo, Rubruck and Ibn Battuta on their journeys. Nine shots.',
    build: (reg, dataDir) => buildMongols(reg, dataDir),
  },
];
