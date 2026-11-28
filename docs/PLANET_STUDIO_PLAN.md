# Planet Studio overhaul: a foundation that reacts, then a full-detail map (plan, 28 November 2026)

## Context
The simulated planet (Planet Studio) is the most important feature of the app, and today it fails in three ways:
sliders barely change the picture, changes cannot be traced to a cause, and extreme settings still give an
Earth-like world. This plan explains why, from reading the code and from running today's engine on test planets.
It then proposes the rebuild in two stages: a fast, explained **foundation**, then a **full-detail map**.
Approved by the user on 28 November 2026 with the defaults of section 9; built step by step (section 10).

Numbers marked *measured* were measured in this session, on one core of a processor slower than yours.
Numbers marked *estimate* are not yet proven.

---

## 1. Why the problems happen

### Problem 1: sliders barely change the picture
- **The picture is empty until you press "Simulate".** In steps 1 to 6 only the numbers on the right change.
- **The default picture is coloured by height only** (the "Relief" layer): blue below sea level, green low
  ground, brown and white mountains. No star, orbit, air or life setting can reach it. The green is not grass;
  it means "low ground". A map made from the planet starts with the same height-only colours.
- **After a change to a geology setting, the picture freezes** on the old planet until "Simulate again", and
  ignores every other slider meanwhile.
- **The amount of sea is pinned to its slider.** *Measured:* sea covers 71 to 72 % of the planet at 15 °C,
  at 2,548 °C and at −136 °C alike.
- **Colour scales hide extremes.** The temperature colours stop at ±50 °C, so 60 °C and 2,000 °C look the same.
  The sunlight picture is rescaled to its own range, so a brighter star looks identical.

### Problem 2: when something changes, you can't tell why
- **"Simulate again" quietly makes a different planet.** The climate feeds into the plate history, and the
  history is touchy. *Measured:* after changing only the tilt (23° to 60°), or carbon dioxide (×10), or cloud
  cover, land and sea swap on 38 to 41 % of the planet (34 to 44 % across ten settings tried). Two unrelated
  planets differ by 41 %. The slider's own effect is buried under completely new continents.
- **The "Detail" choice also makes a different planet.** *Measured:* the same settings at two detail levels
  disagree on land and sea in 38 % of places. Today's preview does not promise what the finer version shows.
- **The side panel and the map can disagree.** The panel's temperature is a quick estimate, not the map's own
  calculation. *Measured* on the Mars-like preset: −61 °C in the panel, −121 °C on the map.
- **The screen never says what just changed.** It explains single settings and single places, not "you moved
  this, so that happened".

### Problem 3: extreme settings still give water, green and islands
*Measured with today's engine, Earth-like settings except the one named:*

| Planet | Average temperature | What the engine draws |
|---|---|---|
| 0.3 AU from a Sun-like star (Earth is at 1 AU) | 2,548 °C | Sea on 72 %, 503 mm of rain a year |
| 0.6 AU | 1,724 °C | Sea on 71 %, 1,162 mm of rain a year |
| 3 AU | −136 °C | Liquid sea on 71 %, land all ice |
| Air at 0.001 bar | −49 °C | Liquid sea on 71 % |

The causes in the code:
- The sea is a fixed share of the surface. Nothing can boil it, freeze it over or remove it.
- The engine does detect "the oceans would boil away", but only adds a sentence: "the temperatures shown assume
  the water somehow stays".
- Rain is worked out as if the air were never hotter than 30 °C, so a furnace world still gets tropical rain.
- The biome rules have "too cold" and "too dry" but no "too hot". A "bare rock" class exists but is never used.
- "No plants" only recolours the same biomes.
- **A separate defect:** with the sea set to zero, the planet loses all its relief. *Measured:* the Mars-like
  and Venus-like presets record every point at 32,000 m.
- And the default picture is the height picture anyway (problem 1), so it shows blue and green whatever happens.

---

