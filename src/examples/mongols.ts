// The Mongol Empire, 1206 to 1405 (D177): an example project across a continent. One map of the Earth in an atlas's
// colours and the Julian calendar; the states of Eurasia in 1206 from today's countries and provinces; then the
// conquests province by province (northern China, Khwarazm, the Rus', Hungary occupied and given up, Baghdad,
// Syria won and lost at Ain Jalut, the Song), the empire splitting into four khanates, the Ilkhanate falling apart,
// the Ming driving the Yuan out of China, Lithuania and Moscow rising, and Timur's conquests to his death in 1405;
// campaigns as arrows drawing themselves, battles, capitals founded, travellers on their journeys (Marco Polo,
// William of Rubruck, Ibn Battuta), the lands under Mongol rule counted, and nine shots.
import type { ProjectRegistry } from '../server/projects.ts';
import * as cmd from '../domain/commands.ts';
import { CALENDAR_TEMPLATES, calendarOf } from '../core-time/custom-calendar.ts';
import type { Instant } from '../core-time/index.ts';
import type { TransitionSpec } from '../temporal-engine/engine.ts';
import { startProject, event, take, startWith, annex, rename, featureLayer, feature, city, journey, stat, shot, outline, later, type Builder, type Place } from './kit.ts';

const JULIAN = CALENDAR_TEMPLATES.find((t) => t.id === 'julian')!.def;
const JC = calendarOf(JULIAN);
/** A moment in the Julian calendar. */
export const J = (year: number, month = 1, day = 1, hour = 0): Instant => JC.fromCivil({ year, month, day, hour });

const P = {
  onon: [110.7, 48.8], karakorum: [102.83, 47.2], zhongdu: [116.39, 39.91], kaifeng: [114.31, 34.8], yinchuan: [106.27, 38.47], liupan: [106.2, 35.6],
  otrar: [68.3, 42.85], bukhara: [64.42, 39.77], samarkand: [66.96, 39.65], urgench: [59.15, 42.32], merv: [61.84, 37.66], nishapur: [58.8, 36.21],
  herat: [62.2, 34.35], balkh: [66.9, 36.76], indus: [71.6, 33.9], tabriz: [46.29, 38.08], maragheh: [46.24, 37.39], derbent: [48.29, 42.06],
  kalka: [37.6, 47.5], ryazan: [39.74, 54.63], vladimir: [40.4, 56.13], moscow: [37.62, 55.75], novgorod: [31.27, 58.52], kiev: [30.52, 50.45],
  legnica: [16.16, 51.21], mohi: [20.98, 47.98], sarai: [47.07, 46.62], alamut: [50.58, 36.44], baghdad: [44.37, 33.31], aleppo: [37.16, 36.2],
  damascus: [36.29, 33.51], ainJalut: [35.38, 32.55], koseDag: [38.7, 40.0], dali: [100.16, 25.6], shangdu: [116.18, 42.36], dadu: [116.39, 39.91],
  xiangyang: [112.14, 32.04], hangzhou: [120.16, 30.27], yamen: [113.07, 22.24], hakata: [130.4, 33.6], happo: [128.57, 35.18], ningbo: [121.55, 29.87],
  hanoi: [105.85, 21.03], bachDang: [106.8, 20.9], kunming: [102.71, 25.04], pagan: [94.86, 21.17], quanzhou: [118.59, 24.9], tuban: [112.05, -6.9],
  venice: [12.32, 45.44], acre: [35.07, 32.93], hormuz: [56.45, 27.1], kashgar: [75.99, 39.47], dunhuang: [94.66, 40.14], constantinople: [28.97, 41.01],
  caffa: [35.38, 45.03], kulikovo: [38.66, 53.65], kesh: [66.83, 39.06], isfahan: [51.67, 32.65], terek: [45.69, 43.32], delhi: [77.21, 28.61],
  ankara: [32.85, 39.93], tangier: [-5.8, 35.77], mecca: [39.83, 21.42], almaliq: [80.86, 43.94], kaesong: [126.55, 37.97], ganghwa: [126.49, 37.75],
  shiraz: [52.53, 29.59], yehuling: [114.9, 40.6], hulunbuir: [119.7, 49.2], blueWaters: [30.05, 48.4], nanjing: [118.8, 32.06], diaoyu: [106.28, 30.0],
  rome: [12.5, 41.9], lyon: [4.83, 45.76],
} satisfies Record<string, Place>;

/** Provinces of today's China, Russia, Ukraine and Kazakhstan, as the lands of 1206 lay. */
const CN = {
  jin: ['Beijing', 'Tianjin', 'Hebei', 'Shanxi', 'Shandong', 'Henan', 'Shaanxi', 'Liaoning', 'Jilin', 'Heilongjiang', 'Inner Mongol'],
  xia: ['Ningxia', 'Gansu'],
  song: ['Jiangsu', 'Anhui', 'Zhejiang', 'Shanghai', 'Jiangxi', 'Fujian', 'Hubei', 'Hunan', 'Guangdong', 'Guangxi', 'Sichuan', 'Chongqing', 'Guizhou', 'Hainan'],
};
const RU = {
  siberia: ['Tuva', 'Khakass', 'Gorno-Altay', 'Buryat'],
  northEast: ['Moskovskaya', 'Moskva', 'Vladimir', 'Ryazan\'', 'Tver\'', 'Yaroslavl\'', 'Kostroma', 'Ivanovo', 'Nizhegorod', 'Kaluga', 'Tula'],
  north: ['Novgorod', 'Pskov', 'Leningrad', 'City of St. Petersburg', 'Vologda', 'Smolensk', 'Bryansk', 'Orel', 'Kursk'],
  volgaBulgaria: ['Tatarstan', 'Chuvash', 'Ul\'yanovsk', 'Samara', 'Mariy-El', 'Udmurt'],
  steppe: ['Rostov', 'Krasnodar', 'Volgograd', 'Astrakhan\'', 'Kalmyk', 'Stavropol\'', 'Saratov', 'Orenburg', 'Adygey', 'Crimea', 'Sevastopol', 'Penza', 'Voronezh', 'Belgorod', 'Lipetsk', 'Tambov', 'Bashkortostan', 'Mordovia'],
};
const UA = {
  rus: ['Kiev', 'Kiev City', 'Chernihiv', 'Zhytomyr', 'Volyn', 'Rivne', 'L\'viv', 'Ternopil\'', 'Khmel\'nyts\'kyy', 'Vinnytsya', 'Cherkasy', 'Poltava', 'Sumy', 'Kharkiv', 'Ivano-Frankivs\'k', 'Chernivtsi'],
  steppe: ['Donets\'k', 'Luhans\'k', 'Zaporizhzhya', 'Dnipropetrovs\'k', 'Kherson', 'Mykolayiv', 'Odessa', 'Kirovohrad'],
};
const KZ = {
  steppe: ['West Kazakhstan', 'Atyrau', 'Aqtöbe', 'Mangghystau', 'Qostanay', 'Aqmola', 'Astana', 'North Kazakhstan', 'Pavlodar', 'Qaraghandy'],
  qaraKhitai: ['Almaty', 'Almaty City', 'Zhambyl', 'East Kazakhstan'],
  khwarazm: ['South Kazakhstan', 'Qyzylorda'],
};
const AF_NORTH = ['Balkh', 'Kunduz', 'Takhar', 'Badakhshan', 'Baghlan', 'Samangan', 'Jawzjan', 'Faryab', 'Sari Pul'];

/** Where the Uyghurs of Qocho lived: the eastern Tian Shan, Turpan, Beshbalik and Hami. */
const UYGHURS: Array<[number, number]> = [[86.2, 43.9], [87.6, 44.9], [89.8, 45.3], [92.2, 45.0], [94.3, 44.2], [96.0, 42.9], [96.3, 41.6], [94.8, 40.9], [92.6, 41.2], [90.2, 41.9], [88.1, 42.2], [86.6, 42.9]];

const SLOW: TransitionSpec = { style: 'border', easing: 'smooth' };
const FADE: TransitionSpec = { style: 'dissolve' };

export function buildMongols(reg: ProjectRegistry, dataDir: string, name = 'The Mongol Empire, 1206 to 1405 (example)') {
  const { info, b } = startProject(reg, dataDir, name);
  b.commit(cmd.setWorldBasemap(b.world, b.space, 'natural-earth'));
  b.commit(cmd.updateLayer(b.world, b.layer, { name: 'States' }));
  b.commit(cmd.setLayerClipToLand(b.world, b.layer, true));
  b.commit(cmd.setLayerLook(b.world, b.layer, { fillOpacity: 0.5, borderWidth: 1.6 }));
  b.commit(cmd.setMapCalendar(b.world, b.space, JULIAN));
  b.commit(cmd.setWorldTerrain(b.world, b.space, { palette: 'atlas', colours: true, relief: true, overTerritories: false, seaFloor: true, strength: 1.2, detail: false, photo: false, fine: true }));
  b.commit(cmd.setWorldShow(b.world, b.space, { minLakeKm2: 2000 }));
  const S = states(b);
  const L = layers(b);
  places(b);
  story(b, S, L);
  characters(b);
  shots(b);
  return info;
}

type States = Record<string, string>;

