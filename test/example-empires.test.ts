// "The End of Empires, 1945 to 1999" (D178): built from its script into a projects folder, its history whole (no
// conflicts), well over a hundred events; colonies held by their empires and passing to their independent states,
// with the names they had then; the pieces cut out of today's countries (Goa, Aden, the Golan, Crimea, the Saar,
// Zanzibar, West New Guinea, Spanish Morocco, Newfoundland) where and when the sources put them; wars that move
// borders and give them back (Korea, Biafra, Katanga, the Ogaden, Kuwait, the Falklands); shots and statistics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectRegistry } from '../src/server/projects.ts';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import { EXAMPLES } from '../src/examples/index.ts';
import { T } from '../src/examples/empires.ts';
import { statisticsOf } from '../src/world-model/world-settings.ts';
import { fillStatistics } from '../src/presentation/statistics.ts';
import { lonLatToVec } from '../src/geo-kernel/vec.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the End of Empires example builds into a whole history of the world, 1945 to 1999', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mapmaker-example-'));
  try {
    const reg = new ProjectRegistry(dir);
    const info = EXAMPLES.find((e) => e.id === 'end-of-empires')!.build(reg, join(ROOT, 'data'));
    const world = World.fromSnapshot(reg.get(info.id).snapshot());
    const engine = new Engine(world);
    assert.deepEqual(engine.conflicts.map((c) => c.message), [], 'no conflicting or broken changes');
    assert.ok(world.all('event').length >= 200, `${world.all('event').length} events`);
    const space = world.all('map_space')[0], layer = world.all('layer').find((l) => l.kind === 'partition')!.id;
    const owner = (lon: number, lat: number, when: string) => {
      const id = engine.valueAtPoint(space.id, layer, lonLatToVec(lon, lat), T(when));
      return id ? engine.nameAt(id, T(when)) ?? world.get('entity', id)?.name ?? id : null;
    };
    const wrong: string[] = [];
    const check = (place: string, lon: number, lat: number, story: Array<[string, string]>) => {
      for (const [when, who] of story) { const got = owner(lon, lat, when); if (got !== who) wrong.push(`${place} on ${when}: ${got}, not ${who}`); }
    };
    // Asia
    check('Delhi', 77.21, 28.61, [['1946-01-01', 'British Empire'], ['1948-01-01', 'India']]);
    check('Dhaka', 90.41, 23.81, [['1960-01-01', 'Pakistan'], ['1972-01-01', 'Bangladesh']]);
    check('Hyderabad', 78.47, 17.38, [['1948-08-01', 'Hyderabad'], ['1949-01-01', 'India']]);
    check('Goa', 74.0, 15.35, [['1950-01-01', 'Portuguese Empire'], ['1962-01-01', 'India']]);
    check('Pondicherry', 79.83, 11.93, [['1950-01-01', 'French Union'], ['1955-01-01', 'India']]);
    check('Gangtok', 88.61, 27.33, [['1960-01-01', 'Sikkim'], ['1976-01-01', 'India']]);
    check('Lhasa', 91.11, 29.65, [['1946-01-01', 'Tibet'], ['1952-01-01', 'People\'s Republic of China']]);
    check('Rangoon', 96.16, 16.8, [['1949-01-01', 'Burma'], ['1990-01-01', 'Myanmar']]);
    check('Jakarta', 106.85, -6.2, [['1946-01-01', 'Netherlands'], ['1950-03-01', 'Indonesia']]);
    check('Hollandia', 140.7, -2.53, [['1950-06-01', 'Netherlands'], ['1964-01-01', 'Indonesia']]);
    check('Dili', 125.57, -8.56, [['1975-12-05', 'East Timor'], ['1980-01-01', 'Indonesia'], ['1999-12-15', 'UN Transitional Administration in East Timor']]);
    check('Kuala Lumpur', 101.69, 3.14, [['1958-01-01', 'Malaya'], ['1964-01-01', 'Malaysia']]);
    check('Kuching', 110.35, 1.55, [['1958-01-01', 'British Empire'], ['1964-01-01', 'Malaysia']]);
    check('Singapore', 103.82, 1.35, [['1964-01-01', 'Malaysia'], ['1966-01-01', 'Singapore']]);
    check('Hanoi', 105.85, 21.03, [['1950-01-01', 'French Union'], ['1955-01-01', 'North Vietnam'], ['1977-01-01', 'Vietnam']]);
    check('Saigon', 106.7, 10.78, [['1955-01-01', 'South Vietnam'], ['1975-06-01', 'North Vietnam'], ['1977-01-01', 'Vietnam']]);
    check('Phnom Penh', 104.92, 11.56, [['1976-01-01', 'Democratic Kampuchea'], ['1980-01-01', 'People\'s Republic of Kampuchea']]);
    check('Seoul', 126.98, 37.57, [['1945-08-20', 'Empire of Japan'], ['1946-01-01', 'United States of America'], ['1949-01-01', 'South Korea'], ['1950-08-15', 'North Korea'], ['1950-11-15', 'South Korea'], ['1951-01-20', 'North Korea'], ['1952-01-01', 'South Korea']]);
    check('Pyongyang', 125.75, 39.03, [['1946-01-01', 'Soviet Union'], ['1949-01-01', 'North Korea'], ['1950-11-20', 'South Korea'], ['1951-06-01', 'North Korea']]);
    // Korea divided at the 38th parallel, and at the armistice line after the war.
    check('Kaesong', 126.55, 37.97, [['1946-01-01', 'United States of America'], ['1949-01-01', 'South Korea'], ['1954-01-01', 'North Korea']]);
    check('Sokcho', 128.59, 38.2, [['1946-01-01', 'Soviet Union'], ['1949-01-01', 'North Korea'], ['1954-01-01', 'South Korea']]);
    check('Taipei', 121.56, 25.04, [['1945-08-20', 'Empire of Japan'], ['1945-09-10', 'Occupied Japan'], ['1946-01-01', 'Republic of China'], ['1950-01-01', 'Republic of China (Taiwan)']]);
    check('Naha', 127.68, 26.21, [['1946-01-01', 'United States of America'], ['1973-01-01', 'Japan']]);
    check('Hong Kong', 114.1, 22.45, [['1960-01-01', 'British Empire'], ['1990-01-01', 'United Kingdom'], ['1998-01-01', 'People\'s Republic of China']]);
    check('Macau', 113.52, 22.22, [['1999-12-01', 'Portugal'], ['2000-01-01', 'People\'s Republic of China']]);
    // The Middle East
    check('East Jerusalem', 35.23, 31.78, [['1946-01-01', 'British Empire'], ['1950-01-01', 'Jordan'], ['1968-01-01', 'Israel']]);
    check('Gaza', 34.45, 31.5, [['1950-01-01', 'Egypt'], ['1959-01-01', 'United Arab Republic'], ['1968-01-01', 'Israel'], ['1995-01-01', 'Palestinian Authority']]);
    check('The Golan', 35.75, 33.0, [['1946-01-01', 'French colonial empire'], ['1947-01-01', 'Syria'], ['1959-01-01', 'United Arab Republic'], ['1962-01-01', 'Syria'], ['1968-01-01', 'Israel']]);
    check('Sinai', 33.8, 29.5, [['1968-01-01', 'Israel'], ['1983-01-01', 'Egypt']]);
    check('Kuwait', 47.98, 29.37, [['1960-01-01', 'British Empire'], ['1962-01-01', 'Kuwait'], ['1990-09-01', 'Iraq'], ['1992-01-01', 'Kuwait']]);
    check('Aden', 45.0, 12.9, [['1960-01-01', 'British Empire'], ['1968-01-01', 'South Yemen'], ['1991-01-01', 'Yemen']]);
    check('Sanaa', 44.2, 15.35, [['1960-01-01', 'North Yemen'], ['1991-01-01', 'Yemen']]);
    check('Kyrenia', 33.32, 35.34, [['1970-01-01', 'Cyprus'], ['1975-01-01', 'Turkish Cypriot zone'], ['1984-01-01', 'Turkish Republic of Northern Cyprus']]);
    // Africa
    check('Algiers', 3.06, 36.75, [['1955-01-01', 'French Union'], ['1959-01-01', 'French Community'], ['1963-01-01', 'Algeria']]);
    check('Rabat', -6.84, 34.02, [['1955-01-01', 'French Union'], ['1957-01-01', 'Morocco']]);
    check('Tetouan', -5.37, 35.57, [['1955-01-01', 'Spain'], ['1957-01-01', 'Morocco']]);
    check('Tangier', -5.83, 35.76, [['1955-01-01', 'Tangier International Zone'], ['1957-01-01', 'Morocco']]);
    check('Laayoune', -13.2, 27.15, [['1970-01-01', 'Spain'], ['1977-01-01', 'Morocco']]);
    check('Tiris al-Gharbiya', -15.8, 23.9, [['1977-01-01', 'Mauritania'], ['1980-01-01', 'Morocco']]);
    check('Beyond the wall', -10.0, 26.5, [['1970-01-01', 'Spain'], ['1977-01-01', 'Morocco'], ['1990-01-01', 'Sahrawi Republic']]);
    check('Kinshasa', 15.31, -4.32, [['1959-01-01', 'Belgium'], ['1961-01-01', 'Republic of the Congo (Léopoldville)'], ['1980-01-01', 'Zaire'], ['1998-01-01', 'Democratic Republic of the Congo']]);
    check('Elisabethville', 27.48, -11.66, [['1961-06-01', 'State of Katanga'], ['1964-01-01', 'Republic of the Congo (Léopoldville)'], ['1965-01-01', 'Democratic Republic of the Congo']]);
    check('Enugu', 7.5, 6.45, [['1967-06-15', 'Biafra'], ['1971-01-01', 'Nigeria']]);
    check('Umuahia', 7.49, 5.53, [['1969-06-01', 'Biafra'], ['1971-01-01', 'Nigeria']]);
    check('Salisbury', 31.05, -17.83, [['1966-01-01', 'Rhodesia'], ['1981-01-01', 'Zimbabwe']]);
    check('Dar es Salaam', 39.28, -6.8, [['1962-01-01', 'Tanganyika'], ['1965-01-01', 'Tanzania']]);
    check('Zanzibar', 39.25, -6.1, [['1962-01-01', 'British Empire'], ['1964-03-01', 'Zanzibar'], ['1965-01-01', 'Tanzania']]);
    check('Antananarivo', 47.52, -18.91, [['1961-01-01', 'Malagasy Republic'], ['1976-03-01', 'Madagascar']]);
    check('Windhoek', 17.08, -22.56, [['1980-01-01', 'South Africa'], ['1991-01-01', 'Namibia']]);
    check('Luanda', 13.23, -8.84, [['1970-01-01', 'Portuguese Empire'], ['1976-01-01', 'Angola']]);
    check('Mogadishu', 45.2, 2.2, [['1949-01-01', 'British Empire'], ['1955-01-01', 'Italy'], ['1961-01-01', 'Somalia']]);
    check('Hargeisa', 44.06, 9.56, [['1960-06-30', 'State of Somaliland'], ['1961-01-01', 'Somalia'], ['1992-01-01', 'Somaliland']]);
    check('Jijiga', 42.8, 9.35, [['1977-11-01', 'Somalia'], ['1979-01-01', 'Ethiopia']]);
    check('Asmara', 38.93, 15.33, [['1950-01-01', 'British Empire'], ['1953-01-01', 'Ethiopia'], ['1994-01-01', 'Eritrea']]);
    check('Cotonou', 2.42, 6.37, [['1961-01-01', 'Dahomey'], ['1976-01-01', 'Benin']]);
    check('Ouagadougou', -1.52, 12.37, [['1961-01-01', 'Upper Volta'], ['1985-01-01', 'Burkina Faso']]);
    check('Bangui', 18.56, 4.36, [['1978-01-01', 'Central African Empire'], ['1980-01-01', 'Central African Republic']]);
    // Europe, the Soviet Union and the Americas
    check('Kiev', 30.52, 50.45, [['1990-01-01', 'Soviet Union'], ['1992-01-01', 'Ukraine']]);
    check('Simferopol', 34.1, 44.95, [['1990-01-01', 'Soviet Union'], ['1992-01-01', 'Ukraine']]);
    check('Moscow', 37.62, 55.75, [['1990-01-01', 'Soviet Union'], ['1992-01-01', 'Russia']]);
    check('East Berlin', 13.41, 52.52, [['1946-01-01', 'Allied-occupied Germany'], ['1950-01-01', 'East Germany'], ['1991-01-01', 'Germany']]);
    check('West Berlin', 13.25, 52.50, [['1950-01-01', 'West Germany']]);
    check('Hannover', 9.73, 52.37, [['1950-01-01', 'West Germany'], ['1991-01-01', 'Germany']]);
    check('Saarbrücken', 6.99, 49.24, [['1950-01-01', 'Saar Protectorate'], ['1958-01-01', 'West Germany']]);
    check('Vienna', 16.37, 48.21, [['1950-01-01', 'Allied-occupied Austria'], ['1956-01-01', 'Austria']]);
    check('Ljubljana', 14.5, 46.05, [['1990-01-01', 'Yugoslavia'], ['1992-01-01', 'Slovenia']]);
    check('Belgrade', 20.46, 44.8, [['1993-01-01', 'Federal Republic of Yugoslavia']]);
    check('Pristina', 21.16, 42.66, [['1999-01-01', 'Federal Republic of Yugoslavia'], ['1999-08-01', 'UN Mission in Kosovo']]);
    check('Bratislava', 17.11, 48.15, [['1992-01-01', 'Czechoslovakia'], ['1994-01-01', 'Slovakia']]);
    check('St John\'s', -52.71, 47.56, [['1948-01-01', 'British Empire'], ['1950-01-01', 'Canada']]);
    check('Stanley', -57.85, -51.69, [['1982-05-01', 'Argentina'], ['1983-01-01', 'United Kingdom']]);
    assert.deepEqual(wrong, [], 'every place held by whom the sources say, when they say');
    // Shots and statistics.
    assert.equal(world.all('sequence').length, 10);
    const stats = statisticsOf(space);
    assert.equal(fillStatistics('{UN members}', stats, T('1960-12-31')), '99');
    assert.equal(fillStatistics('{UN members}', stats, T('1999-12-31')), '188');
    const fresh = Number(fillStatistics('{New states}', stats, T('1999-12-31')));
    assert.ok(fresh >= 100, `${fresh} new states`);
    reg.closeAll();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
