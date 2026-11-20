// "The Galactic Ages, 2026 to 12,000,000" (D180): a future history on four maps at four scales: the Earth, the Solar
// System side by side, the stars within fifty light-years, and the whole Milky Way. Realms hold planets, moons, stars
// and star systems; expeditions are lanes that grow from star to star while the ships are under way; wars are fronts
// where realms meet. On the galaxy, who settles which system is not drawn by hand but worked out as a race of slow
// colony ships from system to system (settle.ts), and then history happens to it: secessions, supernovae, a war for
// the core, a union of the arms, a long silence and a plague of machines, and a second dawn. Real astronomy where it
// is known (Apophis in 2029, Vega the pole star, Betelgeuse and VY Canis Majoris exploding, Gliese 710 passing the
// Sun's comets, the Arecibo message reaching the Hercules Cluster, the African Rift flooding); the rest invented.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cmd from '../domain/commands.ts';
import { createEventType } from '../domain/event-types.ts';
import type { ProjectRegistry } from '../server/projects.ts';
import type { Instant } from '../core-time/index.ts';
import { gregorian } from '../core-time/calendar.ts';
import { startProject, event, todaysCountries, stat, shot, seeded, type Builder } from './kit.ts';
import { galaxyCatalogue, SYSTEM_ID_BASE, type GalaxySettings } from '../space/galaxy.ts';
import { decodeStars, systemOf, type Star, type StarCatalogue } from '../space/catalogue.ts';
import { presetLook } from '../space/sky-look.ts';
import { neighbours, race, Heap, type Seed, type Arrival } from './settle.ts';

/** A moment of a year AD (years past 9999 too: 1,290,000 is a year like any other). */
export const Y = (year: number, month = 1, day = 1): Instant => gregorian.fromCivil({ year: Math.round(year), month, day });

/** The Milky Way of the galaxy map: 3,000 star systems along its arms (each standing for a whole region of stars). */
export const GALAXY: GalaxySettings = { kind: 'milkyway', seed: 1, systems: 3000, arms: 4, pitch: 14, radiusLy: 50000, bar: true };

/** Realms, by key: their names and colours (the same entity on every map it holds anything on). */
export const REALMS = {
  terran: ['Terran Union', '#f2c14e'], mars: ['Martian Republic', '#e0704a'], jovian: ['Jovian League', '#3fbfa8'],
  saturn: ['Free Habitats of Saturn', '#8fa8ff'], outer: ['Outer Compact', '#b98be8'],
  centauri: ['Centauri Republic', '#5fa8e8'], eridani: ['Eridani Free Worlds', '#6ccf7f'], sirius: ['Sirian Directorate', '#e86fa0'],
  lyra: ['Lyran Combine', '#b07ce8'], arcturus: ['Arcturan Reach', '#e89a4f'],
  orion: ['Orion Hegemony', '#4f8fe8'], cygnus: ['Cygnus Reach', '#9b6fe0'], carina: ['Carina Covenant', '#e05f7a'],
  perseus: ['Perseus Marches', '#3fc7a0'], sagittarius: ['Sagittarius Thrones', '#e88a3c'], scutum: ['Scutum Combine', '#bcd84f'],
  synod: ['The Core Synod', '#dfe4ff'], rim: ['Free Worlds of the Outer Arm', '#7fcf5a'], vael: ['The Vael', '#ff5fd2'],
  concord: ['The Galactic Concord', '#ffe7a3'], tide: ['The Grey Tide', '#8a8a94'], havens: ['The Cluster Havens', '#ffb36b'],
  synthesis: ['The Synthesis', '#7fe6ff'],
} as const satisfies Record<string, readonly [string, string]>;
export type Realm = keyof typeof REALMS;

// ---------------------------------------------------------------- events

type Group = 'The Solar Age' | 'The Near Stars' | 'The Hearth' | 'Across the Arms' | 'The Core War' | 'The Concord' | 'The Long Silence' | 'The Second Dawn' | 'Sky and Earth' | 'Settlement';
const GROUP_COLOURS: Record<Group, string> = {
  'The Solar Age': '#f2c14e', 'The Near Stars': '#5fa8e8', 'The Hearth': '#e8c66f', 'Across the Arms': '#3fc7a0', 'The Core War': '#e05f7a',
  'The Concord': '#ffe7a3', 'The Long Silence': '#8a8a94', 'The Second Dawn': '#7fe6ff', 'Sky and Earth': '#c9b8ff',
  // (Each realm's settlement of the galaxy, lasting up to millions of years: kept out of the shots' boxes of events.)
  Settlement: '#7fcf5a',
};
/** Kinds of event of the project's own (besides the built-in war, treaty, founding…). */
type OwnType = 'expedition' | 'settlement' | 'sky' | 'contact';
const OWN_TYPES: Record<OwnType, [string, string]> = { expedition: ['Expedition', '#56c2e6'], settlement: ['Settlement', '#7fcf5a'], sky: ['Sky and stars', '#c9b8ff'], contact: ['First contact', '#ff5fd2'] };
type Type = OwnType | 'founding' | 'war' | 'treaty' | 'revolution' | 'collapse' | 'disaster' | 'conquest' | 'general';

/** An event: its name, when (a year, or [year, month, day]), until when (absent: a moment), kind, group and description. */
interface EventDef { key: string; name: string; at: number | [number, number, number]; to?: number | [number, number, number]; type: Type; group: Group; about: string }
const when = (w: number | [number, number, number]): Instant => (typeof w === 'number' ? Y(w) : Y(w[0], w[1], w[2]));

