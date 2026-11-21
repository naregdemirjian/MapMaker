// The Fall of Constantinople, 1453 (D176): an example project close in on a medieval city. One map of the Earth in
// the Julian calendar (the sources' dates), its terrain drawn from the finer heights close in (the Golden Horn, the
// Bosphorus and the city's hills as they are), the states of 1451 around the Sea of Marmara, and the city itself: the
// Theodosian walls, the sea walls, the gates, the chain across the Golden Horn, Galata, the Ottoman camps and gun
// batteries; then the siege day by day (every day's cannon fire), the ships hauled over the hill, the mines, the
// assaults, the fall hour by hour on 29 May, and what followed to 1468. Built through the same commands as the
// interface uses, so everything can be changed afterwards.
import type { ProjectRegistry } from '../server/projects.ts';
import * as cmd from '../domain/commands.ts';
import { CALENDAR_TEMPLATES, calendarOf } from '../core-time/custom-calendar.ts';
import type { Instant } from '../core-time/index.ts';
import { startProject, event, take, startWith, annex, featureLayer, feature, fixture, city, journey, stat, shot, circle, outline, later, seeded, type Builder, type Place } from './kit.ts';

const JULIAN = CALENDAR_TEMPLATES.find((t) => t.id === 'julian')!.def;
const JC = calendarOf(JULIAN);
/** A moment in the Julian calendar, as the sources date the siege. */
export const J = (year: number, month = 1, day = 1, hour = 0, minute = 0): Instant => JC.fromCivil({ year, month, day, hour, minute });

// ---------------------------------------------------------------- the city

/** Places (longitude, latitude). */
const P = {
  hagiaSophia: [28.9802, 41.0086], blachernae: [28.9428, 41.0360], holyApostles: [28.9495, 41.0195], hippodrome: [28.9753, 41.0057],
  greatPalace: [28.9772, 41.0045], studios: [28.9283, 40.9963], acropolis: [28.9860, 41.0135], galataTower: [28.9741, 41.0256],
  goldenGate: [28.9226, 40.9940], pege: [28.9177, 41.0040], rhegium: [28.9200, 41.0097], romanus: [28.9232, 41.0157], pempton: [28.9290, 41.0235],
  charisius: [28.9358, 41.0293], kerkoporta: [28.9398, 41.0322], kaligaria: [28.9408, 41.0350], petrion: [28.9535, 41.0300],
  camp: [28.9160, 41.0172], doubleColumns: [29.0035, 41.0385], springs: [28.9605, 41.0305], cretans: [28.9590, 41.0262],
  chainCity: [28.9765, 41.0168], chainGalata: [28.9765, 41.0222], christianShips: [28.9685, 41.0212],
  rumeli: [29.0565, 41.0846], anadolu: [29.0670, 41.0826], therapia: [29.0560, 41.1395], prinkipo: [29.1220, 40.8580],
  edirne: [26.5557, 41.6771], gallipoli: [26.6708, 40.4112], selymbria: [28.2464, 41.0739], epibatos: [28.3700, 41.0550],
  mesembria: [27.7352, 42.6593], anchialos: [27.6425, 42.5630], chios: [26.1360, 38.3710], mistra: [22.3670, 37.0730],
  trebizond: [39.7178, 41.0027], sinop: [35.1530, 42.0260], konya: [32.4846, 37.8746], athens: [23.7257, 37.9715],
  bursa: [29.0610, 40.1885], nicaea: [29.7190, 40.4290], nicomedia: [29.9190, 40.7650], thessalonica: [22.9444, 40.6401],
  belgrade: [20.4573, 44.8176], rome: [12.4964, 41.9028], brasov: [25.6012, 45.6427], venice: [12.3155, 45.4408], genoa: [8.9463, 44.4056],
} satisfies Record<string, Place>;

/** The Theodosian land walls, from the Golden Horn (Blachernae) to the Sea of Marmara. */
const LAND_WALLS: Place[] = [[28.9420, 41.0420], [28.9408, 41.0385], [28.9404, 41.0336], [28.9398, 41.0322], [28.9358, 41.0293], [28.9290, 41.0235], [28.9232, 41.0157], [28.9200, 41.0097], [28.9177, 41.0040], [28.9190, 40.9985], [28.9226, 40.9940], [28.9245, 40.9922]];
/** The sea walls along the Marmara and the Golden Horn (just inside today's shore: the shore of 1453 was further in). */
const MARMARA_WALLS: Place[] = [[28.9245, 40.9922], [28.9300, 40.9945], [28.9345, 40.9990], [28.9372, 41.0024], [28.9420, 41.0018], [28.9520, 41.0024], [28.9620, 41.0028], [28.9720, 41.0019], [28.9790, 41.0026], [28.9832, 41.0042], [28.9855, 41.0065], [28.9865, 41.0090], [28.9872, 41.0120], [28.9870, 41.0140]];
const HORN_WALLS: Place[] = [[28.9870, 41.0140], [28.9850, 41.0158], [28.9790, 41.0166], [28.9745, 41.0171], [28.9690, 41.0186], [28.9645, 41.0203], [28.9625, 41.0220], [28.9600, 41.0237], [28.9590, 41.0254], [28.9576, 41.0269], [28.9538, 41.0284], [28.9518, 41.0300], [28.9498, 41.0316], [28.9492, 41.0333], [28.9468, 41.0349], [28.9455, 41.0366], [28.9453, 41.0382], [28.9427, 41.0398], [28.9420, 41.0420]];
/** Constantinople within its walls (on the water sides out to the middle of the Golden Horn and into the Marmara: the coast ends it). */
const CITY: Place[] = [...LAND_WALLS, [28.926, 40.986], [28.950, 40.993], [28.972, 40.996], [28.988, 41.001], [28.996, 41.010], [28.993, 41.017], [28.980, 41.0190], [28.970, 41.0212], [28.9655, 41.0245], [28.962, 41.0276], [28.959, 41.0306], [28.955, 41.0335], [28.9505, 41.0355], [28.9486, 41.0384], [28.9455, 41.0412]];
/** Galata (Pera), the walled Genoese town across the Golden Horn. */
const GALATA: Place[] = [[28.9655, 41.0252], [28.9700, 41.0258], [28.9741, 41.0262], [28.9790, 41.0266], [28.9840, 41.0262], [28.9860, 41.0240], [28.9795, 41.0205], [28.9710, 41.0219], [28.9668, 41.0236]];
const GALATA_WALLS: Place[] = [[28.9662, 41.0247], [28.9700, 41.0258], [28.9741, 41.0262], [28.9790, 41.0266], [28.9835, 41.0258]];

/** The Byzantine towns outside the city in 1451 (small: the city is the empire's largest part, where its name goes). */
const OUTPOSTS: Record<string, Place[]> = {
  Selymbria: circle([28.2464, 41.0739], 1.6), Epibatos: circle([28.3700, 41.0550], 1.1), Mesembria: circle([27.7352, 42.6593], 1.1), Anchialos: circle([27.6425, 42.5630], 1.1),
  Therapia: circle([29.0560, 41.1395], 0.6),
};
const ISLANDS: Array<Array<[number, number]>> = [circle([29.1220, 40.8580], 1.6), circle([29.0930, 40.8770], 1.1), circle([29.0670, 40.8800], 0.7), circle([29.0490, 40.9090], 0.6)];

/** Where the land walls are at a latitude (they run from north to south). */
function wallAt(lat: number): Place {
  for (let i = 1; i < LAND_WALLS.length; i++) {
    const [a, c] = [LAND_WALLS[i - 1], LAND_WALLS[i]];
    if (lat <= a[1] && lat >= c[1]) { const f = (a[1] - lat) / (a[1] - c[1]); return [a[0] + f * (c[0] - a[0]), lat]; }
  }
  return lat > LAND_WALLS[0][1] ? LAND_WALLS[0] : LAND_WALLS[LAND_WALLS.length - 1];
}

/** The Ottoman gun batteries before the walls (from north to south), and the one on the hill behind Galata from 3 May. */
const BATTERIES: Array<{ name: string; at: Place; sector: string }> = [
  { name: 'Battery of Blachernae', at: [28.9390, 41.0395], sector: 'the walls of Blachernae' },
  { name: 'Battery of the Kaligaria', at: [28.9380, 41.0345], sector: 'the Kaligaria gate' },
  { name: 'Battery of Charisius', at: [28.9330, 41.0300], sector: 'the Gate of Charisius' },
  { name: 'Battery of the Pempton', at: [28.9262, 41.0242], sector: 'the Pempton gate' },
  { name: 'Battery of the Lycus', at: [28.9232, 41.0205], sector: 'the Mesoteichion' },
  { name: 'Orban\'s great bombard', at: [28.9205, 41.0168], sector: 'the Gate of St Romanus' },
  { name: 'Battery of St Romanus', at: [28.9190, 41.0138], sector: 'the Gate of St Romanus' },
  { name: 'Battery of Rhegium', at: [28.9175, 41.0098], sector: 'the Gate of Rhegium' },
  { name: 'Battery of Pege', at: [28.9150, 41.0045], sector: 'the Gate of Pege' },
  { name: 'Battery of the Golden Gate', at: [28.9190, 40.9950], sector: 'the Golden Gate' },
];
const GALATA_BATTERY: Place = [28.9700, 41.0300];