/** Eurasia in 1206. */
function states(b: Builder): States {
  const S: States = {};
  const make = (key: string, name: string, color: string, notes: string) => { S[key] = b.country(name, color); b.commit(cmd.updateEntity(b.world, S[key], { notes })); };
  make('mongol', 'Mongol Empire', '#3e6db3', 'The Yeke Mongol Ulus, proclaimed at the Onon in 1206 under Temüjin, Genghis Khan.');
  make('xia', 'Western Xia', '#a68a5b', 'The Tangut state of the Ningxia plain and the Gansu corridor.');
  make('jin', 'Jin dynasty', '#8a8a52', 'The Jurchen empire of northern China, its capital Zhongdu.');
  make('song', 'Southern Song', '#c96a3a', 'China south of the Huai, its capital Lin\'an (Hangzhou): the richest state on Earth.');
  make('dali', 'Dali', '#ba68c8', 'A Bai kingdom in Yunnan.');
  make('tibet', 'Tibet', '#90a4ae', 'Tibet, divided among its monasteries and clans.');
  make('qk', 'Qara Khitai', '#6f9e9a', 'The Western Liao, Khitans driven west from China, ruling the Tarim and the Tian Shan.');
  make('uyghur', 'Uyghurs of Qocho', '#9ccc65', 'The Uyghur kingdom around Turpan; the first to submit to Genghis Khan.');
  make('khwarazm', 'Khwarazmian Empire', '#9c6b9e', 'Shah Muhammad II\'s empire from the Aral Sea to the Persian Gulf.');
  make('nizari', 'Nizari Ismailis', '#5d4037', 'The "Assassins" of Alamut, in their mountain castles.');
  make('abbasid', 'Abbasid Caliphate', '#2f6f5f', 'The caliphate at Baghdad, five centuries old.');
  make('ayyubid', 'Ayyubids', '#b8a05a', 'The heirs of Saladin in Egypt and Syria.');
  make('rum', 'Sultanate of Rum', '#8b5e3c', 'The Seljuks of Anatolia, at Konya.');
  make('georgia', 'Kingdom of Georgia', '#c06c84', 'Georgia under Queen Tamar\'s heirs, holding Armenia and Shirvan.');
  make('cilicia', 'Cilician Armenia', '#e57373', 'The Armenian kingdom of Cilicia.');
  make('trebizond', 'Empire of Trebizond', '#c9a227', 'The Komnenoi of Trebizond, a Greek state on the Black Sea.');
  make('rus', 'Rus\' principalities', '#6c8ebf', 'The principalities of the Rus\': Kiev, Vladimir, Ryazan, Novgorod and the rest.');
  make('volga', 'Volga Bulgaria', '#7d9b4f', 'The Muslim Bulgars of the middle Volga.');
  make('cumans', 'Cumans and Kipchaks', '#cdb36a', 'The nomads of the western steppe, from the Danube to the Irtysh.');
  make('goryeo', 'Goryeo', '#5aa6a0', 'Korea under the Goryeo kings.');
  make('japan', 'Japan', '#ef7a85', 'Japan under the Kamakura shogunate.');
  make('delhi', 'Delhi Sultanate', '#9575cd', 'The Muslim sultanate of northern India.');
  make('hungary', 'Kingdom of Hungary', '#a1887f', 'Hungary under Béla IV.');
  make('poland', 'Poland', '#f48fb1', 'Poland, divided among its dukes.');
  make('daiviet', 'Đại Việt', '#ffb74d', 'Vietnam under the Trần.');
  make('pagan', 'Pagan', '#81c784', 'The kingdom of Pagan in Burma.');
  startWith(b, S.mongol, [...b.regionsOf('Mongolia')]);
  startWith(b, S.xia, b.regionsOf('China', CN.xia));
  startWith(b, S.jin, b.regionsOf('China', CN.jin));
  startWith(b, S.song, b.regionsOf('China', CN.song));
  startWith(b, S.dali, b.regionsOf('China', ['Yunnan']));
  startWith(b, S.tibet, b.regionsOf('China', ['Xizang', 'Qinghai']));
  startWith(b, S.qk, [...b.regionsOf('China', ['Xinjiang']), ...b.regionsOf('Kyrgyzstan'), ...b.regionsOf('Kazakhstan', KZ.qaraKhitai)]);
  startWith(b, S.uyghur, [outline('Qocho', UYGHURS)], [S.qk]);
  startWith(b, S.khwarazm, [...b.regionsOf('Uzbekistan'), ...b.regionsOf('Turkmenistan'), ...b.regionsOf('Tajikistan'), ...b.regionsOf('Afghanistan'), ...b.regionsOf('Iran'), ...b.regionsOf('Kazakhstan', KZ.khwarazm)]);
  startWith(b, S.nizari, b.regionsOf('Iran', ['Qazvin', 'South Khorasan']), [S.khwarazm]);
  startWith(b, S.abbasid, [...b.regionsOf('Iraq')]);
  startWith(b, S.ayyubid, ['Syria', 'Egypt', 'Jordan', 'Israel', 'Palestine', 'Lebanon'].flatMap((n) => b.regionsOf(n)));
  startWith(b, S.rum, [...b.regionsOf('Turkey')]);
  startWith(b, S.cilicia, b.regionsOf('Turkey', ['Adana', 'Mersin', 'Osmaniye']), [S.rum]);
  startWith(b, S.trebizond, b.regionsOf('Turkey', ['Trabzon', 'Rize', 'Giresun', 'Gümüshane', 'Artvin']), [S.rum]);
  startWith(b, S.georgia, ['Georgia', 'Armenia', 'Azerbaijan'].flatMap((n) => b.regionsOf(n)));
  startWith(b, S.rus, [...b.regionsOf('Russia', [...RU.northEast, ...RU.north]), ...b.regionsOf('Ukraine', UA.rus), ...b.regionsOf('Belarus')]);
  startWith(b, S.volga, b.regionsOf('Russia', RU.volgaBulgaria));
  startWith(b, S.cumans, [...b.regionsOf('Russia', RU.steppe), ...b.regionsOf('Ukraine', UA.steppe), ...b.regionsOf('Kazakhstan', KZ.steppe)]);
  startWith(b, S.goryeo, [...b.regionsOf('South Korea'), ...b.regionsOf('North Korea')]);
  startWith(b, S.japan, [...b.regionsOf('Japan')]);
  startWith(b, S.delhi, [...b.regionsOf('India', ['Delhi', 'Punjab', 'Haryana', 'Uttar Pradesh', 'Rajasthan', 'Bihar', 'Uttarakhand', 'Himachal Pradesh', 'Chandigarh']), ...b.regionsOf('Pakistan', ['Punjab', 'Sind'])]);
  startWith(b, S.hungary, [...b.regionsOf('Hungary')]);
  startWith(b, S.poland, [...b.regionsOf('Poland')]);
  startWith(b, S.daiviet, [...b.regionsOf('Vietnam')]);
  startWith(b, S.pagan, [...b.regionsOf('Myanmar')]);
  return S;
}

interface Layers { moves: string; battles: string; routes: string }

function layers(b: Builder): Layers {
  const L: Layers = {
    routes: featureLayer(b, 'Silk Roads', 'line', { color: '#7a5c2e', width: 1.6, dash: 'dashed', showName: false }),
    moves: featureLayer(b, 'Campaigns', 'line', { color: '#2b4f8f', width: 15, look: 'arrow', showName: false }),
    battles: featureLayer(b, 'Battles and sieges', 'point', { color: '#ffd23f', symbol: 'battle', size: 16, showName: true }),
  };
  // The roads of the steppe and the oases, that the Mongol peace kept open.
  b.commit(cmd.createFeature(b.world, { layerId: L.routes, name: 'The Silk Road', parts: [[[108.94, 34.34], [103.8, 36.06], P.dunhuang as [number, number], [89.19, 42.95], [80.26, 41.17], P.kashgar as [number, number], P.samarkand as [number, number], P.bukhara as [number, number], P.merv as [number, number], P.nishapur as [number, number], [51.42, 35.6], P.tabriz as [number, number], [39.72, 41.0]]], mode: { kind: 'correct', t: { day: -Infinity, ms: 0 } } }));
  b.commit(cmd.createFeature(b.world, { layerId: L.routes, name: 'The road of the steppe', parts: [[P.karakorum as [number, number], [93.0, 46.5], P.almaliq as [number, number], [76.9, 43.25], P.otrar as [number, number], P.urgench as [number, number], [51.9, 47.1], P.sarai as [number, number], [39.7, 47.2], P.caffa as [number, number]]], mode: { kind: 'correct', t: { day: -Infinity, ms: 0 } } }));
  b.commit(cmd.createFeature(b.world, { layerId: L.routes, name: 'The road to Baghdad', parts: [[P.tabriz as [number, number], [45.0, 35.5], P.baghdad as [number, number], [40.1, 34.5], P.aleppo as [number, number], [35.95, 36.35]]], mode: { kind: 'correct', t: { day: -Infinity, ms: 0 } } }));
  return L;
}

/** Capitals and cities (founded when they were). */
function places(b: Builder): void {
  const cities: Array<[string, Place, Instant?]> = [
    ['Karakorum', P.karakorum, J(1220)], ['Zhongdu', P.zhongdu], ['Kaifeng', P.kaifeng], ['Xingqing', P.yinchuan], ['Lin\'an', P.hangzhou], ['Otrar', P.otrar],
    ['Bukhara', P.bukhara], ['Samarkand', P.samarkand], ['Urgench', P.urgench], ['Merv', P.merv], ['Nishapur', P.nishapur], ['Herat', P.herat],
    ['Tabriz', P.tabriz], ['Baghdad', P.baghdad], ['Aleppo', P.aleppo], ['Damascus', P.damascus], ['Kiev', P.kiev], ['Vladimir', P.vladimir],
    ['Moscow', P.moscow], ['Novgorod', P.novgorod], ['Sarai', P.sarai, J(1242)], ['Shangdu', P.shangdu, J(1256)], ['Dadu (Khanbaliq)', [116.45, 39.95], J(1267)],
    ['Delhi', P.delhi], ['Kaesong', P.kaesong], ['Kashgar', P.kashgar], ['Almaliq', P.almaliq], ['Caffa', P.caffa], ['Konya', [32.48, 37.87]], ['Cairo', [31.24, 30.04]],
    ['Constantinople', P.constantinople], ['Thăng Long', P.hanoi], ['Kyoto', [135.76, 35.01]], ['Nanjing', P.nanjing], ['Shiraz', P.shiraz], ['Isfahan', P.isfahan],
  ];
  for (const [n, at, founded] of cities) city(b, n, at, founded);
}