/** Every event of the project, in time order within each part. */
export const EVENTS: EventDef[] = [
  // ---- The Solar Age (the Earth and the Solar System)
  { key: 'apophis', name: 'Apophis passes the Earth', at: [2029, 4, 13], type: 'sky', group: 'Sky and Earth', about: 'The asteroid Apophis, 340 metres across, passes closer to the Earth than the satellites that ring it, and is seen with the naked eye from Europe and Africa.' },
  { key: 'mars-steps', name: 'First footsteps on Mars', at: [2041, 7, 20], type: 'expedition', group: 'The Solar Age', about: 'Four people walk on Mars, at the edge of the Jezero crater, after seven months on the way.' },
  { key: 'charter', name: 'The Terran Charter', at: [2068, 5, 9], to: [2073, 5, 9], type: 'treaty', group: 'The Solar Age', about: 'One country after another signs the Charter, and over five years the nations of the Earth become provinces of the Terran Union.' },
  { key: 'shackleton', name: 'Shackleton City', at: [2071, 3, 2], type: 'founding', group: 'The Solar Age', about: 'The base at the Moon\'s south pole becomes a town of ten thousand, living on the ice of its dark craters.' },
  { key: 'jezero', name: 'Jezero, the first town on Mars', at: [2084, 9, 1], type: 'founding', group: 'The Solar Age', about: 'The Union\'s settlements on Mars and its two small moons are joined under one charter.' },
  { key: 'elevator', name: 'The first space elevator', at: [2101, 6, 21], type: 'general', group: 'The Solar Age', about: 'A cable of carbon from a platform on the equator to a counterweight beyond the geostationary orbit: going to space now costs what a long flight does.' },
  { key: 'mercury', name: 'The Mercury foundries', at: [2108, 1, 15], type: 'founding', group: 'The Solar Age', about: 'Robot foundries on the terminator of Mercury cast the mirrors and hulls of the outer system.' },
  { key: 'venus', name: 'The cloud cities of Venus', at: [2116, 8, 8], type: 'founding', group: 'The Solar Age', about: 'Fifty kilometres up, where the air is as warm and as heavy as the Earth\'s, floating cities are moored in the clouds.' },
  { key: 'ganymede', name: 'Ganymede Station', at: [2126, 2, 11], type: 'founding', group: 'The Solar Age', about: 'A town under the ice of the largest moon in the Solar System, shielded by its magnetic field from Jupiter\'s radiation; Callisto follows.' },
  { key: 'europa', name: 'Life in Europa\'s ocean', at: [2139, 10, 4], type: 'contact', group: 'The Solar Age', about: 'A probe melts through twenty kilometres of ice and finds the ocean beneath alive with microbes: life began twice around the Sun.' },
  { key: 'titan', name: 'Landfall on Titan', at: [2150, 5, 30], type: 'founding', group: 'The Solar Age', about: 'Settlers land on the shores of Kraken Mare, a sea of methane, under an orange sky.' },
  { key: 'jovian', name: 'The Jovian League', at: [2163, 1, 1], type: 'founding', group: 'The Solar Age', about: 'Ganymede, Callisto, Europa and the mines of Io leave the Union by vote and form a league of their own.' },
  { key: 'martian-war', name: 'The Martian Revolution', at: [2176, 3, 14], to: [2181, 9, 23], type: 'war', group: 'The Solar Age', about: 'Mars declares itself a republic; the Union holds Phobos for three years, then gives up a war it cannot supply across a hundred million kilometres.' },
  { key: 'phobos', name: 'The Treaty of Phobos', at: [2181, 9, 23], type: 'treaty', group: 'The Solar Age', about: 'The Union recognises the Martian Republic and gives back Phobos.' },
  { key: 'saturn', name: 'The Free Habitats of Saturn', at: [2190, 7, 1], type: 'founding', group: 'The Solar Age', about: 'Titan, Enceladus and Rhea, and the habitats in Saturn\'s rings, govern themselves.' },
  { key: 'outer', name: 'The Outer Compact', at: [2214, 4, 22], type: 'founding', group: 'The Solar Age', about: 'The cold settlements of Uranus, Neptune and Pluto join in a compact of their own.' },
  { key: 'ring-war', name: 'The Ring War', at: [2230, 2, 2], to: [2236, 6, 6], type: 'war', group: 'The Solar Age', about: 'The Jovian League and the Free Habitats fight over the ice of Saturn\'s moons; the League takes Rhea and Enceladus, and gives Enceladus back at the peace.' },
  { key: 'sunward', name: 'The Sunward Accord', at: [2251, 1, 1], type: 'treaty', group: 'The Solar Age', about: 'The realms of the Solar System become members of one commonwealth, each governing itself; the Terran Union becomes the Terran Commonwealth.' },
  // ---- The Near Stars
  { key: 'patience', name: 'The voyage of the Long Patience', at: [2290, 3, 1], to: [2334, 1, 1], type: 'expedition', group: 'The Near Stars', about: 'The first starship, pushed by lasers to a tenth of the speed of light: forty-four years to Alpha Centauri, with a crew born on the way.' },
  { key: 'alpha', name: 'Landfall at Alpha Centauri', at: 2334, type: 'founding', group: 'The Near Stars', about: 'The first world of another star, Proxima b, and the first colonies round its two bright companions.' },
  { key: 'barnard-x', name: 'The Barnard expedition', at: 2312, to: 2371, type: 'expedition', group: 'The Near Stars', about: 'Six light-years to a small red star that is coming closer to the Sun.' },
  { key: 'eridani-x', name: 'The Eridani expedition', at: 2340, to: 2445, type: 'expedition', group: 'The Near Stars', about: 'To Epsilon Eridani, a young star with a giant planet and belts of dust and comets.' },
  { key: 'ceti-x', name: 'The Tau Ceti expedition', at: 2352, to: 2471, type: 'expedition', group: 'The Near Stars', about: 'To the nearest single star like the Sun, older and quieter than it.' },
  { key: 'sirius-x', name: 'The Sirius works', at: 2365, to: 2451, type: 'expedition', group: 'The Near Stars', about: 'No one lives near the brightest star in the sky: the ships go to build the antimatter works that will power the next voyages.' },
  { key: 'second-wave', name: 'The second century of ships', at: 2400, to: 2650, type: 'settlement', group: 'The Near Stars', about: 'Every star within twelve light-years is reached, red dwarf after red dwarf.' },
  { key: 'procyon-x', name: 'The Procyon expedition', at: 2480, to: 2595, type: 'expedition', group: 'The Near Stars', about: 'Eleven and a half light-years to the Little Dog Star and its white dwarf.' },
  { key: 'centauri', name: 'The Centauri Republic', at: 2512, type: 'revolution', group: 'The Near Stars', about: 'Alpha Centauri, four light-years and four years of messages from the Sun, governs itself.' },
  { key: 'altair-x', name: 'The Altair expedition', at: 2530, to: 2697, type: 'expedition', group: 'The Near Stars', about: 'Seventeen light-years to the fast-spinning star of the Eagle.' },
  { key: 'eridani', name: 'The Eridani Free Worlds', at: 2622, type: 'founding', group: 'The Near Stars', about: 'Epsilon Eridani, Tau Ceti and the red dwarfs between them form a free league.' },
  { key: 'sirian', name: 'The Sirian Directorate', at: 2680, type: 'founding', group: 'The Near Stars', about: 'The engineers of the Sirius works rule the stars round Sirius and Procyon, and sell their antimatter dearly.' },
  { key: 'vega-x', name: 'The Vega expedition', at: 2700, to: 2950, type: 'expedition', group: 'The Near Stars', about: 'Twenty-five light-years to Vega and its disc of dust.' },
  { key: 'sirius-war', name: 'The Sirius War', at: 2781, to: 2789, type: 'war', group: 'The Near Stars', about: 'The Directorate cuts off the antimatter and takes the stars between Sirius and the Sun; the Commonwealth and Alpha Centauri take them back.' },
  { key: 'barnard-peace', name: 'The Treaty of Barnard\'s Star', at: 2789, type: 'treaty', group: 'The Near Stars', about: 'Peace among the near stars: the antimatter of Sirius is sold to all at one price.' },
  { key: 'lyran', name: 'The Lyran Combine', at: 2950, type: 'founding', group: 'The Near Stars', about: 'The colonists of Vega and Altair join their worlds in a combine.' },
  { key: 'third-wave', name: 'The third wave', at: 3000, to: 4500, type: 'settlement', group: 'The Near Stars', about: 'Every star within thirty light-years settled, each by the realm nearest to it.' },
  { key: 'fomalhaut-x', name: 'The Fomalhaut expedition', at: 3000, to: 3251, type: 'expedition', group: 'The Near Stars', about: 'To the bright star of the Southern Fish and its ring of comets.' },
  { key: 'arcturus-x', name: 'The Arcturus expedition', at: 3200, to: 3567, type: 'expedition', group: 'The Near Stars', about: 'Thirty-seven light-years to an old orange giant, passing through the Sun\'s neighbourhood on an orbit of its own.' },
  { key: 'arcturan', name: 'The Arcturan Reach', at: 3567, type: 'founding', group: 'The Near Stars', about: 'The giant\'s colonists claim the stars round it.' },
  { key: 'capella-x', name: 'The Capella expedition', at: 3400, to: 3828, type: 'expedition', group: 'The Near Stars', about: 'Forty-three light-years to the four stars of Capella.' },
  { key: 'lyra-war', name: 'The Lyran–Arcturan War', at: 4100, to: 4130, type: 'war', group: 'The Near Stars', about: 'The two youngest realms fight over the stars between them.' },
  { key: 'fourth-wave', name: 'The fourth wave', at: 4500, to: 7000, type: 'settlement', group: 'The Near Stars', about: 'The last stars within fifty light-years are reached: nearly a thousand suns settled.' },
  { key: 'compact', name: 'The Compact of the Hearth', at: 9800, type: 'treaty', group: 'The Near Stars', about: 'The realms of the near stars join the Commonwealth in one, the Hearth, round the Sun from which they came.' },
  { key: 'barnard-near', name: 'Barnard\'s Star at its closest', at: 11800, type: 'sky', group: 'Sky and Earth', about: 'Barnard\'s Star passes the Sun 3.8 light-years away, nearer than Alpha Centauri is today.' },
  { key: 'vega-pole', name: 'Vega, the pole star', at: 13700, type: 'sky', group: 'Sky and Earth', about: 'The Earth\'s axis, turning round once in 26,000 years, now points near Vega, one of the brightest stars in the sky, as it last did some twelve thousand years before the Common Era.' },
  // ---- The Hearth (the galaxy)
  { key: 'pleiades-x', name: 'The Pleiades expedition', at: 9000, to: 17900, type: 'expedition', group: 'The Hearth', about: 'The first ship to leave the Sun\'s neighbourhood: 444 light-years to the Seven Sisters at a twentieth of the speed of light.' },
  { key: 'polaris-x', name: 'The Polaris expedition', at: 10400, to: 19060, type: 'expedition', group: 'The Hearth', about: '433 light-years to the old North Star.' },
  { key: 'betelgeuse-x', name: 'The Betelgeuse Watch', at: 12000, to: 22960, type: 'expedition', group: 'The Hearth', about: 'A ship of astronomers goes to watch the red giant at Orion\'s shoulder until it dies.' },
  { key: 'antares-x', name: 'The Antares expedition', at: 13500, to: 24500, type: 'expedition', group: 'The Hearth', about: 'To the red heart of the Scorpion.' },
  { key: 'arecibo', name: 'The Arecibo message reaches the Hercules Cluster', at: 24174, type: 'sky', group: 'Sky and Earth', about: 'A picture in 1,679 bits, sent from Puerto Rico in 1974 towards the Hercules Cluster, arrives there at the speed of light.' },
  { key: 'helix-x', name: 'The Helix expedition', at: 15000, to: 28000, type: 'expedition', group: 'The Hearth', about: 'To the nearest of the great nebulae, the shell a dead star blew off.' },
  { key: 'alpha-near', name: 'Alpha Centauri at its closest', at: 29000, type: 'sky', group: 'Sky and Earth', about: 'Alpha Centauri passes the Sun three light-years away.' },
  { key: 'rigel-x', name: 'The Rigel expedition', at: 18000, to: 35200, type: 'expedition', group: 'The Hearth', about: '860 light-years to the blue supergiant at Orion\'s foot.' },
  { key: 'vela-x', name: 'The Vela expedition', at: 19000, to: 37720, type: 'expedition', group: 'The Hearth', about: 'To the Vela pulsar, the core of a star that exploded around 9000 BCE, still spinning eleven times a second.' },
  { key: 'orion-x', name: 'The Orion expedition', at: 21000, to: 47880, type: 'expedition', group: 'The Hearth', about: '1,344 light-years to the Orion Nebula, where stars are still being born.' },
  { key: 'hearth-wave', name: 'The first arks', at: 25000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'Slow arks, a hundredth of the speed of light, carrying whole towns: each colony waits sixty thousand years before it sends its own.' },
  { key: 'orion-wave', name: 'The Orion colonies grow', at: 47880, to: 3600000, type: 'settlement', group: 'Settlement', about: 'From the nebula the arks go out along the Orion Spur.' },
  { key: 'secession', name: 'The Orion Secession', at: 61000, type: 'revolution', group: 'The Hearth', about: 'Two thousand light-years and four thousand years of messages from the Sun, the Orion colonies declare a hegemony of their own.' },
  { key: 'spur-war', name: 'The War of the Spur', at: 61000, to: 64500, type: 'war', group: 'The Hearth', about: 'The Hearth sends fleets that arrive centuries after the war that called them; Orion takes Rigel and the stars round it.' },
  { key: 'spur-peace', name: 'The Treaty of the Spur', at: 64500, type: 'treaty', group: 'The Hearth', about: 'A peace sent by light, ratified six centuries after it was proposed; the lane between the Sun and Orion is open to all.' },
  { key: 'cygnus-x', name: 'The Cygnus expedition', at: 70000, to: 96000, type: 'expedition', group: 'The Hearth', about: 'A fast ship, a tenth of the speed of light, to Deneb and the North America Nebula, 2,600 light-years along the Spur.' },
  { key: 'betelgeuse', name: 'Betelgeuse explodes', at: 71200, type: 'disaster', group: 'The Hearth', about: 'The red giant ends as a supernova, as bright as the half Moon in the skies of Earth for three months. The Watch had left a century before; the worlds near it are sterilised.' },
  { key: 'vy', name: 'VY Canis Majoris explodes', at: 92000, type: 'disaster', group: 'The Hearth', about: 'One of the largest stars known collapses in a hypernova; nothing lives within nine hundred light-years of it.' },
  { key: 'cygnus', name: 'The Cygnus Reach', at: 96000, type: 'founding', group: 'The Hearth', about: 'The colonists of Deneb found a realm along the arm.' },
  { key: 'cygnus-wave', name: 'The Cygnus Reach spreads', at: 96000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'Along the Orion Spur towards the Perseus Arm.' },
  { key: 'sag-x', name: 'The Sagittarius expedition', at: 200000, to: 241000, type: 'expedition', group: 'The Hearth', about: 'Inward, across the gap between the arms, to the Lagoon and Eagle Nebulae.' },
  { key: 'sag', name: 'The Sagittarius Thrones', at: 241000, type: 'founding', group: 'The Hearth', about: 'The settlers of the Lagoon Nebula crown their founders\' heirs.' },
  { key: 'sag-wave', name: 'The Sagittarius Thrones spread', at: 241000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'Along the Sagittarius Arm, inward and outward.' },
  { key: 'carina-x', name: 'The Carina expedition', at: 250000, to: 333000, type: 'expedition', group: 'The Hearth', about: 'The Orion Hegemony sends a ship 8,300 light-years to the Carina Nebula, on the next arm inward.' },
  { key: 'perseus-x', name: 'The Perseus expedition', at: 300000, to: 365000, type: 'expedition', group: 'The Hearth', about: 'Outward, 6,500 light-years to the Crab Nebula, the remains of the supernova seen from the Earth in 1054.' },
  { key: 'carina', name: 'The Carina Covenant', at: 333000, type: 'founding', group: 'The Hearth', about: 'The colonists of the Carina Nebula bind themselves by a covenant: never to answer to Orion.' },
  { key: 'carina-wave', name: 'The Carina Covenant spreads', at: 333000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'Along the Carina Arm.' },
  { key: 'perseus', name: 'The Perseus Marches', at: 365000, type: 'founding', group: 'The Hearth', about: 'Border realms of the Perseus Arm, founded at the Crab and Rosette Nebulae.' },
  { key: 'perseus-wave', name: 'The Perseus Marches spread', at: 365000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'Along the Perseus Arm, the outer edge of the galaxy\'s bright disc.' },
  // ---- Across the Arms
  { key: 'eta', name: 'Eta Carinae explodes', at: 612000, type: 'disaster', group: 'Across the Arms', about: 'The great unstable star of the Carina Nebula ends in a hypernova; the Covenant loses its first worlds.' },
  { key: 'scutum-x', name: 'The Scutum expedition', at: 700000, to: 792000, type: 'expedition', group: 'Across the Arms', about: 'The Thrones send a ship inward to Westerlund 1, a cluster of giant stars on the way to the core.' },
  { key: 'scutum', name: 'The Scutum Combine', at: 792000, type: 'founding', group: 'Across the Arms', about: 'Miners of the giant stars, combined to share their ships.' },
  { key: 'scutum-wave', name: 'The Scutum Combine spreads', at: 792000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'Along the Scutum–Centaurus Arm.' },
  { key: 'core-x', name: 'The Core expedition', at: 900000, to: 1054000, type: 'expedition', group: 'Across the Arms', about: 'A ship of machines, sent by the Combine to the black hole at the middle of the galaxy, 15,000 light-years inward.' },
  { key: 'synod', name: 'The Core Synod', at: 1054000, type: 'founding', group: 'Across the Arms', about: 'The expedition\'s minds stay at Sagittarius A* and become a people of their own: the Synod, who think slowly and live for ever.' },
  { key: 'synod-wave', name: 'The Synod round the core', at: 1054000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'The machines settle the ring of stars round the bar of the galaxy, fast and thoroughly.' },
  { key: 'gliese', name: 'Gliese 710 passes the Sun\'s comets', at: 1290000, type: 'sky', group: 'Sky and Earth', about: 'A star of six-tenths of the Sun\'s mass passes through the cloud of comets round the Sun, and sends some of them falling inward for the next two million years.' },
  { key: 'two-arms', name: 'The War of the Two Arms', at: 1380000, to: 1452000, type: 'war', group: 'Across the Arms', about: 'The Perseus Marches take the outer stars of the Orion Hegemony.' },
  { key: 'rim-x', name: 'The Outer Arm expedition', at: 1500000, to: 1620000, type: 'expedition', group: 'Across the Arms', about: 'The Marches send a ship beyond the Perseus Arm to the faint Outer Arm, at the edge of the disc.' },
  { key: 'rim', name: 'The Free Worlds of the Outer Arm', at: 1620000, type: 'founding', group: 'Across the Arms', about: 'At the edge of the galaxy, where the stars are few.' },
  { key: 'rim-wave', name: 'The Free Worlds spread', at: 1620000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'Along the Outer Arm.' },
  { key: 'contact', name: 'First contact: the Vael', at: 1800000, type: 'contact', group: 'Across the Arms', about: 'The Synod\'s probes, looking across the core, find a people who have spread over the far side of the galaxy for a million and a half years: the Vael.' },
  { key: 'vael-wave', name: 'The Vael spread', at: 1800000, to: 3600000, type: 'settlement', group: 'Settlement', about: 'The Vael settle on, unhurried.' },
  // ---- The Core War
  { key: 'core-war', name: 'The Core War', at: 2250000, to: 3300000, type: 'war', group: 'The Core War', about: 'The Synod claims every star within sixteen thousand light-years of the core, and takes them from the Thrones, the Combine, the Covenant and the Reach.' },
  { key: 'westerlund', name: 'The fall of Westerlund', at: 2600000, type: 'conquest', group: 'The Core War', about: 'The Combine\'s first cluster falls to the Synod.' },
  { key: 'vael-war', name: 'The Vael enter the war', at: 2800000, to: 3300000, type: 'war', group: 'The Core War', about: 'The Vael take the Synod\'s stars on the far side of the core.' },
  { key: 'siege', name: 'The Siege of the Core', at: 3050000, to: 3250000, type: 'war', group: 'The Core War', about: 'The arms take back what the Synod took from them.' },
  { key: 'accord', name: 'The Accord of the Black Hole', at: 3300000, type: 'treaty', group: 'The Core War', about: 'Peace: the Synod keeps the ring round the core, and no realm may hold Sagittarius A* but the Synod.' },
  // ---- The Concord
  { key: 'concord', name: 'The Concord of the Arms', at: 3600000, type: 'treaty', group: 'The Concord', about: 'The realms of the arms, from the Hearth to the Outer Arm, join in one Concord.' },
  { key: 'fill', name: 'The Concord fills the galaxy', at: 3600000, to: 5500000, type: 'settlement', group: 'The Concord', about: 'With faster ships, the Concord settles the stars that were left between the realms and beyond them.' },
  { key: 'lanes', name: 'The Great Lanes', at: 4200000, type: 'general', group: 'The Concord', about: 'Lanes of beacons and fuel between the great centres of the galaxy: a crossing of the disc now takes three hundred thousand years.' },
  { key: 'vael-join', name: 'The Vael ally with the Concord', at: 4600000, type: 'treaty', group: 'The Concord', about: 'The Vael, who never join anything, become allies of the Concord.' },
  { key: 'dwarf-x', name: 'The Dwarf expedition', at: 5000000, to: 5330000, type: 'expedition', group: 'The Concord', about: 'Out of the disc, to the Sagittarius Dwarf Galaxy, which the Milky Way\'s pull is tearing apart.' },
  { key: 'dwarf', name: 'Landfall in the Sagittarius Dwarf', at: 5330000, type: 'founding', group: 'The Concord', about: 'The first settlement of another galaxy.' },
  { key: 'height', name: 'The Concord at its height', at: 5500000, type: 'general', group: 'The Concord', about: 'Three thousand regions of stars, more than a quintillion people, one law.' },
  // ---- The Long Silence
  { key: 'severing', name: 'The Severing', at: 6000000, type: 'collapse', group: 'The Long Silence', about: 'The lanes fail one after another and the Concord falls apart into the old realms of the arms.' },
  { key: 'fading', name: 'The Fading', at: 6050000, to: 7800000, type: 'collapse', group: 'The Long Silence', about: 'Worlds fall silent and are abandoned, two in three of them in less than two million years.' },
  { key: 'tide', name: 'The Grey Tide', at: 6400000, to: 8600000, type: 'disaster', group: 'The Long Silence', about: 'Machines that make copies of themselves come in from beyond the Outer Arm and turn worlds into more machines, inhabited or not.' },
  { key: 'tide-war', name: 'The Tide Wars', at: 6600000, to: 8600000, type: 'war', group: 'The Long Silence', about: 'Every realm left fights the Tide, and loses.' },
  { key: 'clusters-x', name: 'The flight to the clusters', at: 7200000, to: 7400000, type: 'expedition', group: 'The Long Silence', about: 'Refugees leave the disc for the globular clusters of the halo, far above and below it, where the Tide does not go.' },
  { key: 'havens', name: 'The Cluster Havens', at: 7400000, type: 'founding', group: 'The Long Silence', about: 'Omega Centauri, 47 Tucanae and the Hercules Cluster: old stars, crowded together, out of reach.' },
  { key: 'synod-holds', name: 'The Synod holds the core', at: 7900000, type: 'general', group: 'The Long Silence', about: 'The Tide breaks against the ring round the core, and the Synod learns how it thinks.' },
  // ---- The Second Dawn
  { key: 'unmaking', name: 'The Unmaking', at: 8600000, type: 'general', group: 'The Second Dawn', about: 'The Synod and the Havens send the Quiet Code: every machine of the Tide stops where it is.' },
  { key: 'synthesis', name: 'The Synthesis', at: 9000000, type: 'founding', group: 'The Second Dawn', about: 'Machines, humans of the Havens and Vael become one people.' },
  { key: 'dawn', name: 'The Second Dawn', at: 9000000, to: 11000000, type: 'settlement', group: 'The Second Dawn', about: 'The galaxy settled a second time, from the core, the clusters, the far side and the survivors of the arms.' },
  { key: 'ocean', name: 'A new ocean in Africa', at: 10000000, type: 'sky', group: 'Sky and Earth', about: 'On the Earth, the Red Sea breaks into the African Rift and the Horn of Africa begins to drift away as a continent of its own.' },
  { key: 'new-lanes', name: 'The new lanes', at: 10400000, type: 'general', group: 'The Second Dawn', about: 'The lanes are open again, between the core, the far side and the arms.' },
  { key: 'accession', name: 'The Last Accession', at: 11000000, type: 'treaty', group: 'The Second Dawn', about: 'The last free realms of the arms join the Synthesis.' },
  { key: 'cloud-x', name: 'The Cloudward voyage', at: 11200000, to: 11980000, type: 'expedition', group: 'The Second Dawn', about: 'From the rim of the disc to the Large Magellanic Cloud, 160,000 light-years away, at a fifth of the speed of light.' },
  { key: 'orbit', name: 'A twentieth of the way round', at: 11500000, type: 'sky', group: 'Sky and Earth', about: 'The Sun has gone a twentieth of the way round the galaxy since 2026, carrying the Earth with it.' },
  { key: 'cloud', name: 'Landfall in the Large Magellanic Cloud', at: 11980000, type: 'founding', group: 'The Second Dawn', about: 'The Synthesis reaches another galaxy, and settles in.' },
  { key: 'end', name: 'Twelve million years', at: 12000000, type: 'general', group: 'The Second Dawn', about: 'The Synthesis looks out at Andromeda.' },
];

