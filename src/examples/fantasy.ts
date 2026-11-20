// Orrun, a thousand years (D179): an example project of a world of one's own. A generated planet, cut into
// provinces of its own (provinces.ts); its own calendar, with three ages; the realms of its two great continents
// founded, grown, at war, united and divided, province by province; the Ember Dominion rising from a volcano in
// the north-east and thrown down; a volcano, a forest fire, a meteor and a flood; the neck of land between the
// continents sinking under the sea; heroes, a dragon and two voyages; and another history in a branch of its own,
// in which the battle that saved the west is lost.
import type { ProjectRegistry } from '../server/projects.ts';
import * as cmd from '../domain/commands.ts';
import { calendarOf, type CalendarDef } from '../core-time/custom-calendar.ts';
import type { Instant } from '../core-time/index.ts';
import type { TransitionSpec } from '../temporal-engine/engine.ts';
import { generatePlanet, type PlanetParams } from '../terrain/planet.ts';
import { makeProvinces, type Province } from './provinces.ts';
import { startProject, event, take, annex, rename, featureLayer, feature, city, journey, stat, shot, later, clear, type Builder, type Place } from './kit.ts';

/** The planet: an Earth-like world of five continents (the same every time). */
export const ORRUN: PlanetParams = { seed: 137, preset: 'earthlike', sea: 0.62, continents: 5, mountains: 1.1, roughness: 0.55, ice: 0.12 };

/** Its calendar: ten months of 33 days and the five days of the Long Night (six every fourth year), a week of six days. */
export const RECKONING: CalendarDef = {
  id: 'orrun', name: 'Reckoning of Orrun',
  months: [
    { name: 'Frostwane', days: 33 }, { name: 'Thaw', days: 33 }, { name: 'Seedtime', days: 33 }, { name: 'Bloom', days: 33 }, { name: 'Highsun', days: 33 },
    { name: 'Goldmonth', days: 33 }, { name: 'Harvest', days: 33 }, { name: 'Leaffall', days: 33 }, { name: 'Mist', days: 33 }, { name: 'Deepwinter', days: 33 },
    { name: 'the Long Night', short: 'Night', days: 5, leapDays: 1 },
  ],
  leap: { every: 4 }, epochDay: 0,
  weekdays: ['Sunsday', 'Moonday', 'Stormday', 'Hearthday', 'Stoneday', 'Starday'], firstWeekday: 0,
  eras: [{ name: 'Age of Crowns', abbr: 'AC', start: 1 }, { name: 'Age of Embers', abbr: 'AE', start: 421 }, { name: 'Age of Concord', abbr: 'CC', start: 781 }],
  before: 'before Crowns',
};
const RC = calendarOf(RECKONING);
/** A moment in the Reckoning of Orrun (its own count of years, from the founding of Calvaris). */
export const Y = (year: number, month = 1, day = 1, hour = 12): Instant => RC.fromCivil({ year, month, day, hour });

const FADE: TransitionSpec = { style: 'fade', for: { n: 120, unit: 'day' } };
const FRONT: TransitionSpec = { style: 'border', easing: 'smooth' };

/** Places (longitude, latitude) on Orrun. */
export const AT = {
  calvaris: [14.8, 51.5], ormunhold: [11.0, 42.0], brannoch: [-17.0, 34.0], kessrin: [4.0, 17.0], aurelis: [6.0, 28.0], westhaven: [-33.0, 27.5],
  lorrinhall: [-4.0, 52.0], teshar: [36.0, 43.0], ordu: [57.0, 52.0], kharn: [38.5, 61.5], ammar: [-12.0, -22.0], tazz: [10.0, -12.0],
  ilmarin: [38.0, -4.0], portVenn: [-43.8, 18.8], draven: [-56.0, 4.0], kaimar: [112.8, 29.8], hrimgard: [-58.0, 62.0],
  ashfields: [22.0, 51.0], greenwood: [26.0, 54.0], neck: [8.0, 7.5],
} satisfies Record<string, Place>;

export function buildOrrun(reg: ProjectRegistry, dataDir: string, name = 'Orrun, a thousand years (example)') {
  const { info, b } = startProject(reg, dataDir, name, { name: 'Orrun', radiusKm: 6100 });
  b.commit(cmd.setWorldBasemap(b.world, b.space, 'none'));
  b.commit(cmd.setWorldPlanet(b.world, b.space, ORRUN));
  b.commit(cmd.setMapCalendar(b.world, b.space, RECKONING));
  b.commit(cmd.updateLayer(b.world, b.layer, { name: 'Realms' }));
  b.commit(cmd.setLayerLook(b.world, b.layer, { fillOpacity: 0.6, borderWidth: 1.4 }));
  // The provinces, from the planet's own heights (a coarser grid than the map's: borders need no more).
  const provinces = makeProvinces(generatePlanet(ORRUN, 720, 360), { seed: 7, spacing: 6, seaReach: 1.5, minLand: 3 });
  const L = {
    roads: featureLayer(b, 'Roads and walls', 'line', { color: '#d9c7a1', width: 3, look: 'road', showName: true }),
    moves: featureLayer(b, 'Campaigns and voyages', 'line', { color: '#c0392b', width: 12, look: 'arrow', showName: false }),
    fights: featureLayer(b, 'Battles', 'point', { color: '#ffd23f', symbol: 'battle', size: 15, showName: true }),
  };
  for (const [n, at] of [['Calvaris', AT.calvaris], ['Ormunhold', AT.ormunhold], ['Dun Brannoch', AT.brannoch], ['Kessrin', AT.kessrin], ['Aurelis', AT.aurelis], ['Westhaven', AT.westhaven], ['Lorrinhall', AT.lorrinhall], ['Teshar', AT.teshar], ['Uzun Ordu', AT.ordu], ['Ammar', AT.ammar], ['Tazz', AT.tazz], ['Ilmarin', AT.ilmarin], ['Draven', AT.draven], ['Kaimar', AT.kaimar], ['Hrimgard', AT.hrimgard]] as Array<[string, Place]>) city(b, n, at);
  const born = history(b, provinces, L);
  ember(b, provinces, born);
  branchHeroes(b, heroes(b), born.branch);
  shots(b, born);
  return info;
}

interface Layers { roads: string; moves: string; fights: string }
interface Story { realm: Record<string, string>; mainEnd: Instant; branch: string }

