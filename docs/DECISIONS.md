# Map Maker: decisions and deviations

Architectural decisions taken during development, and every place where the software differs from the approved
architecture, with the reason and the way back. Newest first within each section.

## Deviations from the approved architecture

The approved development set-up assumed a session that can install packages and a private GitHub repository. The
first development session had neither: package installs were switched off and no repository was connected. D1–D4 follow
from that. **Update, second session of 16 November 2026:** `npm install` and downloads now work, and the project is on
GitHub, so each of D1–D4 can now be reversed; they are reversed one at a time, each with its own tests. Each is confined to one layer of the system, so returning to the approved form does not touch the world
model, the history engine, the parcel kernel, storage or the export writer.

### D1. Canvas 2D map renderer instead of deck.gl (interim)

- **Why.** deck.gl was not installed and could not be downloaded.
- **What was built.** `src/render-engine/map-renderer.ts` draws with the browser's 2D canvas, using the same inputs the
  deck.gl renderer will use: the world, the engine, a time and a camera.
- **Consequences.** Correct and deterministic output, including 8K frames. The cost is speed with very dense data
  (detailed terrain, thousands of features), which the planned WebGL renderer handles better. Measured on 16 November
  2026: about 210 ms per 1080p frame with 24,500 parcels (fine for export, about 5 frames a second when scrubbing).
- **Way back.** Replace this one module once packages can be installed.
- **Update (18 November 2026).** After the two optimisation stages (D48–D70) the Canvas renderer draws territories, features and names fast enough on large projects; reversing D1 is moved to Stages 8 and 9, where terrain and fields need the graphics card.
- **Update (Stage 8).** Terrain is drawn with WebGL2 (D95), into pictures the Canvas renderer lays where they belong; everything else stays Canvas 2D.

### D2. Local service and browser instead of an Electron app (reversed, 16 November 2026)

- **Why it existed.** Electron could not be downloaded in the first session.
- **Reversed.** `src/desktop/main.ts` is the Electron main process: it hosts the same data service in-process (still
  HTTP on 127.0.0.1, on a stable port so remembered views survive restarts) and shows the interface in the app's own
  window; one copy at a time. electron-builder makes an NSIS installer (`Map Maker Setup <version>.exe`, per-user,
  installation folder can be changed, Start menu and desktop shortcuts). The GitHub Actions run "Windows build and
  tests" builds it on Windows and runs every test there first. Tested by `e2e/desktop.e2e.ts`.
- **Kept.** The browser version (`Start Map Maker.bat`) still works and uses the same files and projects.
- **Not done.** The installer is unsigned (Windows SmartScreen warns once); signing needs a certificate the user would
  buy. No automatic updates: a new version is installed over the old one, projects are untouched.
- **Building the installer on Linux** needs Wine; without it, `npx electron-builder --win --dir
  -c.win.signAndEditExecutable=false` produces the unpacked app for inspection.

### D3. Node's built-in SQLite instead of better-sqlite3

- **Why.** better-sqlite3 was not available; Node 22.13 and later include SQLite.
- **Consequences.** The same SQLite file format and features (write-ahead log, full sync, VACUUM INTO). Requires
  Node.js 22.13 or newer. This may simply be kept.

### D4. Minimal React type declarations (reversed, 16 November 2026)

- **Why it existed.** React's type package was missing in the first session.
- **Reversed.** `@types/react` and `@types/react-dom` 19.2 are installed and the shim is gone; the interface's event
  handlers lost their `any` annotations, so all of `src/ui/` is now checked as strictly as the rest. Doing so found two
  loosely typed menu values (now cast to their exact types); no behaviour changed.

### D5. Tests use Node's own test runner instead of Vitest and fast-check

- **Why.** Neither was available. The randomised tests use a seeded generator written for this project.
- **Consequences.** None for the user; the property tests run on every `npm test`.

### D6. Interface tests drive Chrome with Playwright, not Playwright for Electron

Follows from D2. The test drives the real interface exactly as a person would.

## Decisions taken during development

### D166. The deep sea floor, mountains and lakes (Stage 15.4)

- **Asked.** Fix the inaccuracies D162 measured: the deep sea floor too deep (its depths' peak at 5.5 to 6 km
  against 4 to 5), mountains too low at the preview level (0.2 % of the surface above 2 km against about 3), lakes
  about twice (since D165's wetter land, three times) the measured volume.
- **Found.** The sea floor was old: a mean age of 118 Myr and a tenth of it older than 300 Myr (the Earth's: 64 Myr,
  the oldest about 180), so most of it sat at the oldest floor's depth. Old floor foundered only on plates not welded
  into a continent's group and with few trenches, at a third of the reorganisations. Compared at the same cells, the
  real Earth has 3.1 % of its surface above 2 km at the preview level, but two-thirds of that is the Antarctic and
  Greenland ice sheets' surfaces: about 1 % for rock. Lakes: at 220 km cells a cell's mean height hides gorges and
  straits, so the Red Sea and the Black Sea became closed lakes, river basins became huge lakes (the Congo's
  cuvette 795,000 km², the Columbia's and Fraser's plateaus), and a simulated planet's remnant ocean cut off between
  continents became a 3.8 million km³ salt lake. A plume made as much rock per cell at any level, so a quarter as
  much in all at the standard level as at preview.
- **Built.**
  - Old floor founders more readily (`tectonics/reorganise.ts`, `SUBDUCTION`): from 130 Myr, over 1 % of the sphere,
    on any plate (welded or not, with trenches or not), with an even chance at each reorganisation. Over four seeds
    the floor's mean age is 47 to 67 Myr and nine-tenths of it younger than 101 to 143 Myr; more subduction raises
    more arcs and ranges: 0.35 to 1 % of the surface above 2 km (0.08 to 0.2 before).
  - A plume's rock per cell scales with the cells' size, as it was at the preview level (`PLUME_CELLS`), so a
    hotspot makes as much rock at any level.
  - Straits narrower than a cell (`water/hydrology.ts`, `straits`): a basin below sea level as deep as an ocean's
    floor (below −1 km) whose lowest way to the sea crosses a sill under 150 m joins the sea; one whose water stands
    within 100 m of the sea's level joins it too. The Black and Red Seas are seas; the Caspian's basin (shallower)
    stays land.
  - Outlets cut (`notchOutlets`): before the water finds its hollows, each hollow's outlet is cut by 85 % of its
    depth (or a quarter of the relief around it, if more; at most 1 km): a channel carved from the rim inward down
    the hollow's slope and outward down the land beyond, falling a centimetre a cell, never dug into a new hollow.
- **Result.** Real Earth, preview level: fresh lakes 51,800 km³ and salt 7,700 (measured 91,000 and 85,000; before
  294,700 and 172,500); the Congo's lake shallow (5,500 km³ against 64,500). Simulated Earth-like planets: fresh
  lakes 1,200 to 167,000 km³ and salt up to 45,000 over three seeds (before 30,000 to 205,000 and up to 1.5
  million). The simulated planet's depths now peak between 3 and 5.5 km below the sea by seed (5.5 to 6 before;
  the Earth's 4 to 5).
- **Still wrong, and why.** Plateau basins whose gorges lie beyond their outlet's neighbours keep shallow lakes
  (British Columbia's 27,000 km³; Lake Chad's much larger than its own); the deep lakes that hold most of the
  measured fresh water (Baikal, Tanganyika, Superior, Malawi) are narrower than a cell, so the model cannot hold
  them; the Caspian fills to the sea's level and joins it (its inflow and evaporation balance about 30 m lower). The
  sea's depth relative to its surface depends on where the coastline falls on each planet's continents, so seeds
  differ by over 2 km. Volcanic islands remain narrower than preview cells (D164).

### D165. The climate's accuracy: the sea's heat, the winds' and the land's own; rain recalibrated (Stage 15.3)

- **Asked.** Fix the inaccuracies D162 measured: mid-latitude land rain at a third to a half of the measured, dry
  (Köppen B) climates on 42 % of the land against 30, Europe too cold, Antarctica 10 to 20 K too warm, deserts'
  edges too wet (Cairo 481 mm against 25).
- **Found.** On the real Earth's heights the zonal means had the northern subtropics 2 to 3 K cold, the equator 2 K
  warm and the south 4 to 9 K warm beyond 50°: the sea's heat transport was missing (taken up in the tropics, given
  off poleward, carried north across the equator by the Atlantic's overturning). Western Europe was cold summer and
  winter because coasts sat in coarse cells that are partly sea (one temperature for land and sea, the sea's), and
  nothing carried the Atlantic's air east. Antarctica's summers thawed its snow (the snow followed the moment's
  temperature), so the bare ground's albedo heated it. Over the sea the air held half the vapour it should (rain too
  efficient, evaporation blind to the air's humidity), so little reached inland; the rain belt reached 24° N over the
  Sahara (all land drew it), and Cairo's 480 km cell is three-quarters Mediterranean.
- **The energy balance** (`climate/ebm.ts`, `climate/currents.ts`):
  - the sea's heat as a steady source summing to zero: poleward transport ∝ sin φ cos⁴ φ (1.2 PW at its peak), none
    across a circumpolar channel (sea all round with land beyond, as the Southern Ocean's), an overturning carrying
    0.5 PW from the channel's side to 45-70° on the other (the Southern Ocean takes up heat, the North Atlantic gives
    it off), the gyres' warm western and cold eastern sides and the subpolar gyres' warm east and cold west (the
    Labrador and Oyashio currents); the air's diffusion lowered accordingly (0.3 to 0.2), the currents' warmth no
    longer added after the fact;
  - the prevailing winds carrying the air's heat along the parallels (westerlies beyond the Hadley cells, trades
    within them; effective 5 m/s, stronger in winter, by the tilt), solved with BiCGSTAB (not symmetric);
  - each cell's land with its own temperature: its sunlight, snow and small heat capacity, the transport its cell
    receives, and heat exchanged with the cell's air (30 W/m²K); the sea keeps the cell's;
  - snow kept all year where the yearly mean is below −10 °C (ice sheets), brighter when colder (0.62 to 0.8);
  - more cloud over the sea than over land beyond the deep tropics (±15 % of the cover, the mean kept).
- **Rain** (`climate/hydroclimate.ts`, settings in `HYDRO`): evaporation slows as the air nears saturation (the
  bulk formula's humidity deficit); the storm belts' and the convergence zone's rates apart (storms rain out more of
  less vapour); convection held down under the highs' sinking air, which follow the convergence zone a quarter as
  far (none within 6° of it); the vapour's cap at the air's own temperature (hot deserts hold more); the convergence
  zone drawn by lowland within about 800 km of the sea and by ground above 1 km (Tibet, Mexico's plateau), in 15°
  sectors. Calibrated by a coordinate search on 22 stations, the land's rain at 30-55° N, the dry climates' share,
  the deserts and the planet's mean.
- **Result** (real Earth's heights, level 5; before → after, measured):

  | Measure | Before | After | Measured |
  | --- | --- | --- | --- |
  | 22 stations' yearly temperature, root mean square | 5.4 K | 3.4 K | — |
  | Their January and July temperatures | 7.0 K | 5.1 K | — |
  | Zonal means, worst from 80° N to 60° S | +5.4 K (60° S) | about 1 K | — |
  | Vostok; the South Pole (yearly) | −34; −34 °C | −48; −50 °C | −55; −49 |
  | Paris; Moscow (yearly) | 4.5; −1.1 °C | 10.2; 5.1 °C | 12; 6 |
  | January, Paris against eastern Canada at 49° N | −0.3 against 0.5 °C | 5.4 against −1.9 °C | 5 against −15 |
  | Rain, log root mean square | 0.85 | 0.82 | — |
  | Land's rain at 30-55° N | 275 mm | 540 mm | about 550 |
  | Köppen A, B, C, D, E (% of land) | 13, 41, 12, 13, 20 | 20, 30, 14, 18, 18 | 19, 30, 13, 25, 12 |
  | Cairo; Riyadh; Khartoum | 481; 448; 550 mm | 291; 391; 1,003 mm | 25; 100; 160 |
  | Rain, evaporation, runoff on land (km³ a year) | 88,400; 63,900; 24,500 | 117,600; 78,100; 39,500 | 113,000; 73,000; 40,000 |

- **Still wrong, and why.** Winds only along the parallels: the winter's northerlies down eastern North America and
  Asia are missing (Chicago's January +5 °C against −5), and western Europe's summers stay cool (Paris's July 16 °C
  against 21). The deep tropics rain too much (Singapore 4,250 mm against 2,300; the planet's mean 1,300 mm against
  about 1,000). Northern India's monsoon is too dry (Delhi 80 mm against 800; 148 before): its moisture does not
  reach 1,000 km inland. A city in a climate cell that is mostly sea takes the sea's rain (Cairo). Khartoum sits in
  the African rain belt (13-15° N at 30° E; measured nearer 10-12). More runoff fills more lakes (295,000 km³
  against 91,000: 15.4). Ice ages grow less ice at coasts than before (land's own summers are warmer than the sea's):
  an ice age with an eighth of the carbon dioxide adds 0.6 million km³ on the test's planet (1.5 before; the test's
  threshold lowered to 0.4 with this reason).
- **Cost** (`bench/planet.bench.ts`, the Earth-like preset): the climate 1.84 s at preview and 1.41 s at standard
  (1.0 to 2.4 and 1.0 before): the winds' non-symmetric solver costs about 40 %. Bringing a change of climate under
  half a second is 15.6.

### D164. Edits' consequences in numbers, edits made on the crust clicked, values set by hand (Stage 15.2)

- **Asked.** Numbers instead of words in the consequences reports, and derived values that can be set by hand.
- **Estimates before the re-run** (`src/planet/consequences.ts`), under each waiting edit, from the engine's own rules
  (the constants now exported by the tectonics, so the two cannot drift apart) and the history shown: the place at
  that moment (height and crust); for a hotspot the plate's speed there from the checkpoint before it, the chain's
  length, the volcanic rock and the rise along the track, and whether islands rise above the sea at this quality;
  for a collision the thickest crust the gravity allows and the peaks it gives; for a rift the opening rate, the
  width of new sea floor and its depth; for a flood basalt its thickness, extent and volume (the Siberian Traps for
  scale); for an impact the basin's width, depth, rim and the water it would hold under the planet's gravity; for a
  higher sea the land it floods at that moment; for an ice age or a greenhouse the carbon dioxide's factor.
- **Measurements after it**, against the history before: around each edit (where its crust is today) the highest
  ground, the land, the rain on the land, the water in lakes and the biomes changed with the largest change; for
  edits of the sea and the air, while they were under way: the sea's level, the mean temperature and the ice on
  land; over the planet: the land, how much of it the plates now cover differently, the crust the edits made and
  the biomes changed.
- **Edits made on the crust clicked** (`src/planet/reconstruct.ts`). A history now keeps each plate's rotation
  with each picture. A place clicked on a picture (today's, or a past moment's on the layers that go through time)
  is followed with its plate, picture by picture (through splits and welds), back to when the edit begins, and the
  edit is made there: a crater clicked on today's map and dated 30 Ma is made where that crust was then, and today
  lies where it was clicked (the test: carried 1,530 km, found 223 km from the click on its coarse grid). A plume
  stays where it is put (it is fixed in the mantle; the plates pass over it). The Edit step says where an edit was
  made when that differs from the click. A click in the Edit step only chooses the place now (no "why" card).
- **Set by hand**: the star's light and surface temperature, the year and the mass, each with a "set by hand" badge
  and the value the physics gives beside it; a regime or tidal locking chosen by hand says what the physics would
  choose and why; the readouts mark what is set by hand. The definitions already stored these overrides (D152).
- **Found on the way.** (1) Volcanic islands are narrower than a preview cell (about 220 km): a typical hotspot in
  open ocean raises its track about 200 m at preview, and the estimate says so; resolution-independent plume volumes
  and the support narrow volcanoes get from the plate's stiffness belong with 15.4's heights. (2) A history is
  sensitive to small changes: an edit can tip a later collision, split or river's course, through the climate,
  erosion and the sea's level, which reach everywhere. Over ten seeds of a hotspot added 100 Ma, heights changed by
  more than 50 m beyond 4,000 km on no cells (median) for the Earth-like preset and on 28 for the young volcanic
  world, but about one history in ten tipped into another course over a fifth of the planet. Drawing each plate
  decision's random number from the seed, the moment, the decision and the plate (instead of one stream) was tried,
  to rule out the stream as the cause: no improvement over the same seeds, so it was not kept. The report says how
  much of the planet's plates are on another course.

### D163. Edits gathered and worked out together; a history goes on from its checkpoint before the earliest edit (Stage 15.1)

- **Asked.** "Make the user able to do as many edits as he wants and then, when he is done with the edits, a re-run
  history button that re-runs history based on his edits, instead of automatically doing it after each edit"; and,
  from what D161 left undone, re-running from the checkpoint before an edit instead of the whole history.
- **Built.** In the Planet Studio's Edit step "Add this edit" puts an edit in a list of edits waiting to be worked
  out, each with its place, its time and what follows from it, and each can be taken away again; events added,
  changed or taken away in step 6 are listed with them. Nothing is simulated until "Re-run the history with these N
  edits". D161's choice between working everything out after each edit and later is gone: a change of the air, the
  orbit or life still updates today at once, the history keeping its climate (D161).
- **Going on from a checkpoint** (`src/planet/tectonics/resume.ts`). A history keeps a packed checkpoint every
  50 Myr: each plate only the cells it holds, with their crust; the world's per-cell state; the random generator,
  the events and which have begun (with the places drawn for them), the plumes, the welds and the moment's climate;
  4.7 MB for a preview history of 500 Myr. Re-run with the earlier history at hand (passed to the stage as a hint,
  which never enters a product's key), the history goes on from the earlier one's last checkpoint at or before the
  first moment their events differ, takes the pictures before it from the earlier history, and arrives at exactly
  what a run from the beginning makes: the tests compare every picture's bytes, with edits added, taken away,
  starting exactly on a checkpoint, and an ice age that changes the past climates erosion follows. Any other change
  (the plates, the climate the history keeps, the quality, the span) starts from the beginning. The studio uses the
  earlier history only while it is still in the product cache, never working it out again just to go on from it.
- **Speed** (preview, the Earth-like preset over 500 Myr: 3.8 s from the beginning, one thread): an edit 30 Ma is
  worked out in 0.4 s, one 100 Ma in 0.7 s, one 300 Ma in 2.0 s. After a re-run the Edit step says where it went on
  from.

### D162. The planetary engine validated and measured; its model card (Stage 14.11)

- **Asked.** Stage 14.11: "the Earth-like validation report, benchmarks with budgets, profiling and optimisation
  (shared memory, GPU kernels if they pay), the model card in DEVELOPMENT, the decision records".
- **Validation** (`bench/planet.bench.ts --validate`, written to `docs/PLANET_VALIDATION.md`): distributions, not maps
  (plan 11.2). A simulated Earth-like planet (seed 1, 500 Myr, preview): land 29 % (29); hypsometry with two peaks,
  0 to 500 m and −6,000 to −5,500 m (the Earth's 0 to 1,000 and −4,000 to −5,000: the deep sea floor too deep);
  0.2 % of the surface above 2 km (about 3 %: preview cells average mountains away); the sea floor deepening 0.28 km
  per √Myr (0.35); the sea's level −303 to +287 m over the history; mean temperature 16 °C (15), 27.8 °C within 10° of
  the equator and −10 beyond 70°; deserts and steppe 51 % of the land at 15-35° and none within 10°; tropical forest
  96 % within 10°; boreal forest 46 % at 50-65°, tundra, polar desert and ice 68 % beyond 65°; Hack's law exponent 0.49
  (0.5 to 0.6). The real Earth's heights with the engine's climate: 22 places' yearly temperature within 5.4 K (root
  mean square) and their rain within 0.85 in natural logarithms; water on land, Köppen's classes as in D159 and D160.
- **Benchmarks** (`bench/planet.bench.ts`, one thread, the development container): the Earth-like preset over 500 Myr,
  preview (level 5) and standard (level 6):

  | Level | History | Sunlight | Climate | Water and ice | Biomes | Cover | An edit of the air |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 5 | 5.5 s | 0.01 s | 1.0 to 2.4 s | 0.13 s | 0.03 s | 0.18 s | 1.0 to 2.3 s |
  | 6 | 24 s | 0.01 s | 1.0 s | 0.21 s | 0.04 s | 0.18 s | 1.0 s |

  (The climate runs on the coarse level whatever the map's, so it costs the same; the first run in a process is the
  slower, before the JavaScript engine has compiled it.) Against the plan's budgets (8.4): the history at preview in
  a few seconds (met: 5.5 s); simulating at standard under a minute (met: 24 s on one thread); a change of climate,
  water or life within half a second (not met: about a second, the energy balance's year-by-year spin-up).
- **Profiling and optimisation**: the history's tectonic steps take about half its time, the past climates a quarter
  (D159 made them affordable: every 50 Myr, warm starts, every third month's rain, the sky's sunlight kept); the
  rain model's per-edge fluxes worked out once a month (four to six times faster, D159); the energy balance's
  conjugate gradients stop at a residual of a millionth instead of a ten-billionth: the climate 34 % faster
  (2.35 to 1.56 s), temperatures changed by under a thousandth of a kelvin. Shared memory between workers and GPU
  kernels were not built: the expensive models run on coarse levels (2,562 or 642 cells), where moving the data costs
  as much as the arithmetic, and the history's steps depend on each other in time.
- **The model card** in DEVELOPMENT: every model's kind (physically based, empirical, diagnostic), its calibration,
  what it holds for, and its known errors in numbers.
- **Found on the way**: the Studio's interface test caught a young volcanic world whose sea, 200 Myr ago, stood 1.4 km
  lower: its sea floor started as old as the Earth's though its plates move three times as fast, so its basins started
  too deep. The starting ages now scale with the plate speed (180 Myr for the Earth). Such a world still shows lower
  seas in its past (a few hundred metres to a kilometre): its volcanism keeps adding crust, which with the water
  conserved raises the sea over time.

### D161. Planet Studio II: why is this here, edits with geological explanations, recalculation, provenance (Stage 14.10)

- **Asked.** Stage 14.10: "climate, water and biome layers and steps 4 to 6 in full, 'why is this here?', side-by-side
  comparisons, editing with geological explanations, consequences reports, automatic, selective and manual
  recalculation, the provenance overlay; Mode A's direct tools", done when the editing interface test passes.
- **Steps** as the plan lays them out: 1 Star and orbit · 2 Planet · 3 Interior and plates · 4 Air and water · 5 Life
  and biomes · 6 History · 7 Simulate and explore · 8 Edit. The climate, water and biome layers came with 14.6 to
  14.9 (D157 to D160).
- **Why is this here?** (`explain.ts`): clicking the planet opens a card on what the simulation knows about the place
  today: the crust (continental, an arc's, oceanic; its age and thickness) and what made or marked it (sutures,
  accretion, flood basalts, hotspots, rifts, arcs, impacts), why it stands high or low (thick crust floating higher,
  old sea floor sunk, a flooded margin); the plate boundary it lies on or beside, with its rate; its climate in numbers
  and the circulation that gives it (the convergence zone, the subtropical high, the storm belt, a rain shadow found
  by walking upwind, a monsoon, winter rain, a warm or cold current); its water (an ice sheet, a lake or salt lake, a
  salt flat, a river's discharge, a wetland); its Köppen class and its biome with the aridity behind it (or the
  planet's own biome); and whether an edit made it.
- **Edits with geological explanations**: in step 8 a place is clicked and what happened there chosen; the engine
  places the geological event that makes it on the timeline (D154's events, at that place): volcanic islands (a
  hotspot under the moving plate, from then on), a mountain range (continents near the place pushed together for 60
  Myr), an inland sea or ocean (a rift opening there), a volcanic plateau (a flood basalt), a crater (an impact), or a
  higher sea. The crust such events make carries a new bit, `edited` (crust history bit 128): the **provenance**
  layer shows it against the simulation's own.
- **Consequences report**: after an edit, what follows in words (what the event does to the land, the climate,
  rivers and biomes), that the history is simulated again with it and then today's climate, water and life; then
  **automatic** ("work it all out now") or **manual** ("keep the pictures as they are": the history is marked out of
  date until simulated again). **Selective**: the history keeps the settings that reach it only through its climate
  as it was simulated with (star, orbit, air, tilt, day: `history.climate`), so changing them afterwards re-runs only
  today's climate, water and life at once (the stage keys of the history do not change), with a note and a button to
  re-run the history with the new climate (plan 4.4). The sea's share, the planet's size and its interior still make
  the history out of date.
- **Comparison**: after a history is simulated again, the picture before the change can be shown beside the new one
  (the same layer).
- **Not done.** Re-simulating from the checkpoint before an edit (the history is run again from its start; at preview
  quality a few seconds); a consequences report from a quick estimate of the effects (it says in words what such an
  event does); "set by hand" overrides of derived values; Mode A's direct tools (drawing a coastline, painting biomes,
  drawing rivers) and its use of this climate: the generator keeps its sculpting brushes (D98).
- **Tests.** `planet-explain.test.ts` (3): a placed hotspot's crust marked as edited and the place's explanation
  saying so; explanations naming the convergence zone, the subtropical high or storm belt and Köppen's classes; the
  history keeping its climate (the same key with more carbon dioxide afterwards, a note that it differs, the snapshot
  surviving storage). The Studio's interface test explains a clicked place, places volcanic islands 100 million
  years ago, reads the consequences, works it all out, sees the edited crust in orange and the picture before beside it.

### D160. Biomes: Köppen-Geiger climates, biomes by warmth and dryness, the planet's own, plants under other stars (Stage 14.9)

- **Asked.** Stage 14.9: "Köppen-Geiger and Whittaker classes with alpine, wetland and ice zones, custom biome rules
  and vegetation palettes, the satellite look fed by them, recalculated on any change", done when the classification
  tests and the Earth-like validation pass.
- **Köppen-Geiger** (`life/biomes.ts`) from the twelve months' temperature and precipitation by the rules of Peel,
  Finlayson and McMahon (2007): E where the warmest month stays under 10 °C (EF under 0); B where the year's
  precipitation falls under ten times the threshold (twice the mean temperature, plus 28 mm when 70 per cent falls in
  summer, plus 14 unless 70 per cent falls in winter; BW under five times; h at 18 °C or more); A where the coldest
  month is 18 °C or more (f, m by 100 − P/25, w); C above 0 °C, D at 0 or below, with s, w or f for the dry season and
  a, b, c or d for the summer. Summer is the half-year of most sunlight at each place (from the insolation), so the
  rules hold on any orbit; without it, the half-year centred a month before the warmest month (Peel takes April to
  September in the north). Fifteen reference stations, one per class, classify as they are measured (Singapore Af,
  Miami Am, Darwin Aw, Cairo and Khartoum BWh, Denver BSk, Rome Csa, San Francisco Csb, Hong Kong Cwa, Shanghai Cfa,
  London Cfb, Moscow Dfb, Yakutsk Dfd, Utqiaġvik ET, Vostok EF).
- **Biomes** as Whittaker's diagram places them, by the year's mean temperature and wetness, the wetness as the
  aridity index (precipitation over the potential evaporation of the water stage, as the UN's dryland classes):
  tropical rainforest, seasonal forest, savanna, desert; temperate rainforest, forest, Mediterranean woodland and
  shrub (Cs or Ds climates with the index 0.5 to 0.75), grassland, steppe; boreal forest; tundra and polar desert where
  the warmest month stays under 10 °C (alpine tundra and rock on high ground), ice where it stays under 0 or an ice
  sheet lies; lakes, salt flats, wetlands and tropical swamps from the water stage. Twenty biomes with the satellite
  look's colours (D100).
- **The planet's own biomes**: the definition's rules (ranges of yearly temperature, precipitation, its seasonality
  and height), first match by priority; the Earth's biome where none fits. In the Studio's step 4 (now "Air, water
  and life") with a small editor.
- **Plants under other stars** (Kiang et al. 2007): green under a Sun-like star; dark red to near black under a red
  dwarf (taking all the dim red light they can); yellow to orange under a hot white star (shading from the blue);
  bare ground with no life. Applied to each biome by its plant cover (a rainforest fully, a desert hardly).
- **In the pipeline**: a `biomes` stage (Köppen class, biome, the planet's own where it applies, and the colour from
  space per cell; 40 ms at preview) reading only the life settings and the climate, water and heights, so changing
  plants or rules re-runs it alone (the Studio redraws at once: "recalculated on any change"); a `cover` stage paints
  the colours smoothly as a picture. Layers: Köppen-Geiger climates, biomes, seen from space. A map of a simulated
  planet takes today's cover in the satellite look (earlier moments are drawn by height: the biomes of a moment are
  not kept with the history).
- **Earth-like validation** (the real Earth's heights, this engine's climate and water, L5): deserts and steppe 62 per
  cent of land at 15-35° against 12 within 10° of the equator; tropical forest most at the equator; boreal forest 50
  per cent of land at 50-65°; tundra, polar desert and ice 94 per cent beyond 65°. Köppen's classes as shares of land:
  A 13 % (measured 19), B 42 % (30), C 12 % (13), D 13 % (25), E 20 % (12, ice caps counted): too dry at mid-
  latitudes, as the rain is (D159), so steppe stands where the Earth has its prairies and forest steppe.
- **Tests.** `planet-biomes.test.ts` (3): the fifteen stations and a southern-hemisphere summer; biomes by warmth
  and dryness and their refinements, the planet's own by priority, plants under other stars; the Earth-like
  validation. The Studio's interface test draws the climates, the land seen from space, and redraws it when the
  plants become a red dwarf's.

### D159. Water and ice: runoff, lakes, rivers, ice sheets, the sea's level; the climate revisited (Stage 14.8)

- **Asked.** Stage 14.8: "runoff, Fill-Spill-Merge lakes and closed basins, rivers by discharge, deltas, floodplains
  and wetlands, ice sheets, sea level from volumes; paleoclimate coupled into erosion through the history", done
  when the drainage, conservation and flooding tests pass.
- **The climate revisited first.** Checking runoff against the real Earth showed the climate of 14.6 and 14.7 far off
  where the tests had not looked: land between 10° and 40° N 7 to 15 K too cold (Delhi −2 °C in January, Riyadh
  9 °C a year), and the mid-latitude continents nearly rainless (Chicago 51 mm a year, Kansas 32, Beijing 47, Delhi
  7, Buenos Aires 212). Causes and remedies, each physically motivated and calibrated on the Earth:
  - A column energy balance has one temperature for the ground and its air, so the sea's evaporative cooling and
    dry ground's lack of it, which set them apart, are missing; at its 480 km cells transport also smooths any contrast
    smaller than about 3,000 km (D/B ≈ 0.4 rad²). Two corrections to its output, leaving the planet's energy balance
    as it was: dry ground under the subtropical highs on a great landmass runs warmer than its column (up to 16 K,
    by the land's share within 3,000 km and the subtropical band: `DRY_WARM`), and broad sunlit high ground cools
    with height at 0.6 of the lapse rate (not over frozen ground, where ice sheets hold cold air: `PLATEAU`).
    Against 35 stations the annual mean's error fell from 10.1 K rms (bias −7.9) to 5.7 K (−3.8). Winds and rain go
    by the air column's temperature, without the ground's extra warmth (deserts' heat lows draw in no rain).
    Weaker east-west transport and darker land were tried and dropped (colder planet; little effect).
  - Rain: (1) the subtropical highs' flanks: on the western side of every wide ocean and the land beside it air turns
    poleward with little sinking, bringing the sea's moisture (the Gulf of Mexico's to the American plains, the
    South China Sea's to China); on the eastern side it sinks and turns to the equator (the west-coast deserts); (2)
    the highs follow the convergence zone only a quarter as far (5° between seasons on Earth), so a summer
    continent's trades are short and its westerlies stay; (3) between the equator and a convergence zone drawn into
    the summer hemisphere, air crossing the equator turns east (the south-west monsoon of India and West Africa);
    (4) storms carry vapour poleward as eddies (diffusion down its gradient, 1.5×10⁶ m²/s at the storm belts, kept
    stable; as moist energy-balance models do, Frierson et al. 2007); (5) convective rain needs moist air (weighed
    by how near saturation the vapour is), so hot deserts do not storm. Over 32 places the error (in logarithms)
    fell from 0.88 to 0.75: Chicago 277 mm, Kansas 274, Beijing 698, Shanghai 606, Buenos Aires 430, Moscow 358,
    Lagos 1,635, Mumbai 1,076, the Bay of Bengal 1,848; deserts stayed dry (the Sahara 156, the Atacama 76, the
    Taklamakan 23). **Still short**: mid-latitude land gets a third to a half of its measured rain (30-40° N 199 mm
    against about 520), as the coarse energy balance leaves the northern subtropical seas 5 to 7 K too cool, so their
    air carries too little water; Delhi 148 mm (800), the Congo 642 (1,400), Arabia 448 (100). The rain shadow test
    for the southern Andes relaxed to 1.25 (eddies blur a range narrower than a cell).
- **Water balance** (`water/hydrology.ts`): potential evaporation by Hargreaves and Samani (1985) from the
  temperature and the sunlight at the top of the air (a daily range of 12 K, unknown to the model); actual by
  Budyko's curve in Fu's form (ω = 2.6); the rest runs off.
- **Depressions and lakes**: the hierarchy of depressions (Barnes, Callaghan and Wickert 2020) by flooding from the
  sea and every pit at once (minimax levels) and merging at outlets in order (Kruskal); water is credited to the
  hollow it runs down into (steepest descent to a pit). Lakes at the climate's steady state by Fill-Spill-Merge's
  logic on fluxes: a hollow fills until it spills or until its lake's evaporation (open water at PET less the land's
  own) takes all that reaches it; a full hollow spills into its neighbour, both full make one lake rising above the
  saddle; whether a subtree is full depends only on its total inflow, so it is decided without recursion trouble. The
  same hierarchy filled with volumes (`fillVolume`) conserves them exactly. A hollow below sea level joins the sea only
  if its water would stand at sea level (the Black Sea), else stays a closed lake or dry (the Caspian); lakes nowhere
  deeper than 5 m over whole cells are marsh or flat, not lakes; a lake covering under half of a cell leaves it out.
- **Rivers**: the water's surface (lakes flat) drained by Priority-Flood from the sea, closed lakes and dry basins, so
  every drop runs downhill to one of them; discharge summed down the tree, an open lake's evaporation taken where
  its water leaves (at most what reaches it), so the budget is the rivers' own and closes exactly; rivers past three
  cells' worth of mean runoff with Strahler orders; floodplains (order 3 or more, slope under 0.3 m/km); wetlands by
  the wetness index ln(a/tan β) over 19 with over 250 mm of runoff, or cold, flat, poorly drained lowlands; deltas
  where a large river from high ground reaches a shallow sea.
- **Ice** (`water/ice.ts`): snow is the share of each month's precipitation on days below 1 °C (daily temperatures
  normal about the mean, σ = 5 K); melt by positive degree days (3 mm/K/day snow, 8 ice; Braithwaite 1995), 60 % of
  the snow able to refreeze meltwater (Reeh 1991); on the ice the air colder by the lapse rate for its height, snow
  5 % less per degree colder; flow by the shallow-ice approximation, Glen's n = 3, A = 5×10⁻¹⁷ Pa⁻³ a⁻¹,
  semi-implicit (Mahaffy 1976) with steps of 500 years for up to 60,000 years on the level-4 mesh; the bed pressed down
  by ρᵢ/ρₘ of the ice; ice afloat calves. A steady polar dome comes within 18 % of Vialov's analytical profile (a known
  first-order bias of the edge fluxes at 480 km), and ice is conserved while it only grows.
- **The sea's level** (`water/sealevel.ts`): exact (sorting the heights, the volume linear between them). In a history
  the run itself keeps the set share of the surface under water (the present must match the user's setting); the
  pictures are then redrawn against the level at which the ocean holds the planet's water (the present's ocean and
  ice) less the ice on land then, plus sea-level events (50 m per unit of strength): tectono-eustasy and glacio-
  eustasy. A moment rebuilt from a checkpoint is pictured against the same level (`frameSea`). The sea floor now
  starts with the ages a steady state leaves (area falling linearly with age: Parsons 1982); started older, the
  basins drained 800 m of sea over the first 500 Myr. On the Earth-like preset over 500 Myr the sea ranged from −300
  to +290 m.
- **Past climates in the history** (`climate/paleo.ts`): every 50 Myr (and whenever a climate event begins or ends)
  the energy balance and rain run on the level-3 mesh (about 1,000 km) from the last moment's temperatures (two
  to four years), every third month's rain; the rain (relative to the planet's mean) wears the land down in place of
  the rain belts by latitude (D155); the ice on land is estimated where snow outlasts the summer (a perfectly plastic
  sheet's volume-area scaling, 0.034 A^1.25 km³, matched to Antarctica and Greenland). Ice ages halve the air's carbon
  dioxide per unit of strength while they last, greenhouse periods multiply it by 2^1.5. The history of an Earth-like
  preview went from 3.7 to about 6 s. The history now depends on the climate settings; marking it stale instead and
  re-running on request (plan 4.4) is for Stage 14.10.
- **Results on the real Earth** (L6, today's climate): rain and snow on land 97,000 km³ a year (measured about
  113,000), evaporated 70,000 (73,000), running off 27,000 (about 40,000; the dry continents above); the Amazon
  the greatest river; lakes about twice the measured volume (coarse cells; the Black Sea a deep salt lake under a
  too dry eastern Europe); snow outlasting the summer on Greenland and East Antarctica, not on Siberia, Canada or
  Scandinavia; West Antarctica and the Antarctic coast melt (the energy balance leaves Antarctica 10 to 20 K too warm).
- **In the pipeline**: a `water` stage after the climate (ice on level 4, then the water on the map's level, about a
  quarter of a second at preview); layers: kinds of water (lakes, salt lakes and flats, rivers, floodplains,
  wetlands, deltas, ice), rivers by discharge, runoff, ice thickness. The Studio shows them, the sea's level and ice
  on land with each moment, and the climate events. Tectonics stage version 4.
- **Tests.** `planet-water.test.ts` (5): Fill-Spill-Merge conserving water through filling, spilling, merging and
  overflowing; closed lakes balancing evaporation with inflow, open ones passing all on; every drop draining to the
  sea, a closed lake or a basin, never uphill, discharge growing downstream, orders never falling, the budget
  closing; sea level exact and flooding monotonic; the real Earth's budget, the Amazon, deserts. `planet-ice.test.ts`
  (4): degree days and the year's balance; Vialov's dome and conservation; the Earth's ice and its lack; a history's
  sea level and an ice age's cold and ice. The climate tests gained stations (dry ground warm, Lhasa not arctic)
  and mid-latitude rain (no deserts at Shanghai, Beijing, Buenos Aires, Chicago, Moscow; Arabia and Arizona dry).

### D158. The climate II: winds, rain and the sea's currents (Stage 14.7)

- **Asked.** Stage 14.7: "circulation cells and winds, seasonal convergence zones and monsoons, evaporation,
  moisture transport and orographic precipitation, wind-driven gyres and ocean heat transport, cold currents", done
  when the Earth-like statistics place deserts, rainforests and rain shadows where they belong.
- **Winds** (`climate/hydroclimate.ts`) are diagnosed from the planet's own circulation (physics.ts: the Hadley
  cells' width and the number of cells per hemisphere): easterly trades blowing towards the convergence zone,
  westerlies beyond, easterlies again near the poles (one cell: surface air returning from the pole), reversed on a
  planet turning backwards; on a tidally locked planet air flows along the surface towards the point under the star.
  Monsoons: air is also drawn towards ground warmer than its latitude's mean.
- **The convergence zone** follows the latitude where the star stands overhead, a month late, swinging further over
  land than over the sea and furthest over high ground (by 30° bands of longitude: the land's share of the summer
  hemisphere to 40°, high ground counting more). The first version took the warmest belt from the energy balance's
  temperatures; its continents' summers are too mild (D157) and India stayed dry; following the Sun, as the energy
  flux equator does, gives the monsoon.
- **Rain**: precipitable water evaporates from the sea (Clausius-Clapeyron, faster in wind, reckoned from no warmer
  than 30 °C, where deep convection holds the warmest seas), is carried downwind (at 0.7 of the surface wind, where
  vapour lies) and rains out at a rate set by how air moves: faster where it rises (the convergence zone, the storm
  belts, warm moist convection, and above all wind blowing up a slope), slower where it sinks (the subtropical highs)
  and in the lee of mountains; over cold ground what the air cannot hold condenses and falls; land gives back part of
  its rain (more where it is warm: plants). Solved to a steady state each month by upwind transport on the level-4
  mesh, brought to the map's level. Its constants (`HYDRO`) are calibrated on the Earth.
- **The sea's currents**: wind-driven gyres (Stommel 1948, Munk 1950) as their effect on the sea's surface: warmer
  along the western sides of oceans in the subtropics and mid-latitudes (the Gulf Stream, the Kuroshio, the Brazil
  current), cooler along the eastern sides (California, Canary, Humboldt, Benguela, with upwelling), warmer on the
  eastern side at high latitudes where the drift arrives (Norway), fading over about 1,000 km from the shore (found
  along each parallel on a 2° raster of the land); 40 per cent of it on the coast's land. The temperatures of the
  climate include it.
- **Results on the real Earth** (L5): the planet's mean rain 1,220 mm a year (about 1,000 measured); the Amazon
  1,800, Borneo 2,800; the Sahara 180, the Atacama 44, inland Australia 190, Siberia 230; India 450 mm, 230 of it in
  July and none in January; Chile at 45° S 1,180 against Patagonia's 680, Seattle 1,300 against Nevada's 240.
  **Shortfalls**: the equatorial Pacific too wet (4,900 mm), the Congo too dry (600), Arabia and the Namib wetter
  than they are (a few hundred mm), the Andes' and the Cascades' rain shadows weaker than measured: the level-4 mesh
  (480 km) does not resolve narrow ranges.
- **In the pipeline**: the `climate` stage runs the energy balance, then winds, rain and currents (about six seconds
  for a planet); layers: rain and snow over the year and by month, the currents. In the Planet Studio too.
- **Tests.** `planet-hydroclimate.test.ts`: on the real Earth, four deserts dry, three wet places wet, the monsoon,
  two rain shadows, the equator wetter than the subtropics, cold currents off Peru and Namibia, warm off Brazil,
  Florida and Japan and the drift off Norway; on simple planets the belts' winds, a ridge across the westerlies wet
  on its windward side, a tidally locked planet raining under its star, no rain without water.

### D157. The climate I: a seasonal energy balance, calibrated on the Earth (Stage 14.6)

- **Asked.** Stage 14.6: "insolation for any orbit and tilt, tidal locking and several stars; the seasonal
  energy-balance model with greenhouse, albedo, heat capacities and transport scaled for the planet; lapse rates;
  the faint young star", done when the Earth calibration and the sensitivity tests pass.
- **The model** (`climate/ebm.ts`), physically based with parameters calibrated on the Earth: C ∂T/∂t = S(1 − α) −
  OLR(T) + ∇·(D∇T) on the mesh, through the year. S from the orbit (Kepler's equation, the declination, any tilt,
  tidal locking, a pair of stars or a far companion; D152). α as the planet-wide estimate of physics.ts, cell by
  cell: clouds over a clear sky that scatters light back over sea, land, and sea ice and snow where it is cold (the
  ice-albedo feedback). The clouds follow the planet's own circulation (more at the equator's convergence zone and in
  the storm belts beyond the Hadley cells, fewer over the subtropical highs), their mean the planet's cloud cover.
  OLR = σT⁴ / (1 + ¾τ), τ the grey infrared depth of the planet's carbon dioxide, methane and water vapour (rising
  with temperature: the water vapour feedback). C: the sea's mixed layer (50 m) or the ground, with the lowest part
  of the air column (a third of c_p p/g), less through sea ice. Each step is implicit (the outgoing heat linearised,
  diffusion solved by conjugate gradients), so steps of a fortnight are stable on any planet; the year is stepped
  until it repeats (to 0.01 K). Temperatures are at sea level; on land they fall with height at the planet's lapse
  rate.
- **Transport** is diffusion, strongest in the storm belts beyond the Hadley cells (on Earth near 45°) and weaker
  towards the poles and the equator (North et al. 1981 let it vary with latitude in the same way), calibrated on the
  Earth, scaled for other planets as Williams and Kasting (1997): with the air's mass and heat capacity, and as the
  inverse square of the rotation (slow rotators spread heat further), limited to 30 times Earth's either way.
- **Resolution.** The model runs on the level-4 mesh (2,562 cells), the land as a share of each cell, and its
  temperatures are brought to the map's level and lowered by height there: a planet's year in about two seconds.
- **Calibration on the real Earth** (its land and sea and heights from the terrain grid, D94): a mean of 288.9 K
  (288 measured), the energy in balance within 1 W/m², 28.6 °C within 10° of the equator, −17 °C beyond 70° N,
  Antarctica colder than the Arctic, Siberia's seasons about 30 K wide against 1 K at the equator, the Tibetan
  plateau colder than the plains beside it. **Known shortfalls**, as in all diffusive energy-balance models: the
  continents' interiors are too mild in winter (Yakutsk −19 °C in January against −39 measured) because diffusion
  couples them to the sea, and the subtropical deserts too cool (no sinking, warming air); western Europe is too cold
  (no Gulf Stream). Winds, ocean currents and rain come with 14.7.
- **Sensitivities** (tested): four times the carbon dioxide warmer by several kelvin; 8 per cent farther from the
  star more than 5 K colder; more tilt, wider seasons at high latitudes; a slower turning planet, gentler contrasts
  between the equator and the poles; the faint young Sun (76 per cent) with today's air much colder; a tidally locked
  planet's night side tens of kelvin colder than its day side, without seasons; Venus over 650 K and nearly even; the
  frozen preset mostly under ice. The faint young star (`sunFactor`, from physics.ts luminosityFactorAt) is there for
  the history's climates (14.8).
- **In the pipeline**: a `climate` stage reading only what the climate depends on (star, orbit, body, air, water,
  age) and today's land and sea from the history, so changing the air re-runs the climate alone; layers: the year's
  mean temperature, the temperature by month, ice and snow (the share of the year), in the Planet Studio too.
- **Tests.** `planet-climate.test.ts`: the Earth (mean, balance, tropics, Arctic and Antarctic, seasons in Siberia
  and at the equator and over the sea, months in the two hemispheres, the plateau, ice, speed); each setting moving
  it the right way; a tidally locked planet, Venus, a frozen world. The Planet Studio's interface step shows the
  temperature of the year and of the seventh month.

### D156. The Planet Studio, and maps of simulated planets (Stage 14.5)

- **Asked.** Stage 14.5: "the workspace with steps 1 to 5 and 7 (star, orbit, planet, interior and plates, air and
  water basics, history timeline, simulate and explore with tectonic and relief layers), presets with explanations
  and diagrams, progressive simulation in workers, scrubbing the history, 'use this planet' making a `sim` map whose
  terrain follows the history on the map's time axis", done when the interface test of the flow passes and the map
  shows the simulated planet through time.
- **The Planet Studio** (`components/PlanetStudio.tsx`): a workspace over the whole window, from New map › "A
  simulated planet", or "Open in the Planet Studio…" on a simulated planet's map. Across the top, the eleven presets
  (each explained when chosen). On the left, the steps, each a few plain sliders (logarithmic where the range is
  wide) and choices, with "More settings": 1 the star's mass, the distance, the eccentricity (and the season at the
  nearest point); 2 the radius, the tilt (to 180° with more settings), the day, tidal locking; 3 the heat from
  radioactivity, plates, activity, continental crust, hotspots, the regime (and the core's share); 4 the air's
  pressure, carbon dioxide, clouds, the sea's share; 5 the age, how much of the history to simulate, the detail
  (preview or standard), and the timeline's events (kind, from, for how long, strength; added and removed); 6 the
  layer shown, a name, and "Use this planet for a new map" (or "Apply to this map"). The seed under every step.
- **What follows** is worked out as anything moves (`physics.ts`, instant): the star (class, temperature, light),
  the sunlight, the habitable zone and where the planet is in it, drawn as a diagram (the orbit over the zone, the
  star in its colour), the year, the day from noon to noon (or none when locked), gravity, mass and density, the mean
  temperature with what the air and greenhouse add and the albedo, the circulation cells, the interior's heat flow
  and regime with its reason, the physics' own notes (a runaway greenhouse, a star that would have died, a year set
  by hand, tidal locking) and any problem with the settings. Moving a control explains in a sentence what it changes
  and why.