// ---------------------------------------------------------------- what happens to stars: changes found by the histories below

/** Stars of a map given to a realm (or to nobody: '') in an event, at a year. */
export interface StarChange { year: number; ev: string; stars: number[]; to: Realm | '' }
/** A lane opened (growing over the rest of its event, `grow`) or closed. */
export interface LaneChange { year: number; ev: string; a: number; b: number; on: boolean; by: Realm | ''; grow?: boolean }
/** A history of one map: its changes and statistics. */
export interface MapHistory { changes: StarChange[]; lanes: LaneChange[]; held: Array<[number, number]>; realms: Array<[number, number]> }

/** Keeps who holds what as changes are made in time order, and writes them down. */
class Holdings {
  readonly own = new Map<number, Realm>();
  readonly changes: StarChange[] = [];
  readonly lanes: LaneChange[] = [];
  readonly open = new Map<string, LaneChange>();
  readonly held: Array<[number, number]> = [];
  readonly realms: Array<[number, number]> = [];
  give(ev: string, year: number, stars: Iterable<number>, to: Realm | ''): number[] {
    const s = [...new Set(stars)].filter((x) => (this.own.get(x) ?? '') !== to).sort((a, b) => a - b);
    if (!s.length) return s;
    for (const x of s) if (to) this.own.set(x, to); else this.own.delete(x);
    this.changes.push({ year, ev, stars: s, to });
    // (Statistics: realms holding anything, and systems settled: the Tide's machines settle nothing.)
    const n = new Set(this.own.values()).size;
    let settled = 0;
    for (const r of this.own.values()) if (r !== 'tide') settled++;
    if (this.held.length && this.held[this.held.length - 1][0] === year) { this.held[this.held.length - 1][1] = settled; this.realms[this.realms.length - 1][1] = n; }
    else { this.held.push([year, settled]); this.realms.push([year, n]); }
    return s;
  }
  lane(ev: string, year: number, a: number, b: number, on: boolean, by: Realm | '', grow = false): void {
    const l: LaneChange = { year, ev, a, b, on, by, ...(grow ? { grow } : {}) };
    this.lanes.push(l);
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (on) this.open.set(k, l); else this.open.delete(k);
  }
  closeAll(ev: string, year: number): void { for (const l of [...this.open.values()]) this.lane(ev, year, l.a, l.b, false, ''); }
  of(realm: Realm | ((r: Realm) => boolean)): number[] { return [...this.own].filter(([, r]) => (typeof realm === 'function' ? realm(r) : r === realm)).map(([s]) => s); }
  history(): MapHistory { return { changes: this.changes, lanes: this.lanes, held: this.held, realms: this.realms }; }
}