## 2. Stage 1: the foundation (the Planet Studio screen)

### What you will see
- **A planet is always on screen**, drawn as seen from space, for the sliders as they are now. No "Simulate"
  button is needed and the picture is never silently out of date.
- **Two speeds, stated on screen.** Star, orbit, tilt, day, air, water and life sliders redraw in under a second
  and keep the land where it is. Geology sliders make new land and take a few seconds, with a progress bar.
- **"Why it looks like this"**: a short chain of causes with numbers. Example: "Sunlight 11× Earth's → more
  than oceans can survive → the water boiled away and was lost → no rain, rivers or plants → bare rock at
  about 200 °C".
- **"What changed"**: after every slider move, the before and after figures (temperature, sea, ice, desert,
  forest) and a button that highlights the changed areas on the picture.
- **Tipping points marked on the sliders**: coloured zones and ticks such as "oceans boil beyond here" and
  "freezes over beyond here".
- **Click any point** for its height, temperature by month, rain, wind, ice, water, surface type and the reason.
- **One source for every number**: the side panel reads the same calculation as the picture.

### The science model, in order
Each step uses only the steps above it, so every result has a traceable cause.

1. **Star and orbit** → how much sunlight arrives, the seasons, the length of the year. *(Exists.)*
2. **The planet's body** → gravity, heat from the interior, whether it has moving plates. *(Exists.)*
3. **Geology** → plates move over hundreds of millions of years and build continents, mountains and ocean
   floor. *(Exists. Change: it no longer depends on the climate or the amount of water, so the same seed always
   gives the same land. One exception from real physics: a planet given no water at all has no moving plates.)*
4. **Air and water state** *(new)* → can the planet keep its air; is water liquid, steam, ice or lost; how high
   the sea stands, from the amount of water and the shape of the land.
5. **Climate** → temperature through the year, winds, rain. *(Exists. Change: rain only where water can be
   liquid; snow only where there is water; airless worlds get plain sunlight-against-heat-loss physics with a
   day side and a night side.)*
6. **Ice, rivers and lakes** → ice sheets, frozen seas, rivers by the water they carry, lakes. *(Mostly exists.
   New: frozen sea is a surface of its own.)*
7. **Surface and life** *(new)* → what the ground is (open sea, sea ice, ice sheet, bare rock, scorched rock,
   lava, sand, salt flat) and what grows, only where water can be liquid and life is switched on.
8. **Picture and explanations.**

The limits come from published work that is already half-built into the engine: the sunlight at which oceans
boil away, the pressure below which water cannot be liquid, and a greenhouse fit that reproduces Earth, Mars
and Venus.

### What each slider controls
| Slider | What it changes on the planet | Speed |
|---|---|---|
| Star (mass, brightness) | Sunlight; where the hot and cold limits fall; plant colour | Fast |
| Distance | Temperate → hot desert → oceans boil away → scorched rock → lava; outward → ice age → frozen over | Fast |
| Eccentricity | A hot and a cold season for the whole planet | Fast |
| Axial tilt | Strength of seasons; where the ice sits (high tilt: ice near the equator) | Fast |
| Day length, locked to the star | Number of wind and rain belts; a locked planet has a hot face and a frozen face | Fast |
| Air pressure | Thin: big temperature swings, no liquid water below 0.006 bar. Thick: even and hot | Fast |
| Carbon dioxide | Warmer or colder | Fast |
| Amount of water | Dry basins and salt flats → seas → Earth-like → islands only → ocean world | Fast |
| Life | None, or plants where conditions allow; plant colour | Fast |
| Size and mass | Gravity: height of mountains, and whether the planet keeps its air | New land |
| Interior heat, tectonic activity, plates, continents, hotspots | Number and size of continents, mountain belts, volcanoes | New land |
| Age | Star brightness, interior heat, how worn the land is | New land |
| Seed | A different planet of the same kind | New land |