// ---------------------------------------------------------------- the project

export function buildConstantinople(reg: ProjectRegistry, dataDir: string, name = 'The Fall of Constantinople, 1453 (example)') {
  const { info, b } = startProject(reg, dataDir, name);
  b.commit(cmd.setWorldBasemap(b.world, b.space, 'natural-earth'));
  b.commit(cmd.updateLayer(b.world, b.layer, { name: 'States' }));
  b.commit(cmd.setLayerClipToLand(b.world, b.layer, true));
  b.commit(cmd.setLayerLook(b.world, b.layer, { fillOpacity: 0.28, borderWidth: 2.6 }));
  b.commit(cmd.setMapCalendar(b.world, b.space, JULIAN));
  // The terrain: the finer heights close in draw the Golden Horn and the city's seven hills (D176).
  b.commit(cmd.setWorldTerrain(b.world, b.space, { palette: 'natural', colours: true, relief: true, overTerritories: false, seaFloor: true, strength: 1.35, detail: true, photo: false }));
  b.commit(cmd.setWorldShow(b.world, b.space, { minLakeKm2: 50 }));
  states(b);
  const L = city1453(b);
  story(b, L);
  shots(b);
  return info;
}

/** The states of 1451 around the Sea of Marmara. */
function states(b: Builder): void {
  const OTT = b.country('Ottoman Empire', '#b8322a'), BYZ = b.country('Byzantine Empire', '#7b3f98');
  const GEN = b.country('Galata (Genoese)', '#e6dcc2'), MOREA = b.country('Despotate of the Morea', '#a272bd');
  const TREB = b.country('Empire of Trebizond', '#c9a227'), KAR = b.country('Karaman', '#3a7d44');
  const CANDAR = b.country('Candar', '#5e8fb5'), ATHENS = b.country('Duchy of Athens', '#d98c3a');
  b.commit(cmd.updateEntity(b.world, OTT, { notes: 'The Ottoman state under Mehmed II (sultan from February 1451), from the Danube to central Anatolia.' }));
  b.commit(cmd.updateEntity(b.world, BYZ, { notes: 'What was left of the Roman Empire in the east: Constantinople, a few towns on the Marmara and the Black Sea, and the islands. Emperor Constantine XI Palaiologos, from 1449.' }));
  b.commit(cmd.updateEntity(b.world, GEN, { notes: 'Pera, the walled Genoese colony across the Golden Horn. Neutral in the siege, though many of its men fought on the walls.' }));
  startWith(b, OTT, [
    ...b.regionsOf('Turkey', ['Edirne', 'Kirklareli', 'Tekirdag', 'Istanbul', 'Çanakkale', 'Kocaeli', 'Sakarya', 'Yalova', 'Bursa', 'Bilecik', 'Balikesir', 'Izmir', 'Manisa', 'Aydin', 'Mugla', 'Denizli', 'Usak', 'Kütahya', 'Afyonkarahisar', 'Eskisehir', 'Bolu', 'Düzce', 'Zinguldak', 'Bartın', 'Karabük', 'Ankara', 'Kinkkale', 'Kirsehir', 'Yozgat', 'Çorum', 'Amasya', 'Tokat', 'Samsun', 'Isparta', 'Burdur', 'Antalya']),
    ...b.regionsOf('Bulgaria'),
    ...b.regionsOf('Greece', ['Anatoliki Makedonia kai Thraki', 'Kentriki Makedonia', 'Dytiki Makedonia', 'Thessalia', 'Ipeiros', 'Stereá Elláda']),
  ]);
  startWith(b, TREB, b.regionsOf('Turkey', ['Trabzon', 'Rize', 'Giresun', 'Gümüshane']));
  startWith(b, KAR, b.regionsOf('Turkey', ['Konya', 'Karaman', 'Aksaray', 'Nigde', 'Nevsehir', 'Mersin']));
  startWith(b, CANDAR, b.regionsOf('Turkey', ['Kastamonu', 'Sinop', 'Çankiri']));
  startWith(b, MOREA, b.regionsOf('Greece', ['Peloponnisos']));
  startWith(b, ATHENS, b.regionsOf('Greece', ['Attiki']));
  // (Close in, the coast is the finer heights', beyond the provinces' coarser outlines: the land around the city is Ottoman to the shore.)
  startWith(b, OTT, [outline('Around the city', [[27.9, 40.70], [29.60, 40.70], [29.60, 41.40], [27.9, 41.40]])], ['']);
  startWith(b, BYZ, [outline('Constantinople', CITY), ...Object.entries(OUTPOSTS).map(([n, r]) => outline(n, r)), outline('The Princes\' Islands', ...ISLANDS)]);
  startWith(b, GEN, [outline('Galata', GALATA)]);
  for (const [n, at] of [['Constantinople', [28.9560, 41.0160]], ['Adrianople', P.edirne], ['Bursa', P.bursa], ['Gallipoli', P.gallipoli], ['Nicaea', P.nicaea], ['Nicomedia', P.nicomedia], ['Selymbria', P.selymbria], ['Mesembria', P.mesembria], ['Thessalonica', P.thessalonica], ['Athens', P.athens], ['Mistra', P.mistra], ['Trebizond', P.trebizond], ['Sinope', P.sinop], ['Konya', P.konya]] as Array<[string, Place]>) city(b, n, at);
}

interface Layers { walls: string; chain: string; gates: string; sites: string; forts: string; camps: string; guns: string; works: string; moves: string; ships: string; fights: string; fire: string }
/** The layers of the city close in (left out of the shots from afar). */
const CLOSE_LAYERS = ['Walls', 'The chain', 'Gates', 'Landmarks', 'Ottoman camps', 'Gun batteries', 'Siege works', 'Ships', 'Fighting', 'Cannon fire'];

/** The city of 1453: walls, gates, landmarks and the layers the siege is drawn on. */
function city1453(b: Builder): Layers {
  const L: Layers = {
    walls: featureLayer(b, 'Walls', 'line', { color: '#f1e4c3', width: 3.6, dash: 'solid', showName: false }),
    chain: featureLayer(b, 'The chain', 'line', { color: '#e8e8e8', width: 3.2, dash: 'dotted', showName: false }),
    gates: featureLayer(b, 'Gates', 'point', { color: '#f1e4c3', symbol: 'diamond', size: 8, showName: true }),
    sites: featureLayer(b, 'Landmarks', 'point', { color: '#ffe08a', symbol: 'star', size: 12, showName: true }),
    forts: featureLayer(b, 'Fortresses', 'point', { color: '#ffb0a0', symbol: 'square', size: 9, showName: true }),
    camps: featureLayer(b, 'Ottoman camps', 'area', { color: '#d4473b', fillOpacity: 0.3, dash: 'dashed', width: 1.6, showName: true }),
    guns: featureLayer(b, 'Gun batteries', 'point', { color: '#ff8a3d', symbol: 'square', size: 7, showName: false }),
    works: featureLayer(b, 'Siege works', 'line', { color: '#c58a4a', width: 3, dash: 'dashed', showName: false }),
    moves: featureLayer(b, 'Movements', 'line', { color: '#d4473b', width: 16, look: 'arrow', showName: false }),
    ships: featureLayer(b, 'Ships', 'point', { color: '#d4473b', symbol: 'triangle', size: 10, showName: true }),
    fights: featureLayer(b, 'Fighting', 'point', { color: '#ffd23f', symbol: 'battle', size: 15, showName: false }),
    fire: featureLayer(b, 'Cannon fire', 'line', { look: 'missile', color: '#ffc061', width: 3.6, showName: false }),
  };
  fixture(b, L.walls, 'The Theodosian walls', [LAND_WALLS]);
  fixture(b, L.walls, 'The sea walls of the Marmara', [MARMARA_WALLS], { width: 2.2 });
  fixture(b, L.walls, 'The sea walls of the Golden Horn', [HORN_WALLS], { width: 2.2 });
  fixture(b, L.walls, 'The walls of Galata', [GALATA_WALLS], { width: 2.2 });
  for (const [n, at] of [['Golden Gate', P.goldenGate], ['Gate of Pege', P.pege], ['Gate of Rhegium', P.rhegium], ['Gate of St Romanus', P.romanus], ['Pempton', P.pempton], ['Gate of Charisius', P.charisius], ['Kerkoporta', P.kerkoporta], ['Kaligaria', P.kaligaria]] as Array<[string, Place]>) fixture(b, L.gates, n, [[at]]);
  for (const [n, at] of [['Hagia Sophia', P.hagiaSophia], ['Blachernae Palace', P.blachernae], ['Holy Apostles', P.holyApostles], ['Hippodrome', P.hippodrome], ['Galata Tower', P.galataTower], ['Studios', P.studios]] as Array<[string, Place]>) fixture(b, L.sites, n, [[at]]);
  return L;
}