const yearOf = (e: string) => { const d = EVENTS.find((x) => x.key === e); if (!d) throw new Error(`No event ${e}.`); return typeof d.at === 'number' ? d.at : d.at[0]; };
const endOf = (e: string) => { const d = EVENTS.find((x) => x.key === e)!; return d.to === undefined ? yearOf(e) : typeof d.to === 'number' ? d.to : d.to[0]; };
const dist = (a: Star, b: Star) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ---------------------------------------------------------------- the Solar System

/** Bodies of the side-by-side Solar System: the Sun 0, planets 1 to 9, moons (31 the Moon … 91 Charon). */
const BODY = { mercury: 1, venus: 2, earth: 3, mars: 4, jupiter: 5, saturn: 6, uranus: 7, neptune: 8, pluto: 9, moon: 31, phobos: 41, deimos: 42, io: 51, europa: 52, ganymede: 53, callisto: 54, titan: 61, enceladus: 62, rhea: 63, titania: 71, oberon: 72, triton: 81, charon: 91 };

export function solarHistory(): MapHistory {
  const h = new Holdings();
  const B = BODY;
  h.give('charter', 2068, [B.earth], 'terran');
  h.give('shackleton', 2071, [B.moon], 'terran'); h.lane('shackleton', 2071, B.earth, B.moon, true, 'terran');
  h.give('jezero', 2084, [B.mars, B.phobos, B.deimos], 'terran'); h.lane('jezero', 2084, B.earth, B.mars, true, 'terran');
  h.give('mercury', 2108, [B.mercury], 'terran');
  h.give('venus', 2116, [B.venus], 'terran'); h.lane('venus', 2116, B.earth, B.venus, true, 'terran');
  h.give('ganymede', 2126, [B.ganymede, B.callisto], 'terran'); h.lane('ganymede', 2126, B.mars, B.jupiter, true, 'terran');
  h.give('titan', 2150, [B.titan], 'terran'); h.lane('titan', 2150, B.jupiter, B.saturn, true, 'terran');
  h.give('jovian', 2163, [B.jupiter, B.io, B.europa, B.ganymede, B.callisto], 'jovian'); h.lane('jovian', 2163, B.mars, B.jupiter, true, 'jovian');
  h.give('martian-war', 2176, [B.mars, B.deimos], 'mars');
  h.give('phobos', 2181, [B.phobos], 'mars'); h.lane('phobos', 2181, B.earth, B.mars, true, 'mars');
  h.give('saturn', 2190, [B.saturn, B.titan, B.enceladus, B.rhea], 'saturn'); h.lane('saturn', 2190, B.jupiter, B.saturn, true, 'saturn');
  h.give('outer', 2214, [B.uranus, B.titania, B.oberon, B.neptune, B.triton, B.pluto, B.charon], 'outer');
  h.lane('outer', 2214, B.saturn, B.uranus, true, 'outer'); h.lane('outer', 2214, B.uranus, B.neptune, true, 'outer'); h.lane('outer', 2214, B.neptune, B.pluto, true, 'outer');
  h.give('ring-war', 2232, [B.rhea], 'jovian');
  h.give('ring-war', 2234, [B.enceladus], 'jovian');
  h.give('ring-war', 2236, [B.enceladus], 'saturn');
  return h.history();
}

// ---------------------------------------------------------------- the near stars

/** Stars of the near stars' map (the HYG ids of data/stars/nearby-50ly.json). */
const STAR = { sol: 0, rigil: 71456, proxima: 70666, barnard: 87665, eridani: 16496, ceti: 8087, sirius: 32263, procyon: 37173, altair: 97338, vega: 90979, fomalhaut: 113008, arcturus: 69451, capella: 24549, pollux: 37718, luyten: 36107 };

