// The End of Empires, 1945 to 1999 (D178): an example project of the whole world. Today's countries as they are
// drawn in 2026; in 1945 the colonies held by their empires (the British, French, Dutch, Belgian, Portuguese and
// Spanish, Japan's to its surrender, the Soviet Union's republics, Yugoslavia, Czechoslovakia), and the pieces the
// empires cut out of today's countries (Spanish Morocco and Tangier, Goa and French India, Aden, the Golan, Crimea,
// the Ryukyus, Zanzibar, West New Guinea, Newfoundland). Then every independence, partition, union and break-up to
// 1999, with the names countries had then; the wars as fronts, arrows and battles; the leaders on their journeys;
// the members of the United Nations, the new states and the people still ruled from abroad counted; and ten shots.
import type { ProjectRegistry } from '../server/projects.ts';
import * as cmd from '../domain/commands.ts';
import type { Instant } from '../core-time/index.ts';
import type { TransitionSpec } from '../temporal-engine/engine.ts';
import { startProject, todaysCountries, event, take, startWith, annex, rename, featureLayer, feature, journey, stat, shot, outline, circle, later, D, type Builder, type Place } from './kit.ts';

type Ring = Array<[number, number]>;

/** A new state's colours fading in over a month and a half; a war's front advancing over its event, or as long as given. */
const FADE: TransitionSpec = { style: 'fade', for: { n: 45, unit: 'day' } };
const FRONT: TransitionSpec = { style: 'border', easing: 'smooth' };
const frontFor = (n: number, unit: 'day' | 'month' = 'day'): TransitionSpec => ({ style: 'border', easing: 'smooth', for: { n, unit } });

/** A date written as text (year-month-day), at noon unless an hour is given. */
export const T = (s: string, hour = 12): Instant => { const [y, m, d] = s.split('-').map(Number); return D(y, m ?? 1, d ?? 1, hour); };

function inside([x, y]: [number, number], ring: Ring): boolean {
  let inn = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn;
  }
  return inn;
}
const middle = (ring: Ring): [number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
};

/** The pieces (islands, a peninsula drawn apart) of a country of today whose middle lies inside a ring, or outside it. */
function pieces(b: Builder, country: string, name: string, ring: Ring, outside = false): cmd.CountryToAdd {
  const polygons = b.shape(country).polygons.filter((p) => inside(middle(p[0]), ring) !== outside);
  if (!polygons.length) throw new Error(`No piece of ${country} for ${name}.`);
  return { name, polygons };
}
/** An outline with holes. */
const holed = (name: string, ring: Ring, ...holes: Ring[]): cmd.CountryToAdd => ({ name, polygons: [[ring, ...holes]] });

/** Outlines of land the empires' borders cut out of today's countries (running out to sea, so the coast keeps them). */
const R = {
  // Spanish Morocco, the Tarfaya strip (Cape Juby) and the Spanish Sahara, out of today's Morocco.
  spanishMorocco: [[-6.40, 34.95], [-6.40, 35.98], [-2.30, 35.98], [-2.35, 35.12], [-3.50, 34.95], [-4.50, 34.95], [-5.50, 34.90]],
  tarfaya: [[-13.6, 27.667], [-8.67, 27.667], [-8.67, 28.25], [-10.0, 28.55], [-11.15, 28.72], [-11.6, 28.6], [-13.6, 28.0]],
  spanishSahara: [[-18.0, 20.5], [-8.0, 20.5], [-8.0, 27.667], [-18.0, 27.667]],
  saharaSouth: [[-18.0, 20.5], [-12.0, 20.5], [-12.0, 23.0], [-13.0, 23.0], [-15.6, 24.0], [-18.0, 24.0]],
  // Aden and its protectorate, out of today's Yemen (Socotra with it).
  southYemen: [[43.40, 12.20], [43.48, 12.80], [44.10, 13.30], [44.70, 13.75], [45.40, 14.20], [46.00, 14.60], [46.60, 15.30], [47.00, 16.50], [48.00, 17.70], [52.30, 19.00], [54.80, 17.00], [54.80, 11.50], [43.40, 11.50]],
  // The Golan, Syrian until 1967 (today's Israel in Natural Earth); Sinai, east of the canal.
  golan: [[35.64, 32.69], [35.66, 32.84], [35.63, 32.92], [35.62, 33.10], [35.66, 33.26], [35.82, 33.34], [35.97, 33.20], [35.97, 32.68]],
  sinai: [[32.33, 31.60], [32.36, 31.00], [32.30, 30.60], [32.36, 30.30], [32.57, 29.95], [32.62, 29.50], [33.50, 27.70], [34.30, 27.50], [35.00, 28.00], [35.00, 31.70]],
  // Vietnam either side of the 17th parallel, and the Viet Bac.
  northVietnam: [[100.0, 17.0], [110.0, 17.0], [110.0, 24.0], [100.0, 24.0]],
  southVietnam: [[100.0, 7.0], [110.0, 7.0], [110.0, 17.0], [100.0, 17.0]],
  vietBac: [[103.6, 21.6], [104.6, 22.9], [105.6, 23.2], [106.7, 22.9], [107.1, 22.0], [106.3, 21.5], [105.6, 21.6], [105.2, 21.3], [104.3, 21.2]],
  // West New Guinea (the Dutch half of the island, Biak, Raja Ampat), not the Aru, Kei or Tanimbar islands.
  westNewGuinea: [[129.5, 0.6], [141.5, 0.6], [141.5, -9.6], [137.5, -9.6], [136.5, -7.0], [135.2, -5.0], [133.6, -4.3], [131.8, -3.6], [131.3, -2.45], [129.5, -2.45]],
  zanzibar: [[39.0, -4.7], [40.1, -4.7], [40.1, -6.6], [39.0, -6.6]],
  peninsularMalaysia: [[98.0, 0.5], [105.0, 0.5], [105.0, 7.5], [98.0, 7.5]],
  crimea: [[32.0, 44.0], [37.0, 44.0], [37.0, 46.4], [32.0, 46.4]],
  ryukyus: [[122.0, 23.5], [131.5, 23.5], [131.5, 29.0], [122.0, 29.0]],
  amami: [[128.0, 27.0], [130.5, 27.0], [130.5, 29.0], [128.0, 29.0]],
  okinawa: [[122.0, 23.5], [131.5, 23.5], [131.5, 27.0], [122.0, 27.0]],
  bonins: [[140.5, 24.0], [143.0, 24.0], [143.0, 28.0], [140.5, 28.0]],
  newfoundland: [[-59.6, 46.4], [-52.4, 46.4], [-52.4, 52.1], [-59.6, 52.1]],
  labrador: [[-57.1, 51.45], [-63.8, 52.0], [-64.3, 51.6], [-66.9, 52.7], [-67.8, 52.9], [-67.3, 54.5], [-66.6, 55.0], [-65.4, 55.9], [-64.6, 57.0], [-64.0, 58.5], [-64.5, 60.6], [-60.0, 60.4], [-55.0, 54.0], [-55.4, 51.6]],
  // The Soviet zone of Germany: from the Baltic (Fehmarn left out) to the Czech border, the Elbe and the Harz; West Berlin.
  eastGermany: [[10.92, 53.96], [11.10, 54.15], [11.60, 54.25], [12.20, 54.55], [13.00, 54.80], [14.60, 54.80], [15.30, 53.00], [15.30, 50.60], [12.40, 50.10], [12.10, 50.32], [11.88, 50.42], [11.38, 50.50], [11.15, 50.34], [10.60, 50.30], [10.30, 50.45], [9.93, 50.72], [10.00, 50.84], [10.18, 51.00], [10.20, 51.15], [9.95, 51.30], [9.95, 51.38], [10.27, 51.49], [10.64, 51.58], [10.58, 51.80], [10.62, 51.90], [10.66, 52.00], [11.00, 52.13], [11.06, 52.22], [10.92, 52.43], [10.95, 52.60], [11.05, 52.80], [11.25, 52.90], [11.50, 52.98], [11.60, 53.03], [11.25, 53.12], [10.95, 53.20], [10.72, 53.33], [10.60, 53.37], [10.75, 53.45], [10.85, 53.55], [10.80, 53.70], [10.86, 53.86]],
  westBerlin: [[13.11, 52.53], [13.21, 52.62], [13.30, 52.66], [13.37, 52.58], [13.38, 52.53], [13.375, 52.51], [13.42, 52.50], [13.47, 52.46], [13.50, 52.42], [13.40, 52.38], [13.30, 52.41], [13.09, 52.41], [13.12, 52.48]],
  saar: [[6.36, 49.47], [6.58, 49.63], [7.00, 49.65], [7.35, 49.62], [7.42, 49.35], [7.30, 49.12], [6.85, 49.15], [6.55, 49.20]],
  tibet: [[78.2, 32.4], [79.0, 34.0], [80.3, 35.3], [84.0, 35.6], [89.5, 36.0], [91.5, 34.8], [93.5, 33.0], [97.5, 32.5], [99.2, 31.0], [99.0, 28.5], [98.8, 26.0], [94.0, 25.0], [88.0, 26.0], [80.0, 28.0], [77.8, 31.0]],
  hyderabad: [[74.6, 18.6], [75.8, 20.2], [77.5, 21.0], [79.3, 20.4], [80.5, 19.2], [81.2, 17.8], [80.5, 17.0], [79.5, 16.2], [78.1, 15.6], [76.8, 15.6], [76.2, 16.4], [75.4, 17.0], [74.9, 17.8]],
  sikkim: [[88.0, 27.05], [88.9, 27.05], [88.95, 27.9], [88.6, 28.15], [88.0, 27.9]],
  katanga: [[21.8, -7.0], [24.0, -6.6], [26.0, -5.6], [27.5, -5.0], [29.3, -5.0], [30.8, -6.5], [30.8, -13.6], [21.5, -13.6], [21.5, -11.0]],
  biafra: [[6.05, 4.2], [9.6, 4.2], [9.6, 6.9], [8.8, 6.95], [7.6, 7.1], [6.9, 6.95], [6.78, 6.15], [6.55, 5.5], [6.3, 5.0], [6.1, 4.6]],
  biafraCore: [[6.75, 5.25], [7.65, 5.25], [7.65, 6.10], [6.75, 6.10]],
  // The Ogaden as far as the Somalis took it in 1977: Jijiga, not Harar or Dire Dawa.
  ogaden: [[42.4, 9.2], [42.65, 9.55], [43.2, 9.6], [44.0, 9.1], [45.5, 8.0], [48.0, 8.0], [45.0, 5.0], [43.5, 4.4], [42.0, 4.0], [41.0, 4.2], [41.6, 6.0], [42.3, 7.5], [41.8, 8.6]],
  korea38N: [[124.0, 38.0], [131.0, 38.0], [131.0, 43.2], [124.0, 43.2]],
  korea38S: [[124.0, 33.0], [131.0, 33.0], [131.0, 38.0], [124.0, 38.0]],
  koreaSouthOf38: [[124.0, 38.0], [131.0, 38.0], [131.0, 36.1], [128.5, 36.0], [128.4, 35.2], [128.2, 34.6], [127.5, 34.0], [124.0, 34.0]],
  koreaToTheYalu: [[124.0, 33.0], [131.0, 33.0], [131.0, 41.0], [128.5, 41.3], [126.5, 41.0], [124.0, 40.3]],
  koreaNorthOf37: [[124.0, 37.0], [131.0, 37.2], [131.0, 43.0], [124.0, 43.0]],
} satisfies Record<string, Ring>;
const out = (name: keyof typeof R, label?: string) => outline(label ?? name, R[name]);
const dots = (name: string, ...spots: Array<[Place, number]>) => outline(name, ...spots.map(([p, km]) => circle(p, km)));
const FRENCH_INDIA = () => dots('French India', [[79.83, 11.93], 9], [[79.83, 10.92], 7], [[75.54, 11.70], 4], [[82.21, 16.73], 4]);
const CHANDERNAGORE = () => dots('Chandernagore', [[88.36, 22.87], 4]);
const GOA = () => outline('Goa, Daman and Diu', [[73.30, 14.85], [74.12, 14.85], [74.34, 15.30], [74.28, 15.78], [73.85, 15.82], [73.30, 15.82]], circle([72.85, 20.41], 6), circle([70.98, 20.72], 5));
const DADRA = () => dots('Dadra and Nagar Haveli', [[73.02, 20.22], 12]);
const TANGIER = () => dots('Tangier', [[-5.83, 35.75], 14]);
const IFNI = () => dots('Ifni', [[-9.95, 29.30], 22]);
const GAZA = (b: Builder) => pieces(b, 'Palestine', 'The Gaza Strip', [[34.0, 31.0], [34.7, 31.0], [34.7, 31.8], [34.0, 31.8]]);
const WEST_BANK = (b: Builder) => pieces(b, 'Palestine', 'The West Bank', [[34.8, 31.2], [35.7, 31.2], [35.7, 32.7], [34.8, 32.7]]);
const OSLO_TOWNS = () => dots('Palestinian towns', [[35.26, 32.22], 4], [[35.20, 31.90], 4], [[35.30, 32.46], 3.5], [[35.03, 32.31], 3], [[34.97, 32.19], 2.5], [[35.20, 31.70], 3]);