/** The main history: the ages of Crowns, Embers and Concord. */
function history(b: Builder, provinces: Province[], L: Layers): Story {
  const P = (...ks: number[]) => ks.map((k) => { const p = provinces[k]; if (!p) throw new Error(`No province ${k}.`); return { name: p.name, polygons: p.polygons }; });
  const g = { crowns: b.group('The Age of Crowns', '#c9a227'), embers: b.group('The Age of Embers', '#c0392b'), concord: b.group('The Age of Concord', '#4a78c2'), wonders: b.group('Wonders and disasters', '#7e57c2') };
  void g;
  const CROWNS = 'The Age of Crowns', EMBERS = 'The Age of Embers', CONCORD = 'The Age of Concord', WONDERS = 'Wonders and disasters';
  const ev = (name: string, start: Instant, end: Instant | null, about: string, group: string, type = 'general') => event(b, name, start, end, { about, group, type });
  const realm = (n: string, color: string, notes: string) => { const id = b.country(n, color); b.commit(cmd.updateEntity(b.world, id, { notes })); return id; };
  const arrow = (eventId: string, name: string, route: Place[], at: Instant, days: number, until: Instant, color?: string) =>
    feature(b, L.moves, name, [route], eventId, { at, animUntil: later(at, days), until, style: color ? { color } : undefined });
  const battle = (eventId: string, name: string, place: Place, when: Instant, days = 3 * 335) =>
    feature(b, L.fights, name, [[place]], eventId, { at: when, anim: 'grow', animUntil: later(when, 30), until: later(when, days) });

  const R = {
    calvar: realm('Calvar', '#4a78c2', 'The oldest kingdom of the north, founded by Queen Ysolde at Calvaris on the plains below the Spine.'),
    brannoch: realm('Brannoch', '#2e8b57', 'The clanholds of the western highlands, under a High Chief chosen at the clan-moot.'),
    ormun: realm('Ormun', '#8d6e63', 'The stonehold of the Spine, its halls cut into the mountains; it opened its gates to trade in 175.'),
    kessrin: realm('Kessrin', '#e3a33a', 'A city of merchants on the neck of land between the continents, and the league of cities it led.'),
    aurel: realm('Aurel', '#d9737f', 'The kingdom of the sunward coast, between the Spine and the Middle Sea.'),
    westmarch: realm('Westmarch', '#6d9dc5', 'Settlers of the western coast, under the Wardens of Westhaven.'),
    lorrin: realm('Lorrin', '#7fae9f', 'The northern kingdom of fens and forests, joined to Calvar by marriage in 300.'),
    teshar: realm('Teshar', '#b0806a', 'A kingdom of the eastern passes, between Calvar and the steppe.'),
    uzun: realm('Uzun', '#9fa65a', 'The clans of the eastern steppe, united under one Khagan in 140.'),
    kharn: realm('The Kharn Holds', '#8b1e1e', 'Mountain clans round Mount Kharn, the fire-mountain of the north-east.'),
    ammaru: realm('Ammaru', '#f2c14e', 'The kingdom of the Sun Kings in the lowlands of Saruun.'),
    tazzur: realm('Tazzur', '#9c6fb6', 'The temple-cities of the mountains and coasts of eastern Saruun.'),
    ilmar: realm('Ilmar', '#3f9a8f', 'The sea-kings of the great island east of the neck.'),
    draven: realm('Draven', '#a1887f', 'Free cities of the western continent, a federation in 380, an empire in 850.'),
    hrim: realm('Hrimland', '#90a4ae', 'The frost jarldoms of the north-western continent.'),
    kaimara: realm('Kaimara', '#26a69a', 'The Jade Throne of the far eastern continent, older than any realm of the west.'),
  };

  // ---------------------------------------------------------------- the Age of Crowns, 1 to 420
  const found = (name: string, when: Instant, r: string, ks: number[], about: string, group = CROWNS) => { const e = ev(name, when, null, about, group, 'founding'); take(b, e, r, null, P(...ks), null, FADE); return e; };
  found('The founding of Calvaris', Y(1, 1, 1), R.calvar, [14, 36], 'Queen Ysolde raises the first stones of Calvaris on the plains below the Spine; the Reckoning of years begins.');
  found('The clan-moot of Brannoch', Y(3, 4, 10), R.brannoch, [83, 88, 85, 91, 107, 99, 100, 52, 57, 66], 'The highland clans swear to one High Chief at Dun Brannoch.');
  found('The halls of Ormun', Y(9, 6, 1), R.ormun, [53, 59, 77, 84], 'The mountain folk cut the first halls of Ormunhold into the Spine.');
  found('Kessrin founded', Y(12, 3, 3), R.kessrin, [125], 'Merchants exiled from Calvar found Kessrin on the neck of land between the continents.');
  found('The first Sun King of Ammaru', Y(20, 5, 21), R.ammaru, [238, 239, 240, 255, 265, 266, 243, 271], 'Ammaru\'s lowland cities crown one king, the Sun King, at Ammar.');
  found('The temple-cities of Tazzur', Y(25, 8, 2), R.tazzur, [177, 195, 203, 234, 244, 258, 218, 241], 'The temple-cities of eastern Saruun unite under the high priests of Tazz.');
  found('The kingdom of Aurel', Y(30, 2, 14), R.aurel, [103, 101, 102, 92, 117, 113], 'Aurel is founded on the sunward coast; its kings build Aurelis by the Middle Sea.');
  found('The sea-kings of Ilmar', Y(35, 7, 7), R.ilmar, [168, 169, 163, 172, 164, 185, 192, 208, 198, 199, 193, 216, 229, 230, 245], 'The island\'s chiefs take one sea-king at Ilmarin.');
  ev('The first Harvest Fair of Calvaris', Y(5, 7, 20), Y(5, 8, 3), 'Farmers of the plains and traders from the Spine meet below the new walls; the fair is held every year after.', CROWNS);
  ev('The clans quarrel', Y(15, 9, 9), Y(17, 3, 3), 'Three clans leave the moot over the High Chief\'s cattle-tax and come back two years later.', CROWNS, 'revolution');
  const east = ev('Calvar\'s eastern march', Y(40, 5, 1), null, 'Calvar\'s knights settle the plains east of Calvaris.', CROWNS, 'conquest');
  take(b, east, R.calvar, null, P(32), null, FADE);
  ev('Queen Ysolde dies', Y(42, 10, 9), null, 'The founder of Calvar is buried under the first stones of Calvaris.', CROWNS);
  const road = ev('The Road of Kings', Y(48, 3, 1), Y(61, 3, 1), 'A road through the passes of the Spine joins Calvaris, Ormunhold and Aurelis.', CROWNS);
  feature(b, L.roads, 'The Road of Kings', [[AT.calvaris, [12.5, 49.0], AT.ormunhold, [8.0, 35.0], AT.aurelis, AT.kessrin]], road, { anim: 'draw' });
  ev('The Fen Road', Y(64, 2, 2), Y(70, 2, 2), 'Lorrin lays a road of oak across the fens to Calvaris.', CROWNS);
  ev('The first century', Y(100, 1, 1), null, 'Calvaris keeps its hundredth year; Queen Ysolde\'s granddaughter reigns.', CROWNS);
  found('Teshar founded', Y(55, 6, 6), R.teshar, [67, 65, 42, 62], 'Teshar is founded in the eastern passes, where the steppe meets the Spine.');
  found('Lorrin founded', Y(60, 1, 20), R.lorrin, [13, 31, 37, 25], 'The fen-lords of the north crown a king at Lorrinhall.');
  found('Westmarch settled', Y(70, 9, 9), R.westmarch, [82, 98, 109, 121, 131, 126], 'Settlers from Calvar and Brannoch found Westhaven on the western coast.');
  const passes = ev('The War of the Passes', Y(80, 4, 1), Y(92, 8, 1), 'Aurel and Brannoch fight twelve years for the foothills south of the highlands; Aurel keeps them.', CROWNS, 'war');
  take(b, passes, R.aurel, [R.brannoch], P(99, 100), null, FRONT);
  battle(passes, 'The Pass of Yrn', [-10.0, 27.5], Y(86, 6, 1));
  ev('The silver of Ormun', Y(133, 4, 4), null, 'Ormun\'s miners strike a vein of silver under the Spine; Ormun\'s coin is soon taken in every market.', WONDERS);
  const league = ev('The Kessrin League', Y(110, 5, 5), null, 'Kessrin and the cities of the neck form a league of merchants.', CROWNS, 'treaty');
  take(b, league, R.kessrin, null, P(122, 123, 134, 133, 140, 151), null, FADE);
  const ammS = ev('Ammaru in the south', Y(118, 2, 1), Y(124, 2, 1), 'The Sun Kings take the southern lowlands to the sea.', CROWNS, 'conquest');
  take(b, ammS, R.ammaru, null, P(286, 280, 288, 301, 270, 310), null, FRONT);
  const aurE = ev('Aurel\'s eastern shore', Y(127, 4, 4), Y(130, 4, 4), 'Aurel\'s kings settle the coast east of the Spine\'s southern foothills.', CROWNS, 'conquest');
  take(b, aurE, R.aurel, null, P(86, 94, 112), null, FRONT);
  const tazS = ev('Tazzur in the south', Y(125, 3, 3), Y(131, 3, 3), 'Tazzur\'s priests send their colonies down the eastern coast.', CROWNS, 'conquest');
  take(b, tazS, R.tazzur, null, P(261, 277, 272, 292, 294, 273), null, FRONT);
  found('The Khaganate of Uzun', Y(140, 4, 4), R.uzun, [33, 21, 22, 43, 50, 44, 63, 15, 6, 7], 'Khagan Aruk unites the clans of the eastern steppe at Uzun Ordu.');
  const raids = ev('The Uzun raids', Y(145, 1, 1), Y(160, 1, 1), 'The Khagan\'s riders fall on Teshar and take its northern valleys.', CROWNS, 'war');
  take(b, raids, R.uzun, [R.teshar], P(42), null, FRONT);
  arrow(raids, 'The Khagan\'s riders', [AT.ordu, [46.0, 49.0], [40.0, 47.0]], Y(145, 2, 1), 200, Y(161, 1, 1), '#c96a3a');
  const enmoor = ev('The Enmoor War', Y(150, 5, 1), Y(153, 5, 1), 'Calvar wins Enmoor from Lorrin.', CROWNS, 'war');
  take(b, enmoor, R.calvar, [R.lorrin], P(25), null, FRONT);
  ev('A Khagan\'s daughter for Teshar', Y(165, 6, 6), null, 'Khagan Aruk\'s daughter marries the king of Teshar, and the raids stop for a generation.', CROWNS, 'treaty');
  const gates = ev('The gates of Ormun opened', Y(175, 3, 1), null, 'Ormun opens its halls to the merchants of the plains and takes the high pastures.', CROWNS, 'treaty');
  take(b, gates, R.ormun, null, P(48, 49), null, FADE);
  const neckS = ev('The League takes the south neck', Y(190, 6, 1), null, 'Kessrin buys the cities of the southern neck from their lords.', CROWNS, 'treaty');
  take(b, neckS, R.kessrin, null, P(150, 160, 167), null, FADE);
  ev('The Great Fire of Aurelis', Y(183, 8, 1), Y(183, 8, 6), 'Half of Aurelis burns in five days; the kings rebuild it in stone.', WONDERS, 'collapse');
  ev('The Grey Cough', Y(200, 2, 1), Y(206, 2, 1), 'A plague out of the south kills a third of the people of the neck and the coasts.', WONDERS, 'collapse');
  const starfall = b.commit(cmd.addDisaster(b.world, { spaceId: b.space, disaster: 'meteor', size: 1800, windDeg: 60, at: [-8.0, -27.0], t: Y(209, 7, 14, 21), seed: 3 }));
  b.commit(cmd.updateEvent(b.world, starfall, { name: 'The Starfall of Saruun', description: 'A star falls in the south of Ammaru; its crater fills and becomes the Starmere.' }));
  b.commit(cmd.setEventGroups(b.world, starfall, [b.group(WONDERS)]));
  ev('The Treaty of the Three Rivers', Y(212, 5, 5), null, 'Calvar, Teshar and Uzun fix their borders on three rivers of the east.', CROWNS, 'treaty');
  const sunWar = ev('The Sun War', Y(230, 3, 1), Y(250, 3, 1), 'Ammaru conquers the western temple-cities of Tazzur.', CROWNS, 'war');
  take(b, sunWar, R.ammaru, [R.tazzur], P(244, 234, 258, 272), null, FRONT);
  battle(sunWar, 'The Field of Masks', [5.0, -18.0], Y(236, 6, 1));
  ev('The Shrine of the Sun', Y(221, 5, 21), null, 'The Sun Kings raise a golden shrine at Ammar on the longest day of the year.', WONDERS);
  ev('The Library of Kessrin', Y(240, 8, 8), null, 'Kessrin\'s league founds a library of every book that passes through its harbour.', WONDERS);
  const venn = ev('The voyage of Odo Venn', Y(258, 4, 1), Y(262, 6, 1), 'Odo Venn sails west from Kessrin past the edge of every chart and finds a continent beyond the Western Sea.', CROWNS);
  arrow(venn, 'Odo Venn\'s voyage', [AT.kessrin, [-10.0, 12.0], [-28.0, 13.0], AT.portVenn], Y(258, 4, 1), 330, Y(264, 1, 1), '#e3a33a');
  ev('Odo Venn\'s chart', Y(266, 3, 3), null, 'The League prints Odo Venn\'s chart of the Western Sea; every harbour of the Middle Sea wants a copy.', WONDERS);
  const pv = ev('Port Venn', Y(275, 5, 1), null, 'Kessrin plants a trading colony where Odo Venn landed.', CROWNS, 'founding');
  take(b, pv, R.kessrin, null, P(138), null, FADE);
  city(b, 'Port Venn', AT.portVenn, Y(275, 5, 1));
  found('The free cities of Draven', Y(290, 1, 1), R.draven, [97, 120, 136, 139, 135, 153, 149, 171], 'The coastal cities of the western continent league against the colonists.');
  ev('The clan war of Brannoch', Y(285, 4, 4), Y(289, 4, 4), 'Two High Chiefs are chosen at one moot; the clans fight four years before one of them dies.', CROWNS, 'war');
  const union = ev('The Union of the Crowns', Y(300, 6, 21), null, 'King Aldric of Calvar marries Queen Mereth of Lorrin; their realms become one.', CROWNS, 'treaty');
  annex(b, union, R.calvar, ['Lorrin'], null, FADE);
  found('The frost jarls', Y(310, 3, 1), R.hrim, [1, 17, 26, 27, 10, 30, 40], 'The jarls of the north-western continent swear to one king at Hrimgard.');
  const straits = ev('The War of the Straits', Y(320, 5, 1), Y(340, 5, 1), 'Ilmar\'s fleets take the cities of the southern neck from the League.', CROWNS, 'war');
  take(b, straits, R.ilmar, [R.kessrin], P(167, 160), null, FRONT);
  arrow(straits, 'Ilmar\'s fleets', [AT.ilmarin, [22.0, 2.0], [14.0, 1.5]], Y(320, 6, 1), 120, Y(341, 1, 1), '#3f9a8f');
  ev('The Treaty of the Straits', Y(342, 2, 2), null, 'Ilmar keeps the cities of the southern neck and pays the League for them.', CROWNS, 'treaty');
  const foot = ev('Brannoch retakes the foothills', Y(330, 2, 1), Y(333, 2, 1), 'The clans win back the foothills lost in the War of the Passes.', CROWNS, 'war');
  take(b, foot, R.brannoch, [R.aurel], P(99, 100), null, FRONT);
  const tazRise = ev('Tazzur rises again', Y(350, 7, 7), Y(355, 7, 7), 'The temple-cities throw off the Sun Kings.', CROWNS, 'revolution');
  take(b, tazRise, R.tazzur, [R.ammaru], P(244, 234, 258, 272), null, FRONT);
  const wall = ev('The Wall of Teshar', Y(365, 1, 1), Y(380, 1, 1), 'Teshar walls its eastern passes against the steppe.', WONDERS);
  feature(b, L.roads, 'The Wall of Teshar', [[[41.0, 37.5], [43.0, 41.0], [44.5, 44.5], [44.0, 47.5]]], wall, { anim: 'draw', style: { color: '#9e9e9e', width: 5 } });
  ev('The Long Winter', Y(371, 10, 1), Y(374, 4, 1), 'Three winters without a summer between them; the fens freeze and the steppe clans drive their herds south.', WONDERS, 'collapse');
  const fed = ev('The Draven Federation', Y(380, 9, 9), null, 'The free cities federate under a Speaker.', CROWNS, 'founding');
  rename(b, fed, R.draven, 'Draven Federation');
  found('The Kharn Holds', Y(395, 4, 4), R.kharn, [8, 20], 'The clans round Mount Kharn swear to one chief.');
  const hrimRaid = ev('The Hrimland raid', Y(402, 5, 5), Y(402, 7, 7), 'The frost jarls\' longships raid the northern coasts of Calvar and Lorrin.', CROWNS, 'war');
  arrow(hrimRaid, 'The jarls\' longships', [AT.hrimgard, [-35.0, 60.0], [-14.0, 57.0], [-4.0, 55.0]], Y(402, 5, 5), 30, Y(403, 1, 1), '#90a4ae');
  ev('The Red Star', Y(418, 10, 10), Y(419, 2, 1), 'A red comet burns in the north-eastern sky for a hundred nights. The priests of Ormun call it an omen.', WONDERS);
  return { realm: R, mainEnd: Y(1000, 11, 5), branch: '' };
}

