// Example projects (D171): each built by a script through the same commands the interface uses, into the
// projects folder, when it is chosen in the Projects dialog.
import type { ProjectRegistry, ProjectInfo } from '../server/projects.ts';
import { GREATER_ARMENIA, buildGreaterArmenia } from './greater-armenia.ts';
import { buildConstantinople } from './constantinople.ts';
import { buildMongols } from './mongols.ts';
import { buildEmpires } from './empires.ts';
import { buildOrrun } from './fantasy.ts';
import { buildGalacticAges } from './galactic.ts';

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
  {
    id: 'end-of-empires', name: 'The End of Empires, 1945 to 1999',
    about: 'The whole world in half a century: the British, French, Dutch, Belgian, Portuguese and Spanish empires, Japan\'s, the Soviet Union and Yugoslavia, colony by colony to independence, with the names countries had then; the partition of India, Korea\'s front up and down the peninsula, Indochina, the year of Africa, Katanga and Biafra, Suez and the Six-Day War, the Sahara, Germany parted and joined, the Soviet break-up, Hong Kong and Macau; leaders on their journeys, the UN\'s members and the new states counted. Ten shots.',
    build: (reg, dataDir) => buildEmpires(reg, dataDir),
  },
  {
    id: 'orrun', name: 'Orrun, a thousand years',
    about: 'A world of one\'s own: a generated planet cut into provinces, its own calendar of ten months and three ages; realms founded, grown and at war province by province; the Ember Dominion rising from a volcano and thrown down; a forest fire, a meteor, a flood and a neck of land sinking under the sea; heroes, a dragon and two voyages; and another history, in a branch of its own, in which the battle that saved the west is lost. Nine shots.',
    build: (reg, dataDir) => buildOrrun(reg, dataDir),
  },
  {
    id: 'galactic-ages', name: 'The Galactic Ages, 2026 to 12,000,000',
    about: 'Twelve million years ahead on four maps at four scales: the Earth united by a charter, the Solar System\'s planets and moons in revolt and at war, every star within fifty light-years settled by expeditions and waves of ships, then the whole Milky Way: realms spreading along the spiral arms system by system, supernovae, a people of machines at the core, first contact, the Core War, the Concord of the arms, the Long Silence and a plague of machines, a second dawn, and the voyage to the Large Magellanic Cloud. Eleven shots.',
    build: (reg, dataDir) => buildGalacticAges(reg, dataDir),
  },
];
