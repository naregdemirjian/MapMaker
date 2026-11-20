# The planetary engine: Earth-like validation

Made by `node --experimental-strip-types bench/planet.bench.ts --validate` (Stage 14.11, D162). Distributions, not
maps: a simulated Earth-like planet is a different planet; where the real Earth is used, its heights are measured
and everything else is this engine's. Measured values are approximate climatologies and references in D157 to D162.

## A simulated Earth-like planet (preset "Earth-like", seed 1, 500 Myr at the preview level)

| Measure | This planet | The Earth |
| --- | --- | --- |
| Land share | 29 % | 29 % |
| Hypsometry: the two peaks (500 m bins) | 0 to 500 m and -6,000 to -5,500 m | 0 to 1,000 m and −4,000 to −5,000 m |
| Surface above 2 km | 0.1 % | about 3 % (11 % of the land) |
| Sea floor deepening with age (younger than 80 Myr) | 0.29 km per √Myr | 0.35 (GDH1: 2.6 km over 64 Myr) |
| The sea's level over the history | -425 to 131 m | about −120 to +250 m over the last 500 Myr |
| Ice on land over the history | 0.3 to 8.3 million km³ | 0 to about 80 (today 30) |
| Mean temperature at the surface | 15.0 °C | 15 °C |
| Within 10° of the equator / beyond 70° | 26.4 / -18.8 °C | 27 / −15 to −30 °C |
| Rain and snow, the planet's mean | 1,305 mm a year | about 1,000 |
| Rain within 10° of the equator / at 20-30° | 3,483 / 477 mm | about 2,000 / 700 |
| The sea's currents: warm western sides, cool eastern | 8.6 % of cells warmed (mean +1.2 K), 7.6 % cooled (-1.2 K) | as the Gulf Stream and Kuroshio, the Canary and Humboldt |
| Deserts and steppe: land at 15-35° / within 10° | 73 / 0 % | the subtropical belts / few |
| Tropical forest within 10° | 85 % | most |
| Boreal forest at 50-65°; tundra, polar desert and ice beyond 65° | 38 %; 82 % | most; most |
| Hack's law: main stream length ∝ area^h | h = 0.54 (64 cells draining over 20 cells) | 0.5 to 0.6 |

## The real Earth's heights with this engine's climate, water and biomes (level 5)

| Place | Temperature, model (measured) | Rain and snow, model (measured) |
| --- | --- | --- |
| Singapore | 26.5 °C (27.5) | 4,253 mm (2,300) |
| Manaus | 25.9 °C (27) | 2,163 mm (2,300) |
| Lagos | 24.3 °C (27) | 2,048 mm (1,500) |
| Kinshasa | 23.4 °C (25.5) | 1,155 mm (1,400) |
| Mumbai | 21.7 °C (27) | 702 mm (2,200) |
| Delhi | 24.3 °C (25) | 78 mm (800) |
| Riyadh | 22.5 °C (26) | 391 mm (100) |
| Cairo | 22.8 °C (22) | 291 mm (25) |
| Khartoum | 25.6 °C (30) | 1,003 mm (160) |
| Phoenix | 17.5 °C (24) | 113 mm (200) |
| Atlanta | 19.8 °C (17) | 400 mm (1,250) |
| Chicago | 15.1 °C (10) | 729 mm (940) |
| Beijing | 13.1 °C (13) | 740 mm (570) |
| Shanghai | 16.2 °C (17) | 842 mm (1,150) |
| Madrid | 9.7 °C (15) | 708 mm (420) |
| Paris | 10.2 °C (12) | 1,391 mm (640) |
| Moscow | 5.1 °C (6) | 911 mm (700) |
| Yakutsk | -7.3 °C (-9) | 337 mm (240) |
| Buenos Aires | 14.4 °C (18) | 488 mm (1,200) |
| Sydney | 10.5 °C (18) | 2,190 mm (1,200) |
| Alice Springs | 19.4 °C (21) | 257 mm (280) |
| Cape Town | 15.5 °C (17) | 651 mm (520) |

Over these 22 places the yearly temperature's error is 3.4 K (root mean square) and rain's 0.82 in natural logarithms (0.69 is a factor of two).

Water on land: rain and snow 117,646 km³ a year (measured about 113,000), evaporated 78,119 (73,000), running off 39,527 (40,000), reaching the sea 35,154; lakes 294,692 km³ and salt lakes 172,494 km³ (91,000 and 85,000).

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
- Lakes come out about twice the measured volume: whole cells of 12,000 to 50,000 km² and a too-dry eastern Europe
  (the Black Sea closed below sea level) (D159).
- A simulated planet is a different planet: its numbers are to be read as plausible, not as the Earth's.