/** The Age of Embers and the Age of Concord, and the branch in which the west is lost. */
function ember(b: Builder, provinces: Province[], s: Story): void {
  const P = (...ks: number[]) => ks.map((k) => ({ name: provinces[k].name, polygons: provinces[k].polygons }));
  const EMBERS = 'The Age of Embers', CONCORD = 'The Age of Concord', WONDERS = 'Wonders and disasters';
  const ev = (name: string, start: Instant, end: Instant | null, about: string, group: string, type = 'general') => event(b, name, start, end, { about, group, type });
  const R = s.realm;
  const L = { moves: b.world.all('layer').find((l) => l.name === 'Campaigns and voyages')!.id, fights: b.world.all('layer').find((l) => l.name === 'Battles')!.id };
  const arrow = (eventId: string, name: string, route: Place[], at: Instant, days: number, until: Instant, color = '#c0392b') =>
    feature(b, L.moves, name, [route], eventId, { at, animUntil: later(at, days), until, style: { color } });
  const battle = (eventId: string, name: string, place: Place, when: Instant, days = 3 * 335) =>
    feature(b, L.fights, name, [[place]], eventId, { at: when, anim: 'grow', animUntil: later(when, 30), until: later(when, days) });
  const disaster = (kind: 'volcano' | 'wildfire' | 'flood', name: string, about: string, at: Place, t: Instant, size: number, windDeg = 90) => {
    const id = b.commit(cmd.addDisaster(b.world, { spaceId: b.space, disaster: kind, size, windDeg, at, t, seed: 11 }));
    b.commit(cmd.updateEvent(b.world, id, { name, description: about }));
    b.commit(cmd.setEventGroups(b.world, id, [b.group(WONDERS)]));
    return id;
  };

  // ---------------------------------------------------------------- the Age of Embers, 421 to 780
  const kindling = ev('The Kindling', Y(421, 1, 1), null, 'Morcant, a smith-priest of the Kharn Holds, kindles a fire in the mountain that does not go out: the Ember. The Holds kneel to him.', EMBERS, 'revolution');
  rename(b, kindling, R.kharn, 'The Ember Holds');
  disaster('volcano', 'Mount Kharn wakes', 'The fire-mountain erupts for the first time in memory; Morcant says the Ember has woken it.', AT.kharn, Y(430, 5, 5), 6, 120);
  ev('The ash winter', Y(430, 7, 1), Y(431, 5, 1), 'Ash from Mount Kharn darkens the summer; the harvests of the steppe fail and the clans go hungry.', WONDERS, 'collapse');
  const bows = ev('The Khagan bows', Y(445, 3, 3), Y(446, 3, 3), 'Khagan Temur kneels to Morcant at Uzun Ordu; the steppe and the mountain become the Ember Dominion.', EMBERS, 'conquest');
  annex(b, bows, R.kharn, ['Uzun'], null, FRONT);
  rename(b, bows, R.kharn, 'The Ember Dominion');
  const teshar = ev('The conquest of Teshar', Y(450, 5, 1), Y(470, 5, 1), 'The Dominion breaks the Wall of Teshar and takes its passes one by one.', EMBERS, 'war');
  take(b, teshar, R.kharn, [R.teshar], P(67, 65, 62), null, FRONT);
  arrow(teshar, 'The Ember host', [AT.ordu, [48.0, 46.0], [41.5, 43.5], AT.teshar], Y(450, 6, 1), 400, Y(471, 1, 1));
  battle(teshar, 'The breaking of the Wall', [43.5, 43.0], Y(452, 7, 7));
  ev('The flight from Teshar', Y(455, 4, 4), Y(460, 4, 4), 'Thousands flee the passes for Calvar and Ormun ahead of the Ember\'s host.', EMBERS);
  ev('Calvar and Ormun allied', Y(480, 2, 2), null, 'King Hadric of Calvar and the Stonelord of Ormun swear to stand together against the Ember.', EMBERS, 'treaty');
  const spire = ev('The Ember Spire', Y(490, 3, 3), Y(497, 3, 3), 'Morcant raises a black tower on the flank of Mount Kharn, over the fire he kindled.', WONDERS);
  city(b, 'The Ember Spire', [39.5, 60.8], Y(497, 3, 3));
  void spire;
  // The forest burns all summer: fire after fire set along it, each spreading downwind.
  const greenwood = ev('The Burning of the Greenwood', Y(500, 5, 15), Y(500, 8, 20), 'The Dominion\'s fire-priests set the great forest east of Calvaris alight; it burns for a summer.', WONDERS, 'collapse');
  for (const [i, [at, t]] of ([[AT.greenwood, Y(500, 5, 15)], [[28.0, 55.5], Y(500, 5, 30)], [[24.0, 53.0], Y(500, 6, 12)], [[27.0, 52.5], Y(500, 6, 26)], [[22.5, 55.0], Y(500, 7, 8)], [[25.0, 56.5], Y(500, 7, 22)]] as Array<[Place, Instant]>).entries()) {
    b.commit(cmd.addDisaster(b.world, { spaceId: b.space, disaster: 'wildfire', size: 220, windDeg: 250, at, t, eventId: greenwood, seed: 20 + i }));
  }
  const eastWar = ev('The Eastern War', Y(500, 6, 1), Y(530, 6, 1), 'Thirty years of war on Calvar\'s eastern plains; the Dominion takes them to the Ashfields.', EMBERS, 'war');
  take(b, eastWar, R.kharn, [R.calvar], P(32), null, FRONT);
  arrow(eastWar, 'The Dominion\'s march west', [[40.0, 55.0], [32.0, 54.0], [26.0, 53.0]], Y(501, 1, 1), 700, Y(531, 1, 1));
  const ford = ev('The Battle of Irarin Ford', Y(515, 6, 6), null, 'Calvar\'s knights hold the ford for a day and a night; the Dominion crosses upstream.', EMBERS, 'war');
  battle(ford, 'Irarin Ford', [27.5, 54.5], Y(515, 6, 6));
  ev('Vasharra wakes', Y(540, 4, 1), null, 'The last of the old dragons, Vasharra, wakes under Mount Kharn and flies for Morcant.', EMBERS);
  const elthas = ev('The burning of Elthas', Y(545, 8, 8), null, 'Vasharra burns the eastern towns of Calvar in a night.', EMBERS, 'war');
  battle(elthas, 'Elthas', [18.5, 50.0], Y(545, 8, 8));
  const ormunSiege = ev('The siege of Ormunhold', Y(560, 3, 1), Y(562, 3, 1), 'Two years under the mountain; the Stonelord\'s halls hold.', EMBERS, 'war');
  battle(ormunSiege, 'Ormunhold', AT.ormunhold, Y(560, 3, 1), 700);
  ev('Aurel\'s fleet lost', Y(575, 6, 6), null, 'A storm, or the Ember\'s priests, sink Aurel\'s fleet off the neck.', EMBERS, 'collapse');
  ev('The prophecy of the Thornwood', Y(590, 9, 9), null, 'A seer of Lorrin foretells that a forester\'s child will put out the Ember.', EMBERS);
  // The neck of land sinks: the Sundering (the sea over it from that day, in the planet's heights).
  const sundering = ev('The Sundering of the Neck', Y(600, 2, 1), Y(601, 2, 1), 'In one winter the land between the continents sinks; the sea runs over the middle of the neck, and the League\'s cities there are drowned. North and south are no longer joined by land.', WONDERS, 'collapse');
  b.commit(cmd.addTerrainStamp(b.world, b.space, { tool: 'sea', path: [[-8.0, 6.0], [-2.0, 6.6], [4.0, 7.5], [10.0, 8.0], [16.0, 8.5], [22.0, 9.0]], radiusKm: 160, strength: 120, seed: 5, from: Y(600, 2, 1) }));
  void sundering;
  ev('The exodus from the neck', Y(602, 3, 1), Y(610, 3, 1), 'The League\'s people leave the drowned cities for Kessrin and the southern shore.', EMBERS);
  const flood = disaster('flood', 'The flood of the Ammar delta', 'The sea, risen after the Sundering, floods the Ammar delta.', [-14.0, -12.5], Y(603, 4, 4), 9);
  void flood;
  const lorrinWar = ev('The War of the Fens', Y(620, 5, 1), Y(650, 5, 1), 'The Dominion takes the fens of the north.', EMBERS, 'war');
  take(b, lorrinWar, R.kharn, [R.calvar], P(13), null, FRONT);
  const lorrinhall = ev('The fall of Lorrinhall', Y(633, 3, 3), null, 'The old capital of Lorrin is taken and burned.', EMBERS, 'war');
  battle(lorrinhall, 'Lorrinhall', AT.lorrinhall, Y(633, 3, 3));
  ev('Teshar rises and is crushed', Y(660, 6, 6), Y(662, 6, 6), 'A rising in the passes is put down; the towns of Teshar are emptied.', EMBERS, 'revolution');
  ev('Aelin Thornwood born', Y(680, 7, 7), null, 'Aelin, the son of a forester of Lorrin\'s marches, is born in the fens the Dominion holds.', EMBERS);
  ev('Princess Imryth born', Y(696, 3, 21), null, 'A daughter is born to King Hadric III of Calvar.', EMBERS);
  ev('The Alliance of the West', Y(700, 5, 5), null, 'Calvar, Brannoch, Ormun, Aurel, Westmarch, Kessrin, Ammaru, Tazzur and Ilmar swear the Oath of the West at Aurelis.', EMBERS, 'treaty');
  ev('Aelin joins the Wardens', Y(705, 5, 5), null, 'Aelin, a boy of twenty-five winters, joins the Wardens who scout the Dominion\'s border.', EMBERS);
  const north = ev('The War of the North', Y(712, 4, 1), Y(720, 4, 1), 'The Dominion takes Ostmark and comes within sight of Calvaris.', EMBERS, 'war');
  take(b, north, R.kharn, [R.calvar], P(14), null, FRONT);
  const siege = ev('The siege of Calvaris', Y(738, 9, 1), Y(741, 4, 1), 'Calvaris is besieged for nineteen months; Vasharra burns the outer city.', EMBERS, 'war');
  battle(siege, 'Calvaris', AT.calvaris, Y(738, 9, 1), 1100);
  const relief = ev('The relief of Calvaris', Y(741, 4, 1), Y(741, 4, 4), 'The clans of Brannoch and Aurel\'s knights break the siege lines from the south.', EMBERS, 'war');
  arrow(relief, 'The relief of Calvaris', [AT.ormunhold, [12.0, 49.0], AT.calvaris], Y(741, 3, 20), 12, Y(742, 1, 1), '#4a78c2');
  const ash = ev('The Battle of the Ashfields', Y(745, 6, 15, 6), Y(745, 6, 16, 18), 'Aelin Thornwood and Princess Imryth lead the Alliance against the Dominion\'s host on the burnt plains; Vasharra is driven off and the host breaks.', EMBERS, 'war');
  battle(ash, 'The Ashfields', AT.ashfields, Y(745, 6, 15, 6), 1200);
  const liberation = ev('The Liberation', Y(746, 1, 1), Y(770, 1, 1), 'The Alliance drives the Dominion back to its mountains: Calvar takes back its plains and fens, Teshar rises again.', EMBERS, 'war');
  take(b, liberation, R.calvar, [R.kharn], P(14, 32, 13), null, FRONT);
  take(b, liberation, R.teshar, [R.kharn], P(67, 65, 62, 42), Y(755, 1, 1), FRONT);
  arrow(liberation, 'The Alliance\'s march east', [AT.ashfields, [30.0, 53.0], [36.0, 50.0], [42.0, 50.0]], Y(746, 2, 1), 2000, Y(771, 1, 1), '#4a78c2');
  ev('Teshar restored', Y(760, 6, 6), null, 'The king of Teshar returns to his passes.', EMBERS, 'founding');
  const quest = ev('The quest for the Ember Spire', Y(772, 3, 1), Y(775, 9, 9), 'Aelin and four companions climb Mount Kharn to put out the Ember at its heart.', EMBERS);
  const quench = ev('The Quenching of the Ember', Y(775, 9, 9, 3), null, 'The fire in the mountain goes out. Morcant falls with it, and Vasharra flies south and is not seen again.', EMBERS, 'collapse');
  void quest;
  const breakup = ev('The Dominion breaks apart', Y(776, 1, 1), Y(780, 1, 1), 'The clans of the steppe choose a Khagan again; the mountains round Kharn are left to the ash.', EMBERS, 'collapse');
  take(b, breakup, R.uzun, [R.kharn], P(33, 21, 22, 43, 50, 44, 63, 15, 6, 7), null, FRONT);
  clear(b, breakup, [R.kharn], P(8, 20), { at: Y(778, 1, 1), transition: FADE });
  void quench;

  // ---------------------------------------------------------------- the Age of Concord, 781 to 1000
  const crowned = ev('Imryth crowned', Y(781, 1, 1), null, 'Imryth is crowned Queen of Calvar and Lorrin at Calvaris, and the Concord of Crowns is sworn: no realm of the west will make war on another.', CONCORD, 'treaty');
  rename(b, crowned, R.calvar, 'Calvar and Lorrin');
  ev('The first Council of the Concord', Y(790, 6, 21), null, 'The crowned heads of the west meet at Aurelis, as they will every ten years.', CONCORD, 'treaty');
  ev('Ormun rebuilt', Y(800, 5, 5), Y(815, 5, 5), 'The Stonelord\'s halls are cut again where the siege broke them.', CONCORD);
  const ks = ev('Kessrin-across-the-Water', Y(812, 6, 6), null, 'The League is founded again on both shores of the Sundered Strait.', CONCORD, 'founding');
  take(b, ks, R.kessrin, [R.ilmar], P(167, 160), null, FADE);
  ev('The Bridge of Kessrin', Y(822, 4, 4), Y(828, 4, 4), 'The League builds a bridge of ships across the narrowest part of the Sundered Strait.', WONDERS);
  const holt = ev('The voyage of Senna Holt', Y(830, 3, 1), Y(836, 9, 1), 'Senna Holt of Kessrin sails east past Ilmar and the edge of the charts to the Jade Throne of Kaimara.', CONCORD);
  arrow(holt, 'Senna Holt\'s voyage', [AT.kessrin, [10.0, 6.0], [30.0, 2.0], [60.0, 8.0], [90.0, 18.0], AT.kaimar], Y(830, 3, 1), 1800, Y(838, 1, 1), '#e3a33a');
  const kai = ev('The Jade Throne', Y(836, 9, 1), null, 'Kaimara, whose emperors have kept records for three thousand years, receives the first ship from the west.', CONCORD, 'founding');
  take(b, kai, R.kaimara, null, P(104, 105, 110, 111, 106, 93, 115, 119, 124, 165, 166, 170, 186, 187, 189, 204, 212, 221, 222), null, FADE);
  ev('An embassy from Kaimara', Y(840, 5, 5), null, 'Envoys of the Jade Throne come to Calvaris with silk, tea and a map of the world.', CONCORD, 'treaty');
  ev('Tea in the west', Y(845, 5, 5), null, 'Kaimaran tea is drunk in Calvaris; the League\'s ships make the voyage east every year.', CONCORD);
  const empire = ev('The Draven Empire', Y(850, 1, 1), Y(868, 1, 1), 'The Speaker of Draven crowns himself emperor and conquers the west of the continent.', CONCORD, 'conquest');
  rename(b, empire, R.draven, 'Draven Empire');
  take(b, empire, R.draven, null, P(96, 116, 118, 132, 142, 147, 156, 158, 159, 176, 180, 184, 188, 191, 200, 201, 202, 207, 210, 213, 215, 220, 227, 228, 231, 235, 237, 246, 247, 257, 268), null, FRONT);
  const colonial = ev('The Colonial War', Y(870, 3, 3), Y(880, 3, 3), 'Draven takes Port Venn from the League.', CONCORD, 'war');
  take(b, colonial, R.draven, [R.kessrin], P(138), null, FRONT);
  ev('Hrimland joins the Concord', Y(890, 6, 21), null, 'The frost king swears the Concord at Calvaris.', CONCORD, 'treaty');
  ev('The printing house of Kessrin', Y(912, 2, 2), null, 'Kessrin\'s printers set books in movable type; the Library\'s books are copied for every realm.', WONDERS);
  ev('The University of Aurelis', Y(904, 2, 2), null, 'Aurel\'s kings found a university open to scholars of every realm.', WONDERS);
  const succession = ev('The Uzun succession', Y(921, 4, 4), Y(925, 4, 4), 'Two khans divide the steppe; the western clans join Teshar.', CONCORD, 'war');
  take(b, succession, R.teshar, [R.uzun], P(33, 43), null, FRONT);
  ev('The steppe fever', Y(935, 6, 6), Y(938, 6, 6), 'A fever kills a fifth of the steppe clans.', WONDERS, 'collapse');
  ev('Vasharra seen in the south', Y(950, 6, 6), null, 'Sailors from Ammaru see a dragon over the ice of the far south.', WONDERS);
  ev('The High Chief of all the clans', Y(970, 4, 10), null, 'For the first time every clan of Brannoch votes at the moot, not only the chiefs.', CONCORD);
  ev('The thousandth year', Y(1000, 1, 1), null, 'The realms of the Concord keep the thousandth year of the Reckoning at Calvaris.', CONCORD);

  // ---------------------------------------------------------------- another history: the Ashfields lost
  const br = b.commit(cmd.createBranch(b.world, { name: 'The Ember Ascendant', from: Y(745, 6, 15, 5), notes: 'What if the Battle of the Ashfields had been lost?', color: '#c0392b' }));
  const main = b.world.branch;
  b.useBranch(br);
  const lost = ev('The Ashfields lost', Y(745, 6, 15, 6), Y(745, 6, 16, 18), 'Vasharra breaks the Alliance\'s line; Aelin falls and Imryth is taken.', EMBERS, 'war');
  battle(lost, 'The Ashfields', AT.ashfields, Y(745, 6, 15, 6), 1200);
  const burn = ev('Calvaris burns', Y(746, 2, 2), Y(746, 4, 4), 'The Dominion takes Calvaris and burns it.', EMBERS, 'conquest');
  take(b, burn, R.kharn, [R.calvar], P(36, 25, 31, 37), null, FRONT);
  const west = ev('The Ember takes the west', Y(750, 1, 1), Y(762, 1, 1), 'Ormun, Brannoch, Aurel and Westmarch fall one by one.', EMBERS, 'conquest');
  take(b, west, R.kharn, [R.ormun, R.brannoch, R.aurel, R.westmarch, R.teshar], P(53, 59, 77, 84, 48, 49, 83, 88, 85, 91, 107, 99, 100, 52, 57, 66, 103, 101, 102, 92, 117, 113, 86, 94, 112, 82, 98, 109, 121, 131, 126, 67, 65, 62, 42), null, FRONT);
  arrow(west, 'The Ember host', [AT.calvaris, AT.ormunhold, AT.aurelis, AT.brannoch, AT.westhaven], Y(750, 2, 1), 3500, Y(763, 1, 1));
  ev('Imryth in chains', Y(747, 1, 1), null, 'The princess is shown to the crowds of the Ember Spire, then not seen again.', EMBERS);
  const last = ev('The last stand at Westhaven', Y(755, 8, 8), Y(755, 8, 20), 'The Wardens hold Westhaven twelve days against the Ember host.', EMBERS, 'war');
  battle(last, 'Westhaven', AT.westhaven, Y(755, 8, 8));
  const kes = ev('Kessrin burned', Y(770, 5, 5), null, 'The League\'s city is burned with its library.', EMBERS, 'conquest');
  take(b, kes, R.kharn, [R.kessrin], P(125, 122, 123, 134, 133, 140, 151, 150, 160, 167), null, FRONT);
  const south = ev('The Ember crosses to Saruun', Y(790, 3, 3), Y(800, 3, 3), 'The Dominion\'s fleets cross the Sundered Strait; the Sun King and the high priests of Tazz submit.', EMBERS, 'conquest');
  take(b, south, R.kharn, [R.ammaru, R.tazzur], P(238, 239, 240, 255, 265, 266, 243, 271, 286, 280, 288, 301, 270, 310, 177, 195, 203, 234, 244, 258, 218, 241, 261, 277, 272, 292, 294, 273), null, FRONT);
  ev('The Long Night', Y(820, 1, 1), Y(860, 1, 1), 'Ash from the Dominion\'s forges darkens the sky of the north for forty years.', EMBERS);
  ev('The road across the strait', Y(880, 3, 3), Y(890, 3, 3), 'The Ember Throne fills the Sundered Strait with stone and builds a road on it to Saruun.', WONDERS);
  ev('Ilmar alone', Y(850, 6, 6), null, 'Ilmar\'s sea-kings are the last free realm of the old world.', EMBERS);
  const steppe = ev('The steppe breaks free', Y(980, 4, 4), Y(985, 4, 4), 'The clans of Uzun rise against the Ember Throne and win.', EMBERS, 'revolution');
  take(b, steppe, R.uzun, [R.kharn], P(33, 21, 22, 43, 50, 44, 63, 15, 6, 7), null, FRONT);
  ev('The thousandth year of the Ember', Y(1000, 1, 1), null, 'The Ember Throne keeps the thousandth year at Calvaris rebuilt in black stone.', EMBERS);
  b.useBranch(main);
  s.branch = br;
}