- **Simulating** runs the history in the workers (`tectonics` stage), with progress and a Cancel that stops the
  worker; the picture shows any layer (relief with light from the north-west, plates, plate boundaries, kind of
  crust, its age, its thickness, what made it, sediment, rivers, sunlight) at any moment, scrubbed or played (a
  picture every 0.4 s, round and round); every picture is a cached product, so going back is instant. When the
  settings change after a simulation, the studio says the picture is of the earlier settings. Sunlight is shown
  before any simulation.
- **Maps of simulated planets** (`world-settings.ts` `sim`, `commands.ts` createSimPlanet, setSimDefinition): a
  round map of the planet's radius holding its definition (checked as given, with the reason when refused), drawn
  with relief. Its land and sea at the moment shown come from the simulated history (`planet-engine.ts`
  simTerrain): heights every 25 million years, youngest first, each relative to the sea of its moment, rasterised at
  1024 × 512 in the workers and kept as the Earth's geological maps are (D134), blended between moments; the
  timeline spans the history, today at the present (the map's date of the planet's present is the same as the
  Earth's geological maps' present). Rivers are worked out from the heights as on generated planets (D99); comparing
  two dates side by side compares two moments of the history; exports take each frame's moment. A note on the map
  says how long ago the moment shown is and that the planet is simulated with simplified models (or how far its
  history has got). The Natural Earth choice is hidden on these maps, as on the Earth through time.