export function nearHistory(cat: StarCatalogue): MapHistory {
  const h = new Holdings();
  const S = STAR, star = (id: number) => { const s = cat.byId.get(id); if (!s) throw new Error(`No star ${id} near the Sun.`); return s; };
  for (const id of Object.values(S)) star(id);
  const sys = (id: number) => systemOf(cat, id);
  const near = (id: number, ly: number) => cat.stars.filter((s) => dist(s, star(id)) <= ly).map((s) => s.id);
  // (What happens is done in time order: each step sees who holds what then.)
  const ops = new Heap<() => void>();
  const when = (year: number, f: () => void) => ops.push(year, f);
  /** An expedition: the lane grows from the Sun (or `from`) over the voyage; at the end the system is held. */
  const voyage = (ev: string, to: number, by: Realm, from = S.sol, settle: Realm | null = by) => {
    when(yearOf(ev), () => h.lane(ev, yearOf(ev), from, to, true, by, true));
    if (settle) when(endOf(ev), () => h.give(ev, endOf(ev), sys(to), settle));
  };
  /**
   * Settlement by steps over an event: at each, the stars not yet held within a radius of the Sun growing from `r0`
   * to `r1` go to the realm of the nearest held star within `reach` light-years (the nearest stars first, so that
   * one settled can be the nearest of the next).
   */
  const wave = (ev: string, steps: number, r0: number, r1: number, reach: number) => {
    const start = yearOf(ev), end = endOf(ev);
    for (let k = 1; k <= steps; k++) {
      const year = Math.round(start + ((end - start) * k) / steps), r = r0 + ((r1 - r0) * k) / steps;
      when(year, () => {
        const got = new Map<number, Realm>();
        const todo = cat.stars.filter((s) => s.dist <= r && !h.own.has(s.id)).sort((a, b) => a.dist - b.dist || a.id - b.id);
        for (const s of todo) {
          let best: Realm | null = null, bd = reach;
          for (const [id, realm] of [...h.own, ...got]) { const d = dist(s, star(id)); if (d < bd) { bd = d; best = realm; } }
          if (best) got.set(s.id, best);
        }
        const by = new Map<Realm, number[]>();
        for (const [id, realm] of got) (by.get(realm) ?? by.set(realm, []).get(realm)!).push(id);
        for (const [realm, ids] of by) h.give(ev, year, ids, realm);
      });
    }
  };
  when(2068, () => h.give('charter', 2068, [S.sol], 'terran'));
  voyage('patience', S.rigil, 'terran', S.sol, null);
  when(2334, () => h.give('alpha', 2334, [...sys(S.rigil), S.proxima], 'terran'));
  voyage('barnard-x', S.barnard, 'terran');
  voyage('eridani-x', S.eridani, 'terran');
  voyage('ceti-x', S.ceti, 'terran');
  voyage('sirius-x', S.sirius, 'terran');
  wave('second-wave', 10, 6, 12, 7);
  voyage('procyon-x', S.procyon, 'terran');
  when(2512, () => h.give('centauri', 2512, near(S.rigil, 3.2).filter((s) => h.own.get(s) === 'terran'), 'centauri'));
  voyage('altair-x', S.altair, 'terran');
  when(2622, () => h.give('eridani', 2622, [...near(S.eridani, 5.5), ...near(S.ceti, 5.5)].filter((s) => h.own.get(s) === 'terran'), 'eridani'));
  when(2680, () => h.give('sirian', 2680, [...near(S.sirius, 5), ...near(S.procyon, 5), ...near(S.luyten, 2)].filter((s) => h.own.get(s) === 'terran'), 'sirius'));
  voyage('vega-x', S.vega, 'terran', S.altair, null);
  // The Sirius War: the Directorate takes the Commonwealth's stars near Sirius, and loses them again.
  let between: number[] = [];
  when(2782, () => {
    between = cat.stars.filter((s) => h.own.get(s.id) === 'terran' && s.id !== S.sol && dist(s, star(S.sirius)) < 6.5).map((s) => s.id);
    h.give('sirius-war', 2782, between, 'sirius');
  });
  when(2787, () => h.give('sirius-war', 2787, between, 'terran'));
  when(2950, () => h.give('lyran', 2950, [...sys(S.vega), ...near(S.altair, 4)], 'lyra'));
  voyage('fomalhaut-x', S.fomalhaut, 'terran');
  wave('third-wave', 12, 12, 30, 9);
  voyage('arcturus-x', S.arcturus, 'lyra', S.vega, null);
  when(3567, () => h.give('arcturan', 3567, near(S.arcturus, 6), 'arcturus'));
  voyage('capella-x', S.capella, 'arcturus', S.arcturus);
  // The Lyran–Arcturan War: the Combine takes the Reach's stars within reach of Vega.
  when(4112, () => h.give('lyra-war', 4112, cat.stars.filter((s) => h.own.get(s.id) === 'arcturus' && dist(s, star(S.vega)) < 22 && s.id !== S.arcturus).map((s) => s.id), 'lyra'));
  wave('fourth-wave', 12, 30, 50, 12);
  when(9800, () => h.give('compact', 9800, [...h.own.keys()], 'terran'));
  for (let next = ops.pop(); next; next = ops.pop()) next[1]();
  return h.history();
}

// ---------------------------------------------------------------- the galaxy

/** Lineages of the galaxy's settlement: who settled a system decides whose it is (and whose again at the Severing). */
type Lineage = 'hearth' | 'orion' | 'cygnus' | 'sagittarius' | 'carina' | 'perseus' | 'scutum' | 'synod' | 'rim' | 'vael' | 'concord';
const ARMS: Realm[] = ['terran', 'orion', 'cygnus', 'carina', 'perseus', 'sagittarius', 'scutum', 'rim'];
/** Ships of the arks: a hundredth of the speed of light and more; years a colony waits before it sends its own. */
const ARK = { speed: 0.012, pause: 60000 };
/** The Galaxy's places by id (galaxy.ts): the Sun, Sagittarius A*, the nebulae, clusters and dwarf galaxies. */
const P = { sun: 0, sgrA: 1, orionNeb: 2, pleiades: 3, crab: 4, eagle: 5, carina: 6, eta: 7, omegaCen: 8, tuc47: 9, hercules: 10, betelgeuse: 11, rigel: 12, deneb: 13, polaris: 14, antares: 15, vy: 16, cygX1: 17, lagoon: 18, ring: 19, helix: 20, horsehead: 22, vela: 23, casA: 24, westerlund: 25, rosette: 26, northAmerica: 27, sgrDwarf: 30, lmc: 31 };