/** The empires of 1945: the homeland (today's country, named for its empire until it ends), colour and colonies. */
const EMPIRES: Record<string, { home: string; name: string; color: string; colonies: string[] }> = {
  uk: { home: 'United Kingdom', name: 'British Empire', color: '#e58c9a', colonies: ['India', 'Pakistan', 'Bangladesh', 'Siachen Glacier', 'Myanmar', 'Sri Lanka', 'Malaysia', 'Singapore', 'Brunei', 'Hong Kong', 'Israel', 'Palestine', 'Jordan', 'Sudan', 'South Sudan', 'Kenya', 'Uganda', 'Tanzania', 'Malawi', 'Zambia', 'Zimbabwe', 'Botswana', 'Lesotho', 'Eswatini', 'Ghana', 'Nigeria', 'Sierra Leone', 'The Gambia', 'Somaliland', 'Somalia', 'Eritrea', 'Libya', 'Cyprus', 'Turkish Republic of Northern Cyprus', 'Malta', 'Jamaica', 'Trinidad and Tobago', 'The Bahamas', 'Barbados', 'Belize', 'Guyana', 'Grenada', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Antigua and Barbuda', 'Saint Kitts and Nevis', 'Anguilla', 'Dominica', 'Fiji', 'Solomon Islands', 'Kiribati', 'Tuvalu', 'Tonga', 'Vanuatu', 'Mauritius', 'Seychelles', 'Maldives', 'Kuwait', 'Bahrain', 'Qatar', 'United Arab Emirates', 'Bermuda', 'Cayman Islands', 'Turks and Caicos Islands', 'British Virgin Islands', 'Montserrat', 'Saint Helena', 'Falkland Islands', 'South Georgia and the South Sandwich Islands', 'British Indian Ocean Territory', 'Pitcairn Islands', 'Guernsey', 'Jersey', 'Isle of Man'] },
  fr: { home: 'France', name: 'French colonial empire', color: '#4a78c2', colonies: ['Algeria', 'Morocco', 'Tunisia', 'Senegal', 'Mauritania', 'Mali', 'Guinea', 'Ivory Coast', 'Burkina Faso', 'Niger', 'Benin', 'Togo', 'Cameroon', 'Chad', 'Central African Republic', 'Republic of the Congo', 'Gabon', 'Madagascar', 'Comoros', 'Djibouti', 'Vietnam', 'Laos', 'Cambodia', 'Syria', 'Lebanon', 'New Caledonia', 'French Polynesia', 'Wallis and Futuna', 'Saint Pierre and Miquelon', 'Saint Martin', 'Saint Barthélemy', 'French Southern and Antarctic Lands'] },
  nl: { home: 'Netherlands', name: 'Netherlands', color: '#f08c2e', colonies: ['Indonesia', 'Suriname', 'Aruba', 'Curaçao', 'Sint Maarten'] },
  be: { home: 'Belgium', name: 'Belgium', color: '#e3c33a', colonies: ['Democratic Republic of the Congo', 'Rwanda', 'Burundi'] },
  pt: { home: 'Portugal', name: 'Portuguese Empire', color: '#3f9a57', colonies: ['Angola', 'Mozambique', 'Guinea-Bissau', 'Cape Verde', 'São Tomé and Príncipe', 'Timor-Leste', 'Macau'] },
  es: { home: 'Spain', name: 'Spain', color: '#c9a227', colonies: ['Western Sahara', 'Equatorial Guinea'] },
  jp: { home: 'Japan', name: 'Empire of Japan', color: '#9e7b6b', colonies: ['South Korea', 'North Korea', 'Taiwan'] },
  us: { home: 'United States of America', name: 'United States of America', color: '#6d8fb3', colonies: ['Philippines', 'Puerto Rico', 'Guam', 'American Samoa', 'United States Virgin Islands', 'Northern Mariana Islands', 'Federated States of Micronesia', 'Marshall Islands', 'Palau'] },
  au: { home: 'Australia', name: 'Australia', color: '#8fa86d', colonies: ['Papua New Guinea', 'Nauru', 'Norfolk Island', 'Ashmore and Cartier Islands', 'Australian Indian Ocean Territories', 'Heard Island and McDonald Islands'] },
  nz: { home: 'New Zealand', name: 'New Zealand', color: '#7fae9f', colonies: ['Samoa', 'Cook Islands', 'Niue'] },
  dk: { home: 'Denmark', name: 'Denmark', color: '#b0606a', colonies: ['Greenland', 'Faroe Islands'] },
  za: { home: 'South Africa', name: 'South Africa', color: '#b49a6a', colonies: ['Namibia'] },
  su: { home: 'Russia', name: 'Soviet Union', color: '#b71c1c', colonies: ['Ukraine', 'Belarus', 'Estonia', 'Latvia', 'Lithuania', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan'] },
  yu: { home: 'Serbia', name: 'Yugoslavia', color: '#7e57c2', colonies: ['Slovenia', 'Croatia', 'Bosnia and Herzegovina', 'Montenegro', 'North Macedonia', 'Kosovo'] },
  cs: { home: 'Czech Republic', name: 'Czechoslovakia', color: '#5c6bc0', colonies: ['Slovakia'] },
};

const SOUTH_ASIA = 'South Asia', EAST_ASIA = 'East Asia', SE_ASIA = 'Southeast Asia', INDOCHINA = 'Indochina', ME = 'The Middle East', AFRICA = 'Africa', SOUTHERN_AFRICA = 'Southern Africa', AMERICAS = 'The Americas and the Pacific', EUROPE = 'Europe and the Soviet Union', WORLD = 'The world';
const ASIA = [SOUTH_ASIA, EAST_ASIA, SE_ASIA, INDOCHINA];

export function buildEmpires(reg: ProjectRegistry, dataDir: string, name = 'The End of Empires, 1945 to 1999 (example)') {
  const { info, b } = startProject(reg, dataDir, name);
  b.commit(cmd.setWorldBasemap(b.world, b.space, 'natural-earth'));
  b.commit(cmd.updateLayer(b.world, b.layer, { name: 'States' }));
  b.commit(cmd.setLayerClipToLand(b.world, b.layer, true));
  b.commit(cmd.setLayerLook(b.world, b.layer, { fillOpacity: 0.72, borderWidth: 1.2 }));
  b.commit(cmd.setWorldShow(b.world, b.space, { minLakeKm2: 5000 }));
  todaysCountries(b);
  const E = empires(b);
  const L: Layers = {
    moves: featureLayer(b, 'Wars and flights', 'line', { color: '#c0392b', width: 13, look: 'arrow', showName: false }),
    fights: featureLayer(b, 'Battles', 'point', { color: '#ffd23f', symbol: 'battle', size: 15, showName: true }),
  };
  const born = story(b, E, L);
  statistics(b, born);
  characters(b);
  shots(b);
  return info;
}

/** The world of 1945: each empire's colonies, and the pieces the empires held of countries of today. */
function empires(b: Builder): Record<string, string> {
  const E: Record<string, string> = {};
  // Spain's part of Morocco first (so that France's protectorate is the rest): the north, Ifni, Cape Juby and the Sahara.
  const MA = b.country('Morocco');
  E.es = b.country('Spain');
  startWith(b, E.es, [out('spanishMorocco', 'Spanish Morocco'), IFNI(), out('tarfaya', 'Cape Juby'), out('spanishSahara', 'Spanish Sahara')], [MA]);
  E.tangier = b.country('Tangier International Zone', '#8fb3a9');
  startWith(b, E.tangier, [TANGIER()], [E.es]);
  for (const [key, e] of Object.entries(EMPIRES)) {
    const id = b.country(e.home);
    b.commit(cmd.updateEntity(b.world, id, { name: e.name, color: e.color }));
    E[key] = id;
    startWith(b, id, e.colonies.map((c) => b.shape(c)), e.colonies.map((c) => b.country(c)));
  }
  const { uk, fr, pt } = E;
  // British India's princely states Hyderabad and Sikkim, and the French and Portuguese towns.
  E.hyd = b.country('Hyderabad', '#c9a36a');
  startWith(b, E.hyd, [out('hyderabad', 'Hyderabad')], [uk]);
  E.sikkim = b.country('Sikkim', '#d1a3a4');
  startWith(b, E.sikkim, [out('sikkim', 'Sikkim')], [uk]);
  startWith(b, fr, [FRENCH_INDIA(), CHANDERNAGORE()], [uk]);
  startWith(b, pt, [GOA(), DADRA()], [uk]);
  // Aden, the Golan (Syrian, so under France), Newfoundland.
  E.ny = b.country('Yemen');
  b.commit(cmd.updateEntity(b.world, E.ny, { name: 'North Yemen' }));
  startWith(b, uk, [out('southYemen', 'Aden')], [E.ny]);
  startWith(b, fr, [out('golan', 'The Golan')], [uk]);
  startWith(b, uk, [pieces(b, 'Canada', 'Newfoundland', R.newfoundland), out('labrador', 'Labrador')], [b.country('Canada')]);
  // China (the Republic) with Tibet on its own; Germany and Austria occupied.
  E.cn = b.country('China');
  b.commit(cmd.updateEntity(b.world, E.cn, { name: 'Republic of China' }));
  E.tibet = b.country('Tibet', '#90a4ae');
  startWith(b, E.tibet, [out('tibet', 'Tibet')], [E.cn]);
  E.de = b.country('Germany');
  b.commit(cmd.updateEntity(b.world, E.de, { name: 'Allied-occupied Germany' }));
  E.at = b.country('Austria');
  b.commit(cmd.updateEntity(b.world, E.at, { name: 'Allied-occupied Austria' }));
  return E;
}

interface Layers { moves: string; fights: string }

function story(b: Builder, E: Record<string, string>, L: Layers): Instant[] {
  for (const [g, c] of [[SOUTH_ASIA, '#c96a3a'], [EAST_ASIA, '#d1495b'], [SE_ASIA, '#2a9d8f'], [INDOCHINA, '#e9c46a'], [ME, '#b8a05a'], [AFRICA, '#3f9a57'], [SOUTHERN_AFRICA, '#6a994e'], [AMERICAS, '#4a78c2'], [EUROPE, '#c62828'], [WORLD, '#555555']] as Array<[string, string]>) b.group(g, c);
  const id = (n: string) => b.country(n);
  const ev = (name: string, start: Instant, end: Instant | null, about: string, group: string, type = 'general') => event(b, name, start, end, { about, group, type });
  const born: Instant[] = [];
  /** A country's independence: its land (today's outline, or the pieces given) from its rulers, and its name then. */
  const free = (date: string, country: string, from: string[], about: string, group: string, o: { name?: string; as?: string; regions?: cmd.CountryToAdd[]; hour?: number; newState?: boolean; fadeDays?: number } = {}) => {
    const e = ev(o.name ?? `${o.as ?? country} independent`, T(date, o.hour), null, about, group, 'founding');
    const to = id(country);
    take(b, e, to, from, o.regions ?? [b.shape(country)], null, o.fadeDays ? { style: 'fade', for: { n: o.fadeDays, unit: 'day' } } : FADE);
    if (o.as) rename(b, e, to, o.as);
    if (o.newState !== false) born.push(T(date, o.hour));
    return e;
  };
  /** A front or a flight drawn as an arrow over `days`, gone at `until`. */
  const arrow = (eventId: string, name: string, route: Place[], at: Instant, days: number, until: Instant, color?: string) =>
    feature(b, L.moves, name, [route], eventId, { at, animUntil: later(at, days), until, style: color ? { color } : undefined });
  const battle = (eventId: string, name: string, place: Place, when: Instant, days = 365) =>
    feature(b, L.fights, name, [[place]], eventId, { at: when, anim: 'grow', animUntil: later(when, 20), until: later(when, days) });
  const { uk, fr, nl, be, pt, es, jp, us, au, nz, za, su, yu, cs, cn, de, at, ny, tangier } = E;
  const ALLIED = '#1565c0', REFUGEES = '#ef6c00', RED = '#b71c1c';

  // ------------------------------------------------------------ 1945 to 1949: the war's end; Asia first
  ev('The United Nations', T('1945-10-24'), null, 'The Charter comes into force with 51 members; it promises the self-determination of peoples. About 750 million people, nearly a third of humanity, live in territories ruled from abroad.', WORLD, 'founding');
  ev('Indonesia proclaims its independence', T('1945-08-17', 10), null, 'Sukarno and Hatta read the proclamation in Jakarta two days after Japan\'s surrender; the Dutch return, and four years of war follow.', SE_ASIA);
  const surrender = ev('Japan surrenders', T('1945-09-02', 9), null, 'On the USS Missouri in Tokyo Bay. Japan\'s empire is undone: Korea is divided at the 38th parallel between Soviet and American forces, Taiwan is handed to the Republic of China, the Ryukyu and Bonin Islands are held by the Americans. Japan itself is occupied.', EAST_ASIA, 'treaty');
  take(b, surrender, su, [jp], [out('korea38N', 'Korea north of the 38th parallel')], null, FADE);
  take(b, surrender, us, [jp], [out('korea38S', 'Korea south of the 38th parallel'), pieces(b, 'Japan', 'The Ryukyus', R.ryukyus), pieces(b, 'Japan', 'The Bonins', R.bonins)], null, FADE);
  take(b, surrender, cn, [jp], [b.shape('Taiwan')], T('1945-10-25'), FADE);
  rename(b, surrender, jp, 'Occupied Japan');
  ev('Ho Chi Minh proclaims Vietnam', T('1945-09-02', 14), null, 'In Hanoi\'s Ba Dinh Square, quoting the American Declaration of Independence. The French return to the south within weeks.', INDOCHINA);
  free('1946-04-17', 'Syria', [fr], 'The last French troops leave Syria; the Golan is Syrian.', ME, { regions: [b.shape('Syria'), out('golan', 'The Golan')] });
  free('1946-12-31', 'Lebanon', [fr], 'The last French troops leave Lebanon.', ME);
  free('1946-05-25', 'Jordan', [uk], 'The Emirate of Transjordan becomes the Hashemite Kingdom of Transjordan.', ME, { as: 'Transjordan', name: 'Transjordan independent' });
  free('1946-07-04', 'Philippines', [us], 'The Philippines become independent of the United States, as promised in 1934.', SE_ASIA);
  const fu = ev('The French Union', T('1946-10-27'), null, 'The Fourth Republic\'s constitution makes the colonies parts of a "French Union".', AFRICA, 'founding');
  rename(b, fu, fr, 'French Union');
  const NV = b.country('North Vietnam', '#d0473a'), SV = b.country('South Vietnam', '#f3c623');
  // (Laos apart from North Vietnam in colour; reunited Vietnam in North Vietnam's.)
  b.commit(cmd.updateEntity(b.world, id('Laos'), { color: '#8bc34a' }));
  b.commit(cmd.updateEntity(b.world, id('Vietnam'), { color: '#d0473a' }));
  b.commit(cmd.updateEntity(b.world, NV, { notes: 'The Democratic Republic of Vietnam, proclaimed by Ho Chi Minh in 1945.' }));
  const indochina = ev('The First Indochina War', T('1946-12-19'), T('1954-07-21'), 'The Viet Minh attack in Hanoi and withdraw to the hills of the Viet Bac: eight years of war against France.', INDOCHINA, 'war');
  arrow(indochina, 'The Viet Minh to the Viet Bac', [[105.85, 21.03], [105.6, 21.5], [105.3, 21.9]], T('1946-12-20'), 40, T('1947-12-01'));
  const civilWar = ev('The Chinese civil war', T('1946-06-26'), T('1949-10-01'), 'The war between the Nationalists and the Communists resumes; the Communists win Manchuria, then the Huai-Hai campaign, and cross the Yangtze in April 1949.', EAST_ASIA, 'war');
  arrow(civilWar, 'The People\'s Liberation Army', [[125.3, 43.9], [123.4, 41.8], [117.2, 39.1], [118.8, 32.1], [113.3, 23.1]], T('1948-09-12'), 380, T('1949-12-31'), RED);
  // The partition of India, and the migrations that followed.
  const partition = ev('India and Pakistan', T('1947-08-15', 0), T('1947-11-30'), 'At midnight British India is partitioned: India, and Pakistan in two wings a thousand miles apart. The new border, drawn in five weeks, is published two days later. Some 15 million people cross it; perhaps a million are killed.', SOUTH_ASIA, 'founding');
  take(b, partition, id('India'), [uk], [b.shape('India'), b.shape('Siachen Glacier')], null, FADE);
  take(b, partition, id('Pakistan'), [uk], [b.shape('Pakistan'), b.shape('Bangladesh')], null, FADE);
  born.push(T('1947-08-15', 0), T('1947-08-15', 0));
  arrow(partition, 'Muslims to Pakistan', [[77.2, 28.6], [75.8, 30.0], [74.3, 31.5]], T('1947-08-17'), 60, T('1948-03-01'), '#2e7d32');
  arrow(partition, 'Hindus and Sikhs to India', [[71.5, 30.2], [73.5, 30.8], [75.8, 30.9]], T('1947-08-17'), 60, T('1948-03-01'), REFUGEES);
  arrow(partition, 'Across Bengal', [[90.4, 23.8], [89.2, 23.2], [88.4, 22.6]], T('1947-08-20'), 60, T('1948-03-01'), REFUGEES);
  battle(partition, 'Massacres in the Punjab', [74.9, 31.6], T('1947-08-20'), 150);
  const kashmir = ev('The first Kashmir war', T('1947-10-22'), T('1949-01-01'), 'Tribesmen from Pakistan invade Kashmir; its Maharaja accedes to India, and Indian troops fly into Srinagar. The ceasefire line of 1949 divides the state.', SOUTH_ASIA, 'war');
  battle(kashmir, 'Srinagar', [74.8, 34.08], T('1947-10-27'), 420);
  ev('Gandhi assassinated', T('1948-01-30', 17), null, 'Gandhi is shot in Delhi by a Hindu nationalist on his way to prayers.', SOUTH_ASIA, 'collapse');
  free('1948-01-04', 'Myanmar', [uk], 'Burma becomes independent, outside the Commonwealth.', SOUTH_ASIA, { as: 'Burma', name: 'Burma independent' });
  free('1948-02-04', 'Sri Lanka', [uk], 'Ceylon becomes a dominion.', SOUTH_ASIA, { as: 'Ceylon', name: 'Ceylon independent' });
  const israel = free('1948-05-14', 'Israel', [uk], 'The British mandate ends; David Ben-Gurion proclaims the State of Israel.', ME, { hour: 16 });
  const war48 = ev('The 1948 war', T('1948-05-15'), T('1949-07-20'), 'Arab armies invade the day after Israel\'s proclamation. Jordan holds the West Bank and East Jerusalem (and annexes them in 1950), Egypt the Gaza Strip; some 700,000 Palestinians flee or are driven from their homes, the Nakba.', ME, 'war');
  take(b, war48, id('Jordan'), [uk], [WEST_BANK(b)], null, FADE);
  take(b, war48, id('Egypt'), [uk], [GAZA(b)], null, FADE);
  battle(war48, 'Jerusalem', [35.2, 31.78], T('1948-05-15'), 300);
  arrow(war48, 'Palestinian refugees', [[34.9, 32.1], [35.4, 31.95], [35.9, 31.95]], T('1948-05-15'), 120, T('1949-07-20'), REFUGEES);
  void israel;
  const jordan = ev('Transjordan becomes Jordan', T('1949-04-26'), null, 'The Hashemite Kingdom of Jordan, on both banks of the river.', ME);
  rename(b, jordan, id('Jordan'), 'Jordan');
  const hydWar = ev('Operation Polo', T('1948-09-13'), T('1948-09-18'), 'The Nizam of Hyderabad will not join India; in four days the Indian army takes the state.', SOUTH_ASIA, 'conquest');
  annex(b, hydWar, id('India'), ['Hyderabad'], null, FRONT);
  const korea48 = ev('Two Koreas', T('1948-08-15'), T('1948-09-09'), 'The Republic of Korea is proclaimed in Seoul, the Democratic People\'s Republic in Pyongyang.', EAST_ASIA, 'founding');
  take(b, korea48, id('South Korea'), [us], [out('korea38S', 'Korea south of the 38th parallel')], null, FADE);
  take(b, korea48, id('North Korea'), [su], [out('korea38N', 'Korea north of the 38th parallel')], T('1948-09-09'), FADE);
  born.push(T('1948-08-15'), T('1948-09-09'));
  const airlift = ev('The Berlin Airlift', T('1948-06-24'), T('1949-05-12'), 'The Soviets block every road, railway and canal to West Berlin; for eleven months the Western allies supply the city by air.', EUROPE);
  arrow(airlift, 'The air corridor from Frankfurt', [[8.68, 50.11], [10.8, 51.4], [13.29, 52.47]], T('1948-06-26'), 30, T('1949-05-12'), ALLIED);
  arrow(airlift, 'The air corridor from Hamburg', [[9.99, 53.55], [11.8, 53.0], [13.29, 52.47]], T('1948-06-26'), 30, T('1949-05-12'), ALLIED);
  const saar = ev('The Saar Protectorate', T('1947-12-15'), null, 'France separates the Saar from its occupation zone as a protectorate with its own government, tied to France in money and customs.', EUROPE, 'treaty');
  const SAAR = b.country('Saar Protectorate', '#7f9fd6');
  take(b, saar, SAAR, [de], [out('saar', 'The Saar')], null, FADE);
  const nf = ev('Newfoundland joins Canada', T('1949-03-31', 23), null, 'After two referendums, the British dominion, governed by a commission since 1934, becomes Canada\'s tenth province.', AMERICAS, 'treaty');
  take(b, nf, id('Canada'), [uk], [pieces(b, 'Canada', 'Newfoundland', R.newfoundland), out('labrador', 'Labrador')], null, FADE);
  ev('Ireland leaves the Commonwealth', T('1949-04-18'), null, 'The Republic of Ireland Act comes into force.', EUROPE);
  const de49 = ev('Two Germanys', T('1949-05-23'), T('1949-10-07'), 'The Federal Republic is founded in the western zones, the German Democratic Republic in the Soviet zone. West Berlin stays with the West.', EUROPE, 'founding');
  const GDR = b.country('East Germany', '#b5545c');
  take(b, de49, GDR, [de], [holed('The Soviet zone', R.eastGermany, R.westBerlin)], T('1949-10-07'), FADE);
  rename(b, de49, de, 'West Germany');
  born.push(T('1949-05-23'), T('1949-10-07'));
  const prc = ev('The People\'s Republic of China', T('1949-10-01', 15), null, 'Mao Zedong proclaims the People\'s Republic in Beijing; in December the Nationalist government flees to Taiwan.', EAST_ASIA, 'revolution');
  rename(b, prc, cn, 'People\'s Republic of China');
  const roc = ev('The Nationalists on Taiwan', T('1949-12-07'), null, 'Chiang Kai-shek\'s government moves to Taipei.', EAST_ASIA);
  take(b, roc, id('Taiwan'), [cn], [b.shape('Taiwan')], null, FADE);
  rename(b, roc, id('Taiwan'), 'Republic of China (Taiwan)');
  free('1949-12-27', 'Indonesia', [nl], 'After four years of war and two Dutch "police actions", the Netherlands transfers sovereignty. West New Guinea stays Dutch, its future left to later talks.', SE_ASIA, { regions: [pieces(b, 'Indonesia', 'Indonesia', R.westNewGuinea, true)] });
  // ------------------------------------------------------------ The 1950s
  const chand = ev('Chandernagore to India', T('1950-05-02'), null, 'The French town on the Hooghly votes to join India.', SOUTH_ASIA, 'treaty');
  take(b, chand, id('India'), [fr], [CHANDERNAGORE()], null, FADE);
  const somIt = ev('Somalia to Italy, in trust', T('1950-04-01'), null, 'The United Nations entrusts the former Italian Somaliland to Italy for ten years, to prepare it for independence.', AFRICA, 'treaty');
  take(b, somIt, id('Italy'), [uk], [b.shape('Somalia')], null, FADE);
  const tib = ev('China takes Tibet', T('1950-10-07'), T('1951-05-23'), 'The People\'s Liberation Army crosses into eastern Tibet and wins at Chamdo; the Seventeen Point Agreement follows, and Lhasa is occupied in October 1951.', EAST_ASIA, 'conquest');
  annex(b, tib, cn, ['Tibet'], null, FRONT);
  battle(tib, 'Chamdo', [97.17, 31.14], T('1950-10-07'), 200);
  const vb = ev('The Border Campaign', T('1950-09-16'), T('1950-10-17'), 'The Viet Minh destroy the French posts along the Chinese border; the Viet Bac is theirs.', INDOCHINA, 'war');
  take(b, vb, NV, [fr], [out('vietBac', 'The Viet Bac')], null, FRONT);
  // The Korean War, its front up and down the peninsula.
  const NK = id('North Korea'), SK = id('South Korea');
  const kw1 = ev('The Korean War begins', T('1950-06-25', 4), T('1950-09-01'), 'North Korea invades the South; within weeks the South\'s army and the Americans are pinned in the Pusan perimeter.', EAST_ASIA, 'war');
  take(b, kw1, NK, [SK], [out('koreaSouthOf38', 'South of the 38th')], null, FRONT);
  arrow(kw1, 'North Korea invades', [[126.7, 38.3], [127.0, 37.3], [127.4, 36.3], [128.0, 35.6]], T('1950-06-25', 4), 60, T('1950-10-01'));
  battle(kw1, 'Seoul falls', [126.98, 37.57], T('1950-06-28'), 90);
  battle(kw1, 'The Pusan perimeter', [128.6, 35.87], T('1950-08-04'), 45);
  const kw2 = ev('Inchon and the march north', T('1950-09-15'), T('1950-11-24'), 'MacArthur lands at Inchon behind the front; UN forces drive the North Koreans back and push towards the Yalu.', EAST_ASIA, 'war');
  take(b, kw2, SK, [NK], [out('koreaToTheYalu', 'To the Yalu')], null, { style: 'advance', origin: [126.6, 37.47], origins: [[128.6, 35.9]], easing: 'smooth' });
  arrow(kw2, 'Inchon landing', [[125.0, 37.0], [126.6, 37.47], [127.0, 39.0], [126.5, 40.5]], T('1950-09-15'), 50, T('1950-12-15'), ALLIED);
  battle(kw2, 'Inchon', [126.6, 37.47], T('1950-09-15'), 60);
  const kw3 = ev('China enters the war', T('1950-11-25'), T('1951-01-15'), 'Some 300,000 Chinese troops attack across the Yalu; UN forces fall back from the Chosin Reservoir and below Seoul.', EAST_ASIA, 'war');
  take(b, kw3, NK, [SK], [out('koreaNorthOf37', 'North of Pyeongtaek')], null, FRONT);
  arrow(kw3, 'The Chinese offensive', [[124.4, 40.1], [125.7, 39.0], [126.9, 37.6], [127.1, 37.1]], T('1950-11-25'), 45, T('1951-03-01'), RED);
  battle(kw3, 'Chosin Reservoir', [127.25, 40.45], T('1950-11-27'), 60);
  const kw4 = ev('The UN counteroffensive', T('1951-01-25'), T('1951-04-22'), 'Operations Thunderbolt, Killer and Ripper retake Seoul in March; the front settles near the 38th parallel.', EAST_ASIA, 'war');
  take(b, kw4, SK, [NK], [b.shape('South Korea')], null, FRONT);
  ev('The war of the hills', T('1951-07-10'), T('1953-07-27'), 'While the armistice talks drag on, two years of trench war for ridges such as Heartbreak Ridge and Pork Chop Hill.', EAST_ASIA, 'war');
  const kwEnd = ev('The Korean armistice', T('1953-07-27', 10), null, 'Signed at Panmunjom; it fixes the line where the front stands, a little north of the 38th parallel in the east and south of it in the west, with a demilitarised zone. Some three million are dead, and no peace treaty is ever signed.', EAST_ASIA, 'treaty');
  battle(kwEnd, 'Panmunjom', [126.68, 37.96], T('1953-07-27', 10), 200);
  free('1951-12-24', 'Libya', [uk], 'The first country to win independence through the United Nations: the United Kingdom of Libya under King Idris.', AFRICA);
  const eritrea52 = ev('Eritrea federated with Ethiopia', T('1952-09-15'), null, 'By UN resolution; Ethiopia annexes it outright in 1962, and thirty years of war follow.', AFRICA, 'treaty');
  take(b, eritrea52, id('Ethiopia'), [uk], [b.shape('Eritrea')], null, FADE);
  const sf = ev('The Treaty of San Francisco', T('1952-04-28'), null, 'The occupation of Japan ends.', EAST_ASIA, 'treaty');
  rename(b, sf, jp, 'Japan');
  free('1953-10-22', 'Laos', [fr], 'Laos becomes independent within the French Union.', INDOCHINA);
  free('1953-11-09', 'Cambodia', [fr], 'King Norodom Sihanouk\'s "royal crusade for independence" succeeds.', INDOCHINA);
  const amami = ev('The Amami Islands returned', T('1953-12-25'), null, 'The United States returns the northern Ryukyus to Japan.', EAST_ASIA, 'treaty');
  take(b, amami, jp, [us], [pieces(b, 'Japan', 'The Amami Islands', R.amami)], null, FADE);
  const dbp = ev('Dien Bien Phu', T('1953-11-20'), T('1954-05-07'), 'French paratroopers seize the valley to draw the Viet Minh into battle; Giap drags artillery into the hills around it, and the fortress falls after a siege of 56 days.', INDOCHINA, 'war');
  arrow(dbp, 'Giap\'s divisions', [[105.3, 21.9], [104.3, 21.7], [103.3, 21.45]], T('1953-12-01'), 60, T('1954-06-01'), RED);
  battle(dbp, 'Dien Bien Phu', [103.02, 21.39], T('1954-03-13'), 120);
  const geneva = ev('Vietnam divided at Geneva', T('1954-07-21'), null, 'Vietnam is split at the 17th parallel until elections that never come: the Democratic Republic in the north, the State (from 1955 the Republic) of Vietnam in the south.', INDOCHINA, 'treaty');
  take(b, geneva, NV, [fr], [out('northVietnam', 'North of the 17th')], null, FADE);
  take(b, geneva, SV, [fr], [out('southVietnam', 'South of the 17th')], null, FADE);
  born.push(T('1954-07-21'));
  const dadra = ev('Dadra and Nagar Haveli', T('1954-08-02'), null, 'Volunteers take the two Portuguese enclaves inland from Daman.', SOUTH_ASIA, 'conquest');
  take(b, dadra, id('India'), [pt], [DADRA()], null, FADE);
  const frIndia = ev('French India to India', T('1954-11-01'), null, 'Pondicherry, Karaikal, Mahé and Yanam pass to India.', SOUTH_ASIA, 'treaty');
  take(b, frIndia, id('India'), [fr], [FRENCH_INDIA()], null, FADE);
  const alg = ev('The Algerian War', T('1954-11-01'), T('1962-03-19'), 'The FLN\'s uprising begins on All Saints\' Day; eight years of war, with perhaps 400,000 to a million dead.', AFRICA, 'war');
  battle(alg, 'The Aurès', [6.6, 35.4], T('1954-11-01'), 400);
  battle(alg, 'The Battle of Algiers', [3.06, 36.75], T('1957-01-07'), 300);
  ev('The Bandung Conference', T('1955-04-18'), T('1955-04-24'), 'Twenty-nine countries of Asia and Africa meet in Indonesia against colonialism, in either camp of the Cold War.', WORLD);
  const austria = ev('The Austrian State Treaty', T('1955-07-27'), null, 'The four powers leave Austria, which promises to stay neutral.', EUROPE, 'treaty');
  rename(b, austria, at, 'Austria');
  free('1956-01-01', 'Sudan', [uk], 'The Anglo-Egyptian Sudan becomes independent; the civil war with the south has already begun.', AFRICA, { regions: [b.shape('Sudan'), b.shape('South Sudan')] });
  free('1956-03-02', 'Morocco', [fr], 'France ends its protectorate.', AFRICA);
  const maSp = ev('Spain gives up northern Morocco', T('1956-04-07'), null, 'Spain ends its protectorate in the north; it keeps Ceuta, Melilla, Ifni and the Sahara.', AFRICA, 'treaty');
  take(b, maSp, id('Morocco'), [es], [out('spanishMorocco', 'Spanish Morocco')], null, FADE);
  const tng = ev('Tangier to Morocco', T('1956-10-29'), null, 'The international zone ends.', AFRICA, 'treaty');
  take(b, tng, id('Morocco'), [tangier], [TANGIER()], null, FADE);
  free('1956-03-20', 'Tunisia', [fr], 'Habib Bourguiba\'s Neo-Destour wins independence.', AFRICA);
  const suez = ev('The Suez Crisis', T('1956-10-29'), T('1956-11-07'), 'Britain, France and Israel attack Egypt after Nasser nationalises the canal; under American and Soviet pressure they withdraw. The old empires can no longer act alone.', ME, 'war');
  arrow(suez, 'Israel into Sinai', [[34.5, 31.0], [33.6, 30.3], [32.6, 30.0]], T('1956-10-29'), 5, T('1957-01-01'), ALLIED);
  arrow(suez, 'Anglo-French landings', [[33.0, 32.6], [32.3, 31.3]], T('1956-11-05'), 2, T('1957-01-01'), ALLIED);
  battle(suez, 'Port Said', [32.3, 31.26], T('1956-11-05'), 120);
  const saarBack = ev('The Saar returns to Germany', T('1957-01-01'), null, 'After the Saarlanders vote down a European statute, the Saar joins West Germany.', EUROPE, 'treaty');
  take(b, saarBack, de, [SAAR], [b.shape('Germany')], null, FADE);
  free('1957-03-06', 'Ghana', [uk], 'The Gold Coast becomes Ghana under Kwame Nkrumah: the first colony south of the Sahara to win independence.', AFRICA);
  free('1957-08-31', 'Malaysia', [uk], 'Tunku Abdul Rahman proclaims Merdeka in Kuala Lumpur.', SE_ASIA, { as: 'Malaya', name: 'Malaya independent', regions: [pieces(b, 'Malaysia', 'Malaya', R.peninsularMalaysia)] });
  const uar = ev('The United Arab Republic', T('1958-02-01'), null, 'Egypt and Syria unite under Nasser.', ME, 'founding');
  annex(b, uar, id('Egypt'), ['Syria'], null, FADE);
  rename(b, uar, id('Egypt'), 'United Arab Republic');
  const tarf = ev('The Tarfaya strip to Morocco', T('1958-04-01'), null, 'Spain hands over Cape Juby.', AFRICA, 'treaty');
  take(b, tarf, id('Morocco'), [es], [out('tarfaya', 'Cape Juby')], null, FADE);
  ev('The Iraqi revolution', T('1958-07-14'), null, 'Officers overthrow the monarchy the British had installed; the royal family is killed.', ME, 'revolution');
  free('1958-10-02', 'Guinea', [fr], 'Guinea votes "no" to de Gaulle\'s French Community and becomes independent at once; France withdraws everything, down to the light bulbs.', AFRICA);
  const comm = ev('The French Community', T('1958-10-04'), null, 'The Fifth Republic replaces the French Union with the Community.', AFRICA);
  rename(b, comm, fr, 'French Community');
  // ------------------------------------------------------------ 1960, the year of Africa
  const y1960: Array<[string, string, string, string, string?]> = [
    ['1960-01-01', 'Cameroon', 'fr', 'French Cameroon becomes independent under Ahmadou Ahidjo.'],
    ['1960-04-27', 'Togo', 'fr', 'Sylvanus Olympio\'s Togo becomes independent.'],
    ['1960-06-26', 'Madagascar', 'fr', 'The Malagasy Republic becomes independent.', 'Malagasy Republic'],
    ['1960-08-01', 'Benin', 'fr', 'Dahomey becomes independent.', 'Dahomey'],
    ['1960-08-03', 'Niger', 'fr', 'Niger becomes independent.'],
    ['1960-08-05', 'Burkina Faso', 'fr', 'Upper Volta becomes independent.', 'Upper Volta'],
    ['1960-08-07', 'Ivory Coast', 'fr', 'Félix Houphouët-Boigny\'s Ivory Coast becomes independent.'],
    ['1960-08-11', 'Chad', 'fr', 'Chad becomes independent.'],
    ['1960-08-13', 'Central African Republic', 'fr', 'The Central African Republic becomes independent.'],
    ['1960-08-15', 'Republic of the Congo', 'fr', 'Congo-Brazzaville becomes independent.'],
    ['1960-08-17', 'Gabon', 'fr', 'Gabon becomes independent.'],
    ['1960-08-20', 'Senegal', 'fr', 'Senegal leaves the short-lived Mali Federation, independent under Léopold Senghor.'],
    ['1960-09-22', 'Mali', 'fr', 'The Sudanese Republic takes the name Mali.'],
    ['1960-10-01', 'Nigeria', 'uk', 'Africa\'s most populous country becomes independent.'],
    ['1960-11-28', 'Mauritania', 'fr', 'Mauritania becomes independent.'],
  ];
  for (const [date, c, from, about, as] of y1960) free(date, c, [E[from]], about, AFRICA, as ? { as, name: `${as} independent` } : {});
  free('1960-06-30', 'Democratic Republic of the Congo', [be], 'Belgium leaves the Congo in haste; within days the army mutinies and Katanga secedes. Patrice Lumumba\'s speech at the ceremony enrages King Baudouin.', AFRICA, { as: 'Republic of the Congo (Léopoldville)', name: 'The Congo independent', fadeDays: 10 });
  free('1960-08-16', 'Cyprus', [uk], 'Cyprus becomes a republic; Britain keeps two sovereign bases.', ME, { regions: [b.shape('Cyprus'), b.shape('Turkish Republic of Northern Cyprus')] });
  const somali = ev('Somalia independent and united', T('1960-06-26'), T('1960-07-01'), 'British Somaliland becomes independent on 26 June; five days later it joins the former Italian Somaliland as the Somali Republic.', AFRICA, 'founding');
  take(b, somali, id('Somaliland'), [uk], [b.shape('Somaliland')], null, { style: 'fade', for: { n: 3, unit: 'day' } });
  rename(b, somali, id('Somaliland'), 'State of Somaliland');
  take(b, somali, id('Somalia'), [id('Somaliland'), id('Italy')], [b.shape('Somaliland'), b.shape('Somalia')], T('1960-07-01'), FADE);
  born.push(T('1960-07-01'));
  const katanga = ev('Katanga secedes', T('1960-07-11'), T('1963-01-15'), 'Moïse Tshombe declares the mining province independent, backed by Belgian officers and mining companies. Lumumba, overthrown, is murdered there in January 1961; UN troops end the secession in 1963.', AFRICA, 'revolution');
  const KAT = b.country('State of Katanga', '#2e9e9e');
  take(b, katanga, KAT, [id('Democratic Republic of the Congo')], [out('katanga', 'Katanga')], null, frontFor(20));
  take(b, katanga, id('Democratic Republic of the Congo'), [KAT], [out('katanga', 'Katanga')], T('1962-12-28'), frontFor(18));
  battle(katanga, 'Elisabethville', [27.48, -11.66], T('1961-09-13'), 500);
  ev('Sharpeville', T('1960-03-21'), null, 'South African police fire on a crowd protesting against the pass laws, killing 69.', SOUTHERN_AFRICA, 'collapse');
  ev('The declaration on decolonisation', T('1960-12-14'), null, 'The UN General Assembly declares that colonialism must be brought to a speedy and unconditional end.', WORLD, 'treaty');
  // ------------------------------------------------------------ The 1960s
  free('1961-04-27', 'Sierra Leone', [uk], 'Sierra Leone becomes independent.', AFRICA);
  free('1961-06-19', 'Kuwait', [uk], 'The British protectorate ends; Iraq claims Kuwait, and British troops return to deter it.', ME);
  ev('The Non-Aligned Movement', T('1961-09-01'), T('1961-09-06'), 'Tito, Nasser, Nehru, Sukarno and Nkrumah gather the countries that will join neither bloc, in Belgrade.', WORLD, 'founding');
  const syr61 = ev('Syria leaves the United Arab Republic', T('1961-09-28'), null, 'A coup in Damascus ends the union; Egypt keeps the name.', ME, 'revolution');
  take(b, syr61, id('Syria'), [id('Egypt')], [b.shape('Syria'), out('golan', 'The Golan')], null, FADE);
  free('1961-12-09', 'Tanzania', [uk], 'Tanganyika becomes independent under Julius Nyerere.', AFRICA, { as: 'Tanganyika', name: 'Tanganyika independent', regions: [pieces(b, 'Tanzania', 'Tanganyika', R.zanzibar, true)] });
  const goa = ev('India takes Goa', T('1961-12-18'), T('1961-12-19'), 'Operation Vijay: Indian troops end 451 years of Portuguese rule in Goa, Daman and Diu in 36 hours.', SOUTH_ASIA, 'conquest');
  take(b, goa, id('India'), [pt], [GOA()], null, FRONT);
  free('1962-01-01', 'Samoa', [nz], 'The first Pacific island country to win independence.', AMERICAS, { as: 'Western Samoa', name: 'Western Samoa independent' });
  free('1962-07-01', 'Rwanda', [be], 'Rwanda becomes independent after the Hutu revolution.', AFRICA);
  free('1962-07-01', 'Burundi', [be], 'Burundi becomes independent as a kingdom.', AFRICA);
  const algeria = free('1962-07-05', 'Algeria', [fr], 'After the Évian Accords and a referendum, Algeria becomes independent; nearly a million Europeans leave.', AFRICA);
  rename(b, algeria, fr, 'France');
  free('1962-08-06', 'Jamaica', [uk], 'Jamaica becomes independent.', AMERICAS);
  free('1962-08-31', 'Trinidad and Tobago', [uk], 'Trinidad and Tobago becomes independent.', AMERICAS);
  free('1962-10-09', 'Uganda', [uk], 'Uganda becomes independent.', AFRICA);
  const wng = ev('West New Guinea to Indonesia', T('1962-10-01'), T('1963-05-01'), 'By the New York Agreement the Dutch hand the territory to a UN authority, then to Indonesia; the "Act of Free Choice" of 1969, 1,025 chosen elders voting, confirms it.', SE_ASIA, 'treaty');
  take(b, wng, id('Indonesia'), [nl], [pieces(b, 'Indonesia', 'West New Guinea', R.westNewGuinea)], T('1963-05-01'), FADE);
  const malaysia = ev('Malaysia', T('1963-09-16'), null, 'Malaya, Singapore, Sarawak and North Borneo (Sabah) form Malaysia; Indonesia answers with "Konfrontasi".', SE_ASIA, 'founding');
  take(b, malaysia, id('Malaysia'), [uk], [pieces(b, 'Malaysia', 'Sarawak and Sabah', R.peninsularMalaysia, true), b.shape('Singapore')], null, FADE);
  rename(b, malaysia, id('Malaysia'), 'Malaysia');
  b.country('Zanzibar', '#cc7a00');
  free('1963-12-10', 'Zanzibar', [uk], 'Zanzibar becomes independent as a sultanate; a month later a revolution overthrows the sultan.', AFRICA, { regions: [pieces(b, 'Tanzania', 'Zanzibar', R.zanzibar)] });
  free('1963-12-12', 'Kenya', [uk], 'After the Mau Mau war, Kenya becomes independent; Jomo Kenyatta, once imprisoned by the British, is prime minister.', AFRICA);
  const tz = ev('Tanzania', T('1964-04-26'), null, 'Tanganyika and Zanzibar unite.', AFRICA, 'founding');
  annex(b, tz, id('Tanzania'), ['Zanzibar'], null, FADE);
  rename(b, tz, id('Tanzania'), 'Tanzania');
  free('1964-07-06', 'Malawi', [uk], 'Nyasaland becomes Malawi under Hastings Banda.', SOUTHERN_AFRICA);
  const drc64 = ev('The Democratic Republic of the Congo', T('1964-08-01'), null, 'A new constitution renames the Congo.', AFRICA);
  rename(b, drc64, id('Democratic Republic of the Congo'), 'Democratic Republic of the Congo');
  ev('The Gulf of Tonkin', T('1964-08-02'), T('1964-08-07'), 'After a clash between North Vietnamese boats and an American destroyer, Congress lets the president wage war in Vietnam.', INDOCHINA, 'war');
  free('1964-09-21', 'Malta', [uk], 'Malta becomes independent.', EUROPE);
  free('1964-10-24', 'Zambia', [uk], 'Northern Rhodesia becomes Zambia under Kenneth Kaunda.', SOUTHERN_AFRICA);
  free('1965-02-18', 'The Gambia', [uk], 'The Gambia becomes independent.', AFRICA);
  const rolling = ev('The Vietnam War', T('1965-03-02'), T('1973-03-29'), 'Operation Rolling Thunder bombs the North; American troops in the South reach 540,000 in 1969. The last leave in March 1973.', INDOCHINA, 'war');
  arrow(rolling, 'The Ho Chi Minh trail', [[105.7, 18.7], [106.2, 17.2], [106.8, 15.6], [107.4, 13.6], [106.9, 12.0]], T('1965-03-02'), 300, T('1975-05-01'), RED);
  free('1965-07-26', 'Maldives', [uk], 'The British protectorate ends.', SOUTH_ASIA);
  free('1965-08-04', 'Cook Islands', [nz], 'The Cook Islands govern themselves in free association with New Zealand.', AMERICAS, { name: 'The Cook Islands self-governing', newState: false });
  const sg = ev('Singapore leaves Malaysia', T('1965-08-09'), null, 'Expelled after two years; Lee Kuan Yew weeps on television.', SE_ASIA, 'founding');
  take(b, sg, id('Singapore'), [id('Malaysia')], [b.shape('Singapore')], null, FADE);
  born.push(T('1965-08-09'));
  const udi = ev('Rhodesia declares independence', T('1965-11-11'), null, 'Ian Smith\'s white minority government declares independence rather than accept majority rule. No country recognises it; Britain imposes sanctions.', SOUTHERN_AFRICA, 'revolution');
  take(b, udi, id('Zimbabwe'), [uk], [b.shape('Zimbabwe')], null, FADE);
  rename(b, udi, id('Zimbabwe'), 'Rhodesia');
  free('1966-05-26', 'Guyana', [uk], 'British Guiana becomes Guyana.', AMERICAS);
  free('1966-09-30', 'Botswana', [uk], 'Bechuanaland becomes Botswana under Seretse Khama.', SOUTHERN_AFRICA);
  free('1966-10-04', 'Lesotho', [uk], 'Basutoland becomes Lesotho.', SOUTHERN_AFRICA);
  free('1966-11-30', 'Barbados', [uk], 'Barbados becomes independent.', AMERICAS);
  const sixDay = ev('The Six-Day War', T('1967-06-05', 7), T('1967-06-10'), 'Israel defeats Egypt, Jordan and Syria and takes the Sinai, Gaza, the West Bank with East Jerusalem, and the Golan Heights.', ME, 'war');
  take(b, sixDay, id('Israel'), [id('Egypt')], [out('sinai', 'Sinai'), GAZA(b)], null, frontFor(4));
  take(b, sixDay, id('Israel'), [id('Jordan')], [WEST_BANK(b)], T('1967-06-06'), frontFor(2));
  take(b, sixDay, id('Israel'), [id('Syria')], [out('golan', 'The Golan')], T('1967-06-09'), frontFor(1));
  battle(sixDay, 'Jerusalem', [35.23, 31.78], T('1967-06-07'), 150);
  arrow(sixDay, 'Into Sinai', [[34.3, 31.2], [33.6, 30.9], [32.4, 30.6]], T('1967-06-05', 7), 4, T('1967-09-01'), ALLIED);
  const biafra = ev('Biafra', T('1967-05-30'), T('1970-01-15'), 'The Eastern Region secedes from Nigeria as the Republic of Biafra; blockaded, perhaps a million die, most of them of hunger.', AFRICA, 'war');
  const BIA = b.country('Biafra', '#e67e22');
  take(b, biafra, BIA, [id('Nigeria')], [out('biafra', 'Biafra')], null, frontFor(15));
  take(b, biafra, id('Nigeria'), [BIA], [holed('Biafra beyond its heartland', R.biafra, R.biafraCore)], T('1967-07-06'), frontFor(22, 'month'));
  take(b, biafra, id('Nigeria'), [BIA], [out('biafraCore', 'Biafra\'s heartland')], T('1970-01-01'), frontFor(14));
  born.push(T('1967-05-30'));
  ev('The Tet Offensive', T('1968-01-30'), T('1968-02-25'), 'The Viet Cong and the North attack more than a hundred towns, the American embassy in Saigon and the old capital, Hue.', INDOCHINA, 'war');
  b.country('South Yemen', '#d35454');
  free('1967-11-30', 'South Yemen', [uk], 'After four years of insurgency, the British leave Aden.', ME, { regions: [out('southYemen', 'Aden')] });
  free('1968-01-31', 'Nauru', [au], 'Nauru, the world\'s smallest republic, becomes independent.', AMERICAS);
  free('1968-03-12', 'Mauritius', [uk], 'Mauritius becomes independent.', AFRICA);
  const suezEast = ev('East of Suez', T('1968-01-16'), null, 'Harold Wilson announces that British forces will leave their bases east of Suez, from Aden to Singapore, by 1971: the end of Britain as an imperial power. What remains are small colonies, the largest of them soon independent.', WORLD, 'treaty');
  rename(b, suezEast, uk, 'United Kingdom');
  const bon = ev('The Bonin Islands returned', T('1968-06-26'), null, 'The United States returns the Bonins and Iwo Jima to Japan.', EAST_ASIA, 'treaty');
  take(b, bon, jp, [us], [pieces(b, 'Japan', 'The Bonins', R.bonins)], null, FADE);
  free('1968-09-06', 'Eswatini', [uk], 'Swaziland becomes independent.', SOUTHERN_AFRICA, { as: 'Swaziland', name: 'Swaziland independent' });
  free('1968-10-12', 'Equatorial Guinea', [es], 'Spanish Guinea becomes Equatorial Guinea.', AFRICA);
  const ifni = ev('Ifni to Morocco', T('1969-06-30'), null, 'Spain hands back its enclave on the Atlantic coast.', AFRICA, 'treaty');
  take(b, ifni, id('Morocco'), [es], [IFNI()], null, FADE);
  // ------------------------------------------------------------ The 1970s
  free('1970-06-04', 'Tonga', [uk], 'The British protectorate over Tonga ends.', AMERICAS);
  free('1970-10-10', 'Fiji', [uk], 'Fiji becomes independent.', AMERICAS);
  const bd = ev('Bangladesh', T('1971-03-26'), T('1971-12-16'), 'East Pakistan declares independence; after a genocidal crackdown and India\'s intervention in December, Pakistan\'s army surrenders at Dhaka.', SOUTH_ASIA, 'war');
  take(b, bd, id('Bangladesh'), [id('Pakistan')], [b.shape('Bangladesh')], T('1971-12-03'), FRONT);
  arrow(bd, 'Ten million refugees to India', [[90.4, 23.8], [89.2, 23.0], [88.4, 22.6]], T('1971-04-01'), 90, T('1972-03-01'), REFUGEES);
  arrow(bd, 'The Indian army', [[88.4, 22.6], [89.4, 23.1], [90.4, 23.8]], T('1971-12-03'), 12, T('1972-03-01'), '#ef6c00');
  battle(bd, 'Dhaka', [90.41, 23.81], T('1971-12-16'), 100);
  born.push(T('1971-12-16'));
  free('1971-08-15', 'Bahrain', [uk], 'Britain withdraws from east of Suez.', ME);
  free('1971-09-03', 'Qatar', [uk], 'Qatar becomes independent.', ME);
  const egy71 = ev('Egypt takes back its name', T('1971-09-02'), null, 'The United Arab Republic becomes the Arab Republic of Egypt.', ME);
  rename(b, egy71, id('Egypt'), 'Egypt');
  const zaire = ev('The Congo becomes Zaire', T('1971-10-27'), null, 'Mobutu renames the country, its river and its money.', AFRICA);
  rename(b, zaire, id('Democratic Republic of the Congo'), 'Zaire');
  free('1971-12-02', 'United Arab Emirates', [uk], 'Six Trucial States federate; Ras al-Khaimah joins in 1972.', ME);
  const ok = ev('Okinawa returned', T('1972-05-15'), null, 'After 27 years of American rule, the Ryukyus are Japanese again; the American bases stay.', EAST_ASIA, 'treaty');
  take(b, ok, jp, [us], [pieces(b, 'Japan', 'Okinawa', R.okinawa)], null, FADE);
  const ceylon = ev('Ceylon becomes Sri Lanka', T('1972-05-22'), null, 'A republic, under a new constitution.', SOUTH_ASIA);
  rename(b, ceylon, id('Sri Lanka'), 'Sri Lanka');
  ev('The Paris Peace Accords', T('1973-01-27'), null, 'The United States leaves Vietnam; the war goes on without it.', INDOCHINA, 'treaty');
  free('1973-07-10', 'The Bahamas', [uk], 'The Bahamas become independent.', AMERICAS);
  free('1973-09-24', 'Guinea-Bissau', [pt], 'The PAIGC declares independence in the liberated hills; Portugal recognises it a year later.', AFRICA);
  free('1974-02-07', 'Grenada', [uk], 'Grenada becomes independent.', AMERICAS);
  ev('The Carnation Revolution', T('1974-04-25'), null, 'Officers weary of the colonial wars overthrow Portugal\'s dictatorship, and the new government lets the colonies go.', EUROPE, 'revolution');
  const cyprus74 = ev('Turkey invades Cyprus', T('1974-07-20'), T('1974-08-16'), 'After a coup backed by the junta in Athens, Turkish troops land; the island is divided along the Green Line, and some 200,000 people lose their homes.', ME, 'war');
  take(b, cyprus74, id('Turkish Republic of Northern Cyprus'), [id('Cyprus')], [b.shape('Turkish Republic of Northern Cyprus')], null, FRONT);
  rename(b, cyprus74, id('Turkish Republic of Northern Cyprus'), 'Turkish Cypriot zone');
  arrow(cyprus74, 'The Turkish landings', [[33.3, 36.1], [33.3, 35.33]], T('1974-07-20'), 3, T('1974-12-01'), RED);
  free('1974-10-19', 'Niue', [nz], 'Niue governs itself in free association with New Zealand.', AMERICAS, { name: 'Niue self-governing', newState: false });
  const saigon = ev('The fall of Saigon', T('1975-03-10'), T('1975-04-30', 11), 'The North\'s spring offensive breaks the South in seven weeks; on 30 April its tanks crash through the gates of the presidential palace.', INDOCHINA, 'war');
  take(b, saigon, NV, [SV], [out('southVietnam', 'South of the 17th')], null, FRONT);
  battle(saigon, 'Ban Me Thuot', [108.04, 12.67], T('1975-03-10'), 60);
  battle(saigon, 'Saigon', [106.7, 10.78], T('1975-04-30', 11), 150);
  arrow(saigon, 'The Ho Chi Minh campaign', [[107.1, 17.0], [108.2, 16.05], [108.5, 13.5], [107.5, 11.6], [106.7, 10.78]], T('1975-03-10'), 50, T('1975-06-15'), RED);
  const khmer = ev('The Khmer Rouge take Phnom Penh', T('1975-04-17'), null, 'They empty the cities; some 1.7 million Cambodians die under Pol Pot.', INDOCHINA, 'revolution');
  rename(b, khmer, id('Cambodia'), 'Democratic Kampuchea');
  const sikkimEv = ev('Sikkim joins India', T('1975-05-16'), null, 'After a referendum the Himalayan kingdom becomes India\'s 22nd state.', SOUTH_ASIA, 'conquest');
  annex(b, sikkimEv, id('India'), ['Sikkim'], null, FADE);
  free('1975-06-25', 'Mozambique', [pt], 'FRELIMO\'s Samora Machel becomes president.', SOUTHERN_AFRICA);
  free('1975-07-05', 'Cape Verde', [pt], 'Cape Verde becomes independent.', AFRICA);
  free('1975-07-06', 'Comoros', [fr], 'The Comoros declare independence; Mayotte stays French.', AFRICA);
  free('1975-07-12', 'São Tomé and Príncipe', [pt], 'São Tomé and Príncipe becomes independent.', AFRICA);
  free('1975-09-16', 'Papua New Guinea', [au], 'Papua New Guinea becomes independent of Australia.', AMERICAS);
  const green = ev('The Green March', T('1975-11-06'), T('1975-11-10'), '350,000 unarmed Moroccans march into the Spanish Sahara.', AFRICA);
  arrow(green, 'The Green March', [[-12.0, 28.4], [-12.9, 27.9], [-13.2, 27.15]], T('1975-11-06'), 4, T('1976-03-01'), '#1b5e20');
  const angola = free('1975-11-11', 'Angola', [pt], 'Angola becomes independent in the middle of a civil war that will last 27 years, with Cuban troops on one side and South Africa\'s on the other.', SOUTHERN_AFRICA);
  rename(b, angola, pt, 'Portugal');
  free('1975-11-25', 'Suriname', [nl], 'Suriname becomes independent; a third of its people leave for the Netherlands.', AMERICAS);
  free('1975-11-28', 'Timor-Leste', [pt], 'Fretilin declares East Timor independent as Portugal leaves.', SE_ASIA, { as: 'East Timor', name: 'East Timor declares independence', newState: false, fadeDays: 6 });
  const mada = ev('The Democratic Republic of Madagascar', T('1975-12-21'), null, 'Didier Ratsiraka\'s new constitution; the country is Madagascar again in its name.', AFRICA);
  rename(b, mada, id('Madagascar'), 'Madagascar');
  const dahomey = ev('Dahomey becomes Benin', T('1975-11-30'), null, 'Mathieu Kérékou\'s Marxist regime renames the country.', AFRICA);
  rename(b, dahomey, id('Benin'), 'Benin');
  const lao = ev('The Lao People\'s Democratic Republic', T('1975-12-02'), null, 'The Pathet Lao abolish the monarchy.', INDOCHINA, 'revolution');
  rename(b, lao, id('Laos'), 'Lao People\'s Democratic Republic');
  const timor = ev('Indonesia invades East Timor', T('1975-12-07'), T('1976-07-17'), 'Nine days after the declaration; it is annexed as a province the next July, and perhaps a quarter of its people die in the occupation\'s first years.', SE_ASIA, 'conquest');
  take(b, timor, id('Indonesia'), [id('Timor-Leste')], [b.shape('Timor-Leste')], null, FRONT);
  const sahara = ev('The Madrid Accords', T('1976-02-26'), T('1976-02-28'), 'Spain leaves the Sahara to Morocco and Mauritania; the Polisario Front proclaims the Sahrawi Republic and fights both.', AFRICA, 'treaty');
  take(b, sahara, id('Morocco'), [es], [out('spanishSahara', 'Saguia el-Hamra'), b.shape('Western Sahara')], null, FADE);
  take(b, sahara, id('Mauritania'), [id('Morocco')], [out('saharaSouth', 'Tiris al-Gharbiya')], T('1976-02-27'), FADE);
  free('1976-06-29', 'Seychelles', [uk], 'The Seychelles become independent.', AFRICA);
  ev('The Soweto uprising', T('1976-06-16'), null, 'Police fire on schoolchildren marching against lessons in Afrikaans; hundreds are killed in the months that follow.', SOUTHERN_AFRICA, 'revolution');
  const vn = ev('Vietnam reunified', T('1976-07-02'), null, 'The Socialist Republic of Vietnam.', INDOCHINA, 'founding');
  annex(b, vn, id('Vietnam'), ['North Vietnam'], null, FADE);
  const bokassa = ev('Bokassa\'s empire', T('1976-12-04'), T('1979-09-20'), 'Jean-Bédel Bokassa crowns himself emperor, at a third of the country\'s budget.', AFRICA);
  rename(b, bokassa, id('Central African Republic'), 'Central African Empire');
  free('1977-06-27', 'Djibouti', [fr], 'The French Territory of the Afars and the Issas becomes Djibouti.', AFRICA);
  const ogaden = ev('The Ogaden War', T('1977-07-13'), T('1977-09-30'), 'Somalia invades Ethiopia\'s Somali-speaking Ogaden and takes most of it.', AFRICA, 'war');
  take(b, ogaden, id('Somalia'), [id('Ethiopia')], [out('ogaden', 'The Ogaden')], null, FRONT);
  const ogaden2 = ev('Ethiopia takes back the Ogaden', T('1978-02-05'), T('1978-03-15'), 'With Soviet weapons and Cuban troops, Ethiopia drives the Somalis out.', AFRICA, 'war');
  take(b, ogaden2, id('Ethiopia'), [id('Somalia')], [out('ogaden', 'The Ogaden')], null, FRONT);
  battle(ogaden2, 'Jijiga', [42.8, 9.35], T('1978-03-05'), 100);
  free('1978-07-07', 'Solomon Islands', [uk], 'The Solomon Islands become independent.', AMERICAS);
  free('1978-10-01', 'Tuvalu', [uk], 'The Ellice Islands become Tuvalu.', AMERICAS);
  free('1978-11-03', 'Dominica', [uk], 'Dominica becomes independent.', AMERICAS);
  const kamp = ev('Vietnam invades Cambodia', T('1978-12-25'), T('1979-01-07'), 'The Vietnamese army drives out the Khmer Rouge and installs the People\'s Republic of Kampuchea.', INDOCHINA, 'war');
  rename(b, kamp, id('Cambodia'), 'People\'s Republic of Kampuchea');
  arrow(kamp, 'The Vietnamese army', [[106.7, 10.78], [105.9, 11.3], [104.92, 11.56]], T('1978-12-25'), 13, T('1979-03-01'), RED);
  free('1979-02-22', 'Saint Lucia', [uk], 'Saint Lucia becomes independent.', AMERICAS);
  ev('Greenland\'s home rule', T('1979-05-01'), null, 'Denmark grants Greenland home rule.', AMERICAS, 'treaty');
  free('1979-07-12', 'Kiribati', [uk], 'The Gilbert Islands become Kiribati.', AMERICAS);
  const mau = ev('Mauritania leaves the Sahara', T('1979-08-05'), T('1979-08-14'), 'Beaten by the Polisario, Mauritania makes peace and withdraws; Morocco takes its share.', AFRICA, 'conquest');
  take(b, mau, id('Morocco'), [id('Mauritania')], [out('saharaSouth', 'Tiris al-Gharbiya')], null, FRONT);
  const caeEnd = ev('Bokassa deposed', T('1979-09-21'), null, 'French paratroopers restore the republic while the emperor is abroad.', AFRICA, 'revolution');
  rename(b, caeEnd, id('Central African Republic'), 'Central African Republic');
  free('1979-10-27', 'Saint Vincent and the Grenadines', [uk], 'Saint Vincent and the Grenadines becomes independent.', AMERICAS);
  // ------------------------------------------------------------ The 1980s
  const zim = ev('Zimbabwe', T('1980-04-18'), null, 'After a seven-year war and the Lancaster House talks, Rhodesia becomes Zimbabwe under Robert Mugabe, with majority rule.', SOUTHERN_AFRICA, 'founding');
  rename(b, zim, id('Zimbabwe'), 'Zimbabwe');
  free('1980-07-30', 'Vanuatu', [uk], 'The Anglo-French New Hebrides become Vanuatu.', AMERICAS);
  const berm = ev('The Moroccan Wall', T('1980-08-01'), T('1987-04-16'), 'Morocco builds 2,700 km of sand walls across the Sahara; the Polisario holds the desert beyond them.', AFRICA);
  take(b, berm, id('Western Sahara'), [id('Morocco')], [b.shape('Western Sahara')], null, FRONT);
  rename(b, berm, id('Western Sahara'), 'Sahrawi Republic');
  free('1981-09-21', 'Belize', [uk], 'Belize becomes independent; British troops stay to deter Guatemala.', AMERICAS);
  free('1981-11-01', 'Antigua and Barbuda', [uk], 'Antigua and Barbuda becomes independent.', AMERICAS);
  const falk = ev('The Falklands War', T('1982-04-02'), T('1982-06-14'), 'Argentina occupies the islands; a British task force retakes them in ten weeks.', AMERICAS, 'war');
  take(b, falk, id('Argentina'), [uk], [b.shape('Falkland Islands'), b.shape('South Georgia and the South Sandwich Islands')], null, null);
  take(b, falk, uk, [id('Argentina')], [b.shape('Falkland Islands'), b.shape('South Georgia and the South Sandwich Islands')], T('1982-06-14'), null);
  arrow(falk, 'The task force', [[-14.4, -7.9], [-40.0, -35.0], [-57.8, -51.7]], T('1982-04-05'), 45, T('1982-08-01'), ALLIED);
  battle(falk, 'Port Stanley', [-57.85, -51.69], T('1982-06-14'), 100);
  const sinai82 = ev('Sinai returned to Egypt', T('1982-04-25'), null, 'The last stage of the peace of 1979 between Egypt and Israel.', ME, 'treaty');
  take(b, sinai82, id('Egypt'), [id('Israel')], [b.shape('Egypt')], null, FADE);
  free('1983-09-19', 'Saint Kitts and Nevis', [uk], 'Saint Kitts and Nevis becomes independent.', AMERICAS);
  const trnc = ev('The Turkish Republic of Northern Cyprus', T('1983-11-15'), null, 'Proclaimed in the north; only Turkey recognises it.', ME, 'founding');
  rename(b, trnc, id('Turkish Republic of Northern Cyprus'), 'Turkish Republic of Northern Cyprus');
  free('1984-01-01', 'Brunei', [uk], 'Brunei becomes fully independent.', SE_ASIA);
  const volta = ev('Upper Volta becomes Burkina Faso', T('1984-08-04'), null, 'Thomas Sankara renames it "the land of upright people".', AFRICA);
  rename(b, volta, id('Burkina Faso'), 'Burkina Faso');
  free('1986-10-21', 'Marshall Islands', [us], 'The Compact of Free Association with the United States comes into force.', AMERICAS);
  free('1986-11-03', 'Federated States of Micronesia', [us], 'The Compact of Free Association with the United States comes into force.', AMERICAS);
  const burma = ev('Burma becomes Myanmar', T('1989-06-18'), null, 'The military government changes the country\'s name in English.', SOUTH_ASIA);
  rename(b, burma, id('Myanmar'), 'Myanmar');
  // ------------------------------------------------------------ 1989 to 1999: the Soviet empire's end, and the last colonies
  ev('The Berlin Wall falls', T('1989-11-09', 23), null, 'The border opens by mistake after a muddled press conference; Berliners climb the Wall.', EUROPE, 'revolution');
  ev('Mandela freed', T('1990-02-11', 16), null, 'After 27 years in prison, Nelson Mandela walks out of Victor Verster prison.', SOUTHERN_AFRICA);
  free('1990-03-21', 'Namibia', [za], 'After 75 years of South African rule and a long war, Namibia becomes independent.', SOUTHERN_AFRICA);
  const yemen = ev('Yemen unified', T('1990-05-22'), null, 'North and South Yemen unite.', ME, 'founding');
  annex(b, yemen, ny, ['South Yemen'], null, FADE);
  rename(b, yemen, ny, 'Yemen');
  const kuwait = ev('Iraq invades Kuwait', T('1990-08-02', 2), T('1991-02-28'), 'Saddam Hussein annexes Kuwait; a coalition of 35 countries drives Iraq out in a six-week air war and a hundred-hour ground war.', ME, 'war');
  take(b, kuwait, id('Iraq'), [id('Kuwait')], [b.shape('Kuwait')], null, frontFor(1));
  take(b, kuwait, id('Kuwait'), [id('Iraq')], [b.shape('Kuwait')], T('1991-02-24'), frontFor(4));
  arrow(kuwait, 'Desert Storm', [[45.5, 28.0], [46.8, 29.0], [47.98, 29.37]], T('1991-02-24'), 4, T('1991-06-01'), ALLIED);
  const gdr = ev('Germany reunified', T('1990-10-03'), null, 'The German Democratic Republic joins the Federal Republic.', EUROPE, 'founding');
  annex(b, gdr, de, ['East Germany'], null, FADE);
  rename(b, gdr, de, 'Germany');
  const sov: Array<[string, string, string]> = [
    ['1990-03-11', 'Lithuania', 'Lithuania declares itself independent again; Moscow blockades it, and in January 1991 Soviet troops kill fourteen at the Vilnius television tower.'],
    ['1991-04-09', 'Georgia', 'Georgia declares independence, two years after the Tbilisi massacre.'],
    ['1991-08-20', 'Estonia', 'During the coup in Moscow, Estonia declares full independence.'],
    ['1991-08-21', 'Latvia', 'Latvia declares full independence as the coup fails.'],
    ['1991-08-24', 'Ukraine', 'Ukraine declares independence, Crimea with it; 92 % vote for it in December.'],
    ['1991-08-25', 'Belarus', 'Belarus declares independence.'],
    ['1991-08-27', 'Moldova', 'Moldova declares independence.'],
    ['1991-08-30', 'Azerbaijan', 'Azerbaijan declares independence, at war over Nagorno-Karabakh.'],
    ['1991-08-31', 'Kyrgyzstan', 'Kyrgyzstan declares independence.'],
    ['1991-09-01', 'Uzbekistan', 'Uzbekistan declares independence.'],
    ['1991-09-09', 'Tajikistan', 'Tajikistan declares independence; civil war follows.'],
    ['1991-09-21', 'Armenia', 'Armenia votes for independence.'],
    ['1991-10-27', 'Turkmenistan', 'Turkmenistan declares independence.'],
    ['1991-12-16', 'Kazakhstan', 'Kazakhstan, the last republic to leave.'],
  ];
  for (const [date, c, about] of sov) free(date, c, [su], about, EUROPE, c === 'Ukraine' ? { regions: [b.shape('Ukraine'), pieces(b, 'Russia', 'Crimea', R.crimea)] } : {});
  ev('The August coup', T('1991-08-19', 6), T('1991-08-21'), 'Hardliners hold Gorbachev at his dacha in Crimea; Yeltsin stands on a tank in Moscow, and the coup collapses in three days.', EUROPE, 'revolution');
  const ussr = ev('The Soviet Union dissolved', T('1991-12-26'), null, 'Gorbachev resigns the day before; the red flag comes down over the Kremlin.', EUROPE, 'collapse');
  rename(b, ussr, su, 'Russia');
  const somal91 = ev('Somaliland breaks away', T('1991-05-18'), null, 'As Somalia collapses into civil war, the former British Somaliland declares itself independent again; no country recognises it.', AFRICA, 'revolution');
  take(b, somal91, id('Somaliland'), [id('Somalia')], [b.shape('Somaliland')], null, FADE);
  rename(b, somal91, id('Somaliland'), 'Somaliland');
  const yug: Array<[string, string, string, string?]> = [
    ['1991-06-25', 'Slovenia', 'Slovenia declares independence; a ten-day war follows.'],
    ['1991-06-25', 'Croatia', 'Croatia declares independence; war with the Yugoslav army and Serb rebels until 1995.'],
    ['1991-09-08', 'North Macedonia', 'Macedonia votes for independence.', 'Macedonia'],
    ['1992-03-03', 'Bosnia and Herzegovina', 'Bosnia declares independence; the siege of Sarajevo begins a month later and lasts nearly four years.'],
  ];
  for (const [date, c, about, as] of yug) free(date, c, [yu], about, EUROPE, as ? { as, name: `${as} independent` } : {});
  const vukovar = ev('Vukovar', T('1991-08-25'), T('1991-11-18'), 'The Yugoslav army and Serb paramilitaries besiege and destroy the Croatian town.', EUROPE, 'war');
  battle(vukovar, 'Vukovar', [19.0, 45.35], T('1991-08-25'), 200);
  const sarajevo = ev('The siege of Sarajevo', T('1992-04-05'), T('1996-02-29'), 'The longest siege of a capital in modern war: 1,425 days, nearly 14,000 dead.', EUROPE, 'war');
  battle(sarajevo, 'Sarajevo', [18.41, 43.86], T('1992-04-05'), 1425);
  const fry = ev('The Federal Republic of Yugoslavia', T('1992-04-27'), null, 'Serbia and Montenegro form a smaller Yugoslavia.', EUROPE, 'founding');
  rename(b, fry, yu, 'Federal Republic of Yugoslavia');
  const czsk = ev('The Velvet Divorce', T('1993-01-01', 0), null, 'Czechoslovakia splits peacefully in two.', EUROPE, 'treaty');
  take(b, czsk, id('Slovakia'), [cs], [b.shape('Slovakia')], null, FADE);
  rename(b, czsk, cs, 'Czech Republic');
  born.push(T('1993-01-01', 0), T('1993-01-01', 0));
  free('1993-05-24', 'Eritrea', [id('Ethiopia')], 'After thirty years of war and a referendum, Eritrea becomes independent of Ethiopia.', AFRICA);
  ev('The Rwandan genocide', T('1994-04-07'), T('1994-07-15'), 'In a hundred days, Hutu extremists kill some 800,000 Tutsi and moderate Hutu.', AFRICA, 'war');
  ev('South Africa\'s first free election', T('1994-04-27'), null, 'Millions queue for hours; Nelson Mandela becomes president on 10 May.', SOUTHERN_AFRICA);
  const pa = ev('The Palestinian Authority', T('1994-05-04'), null, 'By the Cairo agreement the Palestinian Authority takes over the Gaza Strip and Jericho; Yasser Arafat returns in July.', ME, 'treaty');
  const PA = id('Palestine');
  take(b, pa, PA, [id('Israel')], [GAZA(b), dots('Jericho', [[35.45, 31.86], 5])], null, FADE);
  rename(b, pa, PA, 'Palestinian Authority');
  free('1994-10-01', 'Palau', [us], 'The last of the American trust territory of the Pacific becomes independent.', AMERICAS);
  const srebrenica = ev('Srebrenica', T('1995-07-11'), T('1995-07-22'), 'Bosnian Serb forces kill more than 8,000 Bosniak men and boys in a UN "safe area": genocide.', EUROPE, 'war');
  battle(srebrenica, 'Srebrenica', [19.3, 44.1], T('1995-07-11'), 150);
  ev('Rabin assassinated', T('1995-11-04', 21), null, 'Yitzhak Rabin is shot at a peace rally in Tel Aviv by an Israeli extremist.', ME, 'collapse');
  ev('The Dayton Agreement', T('1995-12-14'), null, 'The war in Bosnia ends.', EUROPE, 'treaty');
  const oslo2 = ev('Oslo II', T('1995-12-31'), null, 'Israel withdraws from the West Bank\'s towns, Area A; Hebron follows in January 1997.', ME, 'treaty');
  take(b, oslo2, PA, [id('Israel')], [OSLO_TOWNS()], null, FADE);
  const hebron = ev('The Hebron Agreement', T('1997-01-17'), null, 'Most of Hebron passes to the Palestinian Authority.', ME, 'treaty');
  take(b, hebron, PA, [id('Israel')], [dots('Hebron', [[35.10, 31.53], 4])], null, FADE);
  const kabila = ev('Zaire becomes the Democratic Republic of the Congo', T('1997-05-17'), null, 'Laurent-Désiré Kabila\'s rebels, backed by Rwanda and Uganda, take Kinshasa; Mobutu flees.', AFRICA, 'revolution');
  rename(b, kabila, id('Democratic Republic of the Congo'), 'Democratic Republic of the Congo');
  const hk = ev('Hong Kong returned to China', T('1997-07-01', 0), null, 'At midnight the Union Jack comes down; Prince Charles and the last governor, Chris Patten, sail away on the Britannia. "One country, two systems."', EAST_ASIA, 'treaty');
  take(b, hk, cn, [uk], [b.shape('Hong Kong')], null, FADE);
  const samoa = ev('Western Samoa becomes Samoa', T('1997-07-04'), null, 'The country drops "Western" from its name.', AMERICAS);
  rename(b, samoa, id('Samoa'), 'Samoa');
  const kosovo = ev('The Kosovo War', T('1999-03-24'), T('1999-06-10'), 'NATO bombs Yugoslavia for 78 days to stop the expulsion of Kosovo\'s Albanians; Serbian forces withdraw, and the UN takes over Kosovo.', EUROPE, 'war');
  const UNMIK = b.country('UN Mission in Kosovo', '#4fa3e0');
  take(b, kosovo, UNMIK, [yu], [b.shape('Kosovo')], T('1999-06-10'), FADE);
  arrow(kosovo, 'Refugees to Albania and Macedonia', [[21.1, 42.6], [20.6, 42.2], [20.1, 41.9]], T('1999-03-28'), 30, T('1999-07-01'), REFUGEES);
  const tim99 = ev('East Timor votes to leave Indonesia', T('1999-08-30'), T('1999-10-25'), 'In a UN referendum 78.5 % vote for independence; militias backed by the army burn the country. An Australian-led force lands in September and the UN takes over.', SE_ASIA, 'treaty');
  const UNT = b.country('UN Transitional Administration in East Timor', '#4fa3e0');
  take(b, tim99, UNT, [id('Indonesia')], [b.shape('Timor-Leste')], T('1999-10-25'), FADE);
  arrow(tim99, 'INTERFET', [[130.84, -12.46], [127.5, -9.5], [125.57, -8.56]], T('1999-09-20'), 5, T('1999-12-01'), ALLIED);
  const macau = ev('Macau returned to China', T('1999-12-20', 0), null, 'The last European colony in Asia, after 442 years of Portuguese rule.', EAST_ASIA, 'treaty');
  take(b, macau, cn, [pt], [b.shape('Macau')], null, { style: 'fade', for: { n: 7, unit: 'day' } });
  void be;
  return born;
}

function statistics(b: Builder, born: Instant[]): void {
  const T0 = T('1945-08-01');
  const un: Array<[string, number]> = [['1945-10-24', 51], ['1946-11-19', 55], ['1947-09-30', 57], ['1948-04-19', 58], ['1949-05-11', 59], ['1950-09-28', 60], ['1955-12-14', 76], ['1956-11-12', 79], ['1957-03-08', 81], ['1958-12-12', 82], ['1960-09-20', 99], ['1961-10-27', 104], ['1962-09-18', 110], ['1963-12-16', 113], ['1964-12-01', 115], ['1965-09-21', 117], ['1966-12-09', 122], ['1967-12-14', 123], ['1968-11-12', 126], ['1970-10-13', 127], ['1971-12-07', 132], ['1973-09-18', 135], ['1974-09-17', 138], ['1975-11-10', 144], ['1976-12-15', 147], ['1977-09-20', 149], ['1978-12-19', 151], ['1979-09-18', 152], ['1980-09-16', 154], ['1981-11-11', 157], ['1983-09-23', 158], ['1984-09-21', 159], ['1990-09-18', 160], ['1991-09-17', 166], ['1992-05-22', 178], ['1993-07-28', 184], ['1994-12-15', 185], ['1999-09-14', 188]];
  const sorted = [...born].sort((x, y) => x.day - y.day || x.ms - y.ms);
  b.commit(cmd.setMapStatistics(b.world, b.space, [
    stat('UN members', 'number', 'step', [[T0, 0], ...un.map(([d, n]): [Instant, number] => [T(d), n])], 0),
    stat('New states', 'number', 'step', [[T0, 0], ...sorted.map((t, i): [Instant, number] => [t, i + 1])], 0),
    stat('Ruled from abroad', 'count', 'linear', [[T('1945-09-01'), 750e6], [T('1947-08-14'), 720e6], [T('1947-08-16'), 320e6], [T('1949-12-26'), 290e6], [T('1949-12-28'), 210e6], [T('1957-12-31'), 160e6], [T('1960-12-31'), 90e6], [T('1965-12-31'), 40e6], [T('1975-12-31'), 15e6], [T('1980-12-31'), 8e6], [T('1990-12-31'), 4e6], [T('1997-06-30'), 3e6], [T('1997-07-02'), 2e6], [T('1999-12-31'), 2e6]], 0),
  ]));
}

/**
 * A journey of stays (D178): at each place from its date until setting out for the next, `days` before arriving
 * there (three when not given). A leader who stays put for years is not seen drifting across the map meanwhile.
 */
function trip(b: Builder, name: string, legs: Array<[string | Instant, Place, number?]>, o: { notes?: string; leaves?: Instant } = {}): string {
  const at = (d: string | Instant) => (typeof d === 'string' ? T(d) : d);
  const points: Array<[Instant, Place]> = [];
  legs.forEach(([d, place, days], i) => {
    const arrive = at(d);
    if (i > 0) {
      const [since, from] = points[points.length - 1];
      const leave = later(arrive, -(days ?? 3));
      if (leave.day > since.day || (leave.day === since.day && leave.ms > since.ms)) points.push([leave, from]);
    }
    points.push([arrive, place]);
  });
  return journey(b, name, points, o);
}

function characters(b: Builder): void {
  const DELHI: Place = [77.21, 28.61], HANOI: Place = [105.85, 21.03], VIET_BAC: Place = [105.3, 21.9], NAIROBI: Place = [36.82, -1.29], MOSCOW: Place = [37.62, 55.75];
  trip(b, 'Mahatma Gandhi', [['1945-06-01', [78.62, 20.73]], ['1946-04-01', DELHI, 2], ['1946-11-07', [91.0, 22.8], 4], ['1947-03-02', [85.14, 25.61], 3], ['1947-04-01', DELHI, 2], ['1947-08-01', [74.8, 34.08], 3], ['1947-08-06', [74.35, 31.55], 2], ['1947-08-07', [85.14, 25.61], 1], ['1947-08-09', [88.36, 22.57], 1], ['1947-09-09', DELHI, 2]], { notes: 'Mohandas Karamchand Gandhi, who led India\'s struggle by non-violence. He spent independence day in Calcutta, fasting against the killing.', leaves: T('1948-01-30', 17) });
  trip(b, 'Ho Chi Minh', [['1945-09-02', HANOI], ['1946-06-12', [2.35, 48.86], 12], ['1946-10-20', [106.68, 20.86], 30], ['1946-10-22', HANOI, 1], ['1946-12-21', VIET_BAC, 2], ['1954-10-15', HANOI, 3]], { notes: 'Leader of the Viet Minh and president of North Vietnam.', leaves: T('1969-09-02') });
  trip(b, 'Kwame Nkrumah', [['1947-12-16', [-0.19, 5.6]], ['1966-02-21', [116.4, 39.9], 4], ['1966-03-02', [-13.7, 9.5], 3]], { notes: 'Leader of Ghana\'s independence and of pan-Africanism; overthrown while visiting Beijing.', leaves: T('1972-04-27') });
  trip(b, 'Patrice Lumumba', [['1958-10-01', [15.31, -4.32]], ['1960-12-02', [14.86, -5.25], 1], ['1961-01-17', [27.48, -11.66], 1]], { notes: 'First prime minister of the independent Congo.', leaves: T('1961-01-17', 22) });
  trip(b, 'Jomo Kenyatta', [['1946-09-24', NAIROBI], ['1952-12-03', [35.12, 1.24], 2], ['1953-04-15', [35.75, 4.27], 3], ['1959-04-14', [35.6, 3.12], 2], ['1961-04-11', [36.70, 1.10], 2], ['1961-08-14', NAIROBI, 1]], { notes: 'Kenya\'s first prime minister and president, held by the British for nine years.', leaves: T('1978-08-22') });
  trip(b, 'Nelson Mandela', [['1945-06-01', [28.05, -26.2]], ['1962-08-05', [30.23, -29.49], 1], ['1962-08-10', [28.19, -25.75], 2], ['1964-06-13', [18.37, -33.81], 1], ['1982-03-31', [18.47, -34.04], 1], ['1988-12-07', [18.92, -33.72], 1], [T('1990-02-11', 16), [18.42, -33.93], 0.1], ['1990-02-13', [27.87, -26.23], 1], ['1994-05-10', [28.21, -25.74], 1]], { notes: 'Prisoner for 27 years, then South Africa\'s first democratically elected president.' });
  trip(b, 'Sukarno', [['1945-08-17', [106.85, -6.2]], ['1946-01-04', [110.37, -7.8], 1], ['1948-12-22', [98.95, 2.66], 3], ['1949-02-01', [105.17, -2.06], 2], ['1949-07-06', [110.37, -7.8], 1], ['1949-12-28', [106.85, -6.2], 1]], { notes: 'Indonesia\'s first president, captured and exiled by the Dutch in 1948.', leaves: T('1970-06-21') });
  trip(b, 'Mikhail Gorbachev', [['1985-03-11', MOSCOW], ['1991-08-04', [33.78, 44.39], 1], ['1991-08-22', MOSCOW, 1]], { notes: 'Last leader of the Soviet Union.', leaves: T('1991-12-25', 19) });
}

function shots(b: Builder): void {
  const STATS = 'Members of the United Nations: {UN members}\nNew states since 1945: {New states}\nRuled from abroad: about {Ruled from abroad}';
  shot(b, {
    name: '1 The world in 1945', title: 'The world in 1945', subtitle: 'A third of humanity ruled from abroad', look: 'atlas', stats: STATS,
    time: [[0, T('1945-09-03')], [16, T('1945-10-30')]], camera: [[0, { lon: 15, lat: 15, zoom: 0.55 }], [16, { lon: 20, lat: 12, zoom: 0.65 }]],
    captions: [
      { text: 'The British Empire: a quarter of the world', from: T('1945-09-05'), to: T('1945-09-30'), anchor: [78.0, 22.0], x: 0.62, y: 0.25 },
      { text: 'France\'s empire in Africa and Indochina', from: T('1945-09-20'), to: T('1945-10-20'), anchor: [2.0, 15.0], x: 0.12, y: 0.25, align: 'left' },
    ],
  });
  shot(b, {
    name: '2 Partition, 1947', title: 'The partition of India', subtitle: 'August 1947', look: 'atlas', characters: true, trails: true, eventsBox: { groups: [SOUTH_ASIA] },
    time: [[0, T('1947-07-01')], [30, T('1948-02-15')]], camera: [[0, { lon: 80, lat: 24, zoom: 3.4 }], [30, { lon: 80, lat: 25, zoom: 3.2 }]], projection: 'mercator', captions: [],
  });
  shot(b, {
    name: '3 Asia after the war, 1945 to 1957', title: 'Asia after the war', subtitle: '1945 to 1957', look: 'atlas', eventsBox: { groups: ASIA }, stats: STATS,
    time: [[0, T('1945-08-15')], [45, T('1957-12-31')]], camera: [[0, { lon: 112, lat: 18, zoom: 2.0 }], [45, { lon: 112, lat: 15, zoom: 2.1 }]], captions: [],
  });
  shot(b, {
    name: '4 The Korean War, 1950 to 1953', title: 'The Korean War', subtitle: '1950 to 1953', look: 'atlas', eventsBox: { groups: [EAST_ASIA] },
    time: [[0, T('1950-06-01')], [12, T('1950-12-31')], [24, T('1951-06-30')], [30, T('1953-08-31')]], camera: [[0, { lon: 127.5, lat: 37.8, zoom: 4.8 }], [30, { lon: 127.5, lat: 38.0, zoom: 4.8 }]], projection: 'mercator', captions: [],
  });
  shot(b, {
    name: '5 Africa, 1951 to 1968', title: 'Africa', subtitle: 'The year of Africa, and the decade around it', look: 'atlas', characters: true, eventsBox: { groups: [AFRICA, SOUTHERN_AFRICA] }, stats: STATS,
    time: [[0, T('1951-01-01')], [10, T('1959-12-31')], [32, T('1960-12-31')], [50, T('1968-12-31')]], camera: [[0, { lon: 18, lat: 4, zoom: 1.75 }], [50, { lon: 18, lat: 2, zoom: 1.75 }]], captions: [],
  });
  shot(b, {
    name: '6 The Middle East, 1946 to 1999', title: 'The Middle East', subtitle: 'Mandates, wars and borders', look: 'atlas', eventsBox: { groups: [ME] }, precision: 'month',
    time: [[0, T('1946-01-01')], [50, T('1999-12-31')]], camera: [[0, { lon: 40, lat: 28, zoom: 2.9 }], [50, { lon: 40, lat: 28, zoom: 2.9 }]], projection: 'mercator', captions: [],
  });
  shot(b, {
    name: '7 Indochina, 1945 to 1979', title: 'Indochina', subtitle: 'Thirty years of war', look: 'atlas', characters: true, eventsBox: { groups: [INDOCHINA] }, precision: 'month',
    time: [[0, T('1945-08-15')], [45, T('1979-03-01')]], camera: [[0, { lon: 105.5, lat: 15.5, zoom: 3.4 }], [45, { lon: 105.5, lat: 15.5, zoom: 3.4 }]], projection: 'mercator', captions: [],
  });
  shot(b, {
    name: '8 Southern Africa, 1964 to 1994', title: 'Southern Africa', subtitle: '1964 to 1994', look: 'atlas', characters: true, trails: true, eventsBox: { groups: [SOUTHERN_AFRICA] },
    time: [[0, T('1964-01-01')], [45, T('1994-06-01')]], camera: [[0, { lon: 26, lat: -18, zoom: 2.4 }], [45, { lon: 25, lat: -22, zoom: 2.5 }]], captions: [],
  });
  shot(b, {
    name: '9 The end of the Soviet Union and Yugoslavia, 1989 to 1999', title: 'The end of the Soviet Union and Yugoslavia', subtitle: '1989 to 1999', look: 'atlas', characters: true, eventsBox: { groups: [EUROPE] }, stats: STATS,
    time: [[0, T('1989-10-01')], [30, T('1992-06-01')], [45, T('1999-12-31')]], camera: [[0, { lon: 50, lat: 46, zoom: 2.1 }], [30, { lon: 50, lat: 46, zoom: 2.1 }], [45, { lon: 22, lat: 45, zoom: 3.0 }]], captions: [],
  });
  shot(b, {
    name: '10 Half a century in two minutes, 1945 to 1999', title: 'The end of empires', subtitle: '1945 to 1999', look: 'atlas', precision: 'year', stats: STATS, eventsBox: { groups: [...ASIA, ME, AFRICA, SOUTHERN_AFRICA, AMERICAS, EUROPE, WORLD] },
    time: [[0, T('1945-08-01')], [120, T('1999-12-31')]], camera: [[0, { lon: 20, lat: 12, zoom: 0.62 }], [120, { lon: 20, lat: 12, zoom: 0.62 }]], captions: [],
  });
}