/** The story, from Mehmed's accession to the fall of Karaman. */
function story(b: Builder, L: Layers): void {
  const OTT = b.country('Ottoman Empire'), BYZ = b.country('Byzantine Empire'), GEN = b.country('Galata (Genoese)');
  const BEFORE = 'Before the siege', SIEGE = 'The siege', FIRE = 'Bombardment', FALL = 'The fall', AFTER = 'After the fall';
  b.group(BEFORE, '#8a6d3b'); b.group(SIEGE, '#b8322a'); b.group(FIRE, '#ff8a3d'); b.group(FALL, '#5a1a1a'); b.group(AFTER, '#3d5a80');
  const ev = (name: string, start: Instant, end: Instant | null, about: string, group: string, type = 'general') => event(b, name, start, end, { about, group, type });
  const blue = { color: '#3b78c4' };
  /** A point appearing at `at` (absent: the event's start), fading in over `hours`, gone at `until`. */
  const appear = (layer: string, name: string, place: Place, eventId: string, at: Instant, o: { until?: Instant; style?: Record<string, unknown>; hours?: number } = {}) =>
    feature(b, layer, name, [[place]], eventId, { at, anim: 'fade', animUntil: later(at, 0, o.hours ?? 0.5), until: o.until, style: o.style });

  // ---- Before the siege, 1451 to April 1453
  ev('Mehmed II becomes sultan', J(1451, 2, 18), null, 'Murad II dies at Adrianople on 3 February; his son Mehmed, nineteen, takes the throne for the second time. He means to take Constantinople.', BEFORE);
  ev('Constantine threatens to free Orhan', J(1451, 10, 1), null, 'The emperor asks Mehmed to pay more for keeping the Ottoman pretender Orhan, or see him set free. Grand vizier Halil Pasha calls it folly.', BEFORE);
  const rumeli = ev('Rumelihisarı is built', J(1452, 4, 15), J(1452, 8, 31), 'On the European shore of the Bosphorus, at its narrowest, opposite the older Anadoluhisarı: the "Throat-cutter", built in four and a half months.', BEFORE, 'founding');
  feature(b, L.forts, 'Rumelihisarı', [[P.rumeli]], rumeli, { anim: 'grow' });
  fixture(b, L.forts, 'Anadoluhisarı', [[P.anadolu]]);
  ev('Envoys beheaded', J(1452, 6, 25), null, 'Constantine sends envoys to ask that the villages by the new castle be spared. Mehmed has them beheaded: it is war.', BEFORE, 'war');
  ev('Orban offers his guns', J(1452, 7, 15), null, 'Orban, a founder of cannon from Hungary, had offered his skill to the emperor, who could not pay him. Mehmed pays four times what he asks.', BEFORE);
  const rizzo = ev('A Venetian ship sunk in the Bosphorus', J(1452, 11, 26), null, 'Antonio Rizzo\'s ship refuses to lower its sails before Rumelihisarı. One stone ball sinks it; Rizzo is impaled.', BEFORE, 'war');
  appear(L.fights, 'Rizzo\'s ship sunk', [29.0590, 41.0835], rizzo, J(1452, 11, 26), { until: J(1452, 12, 10), hours: 6 });
  ev('Cardinal Isidore arrives', J(1452, 10, 26), null, 'The papal legate, once metropolitan of Kiev, comes with 200 archers from Naples.', BEFORE);
  ev('The Union of the Churches proclaimed', J(1452, 12, 12), null, 'In Hagia Sophia the union of the Orthodox and Catholic churches agreed at Florence is proclaimed. Many in the city will not set foot in the church again.', BEFORE);
  ev('The great bombard cast', J(1453, 1, 15), null, 'At Adrianople Orban casts a bronze gun 8 metres long that throws a stone ball of over 500 kg more than a mile. Its first trial shot is heard 15 km away.', BEFORE);
  ev('Giustiniani arrives', J(1453, 1, 26), null, 'Giovanni Giustiniani Longo of Genoa, famed for defending walls, arrives with 700 men in two ships. The emperor gives him command of the land walls.', BEFORE);
  ev('The great bombard leaves Adrianople', J(1453, 2, 1), J(1453, 3, 30), 'Sixty oxen and two hundred men drag the gun towards the city; 250 workers go ahead levelling the road and strengthening the bridges.', BEFORE);
  ev('Seven ships slip away', J(1453, 2, 26), null, 'By night six Cretan ships and one Venetian leave the Golden Horn with 700 Italians aboard.', BEFORE);
  const blackSea = ev('Karaca Pasha takes the Black Sea towns', J(1453, 3, 10), null, 'Mesembria and Anchialos surrender; Byzantine towns that resist are stormed.', BEFORE, 'conquest');
  take(b, blackSea, OTT, [BYZ], [outline('Mesembria', OUTPOSTS.Mesembria), outline('Anchialos', OUTPOSTS.Anchialos)]);
  const march = ev('The army leaves Adrianople', J(1453, 3, 23), J(1453, 4, 5), 'Mehmed sets out with the army: by most counts some 80,000 men, with thousands more irregulars.', BEFORE, 'war');
  feature(b, L.moves, 'The Ottoman army marches', [[P.edirne, [27.2, 41.45], [27.9, 41.2], [28.5, 41.1], [28.90, 41.03]]], march, { until: J(1453, 4, 12) });
  const fleet = ev('The fleet sails from Gallipoli', J(1453, 3, 25), J(1453, 4, 12), 'Baltaoğlu Süleyman Bey brings the fleet up the Dardanelles and across the Marmara: over a hundred ships, triremes, biremes and transports.', BEFORE, 'war');
  feature(b, L.moves, 'The Ottoman fleet sails', [[P.gallipoli, [27.4, 40.62], [28.3, 40.83], [28.95, 40.96], [29.0, 41.0], [29.0035, 41.035]]], fleet, { until: J(1453, 4, 20) });

  // ---- The siege, 2 April to 28 May
  const chain = ev('The chain across the Golden Horn', J(1453, 4, 2), null, 'The great chain, on wooden floats, is stretched from the Tower of Eugenius to the Kastellion of Galata, closing the harbour. Behind it lie the Christian ships.', SIEGE);
  const chainLine = feature(b, L.chain, 'The chain', [[P.chainCity, P.chainGalata]], chain);
  appear(L.ships, 'Christian ships', P.christianShips, chain, J(1453, 4, 2), { style: blue, hours: 6 });
  const vanguard = ev('The Ottoman vanguard arrives', J(1453, 4, 2, 10), null, 'The first Ottoman troops appear before the walls. A sortie kills some of them; then the defenders withdraw inside and the bridges over the moat are broken.', SIEGE, 'war');
  appear(L.fights, 'Sortie before the walls', [28.925, 41.022], vanguard, J(1453, 4, 2, 10), { until: J(1453, 4, 3), hours: 2 });
  const camp = ev('Mehmed pitches his tent', J(1453, 4, 5), J(1453, 4, 6), 'The sultan\'s red and gold tent is pitched on a rise opposite the Gate of St Romanus, the army in its places along the walls.', SIEGE, 'war');
  const campAreas: Array<[string, Place[]]> = [
    ['Karaca Pasha: the troops of Rumelia', [[28.9385, 41.0440], [28.9395, 41.0400], [28.9385, 41.0345], [28.9340, 41.0305], [28.9285, 41.0260], [28.9200, 41.0290], [28.9230, 41.0380], [28.9300, 41.0440]]],
    ['The sultan and the Janissaries', [[28.9265, 41.0235], [28.9205, 41.0160], [28.9175, 41.0105], [28.9050, 41.0110], [28.9020, 41.0200], [28.9100, 41.0270], [28.9210, 41.0280]]],
    ['Ishak Pasha: the troops of Anatolia', [[28.9150, 41.0080], [28.9145, 41.0030], [28.9160, 40.9985], [28.9195, 40.9930], [28.9120, 40.9905], [28.9030, 40.9950], [28.9010, 41.0060], [28.9060, 41.0100]]],
    ['Zaganos Pasha', [[28.9560, 41.0370], [28.9640, 41.0350], [28.9700, 41.0390], [28.9690, 41.0450], [28.9600, 41.0470], [28.9535, 41.0430]]],
  ];
  for (const [n, ring] of campAreas) feature(b, L.camps, n, [ring], camp, { anim: 'grow', until: J(1453, 6, 18) });
  appear(L.sites, 'The sultan\'s tent', P.camp, camp, J(1453, 4, 5, 12), { until: J(1453, 6, 18), hours: 4 });
  ev('The siege begins', J(1453, 4, 6), null, 'Mehmed sends heralds offering the city its life for surrender, as the law requires. The offer is refused; the guns are brought up.', SIEGE, 'war');
  const batteries = ev('The batteries are set up', J(1453, 4, 6), J(1453, 4, 11), 'Fourteen batteries along the land walls, behind earthworks and palisades, the heaviest facing the Mesoteichion in the valley of the Lycus.', SIEGE, 'war');
  BATTERIES.forEach((g, i) => appear(L.guns, g.name, g.at, batteries, later(J(1453, 4, 6), i * 0.5), { until: J(1453, 5, 30), hours: 4 }));
  const therapia = ev('Therapia falls', J(1453, 4, 9), null, 'The little castle at Therapia on the Bosphorus holds out two days; its forty survivors are impaled.', SIEGE, 'conquest');
  take(b, therapia, OTT, [BYZ], [outline('Therapia', OUTPOSTS.Therapia)]);
  const studios = ev('The castle of Studios taken', J(1453, 4, 10), null, 'A small fort by the Marmara outside the walls is battered down in a few hours; thirty-six prisoners are impaled before the walls.', SIEGE, 'conquest');
  appear(L.fights, 'Castle of Studios', [28.9180, 40.9915], studios, J(1453, 4, 10), { until: J(1453, 4, 11), hours: 3 });
  const prinkipo = ev('Prinkipo burnt', J(1453, 4, 11), null, 'Baltaoğlu\'s fleet attacks the tower on Prinkipo, the largest of the Princes\' Islands; the garrison will not yield, so it is set on fire. The islands submit.', SIEGE, 'conquest');
  take(b, prinkipo, OTT, [BYZ], [outline('The Princes\' Islands', ...ISLANDS)]);
  const anchor = ev('The fleet anchors at the Double Columns', J(1453, 4, 12), null, 'The Ottoman fleet anchors at the Double Columns on the Bosphorus, beyond Galata.', SIEGE, 'war');
  appear(L.ships, 'Ottoman fleet', P.doubleColumns, anchor, J(1453, 4, 12), { hours: 6 });
  const boom1 = ev('First attack on the chain', J(1453, 4, 12, 9), J(1453, 4, 12, 14), 'Baltaoğlu attacks the ships behind the chain. The taller Christian ships shoot down on his decks; he draws off.', SIEGE, 'war');
  feature(b, L.moves, 'Attack on the chain', [[P.doubleColumns, [29.0, 41.028], [28.986, 41.0215]]], boom1, { until: J(1453, 4, 12, 18) });
  const a18 = ev('The first assault', J(1453, 4, 18, 20), J(1453, 4, 19, 0), 'At night the Ottomans attack the Mesoteichion, where the walls are most broken. After four hours of fighting in the dark they withdraw, having lost some two hundred men; the defenders lose none.', SIEGE, 'war');
  feature(b, L.moves, 'Assault on the Mesoteichion', [[[28.9120, 41.0200], [28.9205, 41.0195], [28.9255, 41.0195]]], a18, { until: J(1453, 4, 19, 2) });
  appear(L.fights, 'Fighting at the Mesoteichion', [28.9258, 41.0195], a18, J(1453, 4, 18, 20, 30), { until: J(1453, 4, 19, 1) });
  const battle = ev('The battle off the Acropolis', J(1453, 4, 20, 10), J(1453, 4, 20, 19), 'Three Genoese ships and an imperial grain ship fight their way through the whole Ottoman fleet. Becalmed off the Acropolis point they are surrounded; Mehmed rides his horse into the sea, shouting at his captains. At sunset the wind rises and they reach the Golden Horn. Baltaoğlu is flogged and dismissed.', SIEGE, 'war');
  feature(b, L.moves, 'Four Christian ships', [[[28.972, 40.985], [28.992, 40.998], [29.0, 41.010], [28.995, 41.0165], [28.985, 41.0205], [28.972, 41.0222]]], battle, { style: blue, until: J(1453, 4, 20, 22) });
  feature(b, L.moves, 'The Ottoman fleet attacks', [[P.doubleColumns, [29.0035, 41.028], [28.998, 41.018]]], battle, { at: J(1453, 4, 20, 12), until: J(1453, 4, 20, 21) });
  appear(L.fights, 'Battle off the Acropolis', [28.9960, 41.0150], battle, J(1453, 4, 20, 14), { until: J(1453, 4, 20, 19) });
  const baccat = ev('The tower of Baccatureus falls', J(1453, 4, 21), null, 'The guns bring down a tower by the Gate of St Romanus and part of the outer wall. By night the defenders fill the breach with a stockade of timber, earth and barrels.', SIEGE, 'war');
  appear(L.fights, 'Breach by St Romanus', wallAt(41.0170), baccat, J(1453, 4, 21, 10), { until: J(1453, 4, 23), hours: 2, style: { symbol: 'cross', color: '#ffe9a8' } });
  const overland = ev('Ships over the hill', J(1453, 4, 21, 20), J(1453, 4, 22, 9), 'In one night some seventy ships are hauled on greased timbers from the Double Columns up the valley behind Galata and down to the Valley of the Springs, into the Golden Horn behind the chain, with sails set and drums beating.', SIEGE, 'war');
  feature(b, L.works, 'The road over the hill', [[[29.0000, 41.0362], [28.9930, 41.0372], [28.9870, 41.0374], [28.9800, 41.0368], [28.9740, 41.0350], [28.9690, 41.0330], [28.9640, 41.0315], [28.9610, 41.0305]]], overland, { anim: null, at: J(1453, 4, 21, 20), until: J(1453, 5, 30) });
  feature(b, L.moves, 'Seventy ships hauled overland', [[[29.0000, 41.0362], [28.9930, 41.0372], [28.9870, 41.0374], [28.9800, 41.0368], [28.9740, 41.0350], [28.9690, 41.0330], [28.9615, 41.0307]]], overland, { until: J(1453, 4, 22, 14) });
  appear(L.ships, 'Ottoman ships in the Golden Horn', P.springs, overland, J(1453, 4, 22, 7), { hours: 1 });
  ev('The walls of the Golden Horn manned', J(1453, 4, 23), null, 'With Ottoman ships inside the harbour the long sea walls of the Golden Horn must be held too: men are taken from the land walls.', SIEGE);
  const coco = ev('Coco\'s attack fails', J(1453, 4, 28, 3), J(1453, 4, 28, 6), 'Before dawn Giacomo Coco leads Venetian ships to burn the Ottoman ships in the Golden Horn. Warned, the Ottomans open fire; Coco\'s ship is sunk with all hands. Forty sailors who swim ashore are executed in sight of the walls.', SIEGE, 'war');
  feature(b, L.moves, 'Coco\'s fire ships', [[[28.9740, 41.0205], [28.9690, 41.0240], [28.9650, 41.0275]]], coco, { style: blue, until: J(1453, 4, 28, 9) });
  appear(L.fights, 'Coco\'s ship sunk', [28.9655, 41.0275], coco, J(1453, 4, 28, 5), { until: J(1453, 4, 28, 12) });
  ev('Prisoners killed on the walls', J(1453, 4, 28, 14), null, 'In reply the defenders hang 260 Ottoman prisoners from the walls, in full view of the camp.', SIEGE, 'war');
  const brig = ev('A brigantine slips out', J(1453, 5, 3, 1), null, 'Twelve volunteers, dressed as Turks and flying a Turkish flag, sail out past the Ottoman fleet to look for the Venetian relief fleet in the Aegean.', SIEGE);
  feature(b, L.moves, 'The brigantine', [[[28.975, 41.0185], [28.990, 41.008], [28.985, 40.99], [28.90, 40.95], [28.6, 40.85]]], brig, { style: blue, until: J(1453, 5, 4) });
  const gbat = ev('Guns on the hill behind Galata', J(1453, 5, 3), null, 'Guns hauled up the hill behind Galata fire over the town at the ships by the chain; a Genoese merchantman is sunk.', SIEGE, 'war');
  appear(L.guns, 'Battery behind Galata', GALATA_BATTERY, gbat, J(1453, 5, 3), { until: J(1453, 5, 30), hours: 4 });
  const bridge = ev('The pontoon bridge', J(1453, 5, 5), J(1453, 5, 19), 'A bridge of a thousand wine barrels, lashed in pairs and planked over, is laid across the upper Golden Horn, so troops can cross to the walls and guns can fire on them from rafts.', SIEGE, 'war');
  feature(b, L.works, 'Pontoon bridge', [[[28.9372, 41.0443], [28.9420, 41.0443], [28.9470, 41.0443]]], bridge, { until: J(1453, 5, 30) });
  const a7 = ev('Assault of 7 May', J(1453, 5, 7, 21), J(1453, 5, 8, 0), 'Some 30,000 men attack the stockade at the Mesoteichion for three hours; Rhangabes cuts down their leader Amir Bey and they fall back.', SIEGE, 'war');
  feature(b, L.moves, 'Assault on the stockade', [[[28.9120, 41.0190], [28.9205, 41.0180], [28.9245, 41.0178]]], a7, { until: J(1453, 5, 8, 2) });
  appear(L.fights, 'Fighting at the stockade', [28.9248, 41.0178], a7, J(1453, 5, 7, 21, 30), { until: J(1453, 5, 8, 1) });
  const a12 = ev('Assault on Blachernae', J(1453, 5, 12, 22), J(1453, 5, 13, 2), 'At midnight 50,000 men attack where the walls of Blachernae meet the Theodosian walls; the emperor himself brings men to drive them back.', SIEGE, 'war');
  feature(b, L.moves, 'Assault on Blachernae', [[[28.9290, 41.0370], [28.9355, 41.0355], [28.9395, 41.0345]]], a12, { until: J(1453, 5, 13, 3) });
  appear(L.fights, 'Fighting at Blachernae', [28.9400, 41.0345], a12, J(1453, 5, 12, 22, 30), { until: J(1453, 5, 13, 2) });
  ev('The Venetians join the walls', J(1453, 5, 13), null, 'The crews of the Venetian ships are brought ashore to fight at Blachernae.', SIEGE);
  const mines: Array<[string, Instant, Instant, Place, Place]> = [
    ['Mine at the Kaligaria', J(1453, 5, 16), J(1453, 5, 16, 18), [28.9345, 41.0368], [28.9402, 41.0355]],
    ['Mine at the Gate of Charisius', J(1453, 5, 21), J(1453, 5, 21, 20), [28.9310, 41.0320], [28.9370, 41.0305]],
    ['Mine at Blachernae', J(1453, 5, 23), J(1453, 5, 23, 16), [28.9350, 41.0395], [28.9412, 41.0388]],
    ['Mine at Tekfur Saray', J(1453, 5, 25), J(1453, 5, 25, 12), [28.9340, 41.0345], [28.9400, 41.0335]],
  ];
  for (const [n, found, gone, from, to] of mines) {
    // (Dug for days towards the walls, then found and destroyed.)
    const m = ev(n, later(found, -3), gone, 'Serbian miners from Novo Brdo tunnel towards the walls; Johannes Grant, a German engineer, finds the tunnel and countermines it: it is burnt, flooded or broken into and the miners killed.', SIEGE, 'war');
    feature(b, L.works, n, [[from, to]], m, { anim: 'draw', until: gone, style: { color: '#8a5a2b', dash: 'dotted', width: 2.6 } });
  }
  const boom2 = ev('The fleet tries the chain again', J(1453, 5, 16, 10), J(1453, 5, 16, 15), 'The Ottoman ships at the Double Columns make for the chain; after a few shots they turn back.', SIEGE, 'war');
  feature(b, L.moves, 'Second attack on the chain', [[P.doubleColumns, [29.0, 41.028], [28.988, 41.022]]], boom2, { until: J(1453, 5, 16, 18) });
  const tower = ev('The siege tower burnt', J(1453, 5, 18), J(1453, 5, 18, 23), 'By morning a great wooden siege tower stands at the moat by St Romanus, covered with hides, built in one night. That night the defenders blow it up with barrels of powder and fill the moat again.', SIEGE, 'war');
  appear(L.fights, 'Siege tower', [28.9238, 41.0178], tower, J(1453, 5, 18), { until: J(1453, 5, 18, 23), hours: 3, style: { symbol: 'triangle', color: '#c58a4a', size: 14 } });
  ev('The last offer', J(1453, 5, 21), null, 'Mehmed\'s envoy Ismail Hamza offers terms: the emperor may leave for the Morea, the people may stay or go with their goods. Constantine answers that to surrender the city is not in his power, nor in anyone\'s.', SIEGE, 'treaty');
  ev('The moon in eclipse', J(1453, 5, 22, 20), null, 'The full moon rises in eclipse, a thin crescent for hours. The city remembers the prophecy that it will not fall while the moon waxes.', SIEGE);
  ev('The brigantine returns', J(1453, 5, 23), null, 'The twelve sail back through the Ottoman fleet with the news that no fleet is coming. They chose to return.', SIEGE);
  ev('The icon slips', J(1453, 5, 24), null, 'Carried in procession, the icon of the Virgin Hodegetria slips from its bearers and cannot be lifted for a long time; then a storm of hail and rain breaks over the procession.', SIEGE);
  ev('Fog over the city', J(1453, 5, 25), null, 'A thick fog, unknown in May, lies over the city all day; at night a strange light is seen playing about the dome of Hagia Sophia.', SIEGE);
  ev('The council of war', J(1453, 5, 26), null, 'Halil Pasha urges peace before the West comes to help; Zaganos Pasha urges the assault. Mehmed decides: the final assault on the 29th.', SIEGE);
  ev('Fires in the camp', J(1453, 5, 27, 19), J(1453, 5, 28, 0), 'Bonfires burn all night along the Ottoman lines and across the Golden Horn, with drums and pipes and cries of "There is no god but God". Mehmed promises his men three days of plunder.', SIEGE, 'war');
  ev('The last day', J(1453, 5, 28), null, 'The Ottoman camp rests and fasts. In the city bells ring, icons are carried along the walls, and the emperor speaks to his commanders.', SIEGE);
  const vespers = ev('The last service in Hagia Sophia', J(1453, 5, 28, 19), J(1453, 5, 28, 22), 'Orthodox and Catholic, Greek and Italian, crowd into Hagia Sophia for the last Christian service. Then each goes to his post.', SIEGE);
  appear(L.fights, 'The last vespers', P.hagiaSophia, vespers, J(1453, 5, 28, 19), { style: { symbol: 'star', color: '#ffffff', size: 14 }, until: J(1453, 5, 28, 23) });

  // ---- Every day's cannon fire, 7 April to 28 May
  bombardment(b, L, FIRE);

  // ---- The fall, 29 May
  const w1 = ev('The first wave', J(1453, 5, 29, 1, 30), J(1453, 5, 29, 3, 30), 'At half past one, with trumpets and drums, the irregulars, the bashi-bazouks, attack all along the land walls while the fleet attacks the sea walls. After two hours they are called back.', FALL, 'war');
  for (const [from, to] of [[[28.930, 41.0375], [28.9392, 41.0350]], [[28.912, 41.0205], [28.9248, 41.0190]], [[28.907, 41.0035], [28.9168, 41.0040]]] as Array<[Place, Place]>) feature(b, L.moves, 'Bashi-bazouks', [[from, to]], w1, { until: J(1453, 5, 29, 4) });
  feature(b, L.moves, 'The fleet against the Golden Horn walls', [[P.springs, [28.9560, 41.0288]]], w1, { until: J(1453, 5, 29, 8) });
  feature(b, L.moves, 'The fleet against the Marmara walls', [[[28.958, 40.985], [28.956, 40.9985]]], w1, { until: J(1453, 5, 29, 8) });
  appear(L.fights, 'Fighting on the land walls', wallAt(41.0190), w1, J(1453, 5, 29, 1, 45), { until: J(1453, 5, 29, 7), hours: 0.25 });
  const w2 = ev('The second wave', J(1453, 5, 29, 3, 30), J(1453, 5, 29, 5), 'Ishak Pasha\'s Anatolian troops attack the stockade in the Lycus valley. A ball from the great bombard breaks it; three hundred men rush in and are cut down; the rest fall back.', FALL, 'war');
  feature(b, L.moves, 'The Anatolians', [[[28.9070, 41.0110], [28.9170, 41.0150], [28.9240, 41.0170]]], w2, { until: J(1453, 5, 29, 5, 30) });
  const w3 = ev('The Janissaries', J(1453, 5, 29, 5), J(1453, 5, 29, 6), 'Mehmed leads his Janissaries to the moat himself. For an hour they fight at the stockade without breaking through.', FALL, 'war');
  feature(b, L.moves, 'The Janissaries', [[P.camp, [28.9190, 41.0185], [28.9245, 41.0172]]], w3, { until: J(1453, 5, 29, 6, 30) });
  const kerk = ev('The Kerkoporta', J(1453, 5, 29, 5, 30), null, 'A small postern near the Blachernae walls has been used for sorties and left unbarred. Some fifty Ottomans get in and raise their flags on the towers.', FALL, 'war');
  appear(L.fights, 'Ottoman flags on the towers', P.kerkoporta, kerk, J(1453, 5, 29, 5, 30), { until: J(1453, 5, 29, 9), hours: 0.2 });
  const blach = ev('Blachernae taken', J(1453, 5, 29, 5, 40), J(1453, 5, 29, 6, 30), 'From the Kerkoporta the Ottomans take the quarter of Blachernae.', FALL, 'conquest');
  take(b, blach, OTT, [BYZ], [outline('Blachernae', [[28.934, 41.026], [28.953, 41.026], [28.953, 41.046], [28.934, 41.046]])]);
  ev('Giustiniani wounded', J(1453, 5, 29, 5, 45), null, 'Giustiniani is wounded and carried from the walls through a gate to his ship. His men follow him; the defenders at the stockade waver.', FALL);
  const breach = ev('The Janissaries break through', J(1453, 5, 29, 6), J(1453, 5, 29, 7), 'Hasan of Ulubat, a giant of a Janissary, plants a flag on the walls before he is killed; the Janissaries pour over the stockade and through the Gate of St Romanus.', FALL, 'war');
  appear(L.fights, 'The breach', P.romanus, breach, J(1453, 5, 29, 6), { until: J(1453, 5, 29, 9), hours: 0.2 });
  ev('Constantine falls', J(1453, 5, 29, 6, 15), null, 'The emperor throws off his imperial insignia and charges into the fighting by the Gate of St Romanus with his cousin Theophilos and Don Francisco of Toledo. He is not seen again.', FALL, 'collapse');
  const west = ev('The western city overrun', J(1453, 5, 29, 6, 15), J(1453, 5, 29, 7, 30), 'The Ottomans spread through the city from the Gate of St Romanus and the Gate of Charisius.', FALL, 'conquest');
  take(b, west, OTT, [BYZ], [outline('The western city', [[28.910, 40.980], [28.946, 40.980], [28.946, 41.032], [28.910, 41.032]])]);
  const mid = ev('The middle of the city', J(1453, 5, 29, 7), J(1453, 5, 29, 8, 30), 'The Holy Apostles, the Forum of Theodosius: the soldiers run for the riches of the churches and the great houses.', FALL, 'conquest');
  b.commit(cmd.addCountries(b.world, b.engine, { spaceId: b.space, layerId: b.layer, countries: [{ name: 'The middle of the city', polygons: [[[[28.945, 40.980], [28.967, 40.980], [28.967, 41.040], [28.945, 41.040]], circle(P.cretans, 0.12, 12)]] }], mode: { kind: 'new', eventId: mid, at: null }, into: OTT, onlyFrom: [BYZ], transition: { style: 'border', easing: 'smooth' } }));
  feature(b, L.moves, 'Into the city', [[[28.9250, 41.0170], [28.9380, 41.0180], [28.9495, 41.0195]]], mid, { until: J(1453, 5, 29, 9) });
  const sailors = ev('The fleet\'s sailors land', J(1453, 5, 29, 7), null, 'Seeing the flags on the towers, the sailors leave their ships to plunder, and the sea walls are taken from behind.', FALL, 'war');
  feature(b, L.moves, 'Sailors land at the Golden Horn', [[P.springs, [28.9545, 41.0280]]], sailors, { until: J(1453, 5, 29, 9) });
  const east = ev('Hagia Sophia', J(1453, 5, 29, 8), J(1453, 5, 29, 9, 30), 'Crowds take refuge in Hagia Sophia, hoping for the angel the prophecy promised. The doors are broken in.', FALL, 'conquest');
  take(b, east, OTT, [BYZ], [outline('The east of the city', [[28.966, 40.980], [29.010, 40.980], [29.010, 41.030], [28.966, 41.030]])]);
  feature(b, L.moves, 'To Hagia Sophia', [[[28.9495, 41.0195], [28.9640, 41.0130], [28.9775, 41.0092]]], east, { until: J(1453, 5, 29, 10) });
  const escape = ev('The ships break out', J(1453, 5, 29, 11), J(1453, 5, 29, 15), 'Alviso Diedo has the chain cut; the Venetian, Genoese and Cretan ships, crowded with refugees, sail out of the Golden Horn while the Ottoman sailors are ashore plundering.', FALL);
  feature(b, L.moves, 'The ships escape', [[P.christianShips, [28.982, 41.018], [28.994, 41.010], [28.990, 40.995], [28.970, 40.980], [28.90, 40.95]]], escape, { style: blue, until: J(1453, 5, 29, 18) });
  b.commit(cmd.endFeature(b.world, b.engine, { feature: chainLine, mode: { kind: 'new', eventId: escape, at: J(1453, 5, 29, 11) } }));
  const cretans = ev('The Cretans\' towers', J(1453, 5, 29, 13), null, 'Cretan sailors in three towers of the Golden Horn walls hold out until the afternoon; Mehmed lets them sail away with their ship.', FALL, 'treaty');
  take(b, cretans, OTT, [BYZ], [outline('The Cretans\' towers', circle(P.cretans, 0.3, 12))], null, { style: 'dissolve' });
  const enter = ev('Mehmed enters the city', J(1453, 5, 29, 15), J(1453, 5, 29, 17), 'The sultan rides in through the Gate of Charisius to Hagia Sophia, stops a soldier hacking at the marble floor, and has the call to prayer given: the church becomes a mosque.', FALL);
  appear(L.fights, 'Hagia Sophia becomes a mosque', P.hagiaSophia, enter, J(1453, 5, 29, 16, 30), { style: { symbol: 'star', color: '#7fd4a0', size: 16 }, until: J(1453, 6, 2) });
  const keys = ev('Galata surrenders', J(1453, 5, 29, 17), null, 'The podestà of Galata sends the keys of the town to Mehmed.', FALL, 'treaty');
  void keys;

  // ---- After the fall
  const pera = ev('The treaty of Galata', J(1453, 6, 1), null, 'The Genoese keep their homes, goods and churches; their walls are pulled down on the land side, and Galata is Ottoman.', AFTER, 'treaty');
  annex(b, pera, OTT, ['Galata (Genoese)'], null, { style: 'dissolve' });
  void GEN;
  ev('Notaras executed', J(1453, 6, 3), null, 'The megadoux Loukas Notaras, spared at first, is executed with his sons.', AFTER);
  const sely = ev('Selymbria and Epibatos surrender', J(1453, 6, 5), null, 'The last Byzantine towns on the Marmara open their gates.', AFTER, 'conquest');
  take(b, sely, OTT, [BYZ], [outline('Selymbria', OUTPOSTS.Selymbria), outline('Epibatos', OUTPOSTS.Epibatos)], null, { style: 'dissolve' });
  ev('Mehmed returns to Adrianople', J(1453, 6, 18), null, 'Leaving a garrison, the sultan goes back to Adrianople with his army and prisoners.', AFTER);
  ev('Halil Pasha executed', J(1453, 8, 15), null, 'The old grand vizier, who had opposed the siege, is arrested and put to death.', AFTER);
  ev('Gennadios made Patriarch', J(1454, 1, 6), null, 'Mehmed has the monk Gennadios Scholarios, enemy of the Union, enthroned as Patriarch: head of the Orthodox under Ottoman rule.', AFTER, 'founding');
  ev('The siege of Belgrade fails', J(1456, 7, 22), null, 'John Hunyadi breaks Mehmed\'s siege of Belgrade; the sultan is wounded.', AFTER, 'war');
  ev('Kostantiniyye the capital', J(1457, 1, 1), null, 'Mehmed makes the city his capital, resettling it with Muslims, Christians and Jews from across his lands.', AFTER, 'founding');
  const athens = ev('Athens taken', J(1458, 6, 4), null, 'The Acropolis surrenders; the Duchy of Athens is Ottoman.', AFTER, 'conquest');
  annex(b, athens, OTT, ['Duchy of Athens']);
  const topkapi = ev('Topkapı Palace begun', J(1459, 3, 1), null, 'On the Acropolis of the old city, the new palace.', AFTER, 'founding');
  appear(L.sites, 'Topkapı Palace', [28.9834, 41.0115], topkapi, J(1459, 3, 1), { hours: 24 * 30 });
  const morea = ev('The Morea conquered', J(1460, 5, 29), null, 'Mistra surrenders to Mehmed seven years to the day after Constantinople; Despot Demetrios submits and Thomas flees to Italy.', AFTER, 'conquest');
  annex(b, morea, OTT, ['Despotate of the Morea']);
  const candar = ev('Candar annexed', J(1461, 6, 1), null, 'Kemaleddin Ismail of Candar hands over Sinope.', AFTER, 'conquest');
  annex(b, candar, OTT, ['Candar']);
  const treb = ev('Trebizond falls', J(1461, 8, 15), null, 'Emperor David Megas Komnenos surrenders Trebizond, the last Roman state.', AFTER, 'conquest');
  annex(b, treb, OTT, ['Empire of Trebizond']);
  const kar = ev('Karaman annexed', J(1468, 6, 1), null, 'Mehmed takes Konya and Karaman: the Ottomans hold all of western and central Anatolia.', AFTER, 'conquest');
  annex(b, kar, OTT, ['Karaman']);

  // ---- Characters
  journey(b, 'Mehmed II', [[J(1451, 2, 18), P.edirne], [J(1452, 4, 10), P.edirne], [J(1452, 4, 15), P.rumeli], [J(1452, 8, 31), P.rumeli], [J(1452, 9, 6), P.edirne], [J(1453, 3, 23), P.edirne], [J(1453, 4, 5), P.camp], [J(1453, 4, 20, 13), P.camp], [J(1453, 4, 20, 15), [29.0010, 41.0330]], [J(1453, 4, 21), P.camp], [J(1453, 5, 29, 4, 30), P.camp], [J(1453, 5, 29, 5, 15), [28.9205, 41.0180]], [J(1453, 5, 29, 14), [28.9205, 41.0180]], [J(1453, 5, 29, 15), P.charisius], [J(1453, 5, 29, 16, 30), P.hagiaSophia], [J(1453, 6, 10), P.blachernae], [J(1453, 6, 18), P.camp], [J(1453, 6, 25), P.edirne]], { notes: 'Sultan of the Ottomans, 21 years old at the siege: "the Conqueror".' });
  journey(b, 'Constantine XI', [[J(1451, 1, 1), P.blachernae], [J(1453, 4, 6), P.blachernae], [J(1453, 4, 18, 21), P.romanus], [J(1453, 4, 19, 2), P.blachernae], [J(1453, 5, 12, 23), P.kaligaria], [J(1453, 5, 13, 3), P.blachernae], [J(1453, 5, 28, 18), P.hagiaSophia], [J(1453, 5, 28, 22), P.blachernae], [J(1453, 5, 29, 1), [28.9255, 41.0170]]], { notes: 'Constantine XI Palaiologos, the last Roman emperor, 49 years old.', leaves: J(1453, 5, 29, 6, 20) });
  journey(b, 'Giovanni Giustiniani', [[J(1452, 12, 20), P.chios], [J(1453, 1, 26), [28.9700, 41.0215]], [J(1453, 4, 6), [28.9255, 41.0180]], [J(1453, 5, 29, 5, 45), [28.9255, 41.0180]], [J(1453, 5, 29, 6, 30), [28.9690, 41.0222]], [J(1453, 5, 29, 15), [28.9900, 41.0000]], [J(1453, 6, 3), P.chios]], { notes: 'Genoese captain who commanded the land walls; died of his wound on Chios.', leaves: J(1453, 6, 8) });
  journey(b, 'Orban', [[J(1452, 3, 1), P.brasov], [J(1452, 5, 15), [28.9500, 41.0200]], [J(1452, 7, 15), P.edirne], [J(1453, 2, 1), P.edirne], [J(1453, 4, 11), BATTERIES[5].at]], { notes: 'Founder of cannon from Hungary, maker of the great bombard. What became of him is not known: some say a gun burst and killed him during the siege.', leaves: J(1453, 5, 28) });
  journey(b, 'Loukas Notaras', [[J(1453, 4, 6), P.petrion], [J(1453, 5, 29, 9), P.petrion]], { notes: 'Megadoux, commander of the fleet, who held the walls of the Golden Horn.', leaves: J(1453, 6, 3) });
  journey(b, 'Zaganos Pasha', [[J(1453, 3, 23), P.edirne], [J(1453, 4, 6), [28.9620, 41.0420]], [J(1453, 5, 29, 1), [28.9620, 41.0420]], [J(1453, 5, 29, 3), [28.9380, 41.0440]], [J(1453, 5, 29, 9), P.blachernae]], { notes: 'Second vizier, who urged the assault; commanded across the Golden Horn, and crossed it by the pontoon bridge for the last assault.', leaves: J(1453, 6, 18) });
  journey(b, 'Baltaoğlu Süleyman', [[J(1453, 3, 25), P.gallipoli], [J(1453, 4, 12), P.doubleColumns]], { notes: 'Admiral of the Ottoman fleet, flogged and dismissed after the battle of 20 April.', leaves: J(1453, 4, 21) });
  journey(b, 'Cardinal Isidore', [[J(1452, 5, 1), P.rome], [J(1452, 10, 26), P.hagiaSophia], [J(1453, 4, 6), P.acropolis]], { notes: 'Papal legate, who defended the Acropolis; escaped dressed as a beggar.', leaves: J(1453, 5, 29, 12) });
  journey(b, 'Hasan of Ulubat', [[J(1453, 5, 29, 5), P.camp], [J(1453, 5, 29, 6), P.romanus]], { notes: 'Janissary said to have first raised a flag on the walls.', leaves: J(1453, 5, 29, 6, 10) });

  // ---- Statistics
  b.commit(cmd.setMapStatistics(b.world, b.space, [
    stat('Days of siege', 'number', 'linear', [[J(1453, 4, 6), 0], [J(1453, 5, 29), 53]], 0),
    stat('Defenders', 'count', 'linear', [[J(1453, 4, 6), 7000], [J(1453, 4, 18), 6900], [J(1453, 5, 7), 6600], [J(1453, 5, 25), 6200], [J(1453, 5, 29, 1, 30), 6000], [J(1453, 5, 29, 6), 4000], [J(1453, 5, 29, 8), 0]]),
    stat('Ottoman army', 'count', 'linear', [[J(1453, 4, 6), 80000], [J(1453, 5, 29), 75000]]),
    stat('Ships in the Golden Horn', 'number', 'step', [[J(1453, 4, 6), 0], [J(1453, 4, 22, 8), 72]]),
    stat('Great bombard shots', 'number', 'linear', [[J(1453, 4, 12), 0], [J(1453, 5, 29), 329]], 0),
  ]));
}