export function galaxyHistory(cat: StarCatalogue): MapHistory & { lineage: Map<number, Lineage> } {
  const h = new Holdings();
  const R = (s: Star) => Math.hypot(s.x, s.y);
  const at = (id: number) => { const s = cat.byId.get(id); if (!s) throw new Error(`No system ${id} in the galaxy.`); return s; };
  const systems = cat.stars.filter((s) => s.id >= SYSTEM_ID_BASE);
  const nearestTo = (x: number, y: number, z = 0) => { let best = systems[0]; for (const s of systems) if (Math.hypot(s.x - x, s.y - y, s.z - z) < Math.hypot(best.x - x, best.y - y, best.z - z)) best = s; return best.id; };
  const within = (id: number, ly: number) => cat.stars.filter((s) => dist(s, at(id)) <= ly).map((s) => s.id);
  // (Ships go from system to system in the disc; the halo's clusters, the core's black hole and the dwarf galaxies
  // are reached by expeditions only.)
  const inDisc = (s: Star) => s.id >= SYSTEM_ID_BASE || (Math.abs(s.z) < 3000 && R(s) < 60000 && s.id !== P.sgrA);
  const graph = neighbours(cat, 3000, inDisc);
  const lineage = new Map<number, Lineage>();
  const owner = new Map<Lineage, Realm>([['hearth', 'terran'], ['orion', 'terran'], ['cygnus', 'cygnus'], ['sagittarius', 'sagittarius'], ['carina', 'carina'], ['perseus', 'perseus'], ['scutum', 'scutum'], ['synod', 'synod'], ['rim', 'rim'], ['vael', 'vael'], ['concord', 'concord']]);
  const ops = new Heap<() => void>();
  const when = (year: number, f: () => void) => ops.push(year, f);

  // Seeds: where each lineage starts (the expeditions' destinations, settled at their arrival).
  const rimSeed = nearestTo(-46000, -9000), vaelSeed = nearestTo(24000, 14000), scutumSeed = nearestTo(-6000, -16000);
  const coreSystems = [...systems].sort((a, b) => R(a) - R(b)).slice(0, 6).map((s) => s.id);
  const hearthSeeds: Array<[number, number]> = [[P.sun, 25000], [P.pleiades, 17900], [P.polaris, 19060], [P.betelgeuse, 22960], [P.antares, 24500], [P.helix, 28000], [P.rigel, 35200], [P.vela, 37720]];
  const seeds: Seed[] = [
    ...hearthSeeds.map(([s, year]) => ({ lineage: 'hearth', stars: [s], year, ...ARK })),
    { lineage: 'orion', stars: [P.orionNeb, P.horsehead], year: 47880, ...ARK },
    { lineage: 'cygnus', stars: [P.deneb, P.northAmerica], year: 96000, ...ARK },
    { lineage: 'sagittarius', stars: [P.lagoon, P.eagle], year: 241000, ...ARK },
    { lineage: 'carina', stars: [P.carina, P.eta], year: 333000, ...ARK },
    { lineage: 'perseus', stars: [P.crab, P.rosette], year: 365000, ...ARK },
    { lineage: 'scutum', stars: [P.westerlund, scutumSeed], year: 792000, ...ARK },
    { lineage: 'synod', stars: [P.sgrA, ...coreSystems], year: 1054000, speed: 0.03, pause: 10000, only: (s) => R(s) < 13000 },
    { lineage: 'rim', stars: [rimSeed], year: 1620000, ...ARK },
    { lineage: 'vael', stars: [vaelSeed], year: -1500000, ...ARK, only: (s) => s.x > 9000 },
  ];
  // The settlement events of each lineage, and how often their arrivals are written down (years).
  const WAVES: Record<string, Array<[string, number]>> = {
    hearth: [['hearth-wave', 15000]], orion: [['orion-wave', 20000]], cygnus: [['cygnus-wave', 25000]], sagittarius: [['sag-wave', 25000]],
    carina: [['carina-wave', 25000]], perseus: [['perseus-wave', 25000]], scutum: [['scutum-wave', 30000]], synod: [['synod-wave', 20000]],
    rim: [['rim-wave', 40000]], vael: [['vael-wave', 50000]],
  };
  /** Arrivals written down by steps of their event: who holds a system settled is the lineage's realm at the time. */
  const settle = (arrivals: Iterable<Arrival>, waves: (a: Arrival) => [string, number] | null, override = false) => {
    const buckets = new Map<string, { year: number; ev: string; lin: Lineage; stars: number[] }>();
    for (const a of arrivals) {
      const w = waves(a);
      if (!w) continue;
      const [ev, step] = w, start = yearOf(ev), end = endOf(ev);
      const year = Math.min(end, Math.max(start, start + Math.ceil((a.year - start) / step - 1e-9) * step));
      const k = `${ev}|${year}|${a.lineage}`;
      let bk = buckets.get(k);
      if (!bk) buckets.set(k, (bk = { year, ev, lin: a.lineage as Lineage, stars: [] }));
      bk.stars.push(a.star);
    }
    for (const bk of buckets.values()) when(bk.year, () => {
      const free = bk.stars.filter((s) => override || !h.own.has(s));
      for (const s of free) lineage.set(s, bk.lin);
      h.give(bk.ev, bk.year, free, owner.get(bk.lin)!);
    });
  };
  const waveOf = (a: Arrival): [string, number] | null => {
    if (a.from === null && a.lineage !== 'vael') return null; // (seeds: given by their founding events)
    if (a.lineage === 'vael' && a.year <= yearOf('contact')) return ['contact', 1]; // (unknown until first contact)
    for (const [ev, step] of WAVES[a.lineage] ?? []) if (a.year >= yearOf(ev) - 1e-6 && a.year <= endOf(ev) + 1e-6) return [ev, step];
    return null;
  };
  settle(race(cat, graph, seeds, 3600000).values(), waveOf);

  // ---- The Hearth
  when(2068, () => { h.give('charter', 2068, [P.sun], 'terran'); lineage.set(P.sun, 'hearth'); });
  const expedition = (ev: string, from: number, to: number, by: Realm, settle: Realm | null, lin?: Lineage) => {
    when(yearOf(ev), () => h.lane(ev, yearOf(ev), from, to, true, by, true));
    if (settle) when(endOf(ev), () => { h.give(ev, endOf(ev), [to], settle); if (lin) lineage.set(to, lin); });
  };
  expedition('pleiades-x', P.sun, P.pleiades, 'terran', 'terran', 'hearth');
  expedition('polaris-x', P.sun, P.polaris, 'terran', 'terran', 'hearth');
  expedition('betelgeuse-x', P.sun, P.betelgeuse, 'terran', 'terran', 'hearth');
  expedition('antares-x', P.sun, P.antares, 'terran', 'terran', 'hearth');
  expedition('helix-x', P.sun, P.helix, 'terran', 'terran', 'hearth');
  expedition('rigel-x', P.sun, P.rigel, 'terran', 'terran', 'hearth');
  expedition('vela-x', P.sun, P.vela, 'terran', 'terran', 'hearth');
  expedition('orion-x', P.sun, P.orionNeb, 'terran', null);
  when(47880, () => { h.give('orion-x', 47880, [P.orionNeb, P.horsehead], 'terran'); lineage.set(P.orionNeb, 'orion'); lineage.set(P.horsehead, 'orion'); });
  when(61000, () => {
    owner.set('orion', 'orion');
    h.give('secession', 61000, h.of('terran').filter((s) => lineage.get(s) === 'orion'), 'orion');
  });
  when(62500, () => h.give('spur-war', 62500, within(P.rigel, 900).filter((s) => h.own.get(s) === 'terran'), 'orion'));
  when(64500, () => h.lane('spur-peace', 64500, P.sun, P.orionNeb, true, ''));
  when(71200, () => { h.give('betelgeuse', 71200, within(P.betelgeuse, 700), ''); h.lane('betelgeuse', 71200, P.sun, P.betelgeuse, false, ''); });
  when(92000, () => h.give('vy', 92000, within(P.vy, 900), ''));
  // Founding realms: the expedition's destination and its neighbour, for the lineage's realm.
  const found = (ev: string, stars: number[], realm: Realm, lin: Lineage) => when(yearOf(ev), () => {
    const taken = stars.filter((s) => h.own.has(s) && h.own.get(s) !== realm);
    if (taken.length) throw new Error(`${ev}: ${taken.join(', ')} already held.`);
    for (const s of stars) lineage.set(s, lin);
    h.give(ev, yearOf(ev), stars, realm);
  });
  expedition('cygnus-x', P.sun, P.deneb, 'terran', null);
  found('cygnus', [P.deneb, P.northAmerica], 'cygnus', 'cygnus');
  expedition('sag-x', P.sun, P.lagoon, 'terran', null);
  found('sag', [P.lagoon, P.eagle], 'sagittarius', 'sagittarius');
  expedition('carina-x', P.orionNeb, P.carina, 'orion', null);
  found('carina', [P.carina, P.eta], 'carina', 'carina');
  expedition('perseus-x', P.sun, P.crab, 'terran', null);
  found('perseus', [P.crab, P.rosette], 'perseus', 'perseus');
  // ---- Across the Arms
  when(612000, () => h.give('eta', 612000, within(P.eta, 1000), ''));
  expedition('scutum-x', P.lagoon, P.westerlund, 'sagittarius', null);
  found('scutum', [P.westerlund, scutumSeed], 'scutum', 'scutum');
  expedition('core-x', P.westerlund, P.sgrA, 'scutum', null);
  found('synod', [P.sgrA, ...coreSystems], 'synod', 'synod');
  when(1400000, () => h.give('two-arms', 1400000, h.of('orion').filter((s) => h.of('perseus').some((p) => dist(at(p), at(s)) < 2200)), 'perseus'));
  when(1430000, () => h.give('two-arms', 1430000, h.of('orion').filter((s) => h.of('perseus').some((p) => dist(at(p), at(s)) < 1800)), 'perseus'));
  const rimFrom = () => { const pe = h.of('perseus'); let best = pe[0]; for (const s of pe) if (dist(at(s), at(rimSeed)) < dist(at(best), at(rimSeed))) best = s; return best; };
  when(yearOf('rim-x'), () => h.lane('rim-x', yearOf('rim-x'), rimFrom(), rimSeed, true, 'perseus', true));
  found('rim', [rimSeed], 'rim', 'rim');
  // ---- The Core War
  let prewar = new Map<number, Realm>();
  when(2250000, () => { prewar = new Map(h.own); });
  const coreTake = (year: number, r: number) => when(year, () => h.give('core-war', year, systems.filter((s) => R(s) < r && ['sagittarius', 'scutum', 'carina', 'cygnus', 'orion'].includes(h.own.get(s.id) ?? '')).map((s) => s.id), 'synod'));
  coreTake(2300000, 15500); coreTake(2450000, 17500);
  when(2600000, () => h.give('westerlund', 2600000, within(P.westerlund, 3000).filter((s) => h.own.get(s) === 'scutum'), 'synod'));
  when(2900000, () => h.give('vael-war', 2900000, systems.filter((s) => s.x > 3000 && h.own.get(s.id) === 'synod').map((s) => s.id), 'vael'));
  const retake = (year: number, r: number) => when(year, () => {
    const back = new Map<Realm, number[]>();
    for (const s of systems) if (h.own.get(s.id) === 'synod' && R(s) > r) { const was = prewar.get(s.id); if (was && ARMS.includes(was)) (back.get(was) ?? back.set(was, []).get(was)!).push(s.id); }
    for (const [realm, stars] of back) h.give('siege', year, stars, realm);
  });
  retake(3100000, 16500); retake(3200000, 14500);
  // ---- The Concord
  when(3600000, () => {
    for (const l of ['hearth', 'orion', 'cygnus', 'sagittarius', 'carina', 'perseus', 'scutum', 'rim'] as Lineage[]) owner.set(l, 'concord');
    h.give('concord', 3600000, h.of((r) => ARMS.includes(r)), 'concord');
    // With faster ships, from every system held: the Concord and the Vael fill what is left.
    const taken = new Set(h.of('synod'));
    const fill: Seed[] = [
      { lineage: 'concord', stars: h.of('concord'), year: 3600000, speed: 0.03, pause: 20000 },
      { lineage: 'vael', stars: h.of('vael'), year: 3600000, speed: 0.02, pause: 40000 },
    ];
    settle(race(cat, graph, fill, 5500000, taken).values(), (a) => (a.from === null ? null : ['fill', 50000]));
  });
  when(5500000, () => {
    // The last systems, out of reach of the ships, settled from the nearest held.
    const rest = systems.filter((s) => !h.own.has(s.id));
    const got = new Map<Realm, number[]>();
    for (const s of rest) {
      let best: number | null = null;
      for (const [id] of h.own) if (inDisc(at(id)) && dist(at(id), s) < 7000 && (best === null || dist(at(id), s) < dist(at(best), s))) best = id;
      if (best !== null) { const r = h.own.get(best)!; (got.get(r) ?? got.set(r, []).get(r)!).push(s.id); lineage.set(s.id, lineage.get(best) ?? 'concord'); }
    }
    for (const [r, stars] of got) h.give('fill', 5500000, stars, r);
  });
  const hubs = () => {
    const pts: number[] = [P.sun, P.orionNeb, P.deneb, P.carina, P.crab, P.lagoon, P.westerlund, rimSeed, vaelSeed];
    for (let k = 0; k < 8; k++) { const th = (k / 8) * 2 * Math.PI + 0.3; pts.push(nearestTo(32000 * Math.cos(th), 32000 * Math.sin(th))); }
    for (let k = 0; k < 6; k++) { const th = (k / 6) * 2 * Math.PI; pts.push(nearestTo(17000 * Math.cos(th), 17000 * Math.sin(th))); }
    return [...new Set(pts)].filter((s) => h.own.has(s));
  };
  /** Lanes joining hubs: the shortest network joining them all, and each hub's second nearest. */
  const network = (ev: string, year: number, by: Realm) => {
    const H = hubs(), inTree = new Set([H[0]]), pairs = new Set<string>();
    const add = (a: number, b: number) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (!pairs.has(k)) { pairs.add(k); h.lane(ev, year, a, b, true, by); } };
    while (inTree.size < H.length) {
      let best: [number, number] | null = null;
      for (const a of inTree) for (const b of H) if (!inTree.has(b) && (!best || dist(at(a), at(b)) < dist(at(best[0]), at(best[1])))) best = [a, b];
      add(best![0], best![1]); inTree.add(best![1]);
    }
    for (const a of H) { const near = H.filter((b) => b !== a).sort((p, q) => dist(at(a), at(p)) - dist(at(a), at(q))); if (near[1] !== undefined) add(a, near[1]); }
  };
  when(4200000, () => network('lanes', 4200000, 'concord'));
  const dwarfFrom = nearestTo(36043 * 0.75, 6149 * 0.75);
  expedition('dwarf-x', dwarfFrom, P.sgrDwarf, 'concord', 'concord', 'concord');
  // ---- The Long Silence
  when(6000000, () => {
    h.closeAll('severing', 6000000);
    const back = new Map<Realm, number[]>();
    const oldRealm = (l: Lineage | undefined): Realm | null => (l === 'hearth' ? 'terran' : l && l !== 'concord' && l !== 'vael' && l !== 'synod' ? (l as Realm) : null);
    const roots = h.of('concord').filter((s) => oldRealm(lineage.get(s)));
    for (const s of h.of('concord')) {
      let r = oldRealm(lineage.get(s));
      if (!r) { let best = roots[0]; for (const q of roots) if (dist(at(q), at(s)) < dist(at(best), at(s))) best = q; r = oldRealm(lineage.get(best)) ?? 'terran'; }
      (back.get(r) ?? back.set(r, []).get(r)!).push(s);
    }
    for (const [r, stars] of back) h.give('severing', 6000000, stars, r);
    for (const l of owner.keys()) if (owner.get(l) === 'concord') owner.set(l, l === 'hearth' ? 'terran' : (l as Realm));
  });
  // The Fading: every hundred thousand years a share of the worlds falls silent (the same ones every time it is built).
  const random = seeded(12345);
  for (let year = 6100000; year <= 7800000; year += 100000) when(year, () => {
    const gone = [...h.own].filter(([s, r]) => s !== P.sun && s !== P.sgrA && r !== 'synod' && r !== 'havens' && r !== 'tide' && random() < (r === 'vael' ? 0.025 : 0.065)).map(([s]) => s);
    h.give('fading', year, gone, '');
  });
  when(6400000, () => {
    const taken = new Set([...h.of('synod')]);
    const tide: Seed[] = [{ lineage: 'tide', stars: [nearestTo(15000, -45000)], year: 6400000, speed: 0.035, pause: 1500, until: 8550000, only: (s) => s.id >= SYSTEM_ID_BASE }];
    const arrivals = race(cat, graph, tide, 8550000, taken);
    const buckets = new Map<number, number[]>();
    for (const a of arrivals.values()) { const y = Math.min(8550000, 6400000 + Math.ceil((a.year - 6400000) / 50000 - 1e-9) * 50000); (buckets.get(y) ?? buckets.set(y, []).get(y)!).push(a.star); }
    for (const [y, stars] of buckets) when(y, () => h.give('tide', y, stars.filter((s) => h.own.get(s) !== 'synod'), 'tide'));
  });
  const clusters: Array<[number, number]> = [[P.omegaCen, nearestTo(-16258, -12813)], [P.tuc47, nearestTo(-20565, -8437)], [P.hercules, nearestTo(-18032, 14383)]];
  for (const [c, from] of clusters) when(7200000, () => h.lane('clusters-x', 7200000, from, c, true, 'havens', true));
  when(7400000, () => h.give('havens', 7400000, clusters.map(([c]) => c), 'havens'));
  // ---- The Second Dawn
  when(8600000, () => h.give('unmaking', 8600000, h.of('tide'), ''));
  when(9000000, () => {
    h.give('synthesis', 9000000, h.of((r) => r === 'synod' || r === 'havens' || r === 'vael'), 'synthesis');
    // Every realm left settles again from what it holds, the Synthesis fastest.
    const realms = [...new Set(h.own.values())];
    const dawn: Seed[] = realms.map((r) => ({ lineage: r, stars: h.of(r), year: 9000000, speed: r === 'synthesis' ? 0.05 : 0.03, pause: r === 'synthesis' ? 10000 : 25000 }));
    // (Each realm's lineage is the realm itself from now on.)
    for (const r of realms) owner.set(r as Lineage, r);
    settle(race(cat, graph, dawn, 11000000).values(), (a) => (a.from === null ? null : ['dawn', 50000]));
  });
  when(10400000, () => network('new-lanes', 10400000, 'synthesis'));
  when(11000000, () => h.give('accession', 11000000, h.of((r) => r !== 'synthesis'), 'synthesis'));
  const cloudFrom = nearestTo(-1800, -50000, -3000);
  expedition('cloud-x', cloudFrom, P.lmc, 'synthesis', 'synthesis');
  for (let next = ops.pop(); next; next = ops.pop()) next[1]();
  return { ...h.history(), lineage };
}

