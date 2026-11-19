# The planetary engine: Earth-like validation

Made by `node --experimental-strip-types bench/planet.bench.ts --validate` (Stage 14.11, D162). Distributions, not
maps: a simulated Earth-like planet is a different planet; where the real Earth is used, its heights are measured
and everything else is this engine's. Measured values are approximate climatologies and references in D157 to D162.

## A simulated Earth-like planet (preset "Earth-like", seed 1, 500 Myr at the preview level)

| Measure | This planet | The Earth |
| --- | --- | --- |
| Land share | 29 % | 29 % |
| Hypsometry: the two peaks (500 m bins) | 0 to 500 m and -6,000 to -5,500 m | 0 to 1,000 m and −4,000 to −5,000 m |
| Surface above 2 km | 0.2 % | about 3 % (11 % of the land) |
| Sea floor deepening with age (younger than 80 Myr) | 0.28 km per √Myr | 0.35 (GDH1: 2.6 km over 64 Myr) |
| The sea's level over the history | -303 to 287 m | about −120 to +250 m over the last 500 Myr |
| Ice on land over the history | 0.1 to 3.3 million km³ | 0 to about 80 (today 30) |
| Mean temperature at the surface | 16.0 °C | 15 °C |
| Within 10° of the equator / beyond 70° | 27.8 / -10.3 °C | 27 / −15 to −30 °C |
| Rain and snow, the planet's mean | 1,317 mm a year | about 1,000 |
| Rain within 10° of the equator / at 20-30° | 3,635 / 659 mm | about 2,000 / 700 |
| The sea's currents: warm western sides, cool eastern | 8.7 % of cells warmed (mean +1.2 K), 5.5 % cooled (-1.2 K) | as the Gulf Stream and Kuroshio, the Canary and Humboldt |
| Deserts and steppe: land at 15-35° / within 10° | 51 / 0 % | the subtropical belts / few |
| Tropical forest within 10° | 96 % | most |
| Boreal forest at 50-65°; tundra, polar desert and ice beyond 65° | 46 %; 68 % | most; most |
| Hack's law: main stream length ∝ area^h | h = 0.49 (33 cells draining over 20 cells) | 0.5 to 0.6 |

## The real Earth's heights with this engine's climate, water and biomes (level 5)

| Place | Temperature, model (measured) | Rain and snow, model (measured) |
| --- | --- | --- |
| Singapore | 27.8 °C (27.5) | 4,459 mm (2,300) |
| Manaus | 25.4 °C (27) | 1,823 mm (2,300) |
| Lagos | 24.0 °C (27) | 1,635 mm (1,500) |
| Kinshasa | 22.2 °C (25.5) | 642 mm (1,400) |
| Mumbai | 19.9 °C (27) | 1,076 mm (2,200) |
| Delhi | 20.4 °C (25) | 148 mm (800) |
| Riyadh | 17.3 °C (26) | 448 mm (100) |
| Cairo | 17.7 °C (22) | 481 mm (25) |
| Khartoum | 20.6 °C (30) | 550 mm (160) |
| Phoenix | 16.1 °C (24) | 70 mm (200) |
| Atlanta | 17.9 °C (17) | 240 mm (1,250) |
| Chicago | 13.6 °C (10) | 277 mm (940) |
| Beijing | 13.7 °C (13) | 698 mm (570) |
| Shanghai | 18.2 °C (17) | 606 mm (1,150) |
| Madrid | 4.6 °C (15) | 330 mm (420) |
| Paris | 4.5 °C (12) | 777 mm (640) |
| Moscow | -1.1 °C (6) | 358 mm (700) |
| Yakutsk | -3.9 °C (-9) | 269 mm (240) |
| Buenos Aires | 15.6 °C (18) | 430 mm (1,200) |
| Sydney | 12.7 °C (18) | 1,898 mm (1,200) |
| Alice Springs | 19.0 °C (21) | 242 mm (280) |
| Cape Town | 14.3 °C (17) | 435 mm (520) |

Over these 22 places the yearly temperature's error is 5.4 K (root mean square) and rain's 0.85 in natural logarithms (0.69 is a factor of two).

Water on land: rain and snow 88,411 km³ a year (measured about 113,000), evaporated 63,861 (73,000), running off 24,550 (40,000), reaching the sea 22,062; lakes 197,639 km³ and salt lakes 76,966 km³ (91,000 and 85,000).

Köppen-Geiger's main classes as shares of the land: A 13 %, B 42 %, C 12 %, D 13 %, E 20 % (measured A 19, B 30, C 13, D 25, E 12 per cent).

## Where it differs, and why

- The coarse energy balance smooths contrasts under about 3,000 km and leaves the northern subtropical seas cool;
  so mid-latitude continents get a third to a half of their rain (more steppe and B climates than the Earth has,
  fewer D), and Antarctica runs 10 to 20 K warm (D157, D159).
- Narrow ranges are blurred at the climate's 480 km cells: rain shadows are weaker than measured (D158).
- Lakes come out about twice the measured volume: whole cells of 12,000 to 50,000 km² and a too-dry eastern Europe
  (the Black Sea closed below sea level) (D159).
- A simulated planet is a different planet: its numbers are to be read as plausible, not as the Earth's.