/** Every day's cannon fire: from each battery at the walls before it, a few shots a day, more on the days of the assaults. */
function bombardment(b: Builder, L: Layers, group: string): void {
  const rnd = seeded(1453);
  const notes: Record<string, string> = {
    '4-7': 'The guns open fire. Near the Gate of Charisius a stretch of the outer wall comes down; by night it is mended.',
    '4-12': 'Orban\'s great bombard fires for the first time: seven shots a day, each ball over 500 kg, fired with a roar heard far away.',
    '4-18': 'All day the guns pound the Mesoteichion before the night assault.',
    '4-21': 'The tower of Baccatureus by the Gate of St Romanus falls; the outer wall is breached.',
    '5-6': 'A day of fire on the Mesoteichion: by evening a great breach is open.',
    '5-12': 'The guns turn on the walls of Blachernae.',
    '5-27': 'The heaviest bombardment of the siege, all day long: the stockades are breached in three places.',
  };
  const heavy = new Set(['4-12', '4-18', '4-21', '5-6', '5-7', '5-12', '5-27']);
  const start = J(1453, 4, 7);
  for (let d = 0; d < 52; d++) {
    const day = later(start, d);
    const c = JC.toCivil(day), key = `${c.month}-${c.day}`;
    const great = d >= 5;
    const n = (heavy.has(key) ? 16 : 7) + Math.floor(rnd() * 5);
    const flights: cmd.MissileFlight[] = [];
    // (The guns on the hill behind Galata fire at the ships by the chain from 3 May.)
    const galata = d >= 26;
    for (let i = 0; i < n; i++) {
      const g = BATTERIES[Math.floor(rnd() * BATTERIES.length)];
      if (g.name === 'Orban\'s great bombard' && !great) continue;
      const launch = later(day, 0, 6 + (i / n) * 12 + rnd() * 0.5);
      const w = wallAt(g.at[1] + (rnd() - 0.5) * 0.004);
      flights.push({ from: g.at, to: [w[0] + 0.0004, w[1]], launch, arrive: later(launch, 0, 2.5 + rnd() * 1.5), name: g.name });
    }
    if (great) for (let i = 0; i < 7; i++) {
      const launch = later(day, 0, 6.5 + i * 1.7);
      flights.push({ from: BATTERIES[5].at, to: [wallAt(41.0165)[0] + 0.0004, 41.0165 + (rnd() - 0.5) * 0.001], launch, arrive: later(launch, 0, 3), name: 'The great bombard' });
    }
    if (galata) for (let i = 0; i < 2; i++) {
      const launch = later(day, 0, 9 + i * 5);
      flights.push({ from: GALATA_BATTERY, to: [28.9725 + rnd() * 0.002, 41.0205 + rnd() * 0.002], launch, arrive: later(launch, 0, 2.5), name: 'Battery behind Galata' });
    }
    const target = BATTERIES[Math.floor(rnd() * BATTERIES.length)].sector;
    const id = b.commit(cmd.missileSalvo(b.world, {
      spaceId: b.space, name: `Bombardment, ${c.day} ${JC.monthName(c.year, c.month)}`, launch: later(day, 0, 6), arrive: later(day, 0, 21.5), flights, layerId: L.fire, color: '#ffc061',
      description: notes[key] ?? `The guns fire from dawn to dusk, most heavily on ${target}. By night the defenders clear the rubble and mend the breaches with timber and earth.`,
    }));
    b.commit(cmd.setEventGroups(b.world, id, [b.group(group)]));
    b.events++;
  }
}