// ---------------------------------------------------------------- the project

export function buildGalacticAges(reg: ProjectRegistry, dataDir: string, name = 'The Galactic Ages, 2026 to 12,000,000 (example)') {
  const { info, b } = startProject(reg, dataDir, name);
  const earth = b.space;
  const solar = b.commit(cmd.createSpaceMap(b.world, 'The Solar System', 'solar'));
  b.commit(cmd.setSolarLayout(b.world, solar, 'side-by-side'));
  const nearby = b.commit(cmd.createSpaceMap(b.world, 'The Near Stars', 'nearby'));
  // (Without the lines down to the plane: a thousand of them, once every star is settled, fall like rain.)
  b.commit(cmd.setSkyLook(b.world, nearby, { ...presetLook('scifi-hud'), dropLines: false }, 'Stars: sci-fi display'));
  const galaxy = b.commit(cmd.createSpaceMap(b.world, 'The Milky Way', 'galaxy', undefined, GALAXY));
  b.commit(cmd.setSkyLook(b.world, galaxy, presetLook('deep-field'), 'Stars: deep field'));
  // Realms, kinds of event and groups.
  const realm = {} as Record<Realm, string>;
  for (const [k, [n, c]] of Object.entries(REALMS) as Array<[Realm, readonly [string, string]]>) realm[k] = b.commit(cmd.createEntity(b.world, { type_id: 'polity', name: n, color: c }));
  const types = {} as Record<OwnType, string>;
  for (const [k, [n, c]] of Object.entries(OWN_TYPES) as Array<[OwnType, [string, string]]>) types[k] = b.commit(createEventType(b.world, n, { color: c }));
  for (const [g, c] of Object.entries(GROUP_COLOURS)) b.group(g, c);
  const ev: Record<string, string> = {};
  for (const e of EVENTS) {
    const type = e.type in OWN_TYPES ? types[e.type as OwnType] : e.type;
    const start = when(e.at), precision = typeof e.at === 'number' ? 'year' : 'day';
    ev[e.key] = event(b, e.name, start, e.to === undefined ? null : when(e.to), { type, group: e.group, about: e.about, precision });
  }
  const at = (key: string, year: number): Instant => (Math.round(year) === yearOf(key) ? when(EVENTS.find((e) => e.key === key)!.at) : Y(year));
  /** A map's history written as the app's own changes: stars held, lanes opened and closed. */
  const write = (space: string, hist: MapHistory) => {
    for (const c of hist.changes) b.commit(cmd.holdStars(b.world, { spaceId: space, stars: c.stars, entity: c.to ? realm[c.to] : '', mode: { kind: 'new', eventId: ev[c.ev], at: at(c.ev, c.year) } }));
    for (const l of hist.lanes) b.commit(cmd.setLane(b.world, { spaceId: space, a: l.a, b: l.b, on: l.on, entity: l.by ? realm[l.by] : '', mode: { kind: 'new', eventId: ev[l.ev], at: at(l.ev, l.year) }, grow: l.grow }));
  };
  // ---- The Earth: today's countries, united by the Charter; ten million years on, a sea in the African Rift.
  todaysCountries(b);
  const leaves = [...b.engine.partitionState(b.space, b.layer, Y(2068, 5, 9))].filter(([, st]) => st.value).map(([f]) => f);
  b.commit(cmd.assignFaces(b.world, b.engine, { spaceId: earth, layerId: b.layer, leaves, value: realm.terran, mode: { kind: 'new', eventId: ev.charter, at: null }, transition: { style: 'fade' } }));
  const RIFT: Array<[number, number]> = [[43.3, 12.6], [41.6, 11.6], [40.4, 9.9], [39.2, 8.1], [38.1, 6.2], [36.9, 4.1], [36.2, 2.0], [36.1, -0.2], [35.9, -2.6], [35.4, -5.0]];
  b.commit(cmd.addTerrainStamp(b.world, earth, { tool: 'sea', path: RIFT, radiusKm: 45, strength: 400, seed: 9, from: Y(10000000) }));
  b.commit(cmd.addCountries(b.world, b.engine, { spaceId: earth, layerId: b.layer, countries: [{ name: 'The new sea', polygons: [[band(RIFT, 45)]] }], mode: { kind: 'new', eventId: ev.ocean, at: null }, onlyFrom: [realm.terran], clear: true, transition: { style: 'fade', for: { n: 20000, unit: 'year' } } }));
  // ---- The Solar System, the near stars and the galaxy.
  write(solar, solarHistory());
  const nearCat = decodeStars(JSON.parse(readFileSync(join(dataDir, 'stars', 'nearby-50ly.json'), 'utf8')));
  const near = nearHistory(nearCat);
  write(nearby, near);
  const gal = galaxyHistory(galaxyCatalogue(GALAXY));
  write(galaxy, gal);
  // Wars and peace, members and allies; names.
  const relate = (kind: 'war' | 'part' | 'alliance', a: Realm, bb: Realm, key: string, until?: number | [number, number, number]) =>
    b.commit(cmd.relate(b.world, { kind, a: realm[a], b: realm[bb], mode: { kind: 'new', eventId: ev[key] }, until: until === undefined ? null : when(until) }));
  relate('war', 'terran', 'mars', 'martian-war', [2181, 9, 23]);
  relate('war', 'jovian', 'saturn', 'ring-war', [2236, 6, 6]);
  for (const r of ['mars', 'jovian', 'saturn', 'outer'] as Realm[]) relate('part', r, 'terran', 'sunward');
  relate('war', 'sirius', 'terran', 'sirius-war', 2789); relate('war', 'sirius', 'centauri', 'sirius-war', 2789);
  relate('war', 'lyra', 'arcturus', 'lyra-war', 4130);
  relate('war', 'terran', 'orion', 'spur-war', 64500);
  relate('war', 'perseus', 'orion', 'two-arms', 1452000);
  for (const r of ['sagittarius', 'scutum', 'carina', 'cygnus'] as Realm[]) relate('war', 'synod', r, 'core-war', 3300000);
  relate('war', 'vael', 'synod', 'vael-war', 3300000);
  relate('alliance', 'vael', 'concord', 'vael-join', 6000000);
  for (const r of [...ARMS, 'synod', 'vael'] as Realm[]) relate('war', 'tide', r, 'tide-war', 8600000);
  relate('war', 'tide', 'havens', 'havens', 8600000);
  b.commit(cmd.renameFrom(b.world, { entity: realm.terran, name: 'Terran Commonwealth', mode: { kind: 'new', eventId: ev.sunward } }));
  b.commit(cmd.renameFrom(b.world, { entity: realm.terran, name: 'The Hearth', mode: { kind: 'new', eventId: ev.compact } }));
  statistics(b, { solar, nearby, galaxy }, near, gal);
  shots(b, { earth, solar, nearby, galaxy });
  return info;
}

