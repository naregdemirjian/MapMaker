// The story of the "Greater Armenia" example (D171), from the user's outline, 2039 to 2178. Where the outline
// disagrees with itself the dated outline wins (see D171): the revolution in 2042 and office in 2043; the world's
// people 17 billion when the war begins, 6 billion at its end, about 20 million after the exchange; the two
// hyperwars in 2171 and 2173. AM is Greater Armenia; IPAM its interplanetary mining project, launched near the
// Metsamor power plant; DMRK its main port, placed here at Mersin.
import * as cmd from '../domain/commands.ts';
import { toJSONValue, type Instant } from '../core-time/index.ts';
import type { Builder } from './kit.ts';
import { D, event, take, annex, clear, clearAllBut, featureLayer, feature, city, stat, shot, circle } from './kit.ts';

export type { Place } from './kit.ts';
import type { Place } from './kit.ts';

// ---------------------------------------------------------------- places

const P = {
  yerevan: [44.51, 40.18], gyumri: [43.85, 40.79], vanadzor: [44.49, 40.81], sevan: [45.0, 40.55], goris: [46.34, 39.51],
  ipam: [44.11, 40.14], metsamor: [44.148, 40.18], dmrk: [34.64, 36.8],
  ankara: [32.86, 39.93], istanbul: [28.98, 41.01], izmir: [27.14, 38.42], kars: [43.1, 40.6], erzurum: [41.27, 39.9], erzincan: [39.5, 39.75], sivas: [37.02, 39.75], yozgat: [34.8, 39.82],
  bolu: [31.6, 40.73], izmit: [29.92, 40.77], van: [43.38, 38.5], gaziantep: [37.38, 37.07], afyon: [30.54, 38.76], konya: [32.48, 37.87], antalya: [30.7, 36.9], malatya: [38.31, 38.35], artvin: [41.82, 41.18],
  baku: [49.87, 40.41], ganja: [46.36, 40.68], yevlakh: [47.15, 40.62], kurdamir: [48.15, 40.35], dilijan: [44.86, 40.74],
  tbilisi: [44.79, 41.72], batumi: [41.64, 41.65], akhalkalaki: [43.48, 41.4], damascus: [36.29, 33.51], aleppo: [37.16, 36.2], homs: [36.72, 34.73], beirut: [35.5, 33.89], nicosia: [33.36, 35.17],
  baghdad: [44.36, 33.31], mosul: [43.13, 36.34], basra: [47.78, 30.51], tehran: [51.39, 35.69], tabriz: [46.29, 38.08], isfahan: [51.67, 32.65], shiraz: [52.53, 29.59], mashhad: [59.6, 36.3], ahvaz: [48.67, 31.32], zahedan: [60.86, 29.5], chabahar: [60.64, 25.29], kerman: [57.08, 30.28],
  amman: [35.93, 31.95], jerusalem: [35.21, 31.77], telaviv: [34.78, 32.08], kuwait: [47.98, 29.37], riyadh: [46.72, 24.71], dammam: [50.1, 26.43], doha: [51.53, 25.29], manama: [50.58, 26.23], abudhabi: [54.37, 24.45], dubai: [55.27, 25.2], muscat: [58.41, 23.59],
  islamabad: [73.05, 33.68], rawalpindi: [73.06, 33.6], lahore: [74.34, 31.55], karachi: [67.0, 24.86], amritsar: [74.87, 31.63], kasur: [74.45, 31.12],
  delhi: [77.21, 28.61], mumbai: [72.88, 19.08], kolkata: [88.36, 22.57], yangon: [96.15, 16.8], bangkok: [100.5, 13.75], kualalumpur: [101.69, 3.14],
  cairo: [31.24, 30.04], tripoli: [13.19, 32.89], algiers: [3.06, 36.75], casablanca: [-7.59, 33.57], ndjamena: [15.04, 12.13], niamey: [2.11, 13.51], bamako: [-8.0, 12.64], dakar: [-17.45, 14.69],
  ashgabat: [58.38, 37.95], tashkent: [69.24, 41.3], almaty: [76.89, 43.24], samarkand: [66.96, 39.65], kyzylorda: [65.51, 44.85],
  rostov: [39.72, 47.23], moscow: [37.62, 55.75], arkhangelsk: [40.52, 64.54], odesa: [30.73, 46.48],
  washington: [-77.04, 38.9], london: [-0.13, 51.51], paris: [2.35, 48.86], berlin: [13.4, 52.52], rome: [12.5, 41.9], beijing: [116.4, 39.9], tokyo: [139.69, 35.69], athens: [23.73, 37.98], newyork: [-74.0, 40.71],
} satisfies Record<string, Place>;

// A random stream that is the same every time (the example is built the same way each time).
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const at = (t: Instant) => toJSONValue(t) as [number, number];