function story(b: Builder, S: States, L: Layers): void {
  const RISE = 'Genghis Khan', WEST = 'The western campaigns', EAST = 'China and the east', SPLIT = 'Four khanates', TIMUR = 'Timur', TRAVEL = 'Travellers';
  for (const [g, c] of [[RISE, '#3e6db3'], [WEST, '#c0392b'], [EAST, '#c96a3a'], [SPLIT, '#d4a72c'], [TIMUR, '#2a8c8c'], [TRAVEL, '#7a5c2e']] as Array<[string, string]>) b.group(g, c);
  const ev = (name: string, start: Instant, end: Instant | null, about: string, group: string, type = 'general') => event(b, name, start, end, { about, group, type });
  /** A campaign: an arrow drawing itself along the route over the event, gone a while after. */
  const march = (eventId: string, name: string, route: Array<Place>, until: Instant, color?: string) => feature(b, L.moves, name, [route], eventId, { until, style: color ? { color } : undefined });
  /** A battle or siege: its mark from the event's start for a while. */
  const fight = (eventId: string, name: string, at: Place, when: Instant, years = 2) => feature(b, L.battles, name, [[at]], eventId, { at: when, anim: 'grow', animUntil: later(when, 20), until: later(when, 365 * years) });
  const regions = (country: string, names: string[]) => b.regionsOf(country, names);
  const M = S.mongol;

  // ---- Genghis Khan, 1206 to 1227
  ev('Genghis Khan proclaimed', J(1206, 4, 1), null, 'At a great assembly by the source of the Onon, the tribes of the steppe proclaim Temüjin Genghis Khan, "universal ruler". He orders the people into units of ten, a hundred, a thousand and ten thousand.', RISE, 'founding');
  const forest = ev('The forest peoples submit', J(1207, 3, 1), J(1208, 3, 1), 'Jochi rides north: the Oirats, the Kyrgyz of the Yenisei and the forest tribes submit.', RISE, 'conquest');
  take(b, forest, M, [''], regions('Russia', RU.siberia), null, SLOW);
  const xia1 = ev('The first war on Western Xia', J(1209, 4, 1), J(1210, 1, 1), 'The Mongols besiege Xingqing; the Tangut emperor submits, gives a daughter in marriage and promises tribute and troops.', RISE, 'war');
  march(xia1, 'Against Western Xia', [P.karakorum, [104.5, 42.5], P.yinchuan], J(1210, 6, 1));
  const uyg = ev('The Uyghurs submit', J(1209, 6, 1), null, 'The Idiqut Barchuq kills the Qara Khitai governor and offers his kingdom to Genghis Khan, who calls him his fifth son.', RISE, 'treaty');
  annex(b, uyg, M, ['Uyghurs of Qocho'], null, FADE);
  const jin1 = ev('The war on the Jin', J(1211, 3, 1), J(1211, 10, 1), 'Genghis Khan crosses the Gobi against the Jin with some 100,000 men.', RISE, 'war');
  march(jin1, 'Against the Jin', [P.onon, [113.0, 44.0], P.yehuling, [116.0, 40.2]], J(1212, 3, 1));
  const yeh = ev('Battle of Yehuling', J(1211, 9, 1), null, 'At the Badger\'s Mouth pass the Mongols destroy a Jin army many times their number.', RISE, 'war');
  fight(yeh, 'Yehuling', P.yehuling, J(1211, 9, 1));
  take(b, jin1, M, [S.jin], regions('China', ['Inner Mongol']), null, SLOW);
  const zhongdu = ev('The siege of Zhongdu', J(1214, 3, 1), J(1215, 6, 1), 'The Jin emperor makes peace and flees south to Kaifeng; the Mongols return and starve Zhongdu out. When it falls it burns for a month.', RISE, 'conquest');
  fight(zhongdu, 'Zhongdu', P.zhongdu, J(1214, 3, 1));
  take(b, zhongdu, M, [S.jin], regions('China', ['Beijing', 'Tianjin', 'Hebei']), null, SLOW);
  const muqali = ev('Muqali in the northeast', J(1216, 1, 1), J(1218, 1, 1), 'Left to finish the Jin war, Muqali takes Liaodong and the Jurchen homeland.', RISE, 'conquest');
  take(b, muqali, M, [S.jin], regions('China', ['Liaoning', 'Jilin', 'Heilongjiang']), null, SLOW);
  const qk = ev('The end of Qara Khitai', J(1218, 1, 1), J(1218, 9, 1), 'Jebe hunts down Kuchlug, who had seized Qara Khitai, promising freedom of religion; the cities open their gates and Kuchlug is killed in the Pamirs.', RISE, 'conquest');
  annex(b, qk, M, ['Qara Khitai'], null, SLOW);
  ev('The massacre at Otrar', J(1218, 6, 1), null, 'The governor of Otrar has a Mongol trade caravan of 450 men killed as spies; Shah Muhammad then kills an envoy sent to ask for justice. Genghis Khan prepares for war.', RISE, 'war');
  const kw = ev('The invasion of Khwarazm', J(1219, 9, 1), J(1220, 2, 1), 'Four armies cross the Tian Shan: one besieges Otrar for five months; Genghis Khan himself crosses the Kyzyl Kum desert to come at Bukhara from behind.', RISE, 'war');
  march(kw, 'Into Khwarazm', [P.almaliq, [72.0, 43.3], P.otrar], J(1220, 6, 1));
  march(kw, 'Across the Kyzyl Kum', [P.otrar, [66.5, 41.3], P.bukhara], J(1220, 6, 1));
  const otrar = ev('Otrar falls', J(1220, 2, 1), null, 'After five months Otrar is stormed; its governor is put to death.', RISE, 'conquest');
  fight(otrar, 'Otrar', P.otrar, J(1220, 2, 1));
  take(b, otrar, M, [S.khwarazm], regions('Kazakhstan', KZ.khwarazm), null, SLOW);
  const bukhara = ev('Bukhara and Samarkand', J(1220, 3, 1), J(1220, 4, 1), 'Bukhara surrenders and is burned; Samarkand, the shah\'s new capital, falls a month later. Transoxiana is Mongol.', RISE, 'conquest');
  fight(bukhara, 'Samarkand', P.samarkand, J(1220, 3, 15));
  take(b, bukhara, M, [S.khwarazm], [...b.regionsOf('Uzbekistan'), ...b.regionsOf('Tajikistan')], null, SLOW);
  const pursuit = ev('Jebe and Subutai pursue the shah', J(1220, 5, 1), J(1221, 1, 1), 'Muhammad II flees west across Iran with two tumens on his heels and dies on an island in the Caspian Sea.', RISE, 'war');
  march(pursuit, 'The pursuit of the shah', [P.samarkand, P.balkh, P.nishapur, [51.4, 35.6], [52.5, 37.0]], J(1221, 6, 1));
  const khorasan = ev('The cities of Khorasan', J(1221, 1, 1), J(1221, 5, 1), 'Tolui takes Merv, Nishapur and Herat; their people are killed in their hundreds of thousands. Urgench falls after the Amu Darya is turned on it.', RISE, 'conquest');
  for (const [n, at, when] of [['Merv', P.merv, J(1221, 2, 25)], ['Nishapur', P.nishapur, J(1221, 4, 10)], ['Urgench', P.urgench, J(1221, 4, 1)]] as Array<[string, Place, Instant]>) fight(khorasan, n, at, when);
  take(b, khorasan, M, [S.khwarazm], [...b.regionsOf('Turkmenistan'), ...regions('Iran', ['Razavi Khorasan', 'North Khorasan']), ...regions('Afghanistan', [...AF_NORTH, 'Hirat', 'Badghis', 'Ghor', 'Bamyan', 'Kabul', 'Parwan', 'Kapisa', 'Wardak', 'Ghazni'])], null, SLOW);
  const indus = ev('Battle of the Indus', J(1221, 11, 24), null, 'The shah\'s son Jalal ad-Din, beaten at the Indus, rides his horse off the bank into the river and swims across. Genghis Khan lets him go, admiring his courage.', RISE, 'war');
  fight(indus, 'The Indus', P.indus, J(1221, 11, 24));
  const raid = ev('The great raid', J(1221, 2, 1), J(1223, 9, 1), 'Jebe and Subutai ride round the Caspian: they crush the Georgians, cross the Caucasus by Derbent, scatter the Alans and Cumans and turn on the Rus\'.', WEST, 'war');
  march(raid, 'Jebe and Subutai\'s raid', [[52.5, 37.0], [48.5, 38.5], [45.0, 41.5], P.derbent, [44.0, 45.0], [40.0, 46.8], P.kalka, [45.0, 50.0], [50.0, 53.5], [58.0, 51.0], [66.0, 46.0]], J(1224, 6, 1));
  const kalka = ev('Battle of the Kalka River', J(1223, 5, 31), null, 'The Rus\' princes and the Cumans pursue the Mongols for nine days; at the Kalka they are routed. Captured princes are crushed under a wooden platform on which the Mongols feast.', WEST, 'war');
  fight(kalka, 'The Kalka', P.kalka, J(1223, 5, 31));
  ev('Genghis Khan returns to Mongolia', J(1225, 3, 1), null, 'Leaving governors in the conquered cities, Genghis Khan returns to the Kherlen.', RISE);
  const xia2 = ev('The destruction of Western Xia', J(1226, 2, 1), J(1227, 8, 1), 'Xia had refused troops for the war in the west. Now Genghis Khan destroys it: its cities are razed and the Tangut people all but wiped out.', RISE, 'conquest');
  march(xia2, 'The last campaign', [P.karakorum, [101.0, 41.5], [98.5, 39.7], P.yinchuan], J(1227, 10, 1));
  annex(b, xia2, M, ['Western Xia'], null, SLOW);
  ev('Genghis Khan dies', J(1227, 8, 18), null, 'Genghis Khan dies in the Liupan mountains, perhaps of a fall from his horse. He is buried in secret near Burkhan Khaldun; the place has never been found.', RISE, 'collapse');

  // ---- Ögedei, Güyük and Möngke, 1229 to 1259
  ev('Ögedei made Great Khan', J(1229, 9, 13), null, 'The kurultai chooses Genghis Khan\'s third son, as he had wished.', EAST, 'founding');
  ev('Karakorum walled', J(1235, 1, 1), null, 'Ögedei builds walls and a palace at Karakorum: the empire\'s capital, where envoys come from Europe to Korea.', EAST, 'founding');
  const jin2 = ev('The fall of the Jin', J(1231, 1, 1), J(1234, 2, 9), 'Ögedei, Tolui and Subutai take Shaanxi, Shanxi, Shandong and Henan; Kaifeng falls in 1233 and the last Jin emperor kills himself at Caizhou.', EAST, 'conquest');
  march(jin2, 'Against Kaifeng', [P.zhongdu, [113.0, 36.5], P.kaifeng], J(1234, 6, 1));
  fight(jin2, 'Kaifeng', P.kaifeng, J(1232, 4, 1));
  take(b, jin2, M, [S.jin], regions('China', ['Shaanxi', 'Shanxi']), J(1231, 6, 1), SLOW);
  annex(b, jin2, M, ['Jin dynasty'], J(1233, 5, 1), SLOW);
  const jalal = ev('Jalal ad-Din killed', J(1231, 8, 15), null, 'Chormaqan crushes the last shah of Khwarazm, who had held western Iran for ten years; he is killed by a Kurd in the mountains. Iran is Mongol.', WEST, 'conquest');
  annex(b, jalal, M, ['Khwarazmian Empire'], null, SLOW);
  const goryeo = ev('The invasions of Goryeo', J(1231, 8, 1), J(1259, 6, 1), 'Six invasions in thirty years: the court flees to Ganghwa island and holds out while the land is laid waste. In 1259 Goryeo submits.', EAST, 'war');
  march(goryeo, 'Into Goryeo', [P.zhongdu, [123.0, 41.5], [125.0, 40.0], P.kaesong], J(1233, 1, 1));
  rename(b, goryeo, S.goryeo, 'Goryeo (Mongol vassal)');
  const volga = ev('Volga Bulgaria destroyed', J(1236, 9, 1), J(1236, 12, 1), 'Batu and Subutai open the great western campaign: the city of Bilär is razed.', WEST, 'conquest');
  march(volga, 'Batu crosses the Volga', [[62.0, 48.5], [55.0, 51.0], [49.4, 54.9]], J(1237, 6, 1), '#a33a2a');
  annex(b, volga, M, ['Volga Bulgaria'], null, SLOW);
  const ne = ev('The Rus\' of the northeast', J(1237, 12, 16), J(1238, 3, 4), 'In winter, on the frozen rivers: Ryazan falls in five days, then Moscow, Vladimir and their sister cities; Grand Prince Yuri dies at the Sit River. The thaw saves Novgorod.', WEST, 'conquest');
  march(ne, 'Over the frozen rivers', [[49.4, 54.9], [45.0, 54.0], P.ryazan, P.moscow, P.vladimir, [38.0, 57.8]], J(1238, 9, 1), '#a33a2a');
  for (const [n, at, when] of [['Ryazan', P.ryazan, J(1237, 12, 21)], ['Vladimir', P.vladimir, J(1238, 2, 7)]] as Array<[string, Place, Instant]>) fight(ne, n, at, when);
  take(b, ne, M, [S.rus], regions('Russia', RU.northEast), null, SLOW);
  const cumans = ev('The Cumans broken', J(1238, 6, 1), J(1239, 12, 1), 'The steppe from the Volga to the Dnieper is swept; Khan Köten flees with 40,000 families to Hungary.', WEST, 'conquest');
  annex(b, cumans, M, ['Cumans and Kipchaks'], null, SLOW);
  const kiev = ev('The fall of Kiev', J(1240, 11, 1), J(1240, 12, 6), 'The mother of Rus\' cities is stormed and burned; years later a traveller counts barely two hundred houses.', WEST, 'conquest');
  fight(kiev, 'Kiev', P.kiev, J(1240, 12, 6));
  take(b, kiev, M, [S.rus], regions('Ukraine', UA.rus), null, SLOW);
  const europe = ev('Into Poland and Hungary', J(1241, 2, 1), J(1241, 4, 11), 'Two armies: one through Poland, burning Kraków; the other over the Carpathians into Hungary.', WEST, 'war');
  march(europe, 'Through Poland', [P.kiev, [24.0, 51.0], [19.94, 50.06], P.legnica], J(1241, 8, 1), '#a33a2a');
  march(europe, 'Into Hungary', [P.kiev, [24.5, 48.5], [22.9, 48.4], P.mohi], J(1241, 8, 1), '#a33a2a');
  const legnica = ev('Battle of Legnica', J(1241, 4, 9), null, 'Duke Henry the Pious and his Polish, Moravian and German knights are destroyed; the Mongols fill nine sacks with the ears of the dead.', WEST, 'war');
  fight(legnica, 'Legnica', P.legnica, J(1241, 4, 9));
  const mohi = ev('Battle of Mohi', J(1241, 4, 11), null, 'Subutai crosses the Sajó by night and surrounds King Béla\'s camp; the Hungarian army is cut down as it flees. Hungary is occupied.', WEST, 'war');
  fight(mohi, 'Mohi', P.mohi, J(1241, 4, 11));
  take(b, mohi, M, [S.hungary], [...b.regionsOf('Hungary')], J(1241, 4, 11), SLOW);
  ev('Ögedei dies', J(1241, 12, 11), null, 'The Great Khan dies after a night of drinking. The news reaches Batu the next spring.', WEST, 'collapse');
  const back = ev('The Mongols leave Hungary', J(1242, 3, 1), J(1242, 6, 1), 'Batu turns back to the Volga, to be near the choice of a new khan. Hungary, ruined, has lost perhaps a quarter of its people.', WEST, 'treaty');
  take(b, back, S.hungary, [M], [...b.regionsOf('Hungary')], null, SLOW);
  ev('Sarai founded', J(1242, 9, 1), null, 'Batu founds his capital on the lower Volga: the beginning of the Golden Horde.', WEST, 'founding');
  const kose = ev('Battle of Köse Dağ', J(1243, 6, 26), null, 'Baiju routs the Seljuk sultan; Rum becomes a Mongol vassal, and so does Trebizond.', WEST, 'war');
  fight(kose, 'Köse Dağ', P.koseDag, J(1243, 6, 26));
  rename(b, kose, S.rum, 'Rum (Mongol vassal)');
  const georgia = ev('Georgia submits', J(1243, 1, 1), null, 'After years of invasion Queen Rusudan submits; Georgia, Armenia and Shirvan are ruled by Mongol governors.', WEST, 'conquest');
  annex(b, georgia, M, ['Kingdom of Georgia'], null, SLOW);
  ev('Güyük made Great Khan', J(1246, 8, 24), null, 'Giovanni da Pian del Carpine, the Pope\'s envoy, sees the enthronement; Güyük\'s answer to the Pope demands that he come and submit.', EAST, 'founding');
  ev('Möngke made Great Khan', J(1251, 7, 1), null, 'The house of Tolui takes the throne; Möngke purges the families of Ögedei and Chagatai and plans the conquest of the world: Hulagu to the west, Kublai to the south.', EAST, 'founding');
  const dali = ev('Kublai conquers Dali', J(1253, 9, 1), J(1254, 1, 1), 'Kublai crosses the mountains of Sichuan on rafts of inflated skins; Dali surrenders and is spared.', EAST, 'conquest');
  march(dali, 'Kublai\'s march on Dali', [[104.5, 34.5], [102.0, 30.0], P.dali], J(1254, 6, 1));
  annex(b, dali, M, ['Dali'], null, SLOW);
  const hulagu = ev('Hulagu marches west', J(1253, 10, 1), J(1256, 1, 1), 'The largest army the Mongols ever sent west, with Chinese engineers and their siege machines.', WEST, 'war');
  march(hulagu, 'Hulagu\'s march', [P.karakorum, P.almaliq, P.samarkand, P.merv], J(1256, 6, 1));
  const alamut = ev('The fall of Alamut', J(1256, 11, 1), J(1256, 12, 20), 'The Nizari imam Rukn al-Din surrenders his castles; Alamut\'s great library burns. The Assassins are hunted down.', WEST, 'conquest');
  march(alamut, 'Against the Assassins', [P.merv, P.nishapur, P.alamut], J(1257, 3, 1));
  fight(alamut, 'Alamut', P.alamut, J(1256, 11, 15));
  annex(b, alamut, M, ['Nizari Ismailis'], null, SLOW);
  const baghdad = ev('The sack of Baghdad', J(1258, 1, 29), J(1258, 2, 10), 'After twelve days of siege the caliph surrenders. The city is sacked for a week; the caliph is rolled in a carpet and trampled by horses. The rivers ran black with the ink of the House of Wisdom\'s books.', WEST, 'conquest');
  march(baghdad, 'On Baghdad', [P.alamut, [48.5, 34.8], [46.0, 34.3], P.baghdad], J(1258, 6, 1));
  fight(baghdad, 'Baghdad', P.baghdad, J(1258, 1, 29));
  annex(b, baghdad, M, ['Abbasid Caliphate'], null, SLOW);
  const mamluks = ev('The Mamluks take Egypt', J(1250, 5, 2), null, 'The slave soldiers of the last Ayyubid sultan kill his heir and take the throne of Egypt.', WEST, 'revolution');
  const MAM = b.country('Mamluk Sultanate', '#7e57c2');
  b.commit(cmd.updateEntity(b.world, MAM, { notes: 'The sultanate of the Mamluks, slave soldiers, in Egypt from 1250 and Syria from 1260.' }));
  take(b, mamluks, MAM, [S.ayyubid], [...b.regionsOf('Egypt')], null, FADE);
  const syria = ev('Hulagu takes Syria', J(1260, 1, 18), J(1260, 3, 1), 'Aleppo falls after a week; Damascus opens its gates. Hulagu then turns back east at the news of Möngke\'s death, leaving Kitbuqa with a small army.', WEST, 'conquest');
  march(syria, 'Into Syria', [P.baghdad, [40.0, 36.5], P.aleppo, P.damascus], J(1260, 9, 1));
  fight(syria, 'Aleppo', P.aleppo, J(1260, 1, 18));
  take(b, syria, M, [S.ayyubid], ['Syria', 'Lebanon', 'Jordan', 'Israel', 'Palestine'].flatMap((n) => b.regionsOf(n)), null, SLOW);
  ev('Möngke dies', J(1259, 8, 11), null, 'The Great Khan dies of dysentery (or an arrow) besieging the Diaoyu fortress in Sichuan. The campaigns stop as the princes go home to choose his successor.', EAST, 'collapse');

  // ---- Four khanates
  const GH = b.country('Golden Horde', '#d4a72c'), CH = b.country('Chagatai Khanate', '#5b9b6b'), IL = b.country('Ilkhanate', '#b4535b'), YUAN = b.country('Great Khanate', '#3e6db3');
  b.commit(cmd.updateEntity(b.world, GH, { notes: 'The Ulus of Jochi, ruled by Batu and his heirs from Sarai: the Kipchak Khanate.' }));
  b.commit(cmd.updateEntity(b.world, CH, { notes: 'The Ulus of Chagatai, in Transoxiana, the Tian Shan and the Tarim.' }));
  b.commit(cmd.updateEntity(b.world, IL, { notes: 'Hulagu\'s realm from the Amu Darya to Anatolia, its capitals Maragheh and Tabriz.' }));
  b.commit(cmd.updateEntity(b.world, YUAN, { notes: 'Kublai\'s realm: Mongolia and China, the Great Khan\'s own.' }));
  const split = ev('The empire divides', J(1260, 5, 5), J(1260, 7, 1), 'Kublai is proclaimed Great Khan at Kaiping, his brother Ariq Böke at Karakorum: civil war. The other khans go their own way; the empire is four.', SPLIT, 'revolution');
  take(b, split, GH, [M], [...regions('Russia', [...RU.northEast, ...RU.volgaBulgaria, ...RU.steppe]), ...regions('Ukraine', [...UA.rus, ...UA.steppe]), ...regions('Kazakhstan', KZ.steppe), ...regions('Uzbekistan', ['Karakalpakstan', 'Khorezm']), ...regions('Turkmenistan', ['Tashauz'])], null, FADE);
  take(b, split, CH, [M], [...b.regionsOf('Uzbekistan'), ...b.regionsOf('Tajikistan'), ...b.regionsOf('Kyrgyzstan'), ...regions('Kazakhstan', [...KZ.qaraKhitai, ...KZ.khwarazm]), ...regions('China', ['Xinjiang']), ...regions('Afghanistan', AF_NORTH)], null, FADE);
  take(b, split, IL, [M], [...b.regionsOf('Iran'), ...b.regionsOf('Iraq'), ...b.regionsOf('Turkmenistan'), ...b.regionsOf('Afghanistan'), ...b.regionsOf('Georgia'), ...b.regionsOf('Armenia'), ...b.regionsOf('Azerbaijan'), ...['Syria', 'Lebanon', 'Jordan', 'Israel', 'Palestine'].flatMap((n) => b.regionsOf(n))], null, FADE);
  annex(b, split, YUAN, ['Mongol Empire'], null, FADE);
  const ainJalut = ev('Battle of Ain Jalut', J(1260, 9, 3), null, 'The Mamluk sultan Qutuz and Baybars lure Kitbuqa\'s army into the valley of Goliath\'s Spring and destroy it: the first great defeat of a Mongol army. Syria is the Mamluks\'.', SPLIT, 'war');
  march(ainJalut, 'The Mamluks march north', [[31.24, 30.04], [33.8, 31.2], P.ainJalut], J(1260, 12, 1), '#5e35b1');
  fight(ainJalut, 'Ain Jalut', P.ainJalut, J(1260, 9, 3));
  take(b, ainJalut, MAM, [IL, S.ayyubid], ['Syria', 'Lebanon', 'Jordan', 'Israel', 'Palestine'].flatMap((n) => b.regionsOf(n)), null, SLOW);
  ev('Berke and Hulagu at war', J(1262, 11, 1), J(1263, 1, 13), 'The Golden Horde\'s khan, a Muslim, allies with the Mamluks against his cousin Hulagu; Hulagu\'s army is beaten on the frozen Terek. Mongol fights Mongol.', SPLIT, 'war');
  ev('Ariq Böke surrenders', J(1264, 8, 21), null, 'The civil war ends; Kublai is Great Khan, but the western khans no longer obey him.', SPLIT, 'treaty');
  const tibet = ev('Tibet under Kublai', J(1264, 1, 1), null, 'Kublai makes the Sakya lama Phagpa head of the Buddhists and of Tibet, under a bureau at his court.', EAST, 'treaty');
  annex(b, tibet, YUAN, ['Tibet'], null, FADE);
  ev('Hulagu dies', J(1265, 2, 8), null, 'The founder of the Ilkhanate dies at Maragheh; his son Abaqa succeeds him.', SPLIT, 'collapse');
  ev('Dadu begun', J(1267, 1, 1), null, 'Kublai builds a new capital beside the ruins of Zhongdu: Dadu, "great capital", to the Turks Khanbaliq, "city of the khan". Beijing grows from it.', EAST, 'founding');
  const xy = ev('The siege of Xiangyang', J(1268, 9, 1), J(1273, 3, 1), 'Five years at the twin cities on the Han River, the gate to the Yangtze. Counterweight catapults built by engineers from the Ilkhanate breach the walls.', EAST, 'war');
  fight(xy, 'Xiangyang', P.xiangyang, J(1268, 9, 1), 6);
  take(b, xy, YUAN, [S.song], regions('China', ['Hubei']), J(1272, 6, 1), SLOW);
  const yuan = ev('The Yuan dynasty proclaimed', J(1271, 12, 18), null, 'Kublai takes a Chinese dynastic name, Yuan, "origin of the universe".', EAST, 'founding');
  rename(b, yuan, YUAN, 'Yuan dynasty');
  const yangtze = ev('Bayan crosses the Yangtze', J(1274, 9, 1), J(1275, 12, 1), 'General Bayan leads 200,000 down the Han and across the Yangtze; the cities of the lower river fall one after another.', EAST, 'conquest');
  march(yangtze, 'Bayan down the Yangtze', [P.xiangyang, [115.0, 30.6], [117.3, 31.0], [118.8, 32.06]], J(1276, 6, 1));
  take(b, yangtze, YUAN, [S.song], regions('China', ['Anhui', 'Jiangsu', 'Jiangxi', 'Hunan']), null, SLOW);
  const linan = ev('Lin\'an surrenders', J(1276, 2, 4), null, 'The dowager empress hands over the child emperor and the imperial seal; the capital is spared.', EAST, 'conquest');
  fight(linan, 'Lin\'an', P.hangzhou, J(1276, 2, 4));
  take(b, linan, YUAN, [S.song], regions('China', ['Zhejiang', 'Shanghai']), null, SLOW);
  const south = ev('The war in the south', J(1276, 6, 1), J(1279, 1, 1), 'Loyalists carry two child princes south; Sichuan, Fujian, Guangdong and Guangxi fall.', EAST, 'conquest');
  take(b, south, YUAN, [S.song], regions('China', ['Sichuan', 'Chongqing', 'Fujian', 'Guizhou', 'Guangxi']), null, SLOW);
  const yamen = ev('Battle of Yamen', J(1279, 3, 19), null, 'The last Song fleet is destroyed off the Pearl River delta. The minister Lu Xiufu leaps into the sea with the boy emperor in his arms. All China is Mongol for the first time.', EAST, 'war');
  fight(yamen, 'Yamen', P.yamen, J(1279, 3, 19));
  annex(b, yamen, YUAN, ['Southern Song'], null, SLOW);
  const japan1 = ev('The first invasion of Japan', J(1274, 11, 2), J(1274, 11, 20), 'Some 900 ships from Korea land at Hakata Bay; after a day\'s fighting they re-embark, and a storm wrecks many of them.', EAST, 'war');
  march(japan1, 'The fleet of 1274', [P.happo, [129.7, 34.3], P.hakata], J(1275, 3, 1), '#2b4f8f');
  fight(japan1, 'Hakata Bay', P.hakata, J(1274, 11, 19));
  const japan2 = ev('The second invasion of Japan', J(1281, 6, 1), J(1281, 8, 15), 'Two fleets, from Korea and from south China, some 140,000 men; the Japanese have built a wall along the bay. In August a typhoon, the kamikaze, the divine wind, sinks most of the fleet.', EAST, 'war');
  march(japan2, 'The eastern fleet', [P.happo, [129.7, 34.3], P.hakata], J(1281, 12, 1), '#2b4f8f');
  march(japan2, 'The southern fleet', [P.ningbo, [125.0, 31.0], [129.0, 33.3], P.hakata], J(1281, 12, 1), '#2b4f8f');
  fight(japan2, 'The kamikaze', [129.9, 33.4], J(1281, 8, 15));
  const viet = ev('The war with Đại Việt', J(1285, 1, 1), J(1288, 4, 9), 'Three invasions of Vietnam. In 1288 Trần Hưng Đạo plants stakes in the bed of the Bạch Đằng River and destroys the Mongol fleet as the tide falls.', EAST, 'war');
  march(viet, 'Into Đại Việt', [P.kunming, [104.0, 23.0], P.hanoi], J(1288, 9, 1));
  fight(viet, 'Bạch Đằng', P.bachDang, J(1288, 4, 9));
  const pagan = ev('The fall of Pagan', J(1287, 1, 1), null, 'The Mongols invade Burma; the kingdom of Pagan breaks apart.', EAST, 'war');
  march(pagan, 'Into Burma', [P.dali, [97.5, 24.0], P.pagan], J(1288, 1, 1));
  const java = ev('The expedition to Java', J(1292, 12, 1), J(1293, 5, 1), 'A fleet sails to punish King Kertanegara of Singhasari for branding the khan\'s envoy; Raden Wijaya uses it to win his own war, then turns on it. From the victory comes Majapahit.', EAST, 'war');
  march(java, 'The fleet to Java', [P.quanzhou, [114.0, 18.0], [108.0, 6.0], [110.0, -4.0], P.tuban], J(1293, 9, 1), '#2b4f8f');
  ev('Kublai dies', J(1294, 2, 18), null, 'The Great Khan dies at Dadu, aged 78.', EAST, 'collapse');
  ev('Ghazan becomes a Muslim', J(1295, 6, 19), null, 'The Ilkhan converts to Islam with his court; the Ilkhanate becomes a Persian Islamic state.', SPLIT);
  const ghazan = ev('Ghazan takes Damascus', J(1299, 12, 22), J(1300, 1, 6), 'The Ilkhan beats the Mamluks at Wadi al-Khaznadar and holds Damascus for a few months.', SPLIT, 'war');
  march(ghazan, 'Ghazan into Syria', [P.tabriz, [40.2, 37.0], P.aleppo, P.damascus], J(1300, 6, 1), '#8e2f3a');
  take(b, ghazan, IL, [MAM], [...b.regionsOf('Syria')], null, SLOW);
  const ghazanBack = ev('The Mamluks return', J(1300, 5, 1), null, 'With the Ilkhan gone, the Mamluks take Syria back.', SPLIT, 'conquest');
  take(b, ghazanBack, MAM, [IL], [...b.regionsOf('Syria')], null, SLOW);
  ev('Peace among the khans', J(1304, 1, 1), null, 'The four khanates recognise the Yuan emperor as their nominal head; the Mongol peace is at its height and the roads are open from Crimea to China.', SPLIT, 'treaty');
  const ozbeg = ev('Öz Beg Khan', J(1313, 1, 1), null, 'The Golden Horde turns to Islam under its greatest khan.', SPLIT);
  void ozbeg;
  const rumEnd = ev('Rum ends', J(1308, 1, 1), null, 'The last Seljuk sultan dies; Ilkhanid governors rule Anatolia directly.', SPLIT, 'collapse');
  annex(b, rumEnd, IL, ['Sultanate of Rum'], null, FADE);
  // The Ilkhanate falls apart.
  const ilEnd = ev('The Ilkhanate falls apart', J(1335, 11, 30), J(1336, 12, 1), 'Abu Sa\'id dies without an heir; his amirs set up khans of their own. Within a few years the Ilkhanate is gone.', SPLIT, 'collapse');
  const JAL = b.country('Jalayirids', '#8d6e63'), CHOB = b.country('Chobanids', '#ad6a6c'), MUZ = b.country('Muzaffarids', '#6d8b74'), KART = b.country('Kartids', '#b39ddb'), BEY = b.country('Anatolian beyliks', '#bf8a5a');
  take(b, ilEnd, JAL, [IL], [...b.regionsOf('Iraq')], null, FADE);
  take(b, ilEnd, CHOB, [IL], [...regions('Iran', ['East Azarbaijan', 'West Azarbaijan', 'Ardebil', 'Zanjan', 'Gilan', 'Qazvin', 'Hamadan', 'Kordestan']), ...b.regionsOf('Armenia'), ...b.regionsOf('Azerbaijan')], null, FADE);
  take(b, ilEnd, MUZ, [IL], regions('Iran', ['Fars', 'Kerman', 'Yazd', 'Esfahan', 'Hormozgan', 'Bushehr', 'Kohgiluyeh and Buyer Ahmad', 'Chahar Mahall and Bakhtiari', 'Khuzestan', 'Lorestan', 'Ilam', 'Kermanshah', 'Markazi', 'Qom', 'Tehran', 'Alborz', 'Semnan', 'Mazandaran', 'Golestan', 'Sistan and Baluchestan']), null, FADE);
  take(b, ilEnd, KART, [IL], [...b.regionsOf('Afghanistan'), ...b.regionsOf('Turkmenistan'), ...regions('Iran', ['Razavi Khorasan', 'North Khorasan', 'South Khorasan'])], null, FADE);
  take(b, ilEnd, BEY, [IL], [...b.regionsOf('Turkey')], null, FADE);
  const geo = ev('Georgia free again', J(1334, 1, 1), null, 'George V the Brilliant stops paying tribute and reunites Georgia.', SPLIT, 'revolution');
  const GEO = b.country('Kingdom of Georgia');
  take(b, geo, GEO, [IL], [...b.regionsOf('Georgia')], null, FADE);
  const caffa = ev('The siege of Caffa', J(1346, 1, 1), J(1347, 5, 1), 'Jani Beg\'s army besieging the Genoese port is struck by plague; corpses are said to be hurled over the walls. Genoese ships carry the Black Death to Constantinople, Sicily and on to all Europe.', SPLIT, 'disaster');
  fight(caffa, 'Caffa', P.caffa, J(1346, 6, 1));
  march(caffa, 'The Black Death sails west', [P.caffa, [31.0, 43.0], P.constantinople, [24.0, 37.0], [15.3, 38.2], [9.0, 41.0], [5.37, 43.3]], J(1348, 6, 1), '#4a4a4a');
  const chagSplit = ev('Moghulistan breaks away', J(1347, 1, 1), null, 'The Chagatai Khanate splits: Moghulistan in the east keeps the nomad ways; Transoxiana falls to its Turkic amirs.', SPLIT, 'revolution');
  const MOG = b.country('Moghulistan', '#7cb342');
  take(b, chagSplit, MOG, [CH], [...b.regionsOf('Kyrgyzstan'), ...regions('Kazakhstan', KZ.qaraKhitai), ...regions('China', ['Xinjiang'])], null, FADE);
  const redTurbans = ev('The Red Turbans', J(1351, 5, 1), J(1367, 10, 1), 'Floods, famine and forced labour on the Yellow River dykes: rebellion spreads across the south. Zhu Yuanzhang, a former monk, takes Nanjing (1356) and destroys his rivals.', EAST, 'revolution');
  const MING = b.country('Ming dynasty', '#d84315');
  b.commit(cmd.updateEntity(b.world, MING, { notes: 'The dynasty founded by Zhu Yuanzhang, the Hongwu Emperor, in 1368.' }));
  take(b, redTurbans, MING, [YUAN], regions('China', ['Jiangsu', 'Anhui', 'Zhejiang', 'Shanghai', 'Jiangxi', 'Hubei', 'Hunan', 'Fujian', 'Guangdong', 'Guangxi', 'Hainan']), null, SLOW);
  const ming = ev('The Ming drive out the Yuan', J(1368, 1, 23), J(1368, 9, 14), 'Zhu Yuanzhang proclaims the Ming at Nanjing; his armies march north and the last Yuan emperor flees Dadu for the steppe.', EAST, 'conquest');
  march(ming, 'The Ming march north', [P.nanjing, [116.5, 35.0], P.dadu], J(1369, 3, 1), '#b71c1c');
  take(b, ming, MING, [YUAN], regions('China', ['Shandong', 'Henan', 'Hebei', 'Beijing', 'Tianjin', 'Shanxi']), null, SLOW);
  const nyuan = ev('The Northern Yuan', J(1368, 9, 14), null, 'The Yuan court rules on from the steppe: the Northern Yuan.', EAST, 'founding');
  rename(b, nyuan, YUAN, 'Northern Yuan');
  const ming2 = ev('The Ming take the west and the south', J(1369, 1, 1), J(1382, 1, 1), 'Shaanxi and Gansu (1369–1371), Sichuan (1371), the northeast (1387) and at last Yunnan (1381–1382).', EAST, 'conquest');
  take(b, ming2, MING, [YUAN], regions('China', ['Shaanxi', 'Gansu', 'Ningxia', 'Sichuan', 'Chongqing', 'Guizhou', 'Yunnan', 'Liaoning']), null, SLOW);
  // The Golden Horde, Lithuania and Moscow.
  const LIT = b.country('Grand Duchy of Lithuania', '#4db6ac'), MOS = b.country('Grand Duchy of Moscow', '#7986cb');
  b.commit(cmd.updateEntity(b.world, MOS, { notes: 'The princes of Moscow, the Horde\'s tax collectors, growing at their neighbours\' expense.' }));
  const bw = ev('Battle of Blue Waters', J(1362, 9, 1), J(1363, 6, 1), 'Algirdas of Lithuania beats three Tatar princes; Kiev and the lands of the middle Dnieper pass to Lithuania.', SPLIT, 'conquest');
  fight(bw, 'Blue Waters', P.blueWaters, J(1362, 9, 1));
  take(b, bw, LIT, [GH], regions('Ukraine', UA.rus), null, SLOW);
  const mos = ev('Moscow grand princes', J(1363, 1, 1), null, 'Dmitry of Moscow wins the title of grand prince; the northeast gathers round Moscow.', SPLIT, 'founding');
  take(b, mos, MOS, [GH], regions('Russia', ['Moskovskaya', 'Moskva', 'Vladimir', 'Yaroslavl\'', 'Kostroma', 'Ivanovo']), null, FADE);
  const kul = ev('Battle of Kulikovo', J(1380, 9, 8), null, 'Dmitry Donskoy defeats the warlord Mamai on Snipe\'s Field: the first Russian victory over the Horde.', SPLIT, 'war');
  fight(kul, 'Kulikovo', P.kulikovo, J(1380, 9, 8));
  const tokh = ev('Tokhtamysh burns Moscow', J(1382, 8, 26), null, 'The new khan, Timur\'s protégé, reunites the Horde, takes Moscow by a trick and burns it; the tribute is paid again.', SPLIT, 'war');
  fight(tokh, 'Moscow burned', P.moscow, J(1382, 8, 26));

  // ---- Timur
  const TIM = b.country('Timurid Empire', '#2a8c8c');
  b.commit(cmd.updateEntity(b.world, TIM, { notes: 'Timur\'s empire from Samarkand: he never took the title of khan, ruling through Chinggisid puppets.' }));
  const balkh = ev('Timur takes power', J(1370, 4, 9), null, 'At Balkh, Timur the Lame, an amir of the Barlas, kills his rival Husayn and becomes master of Transoxiana, marrying a descendant of Genghis Khan.', TIMUR, 'revolution');
  annex(b, balkh, TIM, ['Chagatai Khanate'], null, FADE);
  const tk = ev('Herat and Khorasan', J(1381, 4, 1), J(1384, 12, 1), 'Timur takes Herat from the Kartids and Khorasan from the Sarbadars.', TIMUR, 'conquest');
  march(tk, 'Timur to Herat', [P.samarkand, P.balkh, P.herat], J(1382, 6, 1), '#1f6f6f');
  annex(b, tk, TIM, ['Kartids'], null, SLOW);
  const persia = ev('The three-year campaign', J(1386, 1, 1), J(1388, 6, 1), 'Tabriz, Georgia and Armenia; at Isfahan, after a revolt, 70,000 are killed and their heads piled into towers.', TIMUR, 'conquest');
  march(persia, 'Timur in Persia', [P.herat, P.nishapur, [51.4, 35.6], P.tabriz, [44.8, 41.7]], J(1388, 6, 1), '#1f6f6f');
  march(persia, 'To Isfahan', [[51.4, 35.6], P.isfahan], J(1388, 6, 1), '#1f6f6f');
  fight(persia, 'Isfahan', P.isfahan, J(1387, 11, 1));
  annex(b, persia, TIM, ['Chobanids'], J(1386, 6, 1), SLOW);
  take(b, persia, TIM, [MUZ], regions('Iran', ['Esfahan', 'Markazi', 'Qom', 'Tehran', 'Alborz', 'Semnan', 'Mazandaran', 'Golestan', 'Hamadan']), J(1387, 10, 1), SLOW);
  const kond = ev('Battle of the Kondurcha', J(1391, 6, 18), null, 'Timur marches across the steppe for months and beats Tokhtamysh, his former protégé, far to the north.', TIMUR, 'war');
  march(kond, 'Across the steppe', [P.samarkand, [66.0, 46.0], [62.0, 50.0], [52.0, 53.5]], J(1391, 12, 1), '#1f6f6f');
  fight(kond, 'The Kondurcha', [51.2, 53.6], J(1391, 6, 18));
  const shiraz = ev('The end of the Muzaffarids', J(1393, 5, 1), null, 'Shiraz falls; the Muzaffarid princes are put to death.', TIMUR, 'conquest');
  annex(b, shiraz, TIM, ['Muzaffarids'], null, SLOW);
  const bag2 = ev('Baghdad taken', J(1393, 8, 30), null, 'The Jalayirid sultan flees to Egypt as Timur enters Baghdad.', TIMUR, 'conquest');
  march(bag2, 'To Baghdad', [P.shiraz, [48.7, 31.3], P.baghdad], J(1394, 3, 1), '#1f6f6f');
  annex(b, bag2, TIM, ['Jalayirids'], null, SLOW);
  const terek = ev('Battle of the Terek', J(1395, 4, 15), null, 'Timur breaks Tokhtamysh for good, then sacks Sarai, Astrakhan and the trading cities of the Horde. The Golden Horde never recovers.', TIMUR, 'war');
  march(terek, 'Against the Golden Horde', [P.tabriz, P.derbent, P.terek, [44.5, 46.0], P.sarai], J(1396, 3, 1), '#1f6f6f');
  fight(terek, 'The Terek', P.terek, J(1395, 4, 15));
  fight(terek, 'Sarai sacked', P.sarai, J(1395, 9, 1));
  const delhi = ev('The sack of Delhi', J(1398, 12, 17), null, 'Timur crosses the Indus and beats the sultan of Delhi; the city is sacked for three days, and tens of thousands of captives are killed before the battle.', TIMUR, 'war');
  march(delhi, 'Timur into India', [P.samarkand, P.balkh, [69.2, 34.5], P.indus, [74.3, 31.5], P.delhi], J(1399, 6, 1), '#1f6f6f');
  fight(delhi, 'Delhi', P.delhi, J(1398, 12, 17));
  const syria2 = ev('Aleppo and Damascus', J(1400, 10, 30), J(1401, 3, 19), 'Timur storms Aleppo and burns Damascus; Ibn Khaldun, the historian, meets him outside the walls.', TIMUR, 'war');
  march(syria2, 'Timur in Syria', [P.baghdad, [41.0, 37.2], P.aleppo, P.damascus], J(1401, 9, 1), '#1f6f6f');
  fight(syria2, 'Damascus', P.damascus, J(1401, 1, 1));
  const ankara = ev('Battle of Ankara', J(1402, 7, 20), null, 'Timur crushes the Ottoman army; Sultan Bayezid is taken prisoner and dies in captivity. The Ottomans fall into civil war, and Constantinople has half a century more.', TIMUR, 'war');
  march(ankara, 'Into Anatolia', [P.tabriz, [41.3, 39.9], [37.0, 39.75], P.ankara], J(1403, 1, 1), '#1f6f6f');
  fight(ankara, 'Ankara', P.ankara, J(1402, 7, 20));
  const china = ev('Timur marches on China', J(1404, 11, 27), J(1405, 2, 18), 'In winter, with 200,000 men, Timur sets out to restore the Yuan and conquer the Ming.', TIMUR, 'war');
  march(china, 'Towards China', [P.samarkand, [68.0, 41.5], P.otrar], J(1405, 6, 1), '#1f6f6f');
  ev('Timur dies at Otrar', J(1405, 2, 18), null, 'Timur dies of fever at Otrar, where the Mongol storm had broken on Khwarazm 186 years before. The march on China is abandoned.', TIMUR, 'collapse');

  // ---- More of the khanates' wars and lives
  ev('Tolui dies', J(1232, 10, 1), null, 'Genghis Khan\'s youngest son, regent after his father, dies in China; his widow Sorghaghtani Beki raises Möngke, Kublai, Hulagu and Ariq Böke.', EAST, 'collapse');
  ev('The Secret History', J(1240, 7, 1), null, 'The Mongols\' own account of Genghis Khan\'s life is written down, "at the Great Assembly, in the Year of the Rat".', RISE);
  ev('Güyük dies', J(1248, 4, 20), null, 'The Great Khan dies on his way west, perhaps to fight his cousin Batu.', EAST, 'collapse');
  ev('Batu dies', J(1255, 1, 1), null, 'The founder of the Golden Horde dies at Sarai; his brother Berke, a Muslim, rules from 1257.', SPLIT, 'collapse');
  const viet1 = ev('The first invasion of Đại Việt', J(1258, 1, 17), J(1258, 1, 29), 'Uriyangkhadai comes down from Yunnan and takes Thăng Long, then withdraws in the heat; the Trần agree to send tribute.', EAST, 'war');
  march(viet1, 'Uriyangkhadai into Đại Việt', [P.kunming, [103.9, 22.6], P.hanoi], J(1258, 6, 1));
  const elb = ev('Battle of Elbistan', J(1277, 4, 15), null, 'Sultan Baybars beats a Mongol army in Anatolia and enters Kayseri, but cannot hold it.', SPLIT, 'war');
  fight(elb, 'Elbistan', [37.2, 38.2], J(1277, 4, 15));
  const homs = ev('Second Battle of Homs', J(1281, 10, 29), null, 'Sultan Qalawun turns back the Ilkhan\'s brother Möngke Temür in Syria.', SPLIT, 'war');
  fight(homs, 'Homs', [36.72, 34.73], J(1281, 10, 29));
  ev('Rabban Bar Sauma in Europe', J(1287, 9, 1), null, 'A Nestorian monk from Dadu, sent by the Ilkhan Arghun to seek an alliance against the Mamluks, says Mass before the Pope and meets the kings of France and England.', TRAVEL);
  const marj = ev('Battle of Marj al-Saffar', J(1303, 4, 20), null, 'The Mamluks defeat the Ilkhan\'s last invasion of Syria; Ibn Taymiyya preaches the jihad against the converted Mongols.', SPLIT, 'war');
  fight(marj, 'Marj al-Saffar', [36.2, 33.3], J(1303, 4, 20));
  ev('Plague by Lake Issyk-Kul', J(1338, 1, 1), null, 'Nestorian gravestones by Lake Issyk-Kul record a pestilence: perhaps the first sign of the Black Death, travelling the roads the Mongols kept open.', SPLIT, 'disaster');
  ev('The great troubles', J(1359, 1, 1), J(1381, 1, 1), 'Twenty years of murdered khans in the Golden Horde; the warlord Mamai rules through puppets.', SPLIT, 'revolution');
  const buir = ev('Battle of Buir Lake', J(1388, 5, 18), null, 'A Ming army crosses the Gobi and destroys the Northern Yuan khan\'s camp; the khan is murdered in flight.', EAST, 'war');
  fight(buir, 'Buir Lake', [117.7, 47.8], J(1388, 5, 18));
  const vorskla = ev('Battle of the Vorskla', J(1399, 8, 12), null, 'Edigu and the Golden Horde destroy the army of Vytautas of Lithuania, ending his plan to put Tokhtamysh back on the throne.', SPLIT, 'war');
  fight(vorskla, 'The Vorskla', [34.5, 49.6], J(1399, 8, 12));
  ev('Clavijo at Samarkand', J(1404, 9, 8), null, 'The envoy of Henry III of Castile is received by Timur and describes the gardens, palaces and building works of Samarkand.', TRAVEL);

  // ---- Travellers
  ev('Carpini at Karakorum', J(1246, 7, 22), null, 'The Franciscan Giovanni da Pian del Carpine, sent by Pope Innocent IV, reaches the Great Khan\'s camp.', TRAVEL);
  ev('William of Rubruck at Karakorum', J(1254, 4, 5), null, 'The Flemish friar debates the Muslims, Buddhists and Nestorians before Möngke Khan, and describes the silver tree fountain of the palace.', TRAVEL);
  ev('Marco Polo sets out', J(1271, 11, 1), null, 'Seventeen years old, Marco leaves Acre with his father and uncle, bearing letters from the new Pope to the Great Khan.', TRAVEL);
  ev('Marco Polo reaches Kublai', J(1275, 5, 1), null, 'At Shangdu, the summer capital: "Xanadu".', TRAVEL);
  ev('Marco Polo returns to Venice', J(1295, 1, 1), null, 'After escorting a Mongol princess to the Ilkhan by sea, the Polos come home after twenty-four years, unrecognised. In a Genoese prison Marco tells his story to Rustichello of Pisa.', TRAVEL);
  ev('Ibn Battuta in China', J(1345, 6, 1), null, 'The Moroccan traveller lands at Quanzhou, "Zaitun", the greatest port he has seen, then goes to Dadu.', TRAVEL);

  // ---- Statistics: the lands under Mongol rule.
  b.commit(cmd.setMapStatistics(b.world, b.space, [
    stat('Lands under Mongol rule', 'count', 'linear', [[J(1206), 1.6e6], [J(1209), 2.2e6], [J(1215), 3.6e6], [J(1218), 6.5e6], [J(1221), 10.5e6], [J(1227), 12.5e6], [J(1234), 14.5e6], [J(1240), 20e6], [J(1259), 24e6], [J(1279), 24e6], [J(1294), 23.5e6], [J(1335), 22e6], [J(1368), 14e6], [J(1405), 9e6]]),
    stat('Years since the Onon', 'number', 'linear', [[J(1206, 4, 1), 0], [J(1406, 4, 1), 200]], 0),
  ]));
}