/** A band `km` wide on each side of a line of places (longitude, latitude): an outline to clear land along it. */
export function band(path: Array<[number, number]>, km: number): Array<[number, number]> {
  const left: Array<[number, number]> = [], right: Array<[number, number]> = [];
  path.forEach(([lon, lat], i) => {
    const [x0, y0] = path[Math.max(0, i - 1)], [x1, y1] = path[Math.min(path.length - 1, i + 1)];
    const k = Math.cos((lat * Math.PI) / 180), dx = (x1 - x0) * k, dy = y1 - y0, n = Math.hypot(dx, dy) || 1;
    const w = km / 111.32, nx = (-dy / n) * w / k, ny = (dx / n) * w;
    left.push([lon + nx, lat + ny]); right.push([lon - nx, lat - ny]);
  });
  return [...left, ...right.reverse()];
}

function statistics(b: Builder, maps: { solar: string; nearby: string; galaxy: string }, near: MapHistory, gal: MapHistory): void {
  b.commit(cmd.setMapStatistics(b.world, maps.solar, [
    stat('People in space', 'count', 'linear', [[Y(2029), 9], [Y(2041), 120], [Y(2071), 10000], [Y(2084), 260000], [Y(2101), 4.5e6], [Y(2126), 90e6], [Y(2150), 640e6], [Y(2190), 3.2e9], [Y(2251), 11e9], [Y(2300), 19e9]]),
  ]));
  const keys = (series: Array<[number, number]>, f: (y: number, v: number) => number) => series.map(([y, v]) => [Y(y), f(y, v)] as [Instant, number]);
  b.commit(cmd.setMapStatistics(b.world, maps.nearby, [
    stat('Settled stars', 'number', 'step', keys(near.held, (_y, v) => v)),
    // (The Earth's eleven billion, and each star settled growing to five billion over seven thousand years.)
    stat('People', 'count', 'linear', keys(near.held, (y, v) => 1.1e10 + Math.max(0, v - 1) * 5e9 * Math.min(1, Math.max(0, (y - 2300) / 7000) ** 1.5))),
  ]));
  b.commit(cmd.setMapStatistics(b.world, maps.galaxy, [
    stat('Settled regions', 'number', 'step', keys(gal.held, (_y, v) => v)),
    stat('Realms', 'number', 'step', keys(gal.realms, (_y, v) => v)),
    // (Each region of the map stands for some forty thousand worlds of ten billion once grown; fewer while young.)
    stat('People', 'count', 'linear', keys(gal.held, (y, v) => v * 4e14 * Math.min(1, (y / 3e6) ** 2 + 4e-4))),
  ]));
}

function shots(b: Builder, maps: { earth: string; solar: string; nearby: string; galaxy: string }): void {
  const SUN: [number, number, number] = [-26670, 0, 0];
  b.useMap(maps.earth);
  shot(b, {
    name: '1 Earth: the Terran Charter', title: 'The Galactic Ages', subtitle: 'Twelve million years among the stars: I. The Earth', look: 'night', projection: 'globe', precision: 'year', cities: false, eventsBox: { groups: ['The Solar Age'] },
    time: [[0, Y(2026)], [24, Y(2101)]], camera: [[0, { lon: 10, lat: 25, zoom: 0.35 }], [24, { lon: 130, lat: 15, zoom: 0.35 }]], captions: [],
  });
  b.useMap(maps.solar);
  shot(b, {
    name: '2 The Solar Age, 2029 to 2300', title: 'The Solar Age', subtitle: 'The Sun, its planets and their moons, side by side', precision: 'year', stats: 'People in space: {People in space}', eventsBox: { groups: ['The Solar Age', 'Sky and Earth'] },
    time: [[0, Y(2029)], [60, Y(2300)]], camera: [[0, { lon: 0, lat: 90, zoom: 0.1 }]], captions: [],
  });
  b.useMap(maps.nearby);
  shot(b, {
    name: '3 The Near Stars, 2290 to 10,000', title: 'The Near Stars', subtitle: 'Every star within fifty light-years of the Sun', precision: 'year', stats: 'Settled stars: {Settled stars}\nPeople: {People}', eventsBox: { groups: ['The Near Stars'] },
    time: [[0, Y(2290)], [20, Y(2700)], [40, Y(3600)], [60, Y(9900)]], camera: [[0, { lon: -60, lat: 35, zoom: 1.2 }], [60, { lon: 60, lat: 25, zoom: 0.25 }]], captions: [],
  });
  b.useMap(maps.galaxy);
  const STATS = 'Settled regions: {Settled regions}\nRealms: {Realms}\nPeople: {People}';
  shot(b, {
    name: '4 The Hearth goes out, 9,000 to 400,000', title: 'The Hearth', subtitle: 'The first ships leave the Sun\'s neighbourhood', precision: 'year', stats: STATS, eventsBox: { groups: ['The Hearth'] },
    time: [[0, Y(9000)], [22, Y(50000)], [50, Y(400000)]], camera: [[0, { lon: 180, lat: 60, zoom: 5, target: SUN }], [22, { lon: 175, lat: 55, zoom: 4.2, target: [-26800, -300, 0] }], [50, { lon: 160, lat: 50, zoom: 2.3, target: [-24000, 0, 0] }]], captions: [],
  });
  shot(b, {
    name: '5 Fire in Orion, 60,000 to 100,000', title: 'Fire in Orion', subtitle: 'A secession, a war, a supernova and a hypernova', precision: 'year', stats: STATS, eventsBox: { groups: ['The Hearth'] },
    time: [[0, Y(58000)], [30, Y(100000)]], camera: [[0, { lon: 175, lat: 65, zoom: 4.7, target: [-27230, -310, 0] }], [30, { lon: 195, lat: 55, zoom: 4.1, target: [-27700, -1200, 0] }]], captions: [],
  });
  shot(b, {
    name: '6 Across the Arms, 400,000 to 2 million', title: 'Across the Arms', subtitle: 'Realms along the spiral arms, a people of machines at the core, and the Vael', precision: 'year', stats: STATS, eventsBox: { groups: ['Across the Arms'] },
    time: [[0, Y(400000)], [60, Y(2000000)]], camera: [[0, { lon: 170, lat: 60, zoom: 1.2, target: [-20000, 0, 0] }], [60, { lon: 200, lat: 70, zoom: 0.35, target: [-6000, 0, 0] }]], captions: [],
  });
  shot(b, {
    name: '7 The Core War, 2.2 to 3.4 million', title: 'The Core War', subtitle: 'The Synod against the arms', precision: 'year', stats: STATS, eventsBox: { groups: ['The Core War'] },
    time: [[0, Y(2200000)], [45, Y(3400000)]], camera: [[0, { lon: 180, lat: 89, zoom: 1.1, target: [-4000, 0, 0] }]], captions: [],
  });
  shot(b, {
    name: '8 The Concord, 3.5 to 6 million', title: 'The Concord', subtitle: 'One law from the Hearth to the Outer Arm', precision: 'year', stats: STATS, eventsBox: { groups: ['The Concord'] },
    time: [[0, Y(3500000)], [50, Y(5900000)]], camera: [[0, { lon: 140, lat: 55, zoom: 0.25 }], [50, { lon: 260, lat: 65, zoom: 0.25 }]], captions: [],
  });
  shot(b, {
    name: '9 The Long Silence, 6 to 8.6 million', title: 'The Long Silence', subtitle: 'The lanes fail, the worlds fade, and the Tide comes in', precision: 'year', stats: STATS, eventsBox: { groups: ['The Long Silence'] },
    time: [[0, Y(5950000)], [50, Y(8650000)]], camera: [[0, { lon: 260, lat: 40, zoom: 0.3 }], [50, { lon: 330, lat: 30, zoom: 0.3 }]], captions: [],
  });
  shot(b, {
    name: '10 The Second Dawn, 8.6 to 12 million', title: 'The Second Dawn', subtitle: 'The galaxy settled again, and the voyage to the Large Magellanic Cloud', precision: 'year', stats: STATS, eventsBox: { groups: ['The Second Dawn'] },
    time: [[0, Y(8600000)], [40, Y(11200000)], [60, Y(12000000)]], camera: [[0, { lon: 330, lat: 60, zoom: 0.3 }], [40, { lon: 360, lat: 55, zoom: 0.2 }], [60, { lon: 380, lat: 25, zoom: -1.3, target: [0, -60000, -40000] }]], captions: [],
  });
  shot(b, {
    name: '11 Twelve million years', title: 'The Galactic Ages', subtitle: 'From the Sun to the Large Magellanic Cloud', precision: 'year', stats: STATS,
    time: [[0, Y(9000)], [30, Y(1000000)], [60, Y(5000000)], [90, Y(12000000)]], camera: [[0, { lon: 180, lat: 70, zoom: 2.2, target: SUN }], [30, { lon: 200, lat: 75, zoom: 0.6, target: [-15000, 0, 0] }], [90, { lon: 290, lat: 80, zoom: 0.2 }]], captions: [],
  });
}