function heroes(b: Builder): Record<string, string> {
  const icon = (id: string, set: string) => b.commit(cmd.setEntityStyle(b.world, id, { icon: { set } }));
  const ys = journey(b, 'Queen Ysolde', [[Y(1, 1, 1), AT.calvaris]], { notes: 'Founder of Calvar.', leaves: Y(42, 10, 9) });
  icon(ys, 'crown');
  const odo = journey(b, 'Odo Venn', [[Y(258, 4, 1), AT.kessrin], [Y(258, 9, 1), [-10.0, 12.0]], [Y(259, 6, 1), [-28.0, 13.0]], [Y(260, 3, 1), AT.portVenn], [Y(261, 9, 1), AT.portVenn], [Y(262, 6, 1), AT.kessrin]], { notes: 'Captain of the League who first crossed the Western Sea.', leaves: Y(270, 1, 1) });
  icon(odo, 'sailing-ship');
  const morcant = journey(b, 'Morcant', [[Y(421, 1, 1), AT.kharn], [Y(444, 10, 20), AT.kharn], [Y(445, 3, 3), AT.ordu], [Y(470, 5, 1), AT.teshar], [Y(480, 1, 1), AT.kharn], [Y(744, 10, 20), AT.kharn], [Y(745, 6, 10), [28.0, 52.0]], [Y(745, 7, 1), AT.kharn]], { notes: 'The smith-priest who kindled the Ember and made himself master of the north-east.', leaves: Y(775, 9, 9, 3) });
  icon(morcant, 'wizard');
  const dragon = journey(b, 'Vasharra', [[Y(540, 4, 1), AT.kharn], [Y(545, 8, 1), AT.kharn], [Y(545, 8, 8), [18.5, 50.0]], [Y(545, 9, 1), AT.kharn], [Y(560, 2, 20), AT.kharn], [Y(560, 3, 3), AT.ormunhold], [Y(561, 1, 1), AT.kharn], [Y(738, 8, 20), AT.kharn], [Y(738, 9, 9), AT.calvaris], [Y(739, 1, 1), AT.kharn], [Y(745, 6, 10), AT.kharn], [Y(745, 6, 15), AT.ashfields], [Y(745, 6, 20), AT.kharn], [Y(775, 9, 9), AT.kharn], [Y(776, 3, 1), [20.0, -55.0]]], { notes: 'The last of the old dragons.', leaves: Y(780, 1, 1) });
  icon(dragon, 'dragon');
  const aelin = journey(b, 'Aelin Thornwood', [[Y(700, 1, 1), AT.lorrinhall], [Y(737, 6, 1), AT.lorrinhall], [Y(738, 8, 1), AT.calvaris], [Y(745, 6, 1), AT.calvaris], [Y(745, 6, 15), AT.ashfields], [Y(771, 10, 20), AT.ashfields], [Y(772, 3, 1), [30.0, 55.0]], [Y(774, 6, 1), [35.0, 59.0]], [Y(775, 9, 9), AT.kharn], [Y(776, 2, 1), AT.calvaris]], { notes: 'A forester\'s son of Lorrin\'s marches who led the Alliance at the Ashfields and put out the Ember.', leaves: Y(831, 1, 1) });
  icon(aelin, 'person');
  const imryth = journey(b, 'Imryth of Calvar', [[Y(720, 1, 1), AT.calvaris], [Y(745, 6, 1), AT.calvaris], [Y(745, 6, 15), AT.ashfields], [Y(746, 1, 1), AT.calvaris]], { notes: 'Princess of Calvar, then queen, who rode with Aelin at the Ashfields and swore the Concord.', leaves: Y(840, 1, 1) });
  icon(imryth, 'crown');
  const senna = journey(b, 'Senna Holt', [[Y(830, 3, 1), AT.kessrin], [Y(831, 1, 1), [30.0, 2.0]], [Y(833, 1, 1), [60.0, 8.0]], [Y(835, 1, 1), [90.0, 18.0]], [Y(836, 9, 1), AT.kaimar], [Y(838, 6, 1), AT.kaimar], [Y(840, 4, 1), AT.calvaris]], { notes: 'Navigator of Kessrin who first reached Kaimara.', leaves: Y(860, 1, 1) });
  icon(senna, 'sailing-ship');
  return { aelin, imryth, morcant, dragon };
}