export function story(b: Builder): void {
  const { world, space } = b;
  const AM_COLOR = '#9b1d3a';
  const armenia = b.country('Armenia');
  b.commit(cmd.updateEntity(world, armenia, { color: AM_COLOR, notes: 'AM. Greater Armenia from 2043, ruled by Arman Manookian.' }));
  const AM = armenia;
  const T = (n: string) => b.country(n);

  // Layers of the story: offensives (campaign arrows), allied offensives, spies, places, crises, drones.
  const arrows = featureLayer(b, 'Offensives', 'line', { look: 'arrow', width: 18, color: '#f2b134', showName: false });
  const allied = featureLayer(b, 'Allied offensives', 'line', { look: 'arrow', width: 14, color: '#3b6fd8', showName: false });
  const spies = featureLayer(b, 'Spy networks', 'point', { symbol: 'diamond', size: 12, color: '#e9c46a', showName: true });
  const places = featureLayer(b, 'Places', 'point', { symbol: 'star', size: 14, color: '#ffd166', showName: true });
  const crises = featureLayer(b, 'Crises', 'area', { color: '#e76f51', fillOpacity: 0.18, hatch: 'diagonal', dash: 'dashed', width: 2, showName: true });
  const drones = featureLayer(b, 'Drone swarms', 'line', { look: 'line', width: 3.5, dash: 'dotted', flow: 'dots', flowSpeed: 160, color: '#ffd166', showName: false });
  const hits = featureLayer(b, 'Strikes', 'point', { symbol: 'battle', size: 12, color: '#ff6b35', showName: false });

  // Cities.
  for (const [name, p] of [
    ['Yerevan', P.yerevan], ['Gyumri', P.gyumri], ['Ankara', P.ankara], ['Istanbul', P.istanbul], ['Izmir', P.izmir], ['Baku', P.baku], ['Tbilisi', P.tbilisi],
    ['Damascus', P.damascus], ['Beirut', P.beirut], ['Baghdad', P.baghdad], ['Mosul', P.mosul], ['Nicosia', P.nicosia], ['Tehran', P.tehran], ['Amman', P.amman],
    ['Jerusalem', P.jerusalem], ['Kuwait City', P.kuwait], ['Riyadh', P.riyadh], ['Doha', P.doha], ['Abu Dhabi', P.abudhabi], ['Muscat', P.muscat], ['Islamabad', P.islamabad],
    ['Karachi', P.karachi], ['New Delhi', P.delhi], ['Cairo', P.cairo], ['Moscow', P.moscow], ['Tashkent', P.tashkent], ['Beijing', P.beijing], ['Washington', P.washington],
    ['London', P.london], ['Paris', P.paris], ['Berlin', P.berlin], ['Tokyo', P.tokyo],
  ] as Array<[string, Place]>) city(b, name, p);

  // ============================================================ 1. The rise, 2039 to 2060
  const RISE = 'The rise';
  event(b, 'An unknown figure starts a nationwide movement', D(2039, 3, 14), D(2042, 9, 1), { group: RISE, about: 'Nobody knows who leads it. It spreads through every town in Armenia.' });
  event(b, 'Revolution', D(2042, 9, 21), D(2042, 12, 21), { type: 'revolution', group: RISE, about: 'The movement becomes a revolution.' });
  const president = event(b, 'The unknown figure is declared president', D(2042, 12, 21), null, { group: RISE, about: 'He announces his name: Arman Manookian, indisputably an Armenian. Everyone sees he is one of the smartest people in the nation; some see far more than that.' });
  const office = event(b, 'Manookian takes office: Greater Armenia', D(2043, 1, 15), null, { group: RISE, about: 'Arman Manookian is sworn in. The republic is renamed Greater Armenia (AM).' });
  b.commit(cmd.renameFrom(world, { entity: AM, name: 'Greater Armenia', mode: { kind: 'new', eventId: office } }));
  const manookian = b.commit(cmd.createEntity(world, { type_id: 'character', name: 'Arman Manookian', notes: 'Over a hundred years old, though no one knows it. He chose Armenia to rise to the top. In 2090 he "dies" and his son, who looks just like him, takes power: it is still him.' }));
  b.commit(cmd.placeCharacter(world, { spaceId: space, entity: manookian, lon: P.yerevan[0], lat: P.yerevan[1], mode: { kind: 'new', eventId: president } }));
  event(b, 'Espionage begins in neighbouring countries', D(2045, 1, 15), null, { group: RISE, about: 'Known only to the highest officials: in his third year in power Manookian orders spies into the neighbouring countries.' });
  event(b, 'The education system is rebuilt', D(2046, 2, 1), null, { group: RISE, about: 'Teachers are paid $350,000 to $1 million a year. Becoming a teacher is harder than becoming a doctor.' });
  event(b, 'The invasion plan begins', D(2046, 9, 1), null, { group: RISE, about: 'In secret. The economy has grown to $72 billion.' });
  const spiesOut = event(b, 'Spies sent abroad', D(2048, 4, 1), D(2048, 10, 1), { group: RISE, about: 'Into Turkey, Azerbaijan, America, Israel, Iran and Greece. Over the next two decades they rise into corporations and armies.' });
  for (const [n, p] of [['Ankara cell', P.ankara], ['Istanbul cell', P.istanbul], ['Baku cell', P.baku], ['Washington cell', P.washington], ['New York cell', P.newyork], ['Tel Aviv cell', P.telaviv], ['Tehran cell', P.tehran], ['Athens cell', P.athens]] as Array<[string, Place]>) {
    feature(b, spies, n, [[p]], spiesOut, { anim: 'grow', until: D(2066, 5, 6) });
  }
  event(b, 'The boom', D(2049, 6, 1), D(2058, 1, 1), { group: RISE, about: 'The economy grows 500 % in five years and 5,000 % in ten. Multi-billion and trillion-dollar companies are founded in Armenia; others boom in Turkey and Azerbaijan, and Manookian congratulates them.' });

  // ============================================================ 2. The Week War, 20 April to 6 May 2066
  const WAR = 'The Week War';
  const TURKEY = T('Turkey'), AZ = T('Azerbaijan');
  const collapse = event(b, 'Spies pull out: Turkey and Azerbaijan collapse', D(2066, 4, 20), D(2066, 4, 23), { type: 'collapse', group: WAR, about: 'The spies who control the largest corporations in Turkey and Azerbaijan pull out all at once. The economies and then the governments collapse.' });
  for (const n of ['Turkey', 'Azerbaijan']) feature(b, crises, `${n}: government collapse`, b.shape(n).polygons.map((poly) => poly[0]), collapse, { anim: 'fade', until: D(2066, 5, 6) });
  // The opening strikes: 40,000 tons in thirty minutes on air defences and bases (conventional).
  const bases66: Place[] = [[35.43, 37.0], [40.2, 37.89], [38.43, 38.43], [41.17, 39.96], [32.56, 37.98], [30.58, 39.78], [35.52, 40.83], [32.57, 40.08], [27.92, 39.62], [27.01, 38.51], [41.12, 37.93], [27.98, 40.32], [28.79, 36.71], [35.5, 38.77], [36.9, 39.81], [43.33, 38.47], [43.11, 40.56], [39.79, 40.99], [28.81, 40.98], [32.86, 39.92], [38.37, 38.23],
    [49.73, 40.73], [48.17, 40.35], [46.32, 40.74], [49.87, 40.41], [47.79, 40.87], [45.46, 39.19], [48.85, 38.75], [47.15, 40.6], [49.4, 40.8]];
  const silos66: Place[] = [P.yerevan, P.gyumri, P.vanadzor, P.sevan, P.goris];
  const r66 = rng(66);
  b.commit(cmd.missileSalvo(world, {
    spaceId: space, name: 'Opening strikes: 40,000 tons in 30 minutes', launch: D(2066, 4, 24, 0, 0), arrive: D(2066, 4, 24, 0, 30), strike: 'conventional', entity: AM, color: '#ffb347',
    description: 'At 12 am air defences and military bases across Turkey and Azerbaijan are wiped out. Spies who rose into high military ranks over two decades sabotage the rest.',
    flights: [...bases66, ...bases66.slice(0, 15)].map((to, i) => ({ from: silos66[i % silos66.length], to, launch: D(2066, 4, 24, 0, Math.floor(r66() * 18)) })),
  }));
  event(b, 'Sabotage from within', D(2066, 4, 24), D(2066, 4, 25), { type: 'war', group: WAR, about: 'Spies in the highest military ranks begin extreme sabotage. 300,000 enemy soldiers die on the first day.' });
  const tk = (names: string[]) => b.regionsOf('Turkey', names);
  const azBand = (lo: number, hi: number) => b.regionsOf('Azerbaijan', (r) => { const p = r.polygons[0][0]; let x = 0; for (const q of p) x += q[0]; x /= p.length; return x >= lo && x < hi; });
  const stage = (name: string, start: Instant, end: Instant, about: string, turkey: string[], az: [number, number] | null, look = 'blitz') => {
    const id = event(b, name, start, end, { type: 'conquest', group: WAR, about, look });
    if (turkey.length) take(b, id, AM, [TURKEY], tk(turkey));
    if (az) take(b, id, AM, [AZ], azBand(az[0], az[1]));
    return id;
  };
  stage('Day one: the fork blitzkrieg', D(2066, 4, 24, 0, 30), D(2066, 4, 25), 'Extremely fast land vehicles take the first towns in a fork towards both Ankara and Baku.', ['Kars', 'Ardahan', 'Iğdir', 'Agri', 'Erzurum', 'Van', 'Artvin'], [44, 46.7]);
  stage('Day two: the east falls', D(2066, 4, 25), D(2066, 4, 26), 'Eastern Anatolia and western Azerbaijan fall.', ['Bayburt', 'Erzincan', 'Mus', 'Bitlis', 'Bingöl', 'Rize', 'Gümüshane', 'Trabzon', 'Hakkari', 'Sirnak', 'Siirt', 'Batman', 'Tunceli'], [46.7, 47.6]);
  stage('Day three: towards Sivas and the Kura', D(2066, 4, 26), D(2066, 4, 27), 'The northern column reaches Sivas; the eastern one crosses the Kura plain.', ['Sivas', 'Giresun', 'Ordu', 'Elazig', 'Malatya', 'Diyarbakir', 'Mardin', 'Tokat'], [47.6, 48.6]);
  const baku = stage('Baku taken', D(2066, 4, 27, 12), D(2066, 4, 28, 12), 'The eastern column takes Baku. Azerbaijan has fallen.', ['Yozgat', 'Kayseri', 'Amasya', 'Samsun', 'Çorum', 'Sanliurfa', 'Adiyaman', 'K. Maras', 'Gaziantep', 'Kilis'], null);
  annex(b, baku, AM, ['Azerbaijan']);
  stage('Central Anatolia', D(2066, 4, 28, 12), D(2066, 4, 29, 12), 'The road to Ankara is open.', ['Kirsehir', 'Nevsehir', 'Kinkkale', 'Çankiri', 'Sinop', 'Kastamonu', 'Osmaniye', 'Adana', 'Hatay', 'Nigde', 'Aksaray'], null);
  stage('Ankara taken', D(2066, 4, 29, 12), D(2066, 4, 30, 12), 'The northern column takes the capital.', ['Ankara', 'Konya', 'Karaman', 'Mersin', 'Karabük', 'Bartın', 'Zinguldak', 'Bolu', 'Eskisehir'], null);
  stage('Istanbul taken', D(2066, 4, 30, 12), D(2066, 5, 1, 18), 'Istanbul falls on the first of May.', ['Istanbul', 'Kocaeli', 'Sakarya', 'Düzce', 'Yalova', 'Bilecik', 'Bursa', 'Tekirdag', 'Edirne', 'Kirklareli'], null);
  const counter = event(b, 'Allied counter-attack towards Yerevan', D(2066, 5, 1), D(2066, 5, 4), { type: 'war', group: WAR, about: 'Allied forces attack towards Yerevan from Syria, Georgia and south-west Turkey. They are thrown back.' });
  for (const [n, pts] of [['From Syria', [P.aleppo, P.gaziantep, P.malatya]], ['From Georgia', [P.batumi, P.artvin, P.kars]], ['From south-west Turkey', [P.izmir, P.afyon, P.konya]]] as Array<[string, Place[]]>) {
    feature(b, allied, n, [pts], counter, { until: D(2066, 5, 6) });
  }
  const sweep = event(b, 'Georgia, Syria, Lebanon, Iraq and Cyprus taken', D(2066, 5, 2), D(2066, 5, 6), { type: 'conquest', group: WAR, about: 'By the sixth of May the Week War is over.', look: 'blitz' });
  annex(b, sweep, AM, ['Turkey', 'Georgia', 'Syria', 'Lebanon', 'Iraq', 'Cyprus', 'Turkish Republic of Northern Cyprus']);
  // The columns and thrusts (campaign arrows drawing themselves).
  const thrusts = event(b, 'The two columns', D(2066, 4, 24, 0, 30), D(2066, 5, 1, 18), { type: 'war', group: WAR, about: 'One column to Ankara and Istanbul, one to Baku.' });
  feature(b, arrows, 'To Ankara', [[P.yerevan, P.kars, P.erzurum, P.erzincan, P.sivas, P.yozgat, P.ankara]], thrusts, { until: D(2066, 5, 8) });
  const toBaku = event(b, 'The eastern column', D(2066, 4, 24, 0, 30), D(2066, 4, 28, 12), { type: 'war', group: WAR });
  feature(b, arrows, 'To Baku', [[P.yerevan, P.dilijan, P.ganja, P.yevlakh, P.kurdamir, P.baku]], toBaku, { until: D(2066, 5, 8) });
  const south = event(b, 'Into the Levant and Mesopotamia', D(2066, 5, 2), D(2066, 5, 6), { type: 'war', group: WAR });
  feature(b, arrows, 'To Damascus and Beirut', [[P.gaziantep, P.aleppo, P.homs, P.damascus, P.beirut]], south, { until: D(2066, 5, 10) });
  feature(b, arrows, 'To Baghdad', [[P.van, P.mosul, P.baghdad]], south, { until: D(2066, 5, 10) });
  feature(b, arrows, 'To Tbilisi', [[P.kars, P.akhalkalaki, P.tbilisi]], south, { until: D(2066, 5, 10) });

  // ============================================================ 3. South to the Gulf, 2072
  const GULF = 'The Gulf';
  const iran = event(b, 'Invasion of Iran', D(2072, 3, 10), D(2072, 4, 20), { type: 'conquest', group: GULF, about: 'Iran falls in six weeks.', look: 'blitz' });
  annex(b, iran, AM, ['Iran']);
  feature(b, arrows, 'To Tehran', [[P.tabriz, [48.5, 36.7], P.tehran]], iran, { until: D(2072, 5, 1) });
  feature(b, arrows, 'To Shiraz', [[P.basra, P.ahvaz, P.isfahan, P.shiraz]], iran, { until: D(2072, 5, 1) });
  event(b, 'AM\'s spies threaten America', D(2072, 3, 12), null, { group: GULF, about: 'If America intervenes, its own government will pay for it. The spies have been preparing this for twenty-five years.' });
  const levant = event(b, 'Jordan and Israel taken', D(2072, 4, 25), D(2072, 5, 20), { type: 'conquest', group: GULF, look: 'blitz' });
  annex(b, levant, AM, ['Jordan', 'Israel', 'Palestine']);
  feature(b, arrows, 'To Jerusalem', [[P.damascus, P.amman, P.jerusalem]], levant, { until: D(2072, 6, 1) });
  const kw = event(b, 'Kuwait invaded', D(2072, 6, 2), D(2072, 6, 4), { type: 'conquest', group: GULF, look: 'blitz' });
  annex(b, kw, AM, ['Kuwait']);
  event(b, 'Saudi Arabia intervenes', D(2072, 6, 5), null, { type: 'war', group: GULF, about: 'Saudi Arabia enters the war when Kuwait is invaded.' });
  const gulf = event(b, 'The Gulf campaign', D(2072, 6, 10), D(2072, 8, 20), { type: 'conquest', group: GULF, about: 'The eastern coast of Saudi Arabia, Bahrain, Qatar, the Emirates and eastern Oman are taken.', look: 'blitz' });
  take(b, gulf, AM, [T('Saudi Arabia')], [{ name: 'Eastern coast', polygons: [[[[47.5, 29.3], [50.6, 29.3], [51.0, 25.6], [51.7, 24.1], [51.6, 22.6], [49.4, 22.6], [48.6, 24.5], [47.6, 27.2]]]] }]);
  annex(b, gulf, AM, ['Bahrain', 'Qatar', 'United Arab Emirates']);
  take(b, gulf, AM, [T('Oman')], b.regionsOf('Oman', ['Muscat', 'Al Batnah North', 'Al Batnah South', 'Ash Sharqiyah North', 'Ash Sharqiyah South', 'Ad Dakhliyah', 'Musandam', 'Al Buraymi', 'Al Dhahira']));
  feature(b, arrows, 'Down the Gulf', [[P.kuwait, P.dammam, P.doha, P.abudhabi, P.dubai, P.muscat]], gulf, { until: D(2072, 9, 1) });

  // ============================================================ 4. The golden age, 2072 to 2156
  const GOLD = 'The golden age';
  event(b, 'AM dominates the AI and technology markets', D(2076, 1, 1), D(2100, 1, 1), { group: GOLD, about: 'AM\'s companies lead the world in AI and technology. Every other economy grows several times over too: AM thinks the rest of the world inferior, but it depends on it.' });
  const dies = event(b, 'Manookian dies; his son takes power', D(2090, 6, 1), null, { group: GOLD, about: 'His son looks just like him. It is still him.' });
  b.commit(cmd.renameFrom(world, { entity: manookian, name: 'Manookian "the son"', mode: { kind: 'new', eventId: dies } }));
  const ipamStart = event(b, 'The Interplanetary Mining Project (IPAM) begins', D(2105, 3, 1), D(2142, 11, 1), { group: GOLD, about: 'A risk of $140 trillion: mining the asteroids from a launch complex near Metsamor.' });
  feature(b, places, 'IPAM launch complex', [[P.ipam]], ipamStart, { anim: 'grow' });
  const port = event(b, 'DMRK becomes AM\'s main port', D(2120, 1, 1), null, { group: GOLD });
  feature(b, places, 'DMRK (main port)', [[P.dmrk]], port, { anim: 'grow' });
  event(b, 'ASA I-PAM automated: the risk pays off', D(2142, 11, 1), null, { group: GOLD, about: 'The automated mining fleet takes the economy from $150 trillion towards a quadrillion dollars.' });

  // ============================================================ 5. Pakistan, 2156
  const PAK = 'Pakistan';
  event(b, 'Rumours: the military budget rises a hundredfold', D(2156, 2, 20), null, { group: PAK, about: 'Spies report that other countries may be scheming. On rumours alone AM raises its military budget from $5 trillion to $500 trillion.' });
  event(b, 'AM recalls 70 % of its construction robots', D(2156, 2, 25), null, { group: PAK, about: 'AM owns every AI construction robot in the world. Only the countries that bid highest keep theirs.' });
  event(b, '100 million conscripted; Mach 100 ICBMs', D(2156, 3, 1), null, { group: PAK, about: 'The army conscripts about 100 million. IPAM gives missiles and drones the first call on its materials. Tens of thousands of Mach 100 ICBMs are built, $20 billion each.' });
  const pakSites: Place[] = [[72.67, 32.08], [66.64, 27.8], [70.63, 30.05], [67.0, 24.86], [62.32, 25.12], [68.98, 27.86], [66.94, 24.89], [66.99, 30.18]];
  const rp = rng(2156);
  b.commit(cmd.missileSalvo(world, {
    spaceId: space, name: 'Pakistan launches 62 warheads at IPAM', launch: D(2156, 4, 2, 14, 0), arrive: D(2156, 4, 2, 14, 12), color: '#7fc8f8',
    description: 'All 62 are deflected.',
    flights: Array.from({ length: 62 }, (_, i) => ({ from: pakSites[i % pakSites.length], to: [P.ipam[0] + (rp() - 0.5) * 0.6, P.ipam[1] + (rp() - 0.5) * 0.4] as Place, shotDown: 0.5 + 0.4 * rp(), launch: D(2156, 4, 2, 14, Math.floor(rp() * 3)) })),
  }));
  const pakTargets: Place[] = [[73.09, 33.73], [73.1, 33.74], [73.06, 33.6], [72.67, 32.08], [66.94, 24.89], [72.4, 33.87], [71.52, 34.0], [66.99, 30.18], [66.98, 24.82], [74.4, 31.52], [71.42, 30.2], [68.45, 28.28], [66.64, 27.8], [68.98, 27.86], [70.63, 30.05],
    [62.32, 25.12], [67.98, 25.25], [71.57, 32.56], [75.56, 35.34], [67.12, 24.9], [72.28, 30.76], [72.79, 32.9], [66.94, 30.25], [71.98, 34.07], [73.1, 33.62], [64.6, 25.27], [73.86, 32.81], [74.53, 32.49], [74.19, 32.16], [72.35, 33.77]];
  b.commit(cmd.missileSalvo(world, {
    spaceId: space, name: 'AM answers: 30 Mach 100 ICBMs', launch: D(2156, 4, 2, 14, 1), arrive: D(2156, 4, 2, 14, 3), strike: 'conventional', entity: AM, color: '#ff4d4d',
    description: 'The government of Pakistan is hit within two minutes of the attack. The president and many ministers are killed.',
    flights: pakTargets.map((to, i) => ({ from: [P.ipam, P.isfahan, P.mashhad][i % 3], to })),
  }));
  const swarm = event(b, '1.5 million drones', D(2156, 4, 2, 14, 5), D(2156, 4, 2, 18, 5), { type: 'war', group: PAK, about: 'They arrive within four hours: 40 military bases hit, 90,000 soldiers killed.' });
  for (const [i, from] of ([P.zahedan, P.chabahar, P.mashhad, P.kerman, P.zahedan, P.chabahar] as Place[]).entries()) feature(b, drones, `Drone swarm ${i + 1}`, [cmd.greatCircle(from, pakTargets[(i * 5) % pakTargets.length], 1, 0.5)], swarm, { until: D(2156, 4, 3, 6) });
  const hit = event(b, '40 military bases destroyed', D(2156, 4, 2, 18, 5), D(2156, 4, 2, 18, 40), { type: 'war', group: PAK });
  const rb = rng(40);
  for (let i = 0; i < 40; i++) { const p = pakTargets[i % pakTargets.length]; feature(b, hits, `Base ${i + 1}`, [[[p[0] + (i >= 30 ? (rb() - 0.5) * 2 : 0), p[1] + (i >= 30 ? (rb() - 0.5) * 2 : 0)]]], hit, { anim: 'grow', until: D(2157, 4, 1) }); }
  const occupied = b.commit(cmd.createEntity(world, { type_id: 'polity', name: 'Pakistan (occupied by AM)', color: '#c27c92' }));
  const surrender = event(b, 'Pakistan surrenders unconditionally', D(2156, 4, 3, 3), D(2156, 4, 4), { type: 'treaty', group: PAK, about: 'Thirteen hours after its attack, Pakistan surrenders without conditions and is occupied.' });
  annex(b, surrender, occupied, ['Pakistan'], null, { style: 'fade' });

  // ============================================================ 6. The embargo, 2159 to 2165
  const EMB = 'The embargo';
  const terror = event(b, 'Nuclear terror: IPAM and DMRK', D(2159, 8, 11, 9), D(2159, 8, 12), { type: 'disaster', group: EMB, about: 'A Pakistani terrorist group smuggles portable nuclear bombs into IPAM, devastating a launch zone and the nuclear power plant nearby, and into DMRK, killing 14 million.' });
  b.commit(cmd.addDisaster(world, { spaceId: space, disaster: 'nuclear', size: 20, windDeg: 100, at: P.ipam, t: D(2159, 8, 11, 9), eventId: terror, seed: 7 }));
  b.commit(cmd.addDisaster(world, { spaceId: space, disaster: 'nuclear', size: 20, windDeg: 100, at: P.metsamor, t: D(2159, 8, 11, 9, 4), eventId: terror, seed: 8 }));
  b.commit(cmd.addDisaster(world, { spaceId: space, disaster: 'nuclear', size: 500, windDeg: 60, at: P.dmrk, t: D(2159, 8, 11, 9, 7), eventId: terror, seed: 9 }));
  event(b, 'AM does not retaliate: exports stop', D(2159, 8, 12), D(2164, 5, 1), { group: EMB, about: 'AM recalls all its automated robots and stops exports to the world: DMRK was its main port. Its military budget rises to $1.1 quadrillion, more than double the rest of the world\'s economies together.' });
  event(b, 'The world arms itself', D(2160, 3, 1), null, { group: EMB, about: 'The rest of the world spends $300 trillion on its armies; about 5 billion people serve in them.' });
  event(b, 'AM opens its ports again', D(2164, 5, 1), null, { group: EMB });

  // ============================================================ 7. The world war, 2165 to 2175
  const WW = 'The world war';
  b.commit(cmd.missileSalvo(world, {
    spaceId: space, name: 'India strikes a village in Pakistan', launch: D(2165, 3, 2, 10), arrive: D(2165, 3, 2, 10, 4), strike: 'conventional', color: '#7fc8f8',
    description: 'AM lets India and Pakistan settle their quarrel. India\'s missiles destroy a village, killing 900 people, three of them AM citizens.',
    flights: [{ from: P.amritsar, to: P.kasur }, { from: [75.3, 31.3], to: [P.kasur[0] + 0.03, P.kasur[1] - 0.02] }],
  }));
  event(b, 'AM shuts its ports to India', D(2165, 3, 3), null, { group: WW });
  const ships = event(b, 'India sinks five AM freight ships', D(2165, 3, 10), D(2165, 3, 11), { type: 'war', group: WW });
  for (let i = 0; i < 5; i++) feature(b, hits, `Freight ship ${i + 1}`, [[[64 + i * 1.3, 20.5 - i * 0.6]]], ships, { anim: 'grow', until: D(2165, 6, 1) });
  event(b, 'AM blocks all exports to the world', D(2165, 3, 11), null, { group: WW });
  const invasion = event(b, 'The world invades AM', D(2165, 4, 1, 4), D(2165, 4, 20), { type: 'war', group: WW, about: 'A massive attack from Europe, from submarines in the Mediterranean, from Africa, from Russia and from China.' });
  for (const [n, pts] of [['From Europe', [[22.0, 42.7], [26.5, 41.6], P.istanbul]], ['From Russia', [P.rostov, [41.5, 44.5], P.tbilisi]], ['From Africa', [P.cairo, [33.5, 30.6], P.jerusalem]], ['From China', [[79.0, 39.5], [75.0, 37.0], P.islamabad]], ['From India', [P.delhi, P.lahore]]] as Array<[string, Place[]]>) {
    feature(b, allied, n, [pts], invasion, { until: D(2165, 6, 1) });
  }
  const amBases: Place[] = [[35.43, 37.0], [40.2, 37.89], [41.17, 39.96], [32.56, 37.98], [30.58, 39.78], [43.11, 40.56], [44.4, 40.1], [49.73, 40.73], [44.36, 33.31], [43.13, 36.34], [47.78, 30.51], [51.39, 35.69], [51.67, 32.65], [52.53, 29.59], [59.6, 36.3], [46.29, 38.08],
    [36.29, 33.51], [37.16, 36.2], [35.93, 31.95], [35.21, 31.77], [47.98, 29.37], [50.1, 26.43], [51.53, 25.29], [54.37, 24.45], [58.41, 23.59], [33.36, 35.17], [44.79, 41.72], [27.14, 38.42], [28.98, 41.01], [32.86, 39.92], [38.31, 38.35], [48.67, 31.32], [57.08, 30.28], [60.86, 29.5], [73.06, 33.6], [67.0, 24.86], [74.34, 31.55], [49.87, 40.41], [34.64, 36.8], [43.85, 40.79]];
  const attackers: Place[] = [[10, 51], [12.5, 42.5], [2.3, 47], [18, 35], [25, 34], [30, 33.6], [44.5, 48.7], [86, 42], [31, 27], [77, 28.6]];
  b.commit(cmd.missileSalvo(world, {
    spaceId: space, name: 'First hour: 600 kilotons on AM', launch: D(2165, 4, 1, 4, 0), arrive: D(2165, 4, 1, 4, 20), yieldKt: 15, windDeg: 80, color: '#7fc8f8',
    description: '600 kilotons of explosives detonate across AM in the first hour, killing about 3 million soldiers in their bases.',
    flights: amBases.map((to, i) => ({ from: attackers[i % attackers.length], to, launch: D(2165, 4, 1, 4, i % 6) })),
  }));
  const capitals: Place[] = [P.washington, P.london, P.paris, P.berlin, P.rome, P.beijing, P.tokyo, P.delhi, P.moscow, P.cairo, [-3.7, 40.42], [4.9, 52.37], [4.35, 50.85], [21.0, 52.23], [16.37, 48.21], [14.42, 50.09], [19.04, 47.5], [26.1, 44.43], [23.32, 42.7], [30.52, 50.45], [27.56, 53.9], [24.1, 56.95], [25.28, 54.69], [24.75, 59.44], [24.94, 60.17], [18.07, 59.33], [10.75, 59.91], [12.57, 55.68],
    [-6.26, 53.35], [-9.14, 38.72], [7.45, 46.95], [23.73, 37.98], [20.46, 44.79], [-75.7, 45.42], [-99.13, 19.43], [-47.88, -15.79], [-58.38, -34.6], [-70.65, -33.45], [-77.04, -12.05], [-74.07, 4.71], [126.98, 37.57], [125.75, 39.03], [121.56, 25.04], [106.85, -6.21], [120.98, 14.6], [149.13, -35.28], [174.78, -41.29],
    [3.38, 6.52], [36.82, -1.29], [38.75, 9.03], [28.05, -26.2], [32.58, 0.35], [15.28, -4.32], [-0.19, 5.6], [32.53, 15.6], [105.85, 21.03], [90.41, 23.81], [85.32, 27.72], [69.18, 34.53], [71.45, 51.17]];
  b.commit(cmd.missileSalvo(world, {
    spaceId: space, name: 'AM\'s answer: every government hit in 15 minutes', launch: D(2165, 4, 1, 4, 2), arrive: D(2165, 4, 1, 4, 17), strike: 'conventional', entity: AM, color: '#ff4d4d',
    description: 'Within fifteen minutes every government building and treasury in the world is hit. 90 % of the world\'s leaders are killed.',
    flights: capitals.map((to, i) => ({ from: [P.ipam, P.isfahan, P.riyadh, P.mashhad, P.ankara][i % 5], to, launch: D(2165, 4, 1, 4, 2 + (i % 5)) })),
  }));
  event(b, 'The first week: 80 million dead', D(2165, 4, 8), null, { group: WW });
  event(b, 'The first year: 1.2 billion dead', D(2166, 4, 1), null, { group: WW });
  const conquer = (name: string, start: Instant, end: Instant, countries: string[], polys: cmd.CountryToAdd[] = [], about = '') => {
    const id = event(b, name, start, end, { type: 'conquest', group: WW, about, look: 'clean' });
    if (countries.length) annex(b, id, AM, countries);
    if (polys.length) take(b, id, AM, [T('Russia')], polys);
    return id;
  };
  const arabia = conquer('Arabia and Yemen', D(2165, 5, 1), D(2165, 12, 1), ['Saudi Arabia', 'Oman', 'Yemen']);
  const egypt = conquer('Egypt, Libya and Sudan', D(2165, 6, 1), D(2166, 6, 1), ['Egypt', 'Libya', 'Sudan']);
  const asia = conquer('Central Asia, to the Chinese border', D(2165, 9, 1), D(2167, 12, 1), ['Afghanistan', 'Turkmenistan', 'Uzbekistan', 'Tajikistan', 'Kyrgyzstan', 'Kazakhstan']);
  const maghreb = conquer('The Maghreb', D(2166, 6, 1), D(2167, 6, 1), ['Tunisia', 'Algeria', 'Morocco', 'Western Sahara', 'Mauritania']);
  const russia1 = conquer('Southern Russia', D(2167, 3, 1), D(2168, 3, 1), [], [{ name: 'Southern Russia', polygons: [[[[36, 41], [50, 41], [50.5, 46.5], [47.5, 50], [39, 50], [36, 47.5]]]] }]);
  const india = conquer('South Asia', D(2168, 6, 1), D(2170, 6, 1), ['India', 'Nepal', 'Bhutan', 'Bangladesh', 'Sri Lanka', 'Siachen Glacier']);
  const russia2 = conquer('The Volga and Moscow', D(2169, 1, 1), D(2169, 12, 1), [], [{ name: 'The Volga and Moscow', polygons: [[[[27, 49], [61, 49], [61, 58.5], [27, 58.5]]]] }]);
  const russia3 = conquer('North to the Arctic coast', D(2170, 1, 1), D(2170, 10, 1), [], [{ name: 'The north', polygons: [[[[27, 58], [61, 58], [66, 66], [70, 72], [70, 82], [27, 82]]]] }]);
  const sea = conquer('South-East Asia', D(2171, 10, 1), D(2173, 3, 1), ['Myanmar', 'Thailand', 'Laos', 'Cambodia', 'Vietnam', 'Malaysia']);
  const sahel = conquer('The war spikes again: to the Atlantic', D(2174, 3, 1), D(2174, 12, 1), ['Mali', 'Niger', 'Chad', 'Senegal', 'The Gambia'], [], 'AM now holds everything from the west coast of Africa to the north coast of Russia, the Chinese border and South-East Asia.');
  feature(b, arrows, 'Into Africa', [[P.jerusalem, P.cairo, P.tripoli, P.algiers, P.casablanca]], egypt, { until: D(2167, 7, 1) });
  void arabia; void maghreb;
  feature(b, arrows, 'To the Chinese border', [[P.tehran, P.ashgabat, P.tashkent, P.almaty]], asia, { until: D(2168, 1, 1) });
  feature(b, arrows, 'North to Moscow', [[P.tbilisi, P.rostov, P.moscow]], russia1, { until: D(2170, 1, 1) });
  void russia2;
  feature(b, arrows, 'To the Arctic', [[P.moscow, P.arkhangelsk]], russia3, { until: D(2170, 11, 1) });
  feature(b, arrows, 'Into India', [[P.islamabad, P.delhi, P.kolkata]], india, { until: D(2170, 7, 1) });
  feature(b, arrows, 'Into South-East Asia', [[P.kolkata, P.yangon, P.bangkok, P.kualalumpur]], sea, { until: D(2173, 4, 1) });
  feature(b, arrows, 'To the Atlantic', [[P.tripoli, P.ndjamena, P.niamey, P.bamako, P.dakar]], sahel, { until: D(2175, 1, 1) });
  const hyper1 = event(b, 'The first hyperwar', D(2171, 3, 1), D(2171, 9, 1), { type: 'war', group: WW, about: 'About 3 billion die in six months without a single nuclear weapon. In brief pauses for grief and aid, vicious special operations are planned: Cain and Carmen are sent to infiltrate IPAM.' });
  for (const [name, off] of [['Cain', 0], ['Carmen', 0.15]] as Array<[string, number]>) {
    const id = b.commit(cmd.createEntity(world, { type_id: 'character', name, notes: 'Sent to infiltrate IPAM during the first hyperwar.' }));
    b.commit(cmd.placeCharacter(world, { spaceId: space, entity: id, lon: P.odesa[0] + off, lat: P.odesa[1], mode: { kind: 'new', eventId: hyper1, at: D(2171, 5, 1) } }));
    b.commit(cmd.placeCharacter(world, { spaceId: space, entity: id, lon: P.batumi[0] + off, lat: P.batumi[1], mode: { kind: 'new', eventId: hyper1, at: D(2171, 5, 25) }, arrive: 'travel' }));
    b.commit(cmd.placeCharacter(world, { spaceId: space, entity: id, lon: P.ipam[0] + off, lat: P.ipam[1], mode: { kind: 'new', eventId: hyper1, at: D(2171, 6, 20) }, arrive: 'travel' }));
  }
  event(b, 'Peace talks fail', D(2173, 5, 1), null, { group: WW, about: 'Peace negotiations are met with horrific conditions and answers.' });
  event(b, 'The second hyperwar', D(2173, 6, 1), D(2173, 7, 1), { type: 'war', group: WW, about: '1.5 billion die in a month. Of 17 billion people, 6 billion are left.' });
  event(b, 'America, China, Russia and Western Europe on the brink', D(2175, 6, 1), null, { group: WW, about: 'They will fall, or come under AM\'s rule.' });

  // ============================================================ 8. The final exchange, 14 September 2175
  const END = 'The exchange';
  const r75 = rng(2175);
  const amCities: Place[] = [P.yerevan, P.ankara, P.istanbul, P.izmir, P.baku, P.tbilisi, P.damascus, P.baghdad, P.basra, P.mosul, P.tehran, P.isfahan, P.shiraz, P.mashhad, P.tabriz, P.amman, P.jerusalem, P.kuwait, P.riyadh, P.dammam, P.doha, P.abudhabi, P.muscat,
    P.cairo, P.tripoli, P.algiers, P.casablanca, P.tashkent, P.almaty, P.ashgabat, P.moscow, P.rostov, [44.5, 48.7], [49.1, 55.8], [50.1, 53.2], P.arkhangelsk, P.delhi, P.mumbai, P.kolkata, [80.27, 13.08], [77.59, 12.97], P.lahore, P.karachi, P.islamabad, P.yangon, P.bangkok, P.kualalumpur, [106.7, 10.8], P.bamako, P.dakar];
  const alliedSilos: Place[] = [[-111.3, 47.5], [-104.8, 41.2], [-101.3, 48.4], [-30, 40], [-20, 25], [5, 36.5], [18, 34], [65, 10], [88, 5], [83, 55], [92.9, 56], [104.3, 52.3], [86.1, 41.7], [98.5, 39.7], [109.8, 40.6], [-4.5, 48.4], [-5.5, 56.5]];
  const allies = b.commit(cmd.missileSalvo(world, {
    spaceId: space, name: 'The final option: 14,000 warheads at AM', launch: D(2175, 9, 14, 3, 0), arrive: D(2175, 9, 14, 3, 25), yieldKt: 300, windDeg: 90, color: '#7fc8f8',
    description: 'America, China, Russia and Western Europe launch about 14,000 nuclear warheads at AM\'s lands.',
    flights: amCities.flatMap((to, i) => [0, 1, 2].map((k) => ({ from: alliedSilos[(i * 3 + k) % alliedSilos.length], to: [to[0] + (k ? (r75() - 0.5) * 2 : 0), to[1] + (k ? (r75() - 0.5) * 1.5 : 0)] as Place, shotDown: k === 2 ? 0.7 + 0.25 * r75() : 1 }))),
  }));
  const worldCities: Place[] = [P.washington, P.newyork, [-87.63, 41.88], [-118.24, 34.05], [-122.42, 37.77], [-95.37, 29.76], [-84.39, 33.75], [-80.19, 25.76], [-122.33, 47.61], [-104.99, 39.74], [-112.07, 33.45], [-71.06, 42.36], [-75.16, 39.95], [-90.07, 29.95], [-111.3, 47.5], [-104.8, 41.2], [-101.3, 48.4], [-97.5, 35.5], [-93.27, 44.98], [-83.05, 42.33],
    [-79.38, 43.65], [-73.57, 45.5], [-123.12, 49.28], [-114.07, 51.05], [-99.13, 19.43], [-103.35, 20.66], [-46.63, -23.55], [-43.17, -22.91], [-58.38, -34.6], [-70.65, -33.45], [-77.04, -12.05], [-74.07, 4.71], [-66.9, 10.48],
    P.london, P.paris, P.berlin, P.rome, [-3.7, 40.42], [2.17, 41.39], [4.9, 52.37], [4.35, 50.85], [11.58, 48.14], [9.19, 45.46], [21.0, 52.23], [16.37, 48.21], [14.42, 50.09], [19.04, 47.5], [26.1, 44.43], [30.52, 50.45], [27.56, 53.9], [18.07, 59.33], [10.75, 59.91], [12.57, 55.68], [-2.24, 53.48], [-4.25, 55.86], [-6.26, 53.35], [-9.14, 38.72], [8.68, 50.11], [-1.55, 47.22], [5.37, 43.3],
    [83, 55], [92.9, 56], [104.3, 52.3], [73.37, 54.98], [61.4, 55.16], [60.6, 56.84], [131.9, 43.12], [135.07, 48.48], [86.1, 41.7], [98.5, 39.7], [109.8, 40.6],
    P.beijing, [121.47, 31.23], [113.26, 23.13], [114.06, 22.54], [104.07, 30.67], [108.94, 34.34], [114.31, 30.59], [117.2, 39.13], [123.43, 41.8], [126.53, 45.8], [118.8, 32.06], [120.15, 30.27], [106.55, 29.56], [112.94, 28.23], [87.62, 43.83], [91.11, 29.65],
    P.tokyo, [135.5, 34.69], [130.4, 33.59], [141.35, 43.06], [126.98, 37.57], [129.08, 35.18], [125.75, 39.03], [121.56, 25.04], [120.98, 14.6], [106.85, -6.21], [112.75, -7.25], [151.21, -33.87], [144.96, -37.81], [115.86, -31.95], [153.03, -27.47], [174.76, -36.85],
    [3.38, 6.52], [36.82, -1.29], [38.75, 9.03], [28.05, -26.2], [18.42, -33.92], [32.58, 0.35], [15.28, -4.32], [-0.19, 5.6], [13.23, -8.84], [39.27, -6.79], [31.05, -17.83], [47.52, -18.91]];
  const amSilos: Place[] = [P.ipam, P.isfahan, P.mashhad, P.riyadh, P.ankara, [47, 52], [55, 60], [68, 45], [62, 40], P.delhi, [10, 30], [0, 28], [35, 25], [100, 18]];
  const am = b.commit(cmd.missileSalvo(world, {
    spaceId: space, name: 'AM answers: 70,000 warheads', launch: D(2175, 9, 14, 3, 2), arrive: D(2175, 9, 14, 3, 20), yieldKt: 800, windDeg: 90, entity: AM, color: '#ff4d4d',
    description: '70,000 nuclear warheads, 1,500 of them on second-generation ICBMs. AM\'s missiles hit every major target five minutes before the allies\' arrive. About one warhead lands for every 2,000 square kilometres.',
    flights: worldCities.flatMap((to, i) => [0, 1, 2].map((k) => ({ from: amSilos[(i + k * 5) % amSilos.length], to: [to[0] + (k ? (r75() - 0.5) * 2.5 : 0), to[1] + (k ? (r75() - 0.5) * 1.8 : 0)] as Place }))),
  }));
  // The density of the hits: a heatmap of detonations around every target, on land.
  const land = landTest(b);
  const blasts = featureLayer(b, 'Detonations', 'point', { symbol: 'circle', size: 3, color: '#ffffff', showName: false });
  b.commit(cmd.updateLayer(world, blasts, { visible: 0 }));
  const heat = b.commit(cmd.createFieldLayer(world, space, 'Nuclear devastation', 'heat'));
  b.commit(cmd.setFieldLayerStyle(world, heat, { from: blasts, kernelKm: 160, full: 6, opacity: 0.7 }));
  const scatter = (eventId: string, targets: Place[], per: number, when: Instant) => {
    const pts: Place[] = [];
    for (const t of targets) for (let k = 0; k < per; k++) {
      for (let tries = 0; tries < 8; tries++) {
        const p: Place = [t[0] + (r75() - 0.5) * 9, t[1] + (r75() - 0.5) * 6];
        if (land(p)) { pts.push(p); break; }
      }
    }
    for (let i = 0; i < pts.length; i += 400) {
      b.commitAll('Detonations', pts.slice(i, i + 400).map((p) => cmd.createFeature(world, { layerId: blasts, name: 'Detonation', parts: [[p]], mode: { kind: 'new', eventId, at: when } })));
    }
  };
  scatter(am, worldCities, 14, D(2175, 9, 14, 3, 20));
  scatter(allies, amCities, 14, D(2175, 9, 14, 3, 25));
  const dead = event(b, '5.996 billion die within a day', D(2175, 9, 14, 3, 30), D(2175, 9, 15, 3, 30), { type: 'disaster', group: END, about: 'About 20 million people are left on Earth. Every government but AM\'s is gone.' });
  clearAllBut(b, dead, [AM], D(2175, 9, 14, 3, 30), { style: 'dissolve' });

  // ============================================================ 9. The aftermath, 2175 to 2178
  const AFTER = 'The aftermath';
  const ne = b.commit(cmd.createEntity(world, { type_id: 'faction', name: 'Northeastern Faction', color: '#d98c3a', notes: 'A faction of AM in the northeast.' }));
  const sr = b.commit(cmd.createEntity(world, { type_id: 'faction', name: 'Southern Russia', color: '#6c8ebf', notes: 'What is left of southern Russia (not Siberia).' }));
  const gang = b.commit(cmd.createEntity(world, { type_id: 'faction', name: 'Islamabad gang', color: '#8d8d8d', notes: 'Born of the corrupt government and the terrorist group that sent the bombs. Islamabad survived because nobody targeted Pakistan: they were nearly all dead already, and the decisions were made too quickly to see that Islamabad still stood. Pakistan never could sustain itself; within a year most of the gang starve.' }));
  const breakup = event(b, 'Greater Armenia on Earth breaks apart', D(2175, 9, 16), D(2176, 9, 14), { type: 'collapse', group: AFTER, about: 'After a year: fragments of AM, a faction in the northeast (also AM) and what is left of southern Russia. Millions of AM citizens live on in space.' });
  const year = { style: 'dissolve' as const, until: at(D(2176, 9, 14)) };
  take(b, breakup, ne, [AM], b.regionsOf('Uzbekistan', (r) => !['Karakalpakstan', 'Khorezm'].includes(r.name)), null, { style: 'fade', until: at(D(2176, 9, 14)) });
  take(b, breakup, sr, [AM, ''], b.regionsOf('Russia', ['Rostov', 'Volgograd', 'Saratov', 'Samara', 'Orenburg', 'Voronezh', 'Penza', "Ul'yanovsk", 'Tambov', 'Lipetsk', 'Belgorod', 'Kursk']), null, { style: 'fade', until: at(D(2176, 9, 14)) });
  const fragments: cmd.CountryToAdd[] = [
    b.shape('Armenia'), ...tk(['Kars', 'Ardahan', 'Iğdir', 'Agri', 'Erzurum', 'Artvin', 'Van']),
    ...b.regionsOf('Azerbaijan', ['Babək', 'Culfa', 'Kangarli', 'Naxçıvan', 'Ordubad', 'Şahbuz', 'Sədərək', 'Şərur', 'Qazax', 'Ağstafa', 'Tovuz', 'Şəmkir', 'Gədəbəy', 'Daşkəsən', 'Gəncə', 'Xanlar', 'Kəlbəcər']),
    ...b.regionsOf('Georgia', ['Kvemo Kartli', 'Samtskhe-Javakheti']),
    ...b.regionsOf('Iraq', ['Ninawa', 'Dihok', 'Arbil', "At-Ta'mim", 'As-Sulaymaniyah']),
    ...b.regionsOf('Iraq', ['Al-Basrah', 'Maysan', 'Dhi-Qar']), b.shape('Kuwait'), ...b.regionsOf('Iran', ['Khuzestan']),
    ...b.regionsOf('Saudi Arabia', ['Ash Sharqiyah']), b.shape('Qatar'), b.shape('Bahrain'),
  ];
  clear(b, breakup, [AM], fragments, { outside: true, transition: year, at: D(2175, 9, 16, 0, 1) });
  const islamabad = event(b, 'A gang rises in Islamabad', D(2176, 3, 1), D(2176, 6, 1), { type: 'founding', group: AFTER, about: 'Islamabad still stands.' });
  take(b, islamabad, gang, [''], [{ name: 'Islamabad', polygons: [[circle(P.islamabad, 70)]] }], null, { style: 'fade' });
  const north = event(b, 'Radiation leaks: the Northeastern Faction moves north', D(2176, 9, 14), D(2177, 4, 1), { group: AFTER, about: 'Leaks from destroyed nuclear reactors drive the faction north.' });
  clear(b, north, [ne], b.regionsOf('Uzbekistan', ['Surkhandarya', 'Kashkadarya', 'Bukhoro', 'Samarkand', 'Navoi', 'Jizzakh']));
  take(b, north, ne, [''], b.regionsOf('Kazakhstan', ['Qyzylorda', 'South Kazakhstan', 'Zhambyl']));
  const join = event(b, 'The separated AM fragments join together', D(2176, 9, 14), D(2177, 6, 1), { group: AFTER });
  take(b, join, AM, [''], [...tk(['Hakkari', 'Sirnak', 'Siirt', 'Batman', 'Mardin', 'Bitlis', 'Mus', 'Diyarbakir']), ...b.regionsOf('Iraq', ['Sala ad-Din', 'Baghdad', 'Diyala', 'Wasit', 'Babil', "Karbala'", 'An-Najaf', 'Al-Qādisiyyah', 'Al-Muthannia'])]);
  const starve = event(b, 'Starvation: the Islamabad gang dies out', D(2177, 3, 1), D(2177, 9, 1), { type: 'collapse', group: AFTER });
  clear(b, starve, [gang], [{ name: 'Islamabad', polygons: [[circle(P.islamabad, 75)]] }]);
  const desert = event(b, 'The desert towns are abandoned', D(2177, 9, 1), D(2178, 3, 1), { group: AFTER, about: 'AM\'s land shrinks as the smaller towns in the desert become useless and uninhabitable. It still has a great deal of oil and energy.' });
  clear(b, desert, [AM], [{ name: 'Arabian desert', polygons: [[[[44, 17], [49.4, 17], [49.4, 25.2], [48.4, 27.4], [44, 29.5]]]] }, ...b.regionsOf('Iraq', ['Al-Muthannia', 'An-Najaf'])]);
  const turkmen = event(b, 'The Northeastern Faction takes Turkmenistan', D(2178, 6, 1), D(2178, 9, 14), { type: 'conquest', group: AFTER, about: 'Three years after the exchange; its government died in the strikes.' });
  take(b, turkmen, ne, [''], [b.shape('Turkmenistan')]);
  event(b, 'Among the stars', D(2178, 10, 1), null, { group: AFTER, about: 'Millions of AM citizens live in space. They survive and thrive, hundreds of years ahead of Earth, and in tens of thousands of years become the dominant force in the galaxy. Those who stayed on Earth will one day go out among the stars too, new and small beside the aliens; and when it matters, AM still acts as Earth\'s big brother.' });

  // ============================================================ statistics
  b.commit(cmd.setMapStatistics(world, space, [
    stat('GDP', 'money', 'growth', [[D(2039), 22e9], [D(2043), 20e9], [D(2046), 72e9], [D(2048), 120e9], [D(2053), 1.0e12], [D(2060), 1.2e12], [D(2066), 1.6e12], [D(2072), 3e12], [D(2105), 50e12], [D(2142, 11), 150e12], [D(2156), 1.2e15]]),
    stat('Military budget', 'money', 'step', [[D(2039), 0.6e9], [D(2048), 5e9], [D(2055), 60e9], [D(2060), 150e9], [D(2072), 400e9], [D(2100), 1e12], [D(2140), 5e12], [D(2156, 2, 20), 500e12], [D(2159, 8, 12), 1.1e15]]),
    stat('Week War spending', 'money', 'linear', [[D(2066, 4, 24), 0], [D(2066, 5, 1), 1.8e12]]),
    stat('Enemy dead on day one', 'count', 'linear', [[D(2066, 4, 24), 0], [D(2066, 4, 25), 300000]]),
    stat('AM population', 'count', 'growth', [[D(2039), 2.8e6], [D(2066, 4, 24), 3.6e6], [D(2066, 5, 6), 190e6], [D(2072, 3, 10), 205e6], [D(2072, 8, 20), 345e6], [D(2156), 1.5e9]]),
    stat('World population', 'count', 'linear', [[D(2039), 9.1e9], [D(2100), 12e9], [D(2165, 4, 1, 4), 17e9], [D(2165, 4, 8), 16.92e9], [D(2166, 4, 1), 15.8e9], [D(2171, 3, 1), 14e9], [D(2171, 9, 1), 11e9], [D(2173, 6, 1), 7.5e9], [D(2173, 7, 1), 6e9], [D(2175, 9, 14, 3, 20), 6e9], [D(2175, 9, 15, 3, 30), 20e6]]),
    stat('War dead', 'count', 'linear', [[D(2165, 4, 1, 4), 0], [D(2165, 4, 1, 5), 3e6], [D(2165, 4, 8), 80e6], [D(2166, 4, 1), 1.2e9], [D(2171, 3, 1), 3e9], [D(2171, 9, 1), 6e9], [D(2173, 6, 1), 9.5e9], [D(2173, 7, 1), 11e9], [D(2175, 9, 14, 3, 20), 11e9], [D(2175, 9, 15, 3, 30), 16.98e9]]),
    stat('World military budget', 'money', 'step', [[D(2150), 40e12], [D(2160, 3, 1), 300e12]]),
    stat('Pakistani soldiers killed', 'count', 'linear', [[D(2156, 4, 2, 14, 2), 0], [D(2156, 4, 2, 18, 5), 90000]]),
    stat('Bases hit', 'number', 'linear', [[D(2156, 4, 2, 18, 5), 0], [D(2156, 4, 2, 18, 40), 40]]),
  ]));

  // ============================================================ shots
  const caucasus = { lon: 44.5, lat: 40.2, zoom: 3.6 }, anatolia = { lon: 38.5, lat: 38.6, zoom: 3.0 }, mideast = { lon: 47, lat: 31, zoom: 2.6 }, globe = { lon: 40, lat: 24, zoom: 0.5 };
  shot(b, {
    name: '1. The rise, 2039 to 2066', title: 'Greater Armenia', subtitle: 'I. The rise, 2039 to 2066', precision: 'month',
    time: [[0, D(2039, 1, 1)], [12, D(2043, 3, 1), 'smooth'], [22, D(2048, 2, 1)], [30, D(2049, 1, 1)], [44, D(2066, 4, 1)]],
    camera: [[0, caucasus], [20, caucasus], [24, { lon: 5, lat: 30, zoom: 0.85 }], [32, { lon: 5, lat: 30, zoom: 0.85 }], [37, anatolia], [44, anatolia]],
    stats: 'GDP {GDP}\nMilitary {Military budget}',
    captions: [
      { text: 'An unknown figure starts a nationwide movement', from: D(2039, 3, 14), to: D(2041, 6, 1) },
      { text: 'The movement becomes a revolution', from: D(2042, 9, 21), to: D(2042, 12, 20) },
      { text: 'He announces his name: Arman Manookian', from: D(2042, 12, 21), to: D(2043, 9, 1), anchor: P.yerevan },
      { text: 'Teachers paid $350,000 to $1 million. Teaching becomes harder than medicine.', from: D(2046, 2, 1), to: D(2047, 1, 1) },
      { text: 'In secret, the invasion plan begins', from: D(2046, 9, 1), to: D(2047, 9, 1), y: 0.33 },
      { text: 'Spies are sent into Turkey, Azerbaijan, America, Israel, Iran and Greece', from: D(2048, 4, 1), to: D(2049, 3, 1) },
      { text: 'The economy grows 5,000 % in ten years', from: D(2050, 1, 1), to: D(2058, 1, 1) },
    ],
    eventsBox: { groups: ['The rise'] }, characters: true,
  });
  shot(b, {
    name: '2. The Week War, April and May 2066', title: 'The Week War', subtitle: 'II. 20 April to 6 May 2066', look: 'wartime', transitions: 'blitz', precision: 'minute',
    time: [[0, D(2066, 4, 19)], [6, D(2066, 4, 23, 23, 50)], [9, D(2066, 4, 24, 0, 0)], [21, D(2066, 4, 24, 0, 35)], [27, D(2066, 4, 25)], [52, D(2066, 5, 1, 18)], [64, D(2066, 5, 6, 12)], [68, D(2066, 5, 7)]],
    camera: [[0, { lon: 41, lat: 39.5, zoom: 3.4 }], [27, { lon: 41, lat: 39.5, zoom: 3.4 }], [40, anatolia], [52, anatolia], [58, { lon: 39, lat: 36.5, zoom: 2.9 }], [68, { lon: 39, lat: 36.5, zoom: 2.9 }]],
    stats: 'Spent {Week War spending}\nEnemy dead on day one {Enemy dead on day one}',
    captions: [
      { text: 'The spies pull out of Turkey\'s and Azerbaijan\'s largest corporations. Both governments collapse.', from: D(2066, 4, 20), to: D(2066, 4, 23, 12) },
      { text: '12 am: the invasion begins. 40,000 tons of explosives in 30 minutes.', from: D(2066, 4, 24, 0, 0), to: D(2066, 4, 24, 0, 40) },
      { text: 'Spies in the highest military ranks sabotage everything', from: D(2066, 4, 24, 0, 31), to: D(2066, 4, 24, 20), y: 0.33 },
      { text: 'Baku taken', from: D(2066, 4, 28, 12), to: D(2066, 4, 29, 18), anchor: P.baku, x: 0.82, y: 0.45 },
      { text: 'Ankara taken', from: D(2066, 4, 30, 12), to: D(2066, 5, 1, 12), anchor: P.ankara, x: 0.18, y: 0.36 },
      { text: 'Istanbul taken', from: D(2066, 5, 1, 12), to: D(2066, 5, 2, 18), anchor: P.istanbul, x: 0.12, y: 0.2 },
      { text: 'Allied forces attack towards Yerevan from Syria, Georgia and south-west Turkey', from: D(2066, 5, 1, 18), to: D(2066, 5, 4) },
      { text: 'By 6 May: Georgia, Syria, Lebanon, Iraq and Cyprus', from: D(2066, 5, 5), to: null },
    ],
    eventsBox: { groups: ['The Week War'] },
  });
  shot(b, {
    name: '3. South to the Gulf, 2072', title: 'South to the Gulf', subtitle: 'III. 2072', look: 'wartime', transitions: 'blitz',
    time: [[0, D(2072, 3, 1)], [16, D(2072, 5, 25)], [34, D(2072, 9, 1)]],
    camera: [[0, { lon: 46, lat: 34, zoom: 2.8 }], [14, { lon: 46, lat: 34, zoom: 2.8 }], [20, mideast], [34, mideast]],
    stats: 'AM population {AM population}',
    captions: [
      { text: 'If America intervenes, AM\'s spies will strike at its government: they have prepared for 25 years', from: D(2072, 3, 12), to: D(2072, 4, 5) },
      { text: 'Saudi Arabia intervenes as Kuwait is invaded', from: D(2072, 6, 2), to: D(2072, 6, 25) },
    ],
    eventsBox: { groups: ['The Gulf'] },
  });
  shot(b, {
    name: '4. The golden age, 2072 to 2156', title: 'The golden age', subtitle: 'IV. 2072 to 2156', precision: 'year',
    time: [[0, D(2072, 9, 1)], [10, D(2105, 1, 1)], [20, D(2143, 1, 1)], [26, D(2156, 1, 1)]],
    camera: [[0, { lon: 40, lat: 33, zoom: 1.6 }], [26, { lon: 40, lat: 33, zoom: 1.6 }]],
    stats: 'GDP {GDP}\nAM population {AM population}',
    captions: [
      { text: 'AM\'s companies dominate AI and technology', from: D(2076, 1, 1), to: D(2088, 1, 1) },
      { text: 'Manookian "dies". His son, who looks just like him, takes power. It is still him.', from: D(2090, 6, 1), to: D(2100, 1, 1), anchor: P.yerevan },
      { text: 'IPAM: a $140 trillion gamble on mining the asteroids', from: D(2105, 3, 1), to: D(2125, 1, 1), anchor: P.ipam, x: 0.3, y: 0.25 },
      { text: 'The risk pays off: ASA I-PAM automated', from: D(2142, 11, 1), to: null },
    ],
    eventsBox: { groups: ['The golden age'] }, characters: true,
  });
  shot(b, {
    name: '5. Pakistan, April 2156', title: 'Thirteen hours', subtitle: 'V. Pakistan, April 2156', look: 'night', precision: 'minute',
    time: [[0, D(2156, 2, 15)], [8, D(2156, 4, 2, 13, 55)], [24, D(2156, 4, 2, 14, 13)], [36, D(2156, 4, 2, 18, 45)], [44, D(2156, 4, 3, 4)], [48, D(2156, 4, 4)]],
    camera: [[0, { lon: 59, lat: 33.5, zoom: 2.9 }], [48, { lon: 59, lat: 33.5, zoom: 2.9 }]],
    stats: 'Military {Military budget}\nPakistani soldiers killed {Pakistani soldiers killed}\nBases hit {Bases hit}',
    captions: [
      { text: 'On rumours alone the military budget rises from $5 trillion to $500 trillion', from: D(2156, 2, 20), to: D(2156, 3, 10) },
      { text: '100 million conscripted. Tens of thousands of Mach 100 ICBMs, $20 billion each.', from: D(2156, 3, 1), to: D(2156, 4, 1) },
      { text: 'Pakistan fires 62 nuclear warheads at IPAM. All are deflected.', from: D(2156, 4, 2, 14, 0), to: D(2156, 4, 2, 14, 13) },
      { text: 'Two minutes later the government of Pakistan is gone', from: D(2156, 4, 2, 14, 3), to: D(2156, 4, 2, 14, 30), y: 0.33 },
      { text: '1.5 million drones arrive within four hours', from: D(2156, 4, 2, 14, 30), to: D(2156, 4, 2, 18, 45) },
      { text: 'Thirteen hours after its attack, Pakistan surrenders unconditionally', from: D(2156, 4, 3, 3), to: null },
    ],
    eventsBox: { groups: ['Pakistan'] },
  });
  shot(b, {
    name: '6. The embargo, 2159 to 2165', title: 'The embargo', subtitle: 'VI. 2159 to 2165', look: 'night',
    time: [[0, D(2159, 8, 1)], [4, D(2159, 8, 11, 8)], [12, D(2159, 8, 12)], [24, D(2164, 5, 1)], [30, D(2165, 3, 20)]],
    camera: [[0, { lon: 39.5, lat: 38.4, zoom: 4.2 }], [12, { lon: 39.5, lat: 38.4, zoom: 4.2 }], [18, { lon: 45, lat: 30, zoom: 1.2 }], [30, { lon: 60, lat: 28, zoom: 1.8 }]],
    stats: 'AM military {Military budget}\nThe world\'s {World military budget}',
    captions: [
      { text: 'Portable nuclear bombs at IPAM\'s launch zone and the nuclear power plant', from: D(2159, 8, 11, 9), to: D(2159, 8, 11, 22), anchor: P.ipam, x: 0.7, y: 0.2 },
      { text: 'DMRK, the main port: 14 million killed', from: D(2159, 8, 11, 9, 7), to: D(2159, 8, 12), anchor: P.dmrk, x: 0.2, y: 0.55 },
      { text: 'AM does not retaliate. It stops all exports.', from: D(2159, 8, 12), to: D(2160, 12, 1) },
      { text: 'AM opens its ports again', from: D(2164, 5, 1), to: D(2164, 12, 1) },
      { text: 'India strikes a village in Pakistan: 900 dead, three of them AM citizens', from: D(2165, 3, 2), to: D(2165, 3, 10) },
      { text: 'India sinks five AM freight ships. AM blocks all exports to the world.', from: D(2165, 3, 10), to: null },
    ],
    eventsBox: { groups: ['The embargo', 'The world war'] },
  });
  shot(b, {
    name: '7. The world war, 2165 to 2175', title: 'The world war', subtitle: 'VII. 2165 to 2175', look: 'night', precision: 'month',
    time: [[0, D(2165, 3, 30)], [4, D(2165, 4, 1, 3, 55)], [16, D(2165, 4, 1, 4, 25)], [22, D(2165, 5, 1)], [56, D(2175, 9, 1)]],
    camera: [[0, { lon: 40, lat: 33, zoom: 1.7 }], [16, { lon: 40, lat: 33, zoom: 1.7 }], [24, globe], [56, globe]],
    stats: 'World population {World population}\nWar dead {War dead}',
    captions: [
      { text: 'Europe, the Mediterranean, Africa, Russia and China attack. 600 kilotons in the first hour.', from: D(2165, 4, 1, 4), to: D(2165, 4, 1, 4, 14) },
      { text: 'In 15 minutes every government in the world is hit. 90 % of its leaders die.', from: D(2165, 4, 1, 4, 14), to: D(2165, 4, 25) },
      { text: 'The first hyperwar: 3 billion die in six months, without nuclear weapons', from: D(2171, 3, 1), to: D(2171, 10, 1) },
      { text: 'Cain and Carmen are sent to infiltrate IPAM', from: D(2171, 5, 1), to: D(2171, 7, 1), anchor: P.ipam, x: 0.3, y: 0.2 },
      { text: 'The second hyperwar: 1.5 billion in a month', from: D(2173, 6, 1), to: D(2173, 8, 1) },
      { text: 'AM holds everything from Africa\'s west coast to Russia\'s north coast, the Chinese border and South-East Asia', from: D(2174, 12, 1), to: null },
    ],
    eventsBox: { groups: ['The world war'] }, characters: true,
  });
  shot(b, {
    name: '8. The exchange, 14 September 2175', title: 'The final option', subtitle: 'VIII. 14 September 2175', look: 'night', precision: 'minute',
    time: [[0, D(2175, 9, 14, 2, 50)], [4, D(2175, 9, 14, 3, 0)], [34, D(2175, 9, 14, 3, 30)], [46, D(2175, 9, 15, 6)]],
    camera: [[0, globe], [46, globe]],
    stats: 'World population {World population}\nDead {War dead}',
    captions: [
      { text: 'About 14,000 warheads launched at AM', from: D(2175, 9, 14, 3, 0), to: D(2175, 9, 14, 3, 6) },
      { text: 'AM answers with 70,000. Its missiles hit every major target five minutes first.', from: D(2175, 9, 14, 3, 6), to: D(2175, 9, 14, 3, 26) },
      { text: 'One warhead for every 2,000 square kilometres', from: D(2175, 9, 14, 3, 26), to: D(2175, 9, 14, 5) },
      { text: '5.996 billion die within the day. About 20 million are left.', from: D(2175, 9, 14, 6), to: null },
    ],
    eventsBox: false, cities: false,
  });
  shot(b, {
    name: '9. The aftermath, 2175 to 2178', title: 'After', subtitle: 'IX. 2175 to 2178', look: 'night', precision: 'month',
    time: [[0, D(2175, 9, 16)], [36, D(2178, 9, 20)], [44, D(2178, 12, 1)]],
    camera: [[0, { lon: 52, lat: 39, zoom: 2.3 }], [44, { lon: 52, lat: 39, zoom: 2.3 }]],
    captions: [
      { text: 'After a year: the fragments of AM, the Northeastern Faction, and what is left of southern Russia', from: D(2176, 6, 1), to: D(2176, 12, 1) },
      { text: 'A gang rises in Islamabad, which nobody thought to strike', from: D(2176, 3, 1), to: D(2176, 8, 1), anchor: P.islamabad, x: 0.78, y: 0.7 },
      { text: 'Radiation leaks drive the Northeastern Faction north', from: D(2176, 12, 1), to: D(2177, 4, 1), anchor: P.kyzylorda, x: 0.75, y: 0.2 },
      { text: 'The separated fragments of AM join together', from: D(2177, 4, 1), to: D(2177, 8, 1), anchor: P.baghdad, x: 0.2, y: 0.75 },
      { text: 'The desert towns are abandoned. The oil and the energy remain.', from: D(2177, 10, 1), to: D(2178, 3, 1) },
      { text: 'The Northeastern Faction takes Turkmenistan', from: D(2178, 6, 1), to: D(2178, 9, 1), anchor: P.ashgabat, x: 0.75, y: 0.25 },
      { text: 'Millions of AMs live on in space. In tens of thousands of years they will rule the galaxy.', from: D(2178, 9, 20), to: null, size: 36, y: 0.2 },
    ],
    eventsBox: { groups: ['The aftermath'] }, hide: ['Nuclear devastation', 'Detonations'],
  });
}

/** Whether a place is on land (one of today's countries' outlines). */
function landTest(b: Builder): (p: Place) => boolean {
  const rings: Array<{ box: [number, number, number, number]; ring: Array<[number, number]> }> = [];
  for (const c of b.countries) for (const poly of c.polygons) {
    const r = poly[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    rings.push({ box: [x0, y0, x1, y1], ring: r });
  }
  return ([x, y]) => rings.some(({ box, ring }) => {
    if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