function characters(b: Builder): void {
  journey(b, 'Genghis Khan', [[J(1206, 4, 1), P.onon], [J(1211, 3, 1), P.onon], [J(1211, 9, 1), P.yehuling], [J(1214, 4, 1), P.zhongdu], [J(1216, 1, 1), P.onon], [J(1219, 9, 1), P.almaliq], [J(1220, 1, 1), P.otrar], [J(1220, 3, 1), P.bukhara], [J(1220, 4, 1), P.samarkand], [J(1221, 3, 1), P.balkh], [J(1221, 11, 24), P.indus], [J(1223, 6, 1), P.samarkand], [J(1225, 3, 1), P.onon], [J(1226, 2, 1), P.karakorum], [J(1227, 3, 1), P.yinchuan], [J(1227, 8, 1), P.liupan]], { notes: 'Temüjin, Genghis Khan (about 1162–1227).', leaves: J(1227, 8, 18) });
  journey(b, 'Subutai', [[J(1219, 9, 1), P.almaliq], [J(1220, 4, 1), P.samarkand], [J(1220, 9, 1), [52.5, 37.0]], [J(1221, 6, 1), P.tabriz], [J(1222, 2, 1), P.derbent], [J(1223, 5, 31), P.kalka], [J(1224, 6, 1), [66.0, 46.0]], [J(1225, 6, 1), P.karakorum], [J(1232, 4, 1), P.kaifeng], [J(1236, 9, 1), [49.4, 54.9]], [J(1238, 2, 1), P.vladimir], [J(1240, 12, 6), P.kiev], [J(1241, 4, 11), P.mohi], [J(1242, 9, 1), P.sarai], [J(1246, 8, 1), P.karakorum]], { notes: 'Genghis Khan\'s greatest general, who fought on two continents.', leaves: J(1248, 1, 1) });
  journey(b, 'Batu Khan', [[J(1236, 9, 1), [49.4, 54.9]], [J(1237, 12, 21), P.ryazan], [J(1238, 2, 7), P.vladimir], [J(1240, 12, 6), P.kiev], [J(1241, 4, 11), P.mohi], [J(1242, 9, 1), P.sarai]], { notes: 'Grandson of Genghis Khan, founder of the Golden Horde.', leaves: J(1255, 1, 1) });
  journey(b, 'Hulagu', [[J(1253, 10, 1), P.karakorum], [J(1255, 9, 1), P.samarkand], [J(1256, 11, 1), P.alamut], [J(1258, 1, 29), P.baghdad], [J(1259, 9, 1), P.maragheh], [J(1260, 1, 18), P.aleppo], [J(1260, 4, 1), P.maragheh]], { notes: 'Grandson of Genghis Khan, destroyer of Baghdad, founder of the Ilkhanate.', leaves: J(1265, 2, 8) });
  journey(b, 'Kublai Khan', [[J(1253, 9, 1), [104.5, 34.5]], [J(1253, 12, 1), P.dali], [J(1256, 1, 1), P.shangdu], [J(1259, 9, 1), [114.3, 30.6]], [J(1260, 5, 5), P.shangdu], [J(1267, 1, 1), P.dadu]], { notes: 'Grandson of Genghis Khan, Great Khan and first emperor of the Yuan.', leaves: J(1294, 2, 18) });
  journey(b, 'Marco Polo', [[J(1271, 6, 1), P.venice], [J(1271, 11, 1), P.acre], [J(1272, 6, 1), P.tabriz], [J(1272, 12, 1), P.hormuz], [J(1273, 9, 1), P.balkh], [J(1274, 2, 1), P.kashgar], [J(1274, 9, 1), P.dunhuang], [J(1275, 5, 1), P.shangdu], [J(1275, 9, 1), P.dadu], [J(1287, 1, 1), P.dadu], [J(1291, 1, 1), P.quanzhou], [J(1292, 4, 1), [98.0, 4.0]], [J(1293, 2, 1), P.hormuz], [J(1293, 9, 1), P.tabriz], [J(1294, 6, 1), P.constantinople], [J(1295, 1, 1), P.venice]], { notes: 'Venetian merchant who served Kublai Khan for seventeen years.' });
  journey(b, 'William of Rubruck', [[J(1253, 5, 7), P.constantinople], [J(1253, 6, 1), P.caffa], [J(1253, 8, 1), P.sarai], [J(1253, 12, 27), P.karakorum], [J(1254, 7, 10), P.karakorum], [J(1254, 9, 1), P.sarai], [J(1255, 6, 1), [35.5, 33.9]]], { notes: 'Flemish Franciscan who described the Mongols at home.', leaves: J(1255, 8, 15) });
  journey(b, 'Ibn Battuta', [[J(1325, 6, 14), P.tangier], [J(1326, 10, 1), P.mecca], [J(1327, 6, 1), P.baghdad], [J(1332, 6, 1), P.constantinople], [J(1333, 2, 1), P.sarai], [J(1333, 9, 1), P.samarkand], [J(1334, 9, 1), P.delhi], [J(1342, 7, 1), P.delhi], [J(1345, 6, 1), P.quanzhou], [J(1346, 1, 1), P.dadu], [J(1347, 6, 1), P.quanzhou], [J(1349, 11, 1), P.tangier]], { notes: 'Moroccan traveller, 120,000 km in twenty-nine years.' });
  journey(b, 'Timur', [[J(1336, 4, 9), P.kesh], [J(1370, 4, 9), P.balkh], [J(1370, 6, 1), P.samarkand], [J(1381, 4, 1), P.herat], [J(1385, 6, 1), P.samarkand], [J(1386, 6, 1), P.tabriz], [J(1387, 11, 1), P.isfahan], [J(1388, 6, 1), P.samarkand], [J(1391, 6, 18), [51.2, 53.6]], [J(1392, 6, 1), P.samarkand], [J(1393, 5, 1), P.shiraz], [J(1393, 8, 30), P.baghdad], [J(1395, 4, 15), P.terek], [J(1396, 6, 1), P.samarkand], [J(1398, 12, 17), P.delhi], [J(1399, 5, 1), P.samarkand], [J(1400, 10, 30), P.aleppo], [J(1401, 1, 1), P.damascus], [J(1402, 7, 20), P.ankara], [J(1404, 7, 1), P.samarkand], [J(1405, 2, 1), P.otrar]], { notes: 'Timur the Lame, Tamerlane (1336–1405).', leaves: J(1405, 2, 18) });
}