/** In the other history the battle is lost: Aelin falls, Imryth is taken to Kharn, Morcant sits in Calvaris. */
function branchHeroes(b: Builder, h: Record<string, string>, branch: string): void {
  const main = b.world.branch;
  b.useBranch(branch);
  const at = (entity: string, t: Instant, [lon, lat]: Place) => b.commit(cmd.placeCharacter(b.world, { spaceId: b.space, entity, lon, lat, mode: { kind: 'change', t }, arrive: 'travel' }));
  const leaves = (entity: string, t: Instant) => b.commit(cmd.characterLeaves(b.world, { spaceId: b.space, entity, mode: { kind: 'change', t } }));
  at(h.aelin, Y(745, 6, 15, 12), AT.ashfields);
  leaves(h.aelin, Y(745, 6, 16, 18));
  at(h.imryth, Y(745, 6, 15, 12), AT.ashfields);
  at(h.imryth, Y(745, 9, 1), AT.kharn);
  leaves(h.imryth, Y(760, 1, 1));
  at(h.morcant, Y(745, 6, 20), AT.ashfields);
  at(h.morcant, Y(746, 4, 4), AT.calvaris);
  at(h.dragon, Y(745, 6, 15, 12), AT.ashfields);
  at(h.dragon, Y(746, 2, 1), AT.calvaris);
  at(h.dragon, Y(770, 5, 1), AT.calvaris);
  at(h.dragon, Y(770, 5, 5), AT.kessrin);
  at(h.dragon, Y(771, 1, 1), AT.calvaris);
  at(h.dragon, Y(790, 2, 1), AT.calvaris);
  at(h.dragon, Y(791, 1, 1), AT.ammar);
  at(h.dragon, Y(800, 3, 3), AT.calvaris);
  b.useBranch(main);
}