/** The shots: the city and its walls, the build-up, the siege in parts, the fall hour by hour, and what followed. */
function shots(b: Builder): void {
  const city = (zoom: number, lon = 28.955, lat = 41.018) => ({ lon, lat, zoom, rotation: 0, projection: 'mercator' as const });
  const STATS = 'Day {Days of siege} of the siege\nDefenders: about {Defenders}\nOttoman army: about {Ottoman army}\nOttoman ships in the Golden Horn: {Ships in the Golden Horn}';
  const main = ['Before the siege', 'The siege', 'The fall', 'After the fall'];
  shot(b, {
    name: '1 The city and its walls', title: 'Constantinople, April 1453', subtitle: 'The Queen of Cities, a thousand years old', projection: 'mercator', cities: false,
    time: [[0, J(1453, 4, 1, 12)], [24, J(1453, 4, 1, 13)]], camera: [[0, city(11.4)], [12, city(12.1, 28.950, 41.018)], [24, city(11.7)]],
    captions: [
      { text: 'The Theodosian walls: 6.5 km of moat, outer wall and inner wall, unbroken for a thousand years', from: J(1453, 4, 1, 12, 5), to: J(1453, 4, 1, 12, 25), anchor: [28.9265, 41.0225], x: 0.08, y: 0.25, align: 'left', size: 28 },
      { text: 'Hagia Sophia', from: J(1453, 4, 1, 12, 20), to: J(1453, 4, 1, 12, 40), anchor: P.hagiaSophia, x: 0.72, y: 0.72, size: 28 },
      { text: 'The chain closes the Golden Horn', from: J(1453, 4, 1, 12, 30), to: J(1453, 4, 1, 12, 50), anchor: [28.9770, 41.0197], x: 0.72, y: 0.35, size: 28 },
      { text: 'Galata, the Genoese town, neutral', from: J(1453, 4, 1, 12, 40), to: J(1453, 4, 1, 13), anchor: P.galataTower, x: 0.62, y: 0.15, size: 28 },
    ],
  });
  shot(b, {
    name: '2 Mehmed prepares, 1451 to 1453', title: 'Mehmed prepares', subtitle: '1451 to 1453', projection: 'mercator', precision: 'month', eventsBox: { groups: main }, hide: CLOSE_LAYERS,
    time: [[0, J(1451, 2, 1)], [36, J(1453, 4, 12)]], camera: [[0, { lon: 27.6, lat: 41.2, zoom: 6.6 }], [14, { lon: 28.9, lat: 41.08, zoom: 9.2 }], [22, { lon: 28.4, lat: 41.2, zoom: 7.2 }], [36, { lon: 28.3, lat: 41.0, zoom: 7.0 }]],
    captions: [{ text: 'Rumelihisarı: the "Throat-cutter" closes the Bosphorus', from: J(1452, 4, 15), to: J(1452, 11, 30), anchor: P.rumeli, x: 0.66, y: 0.3, size: 28 }],
  });
  shot(b, {
    name: '3 The siege begins, 2 to 12 April', title: 'The siege begins', subtitle: '2 to 12 April 1453', projection: 'mercator', cities: false, stats: STATS, eventsBox: { groups: main },
    time: [[0, J(1453, 4, 2)], [32, J(1453, 4, 13)]], camera: [[0, city(11.5)], [16, city(12.3, 28.935, 41.018)], [32, city(11.7)]], captions: [],
  });
  shot(b, {
    name: '4 The battle off the Acropolis, 20 April', title: 'The battle off the Acropolis', subtitle: '20 April 1453', projection: 'mercator', cities: false, precision: 'minute', eventsBox: { groups: main },
    time: [[0, J(1453, 4, 20, 9)], [24, J(1453, 4, 20, 21)]], camera: [[0, city(12.6, 28.990, 41.012)], [24, city(13.0, 28.985, 41.016)]],
    captions: [{ text: 'Becalmed, the four ships are surrounded; Mehmed rides into the sea', from: J(1453, 4, 20, 14), to: J(1453, 4, 20, 18), anchor: [28.996, 41.015], x: 0.62, y: 0.2, size: 28 }],
  });
  shot(b, {
    name: '5 Ships over the hill, 22 April', title: 'Ships over the hill', subtitle: 'The night of 21 to 22 April', projection: 'mercator', cities: false, precision: 'minute', stats: STATS,
    time: [[0, J(1453, 4, 21, 18)], [24, J(1453, 4, 22, 12)]], camera: [[0, city(12.9, 28.982, 41.032)], [24, city(12.5, 28.975, 41.030)]],
    captions: [{ text: 'Seventy ships hauled on greased timbers over the hill behind Galata', from: J(1453, 4, 21, 21), to: J(1453, 4, 22, 9), x: 0.5, y: 0.2, size: 30 }],
  });
  shot(b, {
    name: '6 Weeks of siege, 23 April to 21 May', title: 'Weeks of siege', subtitle: '23 April to 21 May 1453', projection: 'mercator', cities: false, stats: STATS, eventsBox: { groups: main },
    time: [[0, J(1453, 4, 23)], [40, J(1453, 5, 22)]], camera: [[0, city(11.8)], [20, city(12.4, 28.938, 41.030)], [40, city(11.8)]], captions: [],
  });
  shot(b, {
    name: '7 The last days, 21 to 28 May', title: 'The last days', subtitle: '21 to 28 May 1453', projection: 'mercator', cities: false, stats: STATS, eventsBox: { groups: main },
    time: [[0, J(1453, 5, 21)], [30, J(1453, 5, 29)]], camera: [[0, city(11.9)], [30, city(12.2, 28.945, 41.018)]], captions: [],
  });
  shot(b, {
    name: '8 The fall, 29 May 1453', title: 'The fall of Constantinople', subtitle: 'Tuesday, 29 May 1453', projection: 'mercator', cities: false, precision: 'minute', characters: true, trails: true, eventsBox: { groups: main },
    time: [[0, J(1453, 5, 29, 1)], [20, J(1453, 5, 29, 5, 30), 'smooth'], [44, J(1453, 5, 29, 9, 30)], [60, J(1453, 5, 29, 17, 30)]],
    camera: [[0, city(12.0, 28.935, 41.020)], [20, city(12.6, 28.930, 41.022)], [44, city(12.0, 28.950, 41.018)], [60, city(11.8)]],
    captions: [
      { text: 'The Kerkoporta: a postern left unbarred', from: J(1453, 5, 29, 5, 30), to: J(1453, 5, 29, 6, 15), anchor: P.kerkoporta, x: 0.62, y: 0.2, size: 28 },
      { text: 'The emperor is not seen again', from: J(1453, 5, 29, 6, 15), to: J(1453, 5, 29, 7, 15), anchor: P.romanus, x: 0.08, y: 0.25, align: 'left', size: 28 },
    ],
  });
  shot(b, {
    name: '9 The whole siege in a minute', title: 'The siege of Constantinople', subtitle: '6 April to 29 May 1453', projection: 'mercator', cities: false, stats: STATS, eventsBox: { groups: main },
    time: [[0, J(1453, 4, 6)], [56, J(1453, 5, 29)], [64, J(1453, 5, 29, 18)]], camera: [[0, city(11.7)], [64, city(11.7)]], captions: [],
  });
  shot(b, {
    name: '10 After the fall, 1453 to 1468', title: 'After the fall', subtitle: '1453 to 1468', projection: 'mercator', precision: 'month', eventsBox: { groups: main }, hide: CLOSE_LAYERS,
    time: [[0, J(1453, 5, 29)], [30, J(1468, 7, 1)]], camera: [[0, { lon: 28.95, lat: 41.02, zoom: 10 }], [8, { lon: 29.5, lat: 40.0, zoom: 5.6 }], [30, { lon: 30.0, lat: 39.5, zoom: 5.2 }]], captions: [],
  });
}