function shots(b: Builder): void {
  const STATS = 'Lands under Mongol rule: {Lands under Mongol rule} km²';
  const groups = (g: string[]) => ({ groups: g });
  shot(b, {
    name: '1 Genghis Khan, 1206 to 1227', title: 'Genghis Khan', subtitle: '1206 to 1227', precision: 'month', characters: true, trails: true, stats: STATS, eventsBox: groups(['Genghis Khan', 'The western campaigns']),
    time: [[0, J(1206, 3, 1)], [60, J(1227, 9, 1)]], camera: [[0, { lon: 100, lat: 45, zoom: 2.6 }], [20, { lon: 95, lat: 43, zoom: 2.3 }], [40, { lon: 72, lat: 41, zoom: 2.2 }], [60, { lon: 88, lat: 42, zoom: 2.1 }]], captions: [],
  });
  shot(b, {
    name: '2 The fall of Khwarazm, 1219 to 1223', title: 'The fall of Khwarazm', subtitle: '1219 to 1223', precision: 'month', characters: true, trails: true, eventsBox: groups(['Genghis Khan', 'The western campaigns']),
    time: [[0, J(1219, 6, 1)], [40, J(1223, 9, 1)]], camera: [[0, { lon: 66, lat: 41, zoom: 3.4 }], [24, { lon: 58, lat: 40, zoom: 3.2 }], [40, { lon: 52, lat: 43, zoom: 3.0 }]], captions: [],
  });
  shot(b, {
    name: '3 Into Europe, 1236 to 1242', title: 'Into Europe', subtitle: '1236 to 1242', precision: 'month', characters: true, eventsBox: groups(['The western campaigns']),
    time: [[0, J(1236, 6, 1)], [40, J(1242, 9, 1)]], camera: [[0, { lon: 45, lat: 53, zoom: 3.3 }], [20, { lon: 35, lat: 52, zoom: 3.3 }], [40, { lon: 28, lat: 50, zoom: 3.2 }]], captions: [],
  });
  shot(b, {
    name: '4 Baghdad and Ain Jalut, 1256 to 1260', title: 'Baghdad and Ain Jalut', subtitle: '1256 to 1260', precision: 'month', characters: true, eventsBox: groups(['The western campaigns', 'Four khanates']),
    time: [[0, J(1256, 6, 1)], [36, J(1260, 12, 1)]], camera: [[0, { lon: 50, lat: 36, zoom: 3.7 }], [36, { lon: 40, lat: 34, zoom: 4.0 }]],
    captions: [{ text: 'The first great defeat of a Mongol army', from: J(1260, 9, 3), to: J(1260, 11, 15), anchor: P.ainJalut, x: 0.12, y: 0.3, align: 'left' }],
  });
  shot(b, {
    name: '5 Kublai Khan and the Song, 1260 to 1293', title: 'Kublai Khan', subtitle: 'The conquest of the Song, and the fleets', precision: 'month', characters: true, eventsBox: groups(['China and the east']),
    time: [[0, J(1260, 1, 1)], [50, J(1293, 6, 1)]], camera: [[0, { lon: 114, lat: 33, zoom: 2.9 }], [30, { lon: 116, lat: 30, zoom: 3.1 }], [50, { lon: 115, lat: 22, zoom: 2.5 }]], captions: [],
  });
  shot(b, {
    name: '6 Marco Polo, 1271 to 1295', title: 'Marco Polo', subtitle: 'Venice to Xanadu and back', precision: 'month', characters: true, trails: true, eventsBox: groups(['Travellers']),
    time: [[0, J(1271, 5, 1)], [50, J(1295, 2, 1)]], camera: [[0, { lon: 60, lat: 38, zoom: 1.6 }], [50, { lon: 70, lat: 30, zoom: 1.6 }]], captions: [],
  });
  shot(b, {
    name: '7 Four khanates, 1260 to 1368', title: 'Four khanates', subtitle: 'The empire divided, and its ends', precision: 'year', stats: STATS, eventsBox: groups(['Four khanates', 'China and the east']),
    time: [[0, J(1258, 1, 1)], [50, J(1369, 1, 1)]], camera: [[0, { lon: 75, lat: 44, zoom: 1.7 }], [50, { lon: 75, lat: 44, zoom: 1.7 }]], captions: [],
  });
  shot(b, {
    name: '8 Timur, 1370 to 1405', title: 'Timur', subtitle: '1370 to 1405', precision: 'month', characters: true, trails: true, eventsBox: groups(['Timur']),
    time: [[0, J(1370, 1, 1)], [50, J(1405, 3, 1)]], camera: [[0, { lon: 62, lat: 38, zoom: 2.7 }], [25, { lon: 55, lat: 40, zoom: 2.5 }], [50, { lon: 58, lat: 38, zoom: 2.5 }]], captions: [],
  });
  shot(b, {
    name: '9 Two centuries in two minutes, 1206 to 1405', title: 'The Mongol Empire', subtitle: '1206 to 1405', precision: 'year', stats: STATS, eventsBox: groups(['Genghis Khan', 'The western campaigns', 'China and the east', 'Four khanates', 'Timur']),
    time: [[0, J(1206, 1, 1)], [120, J(1405, 12, 31)]], camera: [[0, { lon: 85, lat: 45, zoom: 1.5 }], [120, { lon: 75, lat: 42, zoom: 1.5 }]], captions: [],
  });
}