- **Detail and length.** Preview detail (about 240 km cells on an Earth-sized planet, the default) simulates 500
  million years in about 4 s here; standard detail (110 km) is several times slower. The last `spanMyr` million
  years are simulated (500 by default, 50 to 4,500; the definition's new `simulation.spanMyr`).
- **Differences from the plan, and why.**
  - *The picture is a flat map*, not the turning globe: the studio's own canvas is fast and shows every layer; the
    globe (D127) shows the planet once it is a map.
  - *Air and water are basic here*: the climate's own layers (temperature, rain, winds, currents) and steps 4 to 6
    in full come with 14.10, after the climate (14.6, 14.7).
  - *The history's checkpoints are not kept with the project*: the history is made again from the definition
    when the project is opened (the same every time; the workers' cache keeps it while the app is open). Keeping its
    pictures as project files is the way to skip that wait for large planets.
  - *The diagrams* are the orbit over the habitable zone; the tilt and circulation diagrams come with the climate.
- **Tests.** `planet-sim-map.test.ts` (a simulated planet's map: radius, definition kept, geological time; changed
  with its radius and undone in one step; refusals with reasons; other maps have none; the span read back). The
  workflows step "The Planet Studio": New map › simulated planet; a preset explained, its year and regime; the
  planet moved farther out, colder, the slider explained, the orbit drawn; 200 million years simulated in workers;
  relief today, then the plates, then the plates 200 million years ago (in their colours); used for a map whose
  land and sea differ between today and 150 million years ago, the sea where the planet has it, the timeline over
  the history; opened again with the map's settings; undone.

### D155. Landscape evolution: rivers, creep and sediment on the moving crust (Stage 14.4)

- **Asked.** Stage 14.4: "drainage on the mesh, implicit stream-power incision with flexural isostatic rebound,
  hillslope diffusion, sediment routing to deltas, shelves and basins, coupling into the history", done when the
  steady-state slope-area and sediment conservation tests pass and mountains and valleys emerge together.
- **Drainage** (`surface/drainage.ts`): Priority-Flood (Barnes, Lehman and Mulla 2014) from the outlets (the sea;
  on a world without one, its lowest point) upwards: each cell drains to the neighbour it was reached from (its
  lowest on the filled surface), depressions are crossed at their sills, and the flooding order puts every cell
  after the one it drains to (solving downstream first; reversed, summing upstream). Ties are broken by the cell's
  number, so the result never depends on the heap.
- **Rivers** (`surface/erosion.ts`): the stream-power law, rock removed at R = K Q^m (S − Sc) with Q the area
  drained weighted by rain, m = ½, n = 1, solved implicitly from the outlets upwards (Braun and Willett 2013), so
  any step is stable; a river reaching the sea cuts to the sea's level. **Isostatic rebound**: height comes from the
  crust, so removing rock lowers the surface by only β (0.15 for continental crust) of what is removed and the
  roots rise; the implicit solve uses β. The rebound is local to each cell (Airy), which at these cell sizes (110 to
  240 km) is about the flexural wavelength; a regional (flexural) kernel is the way forward for finer levels.
  **Threshold**: below a slope of 0.001 rivers carry sediment but cut no bedrock. Without it, trunk rivers on old
  cratons, whose drainage areas are huge at these cell sizes, wore whole continents nearly flat in 500 million
  years (the land's median height fell to 150 m); with it, 470 m, about the Earth's.
- **Creep**: rock moves between neighbouring land cells in proportion to their difference in height (linear
  diffusion, a diffusivity of a cell's width squared over 400 million years), in substeps short enough to be stable,
  keeping its volume.
- **Sediment**: what rivers remove travels downstream, fills closed depressions up to their sills, settles on
  lowland plains in proportion to how gentle they are (up to 30 per cent of the load a cell where the slope is
  near zero), and the rest reaches the sea, where it builds deltas and spreads along the shelf (four passes). Every
  cubic kilometre removed is laid down somewhere (tested to a billionth).
- **Rain** stands in for the climate until the history is coupled to it (14.8): belts by latitude from the planet's
  own Hadley cells (wet at the equator, dry at their edges, wetter in the storm belts beyond, dry at the poles).
  Erodibility follows water and air: a dry world (no seas) wears down at 3 per cent of an Earth-like one, thin air
  slows it further.
- **In the history** (`tectonics/erode.ts`): every 5 million years, the landscape step acts on the world's surface
  and its result goes back into the crust: rock removed thins the crust under it (its sediment first), sediment
  laid down rests on the crust where it settled (and goes down at a trench with its plate, a share scraped off).
  Mountains wear down slowly as their roots come up; sediment piles beside the land. On by default; checkpoints and
  reconstruction include it.
- **Results** (Earth-like, 500 million years at L5): rock removed about 2.3 km³ a year (the Earth's long-term rate
  is thought to be a few km³ a year); the land's median height about 470 m; the high ground lower than without
  erosion (the top per cent of the surface 1.4 km rather than 3.1); sediment thickest beside the land. Layers:
  sediment, water draining through each cell (the rivers of 14.8 will follow it).
- **Tests.** `planet-landscape.test.ts`: drainage (every cell once, each after the one it drains to, never uphill
  on the filled surface, reaching the sea; a world without sea draining to its lowest point; summing upstream);
  the exact steady state of the stream-power law (slope = (U/K) area^-½ in every cell to a millionth, the fitted
  exponent −½; steep headwaters, gentle trunk rivers, mountains where the land rises); conservation (rock removed =
  sediment laid down; creep only moves rock; a pit filled; more rain, faster; nothing cut below the threshold; rain
  belts); a history with erosion (high ground lower, nothing lost, an Earth-like rate, sediment thickest beside the
  land, a great river).

### D154. Continents over time: collisions, rifts, plumes, events, the supercontinent cycle, checkpoints (Stage 14.3)

- **Asked.** Stage 14.3: "collisions and orogeny with gravity-limited thickening, sutures, terrane accretion,
  rifting by stretching and break-up with thermal subsidence, hotspots and their tracks, large igneous provinces,
  stagnant-lid and episodic regimes, plate reorganisations, the supercontinent cycle, timeline events driving
  them, checkpoints and reconstruction at any moment", done when collision, rift and hotspot tests pass, a
  supercontinent assembles and breaks up in a test history, and reconstruction between checkpoints matches a re-run.
- **Collisions** keep the crust's volume: the continent overridden thickens the one above (shortening), up to the
  thickest crust gravity allows (70 km at Earth's, as 1/g); the crust is marked as a suture. Arcs and oceanic
  plateaus (oceanic crust thicker than 15 km) are too buoyant to go down: they are scraped onto the margin (marked
  accreted). Colliding continents weld, and stay welded until the weld breaks.
- **Rifts** (`step.ts` newCrust): where a gap opens inside a continent, the new cell takes half the thickness of the
  continental crust beside it, which thins by as much, so the continent's volume is kept as it spreads and thins
  step by step (stretching, McKenzie 1978), warm and marked as rifted; once the margin is thinner than about 24 km it
  breaks and new sea floor starts between the halves. The warmth fades over about 40 million years: the margins
  subside. (An earlier version made rift crust from nothing: continents grew to 60 per cent of the planet.)
- **Plate reorganisations** (`reorganise.ts`): slab pull and ridge push give each plate's new direction (the loop
  that sums them had been lost in an earlier edit of 14.2, leaving directions random; it is restored and tested by
  the histories' results); the Wilson cycle: welded groups grown large (a quarter of the planet) or old (200 million
  years) rift apart along their old sutures, half the time when motions are reconsidered; plates larger than 30 per
  cent of the planet, or carrying a large continent for 150 million years (heat builds up beneath it), split along a
  ragged line, their parts moving apart; subduction begins where old ocean (120 million years) has long bordered a
  continent on the same plate (the ocean becomes its own plate moving towards the continent; Stern 2004), and old
  sea floor far from any trench founders within the ocean (the plate splits across it and the parts close, as at
  Izu-Bonin-Mariana). Plates are made and reused as needed (up to 250).
- **Plumes** (hotspots, fixed in the mantle's frame): 0.3 km of crust a million years on the sea floor, 0.08 on
  continents, at strength 1; a chain ageing away from the plume as the plate moves; over a plate that never moves
  (a stagnant lid), one ever larger shield, as tall as gravity allows (on Mars about 23 km).
- **Timeline events** (`events.ts`): supercontinent (continents move towards a centre while it lasts, weld there),
  break-up (welds break, the largest continental plates split, continents move away from their centre while it
  lasts), rift (a split at a place), collision (continents near a place move towards it), volcanic period (plumes
  and arcs make 1 + strength times as much), large igneous province (up to 8 km × strength of basalt, about 800 km
  × √strength across, over its length), hotspot (a new plume while it lasts), impact (a basin 300 km × strength^⅓
  across, larger under weaker gravity as (g⊕/g)^¼, with a rim), reorganisation (motions reconsidered at once).
  Ice ages, greenhouse pulses and sea-level events act through the climate and water stages (14.6 to 14.8). Events
  without a place get one drawn for them, the same every time.
- **Checkpoints and any moment** (`history.ts`): a checkpoint is the whole state (plates, their crust, motions,
  welds, plumes, events, and the random generator's state, which is now kept in the state rather than a closure);
  the history at any moment on its 5-million-year grid is rebuilt from the checkpoint before it by running on, and
  is exactly the moment the history ran through (tested at three moments and through an event). Checkpoints stay
  where the history runs (they are not part of a stage's product); keeping them with a project comes with 14.5.
- **Regimes.** Stagnant lid: no motion, plumes build shields. Episodic: plates move fast a fifth of the time
  (300-million-year cycle), slowly otherwise.
- **Layers** added: crust thickness, and what made the crust (the history bits).
- **Results** (Earth-like, 500 million years at L5, five seeds): crust made and consumed balance within 1 per cent;
  the sea floor's median age 21 to 302 million years before the foundering rule, 26 to 28 after (the Earth's is
  about 60; its oldest about 180); continental crust 42 to 49 per cent of the surface (from 40: grown at arcs and
  spread by stretching), with stretched margins under the sea (the continents' lowest tenth 2.2 to 3.1 km down).
- **Tests.** `planet-continents.test.ts`: continents colliding (thickened to at most gravity's limit, a suture, the
  volume kept, welded, then moving as one; half as thick under twice the gravity); a continent rifting (stretched
  and thinned with its volume kept, then a new ocean between its halves); a plume's chain ageing away from it at the
  plate's speed; a Mars-like shield on a stagnant lid; a flood basalt, an impact basin (larger under weaker gravity),
  a volcanic period doubling a new plume's output; a supercontinent gathered and broken up by timeline events; any
  moment rebuilt from a checkpoint the same as the history's own, through an event too.

### D153. Plate tectonics: plates, crust in their frames, ridges, trenches, arcs (Stage 14.2)

- **Asked.** Stage 14.2 of the planetary engine: "plate seeding and growth, Euler kinematics with rotation
  histories, crust in plate frames, assembling the global surface, boundary classification, ridge accretion with
  age-depth, subduction with trenches and arcs, isostatic elevation", done when synthetic boundary and
  conservation tests pass and a 500-million-year preview history runs.
- **Plates** (`tectonics/plates.ts`, `state.ts`): rigid caps turning about Euler poles, rotations kept as
  quaternions. Each plate keeps its crust on a copy of the mesh in its own frame (Cortial et al. 2019): which
  cells are its own, and their kind (oceanic, continental, arc), thickness, age, time since thickening, sediment.
  Moving a plate changes only its rotation, so its crust never smears however far it travels. Plates are seeded
  apart and grown by a flood whose cost is shaped by noise and each plate's weight (a few large, many small).
  Continental crust is laid inside plates (on Earth most boundaries run through oceans), to the share asked for.
- **Each step** (`step.ts`): plates turn; every cell of the world asks the plates around it (last step's owners
  of it and its neighbours) whether the cell lies in their crust, by turning its position into their frames and
  walking to the nearest cell there (a few steps from last time's). Where two plates claim a cell and really
  close, the less buoyant goes under (continents float, then arcs, then young ocean before old): oceanic crust is
  consumed at a trench, an accretionary wedge scraped off; continents collide and the crust above thickens with
  the volume overridden, up to the thickest crust gravity lets a planet hold (70 km at Earth's gravity, as 1/g).
  Where no plate claims a cell and plates really part, new oceanic crust fills the gap (7 km, thicker from a
  hotter mantle), each step's crust going to one side of each ridge in turn, so both sides get half, in stripes,
  and every cell of the plate's frame whose centre falls in the gap gets crust too.
- **Ragged edges.** A plate's edge sampled cell by cell is ragged, so as plates move a fraction of a cell, cells
  along every boundary seem to open or overlap. Counting those made and consumed crust 8 times too fast and ate
  the continents. Crust is now made only where the plates around a gap really part, and consumed only where they
  really close (the boundary's direction from where each plate lies around the cell, the relative motion more
  than a quarter towards it); elsewhere the cell stays with the plate that held it. Over 500 million years an
  Earth-like planet now renews about twice its surface, as the Earth would at its spreading rates.
- **Boundaries** are classified by the relative motion of the plates across them (divergent, convergent,
  transform), with rates. **Arcs**: on the plate above a slab, crust is added around the arc's axis where the slab
  reaches about 110 km depth, 110 km / tan(dip), the dip steeper for older slabs (30° young to 60° at 100 million
  years); 0.2 km a million years at the axis at 5 cm a year of convergence. Oceanic crust thickened past 12 km
  becomes an arc, past 25 km continental: continents grow at their edges. **Trenches**: the cells of the plate
  going down next to where it goes down, 2.5 km deeper.
- **Heights** (`isostasy.ts`, physically based, Earth-calibrated constants): oceanic crust by its age (GDH1,
  Stein and Stein 1992: 2.6 km at a ridge, 5.65 km for old floor), continental crust by Airy isostasy (35 km
  stands 0.5 km up; deeper under water by the water's weight), arcs between; sediment and the warmth of young
  mountains add a little; a light smoothing for regional compensation. The sea is set where it covers the share of
  the surface asked for (a simplification until the water's volume decides it, Stage 14.8).
- **Motions** are reconsidered every 40 to 90 million years: slabs pull a plate towards its trenches and ridges
  push it away (Forsyth and Uyeda 1975), and a plate keeps half its old direction (the loop summing the pulls was
  lost in an edit of this stage, leaving new directions random; found and restored in 14.3, D154); speeds follow the share of a
  plate's edge that is trench and its share of continent (a slab-pulled ocean plate about 9 cm a year, a continent
  with no trench about 1.5), scaled by the interior's vigour (the activity setting × √ heat flow). Continents that
  collide over a wide front (0.3 per cent of the surface consumed, about India's) are welded and move together for
  100 million years, as their convergence would slow and stop. Regimes: a stagnant lid moves nothing; an episodic
  regime moves fast a fifth of the time.
- **The history** (`history.ts`): steps short enough that no plate moves more than 0.6 of a cell, never crossing a
  5-million-year grid, so the history is the same whichever pictures are kept; a picture (heights above the sea,
  plates, crust) every chosen interval, and the present's crust age, thickness and boundaries. A pipeline stage
  (`tectonics`) with layers `elevation`, `plates`, `crust` (per picture), `crustAge` and `boundaries`.
- **Measured** (this container): 500 million years at L5 (10 242 cells) 1.7 s; 100 million years at L6 2.8 s.
  The sea level was found by sorting every step (a third of the time); a histogram by area made it O(n).
- **Results for an Earth-like planet after 500 million years** (four seeds): the sea floor's median depth 4.4 to
  4.9 km, continents' median height 1.0 to 1.6 km, mountains to 5 or 6 km, trenches to 7 or 8 km; continental crust
  from 40 per cent of the surface to 30 to 34 (some consumed in collisions, some grown at arcs).
- **Limits, for Stage 14.3.** Ocean floor that never meets a trench stays: about a tenth of the sea floor keeps its
  starting crust (older than 500 million years, where the Earth has none older than about 200). New subduction
  zones starting at old passive margins, plates splitting where they rift, lasting sutures, hotspots and the
  supercontinent cycle come with 14.3, and will renew it. Collisions consume the lower continent at the convergence
  rate until welded, keeping its volume as thickening.
- **Tests.** `planet-tectonics.test.ts`: the relations (age-depth, Airy, the gravity limit, sea level, quaternions,
  the walk to the nearest cell); two oceanic plates parting (crust made at about the expected rate, both sides
  getting half, age growing with distance at about the half rate, depth following age, the ridge divergent); ocean
  going under a continent (consumed, a trench deeper than the floor of its age, an arc within three cells of the
  trench, the continent kept); old ocean under young making an island arc on the young plate only; a transform
  making and consuming next to nothing, classified as one; a 500-million-year Earth-like history (every cell
  held, with crust, at every moment; crust made balancing crust consumed within 8 per cent; continents kept; the sea
  where asked; Earth-like heights; young floor at ridges; the same bytes whichever pictures are kept, another seed
  another planet); a stagnant lid; the stage and its layers. Interface: the workflows step "Plate tectonics".

### D152. The planetary engine's foundations (Stage 14.1)

- **Asked.** A scientifically grounded planetary evolution engine (the plan: `docs/PLANETARY_ENGINE_PLAN.md`,
  staged in two sessions). Stage 14.1 lays its foundations: "planet definition (schema, validation, presets) and
  derived physics; the nested icosahedral mesh with operators, transfer between levels and rasterisation; the
  worker entry, pool and protocol (build entry, cancellation, progress); the pipeline skeleton with stage hashes and
  the MMS1 codec."
- **The engine is its own layer** (`src/planet/`, no DOM, no React): it runs in the interface, in workers and in
  Node alike, so every model is tested in Node and the same code runs in the app.
- **What a planet is made from** (`model/definition.ts`): a versioned JSON description (star system of one or two
  stars, orbit, body, interior, plates, air, water, history with events, life with custom biomes, quality), checked
  value by value with the reason in words (`definitionProblems`), read back from storage with anything missing or
  unreadable taken from its preset (`definitionOf`). Values the physics can work out (mass, year, tidal locking)
  are left out unless set, and then they are overrides that say what the physics would give. Eleven presets, each a
  coherent whole with its explanation: Earth-like, ancient supercontinent, young volcanic, highly tectonic,
  geologically inactive (Mars-like), frozen, desert, ocean, tidally locked around a red dwarf, high-gravity
  super-Earth, runaway hothouse (Venus-like).
- **What follows from it** (`model/physics.ts`), each relation labelled. *Physically based*: Kepler's year,
  gravity, density, escape velocity, the solar day (backwards turning over 90° of tilt), the orbit-averaged light,
  scale height and lapse rates, Held and Hou's Hadley cells. *Empirical*: main-sequence luminosity, radius and
  colour from the mass; the star brightening with age (Gough 1981, generalised by lifetime: the faint young star);
  the habitable zone (Kopparapu et al. 2013), nearer for dry planets (Abe et al. 2011); a rocky planet's mass from
  its size (Zeng et al. 2016 above, uncompressed rock and iron below: Mars and the Moon within a few per cent);
  tidal locking times (Gladman et al. 1996); radiogenic heat by isotope (Turcotte and Schubert). *Calibrated*:
  the albedo (clouds over a Rayleigh-scattering clear sky over sea, land and ice) and a grey greenhouse with the
  water vapour and ice feedbacks, iterated to balance: Earth's settings give 287.9 K and an albedo of 0.305,
  Mars's 212 K (g 3.66), Venus's 725 K (737 measured); a runaway greenhouse is flagged by the sunlight absorbed
  (282 W/m² with oceans, Goldblatt et al. 2013). The tectonic regime follows heat flow and water, as a suggestion
  explained in words ("auto"), since the science is unsettled for super-Earths. Notes in words say what the user
  should know (a star that would have died, a year set by hand, a planet the tides have locked).
- **The mesh** (`mesh/icosphere.ts`): a subdivided icosahedron (level L has 10·4^L + 2 cells: 10 242 at L5,
  163 842 at L7) whose cells are the spherical Voronoi regions of its vertices, areas summing to 4π, neighbours
  counter-clockwise with the shared edges' lengths. Levels nest exactly (a level's cells are the first cells of the
  next; the new ones halve its edges), so prolongation and restriction are exact and cheap (`transfer.ts`), and
  point location descends from the icosahedron's 20 faces through the subdivision, exactly (checked against brute
  force). Finite-volume operators (`operators.ts`): Laplacian, gradient, divergence, conservative upwind transport,
  diffusion. **Accuracy**: on this mesh the operators are first-order: the Laplacian's mean error halves with each
  level (0.1 per cent at L6), its worst stays about 4 per cent at a few cells along the icosahedron's seams (40 of
  40 962). Optimising the mesh (spring dynamics, centroidal Voronoi) would make them second-order but break the
  exact nesting the transfer and point location rely on; kept as the way forward if a model needs it.
- **Pictures** (`transfer.ts` rasterMap): the face and weights of every pixel of an equirectangular grid, found once
  per size by scanning each face's box of pixels (about one test per pixel), then any field is a weighted gather;
  categories take the nearest cell. Grids are read onto the mesh too (`sampleGrid`).
- **Sunlight** (`climate/insolation.ts`, physically based): Kepler's equation, the declination and the daily mean
  at every latitude (Berger 1978), monthly and yearly means on the mesh; tidally locked planets lit about their
  substellar point; a circumbinary pair as one star, a far companion's share added. Earth: 416 W/m² at the equator
  over the year, 172 at the poles, 524 at the north pole at the June solstice, the global mean S/4 exactly. The
  year runs from the moment Earth's calendar starts it, so an Earth-like planet's January is northern winter.
- **Products and keys** (`pipeline/`): each stage declares what it reads from the definition; a product's key is
  the SHA-256 (synchronous, `state/hash.ts`) of the stage, its version, the engine's version, those inputs and its
  dependencies' keys, in a canonical JSON form. So changing the number of plates reuses the sunlight, and changing
  the tilt does not. Products are kept in a cache by size (256 MB, least recently used first); two requests for one
  product share its making. A stage that works cell by cell runs in parts of 8 192 cells whatever the number of
  workers, joined in order: the same bytes from one worker, four, or the interface's own thread (tested).
- **Workers** (`worker/`): a pool of one worker fewer than the processor's threads (one to eight), made when
  first needed; results come back by transfer, not copied; progress per part; a cancelled task that is running
  stops its worker and a fresh one takes its place. Built as `dist/ui/planet-worker.js` (a third esbuild entry),
  served by the data service like the interface, and working in the desktop app (tested there too).
- **Files** (`state/codec.ts`, MMS1): a header naming each field (type, length, unit, how it is kept) and the fields'
  byte planes, compressed with deflate (zlib in Node, CompressionStream in the browser). Integers can be kept as
  differences, real numbers as whole multiples of a quantum (elevation to a metre); lossless otherwise. For the
  history's checkpoints (14.3) and the products kept with a project (14.5).
- **Measured** (this container, Node): building the mesh at L5 43 ms, L6 133 ms, L7 409 ms; the pixel map of a
  1024 × 512 picture at L6 179 ms; the sunlight of every L6 cell 21 ms. In the browser, the first picture of a
  planet's sunlight (L5, three workers starting) 240 ms, then reused at once.
- **Differences from the plan, and why.**
  - *Cells are numbered level by level*, the new cells of each level in the order of its faces (each face's
    children follow it, as in a quadtree), not along one space-filling curve: that is what makes the levels nest.
    Ranges of the finest cells are compact; coarser cells are spread. Enough for parts; revisited if profiling
    shows memory locality matters.
  - *The definition has no `edits` and `overrides` lists yet*: they come with editing (14.10), as optional fields
    that older definitions read without.
  - *History and checkpoints* (`state/history.ts`) come with the history itself (14.3); the codec they use is here.
- **Tests.** `planet-physics.test.ts` (every preset valid and what it says; Earth, Mars and Venus from their
  settings; Kepler, the Moon's and Mars's masses, the Sun, the faint young Sun, the habitable zone, early heat, tidal
  locking; each setting moving the results the right way; definitions read back), `planet-mesh.test.ts` (cells,
  faces, Euler's formula, areas, mutual and counter-clockwise neighbours, nesting at levels 0 to 6; point location
  against brute force at 3 000 places, the poles and 180°; the operators' accuracy by level; conservation;
  transfer; pictures and their round trip), `planet-insolation.test.ts` (Earth against Berger's values, polar
  night, the orbit's perihelion and equinox, global means for five presets, the locked planet's dark side, tilt),
  `planet-pipeline.test.ts` (SHA-256 against Node's, canonical keys, MMS1 for every type, quantised and damaged
  files, stage keys following what each reads, the cache, real worker threads: one and four workers and the
  interface's thread giving the same bytes, progress, errors, cancelling). Interface tests: the workflows step
  "The planetary engine" (a stage run in workers from the interface, the same bytes from one worker and three,
  reuse); the desktop step (workers in the app).

### D151. Stage 13's refinements: tidying unused borders, a shot's sound track, and what was not built

- **Asked.** The rest of Stage 13: "the faster GPU projection method; optional reference renderer; audio reference
  track; optimisation; long-term maintenance tools such as tidying unused parcel edges."
- **Tidying unused borders** (`geo-kernel/arrangement.ts` mergeUnreferenced, command `tidyParcels`, History Health
  › Upkeep › "Tidy this map"). Every border ever drawn cuts the parcels it crosses for good, also when the change
  that drew it is deleted or drawn over (D15): on a long project such borders pile up and every redraw pays for
  them. A piece of a parcel inherits its parent's history, so a piece no change refers to is held exactly as its
  parent is, in every layer, at every moment, in every branch and every version of an event. Where every piece of
  a parcel is undivided and referred to by nothing, the borders between them are taken away and the parcel is
  undivided again, then the same is asked of its own parent; points no border runs through any more go too. No
  change refers to anything that goes, so history is untouched (the row changes are those an undo of the
  dividing strokes would make). One step to undo.
- **A shot's sound** ("Sound" in the shot's settings): music or a narration the shot is timed to. Sound files
  (MP3, WAV, OGG, M4A, AAC, FLAC) are kept with the project like pictures. While the shot plays in the preview
  the track is heard from the frame played from, and its clock moves the frames, so picture and sound stay
  together; its waveform is drawn under the frames, with the frame shown. The second of the track heard at the
  first frame and its volume are set in the shot. Every export writes a copy beside the frames
  (`audio-reference.<ext>`), named in the manifest with the second heard at the first frame written, and the
  guide says how to line it up.
- **Differences from the plan, and why.**
  - *The sound is not mixed into exported videos*: it is a reference for timing, and the film's sound is made in
    the editor. (Way back: the browser's audio encoder, Opus into WebM and AAC into MP4, with the muxers of D121.)
  - *The faster GPU projection method* was not built. The Canvas renderer projects shapes once for a window
    around the view and moves them by a transform (sheets, D49), in blocks (D50), and redraws only what changed
    (D54, D140); terrain, fields and the photographed Earth are drawn by the graphics card (D95, D102, D138). The
    measurements (DEVELOPMENT, Performance) are within a frame or two of 60 a second for moving, zooming and
    stepping the date; what is still slow is redrawing whole projects at once (dragging the timeline 25 years a
    frame on the heavy project), which projection on the graphics card would not change, since the time goes to
    working out history and filling shapes. (Way back: the sheets' transform is the place to hand projection to a
    shader.)
  - *The optional reference renderer* exists as the reference the interface tests compare the renderer with
    (`e2e/render-compare`, 35 scenes): the earlier, simpler renderer, kept for that.
  - *Optimisation* went on through the stages (D136 to D147: fronts at scale, partial redraws, even dissolves);
    this stage's own: an engine per timeline, following edits change by change, and revisions that are never the
    same for two engines (D150).
- **Tests.** `tidy.test.ts` (borders left by four deleted events taken away while a branch's event and an
  inactive alternative version keep theirs; the main timeline and the branch the same at a grid of places at six
  dates; a valid parcel map; nothing left the second time; undo bringing back every row; three random histories
  with half their events deleted, tidied and compared, followed change by change against a fresh compile);
  `storage.test.ts` (the track copied beside the frames, the manifest and guide naming it, sound files accepted,
  only the project's own files copied); `e2e/workflows` 'Upkeep and sound' (a deleted event's borders tidied away
  with the owners of a dozen places at three dates unchanged, undone; a sound file chosen for a shot, its
  waveform drawn, its offset set, a preview exported with the track beside it).

### D150. Branches: alternative timelines (Stage 13)

- **Asked.** Stage 13 of the approved plan: "full alternative timelines with side-by-side comparison". "A branch
  splits from the main timeline at a date. It inherits all earlier events live, so fixing early history fixes
  both, and it holds its own later events. You switch branches from the title bar and can compare two side by
  side." "Both mechanisms [branches and alternative versions] just choose which events the compiler includes."
- **What a branch is** (`temporal-engine/branches.ts`, table `branch`, file format 7): a name, a colour, notes, the
  timeline it splits from (the main timeline or another branch) and the moment it splits. Nothing is copied.
  Its history is its parent's up to and including that moment, live, and after it its own events (those whose
  `branch_id` is the branch). Changes are taken one by one by their own date, so an event of the shared history
  that runs on past the split (a war begun before it) keeps its earlier changes in the branch and loses its later
  ones: what happens after the split is the branch's to tell. A branch of a branch shares with each timeline
  above it the history up to the earliest split on the way (a branch can split from its parent before the parent
  split from its own).
- **Where edits go.** Viewing a branch, an event made, or a change made without an event, from the moment it split
  on belongs to the branch; one dated before belongs to the history it shares, so fixing early history fixes
  every timeline that shares it. A branch keeps its changes without an event in an event of its own like the
  starting map (`evt_base:<branch>`), never listed. Recording into an event of the shared history after the split
  is refused with the reason (the change would vanish from the branch as it is made), and so is recording into
  another branch's events. Countries, factions, cities and characters belong to the project, not to a branch:
  branches differ in what happens to them.
- **Moving and deleting.** A branch's split can be moved to another moment (what it shares follows, live). Deleting
  a branch deletes the branches that split from it and their own events and changes, in one step that undo
  brings back; what they shared stays with the timeline it belongs to.
- **The engine** compiles one timeline: an engine per timeline looked at, each following edits change by change as
  before (D39). Its `revision` is now a number no other engine has, so pictures kept for one timeline are never
  taken for another's.
- **In the interface.** The ⑂ button in the title bar opens Branches: a branch is made from the date viewed (from
  the timeline viewed, or another), named, and viewed at once; each branch can be viewed, renamed, recoloured,
  described, split off at another moment, or deleted (saying what goes with it). Once there are branches, the title
  bar lists the timelines to switch between, marked with the branch's colour; the choice is remembered with the
  project's view. Everything listed follows the timeline viewed: the timeline's bars, the events list, search, the
  event pickers (recording, splitting, relationships, features), a country's changes and the shot's current-events
  box; the timeline marks where the branch viewed (and those it comes from) split off. An event's panel says
  whether it is the branch's own or shared ("changing it changes every timeline that shares it").
- **Comparing two timelines.** Compare (Stage 3) gains a bar over the map: the other side can be another timeline
  as well as another date (choosing a timeline compares at the same date, following the date viewed), and the two
  can be laid side by side instead of across a line: the same place twice, each labelled with its timeline and
  date. A drag on the other side moves both; nothing is drawn there.
- **Shots** show a timeline of their own ("Timeline" in the shot's settings; a new shot takes the one viewed): the
  preview, every export format, SVG frames and the size estimate draw that timeline.
- **Differences from the plan, and why.**
  - The planned schema gives entities a branch too (`entity.branch_id`). Countries, factions, cities and
    characters are kept the project's (the column stays 'main'): a country made while viewing a branch is often
    needed in the shared history as well, and an entity holds nothing by itself; what a timeline does with it is
    its events'. (Way back: the column is there to be used, with lists filtered like the events.)
  - Two timelines side by side is a way of looking while working; a shot shows one timeline (two shots, one of
    each, can be cut side by side in the video editor).
- **Tests.** `branches.test.ts`: what each timeline holds before and after the split, early history fixed once for
  both, events added before and after the split, edits put where their date belongs (events, changes without an
  event, names, relationships), recordings refused with the reason, the moment of the split shared and the
  branch's own change at it winning, a branch of a branch split earlier than its parent, moving the split,
  alternative versions inside and across branches, deleting a branch with the one below it and undoing it,
  saving and reading back, and 40 random edits across both timelines with every step followed compared with
  history compiled afresh. The upgrade test now also upgrades a file without the branch table. `e2e/workflows`
  'Branches': on a map of its own, a branch made from the date viewed keeps the land the main timeline loses after
  the split; an event of its own is listed in it alone and the main timeline's later event not; switched from the
  title bar; compared side by side at the same date (each side's colours where they should be, a drag on the other
  side moving both); a shot made in it shows it, and the main timeline when its Timeline is changed; deleted with
  its event and brought back by undo.

### D149. Each map in a calendar of its own (Stage 13)

- **Asked.** Stage 13 of the approved plan: "fictional calendars with their own day length, months and year zero
  … Each world can have its own."
- **What a calendar is** (`core-time/custom-calendar.ts`): a definition stored with the map (its settings, under
  `calendar`): months with their days (and days more in a leap year; a month of no days is a day outside the
  months, like the Thirteen-month calendar's Leap Day), a leap rule like the Gregorian one (every n years, except
  every m, but every k, counted from an offset), the Gregorian day whose midnight begins its year 1, the hours in
  its day (a world turning faster or slower than the Earth), its week (or none; running on, or beginning again
  with each month like the Republican décade), and its eras (named, abbreviated, from a year of its own count; a
  quiet era is written without its abbreviation), with a word for the years before the first, or a year zero
  instead. It only translates the stored moments to and from readable dates, exactly over the whole range of
  instants (a whole cycle of leap years at once; whole numbers beyond 2^53 for days that are not 24 hours long),
  so giving a map a calendar, changing it or taking it away changes nothing stored and is one step to undo.
- **Templates.** The Julian calendar (its leap day every fourth year, dated AD and BC), the French Republican
  calendar (its twelve months of 30 days, the Sansculottides and the ten-day décade), a thirteen-month calendar
  of 28-day months with a Leap Day and a Year Day outside the weeks, and an invented world's calendar (ten months
  of 36 days and the Turning; six weekdays; its years "AF", after the Founding) to start one's own from.
- **Where it shows.** On the map in the calendar, every date is written, typed and chosen in it: the timeline's
  ticks (its years, its months, with the year at each year's first month, its days and hours), the date viewed
  and every date field (typed in it, "14 Frostmoon 20 TA"; the arrow keys step its days, months and years), the
  calendar to choose a day (its months, its week across), the country history's periods, the compare tags, the
  sea level dialog, and in shots: the date shown on the frame, the events box and SVG frames, and the dates of
  an export's notes. "Calendar: …" under the map settings opens the dialog: start from the Gregorian or a
  template, change any part, see what the date viewed is in it (and in the Gregorian), use it; problems are
  named in words and the calendar cannot be used until they are put right.
- **Differences from the plan.** None in what was asked. The ice-age presets of the sea level dialog stay dated
  in the Gregorian (they are the Earth's).
- **Tests.** `custom-calendar.test.ts` (each template against known dates: the Julian against the Gregorian
  reform and the October Revolution, BC years and the same weekdays as ever; the Republican's 9 Thermidor Year II
  and 18 Brumaire Year VIII, its festival days and décade; the thirteen months' Leap Day and Year Day; a calendar
  made like the Gregorian one agreeing with it day for day over trillions of years; an invented world's eras,
  the years before them, a day of 30 hours and a week of six days, with round trips everywhere; definitions that
  cannot be calendars told why; a map given a calendar, refused, undone and given the Gregorian again);
  `e2e/workflows` 'A map's own calendar' (a template, an era added; the date viewed written in it, a
  date typed, stepped with the arrow keys and chosen on a six-day week, the shot's preview written in it; the
  Gregorian again in one step).

### D148. Smart brushes: the geography-aware brush and the strategic brush (Stage 12)

- **Asked.** Stage 12 of the approved plan: "the geography-aware brush and the strategic brush, with feature
  weights and live preview", tested on "synthetic terrains with known best paths". The plan's own description:
  a magnetic lasso drawn to rivers and ridges instead of the edges in a picture.
- **How it works** (`render-engine/smart-brush.ts`), in screen pixels at the zoom the stroke is drawn at:
  1. A corridor is built round the stroke, as wide as the search radius (6 to 60 px, 18 by default), on a grid
     of a tenth of the radius (coarser for very long strokes).
  2. A cost map inside it: each place's pull is the strongest of the features near it, times its weight (a line
     pulls within a couple of pixels of it, falling off smoothly; ridges and valleys by how far the ground stands
     above or below the ground round it, against how much it varies there). The cost is cheaper by up to 95% for
     the pull, and dearer away from the stroke (twice as dear at the corridor's edge).
  3. The cheapest path from the stroke's start to its end, through any points pinned (Dijkstra on the grid, each
     stretch between pins among the cells near its own part of the stroke). An outline is split at two places
     where nothing pulls, each put where the corridor is cheapest across, so following a shore all round has no
     seam.
  4. The stretches of the path that run along a line feature take its exact course (`follow-land.ts`): the
     river's own line, its bends included, not the grid's steps. The rest is simplified and its corners rounded.
     The ends of a line and the pins stay exactly where they are.
- **Features that pull** (each with a weight, 0 to 100): rivers (the Earth's from Natural Earth at the detail
  shown; a generated planet's own), coasts and lakes, ridges and valleys (from the map's heights, sculpting and
  the sea of the date included), the map's own borders as they are at the date viewed (on the layer drawn on),
  today's borders (the Earth's), and the lines drawn on the map's layers of lines (roads, railways, canals) as
  they are at the date viewed: features with lifespans are read at that date.
- **The strategic brush**: the same with a military cost model and a side that is yours (an outline's inside; for
  a line, the left of the line as drawn, swapped with a button). Rivers draw the line to their far bank, the river
  kept on your side; ridges to the crest; rough ground draws it in as a buffer; towns (the map's cities at the
  date), the points placed on the map's layers of points (objectives, installations) and mountain passes within
  reach (saddles found in the heights) are pulled onto your side: each is walled off from the line on your side,
  as strongly as its weight, so the line goes round it on the other.
- **Live preview.** After a stroke with the brush, the border pen, the Split tool or the features tool (areas and
  lines drawn freehand), with "Adjust the lines I draw" on: the stroke as a ghost, the adjusted line solid, a
  panel of the weights beside the map. Moving a weight or the radius works the line out again at once (what does
  not depend on the weights is kept, so a weight moved costs a few milliseconds). A click on the map pins a point
  the line must pass through, a click on a pin takes it away; points drawn with Alt held are pins, so a stretch
  can be kept exactly as drawn. "Use this line" (Enter) goes on as the tool always does (the brush: the question
  of what the drawing means); "Keep my line" uses the stroke; Esc drops it (for the pen, the piece is taken back).
  The settings are kept on this computer.
- **Differences from the plan, and why.**
  - *Forest edges* (land cover) are not offered: the Earth's land cover here is a picture (Natural Earth I), not
    classes; a planet's biomes could be (way back: classes from the biome map).
  - *Roads, railways, bridges and crossings* from data are not offered: none are bundled (Natural Earth's roads
    and railways could be, about 5 MB). The lines drawn on the map's own layers stand in, at the date viewed.
  - *Rivers' left or right banks*: Natural Earth's rivers are centrelines; the strategic brush's far bank is the
    centreline moved a little to the far side.
  - *Dragging a segment back* is done with pins (and Alt while drawing), which also covers "turn it off
    mid-stroke".
  - *Towns* pull only for the strategic brush (onto your side); for the geography-aware brush a town is not a line
    to follow.
- **Tests.** `smart-brush.test.ts` (synthetic lines and terrains with known best paths: a stroke beside a winding
  river is drawn onto it and ends where drawn, the stroke itself without the pull or beyond the radius; a
  meander followed round with a strong pull, cut across with a weak one; a crest and a valley floor; a pin; a lake
  shore all round; the far bank on each side; a town and a pass pulled onto your side; fast enough to move the
  sliders live); `follow-land.test.ts` (the exact course taken along rivers, round a loop, two lines near each
  other); `e2e/workflows` 'Smart brushes' (the brush beside the Rhine onto a river's own course, the weight moved
  live, a pin, the line used and the land held up to the river and not across it; the pen's line on the
  Pyrenees' crest, 1,452 m on average as drawn, 2,001 m adjusted; a town pulled onto your side, the sides
  swapped; Esc taking the piece back).

### D147. A dissolve goes at an even pace, whatever its pattern

- **Found** by the Windows run of D145, which failed in a step that change had not touched: halfway through a
  dissolve, 88% of the land had changed hands, where the test allows 15 to 85%.
- **Why.** A dissolve's patches come from smooth noise seeded by the change (D136), and each cell changed hands
  when its noise said so, scaled between the lowest and the highest value in the change. Where the pattern's
  values crowd toward one end, most of the land goes in the first half of the time, or the last. Over 400
  patterns the share gone at half time ran from 15% to 86% (the middle tenth to ninth tenth: 33 to 66%). Each
  change's pattern is its own, so the same test met another pattern on every run, and one run in a few hundred
  fell outside what it allowed.
- **What.** A cell's time is now its place among the change's cells in the order the noise puts them
  (`front-field.ts`, the scatter source): the patches are the same patches, in the same order, but a quarter of
  the land has changed hands a quarter of the way through, half at half time, for every pattern.
- **Tests.** `front-field.test.ts` (eight patterns: the share taken within a hundredth of the share of the time
  gone, at five moments; still in several patches); render-compare 'Looks' now asks for about half at half time
  (30 to 70% of the part looked at).

### D146. Close in, coasts and the lie of the land bend below the grid's cells

- **Asked.** Enhance all the maps; detailed when zoomed in. Left undone by D141: a generated planet's coast
  close in ran from cell to cell of its heights (cells of about 20 km) in smooth scallops with corners, and
  made-up heights could not move it, since its shelves are steep.
- **What.** With the fine ground on, the place the heights are read at wanders (`terrain-gl.ts`, `bend`): waves
  of smooth noise two cells long move it by up to three tenths of a cell, then each wave half as long and half
  as far, down to waves of a few pixels, the finest fading in as the view comes closer. A coast, and every line
  of equal height with it, then bends in bays and headlands of every size down to the screen's pixels, never
  more than about half a cell from where the heights put it. It fades in as a cell grows from four to twelve
  pixels wide: from afar nothing is changed. Laid out in space on the planet's surface, like the fine ground:
  no seam, the same at every visit and in every export.
- **Everything the graphics card draws from the heights follows**: the land's colours, the relief, the sea, and
  the picture of the land that cuts territories and their fronts (D145) to the coast, so a country still ends
  exactly at the coast drawn. What is worked out from the heights off the card does not: a planet's rivers end
  where the heights put the coast, so close in a river may stop a few kilometres short of the bent coast or run
  a little past it; names and clicks likewise take the heights' own coast.
- **The Earth.** At today's sea level its coast is Natural Earth's outline and does not move (only the lie of
  the land bends, by fractions of a cell). At another sea level (D96) its coast is the terrain's and bends too:
  made up, as the fine ground is, below the 10 km of the heights.
- **One switch.** "Fine ground close in" in Show, Terrain (D141) turns both off.
- **Tests.** render-compare 'Close in, a coast the terrain decides bends' (a straight coast in heights of a
  quarter degree: straight with the fine ground off; with it on wandering over half a cell's width, at most a
  third of a cell off, about the heights' coast on average, turning twenty times in the view, the same every
  time; from afar as without). By eye on a generated planet at 50, 10 and 2 km to the scale bar.

### D145. A front's line and glow end at the coast where the terrain decides it

- **Found** by eye, playing a front on a generated planet: the territory ended at the coast, but the front's
  line and the glow behind it ran on over the sea, across the whole of the change's outline.
- **Why.** Territory ends at the coast unless its layer covers the sea. On the Earth as it is, the coast is an
  outline, and the highlights of fronts are cut to it once for all changes (D139). Where the terrain decides
  what is land (a generated planet, D97; another sea level, D96; sculpted coasts, D98) there is no outline: the
  fills are cut by a picture of the land made by the graphics card, and the highlights were not cut at all.
- **What.** There the highlights of a layer's fronts are drawn apart, in a buffer, cut by the same picture of
  the land, and laid on (`map-renderer.ts`, where `lit` is drawn). One more buffer and one more cut a frame, and
  only on such worlds while a front with a line or a glow is under way.
- **Tests.** render-compare 'Where the terrain decides the coast' (a sea over half of a change: the line and
  glow change thousands of pixels over its land and none over its sea; fails without the cut, checked).

### D144. A long straight border bows on the map: boxes and fronts follow the bow

- **Found** by eye, playing a front across the Alps between two countries drawn with four points each: a thin
  strip of the old owner's colour stayed under the border the front started from, all through the change.
- **Why.** A border between two points is an arc of a great circle. On the map a long one bows toward the pole
  past both its ends: by a fifth of a degree over 14° of longitude at 48° N, by 4° over 60° at 50° N. Two things
  took it for the straight line between its ends:
  1. *Boxes.* A parcel's box (`parcel-geometry.ts`) held its points only. Since changes under way are drawn
     again inside their boxes alone (D139, D140), the land between the line and the arc was outside the box: it
     kept the picture's earlier colour. The same box decides what of a kept picture is patched after an edit and
     what is looked at when moving the map, so a long-edged parcel could also be cut there. Lines and areas drawn
     as features had the same box (`makeRing`).
  2. *Fronts.* A front's field (D136) took the change's outline and the border it starts from as straight
     pieces in longitude and latitude; the land under a large bow (more than the few cells a field reaches past
     its outline) was not part of the field at all.
- **What.** `arcLatitudes` (plane.ts) gives the lowest and highest latitude an arc reaches (the great circle's
  own highest point, when it lies between the ends); a parcel's and a feature's box takes it in for every piece
  spanning more than 0.05° of longitude (below that the bow is under a metre). A front's outline and source
  (`front-source.ts`) get points along long borders, about a degree apart.
- **Who it touched.** Territories drawn with few points over a large area (a quick sketch, a box, borders
  imported as coarse polygons). Borders drawn freehand or following coasts have points every few kilometres and
  were never affected.
- **Tests.** `plane.test.ts` (the latitudes of arcs, against points along them; boxes of rings and parcels);
  `front-source.test.ts` (outline and source along the bow; the land under it in the field); render-compare 'A
  long straight border bows' (the new owner's colour under the bow, drawn afresh and frame after frame; fails
  without the box, checked).

### D143. Frames a second, read on the computer itself

- **Why.** "Everything at a solid 60 frames a second" cannot be measured where the app is built: the test
  machines draw in software, without a graphics card, and what is left of a frame there is the browser's own
  painting, which a graphics card does many times faster (see "Performance, 19 November" in DEVELOPMENT.md).
  The readout in Settings told only how long the app's own drawing took.
- **What.** With "Show how long the map takes to draw" on, the corner of the map also tells the frames a second
  the screen is getting, counted over the last second from every frame the browser offers the app
  (`ui/frame-meter.ts`), and the longest wait between two frames in that second: a single hitch shows there even
  when the count hardly moves. A wait of a second or more (the window hidden) starts the count again.
- **Reading it.** 60 on most screens (120 or 144 on faster ones) with a longest wait near 17 ms means everything
  keeps up: moving the map, playing history, a shot's preview. A lower count or a long wait while doing
  something says where it does not, on that computer, and is worth reporting with what was being done.
- **Tests.** `frame-meter.test.ts` (a steady screen, a faster one, a hitch, a pause); `e2e/workflows` 'Settings'
  (the readout appears with a rate a screen can have).

### D142. Fronts that mind the land: slower over mountains and water

- **Asked.** The item left of the transitions stage: a front slowed by terrain, not only shaped by where the
  land is (D136).
- **What.** A look has one more setting, 0 to 1: how much its fronts mind the land (`ShotTransitions.terrain`;
  Adjust the look, "Slowed by mountains and water"). A front's field (D136) is made of the time the front takes
  to cross each cell; where the look minds the land each cell of the change is slower by what the map's heights
  say there (`front-terrain.ts`, `terrainSlowness`):
  - rugged country: how far the land rises and falls within about 20 km of the place (or half a cell of the
    field, when that is longer), full at 900 m: up to three times slower;
  - high ground: from 1,500 m, full at 4,000 m: up to one and a half times more;
  - water to cross (below the sea of the moment, D96): two and a half times more.
  The field is fast marching over these speeds, so a front takes the quick way: up a valley and round a range,
  along the plain while the mountains beside it hold out, across a strait late. The change still takes the time
  it was given: the land only decides where the front is at each moment of it.
- **A look of its own**, "Overland" (a little ragged, a gentle glow, minding the land by 0.8). Every other look
  is as before; a shot saved before this minds nothing. An event can take the look for itself (D137).
- **Which heights.** The map's own, of the moment: the Earth's, a generated planet's, with sculpting (D98) and
  the sea level of the date (to the nearest 10 m, so a rising sea does not make a front anew every frame). They
  are loaded for a shot or an event that asks, whether or not the terrain is shown (`frontsMindLand`); until
  they are in, and on maps without heights (flat maps, space), fronts go as ever. Dissolves and fades mind
  nothing.
- **Kept pictures and fields.** A field is kept by how much it minds, the heights' name and the sea level beside
  what it was kept by before (D139); the picture of a moment likewise, so other heights give another picture.
- **The preview** shows a sample range across the northern arm of the land taken (a few marks) when the look
  minds the land: the front runs on along the southern arm while the range holds out.
- **Cost.** Five heights read per cell of a field, once per field: under a millisecond for the finest.
- **Not done.** Rivers as obstacles (they are lines, not heights); roads and passes as quick ways; a say per
  change in how fast its own land falls.
- **Tests.** `front-field.test.ts` (a slow band is crossed late and gone round); `front-terrain.test.ts` (plains
  as ever, flanks and crests and the sea slower, by as much as is asked; a front minding a range takes longer
  across it); `sequence.test.ts` (off unless asked, kept in range, the look, when heights are wanted);
  render-compare 'Fronts that mind the land' (behind over mountains, ahead over the plain beside them, in
  between at half; pixel for pixel as ever without heights or when not asked).

### D141. Fine ground close in: made up below the heights' own detail

- **Asked.** Enhance all the maps; detailed when zoomed in.
- **Found.** Close in, every terrain look went soft where the heights ended: a planet's cells are about 20 km, the
  Earth's 10 km (or about 40 m where finer heights are downloaded, D101), and below a cell the land was one flat
  colour. Generated planets have no photographs to fall back on (D138).
- **What.** Below the grid's own cells the graphics card makes up the ground (`terrain-gl.ts`, `u_fine`): waves
  of smooth noise, each half the size of the last, from the cell's size down to two pixels, the finest fading in
  as the view comes closer. They give slopes of their own, added to the terrain's before it is lit: steeper where
  the land itself is steep (folded into ridges and valleys there), all but flat on plains and under the sea; and a
  faint mottling of the colours (4% on land, 1% at sea). The noise is laid out in space on the planet's surface
  (value noise with its slopes, after Inigo Quilez): no seam at the 180th meridian or the poles, and the same
  ground at every visit and in every export. Nothing is made up until a cell is more than four pixels wide, so
  views from afar are as before.
- **For every terrain look** (natural, atlas, satellite and the planets' own), on generated planets and on the
  Earth; over photographs (D138) only the terrain's part shows, since close in a photograph is not shaded.
  A switch per map in Show, Terrain: "Fine ground close in", on by default.
- **Speed.** Up to ten waves of eight lattice values each for a pixel, only where cells are large on screen; a
  terrain picture is drawn once for a view and kept while the map moves (D95).
- **Not done.** Ground that differs by biome (dunes, forest canopy, fields). (A planet's coast close in, which
  still followed its cells: done since, D146.)
- **Tests.** `e2e/workflows` 'Terrain': with the bundled heights alone close in, more to see once the fine ground
  is on (spread of lightness), and the same ground when the view comes back to it. Checked by eye on a generated
  planet's mountains at 50 km and 10 km to the scale bar, satellite and natural colours.

### D140. Only the strip a front has crossed is drawn again; two faults of partial redraws fixed

- **Why.** While a change animates, only the rectangles round it are drawn again in the kept picture (D58). They
  were the change's whole parcels with room for the line and its glow: at a film's pace on the heavy benchmark
  project (eleven changes under way) half the frame, every frame; and when a change began or ended, every change
  under way was drawn again whole.
- **What.** Between two moments nothing of an advancing front differs but the strip it has crossed (with its
  line, its glow and its soft edges). The picture kept now remembers how far each front had come in it
  (`shownFronts`); for the next moment each front with the same field gives the boxes of its field's blocks (8 by
  8 cells) whose times reach into the span crossed (`bandBoxes`, with room for the line, the glow, the blur of soft
  edges and a cell for the lines' rounding), and those alone are drawn again (`frontRects`). A change that has
  just begun or ended, a fade, or a front seen for the first time gives all its parcels as before. The same when
  the stretch of time changes under changes that go on (a change begins or ends while others are under way).
- **Result.** At a film's pace the part of the frame drawn again fell from about half to 7% (clean) and 30%
  (Blitz, whose glow reaches far). In software the frame went from 62 to 56 ms: here the time is no longer in
  the area painted but in handing whole pictures to the canvas; where a graphics card paints, the area is what
  counts. `MapRenderer.lastRedraw` gives the share for tests and measurements.
- **Two faults found on the way**, by comparing frames drawn in part with frames drawn afresh in an intense look
  (render-compare, which until now compared the plain look only):
  1. *Holes in soft edges.* The soft edge's colour is painted in a buffer of the change's box; shapes are painted
     block by block where drawing is going on, told in the picture's pixels, not the buffer's. Whenever only part
     of a kept picture was drawn again (every frame of a preview after the first), blocks of the new owner's
     shape were skipped and the soft edge was missing in places: differences of up to 108 levels. The buffer's
     painting is now told where drawing goes on from its own corner (and the same for border lines drawn in a
     buffer).
  2. *What a buffer kept from its last use.* A buffer for a box cleared only the box of its last use, while
     lines, shapes and blurs drawn into it ran past that box; a later, larger box showed them faintly (up to 11
     levels, coming and going with what had used the buffer before). Nothing is drawn beyond a buffer's box now.
  Blurred masks also keep room past the picture's edges, so a soft edge does not fade where it meets the frame.
- **Tests.** `front-field.test.ts` (the boxes between two moments hold every place whose reaching changes, either
  way round, and are a fraction of the change; none past the end; all of it for the whole span). render-compare
  'While a change animates': now also in an intense look (ragged, soft edge, glow, wide glowing line), every
  frame drawn in part equal to one drawn afresh (at most 0.0007% of pixels differing; 0.7% before the fixes).

### D139. Fronts at scale: a hundred changes under way at once

- **Asked.** Large-scale and stress tests of the transitions, and their optimisation.
- **Measured** (`bench/render.bench.ts` playAllClean and playAllBlitz, new: the benchmark projects' history played
  with every change animated). On the heavy project (500 border changes, a thousand years in ten seconds: about a
  hundred changes under way in every frame) a frame took 2.9 s in the clean look and 3.4 s in Blitz. A profile
  (`bench/profile.ts playAll`): half in making fields, a fifth in cutting each change's drawing to shapes as large
  as the picture.
- **What.**
  - *Where a front starts* was found by looking at every edge of the map (127,000 on that project) for each
    change: now the change's own edges are walked (`front-source.ts`; `front-source.test.ts` compares the two).
  - *A field is as fine as its change is large on screen*: a cell about two and a half pixels, 32 to 160 cells
    across in five steps (`FIELD_CELLS`); a small change far away takes a ninth of the work. A ragged front's noise
    is laid out by place within the change, not by cell, so it is ragged the same way at every fineness
    (`front-field.test.ts`: the same times within 0.035 and 95% of places alike at 48 and 160 cells).
  - *Lighter fields*: carried beyond the change by a queue instead of seven passes over the grid; the land reached
    and the front's own lines traced once for both; tracing shares its working room between fields; the fields
    kept are limited by the cells they hold together (four million), not by their number.
  - *Each change's drawing is cut to its own box first*: the shapes it is cut to ("everywhere this front has not
    come", "this change with its new owner's whole land") cover the picture, and cutting to them cost the whole
    picture for every change. The highlight of all changes is cut to the coastline once, not once each.
  - Where a change is on screen is found once for a view, not for each use.
- **Result.** 2,855 to 585 ms a frame (clean) and 3,420 to 815 ms (Blitz) with a hundred changes under way; at a
  film's pace (eleven under way) 62 ms and 84 ms, in software. The changes themselves are now a few milliseconds;
  the rest is the browser painting again what lies in the rectangles round them (see DEVELOPMENT.md, Performance,
  19 November).
- **Not done.** Redrawing only the band a front has crossed since the frame before (most of a change's rectangle
  is the same from frame to frame); painting by the graphics card.

### D138. The Earth as photographed: the satellite look from real photographs, sharp to city scale

- **Asked.** The satellite maps should be very photorealistic and detailed when zoomed in, still good at the scale
  of a city.
- **Found.** The satellite look coloured the land by its cover (D100): right from afar, a smear of 10 km cells
  close in; nothing man-made, no real coasts, rivers or fields.
- **What.** The satellite look of a map of the Earth is now the planet as photographed: **Sentinel-2 cloudless
  2016 by EOX** (https://s2maps.eu, Creative Commons Attribution 4.0, made from Copernicus Sentinel-2 photographs
  with the clouds taken out; about 10 m a pixel).
  - *The whole planet* ships with the app: level 3 of its tiles laid side by side, 4096 by 2048 pixels, 919 KB
    (`data/terrain/earth-photo-4096.webp`, made by `scripts/fetch-earth-photo.mjs`), loaded with the land cover.
  - *Close in*, once the bundled picture's pixels are more than a pixel and a half on screen, the photographs of
    the region in view (and a quarter of the view around it, for moving the map) are fetched as tiles through the
    local data service (`/api/photo-tile/level/row/column`), which keeps each tile it downloads (the desktop app
    with its own data, the browser version in a hidden folder of the projects folder) and serves kept tiles with
    no network. The level is the one whose pixels are a screen pixel or finer (a device pixel on dense screens),
    coarser when that would take more than 300 tiles; level 13, the photographs' own detail, is the finest. The
    tiles are laid side by side into one picture of the region (`terrain/photo-cache.ts`; the last two kept),
    which the shader reads inside the region, fading in over its edge. A tile that cannot be had is asked for
    again after a minute; offline with none kept, the bundled picture is drawn.
  - *Tiles in longitude and latitude* (the source's "WGS84" set: level L has 2^(L+1) columns and 2^L rows): they
    are laid like the app's own grids, so nothing is re-projected before the shader, which draws them in any
    projection as it does the heights.
- **What stays the app's own.** Land and sea are the photograph's wherever the terrain is today's. Where the sea of
  the moment has taken land or left it (D96), and where the terrain was sculpted (D98), the colours are the land
  cover's and the sea's by depth as before: the shader compares the coast of the moment with today's, pixel by
  pixel. Maps of the Earth in geological time (D134) and generated planets have no photographs. Relief shading
  lies over the photographs at half strength from afar and not at all close in (a photograph has its own light).
  No rivers or coastline are drawn over photographs (they show their own); lakes are the photograph's.
- **A switch per map** in Show, Terrain (satellite colours only): "The Earth as photographed", on by default; off,
  the land cover as before. While photographs are shown the map carries their makers' credit in its corner, and
  exports list it with their other credits (`s2cloudless` in `data/datasets.json`, shown in Data sources and
  credits). The licence asks for that credit wherever pictures of the photographs are published.
- **Speed.** A terrain picture is drawn once for a view and kept while the map moves (D95): the photographs add
  two texture reads to a shader that runs once per rest. A region's picture is put together off the drawing path
  (tiles decoded by the browser, drawn into one canvas) and uploaded once.
- **Not done.** Photographs for generated planets (they have none: finer procedural detail is next); the
  photographs are of 2016 whatever the date shown; the poles beyond the satellites' reach are the source's own
  filling.
- **Tests.** `photo.test.ts` (the tiles' layout; which tiles a view needs at each zoom, never more than allowed,
  across the 180th meridian and at the poles; where their picture lies; when a picture covers a view; the bundled
  picture and its record); `terrain-tiles-server.test.ts` (a picture tile downloaded once and kept, served with
  the network gone; something that is not a picture not kept; refused requests); `e2e/workflows` 'Terrain' (the
  picture of the whole planet and its credit on the map; the land cover with the switch off, in other colours;
  picture tiles made by the test, magenta and green stripes, shown close in).

### D137. Looks for transitions: soft, glowing, ragged, in patches

- **Asked.** As D136: clean by default, intense when wanted, simple to use without limiting what can be made.
- **What.** How a moving front looks is now a handful of settings, each from 0 to 1, with the line along it:
  - *ragged edge* (`roughness`): the front's pace varies smoothly from place to place (the field's slowness, D136,
    from a seeded noise), so it advances in fingers and bays; the same change always the same way;
  - *soft edge* (`soft`): the new owner's look runs ahead of the front, fainter the farther ahead (over the land
    the front reaches up to a quarter of the way later, in six steps, blurred); land given up to nobody is let go
    of softly the same way; the moving border fades out as the edge gets soft;
  - *glow behind* (`wake`): a glow over the land just taken, brightest at the front and fading over the land
    reached before (up to a third of the way back), laid on lightening what is under it;
  - *the line* (shown or not, colour, width, glow): its colour `auto` is the new owner's, lightened. The line and
    the moving border are now the front itself only: traced where the front crosses the land, up to the change's
    edges, never along them nor along land beside a narrow gap, nor round an island not yet reached
    (`frontLines`: crossings between two cells of the change, or just past its edge beside one).
- **Dissolve**, a style of its own: no front; the land changes hands in patches (each place at a time set by the
  same noise), softened by the soft edge.
- **Looks to start from** (`TRANSITION_LOOKS`): Clean (the default: a crisp front with a fine glowing line),
  Minimal, Soft tide, Ink, Campaign, Blitz, In their colours, Dissolve and Fade. A look sets the style, the settings
  above and the easing, and keeps when and how long; any part can then be changed.
- **An event's own look** (`setEventLook`, kept in its presentation settings beside its own time on screen, D92):
  its changes look that way wherever they animate, in the working view as in every shot, and take the look's style
  and easing where a shot animates them. One battle can be a blitz in a film whose other changes are clean.
- **In the shot editor** (`TransitionLook.tsx`): one list of looks, each with a line saying what it is like, and a
  live preview below it: a sample change (a country taking its neighbour's land, round a bay and across to an
  island) drawn by the map's own renderer in the look, again and again. "Adjust the look" opens the settings above
  as sliders (shown in the preview while dragged, kept when let go) and the line's colour (the new owner's, or one
  chosen), width and glow; changing any of them makes the look the shot's own ("Custom"); choosing a look again
  sets every part of it. An event's panel has "Look of its changes" (as the shot's, or a look of its own), and
  every place a change's animation is chosen (the event's panel, recording, the dialog after drawing, event types)
  offers Dissolve.
- **Quick enough.** At 1920 by 1080 in the test browser (no graphics card), two changes under way: 6 ms a frame
  clean, 10 to 12 ms with a soft edge or a glow, 25 ms with every effect at once. The lines a moment needs are traced
  only in the blocks of cells whose times span it (0.1 ms a line, from 0.5); a front's lines are projected point by
  point where nothing of them lies across the map's edge; soft masks are made at a quarter of the size and only
  round the band they cover.
- **Found and fixed on the way.** A picture of the same moment drawn again in another look (or with another colour
  of line, before this) was the picture kept from before: the look is now part of what the kept picture is of.
- **Tested.** front-field: the front's own lines across the near arm of two arms joined at the top, edge to edge,
  never along the narrow gap or on the far arm; nothing round an island not yet reached; patches closed; where the
  land reached between two moments lies. sequence: every look named, explained, within range, keeping when and how
  long; Blitz intense, Minimal without a line; saved settings kept in range; an event's own look set, kept beside
  its own time on screen, undone, cleared. render-compare: a clean edge 1 px of mixed colour against 34 px for a
  soft one, ahead of the front; a glow just behind the front and none over the land taken long before; the line
  exactly the owner's colour lightened and none along the change's edge; a dissolve in patches all over the change;
  an event with the Blitz look glowing behind its front while the other change does not. workflows: Blitz chosen in
  the shot editor sets every part of it and its preview plays; a slider makes the look the shot's own, the rest
  kept; the glow in the owner's colour; Clean again resets every part; an event's own look from its panel; undone.

### D136. Fronts that follow the land

- **Asked.** Transitions of borders are among the most important parts of the whole software: overhaul them to a
  professional standard, simple to use, clean by default, intense when wanted, and above all working out the borders
  and the borders round them so that they never get in the way.
- **Found.** An advancing front reached every place within a straight-line distance of the border it started from
  (D33): through a U-shaped territory taken from the tip of one arm, it jumped the gap and coloured the other arm's
  tip before it had gone down the first arm; it crossed bays and lakes the same way. An expansion was a circle,
  whatever the land's shape.
- **What.** A front now travels through the land itself (`front-field.ts`). For each change, once, a field of
  arrival times is worked out on a grid in longitude and latitude over it (160 cells across its longer side, so
  the same whatever the camera does), by the fast marching method: from where the front starts, outward through
  the cells of the change only, each reached at the earliest time a front could get there; parts of the change cut
  off from the rest (islands) are reached from the nearest land already taken, as the front would cross the water.
  Times are scaled so that the last place is reached at 1, and carried a few cells beyond the change so that its
  own edges stay exact. At any moment the land reached is traced as smooth closed lines (marching squares, the
  corners rounded), projected like any other shape, and handed to the drawing as before: the new owner's colour
  within it, borders inside and outside it (D9, D126), the moving border and its highlight along its edge.
- **Where a front starts** (`front-source.ts`), worked out from the parcels round the change: from the border it
  shares with the new owner's land as it was; failing that (the owner's land across the sea or beyond another
  country), as a straight front from the side facing the owner's nearest land; a country that held no land before
  grows from the middle (the place farthest from every edge, not the centroid, which may lie outside); land given up
  to nobody is let go from its outer edges inward, toward what its old owners keep; an expansion from the points it
  was drawn from (several at once still close on the middle, D91), or the middle.
- **Measured.** A change of 160 by 162 cells: its field in 20 to 45 ms, once; its line at a moment in under 1 ms.
- **Tested.** front-field: a U taken from the tip of one arm: down it, along the bottom, up the other, later all
  the way, half way at the bottom's middle, about 40.5 degrees travelled round the inside corners; from a straight
  border each place when its distance says; the land reached as closed clockwise lines holding what is reached and
  not the gap, all of it at the end; an island reached after the shore facing it, its far corner last; pincers
  meeting in the middle; from the middle; from the side facing a place across the sea; across the 180th meridian;
  a band round the planet refused; quick enough. render-compare: the reference renderer draws fronts the same way;
  the zigzag front still at one distance from where it started (within 6 px of 120), no old border behind it, no
  seam, no border where two changes meet before a front gets there.

### D135. Continents slide between the maps of geological time

- **Why.** With the maps of D134 blended in place, a continent moving between two maps 5 million years apart
  faded out where it was and in where it went, rather than moving: wrong for timelapses, the point of the map.
- **What.** How the crust moves between each map and the next older one, worked out from the PALEOMAP plate
  model (C. R. Scotese's rotations and plate polygons v19o_r1c, CC BY 4.0, from A. T. Kocsis and C. R. Scotese's
  PaleoMAP PaleoCoastlines data, 2023) with pygplates (`scripts/paleo-motion.py`): points every half degree on
  today's Earth are given their plate and carried back through time by its rotations; for each pair of maps,
  every one-degree cell gets the mean move (east and north, in tenths of a degree of arc) of the points in it
  that exist at both ages (continents and the older sea floor; cells with none take their neighbours'). Kept
  with the maps (format "MMP2", 1.1 MB more). Between two maps the heights are read along that motion
  (`morph`): the crust at a place, a fraction f of the way, was f of its move from where it is in the younger
  map and the rest from where it is in the older one, the two blended as f says; exactly each map at its own
  moment.
- **Checked.** Moving each map by its motion brings it closer to the next older one for 104 of the 108 pairs
  (land differing in 3.5% of cells on average, against 5.2% unmoved); for the other four, within a few tenths of
  a percent.
- **Tested.** paleo: a block moving 3 degrees east is 1.5 degrees on half way and a quarter way a quarter of it,
  whole all the way, where blending in place melts it; with the real maps, India moves steadily north between
  50 and 45 million years ago, as large half way as at either end; the motion packed and read back.

### D134. The Earth through geological time

- **Asked.** When making a map, the choice of the Earth as it really was through geological history, changing
  over tens of thousands and millions of years, accurate to how the Earth actually looked.
- **What.** A kind of map in the New map dialog: "The Earth through geological time" (`createPaleoEarth`: the
  Earth's radius, no present-day geography; `settings.paleo`, terrain source 'paleo'). Its land and sea floor at
  the moment shown come from the PALEOMAP PaleoDEMs (C. R. Scotese and N. Wright, 2018, CC BY 4.0): 109 maps
  from today back 540 million years, every 5 million years (two Devonian maps a little off), each relative to the
  sea of its time, here in cells of one degree (`data/paleo/paleodem-1deg.bin`, 3.3 MB, the "MMP1" format of
  `src/terrain/paleo.ts`; made by `scripts/paleodem-extract.py` and `scripts/pack-paleodem.ts`). Between two maps
  every height is blended (`paleoGridAt`), so that coasts, mountains and seas change steadily; the coasts are
  where the land meets the sea of the moment, as on generated planets (D97), and territory that ends at the coast
  follows them. Over the last 128,000 years the sea of the glacial cycle is added (`GLACIAL_SEA`: a smoothed,
  rounded reconstruction after Lambeck and others, 2014, and Spratt and Lisiecki, 2016, good to some tens of
  metres: about 130 m lower 21,000 years ago, so that Beringia, Doggerland and Sundaland are land); the user's own
  sea level points (D96) still apply on top. Dates before 10,000 BCE are written as how long ago they were
  ("21,000 years ago", "2.58 million years ago", "250 million years ago", counted from 2000), and read so too
  ("250 Ma", "2.6 mya", "21 ka", "21,000 years ago"); the timeline of such a map spans 545 million years with ticks
  at round ages, and history plays at up to 20 million years a second. The map's note names the moment ("250
  million years ago · Permo-Triassic Boundary") and the sea's level when lower. Shots and exports draw each
  frame's own moment; the data is credited in exports.
- **Limits.** One-degree cells (about 110 km): no small islands or narrow straits; between two maps 5 million
  years apart coasts and mountains changed by blending, not by the plates' motion (continents seemed to melt from
  one place to the next rather than slide; since D135 they slide); the glacial seas use today's sea floor at one degree.
- **Tested.** paleo: maps packed and read back exactly, damaged files refused, blended half way, kept within the
  span; the real maps: 109 from 0 to 540 million years ago, today about 30% land, the Sahara and Tibet high and
  the Pacific deep, 250 million years ago one land holding more than 85% of all land (Pangaea) against today's
  several; the glacial sea (130 m lower 21,000 years ago, 6 m higher 125,000 years ago, today's before 128,000);
  ages of instants and back; dates written and read as how long ago; the map made in one step, undone.

### D133. The solar system side by side

- **Asked.** A way to show the solar system side by side: organised, less about the planets' movements and
  more about the political territories, the history and the story of what people were doing.
- **What.** A choice kept with a solar system map (`layout`: where they are, or side by side), turned with a
  button on the map ("Side by side" / "Orbits"; one undo step): the Sun at the left, the planets in a row at even
  steps, each planet's large moons in a column below it, inner first (`solarRowCatalogue`), joined by thin lines
  (`solarRowLines`); seen flat, without rings. Over each planet its name, and when it is held, its holder's name
  in the holder's colour and since when ("since 2187": back over every change that kept it with the same holder,
  `Holding.since`); beside each moon its name, and its holder's when not its planet's. Realms are territories
  (D132) over the columns: neighbours held by one realm merge, two realms meet between them, a front where two at
  war meet; lanes (D112) curve over the row, higher the farther they go, as on a map of routes, and grow along
  their curve in an event. Distances in the panels stay true. Shots and exports draw the same.
- **Tested.** solar: the Sun, then every planet at its step in the row, the row centred, each planet's moons below
  it, inner first, distances from the Sun true; the row and a column for each planet with moons, no rings, seen
  flat, a realm's reach between half a step and a step; laid out and back in one step each, refused for other
  maps; since when a body has been held (from the change that gave it, kept when given again to the same holder).

### D132. Realms across the stars as territories, with fronts, changing hands in shots

- **Asked.** A way to show territories and how they move across the stars, for great science-fiction wars
  and futures.
- **What.** Every star a country or faction holds reaches out round it (3.2 light-years on a map of the
  nearby stars, as before), most strongly at the star and fading to nothing a little beyond its reach; one
  realm's reaches add up, so its stars near each other merge into one smooth space and a lone star holds a
  round one (`territory.ts`). A place belongs to the realm reaching it most strongly, when that is strong
  enough; where two realms reach it, the border runs between them, pushed back from the side with more stars
  behind it. Worked out on a grid over the picture in cells of two pixels (four at 4K): who holds each cell,
  where each border crosses between two cells (from how strongly each side holds them), and how far every cell
  near the realms is from the nearest border (a distance transform within each realm and a little way into
  free space). From these: the fill, with a glow along its edges and its edge smoothed (a picture of the
  cells); the border lines, traced through the crossings as lines (sharp at any size, and lines in SVG frames):
  a realm's edge in its own colour lightened, a border between two realms in their colours mixed, and where
  two realms are at war (the relationships of D80), a front, hot red with a glow; each realm's name where it has
  most room, written over the stars, which keep their names out of its way. In shots a star changing hands is
  won gradually: the new holder's space grows out from the star over the old holder's (a front moving out),
  and a star given up to nobody: its old holder's space shrinks back to it. Kept between frames while nothing
  moves. The look (D130) chooses territories with borders (the default), the soft glows of D111, or none, and
  how strongly they are filled, how wide their borders and how much they glow.
- **Measured.** A realm of 400 stars at full HD: the field and its lines in about 80 ms (a working view of
  1100 by 700: about 12 ms), only when the view, the holdings or the look change.
- **Tested.** sky-look: a lone star holds a disc of about its reach, its border one line round it, its name at
  its middle; one realm's stars near each other merge, far apart they do not; between two realms the border
  runs half way, each side knowing who is across, and moves back from the side with more stars; changing hands
  the new holder grows out from the star over the old, a star given up shrinks back; the fill painted with its
  glow and nothing beyond; quick enough to follow a moving view. workflows: two realms side by side on a chart,
  their border between them in their colours mixed; at war, a front there.

### D131. A star map seen as a flat chart

- **Asked.** A way to make the star map more like a map: a filter that draws it as a map of stars rather than
  a thing in three dimensions.
- **What.** Part of the look (D130), turned on and off with a Chart button on the map: the map seen straight down
  on the galactic plane (or the plane of the solar system), without perspective: every star as large wherever it
  stands, the way to the galactic centre to the right (`makeSpaceView(…, chart)`). A drag moves the chart, a
  right-drag turns it round its middle (`turnChart`), the wheel zooms. Its grid: the rings as before, squares,
  or hexes numbered by column and row as sector maps are, every so many light-years (or as the rings), numbered
  at the edges; no lines down to the plane: instead each named star's height above or below the plane beside
  its name, as a number (light-years) or as a mark (filled pointing up: above; open pointing down: below).
  Shots and exports of the map are drawn the same way. Four chart presets: paper, blueprint, sectors (hexes),
  night.
- **Tested.** sky-look: seen straight down, a star's height neither moves it nor makes it larger, +x right and +y
  up at the same scale, the camera's longitude and latitude unused; turned a quarter of the way by a drag a
  quarter of the way round; moved with the pointer. workflows: the Chart button; the Sun in the middle, Alpha
  Centauri right and down as far each way; moved by a drag, turned by a right-drag.

### D130. How the stars look, every part of it

- **Asked.** To edit how the stars of star maps look, "a very good system of how the stars could look to us",
  to be extremely creative with.
- **What.** A look kept with each star map (`SkyLook`, `sky-look.ts`, made whole and kept within bounds when
  read): the stars' colours (natural, vivid, pastel, one colour, by temperature between two colours of one's
  own, by their holders' colours with the others greyed; any of them tinted), shape (disc, soft blur, dot,
  diamond, four- or six-pointed sparkle, ring, square, cross), size and how much larger the brighter ones are,
  glow (reach and strength), diffraction spikes (none, 2, 4, 6 or 8, their length and angle), a halo, an
  outline as on printed charts, twinkling in shots (each star at its own pace); the sky's colour, a glow toward
  the middle, nebulae (soft clouds of two colours of one's own, turning with the view), the far stars beyond
  the map; the lines' colour and strength, the names' colour and lettering, lines down to the plane; the chart
  (D131) and the realms (D132). Fifteen presets, each shown in the dialog as a small picture drawn by the
  renderer itself from a patch of sample sky with two realms at war: natural, telescope, deep field, sci-fi
  display, neon, pastel, ember, imperial, heat, by realm, minimal, and the four charts; and "Surprise me": a
  look made up by chance (`randomLook`), again for another. The dialog sits at the side, the map in view and
  usable behind it, every change shown as it is made and undone in one step. Planets and a galaxy's places keep
  their own colours except where the colouring replaces them (one colour, by holder).
- **Tested.** sky-look: a look made whole and kept within bounds, every preset a whole look of its own; looks
  by chance within bounds and all different; colours natural, one colour, by temperature (coolest to hottest),
  by holder, tinted, vivid and pastel; kept with the map and undone in one step. workflows: the presets'
  pictures; a preset chosen (one undo step, drawn differently); shape and spikes changed; a look by chance,
  undone; twinkling to the full: two frames of a still shot differ, the same frame twice the same; an SVG frame
  with its lines.

### D129. A date that stays still as it changes

- **Asked.** While history played in the working view, the date shown jittered: its figures have widths of
  their own (a 1 is narrower than a 0) and month names too ("May", "September"), so the year moved sideways
  with every day, and a time of day appeared and ticked.
- **What.** The date viewed is shown in cells (`SteadyDate`): the day set right in two figures' room, the month
  centred in the room of "September", the year set right in the room of the widest year of the timeline, every
  figure as wide as the others; while history plays, no time of day. Clicked, it is the field to type in as
  before. A shot's date overlay is laid out the same way (`steadyLayout`: every figure in a cell of the widest
  figure, a day in two figures' room, a month's name centred in the room of the widest), so in exported videos
  the day and the year keep their places and the box its size.
- **Tested.** sequence: "1 May 1833" and "28 September 1866" laid out steady have the same width, the year at the
  same place, the day ending at the same place; other text as it is. workflows: the day's and the year's digits
  in the same places for those two dates in the working view; no time of day while playing.

### D128. In a shot animating every change, a change is over before its land changes hands again (improvement pass)

- **Found.** A shot that animates every change (as "+ Whole history" does) gives each one the same time on screen
  (1.5 s by default). Imported maps a few years apart, played at several years a second, then put the next change
  of the same land on screen while the one before was still under way (1914 and 1920 at eight years a second are
  0.75 s apart): the next started from where the first was going, so all the first had not reached yet jumped to
  its end in one frame (94% of it in the new test).
- **What.** Such a change ends when its land next changes hands (`Engine.nextHandover`: the earliest later
  assignment of any of its parcels, or of those they were split from, giving them another owner), so the next
  starts from all of it: the first runs faster, nothing jumps. Changes far enough apart keep their full time.
- **Tested.** render-compare: land given away in 2030 and again in 2031, at ten years a second with 1.5 s each:
  just before the second, the first has come 96% of the way (6% before, and the rest jumped).
- **Not done.** Changes recorded with animations of their own that overlap on the same land (two events animating
  the same parcels at once) still show the earlier at its end once the later starts (known limitation 5).

### D127. A globe that turns, for shots (improvement pass)

- **What.** "Globe (the planet as a ball, turning)" among a shot's projections: the planet seen from afar
  (orthographic), lit from the upper left, with a rim and a glow of air round its edge and dark space behind it in
  pictures with a background (nothing behind it in transparent ones). Dragging the preview turns it (east and west
  by the longitude the move spans at the middle's latitude; it can look straight down on a pole); the wheel zooms
  in until it is a close view of a region on a curved planet. "Turn the globe" sets it turning through the shot on
  its own, as the Earth turns (degrees a second; negative the other way): a shot's camera is otherwise still, so a
  turning globe could not be made. Every pass, export format and video works as for flat maps.
- **How.** The renderer draws the part of the planet in view flat, as for any other view (an equirectangular
  picture around its middle, with a renderer of its own), as many pixels to a radian as the globe has at its
  middle (within the graphics card's limit and 40 million pixels); with a pole in view the picture goes all the way
  round. The graphics card then lays it onto the sphere (`globe-gl.ts`): for each pixel of the frame the shader
  finds the place it shows and reads the picture there, with mipmaps and anisotropic filtering so land sloping away
  towards the edge stays clean. So territories, animations, borders, terrain, conditions, routes and characters are
  drawn by the same code as on flat maps. Country and city names are placed on the flat picture and drawn upright
  over the sphere where their places are (placed again there so that none overlap; towards the edge they fade
  out, and on land seen edge-on they are left out, so a turning globe brings them in and takes them away gently):
  painted on the picture, those near the poles would be squeezed.
- **Speed.** The flat picture's middle is on a grid of 2 degrees and its pixels to a radian on steps of an eighth
  of a doubling, so the same picture serves while the globe turns a little; while the preview is being dragged,
  the last picture serves for as long as it holds all in view (only the sphere is drawn again, about 60 ms a frame
  here in software, much less on a graphics card), and the view is drawn afresh at rest. A first picture of
  today's 242 countries at 1100 x 640: about 0.4 s here. Between two changes, with nothing on the map moving (no
  change animating, no character on its way, no areas, lines or points, no conditions, no video fills), a playing
  shot reuses the globe frame drawn last, names included, and does not send the picture to the graphics card
  again: playing a globe shot through 26 years of history took 161 ms a frame here (median), and now 2 ms
  (frames during an animation still take about 200 ms in software). The graphics card's picture is shared by
  every renderer: one is sent again whenever another's is there.
- **Without a usable graphics card.** The desktop app lets Chromium draw WebGL in software where the graphics card
  cannot be used (no driver, a blocked one, a machine without one: the switch `enable-unsafe-swiftshader`, safe here
  as the window shows only Map Maker's own pages), so the globe, the terrain and conditions are drawn there too,
  more slowly, instead of not at all. (Found by the desktop test, run without a graphics card: the globe stood in
  as the flat map.)
- **Not done.** The working view stays flat (the drawing tools work in a flat map's terms). An SVG frame of a globe
  holds the globe as pictures (the texts over the frame stay editable): it cannot keep flat shapes.
- **Tested.** camera: screen and map positions round-trip at every zoom, and zooming keeps the point under the
  cursor fixed (as for every projection). render-compare: places where the flat map has them, lit, within 1.3
  levels of colour; nothing beyond
  the edge in a picture without a background; only near-side names, none off the globe; a place on the far side
  has no place on the frame; the pole drawn; across 180° no seam; the flat picture kept while turning and drawn
  afresh at rest; months later between the same two changes the frame drawn last serves again and is the frame
  drawn afresh (within the few levels kept pictures allow). sequence: a turning globe's middle moves west at the speed set (across 180° too), a view framed
  at a frame is kept as it was before the turn, flat maps never turn. workflows: chosen in the shot editor, dragged
  to turn, set turning at 30 degrees a second, exported as frames (the globe in the middle, space round it) and as
  an SVG frame. desktop: the app itself draws a globe frame on the graphics card (in software where there is none).

### D126. Borders while fronts move; two changes meeting (improvement pass)

- **Found.** An advancing front from a border (the default "Advancing front", and fronts from several starting
  points, D91) reaches an area made of many overlapping pieces (a strip along each piece of the border it starts
  from, a circle at each corner), filled with the nonzero rule. The borders were clipped to it with the even-odd
  rule, which leaves holes wherever an even number of pieces overlap, and the moving border was drawn by stroking
  the area's path, which outlines every piece: a mesh of straight lines and arcs across the land being taken (10,779
  pixels of lines inside it, half way across a 200 km wide change in the new test), the old border showing in
  patches behind the front, and the old owner's colour left as a hairline along the old border. The reference
  renderer the pictures are compared with (e2e/reference) had the same rules, so the comparison could not see it.
- **What.** Borders that show after a change are clipped to the reached area by its own rule. Borders that show
  before it are drawn apart (in a buffer of their own the size of the change's box, not one of the frame's scratch
  buffers, whose turns the frame relies on), the reached area is taken out of them, and the rest is laid on. The moving border is the area's edge, drawn as a band: the
  area reached half a line-width later less that reached half a line-width earlier (from a border), or each
  circle's outline less every circle's inside (from several points); the highlight of the front the same way. The
  land a front has reached is painted together with the new owner's own parcels beside it, as one shape, so the
  edge between them leaves no seam.
- **Two changes meeting** (known limitation 4). Where parcels of two changes animating at once touch, each side
  shows the owner before or after its own change as far as its own front has come: the border between them is
  worked out for each of the four combinations (neither front there, either, both) and drawn where it holds (a
  fade counts as everywhere at once, weighted by its progress). A country split between two neighbours advancing
  from both sides shows no line where they will meet until a front gets there.
- **Tested.** render-compare: a front from a zigzag border half way across: every line inside the reached land at
  one distance from the zigzag (the front itself, 121.7 to 122.2 px from it), none of the old border behind it, no
  seam (0 levels off the new owner's colour; 100 before); two changes meeting: no border where they meet before
  either front is there (100% inked before), the border there once both have passed. The reference renderer has
  the same rules, so the 35 scenes still compare the pictures.

### D125. Shots playing: names placed quickly; where the time goes (improvement pass)

- **What.** While a shot plays in the preview (or its frames are dragged), country names are placed the quick way,
  as they already were while the date was dragged in the working view (D58): a coarser search for the place, kept
  where the fine one is already known. When it stops, the frame is drawn again with names placed finely; exports
  always place them finely. A shot's frame moved live (`store.setLive`, as playing and the frame slider do) counts
  as the moment being dragged.
- **Measured** (`bench/render.bench.ts`, Chrome in software, the benchmark projects rebuilt): playing the heavy
  project's still shot four frames a step, 86 ms a frame before and 82 after, the slowest tenth 162 and 125 ms;
  Earth 242 unchanged (10 ms). Names were not most of it. A profile puts a quarter of the time in laying whole
  pictures on each other (each territory layer is painted in a buffer, trimmed to the land, laid on at its
  opacity; the coast's band and the borders the same) and a third in the browser's own drawing: the next thing
  to make faster, for frames that cross many changes at once (the heavy project changes fifty times a second of
  that shot). Exports of the same frames: 1080p about 140 ms as PNG, 75 ms as MP4 (H.264) and 80–90 ms as WebM; 4K
  MP4 160–190 ms (the software encoders' speed varies from run to run here). The table: DEVELOPMENT.md, Performance.

### D124. Each layer on its own, as export passes (improvement pass)

- **What.** Besides the passes by kind (fills, borders, labels…), a shot's Export section offers each layer it
  shows on its own: a territory layer's fills and borders, a layer of areas, lines and points, a layer of
  conditions, each as an image sequence of its own, stacked after the land in the layers' order (bottom first).
  For compositing one layer apart: an occupation faded in its own time over the political map, a layer recoloured.
  The manifest and the compositing guide list them as they list the others; the size estimate counts them.
- **How.** A layer's pass is drawn as the passes by kind are, with the frame's layers being that layer only.
  Requirements row "Exporting layers independently" (it said: hide the others).
- **Tests.** `sequence.test.ts` (a pass per layer shown, in order after the land, kinds after them; kept as chosen;
  only that layer drawn; hidden layers left out, a shot's own choice of layers followed); `e2e/workflows` 'Each
  layer on its own' (every territory layer's pass painted exactly where its layer holds land at the date, clear
  elsewhere; one pass per layer in the manifest, bottom first).

### D123. Importing a dataset that dates each of its shapes (improvement pass)

- **What.** Some border datasets are one file with dates on every shape instead of one map a year: CShapes (the
  world's countries from 1886, each shape with its first and last day), and GIS layers with "from" and "to"
  columns. "Import borders from files" finds such properties (from, start, begin, GWSDATE, valid_from… and to,
  end, until, GWEDATE, valid_to…, with dates for most shapes; ends may be empty: still there) and then imports the
  file as the history it holds: "Each shape has its own dates", with the two properties changeable.
- **Dates.** Years (negative ones BC), "1886-01-01", "1886/1/1", "1.1.1886", "1886-05", "44 BC"; empty, "present"
  and 9999 are open. A shape's last date is included: it ends the day, month or year after (CShapes' Austria-Hungary
  to 11 November 1918, Austria from the 12th).
- **How.** At every moment where shapes begin or end, in order: the beginning shapes' outlines are put in then
  (following borders already there, D120), their land given to their countries (by name, created if new); the land
  of the ending shapes that no shape of the time covers becomes nobody's. A shape's land is kept as the parcels it
  had when put in, followed through later splits, so no outline is put in twice. The earliest shapes can be the
  starting map. One command, one undo step; the timeline widens to the dates.
- **Tests.** `geojson-import.test.ts` (dates in every form, BC, open ends, the day after an end, the properties
  guessed, shapes with unreadable dates left out; a country splitting in 1918 and another there from 1950 to the end
  of 1990, the earliest as the starting map, one undo step); `e2e/workflows` 'Importing a dataset that dates each
  shape' (the properties found by the dialog, the history at once, undone in one step).

### D122. A shot of the whole history in one click (improvement pass)

- **What.** "+ Whole history" beside "+ Shot" makes a timelapse of everything that happens on the map: from the first
  change to the last (a little either side: 2% of the span, at least a month), at an even pace (a second of screen
  time for every eight years, between 10 seconds and 2 minutes), the date shown to the year (to the month for spans
  under 30 years, to the day under 2), every change animated (the shot's "Animate every change"), framed as the
  working view is. Imported maps (D120) carry no animations of their own: this makes them play as moving history.
  Everything can then be changed as in any shot.
- **Tests.** `e2e/workflows` 'Importing borders' (the shot's dates against the first and last change, linear
  pacing, every change animated, years, its length).

### D121. Videos: MP4 (H.264) and WebM (VP9) files from a shot (improvement pass)

- **What.** Two more file formats for a shot's export: "Video, MP4 (H.264)" and "Video, WebM (VP9)". One file of the
  whole picture ("All"), opaque and without sound, in a folder of its own with `manifest.json` and a `README.txt` (the
  data credits as for image sequences). Quality: Best (a quarter of a bit a pixel, for editing), Good (a tenth, for
  sharing) or Small; the bit rate is shown with the codec once the computer has said it can encode it. Image sequences
  stay the way to export layers to composite.
- **How.** Frames are drawn exactly as for image sequences and handed to the browser's own encoder (WebCodecs, which
  Chromium and so the app have, using the graphics card's encoder where there is one), at the H.264 or VP9 level the
  size, frame rate and bit rate need, with a frame to start from every two seconds. The encoded frames are put into
  the file by writers of our own (`export/mp4-mux.ts`, `export/webm-mux.ts`; nothing installed) and sent to the data
  service as they come, a few megabytes at a time, which writes them into the file at their places; at the end only
  the sizes and tables are written. Drawing waits while the encoder has more than three frames in hand, and while
  more than 64 MB are on their way to the disk, so a long 4K export holds little memory.
- **Exact timing.** MP4 times frames in the rate's own units: 23.976, 29.97 and 59.94 fps as 1001/24000, 1001/30000
  and 1001/60000 of a second, so editors read the rate exactly. WebM in milliseconds, its frames' length written
  exactly. The colours the encoder coded (sRGB pictures as BT.709, full range) are written into the file.
- **Refused before starting.** A size H.264 does not reach (beyond 8K), or one this computer's encoder declines, is
  said in the export settings, with the way out (the other format, a smaller size or image sequences); the Export
  button waits for the answer.
- **Not done.** Transparency in videos (no encoder here has it; image sequences carry it), sound, ProRes.
- **Tests.** `video-mux.test.ts` (frame rates and levels; MP4 frames where its tables say, the frames to start from,
  the exact rate, the decoder configuration and colours, 64-bit places past 4 GB; WebM elements read back: the header
  and its seek head, clusters from each frame to start from, cues to them, sizes and duration written at the end; real
  H.264 and VP9 streams from FFmpeg written by the writers and read back by FFmpeg frame for frame, the same pictures,
  where FFmpeg is installed); `e2e/workflows` 'Videos' (a shot as MP4 and WebM from the shot editor: played by the
  browser at its size and length, frames at its start, middle and end within 4 levels on average of the PNG frames;
  read by FFmpeg where installed: 24 frames at 24/1; 16384 x 16384 refused for H.264 with the Export button off);
  `e2e/desktop` (the app itself encodes both and plays them back).

### D120. Importing borders from files at their dates (improvement pass)

- **What.** "Import borders from files…" (under Countries and factions, on any round or flat map): GeoJSON maps of
  borders (a FeatureCollection of polygons and multipolygons in longitude and latitude), one for each date, given to the
  map's political layer. Historical border datasets come as one map per year ("world_1492.geojson",
  "world_bc1000.geojson"), and maps drawn in a GIS export so; the user brings the files (none are bundled: the open
  historical datasets carry licences, such as GPL or non-commercial ones, that are the user's to accept).
- **Dates.** Read from each file's name (a year, "bc1000" or "500 BC" in astronomical years), changeable in the dialog;
  a file without one takes the date viewed. The first map can be the starting map (the countries exist from the
  beginning).
- **Countries.** The property holding names is guessed (NAME, name, ADMIN… or the one with most different words) and
  can be chosen, as can one holding colours (#rrggbb). Shapes of the same name are one country; a country goes on from
  one map to the next by its name (and joins one of the same name already in the project), so its land changes
  between them instead of a new country appearing each time. Land a map does not show becomes nobody's at its date
  (it can be turned off), so that a series of maps plays as the history between them, with transitions in shots as
  for any change.
- **Steps.** Each file is one command (`commands.ts` importTerritories, one undo step): its outlines go into the parcel
  map as "add today's countries" puts them, every country is given its land from the date as one change, and land
  held then but not on the map is cleared in the same change. The timeline widens to show the maps' dates.
- **The same border drawn again.** Two maps rarely draw a border along the same line: datasets digitised apart put
  it a few kilometres away. Measured with today's 242 countries and a second map whose borders lie up to 3 km from
  them (`bench/import.bench.ts`), the second map multiplied the parcels by ten (1,623 to 16,240, 13 s) with slivers
  between each border and its twin, and a third was refused (its borders could not be joined without crossing). Now
  a border within a distance of one already on the map (5 km unless changed in the dialog; 0 keeps every line) is
  taken as that border: each of its points within the distance goes onto the border (its nearest vertex, or away
  from vertices the nearest point of a segment: long straight borders have few vertices), and between two such
  points it follows the border's vertices (`Arrangement.followBorders`, the shortest run of borders no longer than
  twice their distance). A small island (hardly larger than the distance) is taken whole: the island already there
  that most of its points are near, its coast walked round the same way; point by point, its points could fall out
  of order and turn it inside out (three world maps put through the dialog: one of Kiribati's atolls became the
  rest of the world). Any outline that following would turn round, or shrink or swell more than twofold, is kept
  as drawn. The benchmark's maps now add 6, 4 and 4 parcels in under a second each; none is refused. Maps
  differing more (up to 3.5 km, empires joined) add 279 and 217 parcels in about 2 s each, where 3 km would add
  2,578 and 2,498: so 5 km is the default. A shape that still cannot be joined to the borders around it is found
  by halves (the rest of the file goes in), tried as drawn, and otherwise left out and named, instead of the whole
  file failing. Each outline's parcels are read as soon as it is in and followed through later splits (a last pass
  putting every outline in again, to read them, could itself fail on such maps: the second of those three stopped
  the dialog).
- **Tests.** `geojson-import.test.ts` (polygons, multipolygons and holes read, the closing point dropped; the name
  property guessed; colours; shapes without an area left out; files that are not GeoJSON refused; years from file
  names, BC included; three maps of three dates making the history between them: countries going on by name without
  regard to case, land changing hands, a country dropping out leaving nobody's land, a new one appearing, one undo
  step each; ten of today's countries drawn again up to 2 km apart with two joined: under 15% more parcels, against
  over three times as many without following, the capitals' holders right, Liechtenstein kept, the atolls of
  Kiribati, the Marshall Islands and Tuvalu neither inside out nor lost; a shape too small to be an area left out and
  named); `e2e/workflows` 'Importing borders' (two files chosen in the dialog, sorted by the years in their names,
  the first the starting map, names from NAME; who holds what before and after the second date; one country going on;
  undone a file at a time).

### D119. Playing history in the world-building view (improvement pass)

- **What.** "⏵ Play" at the left of the timeline (or Space, when not typing) plays history from the date viewed: the
  date moves on at the speed chosen, from a month to a thousand years a second, as fast as the map draws, and the map,
  the timeline's playhead and every panel follow. Dragging the playhead meanwhile carries on from there. At the end of
  the timeline it stops, or with ⟳ starts again from its beginning; Pause (or Space) stops where it is. Leaving
  world-building stops it; in presentation, Space plays and pauses the shot.
- **How.** Each frame the date is moved on by the time since the frame before (at most a quarter of a second, so a
  pause of the window does not jump), kept as a fraction of a year and shown as whole days (unless slower than a month
  a second). The view takes it as it takes dragging along the timeline (the live updates of D58), then settles to a
  full drawing when it stops.
- **Tests.** `e2e/workflows` 'Playing history' (at 100 years a second the date moves on; paused it stays; Space plays
  and pauses; going round from the end to the beginning; leaving world-building stops it).

### D118. Planets of other stars (Stage 11)

- **Which.** The confirmed planets of the stars on the nearby star map, from the Open Exoplanet Catalogue (Hanno Rein
  and contributors, MIT licence; its notice is kept beside the data): 163 planets of 92 stars, made by
  `scripts/fetch-exoplanets.mjs` into `data/stars/exoplanets-50ly.json`. Each planet goes to the star the catalogue
  names as its host (Gliese, GJ and Gl numbers alike), seen within 3° of the planet's system; failing a name, to the
  star seen within 0.3° at a distance within 8% of its own (the star catalogue's distances of faint stars can be some
  light-years out, and some stars go by other names: Gamma Cephei's planet goes to Errai). Hosts too faint for the star
  catalogues (TRAPPIST-1, LHS 3844, L 98-59 and fifteen more) and two just beyond 50 light-years there (51 Pegasi,
  Mu Arae) are left out; the script lists them.
- **Shown.** A star with known planets has a faint dotted ring on the map, and the note under the map says how many
  stars have them. Its panel lists them, nearest first: how long each takes to go round, how far out, its size (from
  its radius, or its mass, "at least" where only its star's wobble shows it) and the year it was found. The search
  box finds planets by name ("proxima b"): choosing one chooses its star. Exports and SVG frames of the star map
  draw the rings and credit the catalogue.
- **Tests.** `exoplanets.test.ts` (every planet on a star of the map, none on the Sun, each once; the licence beside
  the data; Proxima b's year, mass and period; Tau Ceti's, 55 Cancri's and Gamma Cephei's planets on their stars;
  nearest first); `e2e/workflows` 'A star map' (the note counts stars with planets; "proxima b" found by search, its
  star chosen and its planets listed).

### D117. The large moons on the solar system map (Stage 11)

- **Which.** Fourteen: the Moon; Phobos and Deimos; Io, Europa, Ganymede and Callisto; Enceladus, Rhea and Titan;
  Titania and Oberon; Triton; Charon. Each goes round its planet at its true period (Triton the other way round).
- **Where.** At true scale a moon sits on its planet, so moons are drawn round it far wider than they are, each a step
  further out than the one inside it, on the plane of the planets' orbits, with a faint ring for its orbit. They show
  once the view sets them apart from their planet (closing in on Jupiter shows its four); until then they and their
  rings are left out, and a click on a planet is the planet's. The Moon's place is its mean longitude for the date,
  and Jupiter's four large moons' their mean longitudes (Meeus, Astronomical Algorithms, chapter 44, lower accuracy):
  each where it is, roughly. The others' places along their orbits are not their true ones, and their panels say so.
- **Like the planets.** Moons are found by the search box, have a panel (whose moon, how long it takes to go round),
  and are given to countries and factions with the Star systems tool and joined by lanes, as planets are (the
  Expanse's Ganymede or Titan, say). Their numbers (31, 41, 42, 51–54, 61–63, 71, 72, 81, 91) never change.
- **Tests.** `solar.test.ts` (each moon round its planet, back where it was after its period, Io to Callisto outward,
  the Moon at its mean longitude at J2000, Io's period).

### D116. Galaxy maps: the Milky Way, and galaxies of one's own (Stage 11)

- **The Milky Way.** "+ Map", "The Milky Way": the whole galaxy seen from outside, turned and zoomed as star maps are.
  Its arms are logarithmic spirals with the reference radii, angles and pitches of Reid et al. 2014 (radio
  astronomy of star-forming regions), scaled to the Sun's distance from the middle (26,670 light-years, GRAVITY 2019)
  and carried on round the far side, where they are less well known: Scutum–Centaurus, Perseus, Sagittarius–Carina,
  Norma–Outer and the Orion–Cygnus arm the Sun is in; a bar 27° from the line to the Sun and a bulge. 33 places are
  where they are seen from the Sun (galactic longitude, latitude and rounded distances from the literature): the Sun,
  the black hole at the middle, nebulae (Orion, Eagle, Carina, Crab…), clusters, remnants of supernovae, notable stars,
  and the Sagittarius dwarf galaxy and the Magellanic Clouds outside the disc.
- **Star systems to hold.** Along the arms and in the disc, so many star systems of the map's own (600 by default, up
  to 5,000), from a seed, with names of their own, shown by name only close in (or when held or chosen). Countries and
  factions hold them with the Star systems tool and a box (D111), lanes join them (D112), realms glow round them as far
  as about half way to their neighbours. "Other star systems" makes them again from the next seed; their numbers stay,
  so what is held stays held.
- **A galaxy of one's own.** "+ Map", "A galaxy of your own": a spiral from a seed with so many arms (1 to 8), wound so
  tightly, so large, with or without a bar; its arms named from syllables, a home system half way out on the first arm.
  "Another galaxy" makes it again from the next seed.
- **Drawing.** The glow is 18,000 faint points sampled as the galaxy's stars lie (bar and bulge, arms, disc, the pink
  of star-forming clouds), each a soft square as large as the part it stands for, added up on a layer of its own and
  kept while the view stays put; the arms' names lie on the arms. Shots, exports (the glow in the background layer,
  realms, lanes and names in theirs) and SVG frames (the glow a picture) work as for star maps.
- **Tests.** `galaxy.test.ts` (the Sun 26,670 light-years out and in the Orion–Cygnus arm, the black hole at the middle,
  places where they are seen from the Sun, the Magellanic Clouds outside; the arms trailing spirals of their pitch;
  systems numbered from 1000, named, out of the middle, the same for the same seed; the glow; a galaxy of one's own and
  its scene; the maps made, made again and undone, systems held, wrong settings refused); `e2e/workflows` 'The Milky
  Way' (made from "+ Map": its middle bright and the sky dark; the Orion Nebula found by search, its kind and distance;
  systems held in a box; a frame with the galaxy and the realm; a galaxy of one's own made again from the next seed;
  undone).

### D115. SVG frames (Stage 10)

- **What it is.** In a shot's Export section, "Save frame N as SVG" writes the frame shown in the preview as an SVG
  file into the export folder ("<shot>_frame000004.svg", never over another), for print and drawing programs
  (Illustrator, Inkscape, Affinity). Countries, borders, areas, lines and points (campaign arrows, lines with teeth,
  symbols), cities, names, characters, text boxes and the date are shapes and text, each country a named shape and
  each name a piece of text, in groups (layers) stacked as the export passes are: "Sea, terrain, grid and land
  (picture)", "Territories: <layer>", "Borders: <layer>", "Conditions (picture)", "Areas, lines and points",
  "Cities", "Labels", "Characters", "Edges and paper", "Texts". The sea, terrain, grid, land and conditions stay
  pictures, exactly as the renderer draws them for the image sequences. Star maps too: stars, lanes and names as
  shapes and text, their realms a picture (they are joined offscreen).
- **How, without a second renderer** (what D109 feared). An SVG pen (`svg-pen.ts`) is drawn on as a 2D canvas is and
  writes SVG: paths through the transform of their moment, fills, strokes with their widths, joins and dashes,
  gradients and patterns, clipping, text placed exactly where the canvas puts it (the browser's own baseline), and
  pictures drawn on it kept as pictures. While it is drawn on, Path2D stands for its own paths, so the map's own drawing
  of features, cities, names, characters, stars and texts runs unchanged into it: the SVG shows what the frame shows.
  Only territories and borders, which the renderer draws through kept pictures and masks, are made here, from the
  parcels' outlines projected as the frame's view projects (d3): each owner one shape, each border between owners
  once, borders against nobody apart. They end at the coast through masks of the land the renderer makes for the
  frame (lakes cut out of fills; along a coast in view, land no parcel covers takes the territory's colour and borders
  against nobody give way to the coastline, as in D83); pictures and flags fill countries piece by piece as frames
  place them (D82); hatching is a pattern. A look's grade is an SVG filter over the map (its CSS filter by the
  standard's equivalents), its darker edges a gradient and its paper a picture, over the map and under the texts.
- **What differs.** A frame in the middle of an animated change shows the map as it is at that moment without the
  animation (no advancing front, no fading borders). Front lines along wars (D89) are drawn in the borders' layers,
  their teeth by the renderer's own code, a named shape each. Drawn by a browser, a frame's SVG differs from its PNG in fewer than one pixel in a
  hundred (anti-aliasing of text and coasts), checked by the tests.
- **Tests.** `svg-pen.test.ts` (numbers, text and colours written for SVG; arcs on their circle and swept as the canvas
  sweeps them; shapes through the transform of their moment with their styles; Path2D standing for the pen's paths,
  clipping, erasing left out; text placed, aligned and styled with its halo; gradients and patterns as definitions);
  `svg-frame.test.ts` (the grades as SVG filters; border lines once from one side, against nobody apart; an owner
  with an enclave one polygon with a hole; a front line all along the border with the enemy; the file numbered by its frame, never over another, refused when it is not
  SVG); `e2e/workflows` 'SVG frames' (a frame of a turned view with a text box saved from the button: its layers in
  order, countries as named shapes, names and the text box as text, and drawn by the browser within 2% of the PNG of
  the same frame; undone).

### D114. Invented star maps, and finding stars (Stage 11)

- **Stars of one's own.** "+ Map", "Stars of your own": a star map of a setting that is not our neighbourhood, made
  from a seed: so many stars (2 to 3,000) within so many light-years of a home star, in a sphere or a flat disc. The
  kinds of star come in about the shares they have around the Sun (seven in ten red dwarfs, then orange dwarfs,
  Sun-like stars, a few white dwarfs and giants), each with a brightness of its kind; names are made from syllables,
  every one its own, the faintest given catalogue numbers ("KX-1043"). The same seed always gives the same stars, so
  nothing but the settings is stored. "Other stars" on the map makes them again from the next seed (one undo step);
  stars keep their numbers, so held stars and lanes stay with the same numbers. Everything of a star map works on it:
  realms, lanes, the panel, shots and exports.
- **Finding stars.** On a map of space, the search box (Ctrl+F) finds its stars or planets too, by name or other name
  ("tau ceti", "epsilon eridani"), after what the project holds: choosing one chooses it and turns the view round it.
- **Tests.** `invented.test.ts` (the same seed the same stars, another seed others; their number, reach and order; a
  disc flat; mostly red dwarfs; names their own; made once for the same settings; the map made, made again and
  undone, refused when wrong); `e2e/workflows` 'An invented star map' (150 stars from seed 5, one found by search and
  chosen, other stars from seed 6; undone).

### D113. The solar system, where the planets are on any date (Stage 11)

- **A map of the solar system** ("+ Map", "The solar system"): the Sun, the eight planets and Pluto on their orbits,
  each where it is on the date viewed, worked out from the Keplerian elements and their rates of JPL's "Approximate
  Positions of the Planets" (E. M. Standish, table 1, the mean ecliptic and equinox of J2000; fitted to 1800-2050,
  the orbits keep their shape outside it and their phases drift slowly). Checked against the great opposition of
  Mars: on 28 August 2003 the Earth and Mars are in line with the Sun and 0.373 au apart (0.3727 au in fact).
  Scrubbing the date moves the planets; a shot across years shows them going round.
- **Seen as the stars are** (the same camera, rings and names), on the ecliptic: rings at 1, 5, 10, 20, 30, 40 and
  50 au, each orbit drawn in its planet's colour, the planets in their colours and sizes. Distances are compressed
  by default (the square root of the distance, the outer orbits where they are) so that the inner planets have room;
  one click shows them true to scale (one undo step, kept with the map).
- **Held and joined like stars**: the Star systems tool gives planets to countries and factions over time (their
  realms move with them), the Lanes tool joins them (a lane between moving planets follows them), as on a star map
  (D111, D112). A planet's panel gives its distance from the Sun on the date viewed and how long it takes to go round.
- **Not yet**: asteroids and comets (the large moons since: D117).
- **Tests.** `solar.test.ts` (the 2003 opposition; the Earth nearest the Sun in January; every planet within its
  orbit's reach from 1800 to 2300; a year once round, Jupiter about 30° a year; Pluto above the plane; orbits closed
  and through their planets; compressed and true distances; the catalogue drawn; the map made, its scale chosen and
  undone; planets held); `e2e/workflows` 'The solar system' (made from "+ Map": the Sun in the middle, the planets
  named, the Earth across the Sun half a year on and Neptune hardly moved, Mars nearer the Sun true to scale, Mars's
  panel at its distance; undone).

### D112. Lanes between stars: routes, expeditions and fleets (Stage 11)

- **A lane** joins two stars of a star map from a date on: a route, a jump lane, a trade or supply line. The Lanes
  tool makes one with two clicks (a star, then another), from the date viewed or in the event being recorded,
  belonging to the country or faction chosen (drawn in its colour) or to nobody (pale blue). A star's panel lists the
  lanes it has at the date viewed, and closes one from that date.
- **Expeditions and fleets.** A lane recorded into an event with a length grows from the first star to the second
  over the rest of the event, a pointed head at its front while it is on its way: a colony ship, an expedition, a
  fleet. Shots and exports show it growing frame by frame.
- **Stored as changes** of kind `lane` (the two stars, open or closed, its owner; `{"grow": true}` in the
  transition when it grows), compiled like held stars (`lanesAt`, `laneSteps`, `lanesOf`); the two stars in either
  order are the same lane; the same lane at the same moment in the same event is replaced; a deleted owner's lanes go
  with it.
- **Realms in shots.** A star newly held now grows into its holder's realm over 1.2 seconds of the shot, its glow
  widening from nothing, instead of appearing at once.
- **Tests.** `space.test.ts` (a lane from 2150, not before; an expedition growing over a ten-year event, half way at
  half time, from the star it set out from, whole after; closed in 2250 with the stars given the other way round;
  replaced at the same moment; refused for one star, another kind of map, an owner gone; the owner deleted and back;
  undone); `e2e/workflows` 'A star map' (a lane from the Sun to Alpha Centauri with the Lanes tool, listed in the
  star's panel).

### D111. Star systems held over time: realms in space (Stage 11)

- **Holding a star.** On a star map, a country or faction holds stars from dates: the Star systems tool gives the star
  system clicked, the star and its companions (or, with Ctrl, every system in a box dragged), to the country or
  faction chosen, from the date viewed, or in the event being recorded; "Nobody" gives them up. (A companion sits
  where its primary is, so a click means the system: Alpha Centauri A and B are given together.) Each is a change of kind `system` (the star and who holds it from
  then on), dated like every other change: no file change, one undo step for the click or the box, and giving a
  star again at the same moment in the same event replaces that change. A deleted country's or faction's holdings go
  with it.
- **Compiled like names and places.** The engine keeps each star's steps in time order (one per moment, the later in
  order winning) and answers who holds every star at a moment (`systemsAt`) and a star's history (`systemSteps`);
  changes in events follow their event (alternative versions and moves included).
- **Drawn as realms.** Every star held glows in its holder's colour, all of one holder's glows joined into one region
  (laid on lightly, with its edge), a ring round each star, and the holder's name (as it is at the moment shown) over
  its stars. A realm grows and shrinks as stars change hands; shots and exports show it as it is at each frame.
- **A star's panel** tells who holds it on the date viewed and lists every change, with "Go to" and a button to take
  one out.
- **Tests.** `space.test.ts` (three stars given from 2150, not held before; Proxima taken in an event of 2200, given
  up in 2250, the others kept; the same moment replaced; refused on another kind of map, for someone gone, without
  stars; the holder deleted and its holdings with it, undone; the gift undone); `e2e/workflows` 'A star map' (Alpha
  Centauri given to a new country from 2150 with the tool: its panel names the holder, its realm drawn in the
  country's colour, nobody in 2149; a box with Ctrl gives the stars round the Sun; undone).

### D110. Space maps: the stars within 50 light-years (Stage 11)

- **Data.** The HYG star database (v4.1, by David Nash, CC BY-SA 4.0; the converted file is under the same licence):
  every star of it within 50 light-years of the Sun, 982 with the Sun, `data/stars/nearby-50ly.json`
  (`scripts/fetch-stars.mjs`). Positions are turned from parsecs on equatorial axes into light-years on galactic
  axes (x toward the galactic centre, y the way the galaxy turns, z toward its north pole), so the galactic plane
  is the map's floor. Each star keeps its name (the proper name, else its Bayer letter or Flamsteed number with the
  constellation, else its Gliese, HD or Hipparcos number), a second name written out ("Epsilon Eridani", "61 Cygni"),
  its spectral type, absolute magnitude and the primary of its system (companions named as their primary take a
  letter: "61 Cyg B"). HYG is built on Hipparcos, Yale and Gliese; stars found since (some brown dwarfs) are not in it.
  Listed under Data sources and credited in exports of star maps.
- **A new kind of map.** "+ Map", "The stars around the Sun": a map of kind `space` (no file change: the kind is a
  text column). It keeps an empty parcel map like every map, so that what asks for one finds it.
- **Seeing it.** A camera circles a point (the Sun at first): dragging turns it around the galactic pole and tilts it
  over the plane, Shift-drag or the right button moves the point it circles, the wheel zooms, a double-click on a star
  (or "Turn the view around it" in its panel) circles that star, ⌂ goes back to the Sun. Gentle perspective: the
  stars of the near side are drawn up to half as large again as those of the far side. Rings on the galactic plane
  every 10 light-years with their distances, spokes, the way to the galactic centre; each star in its colour (blue O
  and B to orange-red M, white dwarfs bluish white), larger when brighter, with a line down to the plane (dashed
  below it); far stars behind, denser toward the Milky Way. Names: the Sun, named stars and the brightest first,
  more as the view closes in, none overlapping.
- **A star's panel.** A click chooses a star system (its primary star): its names, distance, kind in words and
  spectral type, brightness, its direction in galactic longitude and latitude, and the stars of its system, each of
  which can be chosen from there.
- **Shots and exports.** A shot of a star map is framed by dragging and zooming its preview like any shot (its camera
  still); texts, looks and the events box as on other maps. "All" exports everything; the background pass the sky,
  far stars and rings; the territory fills pass the realms (D111); the areas, lines and points pass the lanes (D112);
  the labels pass the star names; the other passes are empty on a star map. "Reset camera" gives the map's own
  starting view (all of it, from above at an angle); there is no projection to choose.
- **Tests.** `space.test.ts` (982 stars within 50 light-years, nearest first, the Sun in the middle, Proxima, Sirius
  and Vega at their distances, Barnard's Star toward the galactic centre, systems and companions, found by either
  name; kinds, colours and sizes; the camera: the point looked at in the middle, nearer stars larger, from above and
  from the side, zooming, turning and moving by dragging, nothing behind it; the map made, kept on reopening, undone);
  `e2e/workflows` 'A star map' (made from "+ Map": the Sun in the middle, names written, a click on Alpha Centauri
  shows its panel at 4.3 light-years, dragging turns the view around the Sun, zooming spreads the stars, a star
  centred, an exported frame of stars with the Sun bright in its middle; undone).

### D109. TIFF sequences (Stage 10)

- **A choice per shot.** Under Output quality, "File format": PNG (as before), TIFF uncompressed, or TIFF
  ZIP-compressed. TIFF files are 8 bits a sample, RGB with straight (unassociated) alpha, little-endian, in strips of
  about a quarter of a megabyte; ZIP is Deflate as Photoshop writes it. Uncompressed files are four bytes a pixel
  (read by everything, quick to play in an editor); ZIP is about as small as PNG.
- **Where they are made.** In the browser, from the very pixels the frame was drawn with (the same pixels give the same
  file), compressed with the browser's own Deflate while the next frame is drawn, then written by the data service,
  which checks the size in the file's directory. Frames that are the same picture as the one before are copied, as
  for PNG. The manifest and the compositing guide say which format and that the alpha is straight.
- **Size estimate.** Uncompressed TIFF is exact (four bytes a pixel); ZIP is estimated as a fifth more than PNG.
- **SVG** (also planned for this stage) was left for later here: the map is drawn with pictures kept between frames
  and masks at the coast, which have no direct SVG form. Done since without a second renderer: D115.
- **Tests.** `tiff.test.ts` (header, strips, straight alpha, read back the same uncompressed and ZIP, ZIP far smaller
  for a map, a one-strip picture, wrong sizes refused); `e2e/workflows` 'TIFF sequences' (a shot exported as ZIP TIFF:
  six .tif files at a quarter of 1920 x 1080, read back with transparent and painted pixels, the manifest and the
  guide say so; undone).

### D108. Looks for shots (Stage 10)

- **A look per shot.** A shot is drawn in a look chosen under Look in its settings: Classic (the working view's
  colours, as before), Parchment (pale sea, tan land, brown ink, sepia, stained paper and darkened edges), Atlas
  (light blue sea, pale land, grey borders), Night (near black, pale blue borders), Blueprint (white lines on deep
  blue), Minimal (quiet greys, white borders) and Wartime map (grey-blue sea, buff land, black borders, a little
  worn). Each sets the sea, land, lake and coast colours, the grid's, the borders' colour and width, a colour grade,
  how dark the frame's edges become and how strong the paper's grain is; any of these can be changed for the shot
  ("Back to the look's own colours" undoes the changes). Territories keep their own colours (under the grade).
- **Where it applies.** The preview and every export of the shot; the world-building view keeps its own colours.
  The grade (a colour filter: sepia, faded, vivid, cool, warm, black and white), the darker edges and the paper are
  laid over the map once it is drawn, in every exported layer, and never over the texts; what is transparent stays
  transparent, so the layers still stack into "All". The paper's grain is the same in every frame (a fixed seed),
  so still frames stay identical and are written once.
- **Classic as it was.** A shot without a look, or in Classic unchanged, is drawn exactly as before (the renderer is
  given no colours of its own).
- **Tests.** `looks.test.ts` (the preset chosen and its own changes, kept where they make sense; unknown looks are
  Classic; Classic unchanged is plain; colours for the renderer and the basemap; the paper the same every time,
  with light and dark specks and brown stains when asked); `e2e/workflows` 'Looks' (Atlas: the preview's sea light
  blue; darker edges darken the corner and not the middle; an exported frame the same; Parchment: a warm sea; the
  working view's sea unchanged; undone).

### D107. Text boxes and callouts in shots (Stage 10)

- **Text boxes.** A shot can have any number of text boxes of the user's own ("+ Text box" under Text in the shot's
  settings), besides the date and the title: several lines (wrapped by words at a chosen width), a font, size,
  weight and slant, a colour, a box behind them (colour, opacity, inner spacing, rounded corners) and a line around
  the letters for reading over the map. `{date}` writes the date shown. They are dragged on the preview like the
  date and the title, and exported with the texts ("Text overlays", and in "All").
- **When they show.** Either at times in the shot (from and to so many seconds; to the end when no end is given),
  or while history is between two dates (from a date on when no end is given): such a box stays with the events
  it is about whatever the shot's pace. They come in at once, fading in, rising, popping up or typed out letter by
  letter, and go at once, fading out or sinking, over a chosen number of seconds of the shot (counted in screen
  time also when timed by history, so a box tied to a date fades as quickly in a fast shot as in a slow one).
- **Callouts.** A text box can point at a place ("+ Callout", then a click on the preview; or "Point it at a
  place…" on any box): a line from the nearest point of its box to the place, with a dot there, in the text's
  colour or one of its own. The line grows from the box as the box comes in. The place is kept as a longitude and
  latitude, so it stays on the place in every frame and export size.
- **Kept with the shot.** Text boxes are overlays of the shot with a `box` of settings; older shots are unchanged,
  and the date and title work as before. Every change is one undoable step.
- **Tests.** `text-boxes.test.ts` (settings with defaults and broken values; timed by the shot: not yet, coming in,
  half way, shown, going, gone; timed by history: before, just come, in, leaving at its last date, gone, and fully
  in when its date is before the shot; the date written in; moved like the title; wrapping by words; where a
  pointer starts); `e2e/workflows` 'Text boxes and callouts' (a text written and timed in its settings, not shown
  at 0.25 s, shown at 1 s, gone at 1.7 s; a callout's place clicked on the preview, its dot there and a line from
  its box; the box dragged; undone).

### D106. Routes: campaign arrows and lines that flow (Stage 10)

- **No camera paths.** Stage 10 was to include camera moves; the user never moves the camera during a video (D34),
  so the stage is spent on what a still map shows instead: routes, texts, looks and export formats.
- **Campaign arrows.** A line can be drawn as a campaign arrow ("Drawn as: a campaign arrow" in its panel): a broad
  body along the line, `width` design pixels across where it meets its head and narrowing to about a third of that at
  its tail, and a head twice as wide at the line's end, filled in the line's colour with a darker edge. The line is
  smoothed first (corner cutting), so an arrow drawn with a few clicks curves. When the line draws itself in an event
  with a length (D79), the arrow grows along its path with its head at the front: the classic drive or offensive.
  Choosing the arrow sets a broad width (18) when the line was thin.
- **Flow.** Any line, or arrow, can have marks flowing along it in the way it was drawn: dashes, chevrons or dots, in
  a light tint of its colour (white down the middle of an arrow), at a speed in pixels a second of a 1920-wide frame.
  They move with the shot's clock (frame / frames a second), so they move in the preview and in exports, are the
  same in every export of a frame, and are still while world-building (where they show where they would be). For
  migrations, supply lines, trade and campaigns.
- **Kept in the style.** Both are part of the line's look (`look`, `flow`, `flowSpeed` in its style), not of
  history: no file change, every change one undoable step.
- **Tests.** `routes.test.ts` (smoothing keeps the ends; even resampling; an arrow's body, tail and head, round a
  bend, grown half way; marks carried along as the offset grows, between two distances, round a corner; the style
  kept; colours mixed); `e2e/workflows` 'Routes' (a line made a campaign arrow 40 wide with chevrons from its panel:
  several times as broad as the line, narrower at its tail; still while world-building; in a shot the chevrons
  move between frames and nothing else does; undone).

### D105. Heatmaps from points; thousands of strikes (Stage 9)

- **Heatmaps from a layer of points.** A Heatmap layer of conditions can be worked out from a layer of points (in
  the Conditions tool: "From the points of …"): every point in force at the moment shown counts as a soft spot so
  many km across (each over 200 km unless changed), worth 1, and the colours are full where so many overlap ("Full
  colour at … points"). As points appear, move and end over time (battles, sites, cities kept as points), the
  heatmap follows. Sources placed by hand on the same layer add to it. The settings are the layer's look (not
  dated), each change one undoable step; a layer that is not of points, or of another map, is refused.
- **Many sources at once.** A command adds any number of sources to a field layer in one step (for imported strikes
  or a scenario's sites).
- **Stress test** (`e2e/workflows`): three thousand strikes over Europe and Asia added in one step (about 2 s),
  then a 4K export frame of the conditions alone drawn in about half a second and the working view in about 30 ms,
  on the test machine's software graphics (SwiftShader); every strike in force, those in the frame's view drawn.
  Each source costs one rectangle in one instanced draw, so the cost grows with the pixels the sources cover, not
  with their number.
- **Tests.** `fields.test.ts` (a heatmap's layer of points set, refused when not points, set back; a hundred sources
  in one step, undone in one); `e2e/workflows` (a heatmap from the test's battles, warm where they were; the three
  thousand strikes at 4K and in the working view; undone).

### D104. Disasters from templates, in one click (Stage 9)

The **Disasters** tool places a whole disaster with one click, from a template and one size: a **nuclear strike**
(yield: blast destruction about 0.9 km × the cube root of the kilotons, a firestorm, radioactive fallout carried
downwind), an **earthquake** (magnitude: destruction lasting for years, 50 km around at magnitude 7, ten times as far
at 9), a **volcanic eruption** (explosivity: lava running downhill, an ash plume downwind, pyroclastic ruin around
the vent), a **flood** (how high the water rises, filling the low ground), a **wildfire** (how far it spreads, with
its smoke), a **meteor impact** (the meteor's size: a crater twenty times as wide left in the terrain for good, the
land around flattened and burnt, dust carried downwind) and a **drought** (land drying out over months, staying dry
for years: a new Drought kind of conditions). Plumes take the wind direction given.

- **As an event.** A disaster becomes an event named after it ("Nuclear strike (1 Mt)") from the date viewed, or goes
  into the event being recorded; it is chosen once placed. Its conditions go on the map's first field layer of each
  kind, made where there is none ("Destruction", "Fire", "Radiation", "Smoke and ash", "Flood", "Drought").
- **Temporary and permanent.** The conditions fade by themselves (D102, D103); an impact's crater is a dated change
  to the terrain (sculpting, D98) from the moment of impact on, and only where the map has terrain. Everything a
  disaster made, its event and new layers included, is one undoable step.
- **Rough rules.** The sizes are rules of thumb for a map, not physics (`domain/disasters.ts`); every condition can
  still be placed by hand with the Conditions tool, with its own strength, size, shape and life.
- **Tests.** `disasters.test.ts` (each template sized by its measure and held within its range; the command: an
  event from its moment, a layer for each kind, made once and reused, conditions in force from then, an impact's
  crater from then, all undone in one step; in the event being recorded; errors; a blank world gets conditions and
  no crater); `e2e/workflows` (a meteor impact placed with one click: its event, layers and crater, the blast shown
  the next day, one undo takes it all back).

### D103. Conditions that spread over the terrain: fire, lava, floods (Stage 9)

A source of conditions (D102) can now **spread over the terrain itself**, as a fire, lava or a flood, on any map
with terrain (Earth, generated planets; sculpting included). Fire and flood layers start with it. Each spread is
worked out once, on a grid of 160 × 160 cells around its source (its heights read from the world's terrain,
`domain/spread.ts`, pure and tested), and drawn at any moment from that grid, so it animates by itself:

- **A fire** spreads from its source over the land at its pace (its reach over the days it spreads, after which it
  is held), faster uphill and downwind, in tongues and lobes (its pace varies smoothly from place to place), never
  over water or bare high mountains. Each place burns from when the fire reaches it, with the source's life
  counted from then: the front is brightest, the ground behind it cools to embers. (The fire colours now run from
  dark embers to bright yellow where hottest.)
- **Lava** runs downhill from its source along the steepest ways (to the three lowest cells around each, so it
  flows in tongues), faster on steep ground, only a little way up to fill small hollows, and stops at the sea.
- **A flood** raises the water at its source by its strength (metres) as the source rises, and fills the low ground
  around: a place floods once the water stands above the lowest ridge between it and the source (its spill height,
  a priority flood), as deep as the water stands over it; the water recedes as the source fades. Towards the edge
  of its reach the ground counts as rising, so the water stops along the lie of the land. The sea is not drawn.
- **On the graphics card**: each spread's grid (arrival times, or spill height and ground) is a texture; a second
  pass of the field shader reads it, between the cells it reaches, with its edge fading out between cells, and
  adds the value of the moment to the layer's sums. Where a map has no terrain a spreading source is a circle.
- **Not done.** Spreads are worked out at about a 160th of their size (finer for small ones), from the bundled
  heights (not the finer close-up tiles, D101), on the interface's thread (a fraction of a second each, once).
- **Tests.** `spread.test.ts` (a fire's pace, around a lake, sooner downwind, held after its days, burning from when
  it arrives; lava down a valley and not up to the summit; a flood filling a valley, held back by a ridge until the
  water is higher, the sea not drawn, nothing before it rises, receding); `e2e/workflows` (a fire in the West
  Siberian Plain burning more ground on the 7th than on the 3rd, undone).

### D102. Conditions: field layers of radiation, fire, smoke, floods, destruction and heat (Stage 9)

A new kind of layer, **Conditions**, holds things that cover the map with a strength at every place and moment and
then pass: radiation, fire, smoke and ash, floodwater, destruction, a heatmap, or a custom one. Each kind has its
own colours (a ramp from see-through where there is little, to its full colour where it is strongest) and its unit.

- **Sources.** A layer holds sources: a strike, a fire, a release. The **Conditions** tool places one with a click,
  from the date viewed (or in the event being recorded), with the settings in its options: a strength (in the
  kind's unit), a size (km), a shape (a circle with an uneven edge, or a **plume** carried by the wind towards a
  direction at so many km a day, widening and thinning as it goes, its front thinning out), and a life: rising to
  its peak over so many days, lasting, then halving every so many days until it has faded; its edge can grow to
  its full size over days. The layer's value at a place is the sum of its sources there. Sources are kept as
  areas, lines and points are (D71): a feature on the field layer whose place is a dated change, so an event can
  hold them, moving one does not start it again, and undo, search and deletion work as for features; its settings
  are kept with it, and its life is counted from when it first appeared (`domain/fields.ts`, pure and tested).
- **Drawn on the graphics card** (`render-engine/fields-gl.ts`). Each source in force is drawn as a rectangle
  around its reach (in every copy of the planet the view shows), thousands in one call; for every pixel the shader
  undoes the projection (the terrain shader's inverses, now shared), measures the distance and bearing from the
  source on the sphere, and adds the source's value there into a picture of numbers (half floats; bytes where the
  graphics card cannot keep floats). That picture is then coloured by the kind's ramp and laid over the territories,
  under the areas, lines and points. The picture is kept until what it shows changes. Fields are an item of Show
  ("Conditions"), hidden while working or in exports like the others, and a separate export pass ("Conditions").
- **Temporary and permanent, kept apart.** Conditions pass by themselves; what changes the land for good is the
  terrain's (sculpting, D98; the sea level, D96).
- **Not done yet.** Spreading over the terrain (floods filling low ground, fires and lava), disaster templates,
  heatmaps worked out from points, and editing a placed source's settings (undo and "Remove all" for now); flat maps.
- **Tests.** `fields.test.ts` (rising, lasting, halving and fading; growing; a ragged circle and its reach; a plume
  downwind, widening, not upwind; distances and bearings on the sphere; stored settings checked; ramps; a field
  layer's sources placed from a date in an event, in force while they last, changed, undone, deleted);
  `e2e/workflows` (a radiation layer from + Layer; a source placed with a click, red two days on, not the day
  before nor a year on; a plume carried east, not west; hidden while working but presented; undone).

### D101. Finer heights close in, downloaded as needed (Stage 8)

Earth's bundled heights have cells of about 10 km, soft close in. Now, when a view's pixels are much smaller than
that (under about 4 km), the heights of the place in view come from the **Terrain Tiles** on AWS Open Data (the
source of the bundled grid, at finer zooms: 2.4 km to about 40 m a pixel), downloaded when needed and kept on this
computer. Valleys, ridges and lake shores appear at the scale of a region or a city.

- **Fetched through the local data service** (`/api/terrain-tile/z/x/y`), which keeps each tile it downloads
  (the desktop app with its own data, the browser version in a hidden folder of the projects folder) and serves
  kept tiles with no network. A tile that cannot be had is asked for again after a minute; offline, with none kept,
  the bundled heights are drawn as before. The tests' service serves only kept tiles (`--tile-source none`).
- **Which tiles.** The zoom whose pixels are about a screen pixel or finer, coarser when the region in view and
  around it (half the view's size on each side, for moving the map) would take more than 48 tiles; none while the
  bundled grid is fine enough (`terrain/detail.ts`, pure and tested).
- **A grid of the region.** The tiles (Web Mercator) are laid onto a longitude/latitude grid of the region, about
  as fine as the tiles and at most 2048 cells a side, in the bundled grid's own form, across the 180th meridian too.
  Under the ice sheets the bundled grid's ice surface is kept (the tiles have the rock beneath, as in D94), and so
  are sculpted places (D98) and places whose tile could not be had. The shader reads this grid inside the region
  and the bundled grid outside it; slopes are measured on whichever it reads, and relief is exaggerated less on
  the finer heights (they are nearer their true steepness).
- **When.** The working view asks for a region when the map comes to rest; while it moves, and while tiles arrive,
  it draws with the last region (or the bundled heights), and keeps a region while it still covers the view. An
  export waits for each frame's region (reused while it covers the frames). Exports of maps that may use them
  credit the tiles' sources (a new record, "Terrain Tiles, close up", with the attribution their makers ask for).
- **Per map**, on by default: "Finer heights close in" in the Terrain section of Show. The Earth only.
- **Not done.** The land cover of the satellite look stays at about 10 km. The region's grid is built on the
  interface's thread (up to about 0.2 s when a new region arrives).
- **Tests.** `detail.test.ts` (tile places and back; heights from a tile's colours; the tiles a view needs at each
  zoom, across the 180th meridian; the region's grid from synthetic tiles, a 5 km ridge kept, a missing tile, a
  sculpted place and the ice of Greenland taking the bundled heights); `terrain-tiles-server.test.ts` (a tile
  downloaded once and kept, served with the network gone; refused requests); `e2e/workflows` (tiles made by the
  test and kept: their ridges 8 km apart show close in, and not with the switch off).

### D100. The satellite look: land cover on the Earth, biomes on planets (Stage 8)

A third terrain palette, **Satellite**, colours the land as it looks from space (forests, grassland, steppe,
deserts, tundra, ice and bare rock), with the relief over it and the sea in dark blues by depth. Earth-like and
ocean planets are made with it (the other presets keep their own palettes); any map with terrain can choose it.

- **Earth's land cover** is Natural Earth I (public domain, land cover only, 16,200 × 8,100 pixels;
  `scripts/fetch-land-cover.mjs`, from Natural Earth's own download mirror). Its colours are light, made for printing
  under other things, so each is matched to the colours of its kinds of cover (ice, rock, tundra, steppe, arid land,
  desert, grass and crops, grass and woods, woods, forest) and given the colours those have from space, the same
  colours a planet's biomes take; grass becomes savanna in the tropics, forest becomes rainforest in the tropics and
  northern forest in the north, and the palest ground ice towards the poles. Averaged to 4096 × 2048 cells (the
  heights' grid) and saved as WebP: `data/terrain/earth-cover-4096.webp`, 873 KB, loaded the first time a map shows
  the satellite look. The sea takes the colour of the nearest land, so land the sea leaves at a lower sea level
  (D96), or sculpted out of it (D98), has the colour of the coast beside it. A climate model was tried for the Earth
  first and rejected: whatever its rules, it got whole regions wrong (southern China and the eastern United States as
  steppe, the Congo as savanna), where the real land cover is right everywhere.
- **A planet's biomes** are worked out from its heights (`terrain/biomes.ts`, about 0.4 s for 2048 × 1024 cells, a
  moment after the heights, and again after sculpting). Warmth comes from latitude and height (28 °C at the equator,
  6.5 °C less per kilometre up); moisture from the belts of rain by latitude (wet at the equator and in the middle
  latitudes, dry around 25° and near the poles) and from the air that reaches a place: moist off the sea, drying as
  it crosses land (about two thirds left after 1,000 km), losing its rain on the mountains it climbs (deserts in the
  rain shadow of a range), taking up water again over seas, carried by the winds of each latitude (from the east in
  the tropics and near the poles, from the west between 30° and 60°), with sea breezes near any coast. Warmth and
  moisture give the biome; bare rock above about 3,000 m; borders blended. Each preset has a climate: a desert
  world is dry and hot, an ice world 24 °C colder, its ice caps where the generator lays them (with a wandering
  edge); a moon, a volcanic world and a gas giant have no life and keep their palettes' colours. The planet's
  picture in New map shows its biomes.
- **In the shader** the land cover is a texture laid like the heights (with copies halved for zoomed-out views),
  read where the land's colour by height was read; everything else (the coast of the moment, relief, sculpting) is
  as before. Rivers are drawn in a darker blue in this look.
- **Not done.** The land cover does not change over time (deserts spreading, forests cleared: Stage 9's fields);
  Earth's is today's, at about 10 km, so soft close in, like the heights. A planet's biomes are worked out on the
  interface's thread (about 0.4 s after each sculpting stroke, with its rivers).
- **Tests.** `biomes.test.ts` (warmth, belts and the biome rules; distance from the sea in every direction and
  across the 180th meridian; rain shadows on both sides of the tropics' edge; rainforest, desert, ice and rock where
  expected, the same every time; ice caps, a desert world and a moon; the satellite look for Earth-like planets and
  their picture; the shipped WebP and its credit); `e2e/workflows` (the Sahara sand and the Congo forest in the
  satellite look; a generated Earth-like planet drawn with its biomes).

### D99. Rivers (Stage 8)

Maps of the Earth now show **rivers**, and so do generated planets. "Rivers" is an item of Show (beside lakes), on
by default, hidden while working or in exports like the others.

- **Earth's rivers** are Natural Earth's (public domain, `scripts/fetch-rivers.mjs` converts them once; the files are
  committed, `data/natural-earth/rivers-50m.json` at 231 KB and `rivers-10m.json` at 2 MB): 1:50m for the world
  and continents (the smallest views keep the greater rivers only, ranks 0–4), 1:10m close in, loaded with the coast
  detail. Lake centre lines are left out (the lakes are drawn). Each line keeps Natural Earth's rank, which sets its
  width: the greatest rivers 1.6 pixels wide, the middling 1.05, the least 0.65, the same on screen at every zoom.
  Long 1:10m rivers are cut into pieces of at most 400 points, so a close view draws only what is near it.
- **A planet's rivers** are worked out from its heights (`terrain/rivers.ts`, about 0.4 s for 2048 × 1024 cells):
  every land cell drains to one of its eight neighbours; hollows are filled first (a priority flood from the coast
  inland, lowest first), so water never gets stuck and every river reaches the sea or another river; the rain on each
  cell (by its area) gathers downstream; where the water gathered is among the most 1.5% of the land there is a
  river. Rivers are traced from their sources and ranked like Natural Earth's by the water at their mouths (a tenth
  of the greatest river's ranks 3, a hundredth 6). They are worked out again for sculpted heights, a moment after
  the heights are shown (the working view draws without them meanwhile; an export waits for them).
- **Drawn** in a blue that suits the palette, over the land colours and relief, under the coastline and territory.
- **Not done.** Earth's rivers stay where Natural Earth has them: at another sea level or where the sea is painted
  over land they are drawn over the sea, and sculpting does not move them. A planet's rivers follow sculpting but not
  a sea level other than its own. No river names.
- **Tests.** `rivers.test.ts` (a planet's rivers run downhill from cell to neighbouring cell to the sea or another
  river; water in a basin still reaches the sea; the same heights the same rivers, longitudes continuous across the
  180th meridian; a world all sea or all land has none; Natural Earth's at both scales, ranked, the Amazon at Manaus
  and the Nile in Egypt); `e2e/workflows` (rivers drawn on the Earth, hidden while working and back with undo).

### D98. Sculpting the terrain (Stage 8)

On any map with terrain (Earth, or a generated planet), the **Terrain** tool sculpts it with twelve brushes: raise,
lower, mountain range, valley, smooth, flatten, roughen, erode, crater, island, paint land and paint sea. A stroke
is dragged across the map (a click for a crater or an island), with a size in kilometres and a strength in metres
(for painted land its height, for painted sea its depth), and changes either **the base world** (every date) or
holds **from the date viewed** on, a change in history: painting the sea over England from 1450 floods it then and
leaves it land before.

- **Kept as strokes.** A stroke is stored as its brush, its path (rounded to about a metre, at most 600 points), size,
  strength, a seed for its noise and its date (`sculpt` in the map's settings), one undoable step each; "Remove all"
  takes them away in one. The heights shown at a moment are the base heights with every stroke holding then applied
  in the order drawn (`terrain/sculpt.ts`, pure and tested), kept for the last few sets of strokes, so scrubbing the
  timeline across a dated stroke costs a recalculation once. Distances along a stroke are measured on the sphere
  (to great-circle arcs between its points), across the 180th meridian too.
- **What each brush does.** Raise and lower add a smooth bump along the stroke; a mountain range adds ridged peaks;
  a valley cuts a sharper trough; roughen adds hills and hollows; a crater is a bowl with a raised rim; an island
  raises land out of the sea; painted land and sea set the ground a little above or below the sea; flatten brings
  the ground to the height where the stroke starts; smooth averages with the neighbours; erode lets ground slide
  down slopes that are steep at map scales (thermal erosion), keeping the material.
- **Coasts on Earth.** Sculpted places follow the terrain's own coast: the shader is given a mark for every cell a
  stroke changed, and there it takes the terrain's height without the "inside Natural Earth's coastline" rule of
  D96; Natural Earth's coastline line gives way there too. Elsewhere the coast is exactly as before. Territory that
  ends at the coast follows. Earth's heights are loaded for a map with strokes even when its terrain is not shown.
- **Tests.** `sculpt.test.ts` (each brush along a stroke and only within its reach, between its points too; across
  the 180th meridian; the same strokes always the same heights; base and dated strokes; stored strokes checked; the
  commands, a long path thinned, undone); `e2e/workflows` (land painted across the North Sea makes it land; the sea
  painted over England from 1450 floods it then and not in 1400; both undone).

### D97. Generated planets (Stage 8)

"New map" can now make **a planet of one's own**: a preset (Earth-like, desert, ocean, ice, volcanic, barren moon,
gas giant), a seed, and sliders for the share of sea, the number of continents, how high mountains rise, how rough
the ground is and how far ice caps reach, with a picture of the planet that follows every change. The same seed and
settings always make the same planet, so only the settings are stored with the map (`planet` in its settings); the
heights are made again when the map is opened (about 2 seconds for 2048 × 1024 cells, a few rows at a time so the
interface stays responsive) and kept for the session. Each preset has its own colours (five palettes added: desert,
ice, volcanic, barren, gas giant), and every Earth palette can be chosen too.

- **How a planet is made** (`terrain/planet.ts`, seeded simplex noise over the sphere, so nothing is stretched at
  the poles or cut at the 180th meridian): continents are low-frequency noise whose size follows the number asked
  for; plates (centres on the sphere, their edges bent by noise) raise mountain belts where they meet on land and
  ridges where they meet at sea; finer noise and sharper ridged noise give the texture. The sea then covers exactly
  the share asked for, by area (a fine histogram of the heights), and the heights are scaled to metres, up to about
  7 km and down to 6.5 km. Ice caps thicken the land towards the poles. A barren moon is pitted with craters (a bowl
  and a raised rim each, many small and a few large); a gas giant has bands of cloud instead of a surface.
- **Its coast is its own.** As at another sea level on Earth (D96), the terrain decides land and sea everywhere: the
  land (in colours, or plain), territory on layers that end at the coast (the option shows on planets too) and its
  borders. A planet can have a sea level over time like Earth.
- **Made anew.** `setWorldPlanet` changes a planet's settings in one undoable step (its history stays); there is no
  dialog for it yet.
- **Fixed on the way.** Undoing the creation of the map being viewed left the app showing a map that no longer
  existed, and the page went blank; after an undo or redo the first remaining map is now shown.
- **Tests.** `planet.test.ts` (seeded noise; the same settings make the same planet, also when made a few rows at a
  time; another seed or setting another; the sea's share for four values; heights within a real planet's; presets
  differ; ice caps; craters as bowls with rims; settings checked; the dialog's picture; the commands, undone);
  `e2e/workflows` (a planet chosen in the dialog with its picture following the seed, made, land and sea drawn
  differently, territory set to end at its coast; its creation undone, the first map shown).

### D96. Sea level over time (Stage 8)

A map of the Earth can have its sea stand higher or lower than today's at dates of one's choosing ("Sea level over
time…" beside Earth's geography): a list of dates and heights, the sea rising or falling steadily between them and
staying as it is before the first and after the last. One button sets the end of the last ice age (about 130 m lower
21,000 years ago, near today's from about 4000 BCE, a usual reconstruction rounded); Britain then joins Europe across
Doggerland, Asia joins America across Beringia, and Sundaland and Sahul appear. The levels are stored with the map
(`seaLevel` in its settings) and changed in one undoable step; they are history, so the same in the working view
and exports.

- **Coasts at another level.** Natural Earth's coastline is today's. At any other level the coast is where the
  terrain (D94) meets the sea, worked out for every pixel by the terrain shader. So that the coast does not jump when
  the sea first moves, a place inside today's coastline counts as at least 0.5 m high and a place outside as at least
  0.5 m deep (`heightAboveSea`; the shader reads today's land from a picture of it): at today's level land is exactly
  today's, and as the sea rises land goes under from its lowest places, as it falls the sea floor comes up from its
  highest, the coast moving steadily. The terrain is about 10 km a cell, so such coasts are drawn at that detail.
- **What follows the coast.** The land (plain or in terrain colours), and territory on layers that end at the coast,
  with their borders: both are trimmed by the terrain's land of the moment instead of Natural Earth's. Lakes stay
  water. Today's coastline line is not drawn at another level. Labels are still placed by today's land.
- **Needs the terrain.** Earth's heights are loaded for a map with a sea level, whether or not its terrain is shown;
  exports then credit them.
- **Tests.** `sea-level.test.ts` (levels between and beyond the dates; the stored points checked; the height above
  the sea: today's coast exactly at today's level, and a place once under a rising sea stays under; the command,
  undone, refused off Earth); `e2e/workflows` (with the sea 120 m lower, the North Sea is land and the territory of a
  country that ends at the coast covers it; undone); `e2e/render-compare` (a carried picture with the sea 120 m lower
  and territory to its coast matches one drawn afresh).

### D95. Terrain drawn by the graphics card (Stage 8)

A map of the Earth can now show its terrain ("What is shown", Terrain): the land coloured by height and the sea by
depth, relief shading lit from the north-west (25% to 400% strength), the relief of the sea floor, and relief over
the countries (their fills shaded too, so mountains show through them). Two palettes: **Natural**, which goes with
the map's dark style (its sea at 3,000 m is the map's own ocean colour), and **Atlas**, the light green-to-brown of
printed atlases. Like everything in that dialog, terrain can be shown while working and in exports separately.

- **How.** A WebGL2 shader finds, for every pixel, the place it shows: it undoes the projection (equirectangular,
  Mercator, and Equal Earth and Natural Earth by Newton's method: d3-geo's inverses, written out a second time in
  `terrain/look.ts`, where tests check them against d3) and reads the grid of D94, uploaded as half floats with
  smaller averaged copies (mipmaps), so a zoomed-out view reads the mean of what each pixel covers. Relief comes from
  the slope measured across what a pixel covers, exaggerated more the farther out the view, so it reads alike at
  every zoom. This is the first use of the graphics card: D1 is reversed only where it is needed, as planned.
- **Where it goes.** Pictures are made for the renderer's sheets (the plane it draws in) and where they lie on the
  canvas, so a kept picture with room around it, a turned view, a partial redraw (only that part is made) and an
  export frame are all made the same way. The sea's colours cover the planet; the land's are laid inside Natural
  Earth's coastline (lakes keep the sea's), so the terrain's own 10 km coastline never shows; the plain land colour
  is then left out. Relief without colours lies over the plain land. Relief over the countries shades each layer's
  fills before its opacity is applied, only where it has territory.
- **Exports.** Terrain colours are part of the Background pass (ocean, terrain, grid), so the passes still stack to
  the full picture; with colours on, the Land pass holds only the coastlines; relief over the countries is in the
  fills. When terrain is drawn, the export's credits include both of its sources.
- **Without WebGL2** there is no terrain, and the dialog says why. Electron and Chrome have it (with software
  rendering where a graphics card is refused), as does the headless browser of the tests.
- **Cost.** In the tests' browser, which draws in software, terrain added a few milliseconds to a working-view frame
  at 1600 × 950; drawing the room around a carried picture once the view rests took up to 0.7 s there. A graphics
  card does the same in milliseconds.
- **Limits.** Earth's grid is 10 km, so terrain looks soft closer in than a large country; close-up detail fetched
  on demand comes later in Stage 8, as do sea level over time, generated planets and sculpting.
- **Tests.** `terrain-look.test.ts` (the stored look; palettes; the inverse projections against d3-geo; relief
  shading; the command, refused off Earth, undone); `e2e/workflows` (terrain on: the Tibetan plateau lighter than the
  West Siberian Plain, the North Sea lighter than the deep Atlantic; relief over a country changes its pixels; hidden
  while working but drawn in the presentation; every change undone); `e2e/render-compare` (carried pictures with
  terrain and relief over the countries match pictures drawn afresh, in Equal Earth too).

### D94. Earth's elevation, sea floor included (Stage 8)

Terrain starts from one grid of Earth's surface height: 4096 × 2048 cells of 0.088° (about 9.8 km at the equator),
each the mean height of its area to the metre, from the Mariana Trench (−9,748 m as a cell mean) to the Himalaya
(6,230 m; cells are means, so peaks come out lower). It ships with the app (`data/terrain/earth-4096.bin`, 7.6 MB), so
terrain works offline; closer detail will be fetched on demand later. `scripts/fetch-terrain.mjs` rebuilds it.

- **Sources.** The Mapzen terrain tiles on AWS Open Data, at zoom 5 (GMTED2010 on land, ETOPO1 under the sea),
  resampled from Web Mercator by area. At that zoom those tiles give the **rock beneath the ice sheets**: central
  Greenland comes out near sea level and much of Antarctica below it. Greenland and Antarctica (everything south of
  60° S, and 59°–84° N, 74°–10° W) therefore come from the **Copernicus DEM GLO-90**, a surface model with the ice
  and the Antarctic ice shelves: the smallest overview of each of its 8,105 tiles there, read with range requests.
  Summit, Greenland comes out at 3,202 m; the South Pole at 2,822 m; Dome A at 4,080 m. Coastal cells mix the two by
  their share of land. ETOPO 2022 and GEBCO, which have the ice surface built in, could not be downloaded from the
  development environment; they remain a way to improve the sea floor.
- **Beyond 85.05° north** (the Web Mercator limit, the Arctic Ocean) the last row is smoothed more and more along the
  parallel towards the pole, so no streaks converge on it; the south has Copernicus to the pole.
- **File.** A 16-byte header, then the cells' residuals from a neighbour predictor in two byte planes, deflated
  (`src/terrain/grid.ts`; the script and the app share the code). Coarser heights would save little: 2 m steps
  measured 6.6 MB; steps growing with depth 4.6 MB, but 30 m steps on the flat abyssal plains show as terraces in
  relief shading. Reading it takes about 0.2 s.
- **Credits.** Both sources are in data/datasets.json, so they appear in "Data sources and credits"; exports will
  credit them when terrain is drawn. The Copernicus DEM GLO-90 licence allows any use, commercial included, with its
  credit line; the Mapzen sources at this zoom are public domain.
- **Tests.** The file format round trip (heights at both ends of the range next to each other included),
  interpolation between cells with longitudes wrapping, and heights at known places on land, at sea and on the ice.

### D93. Contested areas (Stage 7)

Claims and zones are areas on feature layers (D71), belonging to a country or faction. An area can now also be
**contested with** another country or faction (in its panel, or for a whole layer in the layer's look): it is then
drawn in wide stripes at 45° of the two claimants' colours instead of its plain fill (at least half opaque, so the
dispute reads over the territories), with its outline and name as before; the stripes keep their spacing on screen
at any zoom and export size. Stored with the area's look (`contested`: the other claimant's id; '' for none), so it
can be set and undone like any other part of the look; an area contested with a country that is later deleted is
drawn plainly again.

### D92. Events out of sync with the clock in presentations (Stage 6)

A shot maps history onto screen time; an event that is short in history (a battle of one day) flashes past in a shot
that spans centuries, and its changes, if instant, are not animated at all unless the shot animates every change.
An event can now **take its own time on screen** ("In presentations" in its panel: "Follows the clock" or "Takes its
own time on screen", a number of seconds, kept in the event's `presentation` settings, which were set aside for this):
in any shot that animates (not one set to show every change at once), each of its changes takes that many screen
seconds from the frame where it happens, however fast the clock runs. A change recorded with an animation of its own
keeps its style (an advancing front, an expansion from its starting points, a fade) and is only re-timed; an instant
change takes the shot's style. The timing is one pure function (`shotProgress` in presentation/sequence.ts) used by
the renderer for each change: the event's own seconds first, then the shot's timing (its seconds, or the change's
span in history when timed by events). History itself is never changed.

### D91. Expansions from several starting points: pincers and encirclement (Stage 6)

An expansion ("a circle from where you started drawing") spread from one point. A change animated as an expansion
can now have **more starting points** ("Add a starting point" beside it in the event's panel, then a click on the
map; "Only the first" takes them away): it spreads from all of them at once, each place changing hands when the
front from its nearest starting point reaches it, so two pincers close on the middle (encirclement) and the land
farthest from every starting point changes last. The engine keeps the points with the change (`transition.origins`)
and measures from the nearest (`fromNearest`); how far the front must go is the farthest point of the change from its
nearest starting point, so the change still ends at its end. The renderer draws the land reached as the circles
around every starting point together. A change keeps its starting points when its animation is switched and back,
and keeps its length (D86). This covers the encirclement the requirements list; keyframed fronts (a front line
placed at chosen dates) remain to be done.

### D90. Units: characters belonging to a country, with arrows of advance (Stage 7)

Armies, fleets and other units are characters (D35, with icons, D85) that can **belong to a country or faction**
("As a unit" in the character's panel). A unit is drawn in its country's colour, which it follows if the country's
colour changes, on the map and in the lists. Its **route** can be shown as a **trail** of where it has been (the
dashed line a shot can show for every character), or as an **arrow of advance**: while the unit travels, a bold arrow
in its colour on a dark edge runs along the leg under way, from where the leg began to just behind the unit, its head
pointing on; standing still, it has none. Both are drawn in the characters' export pass. Stored in the character's
`style` (`side`, `route`), checked when saved (a unit belongs only to a country or a faction). Bases (a character
that stays put, with the fort or naval base icon) need nothing more; contested areas are the next step.

### D89. Front lines between countries at war (Stage 7)

Wars are recorded as dated relationships (D72: "at war with", begun and ended at dates or by events). A territory
layer's **Front lines** setting (under the layer in the list) draws, while a war holds, the border between the two
countries on that layer as a front line: a line in the front's colour (red by default, chosen beside the setting)
on a dark edge, with **teeth toward the second country** of the war as entered ("A at war with B": teeth into B),
toward the first, or without teeth. On a layer of military control the front follows control, not ownership, and
moves as control changes (an advancing front shows it moving). The line is found from each first country's outline
where the land across belongs to the second, so it is exactly their shared border, coasts and enclaves included;
outlines run with their land on the same side, so the teeth always face the other country. Front lines are part of
the borders (drawn with them, in the borders pass of exports, and hidden with them); the kept picture of the
territories is keyed by the wars holding, so a war beginning or ending redraws it once. Contested areas, arrows of
advance and units are the next steps of Stage 7.

### D88. Hatching for occupied territory (Stage 7)

Occupation and control are recorded on territory layers of their own ("Military control"), which leave ownership
untouched. Drawn solid, such a layer hides the political map under it. A territory layer's **Fill** (under the layer
in the list) can now be solid, **stripes**, **crossed stripes** or **dots** in each owner's colour, see-through
between them: occupied land shows the occupier's stripes over the owner's colour. Stripes are about 11 design
pixels apart at 45°, the same on screen at any zoom and in any export size, and they move with the map (placed on
the kept picture's sheet, so panning carries them along); the layer's opacity still applies, as do coastline
clipping (the coastal band, D83, takes the stripes too), changes under way (an advancing front reveals stripes) and
pictures (an owner filled with a picture keeps it). Stored in the layer's style (`fill`); the kept territory picture
is keyed by the layer's style, so switching redraws it once.

### D87. Locking countries: their land and borders stay as they are (fifth feedback round)

The request was to lock or disable countries that do not change while working on a large project, so that the
program would work as if they were not there. Measured first on the whole-world benchmark (242 countries, 78,726
border segments, 1,623 parcels): a brush stroke takes about 27 ms in the parcel map, bringing history up to date 0.1 ms
and the state at a date 0.2 ms, and redrawing about 20 ms; all of it in proportion to the land the stroke touches,
not to the number of countries (the two optimisation stages, D48–D70, made it so). Leaving locked countries out of
that work would save nothing measurable, so a lock is a **protection**, as in drawing programs: a locked country keeps
what it holds while one works elsewhere.

- **Lock and unlock** from a country's right-click menu ("Lock", "Unlock", and "Lock all the others", one step to
  undo), for a whole group from its menu, or with the "Locked" box in its panel. Lists show a lock beside it, and a
  group whose countries are all locked; stored in the country's `style` (`locked`).
- **What a lock does.** Any edit that gives land (brush, precise shape, border pen, regions, the border eraser,
  corrections and changes in events, today's countries added) leaves out the land a locked country holds at the
  moment of the edit, and says so ("Locked, so left as it was: France"). Land is never given to a locked country
  (it is shown as locked, and cannot be chosen, in the brush's list); splitting, merging and annexing it are
  refused, and so is moving one of its border points from a date. Moving or taking away a border point for all
  time is refused where a locked country holds land around it on the date viewed.
- The 1:50m coasts and borders of a locked country are still snapped to (new borders still meet them exactly), and
  it is drawn and exported as before. Deleting a locked country is still possible (it is asked for explicitly).

The first stroke after opening a large project takes longer (about 0.45 s on the whole-world benchmark): the parcel
map works out its faces on first use. That is unrelated to locking and left for later.

### D86. How long each change takes; recording "until the next change" (fifth feedback round)

A territory change in an event used to spread (as an advancing front, an expansion or a fade) from its own date
until its **event's end**, and changes drawn while recording into an event happened at once. Each change can now
have its own length, stored with its animation (`effect.transition`): **until a date**, or **for a while** (days,
months or years) from its own date; without either, until the event ends, as before. The engine takes the change's
own end first (`transitionEnd`), so a change can spread in an event without an end, or end before or after it.

The recording bar chooses what each change recorded does: **happens at once**, **spreads until the next one I
record**, **spreads until the event ends**, or **spreads over** a set time; and how it spreads (an advancing front,
an expansion from where the drawing began, a fade). The choice is kept on this computer. "Until the next one": a
change recorded so lasts until the change just after it in the same event and layer, if there is one, else until
the event ends; and any change put into the event ends the one just before it, if that one was recorded so. This is
worked out when a change is recorded, in the same step (undone together), and written as the earlier change's own
end, so recording out of order (a change between two others) keeps the chain in order, and the engine follows it
like any other end. Regions given while recording take the same length. In the event's panel each change shows when
it spreads ("1 January 1961 to 1 January 1964 (until the next change recorded)") and how long it takes (until the
event ends, until a date, for a time); choosing one takes it out of the chain. Changing its animation keeps its
length; in an event without an end, a change that starts to spread takes a year until chosen otherwise.

Checking this against history compiled afresh (the follow test, now with lengths and chained recording among its
random edits) found that a layer whose last change was deleted kept an empty list of timelines; the engine now drops
it, as a fresh compile has none.

### D85. Character icons: a set of 46 drawn as shapes, a picture of one's own; facing the way of travel (fifth feedback round)

A character can be shown by an **icon** instead of the round marker: one of a set of 46 designed for the project
(`src/render-engine/icons.ts`) or a picture of one's own. The set: ships (sailing ship, galley, warship, aircraft
carrier, submarine, cargo ship, tanker, ocean liner, boat); aircraft (airliner, propeller plane, fighter jet, bomber,
military transport, drone, helicopter, airship, missile); on land (tank, armoured car, artillery, truck, cavalry, army,
infantry, train, car); military signs (headquarters, fort, camp, battle, knight, shield, star, target, explosion,
airborne, naval base, radar); people and places (person, ruler, wagon, caravan, envoy, trade, explorer, flag). Each is
a few shapes on a 64 by 64 grid (the icon, its details in a contrasting colour, parts over the details, lines), drawn
as paths, so it is sharp at any size (an 8K export too) and takes the character's colour. Two looks: the icon itself
in the character's colour with a dark outline (so it stands out on land and sea), or white on a disc of the
character's colour; a size from 50% to 300% (saved when the slider is let go); and which way it faces. The engine gives
each character a point a little way (about 5 km) on in the direction it is travelling, or last travelled
(`CharacterAt.ahead`), and the icon follows it in its own way: aircraft, drawn from above, **turn** to face it; ships
and vehicles, drawn from the side, **face east or west** (flipped, never upside down); signs stay upright. Each can be
set otherwise (turn, flip, never); a picture of one's own does not turn unless asked. The panel's "Icon" section
chooses all this, with the set shown in the character's colour; the lists of characters show the icon too. A picture
is a project asset like a country's fill picture (loaded before exporting). Picking a character on the map takes the
icon's size into account. Stored in the character's `style` (`icon`), checked when saved (unknown icons and paths
outside the project refused); characters without one are drawn as before.

### D84. What is shown, while working and in exports apart; lakes from a chosen size (fifth feedback round)

Each map keeps a list of what it shows (`map_space.settings.show`), twice over: **while working** and **in presentation
and exports** (the presentation preview shows what exports show). The list: borders, country names, cities,
characters, areas lines and points (feature layers), lakes, coastlines, and latitude and longitude lines; everything is
shown unless switched off, so maps saved before keep their look. The top bar's **Show…** button (and "Lakes and what is
shown…" under the map's Earth geography) opens it. A shot's own choices (names, cities, characters, grid lines) still
apply on top of the export list, and the layer list still hides whole layers. Hiding borders or names while working
also makes the working view lighter to draw.

Lakes have a **smallest size**, for both: a slider from "every lake" through 1 km² to 100,000 km² on a log scale, with
how many lakes that leaves and the size of a few known lakes for scale. A lake is judged whole: its outline less its
islands, and at 1:10m, where the data cuts large lakes into 10° tiles, the pieces that share a point on a tile's edge
are counted together (Lake Victoria, cut at the equator, is 68,000 km² at both scales), so no lake is ever half shown
and an island never fills in. Areas are worked out on an equal-area plane (longitude against the sine of the
latitude), exact for shapes the size of lakes. A hidden lake is land for the coastline rule (D83): territory covers
it. Of the 1,365 lakes at 1:10m, 354 are 500 km² or larger and 200 are 1,000 km² or larger. Lake sizes are worked out
once per scale (about 25 ms at 1:10m) when the filter is first used; changing the size rebuilds the sheet's paths once.

### D83. Territory reaches the detailed coastline: a coastal band under the fills (fifth feedback round)

Today's countries are added from Natural Earth's 1:50m shapes, but close up the coastline is drawn from the 1:10m data:
with "Territory ends at the coast", land between the two coasts was left unfilled (rims along Denmark's and Greece's
coasts, whole strips in Norway's fjords), small islands near a coast were empty, and a country's border against the
sea was drawn as a line across the land. Adding the countries at 1:10m instead was measured on the whole world: 520,000
points instead of 95,000, 34 s instead of 2 s to add, 1.7 GB of memory instead of 0.3, an 82 MB snapshot and strokes
three times slower, which is too heavy for large projects on a slower computer; simplifying the 1:10m coasts barely
helps (430,000 points at 0.002°). So the drawing makes up for it instead: where a territory layer ends at the coast,
each owner's borders **against nobody** (its coasts, as kept for its border lines) are stroked about **5 km** wide (1 to
48 pixels) in the owner's look (its colour, or its picture placed as its fill is) **under** the fills, kept only in a
band 5 km either side of the coastline drawn, and the land mask then trims it to the land: land along the coast that no
territory covers takes the look of the territory beside it, and small islands within that distance with it. Inland,
land that nobody holds is untouched (it is not near the coastline), and anything someone holds is drawn over the band.
An owner's border against nobody is left out within the band (the coastline is the edge there); borders between two
owners still run to the coast. The band of the coastline is kept between frames while the view stays (as the land mask
is), so a brush stroke's redraw costs 0.5 ms more (20 ms against 19 ms on the Earth 242 benchmark); moving the map
costs nothing measurable. The reference renderer of the picture comparison (`e2e/reference`) follows the same rule.
Making the comparison on the whole world also found that saving a snapshot of a map with half a million border points
overflowed the call stack (lists were spread into one call); such lists are now copied item by item.

### D82. Pictures over countries in several pieces; flags fitted without cropping their stripes; territories (fifth feedback round)

A picture fill (a flag) was placed by the box around **all** of a country's land, so France's flag spread from French
Guiana to Réunion and mainland France showed only its white stripe; Russia's box ran round the whole map across the
180th meridian (all blue); the Canary Islands pushed Spain's flag south. Now (`src/render-engine/fill-clusters.ts`,
`MapRenderer.fillClusters`): a country's **pieces** (parcels that touch) are gathered into **clusters**, and each
cluster gets its own copy of the picture, placed by the cluster's box. The rule, by default ("automatic"): pieces join
when the gap between their nearest pieces is under 1° (about 110 km: an archipelago's islands) or under 15% of the
larger cluster's extent (Corsica with France, Tasmania with Australia, Kaliningrad with Russia); otherwise they have
their own copy (French Guiana, Réunion, the Canary Islands together, Alaska with the Aleutians, Hawaii, Svalbard, the
Azores). Boxes and gaps are taken the short way round the 180th meridian (Russia and Fiji have one box), and a
cluster's picture is placed by its **core**, its pieces of at least 5% of its largest, enlarged where it must still cover
the outlying pieces (Russia's flag over its mainland, its white stripe not spent on the Arctic islands). Each copy is
drawn in every place its box shows (the copies either side of the map's edge). A new fit, **"cover it, stretched a little
rather than cropped"**, is the default: the picture covers the box but may be stretched up to twice one way instead
of cropped, so a long country keeps all its stripes; flags added earlier with "cover" are drawn this way too. A
country's fill now offers **"Land in several pieces"**: automatic, one picture over all of it, a copy for every piece,
or a copy for pieces farther apart than a distance (a slider from 10 km to 20,000 km). Checked against today's
countries (France 6 copies, Spain 2, the USA 3, Russia 1; Indonesia, Japan's main islands, the Philippines, Greece,
Canada one each).

**Territories** (Greenland, Puerto Rico, Hong Kong, New Caledonia, the Faroe Islands…; 43 in Natural Earth) were left
out by "Nations only" and had no flags. Their flags are now fetched too (40, from flag-icons, `scripts/fetch-flags.mjs`;
not Western Sahara's, whose status is disputed and whose drawing is one side's flag, nor the unofficial Antarctic
design), today's countries record the nation each territory belongs to, and "Add today's countries" asks how to add
territories: as countries of their own with their own flags (the default), as part of their nation (Greenland's land
given to Denmark when Denmark is added), or left out.

### D81. The Border points tool shows only points of borders at the date viewed (fifth feedback round)

The parcel map keeps every line ever drawn: a border erased (or a country merged, or land given away) is still the
border before that date, so its points stay in the map. The Border points tool used to show and pick all of them,
so erased borders left trails of points. Now it shows, picks and adds points only on **borders at the date viewed**:
segments with different owners on their two sides on a visible territory layer (a coast, owner against sea, counts),
worked out again when the map or the date changes (`src/domain/border-points.ts` bordersAt). Going back to a date
when the erased border existed shows its points again.

### D80. Date fields: a calendar, arrow keys, and an end that starts at the start (fifth feedback round)

Every date field (the date viewed, events' starts and ends, shots, dialogs) can still be typed into ("14 May 1203",
"500 BCE"), and now also has a **calendar** (the button at its end): a month at a time, with arrows for the month
(‹ ›) and the year (« »), a list of months, and a box for any year ("1450", "44 BCE", "-499"); the keyboard moves the
chosen day (arrows: a day or a week; Page Up/Down: a month; Shift: a year) and Enter takes it. In the field itself the
**arrow keys step the date**: up or down a day, with Shift a month, with Alt a year (a month after 31 January is the end
of February); on the date viewed each step applies at once, elsewhere on Enter or on leaving the field, as typing does.
An event's empty **end shows its start**, greyed, where "(instantaneous)" was, and the arrows and the calendar start
from it; nothing is written until a date is chosen, so the event stays instantaneous if the field is only visited
(filling the start in on focus was tried and dropped: typing straight away could be glued onto it). Calendar arithmetic
is `src/core-time/steps.ts` (stepDate, parseYear); the popover is `src/ui/components/DatePicker.tsx`.

### D79. Animated areas, lines and points: a line draws itself, an area grows, a shape fades (Stage 6)

A shape change of an area, line or point that belongs to an event with a length can **appear over the rest of the
event** (from its own moment to the event's end): a line **draws itself** along its length with its arrowhead
travelling at the drawn end (a front line or an arrow advancing), an area **grows** from its middle (revealed within a
circle reaching its farthest point) or has its outline drawn while its fill fades in, a point grows, and any shape can
**fade in**. When it replaces an earlier shape, the earlier one fades out meanwhile. The style is stored in the shape
change's `transition` (`{"style": "draw" | "grow" | "fade"}`, no new table, file format unchanged); the engine gives
`featuresAt` a progress (eased) and the shape before (`FeatureAt.progress`, `style`, `before`), and the moment the
animation ends counts as a time of change (stepping, the timeline). Without an event, or in an event without an end,
a shape appears at once. Features are drawn afresh on every frame over the kept territory picture, so the working
view, playback and exports show the animation with no further work. The drawing prompt preselects it when the event
has a length (a line draws itself, an area grows, a point fades in); each step of a feature's shapes in its panel can
change it. Not done: a shape morphing into the next (it cross-fades instead), and front lines moving with a war's
fronts on territory layers (Stage 7).

### D78. The region picker: today's countries or states and provinces, chosen on the map (Stage 2)

The plan's region picker ("click, box or lasso existing administrative regions and assign them; admin level to pick
from") is the **Regions** tool. Levels: today's countries (Natural Earth 1:50m, the file "Add today's countries"
uses) and today's states and provinces (Natural Earth admin-1 at 1:10m, 4,596 regions; new file
`data/natural-earth/regions-10m.json`, 6.8 MB, 2.3 MB compressed, made by `scripts/fetch-regions.mjs`: coordinates
rounded to 0.001°, coasts simplified to about 900 m, and every point a region shares with another kept, so neighbours
meet exactly: Berlin given to one owner and Brandenburg around it to another leave no gap). The regions are a picking
aid only, loaded when the tool is first used, not edges of the parcel map: a region's outline enters the parcel map
when it is given to an owner (`commands.ts` addCountries with `into`, which handles holes; `into` may now be a new
country made in the same step). A click toggles the region under the pointer (named while hovered); a box takes every
region whose middle (`RegionIndex.anchors`, inside its largest polygon) lies in it; Enter asks who gets them (an
existing country or a new one) and when (from the date viewed, as a correction, or in an event); Esc clears the
choice. Finding the region under a point uses a 10° grid of polygon bounding boxes and a point-in-polygon test with
holes (`src/domain/regions.ts`). Lasso selection is left out: the box and clicks cover it, and the brush draws any
other shape. Sub-national boundaries as permanent parcel edges (geoBoundaries, GADM) are not added: picking
regions puts their outlines in only where they are used.

### D77. A border point moved from a date on (Stage 3)

Dragging a border point with the Border points tool now asks whether to correct the border's shape for all time (as
before, `moveVertex`) or to **move it from the date viewed on** (`commands.ts` moveBorderFrom). From a date, the
point's old place stays (it is the border before the date); the new line from its neighbour to the new place to its
other neighbour is drawn into the parcel map, and the sliver between the old and new line goes, from that date (or in
the event being recorded), to the country the point moved away from. Only a point on a border between exactly two
owners on that date can be moved so (a junction of three borders is refused: the Territory brush does it), and the
new place and the land on the way must belong to those two (not across a third country or out to sea, unless the sea
is one side of the border). When a move for all time would cross another border it is no longer refused outright:
the prompt explains why and offers the move from a date, which may still be possible. While an event is recorded,
the move from a date is preselected.

### D76. Splitting along a line and merging countries (Stage 2)

**Split** (a tool on the toolbar): drag a line right across a country, then click the part that changes hands. The line
is inserted into the parcel map as an open path (it becomes a border, as an outline does); the part is the country's
land reached from the click without crossing the line (`commands.ts` splitTerritory; owners of parcels split by the line
are read through their parents, so the country is the one on the date viewed). If the line does not divide the
country (it stops inside it), the split is refused and the line taken back. The part goes to a new country (named by
its side of the line: "North Aldmark") or an existing one. **Merge** ("Merge into one…" on the right-click menu of two
or more chosen countries): all their land on the date viewed goes to one of them (the largest is offered), another
country or a new one; the others keep their names and history and hold no land from then on (`mergeTerritory`). Both
ask when the change holds, as the drawing prompt does: from the date viewed (the default), as a correction of the
period, or in an event (existing, or a new one made in the same step). Making the new country, the event, the border
and the change is one undo step. Splits and merges are ordinary territory changes (no intention is kept, unlike an
annexation: a later edit to the country's earlier borders does not move them).

### D75. Event types are templates: a colour, a usual way of spreading and a usual length (Stage 3)

The architecture calls a custom event type "a template combining" kinds of change. What a type now carries, kept as
JSON in the `fields` of its `event_type` row (no new table, project file format unchanged; `src/domain/event-types.ts`):
a **colour** (the event's bar on the timeline and a square in the events list and the event panel; a type without one
keeps the usual blue), **how territory drawn into its events spreads** (at once, advancing front, expansion, fade;
preselected in the drawing prompt when the event lasts a while, until chosen by hand), and **how long a new event of
the type lasts** (days, months or years; fills in the end of a new event until one is typed in; a month later than
31 January is the last day of February). "Event types…" (under the events list, and beside an event's type) makes,
copies, renames, recolours and deletes types; the built-in types can be changed too. Deleting a type makes its events
plain events ("Event"); "Event" and the starting map's type cannot be deleted. All are ordinary undoable edits. The
drawing prompt's new event now has a type (Conquest when land is given, Event when cleared, as before). Not done:
type-specific fields (a battle's casualties, a treaty's signatories), which wait for a use; a type does not yet decide
which kinds of change its events hold (those are still chosen while drawing).

### D74. Comparing two dates: a second renderer and a line across the map (Stage 3)

"Compare" in the date bar shows the map at a second date to the right of a line across the map, the date viewed to
its left; the line is dragged sideways (it is drawn in yellow with a handle and the two dates at its top). The second
date starts as the day before the last change up to the date viewed (`Engine.lastChangeStart`; a change made over a
period counts from its start), so turning it on shows at once what the last change did; it is typed in like any
date, "⇄" swaps the two, and the timeline marks it with a dashed yellow line. The second date is drawn by a second
`MapRenderer` (`store.compareRenderer`) with its own kept pictures, onto a canvas of its own laid over the right of
the line, so moving the map or the line costs what the working view costs (each picture is carried, patched and
drawn afresh at rest as before, D58–D70). Settings apply to both. Editing, choosing and the panels work on the date
viewed (the left); the line is only for looking. Swiping was chosen over side by side: one map, one camera, and the
change seen in place; side by side can be added if wanted. Not in shots or exports.

### D73. Search, data export (GeoJSON and CSV) and pictures with notes: the rest of Stage 4

**Search** (`src/domain/search.ts`, the box in the top bar, Ctrl+F): countries, factions, characters, cities, areas,
lines and points, events, relationships and layers, by name, by every name something went by (Byzantium is found as
"Constantinople"), and by the words of notes and descriptions; accents and case are ignored. Best first: a name that
starts with the words, then one that holds them, then a former name, then notes (with the piece of text shown).
Going to a result chooses it and brings the date and the view to it: a city or character to where it is (or first
was), a feature to where it is (the date moved to its first shape if it is not there now), an event to its start.

**Data export** (`src/domain/data-export.ts`; "Export data (GeoJSON, CSV)…" under Maps; a new route of the data
service writes the files into a new folder of the project's exports). The map at a chosen date as **GeoJSON**:
territories joined owner by owner (the parcels' outline, D56) with holes and separate pieces, areas, lines and
points, cities and characters where they are; each with its layer, name, owner and colour. Rings follow RFC 7946
(outer rings anticlockwise, holes clockwise; d3 reads the opposite way and must reverse them); longitudes stay
continuous along a ring, so a shape across 180° may run past ±180° (QGIS and most tools accept this). The record
as **CSV**: events (type, dates, groups, alternatives, description), countries and others (with every other name and
the date it began), relationships (one row per period) and features (one row per dated shape or ending). Dates are
written so a spreadsheet sorts them (1850-03-01; astronomical years, -0043 for 44 BCE); cells that hold commas,
quotes or line breaks are quoted, and text that a spreadsheet would take for a formula is defused. The project
file stays the authoritative copy: nothing is read back from these files.

**Pictures with notes** (the architecture's "rich notes and images"): every country, faction, character and city,
every area, line and point, and every event can keep pictures with its notes or description (thumbnails, opened
large with a click). They are stored in the project's pictures folder like picture fills, named by their content, and
listed in the item's look (`style.pictures`, events in `fields.pictures`), so they are undone like any edit. (Like
other pictures they are not in automatic backups: Known limits 11.)

Tests: `test/search-export.test.ts` (search ranking, former names, notes, accents; the GeoJSON of a map with an
enclave and two pieces, whose polygon areas, measured from the file alone, equal the owners' land within 1%;
nesting and winding; every CSV with quoting, dates and formula text) and `e2e/workflows` 'Search, pictures with
notes, and data export'.

### D72. Relationships between entities: a relation table, and their periods as changes (Stage 4)

The architecture's relationships ("typed links between entities, with start and end dates set by events, just like
other properties") are built like features (D71): a row of the new table `relation` (file format 6) names the kind
and the two parties; **when it holds is given by changes of a new kind, `relate`**, that begin it or end it, in an
event or without one. So a war begins with one event and ends with another, a second war between the same two is a
second period of the same relationship, alternative versions of an event bring or drop it, and undo, History
Health and the engine's change-by-change following (D55, verify mode) cover it as they cover everything else.

Kinds (`src/domain/relations.ts`): at war with and allied with (mutual: one relationship either way round); part
of / has as a part, vassal of / overlord of, member of / has as a member, leads / led by, successor of / succeeded
by, travels with / accompanied by (each read from either side). The architecture's "participant in" is what events
already record through their changes, so it is not a separate kind.

In the interface, every country, faction, character and city has a **Relationships** section: each relationship
read from its side ("At war with Duchy of Proba"), the periods it holds (dates that go to the date), whether it
holds at the date viewed, "Ends on <date>" or "Again from <date>", and Delete; "+ Relationship" adds one from the
date viewed, always, or with an event, with an optional end date. Deleting a party deletes its relationships; an
event's list of changes says what begins and ends. Using them on the map (front lines between countries at war,
grouped colours for parts and vassals) is Stage 7 and 10 work. Tests: `test/relations.test.ts` (4 tests, 150 random
edits followed one by one in verify mode) and `e2e/workflows` 'Relationships'.

### D71. Areas, lines and points: a feature table, and their shapes over time as changes (Stage 4)

The architecture's second spatial representation ("features: independent points, lines and polygons with lifespans
and dated shapes; overlap freely") is built as three new kinds of layer, `area`, `line` and `point` (the layer kinds
were already in the schema). A feature is a row of the new table `feature` (file format 5): its layer, name, the
country or faction it belongs to (optional), its own look and notes. **Its shapes over time are changes of a new
kind, `shape`**, in the same table as every other change, instead of the separate `feature_version` table the
architecture sketched: a shape then belongs to an event or to none, is moved with its event, follows an event's
alternative versions, is listed in the event's changes and in History Health, is undone like any edit, and the
engine follows it change by change (D55) and checks it in verify mode. A shape holds parts (an area's rings,
even-odd; a line's polylines; a point's place) in longitude and latitude, joined by great-circle arcs like
borders. **A feature's lifespan is its shapes**: it exists from its first shape on, and a shape marked `off` ends it
(until a later shape). The three edit choices mean what they mean for territory: a new change in an event, a change
from the date viewed without an event, or a correction of the shape in force at the date viewed (where the feature
does not exist then, it is given that shape from then on).

Features never touch the parcel map: drawing one cuts no border and gives no land to anyone, and areas on one layer
overlap freely. They are drawn in a new pass, **"Areas, lines and points"** (`features`), over the territories and
under the names, layer by layer, and exported as their own pass (the passes still stack into the full picture).
Their outlines are projected once per sheet, like borders; what is measured in screen pixels (line widths, dashes,
the teeth of a front line, arrowheads, symbols, names) keeps its size, and symbols and names follow the zoom as
cities do. Looks: a kind's defaults, then the layer's style, then the feature's own; the colour is the feature's
own, else that of the country it belongs to, else the layer's. Areas: fill opacity, hatching (diagonal, crossed,
dotted), outline width and dashes. Lines: width, dashes, teeth on either side (a front line), arrowheads at one or
both ends. Points: circle, square, triangle, diamond, star, cross, crossed swords (a battle). Deleting a country
leaves its features belonging to nothing; deleting a feature takes its shapes. Animating a feature's change (a line
drawing itself, a zone growing) is Stage 6 and 7 work; for now a shape changes at its date. Tests:
`test/features.test.ts` (7 tests: kinds and checks, dated shapes and lifespans with the three edit modes, events
with undo, reloading and alternative versions, deleting and broken references, tidy shapes across 180°, looks, and
120 random edits followed one by one in verify mode).

**In the interface.** "+ Layer" asks for the kind (territory, areas, lines or points; territory first, as before).
A new tool, **Areas, lines & points**, draws on the feature layer chosen above the map: a click puts a point; areas
and lines are drawn freehand (cleaned up like the brush) or click by click (double-click or Enter finishes). Then a
short question: the name, what it belongs to, and when it holds: from the date viewed (the default; no event),
always, or as part of an event (an existing one or a new one). While an event is being recorded, drawings go into it
without asking. With Select, a click chooses the feature under the pointer (a point first, then a line or an area's
outline, then the inside of an area, so a battle inside a claim can be clicked); it is outlined on the map, and its
panel holds the name, owner, layer, look, its shapes over time (go to, from the beginning, remove a step), "Draw a new
shape…" (the next drawing becomes its shape from the date viewed, a correction of the shape in force, or part of an
event), "Ends on <date>", notes and Delete. The left panel lists the features of the map, layer by layer, dimming
those not there at the date viewed. `e2e/workflows` drives all of it with the mouse (a step of its own) and exports
the features pass with the others.

### D70. While the view zooms in, the geometry it started with serves twice as far

Geometry prepared for one zoom (a sheet, D49) is drawn at up to 1.42 times its scale with its outlines within the
tolerance; beyond that it was prepared again. Zooming in with the wheel passes that mark every second notch, in the
middle of the movement, for a frame that only shows the picture before enlarged. While the view is on the move, a
sheet now serves up to 2.84 times its scale (`MOVING_UP_TO`): its outlines are then coarser than the tolerance by
up to twice (0.7 of a pixel at the usual setting), in a picture that is being enlarged frame by frame anyway. Such
a frame counts as approximate, so once the view rests it is drawn from geometry prepared for its own zoom. (A view
that comes to rest within 1.42 times of the scale its geometry was prepared for keeps that geometry, as before.)
Zooming in five levels in twenty steps on the heavy project: geometry prepared twice instead of six times on the
way, the longest frame 131 ms instead of 203, 811 ms in all instead of 906. What is left of a zoom's cost is the
drawing itself (D63). Exports and anything at rest are untouched (`SHARP_UP_TO`).

### D69. The export size estimate, border points in view, and a like-for-like stress check

Three smaller things found while measuring a session on a computer four times slower.

- **The estimated export size** (D37) drew a frame of the shot at up to 1920 pixels wide 0.7 s after any setting of
  the shot changed, for every pass chosen: about half a second on the heavy benchmark project, in the middle of
  work on the shot (two seconds on a slow computer). The sample is now at most 960 pixels wide, drawn when the page
  has nothing else to do, and its size is worked up by how PNGs of maps actually grow: a picture twice as wide and
  high takes about two and a half times the bytes, not four times (measured from 320 to 1920 pixels wide, every
  pass: 2.3 to 2.7 times; flat colour packs to next to nothing, outlines and names are what is left). The estimate
  for 4K was about half too high before; the figure for a quarter-size preview, given beside it, was less than half
  of what a preview takes. `e2e/workflows` now checks both within a factor of 2.5 of what is written (it was 4).
- **The border points tool** worked out the place on screen of every border point of the map in every frame, to
  draw the few hundred in view (20 ms a frame with 128,000 points). Only points inside the part of the planet in
  view are worked out now.
- **`bench/stress.ts`** compared the picture on screen with a fresh one whose geometry was prepared for exactly the
  zoom shown. The app's geometry serves from half to 1.42 times the scale it was prepared for, at that scale's
  detail (D49), so after a zoom the two pictures could show the coasts at two levels of detail, both within the
  tolerance: on a screen twice as dense a run failed on 0.17% of pixels along every coast. The fresh renderer now
  prepares its geometry for the same zoom as the app's; the two pictures are then the same to the pixel in that run
  (0.0002% at most over 250 steps).

### D68. Stepping into, out of and between changes under way draws only their areas; exports draw each frame from the one before

Found by recording what each frame of a timeline drag draws on the heavy benchmark project: whenever the moment
shown stepped into a change under way (a fade, an expansion, an advancing front), out of one at either end, or from
one to the next, the whole territory picture was drawn again (35 to 75 ms), while the frames around it drew a few
small rectangles (7 to 12 ms). A history full of animated changes is crossed like that every few frames. The picture
before was not allowed to stand in for anything because a change under way looks different at every moment.

It does stand in for everything else. The territory picture now changes from one frame to the next only (1) where
land changed hands (D56), (2) where the picture before showed a change under way, and (3) where this one does. Those
rectangles are drawn again and nothing else (`MapRenderer.render`: `patch` with the rectangles of `changesSince`,
of the frame before and of this one; D58's rectangles around changes are kept for the frame they were found for).
Dragging the timeline on the heavy project: 9 in 10 frames now take under 20 ms (62 ms before).

**Exports draw the same way.** An export's frames follow one another exactly as the frames of a drag do, and until
now each frame in which anything changed hands was drawn whole (a still camera through a long history: nearly every
frame). The export's renderer now draws each frame from the one before as well: with a still camera only the areas
above are drawn again, per pass. Exported 1080p frames of the heavy project: 190 to 114 ms a frame, 4K 485 to
276 ms, eight layers of each frame 443 to 289 ms (drawing is what an export waits for on a computer with few
processors). What is kept from the frame before is kept per picture (`patchPrev`, `animPrev` by the picture's name),
so the passes of one frame do not get in each other's way.

How exact: a picture drawn from the one before is the picture drawn afresh except for single pixels on outlines
at the edge of what was drawn again, where the browser smooths an edge a little differently when it draws part of
a shape (D67). Measured on 60 frames of the heavy project's shot in three passes (180 pictures, 171 of them drawn
from the one before): at most 0.012% of a picture's pixels differ, none by more than 15% of full contrast. That is
less than two fresh pictures of one view differ by when their geometry was prepared around different places, and
it is how frames of animated changes have been exported since D58. A camera that moves keeps nothing, as before.

Tests: `e2e/render-compare` steps into, out of and between changes in four scenes (24 steps, each drawn in part
and equal to a fresh picture), and draws an 80-frame shot through forty years as an export does, in three passes,
against frames drawn afresh (after the first frame nothing is drawn whole). Exports of the interface tests are
unchanged in what they check (identical re-export, the passes stacked give the full picture).

Also: an advancing front whose land does not touch its new owner's found the nearest point of that owner's land by
working out the direction of each of a million pairs of points afresh (100 ms the first time such a change showed):
each point's direction is now worked out once (2 ms).

### D67. Equal Earth and Natural Earth: the view keeps its middle meridian while the map is moved

Equal Earth and Natural Earth give every shape on the map another form for every middle meridian, and the view was
always laid out around the camera's own longitude. Moving such a map east or west, or zooming at the pointer, was
therefore not a shift of the picture: all of it was prepared and drawn again in every frame (today's 242 countries:
130 to 150 ms a frame, 7 frames a second; the heavy benchmark project: 140 to 210 ms; several times that on a slow
computer). A projection is chosen for a shot, so this is what framing a shot's camera in the preview cost.

While the map is being moved by hand, the view now keeps the meridian it had (`Camera.meridian`, held by `MapView`):
the map keeps its shape, the picture only shifts, and it is carried along like a map with upright meridians (D51,
D62): 6 to 12 ms a frame on the same projects. The place grabbed stays exactly under the pointer (`panCamera` reads
the new middle off the map as it is shown, instead of counting degrees per pixel, which was only roughly right on
these maps). When the pointer rests for a moment, when the button is let go, or once the map has moved further than
the prepared part of it reaches (half the width of the view, 45° at most), the view is laid out around the camera
again: the picture is then exactly the one a shot's frames and exports show, which are never held. The price is
that the map straightens a little at that moment (a few degrees of slant after dragging a third of the view far
from the equator, next to nothing close in). "While the map moves: drawn again" in Settings keeps the old
behaviour, exact in every frame. A shot that is playing is never held either.

What a held view is: a view of the same map laid out around another meridian, with the camera still in the middle
of the frame. Everything drawn on it (names, tools, what a click hits) uses that same view, so nothing lies beside
the picture. Nothing of it is stored: a held meridian never reaches a shot or the project. Tests:
`test/camera.test.ts` (every place moves by exactly the pixels dragged, the camera stays in the middle, a meridian is
ignored by the maps that do not need one); `e2e/render-compare` (two Equal Earth views carried through 170 moves
equal fresh drawings of the same held views); `e2e/workflows` (the preview of a Natural Earth shot dragged with the
mouse: carried while held, laid out afresh at rest, no meridian stored with the shot).

Also in this step: the carried-picture comparison weighs a colour by how opaque the pixel is (beyond a planet's
outline next to nothing is drawn, and the colour of nothing is no difference), and judges by how many pixels differ
at all (0.05%), how many strongly, and how many together, instead of by one count that another computer's drawing
missed by a hair (the browser smooths the same outline a little differently according to what else is in the path:
two fresh pictures of one view differ by a few dozen pixels along coasts when their geometry was prepared around
different places).

### D66. Opening a project: the database writes the snapshot, the kernel works on plain numbers

Opening the heavy benchmark project went from about 3.3 s to about 2.4 s (the map with 24,500 parcels from 3.9 s
to about 3.5 s). (1) The data service used to read every row into an object and then turn the lot into JSON (half a
second for a quarter of a million rows); the database now writes the same JSON itself (`ProjectDb.snapshotJson`,
with SQLite's `json_group_array`): the same text byte for byte on the benchmark projects, and checked against the
row-by-row snapshot in `test/storage.test.ts` with names that JSON must escape. (2) The rows just read are the
world's to keep, so they are no longer copied one by one. (3) A parcel's area (asked for every parcel when the first
picture is drawn) is summed on plain numbers instead of through three small arrays per corner, three times as fast;
`test/geo-kernel.test.ts` checks it against the earlier formula and against d3. (4) The kernel's grid of nearby
points and segments keeps lists instead of sets, and one number instead of a list for an item in a single cell.

### D65. The settle redraw waits from the end of a frame; names are placed less finely while the timeline is dragged

The sharp redraw after a movement (D51) was timed from the movement that caused the last frame. A frame that itself
took longer than the wait (110 ms) was therefore followed at once by the sharp redraw, in the middle of the
movement: on a slow computer, or in any heavy frame, everything was drawn twice. The wait now runs from the end of
the frame. While the moment shown is being dragged along the timeline, the names of countries whose land changed are
placed a twelfth as finely and drawn in size steps (as while zooming, D63), and placed properly when the dragging
rests: placing them finely for every moment passed through was a fifth of such a frame on a large map. A click on
the timeline, and the preview of a shot, place names properly at once.

### D64. Chrome's closePath is slow in proportion to the path: no path of ours is closed with it

Measured in Chrome 153 and in the Electron the app ships with (Chrome 156): each `closePath()`, on a `Path2D` and on
a canvas's own path alike, takes time in proportion to everything already in the path. A path of 1,000 rings of 20
points takes 30 ms to make instead of 1.5; one of 5,000 rings 700 ms instead of 8; 20,000 rings 11 seconds instead of
0.03. (A path given as text with `Z` is not affected.) The app made such paths in three places: every block of a
sheet and every whole shape (`blocks.ts`), the area reached by an advancing front (a rectangle and two circles for
each piece of the border it starts from, twice for every frame of the animation), and the land mask. A ring now goes
back to its first point and on to its second instead (it fills the same, and drawn as a line it has a proper corner
where it starts); the front's rectangles go back to their first corner; the land mask's rings are left for the fill
to close. `e2e/render-compare` shows the same pictures as before. On the heavy project: an exported 1080p frame 234
to 208 ms, playing a shot 110 to 97 ms a frame, dragging the timeline across a dozen events a frame 141 to 111 ms.

### D63. Zooming: one picture at the new size, names in size steps, the room around the frame drawn at rest

While zooming, the kept pictures are shown at the new size (D51). Three things made a frame of a zoom the dearest
of all movements. (1) Each part's kept picture was drawn at the new size by itself, and drawing a picture at another
size is by far the dearest way of copying it (about seven times a plain copy without a graphics card): the parts
are now laid together once, for as long as they stay as they are, and that one picture is drawn at the new size
(`MapRenderer.zoomTogether`). (2) Every name was measured and drawn at a size never seen before in every frame, and
the browser keeps the letters it has drawn by size: widths are now measured once at one size and scaled, and while
zooming names are drawn in size steps of a twelfth (exact again at rest). (3) Zooming out drew what lies around the
shrunken picture in every frame: once the view has rested a quarter of a second after moving, the room around the
kept pictures (D62) is drawn (`RenderOptions.fillAround`, asked for by the map view), so zooming out to about five
sixths of the size needs nothing drawn, nor does the first movement after a rest; and a picture that has to be
drawn afresh in the middle of a zoom-out is drawn with that room at once. Edits and steps in time do not cause the
room to be drawn again (only a new view does), so nothing runs behind the user's back while they draw.

### D62. A carried picture has room around the frame and holds the repeating map (the working view)

While the view moves, the kept pictures of the base map and of the territories (D51) used to be moved along and the
strip that came into view drawn in every frame. A strip costs about as much narrow as wide (the cost is in the number
of shapes it crosses), so the kept pictures are now larger than the frame (14% of its shorter side on every side,
48 to 192 pixels). The frame's window moves over the picture; when it reaches the edge of what the picture holds, a
strip as wide as that margin is drawn ahead of the move (`MapRenderer.slide`), and when the window runs out of buffer
the picture is moved within it. Most frames then draw nothing and copy the picture once. Anything that changes the
picture inside the frame (a patch after an edit, D54; an animating change, D58) makes the room around the frame count
as not drawn, so nothing stale can come into view.

Maps with upright meridians (equirectangular, Mercator) repeat east and west, and the planet's outline shows one turn
of that; its east and west sides stay where they are on the canvas while the map passes under them. A carried
picture therefore holds the repeating map, ended only north and south, and the sides are cut when the picture is
laid on the canvas (on a whole pixel when the frame is upright). This also mends a defect that was there before:
with the planet's ends in view, moving east or west showed the ends moving with the map until something else caused
a redraw. Exports are not touched by any of this: no picture is carried along with a moving view there, and they are cut by the outline
itself. `e2e/render-compare` moves six views by whole pixels, 170 small moves each, and compares with fresh pictures
(the two columns of pixels at the planet's sides aside); with the repeating map switched off it fails 73 times.

### D61. What the browser does with canvases (found by tracing, not by profiling the script)

A script profile shows the time inside `drawImage` but not why. A browser trace does (`bench/profile.ts` with an
output name ending in `.trace.json`, summed up by `bench/trace.mjs`). Chrome records what is drawn on a canvas and
paints it when the canvas is read; four things followed from that, each measured in `Chrome` without a graphics card:

- **A scratch buffer used twice in a frame is copied whole.** A buffer that has been drawn onto another canvas, and
  is drawn on again before that canvas has been painted, is first copied by the browser (it must keep what the first
  drawing showed): about 3 ms at the size of a window, several times that at 4K, in every frame that drew territory
  ending at the coast (fills, then borders). Each use within a frame now has a buffer of its own, up to four.
- **A canvas copied onto itself is copied twice.** Moving a kept picture goes through a spare buffer that then takes
  its place.
- **Copying part of a larger canvas is two to three times slower than copying a whole one at an offset**, so a kept
  picture larger than the frame is laid on with a negative offset, never with a source rectangle.
- **Clearing and then drawing** the first kept picture is replaced by one copy that replaces what the canvas showed.

### D60. Names: searches that end early

Finding the place for a name is a search over the territory's outline (D32). Four ways it ran long, each removed:
(1) a search that could not succeed (a large country with only a sliver in view) followed the whole outline to the
finest detail in every frame: a place where the name would be too small to draw is now not looked into, and while the
map moves a failure is remembered until the view has moved a twentieth of the frame; (2) where territory ends at the
coast, a territory lying over the sea was combed all over for a point on land: a part of the plane with no land in it
is now dropped whole (`LandMask.anyLand`, exact to the mask's cells, from sums over blocks of cells); (3) while the
map moves, the place in the part of a country in view is found a quarter as finely, and found again when the map
rests; (4) names that would overlap were found by looking through every name placed so far, now through a grid.
Places found do not change (tests compare searches with and without the short cuts), except that a search that used
to stop at its limit of steps now gets further.

### D59. Memory is limited by what is held, not by how many things

The renderer's caches (owners' outlines and borders, label pieces, shapes and places) were limited by number of
entries; one outline of a large country can hold a hundred thousand points, another a dozen. They are now limited by
the points they hold (`render-engine/kept.ts`), and the history engine keeps fewer worked-out states the more parcels
a map has. A long random session on the 24,500-parcel project used to grow by about 0.8 MB a step; memory now levels
off (about 430 MB there, 310 MB on the heavy project), measured after forced collections by `bench/stress.ts`.

### D58. Animated changes redraw only their own area; lists and the timeline keep what they drew

While a change animates, the picture of the territories is kept for the stretch of time and only the rectangles
around the animated changes are drawn again for each moment, in the working view and in exports alike (everything is
drawn when they take up most of the frame). The lists of countries, cities and events are drawn again only when what
they show changes; the timeline keeps its events as a picture and redraws only the playhead; event groups and the
country a city stands in are looked up through indexes kept until the tables change. What a tool needs besides its
button lies over the top edge of the map, so choosing a tool no longer resizes the map (a resized map was drawn again
in full, and moved under the pointer).

### D57. A verify mode, and a stress run that uses it

Everything that is now worked out from what was there before (D55, D56) can also be worked out afresh and compared:
`Engine.verify` and `MapRenderer.verify` do so after every change and stop on any difference. The interface tests
run with it on, and `bench/stress.ts` drives a long random session in the real interface with it on (strokes of every
kind, undo, jumps in time, moving and zooming, events moved and deleted), comparing the map on screen with a fresh
drawing every ten steps, on a computer made several times slower if asked. It found the two defects fixed in D55
and D56 that no hand-written test had.

### D56. The renderer is brought up to date owner by owner

A snapshot of who owns what (and each owner's outline, borders and label piece) is made from the snapshot before:
only owners of parcels that changed get new ones. One pass over an owner's parcels serves its outline, its borders
and its label. Defect found and fixed on the way: the borders kept for an owner still named the parcel across each
border, and when that parcel was split by a stroke inside the neighbouring country the border vanished at the next
full redraw; the parcel across is now looked up when the border is used.

### D55. The history engine follows edits one by one

After an edit the engine used to compile the whole history again (50 ms on the 24,500-parcel project, on every
stroke). It now follows the changes made (`Engine.follow`): changes of territory and events added, changed and
deleted, names, placements, parcels split and made whole. Countries, layers and maps coming or going still compile
everything. A state of all parcels is worked out from the state given before it: only parcels under a change made
since, or under a change between the two moments, are looked at again. The list of problems (History Health) is
worked out when asked for. `test/engine-follow.test.ts` follows random histories step by step against fresh compiles
(and is checked to catch six planted mistakes). Found by the stress run: problems of the kind "two changes at the
same moment" came out in a different order when followed than when compiled; they are now listed in a fixed order.

### D54. After an edit, only what changed is drawn again (the working view)

The kept picture of the territories is brought up to date instead of being drawn again: the kernel records, revision
by revision, the box around every border segment added, removed or moved (`Arrangement.bordersChangedSince`), and
the renderer adds the boxes of parcels with a new owner and of parcels that are new (`MapRenderer.changesSince`).
Only those rectangles are cleared and drawn (blocks keep that cheap, D50). The whole picture is drawn when anything
else changed (a colour, a layer, the view), when the changes cover half the frame, when the view shows the planet
more than once, or when the parcel that takes in the rest of the planet gained land (it has no box). Steps in time
that change little are patched the same way. `e2e/render-compare` checks patched pictures against fresh ones after
strokes and an undo. Found while testing: a change made in the instant an undo was still on its way was built on a
map about to be replaced; such a change is now held back with a short notice.

### D53. Settings for the working view only (the user, 17 November 2026)

A **Settings** button at the top opens the options for how the map is drawn while working: presets (Best looking,
Balanced, Fastest) and the single choices behind them (what happens while the map moves, country names while it moves,
sharpness, how closely outlines are followed, coastline detail close up, a drawing-time readout). They are kept in the
browser's storage for this computer (`mapmaker.viewSettings`), never in the project, and never reach an export: the
export driver makes its own renderer with `EXPORT_QUALITY`, loads the finest coasts itself and never carries pictures
from frame to frame. None of them removes a feature; they trade sharpness on screen for speed (`ui/view-settings.ts`).

### D52. Exports: frames encoded by the browser, unchanged frames copied

A frame is turned into a PNG by the browser's own encoder off the main thread (`OffscreenCanvas.convertToBlob`, about
70 ms at 4K against 700 ms for the encoder in JavaScript) while the next frame is drawn; up to four are in flight. A
frame whose pixels equal the frame before (found by hashing the pixels) is copied by the data service instead of being
encoded and sent again. The service adds the sRGB tag; checksums in the manifest are of the files as written. Videos:
a frame is drawn only once the browser has handed the sought frame over for display (`requestVideoFrameCallback`); the
"seeked" event alone came a moment too early once frames were written faster.

### D51. A picture that moves with the view (the working view)

When the view moves and nothing else changes, the base map and the territories already drawn are **carried**: a move by
whole pixels shifts the kept picture and draws only the strips that came into view (the result is the picture a fresh
drawing gives, checked in `e2e/render-compare`); a zoom, or a move by part of a pixel, shows the kept picture at its new
place or size and is allowed only while the view is moving; 110 ms after the last movement everything is drawn afresh.
Country names placed in the part of a country in view stay where they are on the map meanwhile. Exports never carry.
`MapRenderer.carry`, `RenderOptions.moving`, `lastApproximate`.

### D50. Shapes cut into blocks

Drawing a sliver of a large outline used to cost as much as drawing all of it (the browser walks every point). Land,
lakes, coastlines, each owner's territory and each owner's borders are now held in a tree of square blocks
(`render-engine/blocks.ts`), each with only the points that matter inside it: all points in the block and a margin, and
of every stretch outside it just the first and last point when the stretch stays on one side (inside the block neither
fills nor lines change; proved by `test/blocks.test.ts`). Blocks are made the first time they are drawn and drawn
clipped to their own square on whole pixels, so neighbours meet exactly. Turned views and shapes with few points are
drawn whole. This is what makes carried strips cheap, and full frames and exports faster (nothing outside the frame is
walked).

### D49. Prepared geometry ("sheets") instead of projecting every frame

The renderer no longer hands GeoJSON to d3-geo for every frame. Shapes are projected once onto a **sheet**: a window
around the view at a fixed scale, in the projection's own plane, with detail chosen by ranked point importance (borders
shared by two countries are simplified identically, so neighbours never part). A sheet serves every view inside its
window between half and 1.42 times its scale, by one transform. Per stretch of time between changes the renderer keeps
who owns what, each owner's outline (parcels dissolved into one shape), border lines and label places; the base map
and the territories are kept as pictures while they do not change. The old renderer is kept, frozen, in
`e2e/reference/` and `e2e/render-compare.e2e.ts` compares the two over 35 scenes. Also: the map is drawn before the
browser paints (not a frame later); panels follow a moving view only when it pauses (`store.notifyLive`).

### D48. Faces rebuilt only around an edit; history states shared between changes

The kernel rebuilt every face of the map after each stroke. It now rebuilds only the faces whose boundary cycles
changed (`rebuildFacesAround`; the full rebuild stays as the reference and the two are compared on random maps in
`test/kernel-faces.test.ts`). The temporal engine recompiles only when history changed (`world.historyRevision`), and
shares one state per stretch between change instants. A stroke on the map of today's 242 countries went from 1.75 s
to about 15 ms.

### D47. Names over time

A country, city or character is renamed from a date on with a dated change of kind `rename` (without an event, in the
event being recorded, or from the beginning); renaming again at the same moment replaces that name. The map, previews
and exports draw the name in force at each date; lists keep the name it was given. Deleting the thing deletes its names.

### D46. Cities and characters are sized by zoom

Their markers and names scale with the design pixels per degree at the view's centre (the same in a preview and an
export of any size): small when zoomed out, as designed at a country's scale, a little larger close up (cities 0.3-1.15,
characters 0.6-1.3 of the design size). City names smaller than 8 design pixels are left out, the dot stays. Sizes
overall per project (meta 'point_style'), in the Label style dialog.

### D45. The events box shows an event again at each of its dated changes; pen-only undo (the user, 17 November 2026)

An event can hold several border changes on different dates (choose the same event when drawing again later). The
current-events box treats each as a new moment of the event: shown again for the linger time, so a long war can show
"gains territory" at every advance without a new event each time. With the border pen tool, Ctrl+Z and Ctrl+Y take back
and put back pieces of the draft only, never changes to the project.

### D44. Flat maps cost nothing extra: a small part of a large sphere, seen in plan (the user, 17 November 2026)

The user allowed maps of cities if they do not reduce performance at all. A flat map is a square FLAT_EXTENT_DEG (5°)
either side of (0, 0) on a sphere whose radius makes it the chosen width; it is always shown with the gnomonic
projection ("flat"), where every border (a great-circle arc) is a straight line. Within 5° the plan is true to scale to
within 1%, and the fixed-point vertices keep about a millimetre of precision on a city map. The kernel, history, labels
and exports are unchanged, so nothing is slower. The map kind is `plane`; the camera is kept in plan, panning stops at
the plan's edge, the grid is in round metres or kilometres, there is no Earth geography.

### D43. Country labels and city names are placed together

One placement for both, in priority order: larger countries, smaller countries, then cities. Each takes the first free
place among a few near its own (a country label its centre, then a little above, below or to the side, keeping clear
of city dots where it can; a city name right of its dot, then left, above or below); one that finds none is hidden
(a city keeps its dot). An export pass drawn on its own places its texts as the full picture does
(`RenderOptions.layout`), so stacked passes still match.

### D42. The border eraser takes the land across, from the date being viewed

Dragging the eraser across borders: the country where the stroke starts takes the whole touching piece of land on the
other side of each border crossed (every parcel of that owner connected to it, so no border reappears further on),
from the date being viewed (as "correct this period") or in the event being recorded; starting outside any country
clears that piece. No question asked; one undo step.

### D41. Working with many things at once (the user, 17 November 2026)

Lists take Ctrl + click (add or remove) and Shift + click (a run); the Delete key and right-click menus act on
everything chosen, each as one undo step however many it changes. Countries can be put in groups (folders, table
`entity_group`, file format 4) that fold away; a group's menu hides or shows all its labels, switches its pictures off
(colours) or back on, selects or deletes its members. Pictures switched off are kept (`fill.off`). Cities are listed
under the country whose land they stand on at the date viewed. Deleting a country takes it out of history (its land
goes back to its previous holders); the desktop app has no browser prompt, so names are asked in the app's own dialog.

### D40. Cities are placements too

Cities (entities of type "City or settlement") use the same dated placements as characters (D35), but never travel:
a city is founded at a date (or "From the beginning", on the starting map), moved at once from a date, and abandoned.
They have their own section ("+ City"), share the "Characters & cities" tool, and are drawn as a white dot with a
serif name in their own layer under the country labels ("Cities", exported separately, hideable per shot).

### D39. Firm snapping: the real causes, fixed; a gentler retry instead of a refusal

The "two separated regions with one label" seen under firm snapping (D26) was not face assembly. Found by turning the
painting guard off in a randomised search over 4,500 outlines:
1. `netPath` (the net steps of a path) kept every step of a segment walked an odd number of times, so an outline that
   went back and forth along a border before closing over it counted the far side of that border as inside: the
   left-side search then flooded the planet. It now keeps exactly the net steps.
2. With firm snapping (up to about 1.4°, zoomed far out), re-routing new borders through nearby points could, after 24
   rounds, leave them crossing old borders, silently (the earlier randomised test rolled every outline back before
   looking), or split without end. New borders are now checked for crossings, splitting and path lengths are bounded,
   and an insertion that fails either is wound back (a savepoint in the kernel's change log) and retried with a quarter
   of the snapping, down to the finest; only an outline that cannot be joined cleanly even then is refused. In a
   randomised run of 1,500 outlines at snapping up to 0.03 radians none was refused; the slowest took about 0.3 s.
Proved by `kernel-incremental` (outlines kept under firm snapping, structure and validity checked after each, with undo
and redo), `geometry-worlds` (netPath; every simple loop separates faces) and the stress test. The guard (`separatesFaces`)
stays as a cheap check.

### D38. No maps of cities (the user, 17 November 2026)

The user dropped maps of cities ("forget about creating maps for cities and stuff"). Every map stays a sphere with its
own radius, so the plane version of the kernel is no longer planned for city plans. **Confirmed 17 November 2026:**
space maps (the solar system, nearby stars, the galaxy) are still wanted; they stay in the roadmap. **Later the same
day** the user allowed city maps if they cost no performance: built that way (D44).

### D37. Export: "All" alone by default; an estimated size

"All" (everything in one image sequence) is first and the only thing chosen at first; the separate layers are listed
under it, explained as exported separately. The choice is kept with each shot (`exportPasses` in its settings; absent
means "All"). Files are still written in stacking order, bottom first, with "All" last, as the compositing guide lists
them. The estimated size draws one frame from the middle of the shot for each chosen layer (at most 1920 pixels wide,
scaled up by area), compresses it as PNG and multiplies by the number of frames; the interface test compares it with a
real export (it must be within a factor of four; it is usually much closer). (Changed by D69: the sample is at most
960 pixels wide and its size is worked up by how such pictures were measured to grow; within a factor of 2.5.)

### D36. "Changes over time": comparing a country at the start and the end of a period

A selection mode for a country (in its panel): the whole country is outlined lightly; the land it gained and lost in the
period around the date being viewed is filled green and red. Periods are a day, a month, a year or several years
(aligned: decades start in years ending in 0); ◀ ▶ step through them. Gained and lost land compare the country just
before the period and at its end, so land lost and won back within the period is neither, while every change in the
period that touched its land is listed (with from and to whom). Read-only (`src/domain/history-view.ts`).

### D35. Characters are dated placements: points, never territory

A character's places are changes of kind `place` (the character, a longitude and latitude, or "leaves the map"),
dated like any other change: without an event (from the date being viewed) or in the event being recorded. No project
file change: effects already allow any kind; place changes have no layer and an empty parcel list. Between two places a
character travels steadily along the shortest path between the two dates, unless set to appear at the second date. The
Characters tool places the chosen character with a click; with Select its marker is dragged (placing it again at the
same moment moves that placement). Characters are drawn above labels, as their own export layer ("Characters"), and can
be hidden per shot.

### D34. Shots have a still camera (the user, 17 November 2026)

The user never moves the camera during a video. Dragging and zooming the preview sets the shot's one view (one undo step
per gesture); "Reset camera" gives the whole map, straight. The start and end views are gone. Shots made earlier whose
camera moves still play as made, with a note, until they are framed again. Texts and the current events box are dragged
on the preview to place them anywhere; a graphic of the user's own can be the events box itself ("wrap the box around
the graphic", chosen for new graphics: the box takes the graphic's shape at the chosen width).

### D33. Advancing front from the border; expansion; no wipe (the user, 17 November 2026)

"Advancing front" now grows a change out of the border it shares with the new owner's land as it was before the change:
the area reached is every point within a distance of that border, the distance growing with the change (drawn as the
border widened by that distance, clipped to the change). A piece that does not touch the owner's land grows from its
side facing the owner's nearest land, as a straight front. An owner with no land before grows from the middle. The circle
from where the drawing started is now called "Expansion". The straight wipe is gone; shots saved with it show the
advancing front. It is the default for shots.

### D32. "Correct this period" applies from the date drawn, without an event (the user, 17 November 2026)

Replaces the retroactive correction in the drawing prompt (D10 remains for the starting map). Drawing with "Correct this
period" changes the map from the date being viewed on, until something later changes that land, and makes no event.
Stored as a dated change with the starting map, which no list shows as an event; it wins over an event at the same
moment (it was drawn while looking at that moment). Listed with its date in the country's changes and in the starting
map's panel, where it can be removed. Adding today's countries offers it too ("from this date on, without an event").

### D31. Country labels: one per country, in its main piece, where it has the most room

Each country is labelled once (across layers too), in its main piece of territory: the largest connected part (on a
layer that ends at the coast, the part with the most land). The place is where the widest ellipse with the label's own
proportions fits inside the outline (a pole-of-inaccessibility search stretched to the text), measured in the
projection's plane and drawn mildly towards the middle; the size fits there (never more than the area suggests, nor
than the style allows). Long names may take two or three lines. Larger countries are placed first where labels collide.
Zoomed in on part of a large country, the label is placed in the part on screen. Places are cached per outline, so an
edit elsewhere keeps them; placing all 242 of today's countries takes about 0.3 s once.

### D26. The engine redesign: kept half-edges, local updates, cached cycle measurements (approved by the user)

Half-edges have stable ids (segment x 2 + direction) and the structure is kept between edits: an edit re-sorts only
the points whose edges changed and re-walks only the cycles through them; cycles are taken in the order of their
smallest half-edge, exactly as a full rebuild orders them, so faces are assigned as before. Each cycle's area and
bounding cap are measured once (any change gives a cycle a new id). Painting skips the full area comparison for an
outline that is one simple loop and separates faces (no face on both sides); otherwise the area check and winding rule
apply. `insertPaths` inserts many outlines with one rebuild. Proved by `kernel-incremental` (equal to a full rebuild
after every edit, undo and redo) and a randomised soundness test at the interface's snapping. Still global: grouping
cycles into faces (components and containment), about 0.1 s per edit on the benchmark map. Found on the way: with firm
snapping, face assembly can give two separated regions one label (guarded, to be examined); nearly overlapping borders
made crossing computation unstable and could recurse without end (fixed: a crossing is used only if it lies on both
arcs, otherwise the arcs share the nearest endpoint; split depth carries through).

### D27. Files a project uses, and border drafts, live in the project folder outside the history

Uploaded pictures and videos are stored in `assets/` named by content (the same file once) and served with byte
ranges. Border-pen drafts are `drafts.json`. Neither is in the undo history or in automatic backups (which copy the
project file); copying the project folder keeps them.

### D28. Shot transitions are applied when drawing

A shot can show border changes as recorded, animate every change, or none; restyle recorded animations; and set style
(front, fade, wipe in eight directions), timing (screen seconds through any pacing, or the event's length), easing and
the front line. History is never changed. Pictures and videos as fills, label styles and the current-events box are
likewise drawing-time looks: the preview and exports draw the same frame from the same settings.

### D29. Looks of countries are stored with the country (project file format 3)

`entity.style` (JSON) holds label overrides and fills; the general label style is the meta row `label_style`. Format 3
adds the column; opening an older file adds missing columns with defaults after a backup, and old backups and old undo
history read with defaults filled in.

### D30. Today's countries come from Natural Earth 1:50m, added in one step

242 countries (199 nations), with continents, colour groups and flags (`data/natural-earth/countries-50m.json`,
`data/flags/`). Added as the starting map or as an event, creating or reusing countries by name, one undo step. Finer
(1:10m) country shapes and sub-national boundaries are not included yet.

### D24. Maps, not worlds (the user, 16 November 2026)

The top-level category is simply **maps**: a map may be a planet, a city, the solar system or the galaxy. The interface
says "Maps", "+ Map", "New map" and "Starting map" (the state before any event). Inside the code a map is still a
`map_space` (and older notes say "world"); nothing in project files changed. Flat maps (city plans, the solar system,
the galaxy) need the plane version of the kernel, due with the space-maps stage. **Update 17 November 2026:** maps of
cities are dropped (D38).

### D23. Outlines are painted exactly as drawn, even when they cross themselves (the user, 16 November 2026)

Replaces the refusal in D17. A simple outline paints what lies on its left; an outline that crosses, folds back or
overlaps itself paints every area it goes around (non-zero winding number; the largest-area class is the outside).

### D25. Drawing flow (the user, 16 November 2026)

After drawing, "Correct this period" is preselected and Enter applies. A new change offers the event the last drawing
went into (else the selected event, else one starting at the date being viewed), so several border changes share one
event. A right-click on the map deselects. Brush points are kept as map positions, so zooming mid-stroke changes nothing.

### Answers recorded 16 November 2026

Events may belong to several groups (kept). No automatic event groups. The engine redesign (incremental kernel updates)
is approved.

### D19. The Earth basemap is reference geography, outside the parcel map

Natural Earth land, lakes and coastlines are drawn in their own pass (`land`) between the grid and the territory fills.
They are not loaded into the geometry kernel, so they cost nothing when editing and never change history. Coastline
clipping and real boundaries as parcel edges will build on the same data later. The data ships with the app (1.6 MB),
converted by `scripts/fetch-natural-earth.mjs`; `data/datasets.json` records source, version, licence and credit line.
The grid is drawn beneath the land so the export passes stack back into the full picture.

### D20. Present-day borders are a drawing guide only

They are dashed, shown only while drawing (a switch under Worlds), never in shots or exports: the film's borders are
the ones drawn in the project.

### D22. Coastline clipping happens when drawing, not in the parcel map

Territory fills (including animated changes) and borders are clipped to the land minus lakes when drawn. The parcel map
and history keep the shapes as painted, so switching clipping off for a layer (sea claims, maritime zones) loses
nothing, and a later dated coastline (sea-level change, Stage 8) will reshape countries automatically, as the approved
architecture asks. Labels of clipped layers are placed and sized from the land part only, using a 1/8-degree land mask
and a 10 × 10 grid of sample points per parcel (cached until the map changes). Still to do: areas shown in the
inspector include the sea.

### D21. Which worlds show Earth's geography

Stored per world. The first world of a new project (Earth) shows it; worlds created later show it only if "Start with
Earth's geography" is ticked; worlds saved before this setting existed show it when they have Earth's radius.

### D14. One drawing order for the full picture and the export passes

All layers' fills, then all layers' borders, then labels. Borders stay visible on top of every layer, and the export
passes stacked in Premiere reproduce the full picture (tested to within 2.6 of 255 levels).

### D15. Splitting a parcel nothing refers to keeps its identity

When a parcel that no recorded change refers to is split, its largest piece keeps its id and the other pieces become its
siblings (same parent). History is identical (proved by `test/split-identity.test.ts`); without this, every new island
drawn in open ocean relabelled every coastline in the world, inflating saves and the undo history. Parcels that history
does refer to still split into new children as before.

### D16. The undo history is stored compressed

Journal entries are deflate-compressed (`z1:` prefix). Older plain entries still read. Files are about 30 times smaller.

### D17. Every paint is checked against the area its outline encloses

The kernel computes the area enclosed by the drawn outline directly from its points and compares it with the area of the
parcels about to change. A mismatch (an outline that folds back, crosses itself or collapses when snapped) refuses the
edit and undoes its geometry. Territory edits also check that the layer belongs to the world being edited.

### D18. Damaged projects are recovered from the newest healthy backup

A project that fails its integrity check is never opened. The interface offers recovery from the newest backup that passes
its own check; the damaged files are moved into the project's `damaged` folder, never deleted.


### D7. Territory layers are painted opaque off screen, then laid onto the map once

Neighbouring parcels drawn separately at partial opacity leave hairline seams where the ocean shows through. Painting
each territory layer fully opaque into a scratch buffer and compositing it once at the layer's opacity removes the
seams, and makes fades between two owners mix colours correctly.

### D8. Events belong to the project; the user groups them (decided by the user, 16 November 2026)

All events belong to the one project. The user decides how they are grouped: by country, by world, or in groups of their
own. The timeline gets a control to choose which groups (and so which events) it shows. Maps, layers and territorial
history still belong to each world. **Built 16 November 2026:** groups are made, renamed, recoloured and deleted from
"Groups" on the timeline; an event can be in several groups (the assumption to confirm; easy to restrict if not wanted);
"Not in a group" is its own choice; the filter changes only which events are listed, never the map; a new event joins
the groups being shown. Stored in project file format 2 (tables `event_group`, `event_group_member`).

### D9. Animated changes: borders and labels follow the animation

During an advancing front, borders inside the front follow the new owners and outside it the previous owners; the
front itself is drawn as the moving border. Fades cross-fade the old and new borders. Labels move gradually, in
proportion to how far the change has progressed. Before this, an area's full outline appeared before the front reached
it, giving away the end state.

### D10. A correction with no earlier history goes into the base world

"Correct this period" on land that no event has touched edits the base world, so the territory exists from the beginning
of time. This is how a starting map is drawn.

### D11. The advancing front starts where the user started drawing

When an animation is added later from the event panel, it starts from the centre of the changed area. Moving the origin
by hand is not built yet.

### D12. A failed save pauses editing

If a change cannot be saved (usually because the console window was closed), the app stops accepting edits, says which
change was not saved, and reloads the project from disk once the service is running again. The project file is never
left out of step with what the screen shows.

### D13. Backups are restored like versions

Restoring a version or a backup is recorded as a new step, so it can be undone.