A slider that fails the "visible effect" test in section 5 is fixed or moved to "More (small effects)".

### The data kept for every point
Height, crust type and age, temperature and rain for each month, wind, ice, sea ice, rivers and lakes, surface
type, plant cover, and the reason for each. It is saved inside the project (about 7 MB, *measured*), so a planet
never changes later, even when the app is improved.

---

## 3. Stage 2: the full map (after you confirm the foundation)

### What is and is not possible on your PC
- **Not possible: the whole planet at satellite detail, made in advance.** At 10 m per pixel a planet is about
  8 trillion pixels (tens of terabytes). Even at 40 m it is over a terabyte and days of computing.
- **Possible, and it is how the Earth map in the app already works:** a whole-planet map at moderate detail,
  plus extra detail for the area you are looking at or exporting, then kept on disk. Earth downloads that
  detail. A simulated planet will calculate it.

### How the detail is made
1. **Whole planet, about 5 km per pixel** (the Earth map's built-in detail is 10 km): made once in the final
   render. Rivers carve valleys by a real erosion calculation driven by the foundation's rain and mountain
   building, so ridges and valleys come from water.
2. **Close-up areas, on demand**: each zoom step repeats that erosion calculation at twice the detail for the
   area in view. Rivers keep their course from the level above and gain bends and smaller tributaries. The
   target is about 40 m per pixel, the Earth map's close-up height detail.
3. **Colour** ("satellite look"): from surface type, plant cover, wetness, slope, snow line and water depth.

**Honest limits on the look.**
- No random texture will be added to fake detail. The app tried that before and withdrew it (decision D194).
  Past the finest calculated level the picture gets smoother, not more detailed.
- How many zoom levels stay convincing is not proven. Step 9 shows you samples before more is built.
- It will read as a clean natural-colour satellite map, not as a photograph. Earth close-ups show fields, roads
  and towns; a wild planet has none.

### How the preview and the full map stay the same planet
- Geology runs once, on one fixed grid. The preview shows that result and the full map refines that same
  result. Nothing is re-rolled at a finer level. (Today it is, which is why "Detail" changes the planet.)
- Each finer level may only add detail smaller than the cells of the level above it.
- **Test:** the full map, averaged back down to the preview's cells, must match the preview: same land and sea
  on at least 97 % of cells (differences only along coasts), same surface type on at least 90 % of land, same
  main rivers, average temperature within 1 °C. A difference picture is made for every test planet.

### Times, memory and file sizes
| What | Number | Basis |
|---|---|---|
| Redraw after a "fast" slider | Target under 0.5 s on your PC | *Measured* 1.2 s on one slow core; the project's record shows 0.5 s using three cores |
| Redraw after a "new land" slider | About 3 to 5 s on your PC | *Estimate*; *measured* 6.2 s on one slow core |
| Foundation saved in the project | About 7 MB | *Measured* |
| Full map, whole planet at 5 km per pixel | About 2 to 5 minutes, 1.5 GB memory, 50 to 100 MB on disk | *Estimate*; one erosion pass over that grid *measured* at 6 s on one slow core |
| Optional whole planet at 2.5 km per pixel | About 10 to 20 minutes, 4 GB memory, 150 to 250 MB on disk | *Estimate* |
| A new close-up area | A few seconds the first time, instant afterwards | *Estimate*, unproven |
| Close-up cache | Capped (default 2 GB), safe to delete, rebuilt on demand | Design |
| Poster of the whole planet | Up to 16,384 pixels wide (A0 at 300 dpi needs 14,043) | Export limit that exists today |

Step 9 measures these on your PC before anything else is built on them.

---

## 4. How it fits the rest of the app
- **Kept:** the geological timeline and its events, scrubbing through the past, "why is this here" cards, edits
  with re-runs, all layers, custom biomes, plant colours, before-and-after comparison, the quick generator.
- **Existing simulated maps keep working exactly as today**, on the old calculation. New planets use the new one.
- **Territories:** coasts come from the full map, so borders that end at the coast follow the detailed coast.
  A frozen sea is still sea for territories; it is drawn as ice. A dry planet is all land.
- **Timeline:** the planet's present day gets the full map. Earlier geological moments stay at foundation detail.
- **Other tools** (smart brushes, fronts slowed by terrain, floods and fires, sea level over time, sculpting,
  hand-drawn rivers) read heights through one shared function and get the finer heights automatically.
- **Export:** exports already wait for Earth's close-up detail frame by frame. Simulated planets will use the
  same path, so videos, stills and posters get the calculated detail.
- **Two controls go away for new planets:** "Re-run the history with this climate" (the history no longer
  depends on the climate) and the "Detail" choice (it made a different planet).

---

## 5. Testing
- **Real planets as anchors:** settings for Mercury, Venus, Earth, Mars and the Moon must give the right kind of
  world and roughly the right temperature.
- **Extreme worlds:** about 16 test planets (next to the star, far out, no air, thick air, no water, all water,
  tilted over, locked to the star, tiny, huge). Each must show its expected surface: for example no sea, rain or
  plants once the oceans have boiled away, and real relief on a dry planet.
- **Every slider:** moved from lowest to highest, the picture must change by a measurable amount and the
  explanation must name that slider.
- **Land stays put:** moving any "fast" slider must leave the land exactly where it was.
- **Preview against full map:** the test in section 3.
- **Same input, same planet,** on every run and with any number of workers.
- **Speed budgets** checked automatically.
- **In the real app:** click-through tests with screenshots, on Linux and on the Windows build.
- **For your eye:** every step ends with a sheet of pictures (all presets, and each slider at five positions).

---

## 6. Build steps (each one is something you can see and try)

**Stage 1: foundation**
1. **A planet always on screen.** Seen-from-space picture by default, drawn on opening, never silently stale.
2. **Same land unless you change geology.** Sliders split into "fast" and "new land". Water becomes an amount.
   Dry planets get their relief back.
3. **Hot worlds.** Oceans boil away; scorched rock and lava; no rain without water; temperature colours that
   cover the whole range.
4. **Cold and airless worlds.** Frozen seas drawn as ice, snowball planets, thin air (Mars-like), no air
   (Moon-like), thick air (Venus-like).
5. **"Why it looks like this" and "What changed"**, with tipping points marked on the sliders.
6. **Every slider earns its place.** The slider test, life settings, and presets for each kind of world
   (Earth-like, hot desert, scorched, lava, Venus-like, ocean world, ice age, snowball, Mars-like, airless,
   locked to its star).
7. **Data at every point, saved with the project.**
8. **The map uses the foundation.** Satellite look by default, ice over frozen seas, rivers only where it rains.

→ You confirm the foundation.

**Stage 2: full map**
9. **Measure your PC, and a look test.** A small build that times the heavy calculations on your computer and
   renders three sample regions at four zooms. You judge the look before more is built.
10. **Whole-planet map** at 5 km per pixel, with the preview-match test.
11. **Close-up detail on demand,** one zoom level at a time, as far as the look holds up.
12. **Rivers and lakes at every zoom.**
13. **Exports and posters** with the calculated detail.
14. **Look of each world type** (ice, dunes, volcanic, cratered) and speed.

Each step follows the usual routine: tests, full check, decision record, docs, commit, push, Windows run.

---

## 7. Risks and what I am not sure of
1. **Shape of the continents.** They come from a coarse plate calculation (cells about 240 km across). The
   erosion refinement has to add believable coasts and ranges below that. Not proven until step 9's samples.
   Fallback: geology one level finer (about 5× slower), or a finer run made to follow the same plate motions.
2. **Seams in close-up detail.** Areas are calculated separately and must meet without visible joins. This is
   the hardest technical part and needs the step 9 prototype. If it cannot be solved, close-ups stop at the
   whole-planet map's detail, and I will say so.
3. **Speed on your PC.** Measured only here. Step 9 settles it. The graphics card is not relied on.
4. **Science at the extremes.** These are the reduced models used for quick studies, checked against five real
   bodies. Numbers for exotic worlds are right in kind and rough size, not in detail. The screen will say so.
5. **Known simplification.** A dried-out sea bed is drawn at the depth it had under water. In reality it would
   rise by about a third. Left for later.
6. **"New land" sliders still reshuffle continents.** Changing the number of plates cannot keep the same land.
   The screen will say "new land".
7. **Size of the work.** Fourteen visible steps. If a step proves larger than expected I will split it, not
   thin it.

---

## 8. Technical notes (for the build, not for reading)
- **Causes:** `src/ui/components/PlanetStudio.tsx:162,269-301,596` (default layer; blank and frozen picture;
  readout from `derive`); `src/ui/planet-colors.ts:17-20,81,128-131`; `src/planet/tectonics/step.ts:493` with
  `isostasy.ts:42-57` and `history.ts:278` (fixed sea share; ±Infinity clamped to ±32,000 m);
  `model/physics.ts:315,339`; `climate/hydroclimate.ts:301,347`; `climate/ebm.ts:201-219,290,310`;
  `life/biomes.ts:117-144`; `pipeline/stages.ts:113-132` (`tectonicParams` carries climate, ocean share,
  erodibility, Hadley edge); `src/ui/planet-engine.ts:75,83,101`; `domain/commands.ts:171` (palette 'natural').
- **Decoupling (step 2):** only `tectonicParams` changes for engine 2 (no `climate`, fixed `hadleyDeg` and
  `erodibility`, a reference sea from the continental share, tectonic events only); `history.ts`, `step.ts`,
  `erode.ts` untouched, so engine 1 results are unchanged. Add `engine?: 1 | 2` to the definition
  (`model/definition.ts`; `definitionOf` must read it). A new stage applies `seaLevelForVolume`
  (`water/sealevel.ts:18-31`) to datum heights; zero water uses the lowest point as datum, never −Infinity.
- **Planet state:** a pure function beside `derive` plus a stage; gate climate, water and life through
  `climateInputs` (`stages.ts:146`) with an effective definition; surface classes as a new field, `BIOME` ids
  append-only (consumers: `stages.ts:343`, `paleo.ts`, `past.ts`, `consequences.ts:301`, `explain.ts:145`).
- **Studio flow:** `pipeline/scheduler.ts:88-101` needs per-product reference counting before latest-wins
  cancellation; abort only geology, drop queued short jobs (`worker/pool.ts:89-110`).
- **Map side:** cover alpha as "ice over sea" (`render-engine/terrain-gl.ts:370-377`, `smoothCover` to four
  channels); `riversOf` weighted by the engine's runoff (`terrain/rivers.ts:100`), cache key to include climate;
  open the Earth-only gates for close-ups (`MapView.tsx:500,508`, `presentation/export-driver.ts:248,259`), add a
  source key to `terrain/detail-cache.ts` and `photo-cache.ts`, replace Earth-only constants
  (`terrain-gl.ts:249`, `detail.ts:16,55`, radius 6371 in `MapView.tsx:510`); foundation as a project asset
  (`server/assets.ts` whitelist, `ui/api.ts:65-70`), loaded in `simTerrain`.
- **Reuse:** `runawayLimit`, `habitableZoneAu`, `opticalDepth`, `tidalLockYears`; `ProductCache` and stage keys;
  `explain.ts`; `landscapeStep` (`surface/erosion.ts:54`, a pure function); `terrain/river-course.ts`.
- **Pin to engine 1:** `quickPlanetCover` (`ui/planet-engine.ts:144-168`), old maps with `simulation.quality`.
- **Tests that encode today's coupling and will change:** `test/planet-explain.test.ts:64`,
  `planet-resume.test.ts:54`, `planet-ice.test.ts:61`, `planet-past.test.ts`, `planet-pipeline.test.ts:74`,
  `planet-tectonics.test.ts:221`, `e2e/workflows.e2e.ts:4974-5175`.

---

## 9. Answers (the defaults, accepted by the user on 28 November 2026)
1. Existing simulated-planet maps stay on the old calculation and are not touched.
2. "Sea (share of the surface)" becomes "Amount of water", with sea coverage as a result.
3. When physics removes something (the oceans boil away), a clearly marked "keep it anyway" override exists for
   fiction.
4. "New land" sliders may take a few seconds; all others are fast and keep the land.
5. Close-ups: about 150 m per pixel first, closer zooms afterwards if the look holds up.
6. Disk use of about 0.1 to 0.3 GB per finished planet, plus a capped close-up cache (2 GB), is acceptable.
7. Posters: up to 16,384 pixels wide, PNG or TIFF.

---

## 10. Progress
| Step | Status | Notes |
|---|---|---|
| 1 A planet always on screen | Done (28 November 2026, D257) | Seen from space by default, made by itself on opening and after a change to what the land is made from, never out of date in silence; the layers at every step. Still the old calculation: frozen seas are drawn open, hot worlds keep their seas (steps 3 and 4) |
| 2 Same land unless geology changes | Done (28 November 2026, D258) | A second calculation for planets made from now on (older maps keep the first): the history from the geology alone; water an amount, the sea where it fills the land's hollows; a dry world with its relief; every climate layer at any moment; the settings that make new land marked. Still: seas neither boil nor freeze over |
| 3 Hot worlds | Done (28 November 2026, D259) | The water's fate from the planet's state: too much sunlight or too strong a greenhouse and the seas boil away (dry rock on the same land, said under the picture with its numbers; a switch keeps the seas for fiction); bare, scorched and molten ground by temperature, coloured by heat and crust; no snow on a dry world, its temperatures those of its mean surface; temperature colours over the whole range. Still: the map is coloured by height (step 8). Mended since (D266): just short of the boiling limit seas were drawn over a planet the year's model had at 1,300 °C; the rule and the model now share one ceiling |
| 4 Cold and airless worlds | Done (28 November 2026, D260, D261, D262) | The sea frozen for most of the year drawn as ice (still sea), a planet frozen over said under the picture with why; the Studio's temperature and frozen share from the model its pictures are made with; a planet too small to hold its air has none; under too little air water is never liquid (gone into vapour with ice caps, or frozen where it stands), each said with its numbers and a switch to keep it; the day and night of a world with little or no air (checked against the Moon, Mercury and Mars). Still: the map is coloured by height and draws no sea ice (step 8) |
| 5 "Why it looks like this" and "What changed" | Done (28 November 2026, D263, D264, D265) | "Why it looks like this", the chain of causes from the star to the surface with the numbers that decided each link, from the products the picture is made of. "What changed" after a change of the settings: which settings, the figures before and after, and where on the picture; the tipping points banded under the sliders (the air lost, the seas boiled away, too little air for water, the seas frozen over) and the range of open seas in the read-outs |
| 6 Every slider earns its place | Done (28 November 2026, D267, D268) | Found by the slider test and mended: clouds hold heat in as well as turning light away (cloud cover at nothing no longer boils an Earth); snow needs water to fall (little water no longer freezes the planet solid); no plants leaves bare ground and desert; bare ground under no air is dark; the water's and the cloud cover's sliders say where the planet tips. A preset for each kind of world (Earth-like, ice age, snowball, hot desert, ocean world, locked to its star, Venus-like, scorched, lava, Mars-like, airless). The test of every slider, kept: each from its lowest to its highest changes a fifth of the planet or more and is named in "What changed" |
| 7 Data at every point, saved with the project | | |
| 8 The map uses the foundation | | |
| 9 to 14 Stage 2: the full map | After the user confirms the foundation | |