function shots(b: Builder, s: Story): void {
  const STATS = 'Free realms: {Free realms}\nUnder the Ember: {Under the Ember}';
  b.commit(cmd.setMapStatistics(b.world, b.space, [
    stat('Free realms', 'number', 'step', [[Y(1), 1], [Y(3, 4, 10), 2], [Y(9, 6, 1), 3], [Y(12, 3, 3), 4], [Y(20, 5, 21), 5], [Y(25, 8, 2), 6], [Y(30, 2, 14), 7], [Y(35, 7, 7), 8], [Y(55, 6, 6), 9], [Y(60, 1, 20), 10], [Y(70, 9, 9), 11], [Y(140, 4, 4), 12], [Y(290, 1, 1), 13], [Y(300, 6, 21), 12], [Y(310, 3, 1), 13], [Y(395, 4, 4), 14], [Y(421, 1, 1), 13], [Y(445, 3, 3), 12], [Y(470, 5, 1), 11], [Y(755, 1, 1), 12], [Y(776, 1, 1), 13], [Y(836, 9, 1), 14]], 0),
    stat('Under the Ember', 'count', 'linear', [[Y(420), 0], [Y(421), 40e3], [Y(445), 2.2e6], [Y(470), 3.4e6], [Y(530), 5.1e6], [Y(650), 6.3e6], [Y(720), 7.4e6], [Y(745, 6, 16), 7.4e6], [Y(770), 2.1e6], [Y(776), 2.0e6], [Y(780), 0]], 0),
  ]));
  shot(b, {
    name: '1 The world of Orrun', title: 'Orrun', subtitle: 'A world of one\'s own, and a thousand years of its history', look: 'classic', projection: 'globe', precision: 'year', cities: false,
    time: [[0, Y(1)], [24, Y(420)]], camera: [[0, { lon: -40, lat: 20, zoom: 0.4 }], [24, { lon: 200, lat: 15, zoom: 0.4 }]], captions: [],
  });
  shot(b, {
    name: '2 The Age of Crowns, 1 to 420', title: 'The Age of Crowns', subtitle: 'Years 1 to 420 of the Reckoning', look: 'atlas', precision: 'year', stats: STATS, eventsBox: { groups: ['The Age of Crowns'] },
    time: [[0, Y(1)], [60, Y(420)]], camera: [[0, { lon: 12, lat: 18, zoom: 1.12 }], [60, { lon: 12, lat: 18, zoom: 1.12 }]], captions: [],
  });
  shot(b, {
    name: '3 The voyage of Odo Venn, 258 to 262', title: 'The voyage of Odo Venn', subtitle: 'Across the Western Sea', look: 'parchment', characters: true, trails: true, precision: 'month',
    time: [[0, Y(258, 3, 1)], [30, Y(262, 7, 1)]], camera: [[0, { lon: -18, lat: 16, zoom: 2.3 }], [30, { lon: -22, lat: 16, zoom: 2.3 }]], captions: [],
  });
  shot(b, {
    name: '4 The Kindling of the Ember, 418 to 480', title: 'The Kindling of the Ember', subtitle: 'Mount Kharn, years 418 to 480', look: 'wartime', characters: true, precision: 'month', eventsBox: { groups: ['The Age of Embers', 'Wonders and disasters'] },
    time: [[0, Y(418, 1, 1)], [8, Y(430, 4, 20)], [14, Y(430, 8, 1)], [40, Y(480, 1, 1)]], camera: [[0, { lon: 45, lat: 54, zoom: 2.7 }], [8, { lon: 41, lat: 58, zoom: 3.6 }], [14, { lon: 41, lat: 58, zoom: 3.6 }], [22, { lon: 45, lat: 52, zoom: 2.6 }], [40, { lon: 45, lat: 52, zoom: 2.6 }]], captions: [],
  });
  shot(b, {
    name: '5 The Burning of the Greenwood, 500', title: 'The Burning of the Greenwood', subtitle: 'Summer of the year 500', look: 'atlas', precision: 'day', eventsBox: { groups: ['Wonders and disasters', 'The Age of Embers'] },
    time: [[0, Y(500, 5, 10)], [30, Y(500, 9, 1)]], camera: [[0, { lon: 24, lat: 54, zoom: 3.4 }], [30, { lon: 23, lat: 54, zoom: 3.3 }]], projection: 'mercator', captions: [],
  });
  shot(b, {
    name: '6 The Sundering of the Neck, 600', title: 'The Sundering of the Neck', subtitle: 'The year 600', look: 'atlas', precision: 'month', eventsBox: { groups: ['Wonders and disasters'] },
    time: [[0, Y(599, 6, 1)], [10, Y(600, 1, 20)], [22, Y(601, 3, 1)], [30, Y(604, 1, 1)]], camera: [[0, { lon: 6, lat: 8, zoom: 3.4 }], [30, { lon: 6, lat: 7, zoom: 3.6 }]], projection: 'mercator', captions: [],
  });
  shot(b, {
    name: '7 Calvaris and the Ashfields, 735 to 781', title: 'The siege of Calvaris and the Ashfields', subtitle: 'Years 735 to 781', look: 'wartime', characters: true, trails: true, precision: 'month', stats: STATS, eventsBox: { groups: ['The Age of Embers', 'The Age of Concord'] },
    time: [[0, Y(735, 1, 1)], [12, Y(744, 10, 20)], [22, Y(745, 7, 1)], [45, Y(781, 2, 1)]], camera: [[0, { lon: 24, lat: 54, zoom: 3.0 }], [22, { lon: 22, lat: 53, zoom: 3.3 }], [45, { lon: 30, lat: 54, zoom: 2.6 }]], captions: [],
  });
  shot(b, {
    name: '8 Another history: the Ember Ascendant, 740 to 1000', title: 'Another history: the Ember Ascendant', subtitle: 'If the Ashfields had been lost', look: 'wartime', characters: true, precision: 'year', branch: s.branch, eventsBox: { groups: ['The Age of Embers'] },
    time: [[0, Y(740)], [45, Y(1000, 11, 1)]], camera: [[0, { lon: 15, lat: 24, zoom: 1.2 }], [45, { lon: 15, lat: 18, zoom: 1.12 }]], captions: [],
  });
  shot(b, {
    name: '9 A thousand years of Orrun', title: 'A thousand years of Orrun', subtitle: 'The Ages of Crowns, Embers and Concord', look: 'atlas', precision: 'year', stats: STATS, eventsBox: { groups: ['The Age of Crowns', 'The Age of Embers', 'The Age of Concord', 'Wonders and disasters'] },
    time: [[0, Y(1)], [120, Y(1000, 11, 1)]], camera: [[0, { lon: 12, lat: 18, zoom: 1.12 }], [120, { lon: 12, lat: 18, zoom: 1.12 }]], captions: [],
  });
}
