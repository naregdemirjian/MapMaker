# The planetary engine: Earth-like validation

Made by `node --experimental-strip-types bench/planet.bench.ts --validate` (Stage 14.11, D162). Distributions, not
maps: a simulated Earth-like planet is a different planet; where the real Earth is used, its heights are measured
and everything else is this engine's. Measured values are approximate climatologies and references in D157 to D162.

## A simulated Earth-like planet (preset "Earth-like", seed 1, 500 Myr at the preview level)

| Measure | This planet | The Earth |
| --- | --- | --- |
| Land share | 29 % | 29 % |
| Hypsometry: the two peaks (500 m bins) | 0 to 500 m and -4,500 to -4,000 m | 0 to 1,000 m and −4,000 to −5,000 m |
| Surface above 2 km | 2.3 % | about 3 % (11 % of the land), about 1 % without the ice sheets' surfaces |
| Sea floor deepening with age (younger than 80 Myr) | 0.23 km per √Myr | 0.35 (GDH1: 2.6 km over 64 Myr) |
| The sea's level over the history | -189 to 102 m | about −120 to +250 m over the last 500 Myr |
| Ice on land over the history | 2.1 to 14.4 million km³ | 0 to about 80 (today 30) |
| Mean temperature at the surface | 15.1 °C | 15 °C |
| Within 10° of the equator / beyond 70° | 27.0 / -17.1 °C | 27 / −15 to −30 °C |
| Rain and snow, the planet's mean | 1,329 mm a year | about 1,000 |
| Rain within 10° of the equator / at 20-30° | 3,486 / 547 mm | about 2,000 / 700 |
| The sea's currents: warm western sides, cool eastern | 7.6 % of cells warmed (mean +1.1 K), 6.6 % cooled (-1.1 K) | as the Gulf Stream and Kuroshio, the Canary and Humboldt |
| Deserts and steppe: land at 15-35° / within 10° | 60 / 0 % | the subtropical belts / few |
| Tropical forest within 10° | 87 % | most |
| Boreal forest at 50-65°; tundra, polar desert and ice beyond 65° | 42 %; 90 % | most; most |
| An earlier moment's biomes (worked out quickly from its own climate, D167), tried on today | the same biome on 84 % of the land, 91 % besides lakes and wetlands; deserts 10.5 % of the land (the full stages: 11.4 %) | — |
| Hack's law: main stream length ∝ area^h | h = 0.54 (53 cells draining over 20 cells) | 0.5 to 0.6 |

## The real Earth's heights with this engine's climate, water and biomes (level 5)

| Place | Temperature, model (measured) | Rain and snow, model (measured) |
| --- | --- | --- |
| Singapore | 26.4 °C (27.5) | 4,244 mm (2,300) |
| Manaus | 25.9 °C (27) | 2,161 mm (2,300) |
| Lagos | 24.3 °C (27) | 2,047 mm (1,500) |
| Kinshasa | 23.4 °C (25.5) | 1,156 mm (1,400) |
| Mumbai | 21.7 °C (27) | 700 mm (2,200) |
| Delhi | 24.2 °C (25) | 78 mm (800) |
| Riyadh | 22.4 °C (26) | 390 mm (100) |
| Cairo | 22.8 °C (22) | 291 mm (25) |
| Khartoum | 25.6 °C (30) | 1,003 mm (160) |
| Phoenix | 17.5 °C (24) | 112 mm (200) |
| Atlanta | 19.8 °C (17) | 399 mm (1,250) |
| Chicago | 15.1 °C (10) | 727 mm (940) |
| Beijing | 13.0 °C (13) | 738 mm (570) |
| Shanghai | 16.1 °C (17) | 839 mm (1,150) |
| Madrid | 9.7 °C (15) | 707 mm (420) |
| Paris | 10.2 °C (12) | 1,389 mm (640) |
| Moscow | 5.1 °C (6) | 911 mm (700) |
| Yakutsk | -7.3 °C (-9) | 336 mm (240) |
| Buenos Aires | 14.5 °C (18) | 490 mm (1,200) |
| Sydney | 10.6 °C (18) | 2,198 mm (1,200) |
| Alice Springs | 19.4 °C (21) | 257 mm (280) |
| Cape Town | 15.6 °C (17) | 654 mm (520) |

Over these 22 places the yearly temperature's error is 3.4 K (root mean square) and rain's 0.82 in natural logarithms (0.69 is a factor of two).

Water on land: rain and snow 114,370 km³ a year (measured about 113,000), evaporated 75,809 (73,000), running off 38,561 (40,000), reaching the sea 37,713; lakes 51,811 km³ and salt lakes 7,644 km³ (91,000 and 85,000).

Köppen-Geiger's main classes as shares of the land: A 20 %, B 30 %, C 14 %, D 18 %, E 18 % (measured A 19, B 30, C 13, D 25, E 12 per cent).

## Where it differs, and why

- Since D165 the energy balance carries the sea's heat (taken up in the tropics, given off further poleward, none
  across the Southern Ocean's circumpolar channel, 0.5 PW carried north across the equator), the winds carry the
  air's heat along the parallels (westerlies, trades, stronger in winter), each cell's land has its own temperature,
  ice sheets keep their snow all year and the sea is cloudier than the land: the zonal means come within about 1 K
  of the Earth's from 80° N to 60° S and Antarctica's plateau nearly as cold as measured. Still missing: winds
  that follow the pressure (the winter's northerlies down eastern North America and Asia), so east coasts' winters
  are too mild and western Europe's summers too cool.
- Rain (D165): the deep tropics too wet and the planet's mean too high; northern India's monsoon too dry (its
  moisture does not reach 1,000 km inland); a city in a climate cell that is mostly sea takes the sea's rain (Cairo's
  480 km cell is three-quarters Mediterranean).
- Narrow ranges are blurred at the climate's 480 km cells: rain shadows are weaker than measured (D158).
- Lakes (D166): at the preview level a cell's mean height hides gorges and straits. Deep basins behind low sills
  join the sea (the Black and Red Seas) and outlets are cut by most of their hollows' depth, but plateau basins
  whose gorges lie further off keep shallow lakes (British Columbia's, the Congo's, Lake Chad's much larger than
  its own), the deep lakes that hold most of the measured water (Baikal, Tanganyika, Superior) are narrower than a
  cell, and the Caspian fills to the sea's level and joins it.
- The deep sea floor (D166): old floor now founders as on the Earth (the floor's mean age 47 to 67 Myr over four
  seeds against 64), so its depths' peak lies between 3 and 5.5 km by planet (the Earth's 4 to 5 km).
- A simulated planet is a different planet: its numbers are to be read as plausible, not as the Earth's.
