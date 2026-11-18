# Map Maker: development record

The running record of where the software stands. Read this first at the start of every development session.
Companion files: [REQUIREMENTS.md](REQUIREMENTS.md) (checklist against the master specification) and
[DECISIONS.md](DECISIONS.md) (architectural decisions and every deviation from the approved architecture).

The approved architecture is the Claude Doc "Map Maker — Technical Architecture & Development Plan"
(https://claude.ai/artifact/2JShAV3AWt6iECtNgBTsJN). All twelve of its decisions were approved on 15 November 2026.

## Status at a glance (18 November 2026, Stages 2, 3, 4, 8 and 9 done; Stages 6 and 7 mostly done)

- **Stage 9 done** (environment and fields): Conditions, a new kind of layer: radiation, fire, smoke and ash,
  floods, destruction or heat, from sources placed with a click that rise, last and fade by themselves, round or
  carried downwind as plumes, drawn by the graphics card (D102); wildfires, lava and floods spreading over the
  real terrain (D103); disasters placed with one click from templates (D104); heatmaps worked out from points,
  and three thousand strikes drawn at 4K in about half a second (D105).

- **Stage 8 done** (terrain and fictional worlds): Earth's heights and depths ship with the app, the ice of
  Greenland and Antarctica included (D94); maps of the Earth can show terrain, drawn by the graphics card: the land
  coloured by height and the sea by depth, relief shading, the relief of the sea floor and relief over the countries,
  in two palettes, while working and in exports (D95); the sea can stand higher or lower than today's at chosen
  dates, the coasts, the land and territory that ends at the coast following it (D96); new maps can be generated
  planets, from a preset, a seed and a few sliders, with their own coasts (D97); the terrain can be sculpted with
  twelve brushes, in the base world or from a date on (D98); rivers are drawn, Natural Earth's on the Earth and worked
  out from the heights on planets (D99); a satellite look colours the land by its cover, Natural Earth's on the
  Earth and biomes worked out from climate on planets (D100); close in on the Earth, finer heights are downloaded
  as needed and kept on the computer (D101). Stage 8 is done; next, Stage 9.
- **Stages 6 and 7 mostly done**: events can take their own time on screen in presentations, out of sync with the
  clock (D92); an expansion can spread from several starting points at once, for pincers and encirclement (D91);
  each change in an event can have its own length, and recording can chain changes into a moving front (D86).
  Stage 7 (military and movement): a territory layer of occupation or control can be drawn with
  stripes, crossed stripes or dots in each owner's colour, the political map showing through (D88); countries at
  war get a front line with teeth along their shared border while the war lasts (D89); characters can be units of
  a country, in its colour, with a trail or an arrow of advance (D90); an area can be contested between two
  countries, striped in both colours (D93).
- **Fifth feedback round done** (REQUIREMENTS.md, "The user's fifth feedback round"; D80–D87). Done: the brush
  gives land to the country selected; an event's end starts at its start, and dates are chosen on a calendar or
  stepped with the arrow keys (D80); border points only where borders are (D81); flags fit every country, with pieces
  far apart given their own copy and a choice of rule for one's own countries, and today's territories (Greenland
  among them) can be added (D82); territory reaches the detailed coastline (D83); **Show…** in the top bar chooses
  what the map shows while working and in exports, and the smallest lake shown (D84); characters can be shown by
  one of 46 icons (ships, aircraft, land forces, military signs, people and places) or a picture of one's own,
  facing the way they travel (D85); each change in an event can take its own time, and while recording each change
  happens at once, spreads until the next one recorded, until the event ends, or over a set time (D86); countries
  and groups can be locked so their land and borders stay as they are (D87).
- **Animated areas, lines and points** (Stage 6, D79): in an event with a length, a line draws itself (its arrowhead
  travelling), an area grows from its middle, a shape fades in; a new shape fades the old one out.
- **Stage 2 (parcel map and territory editing) done**: the **Regions** tool (D78) picks today's states and provinces
  (4,596, Natural Earth admin-1) or today's countries on the map, by clicks or a box, and gives them to an existing or
  new country, from the date viewed, as a correction or in an event.
- **Stage 3 (time and events) done**: dated border-point moves (D77): a border point dragged can be moved from the
  date viewed on (the sliver between changes hands then) instead of for all time.
- **Split and merge** (Stage 2, D76): the **Split** tool draws a line across a country and gives the part clicked to a
  new or existing country; "Merge into one…" on the menu of chosen countries joins their land into one of them or a
  new country. Both from the date viewed, as a correction, or in an event; one undo step.
- **Event types** (Stage 3, D75): "Event types…" makes, copies, renames, recolours and deletes types; a type gives
  its events a colour on the timeline and in the lists, a usual way for their territory to spread and a usual length.
- **Comparing two dates** (Stage 3, D74): "Compare" in the date bar shows another date to the right of a line
  across the map, dragged sideways; it starts as the day before the last change, "⇄" swaps the dates.

- **Stage 4 (layers, entities and lore) done** (D71–D73). Areas, lines and points (D71): "+ Layer" makes a layer of
  territory, areas, lines or points; the **Areas, lines & points** tool draws claims and zones, front lines (with
  teeth), roads and arrows, battles and other sites, freehand or click by click; each exists from a date (or always,
  or with an event), can take a new shape from a later date and can end; they overlap freely and never change who
  holds the land; they have their own look, list, panel and export pass. **Relationships** (D72): at war, allied,
  part of, vassal of, member of, leads, successor of, travels with; each holds over periods begun and ended at dates
  or by events, shown from either side in the panel of every country, character and city. **Search** in the top bar
  (Ctrl+F): names, former names, notes; a result is chosen and the date and view brought to it. **Export data**:
  the map at a date as GeoJSON (for QGIS and the like) and events, countries, relationships and features as CSV.
  **Pictures** kept with the notes of anything. Project file format 6.

- **Second optimisation stage done** (the user's request to keep optimising the whole workflow and to stress test it
  for massive projects on a slower computer; D55–D70; REQUIREMENTS.md, "The user's second optimisation request").
  Against the build before it, on the same benchmark projects: moving the map 14–34 ms a frame to 5–9 ms (18 ms
  where a thousand names are on screen; 170–240 ms to 5–11 ms in Equal Earth); zooming about half; a brush stroke 72–85 ms to 29–37 ms (188 to 120 ms on
  the 24,500-parcel map); dragging the timeline a year a frame 33 to 13 ms on the heavy project; exported frames of
  the heavy project in half the time (1080p 264 to 127 ms, 4K 545 to 269 ms); opening 2.9–5.9 s to 1.9–3.5 s;
  memory level in long sessions. On a computer made four times slower, a session of 150 random steps on the heavy
  project takes 62 s instead of 113 s: a stroke 344 to 159 ms, moving the map 148 to 56 ms a frame, dragging the
  timeline 150 to 77 ms a frame. How: history, snapshots, borders and names are brought up to date from what was
  there before instead of worked out again (D55, D56, D60); kept pictures have room around the frame, hold the
  repeating map and are shown as one picture while zooming (D62, D63, D70); a picture changes from one frame to the
  next only where land changed hands or a change is under way, in the working view and in exports alike (D58, D68);
  the browser's hidden costs with canvases and paths are avoided (D61, D64); the database writes the snapshot when a
  project opens (D66); Equal Earth and Natural Earth keep their middle meridian while the map is moved (D67). A
  verify mode and a random stress run check all of it (D57). **Six defects found and fixed on the way**: borders
  between countries could vanish after drawing inside a country (D56); moving east or west with the planet's ends
  in view showed a wrong picture (D62); the sharp redraw could fall in the middle of a slow movement and draw
  everything twice (D65); problems in History Health could be listed in a different order after an edit than after
  reopening (D55); memory grew in long sessions on large maps (D59); the estimated size of a 4K export was half too
  high and that of a preview less than half of the truth (D69). Three failures of the Windows run were the tests'
  own (a window's size, a limit missed by a hair, a screenshot the browser could not give at once).

- **Optimisation stage done** (the user's request to optimise everything before adding more detail; D48–D54, and the
  table in REQUIREMENTS.md, "The user's optimisation request"). On the map of today's 242 countries with detailed
  coasts: a frame that changes nothing went from 249 ms to 11 ms, moving the map from 325–3,100 ms to about 20 ms,
  scrubbing time from 224 ms to 8 ms, a brush stroke from 0.7 s to about 40 ms, an exported 1080p frame from 730 ms
  to about 90 ms. How: faces rebuilt only around an edit; history states shared between changes; shapes projected once onto
  "sheets" and drawn by one transform; shapes cut into blocks so only the part being drawn is walked; the picture
  carried along while the view moves; after an edit only the changed area drawn again; panels that follow the view
  only when it pauses; frames encoded by the browser and unchanged frames copied. A **Settings** button (top right) holds the working view's speed options; exports
  never depend on them (D48–D54). Four defects found on the way are fixed: a quick drag of a city or border point could be
  ignored (it counted mouse movements, not distance); a video fill could miss its first exported frame; the map was
  drawn a frame late; a change made in the instant an undo was arriving could spoil the map in memory.

- **Fourth round done** (D45–D47): the events box shows an event again at each of its dated changes; Ctrl+Z/Ctrl+Y with
  the border pen touch the draft only; city and character markers and names scale with the zoom (sizes adjustable);
  names over time for countries, cities and characters. Commercial sale was considered and dropped by the user.

- **Third feedback round done** (REQUIREMENTS.md, "The user's third feedback round"; D41–D44): deleted countries no
  longer leave grey land and borders; "+ Layer" works in the desktop app; Ctrl/Shift to choose several, right-click
  menus, groups of countries that fold away, many events or countries deleted at once (one undo); cities listed under
  their country; labels and city names move apart or the less important is hidden; a border eraser; flat maps (a city,
  a region) at no performance cost. Project file format 4.
- **Also done since the second round:** firm-snapping defects in the kernel fixed (D39); cities (D40); characters'
  routes in shots.

- **The user's second feedback round is done** (fourth session, 17 November; every item with its evidence is in
  REQUIREMENTS.md, "The user's second feedback round"; decisions D31–D38): labels placed where each country has room,
  every large country labelled (one label per country, long names on two or three lines); today's countries can be
  added into a country of your own; **characters** are points that travel between dated places (their own tool, panel and
  export layer); **"Correct this period"** applies from the date drawn without an event; **"Changes over time"** shows a
  country's gains and losses in a day, month, year or several years; shots have a **still camera** with "Reset camera";
  the **advancing front** grows out of the existing border (the old one is now "Expansion"; the wipe is gone); texts and
  the events box are **dragged** on the preview; a graphic can **be** the events box; export chooses only **"All"** at
  first and shows an **estimated size**. Maps of cities are dropped (D38).
- **Checks run in their own checkout.** `checkwt` style: each commit is checked in a separate git worktree, so editing
  can carry on while the interface tests run (a test script edited mid-run once made a check meaningless).

- **The user's first feedback round is done** (third session, 16 November; every item with its evidence is in
  REQUIREMENTS.md, "The user's first feedback round"): zoom-proof brush strokes; 1:10m coasts; "maps", not "worlds";
  today's 242 countries added in one step; label styles for all countries and per country; picture, flag and video
  fills; outlines that cross themselves painted as drawn; the border pen with drafts kept across sessions; the
  'left_face' crash fixed; correction preselected and Enter to apply; right-click deselects; several border changes
  in one event; a current-events box for shots; shot transitions (as recorded, every change, or none; style, timing,
  easing, front line); the shot panel in groups with a chosen export folder, 'Export' and 'All'.
- **Engine redesign (approved by the user) done in three steps** (D26): strokes on the 24,500-parcel benchmark map
  went from 1.75 s to about 0.4 s. Two kernel defects were found along the way and fixed: nearly overlapping borders
  (real data) could recurse without end, and with firm snapping two separated regions could carry one face label
  (now guarded; the face assembly itself should still be examined, see Known bugs).

- **Earth basemap done (second session, 16 November).** Natural Earth land, lakes and coastlines are drawn under the
  territories, with present-day borders as an optional drawing guide; a "Data sources and credits" dialog; exports carry
  the credit lines. Package installs and downloads now work in development sessions, and the code is on GitHub
  (`naregdemirjian/MapMaker`), so D1–D4 can now be reversed.
- **Testing and refinement stage done.** 84 automated tests and two interface tests (24 steps in Chrome) pass. The stage
  found and fixed 11 defects, including two that could damage history or geometry (an outline enclosing no area could
  repaint the whole world; territory commands accepted a layer from another world) and one that made separate export
  passes disagree with the full picture.
- **Performance.** Project files are about 30 times smaller and saves 30 times faster than in 0.1.0; recompiling history
  after an edit is 16 times faster. On very large maps (tens of thousands of parcels) drawing and rendering are still
  slow: see "Performance" below.
- **Roadmap position.** Stages 1 and 3 mostly done; 0 and 2 partly done; parts of 4, 5 and 6 built early. Stages 7–13
  (military, terrain, environment, heatmaps, space maps…) not started. `REQUIREMENTS.md` classifies every requirement.
- **Desktop app and Windows installer (D2 reversed).** Electron shell hosting the same service; NSIS installer built
  and every test run on Windows by GitHub Actions ("Windows build and tests"). The first Windows run found one real
  Windows bug (a damaged file left open, blocking recovery), now fixed; since then everything passes on Windows.
- **Event groups (D8).** Groups made on the timeline; an event can be in several; the timeline and events list show
  the chosen groups. First project-file upgrade (format 1 to 2), with a backup before upgrading.
- **Coastline clipping done.** Territory painted loosely over the sea ends at the coast (per-layer switch), lakes stay
  water, labels stay on land.
- **Biggest open issues.** (1) D1 (Canvas renderer instead of deck.gl) still to reverse; D2 and D4 are reversed.
  (2) Space maps are still to build (D38). The firm-snapping defects are fixed (D39).

## How to run it

On the user's Windows PC: install `Map Maker Setup <version>.exe`, downloaded from the latest "Windows build and tests"
run on GitHub (Actions tab, Artifacts). Or, without installing: install Node.js LTS (22.13 or newer) once, then
double-click `Start Map Maker.bat`; the browser opens on the app. Either way projects are stored in
`Documents\Map Maker Projects\<name>.mapmaker\`.

For development (Linux or Windows, Node 22.18 or newer):

| Command | What it does |
| --- | --- |
| `node scripts/build.mjs` | Builds `dist/server.mjs` (the data service), `dist/desktop/main.mjs` (the desktop app) and `dist/ui/` (the interface) |
| `npx electron .` (Linux without a screen: `xvfb-run -a npx electron --no-sandbox .`) | Runs the desktop app (build first) |
| `npm run dist:win` | Builds the Windows installer into `release/` (on Windows; on Linux it needs Wine) |
| `xvfb-run -a node --disable-warning=ExperimentalWarning e2e/desktop.e2e.ts` | The 5-step desktop app test (build first) |
| `node --disable-warning=ExperimentalWarning dist/server.mjs --port 4317 --projects <folder> [--open]` | Runs the app |
| `sh scripts/check-all.sh` | Every check: type check, unit tests, build, the four interface tests |
| `npm test` | 235 unit, randomised and scenario tests |
| `node --disable-warning=ExperimentalWarning e2e/render-compare.e2e.ts` | The renderer against the old one kept in `e2e/reference/` (35 scenes); carried, patched and animated pictures against fresh ones (build first; `VERBOSE=1` lists every case) |
| `node --disable-warning=ExperimentalWarning bench/make-fixtures.ts <folder> [massive]` | Makes the benchmark projects: "Bench Earth 242", "Bench Heavy", "Bench Random 1000" (minutes); with `massive`, one with 3,000 border changes as well. The benchmarks and tools below work on throwaway copies of them |
| `node --disable-warning=ExperimentalWarning bench/render.bench.ts <folder> ["<project>"...] [--only a,b] [--label x] [--out file]` | Frame times in Chrome for each scenario (idle, pans at five zooms, zoom, scrub, stroke, play, exports); build first |
| `node --disable-warning=ExperimentalWarning bench/edit.bench.ts <folder>` | Kernel and engine times for edits, without a browser |
| `node --disable-warning=ExperimentalWarning bench/profile.ts <folder> "<project>" <scenario> out.cpuprofile`, then `node bench/top.mjs out.cpuprofile` | Where the script's time goes in one scenario (idle, select, panWorld, panRegion, panDeep, zoomIn, zoomOut, scrub, scrubSmall, stroke, play, playMoving) |
| the same with an output name ending in `.trace.json`, then `node bench/trace.mjs out.trace.json 25` | What the browser does around the script (painting canvases, layers, presenting), per thread: what a script profile does not show (D61) |
| `node --disable-warning=ExperimentalWarning bench/open.ts <folder> "<project>" out.cpuprofile` | How long opening a project takes, and a profile of it |
| `node --disable-warning=ExperimentalWarning bench/stress.ts <folder> "<project>" [--steps 400] [--seed 1] [--throttle 4] [--scale 2] [--preset fastest\|best] [--no-verify]` | A long random session in the real interface with every result checked against one worked out afresh and the map compared with a fresh drawing (D57); `--throttle` makes the computer that many times slower, `--scale` the screen that many times denser. Reports frame times, time per kind of action and memory |
| `MAPMAKER_E2E_VIEWPORT=1500x900 node ... e2e/vertical-slice.e2e.ts` (or `workflows`) | The interface tests in a window of another size (no step may depend on where things fall on screen) |
| `node --disable-warning=ExperimentalWarning test/geo-kernel.stress.ts <seeds> <rings>` | Long randomised kernel run |
| `node --disable-warning=ExperimentalWarning e2e/vertical-slice.e2e.ts` | The 23-step interface test in Chrome (build first); screenshots in `e2e/output/` |
| `node --disable-warning=ExperimentalWarning e2e/workflows.e2e.ts` | The 36-step workflow and export-inspection test; screenshots in `e2e/output/workflows/` |
| `node --disable-warning=ExperimentalWarning test/perf.bench.ts 100 300 1000 [--keep <folder>]` | Performance benchmark (minutes at 1000) |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | Type check (must report nothing) |

Run `npm install` once per fresh checkout. (Offline sessions without package installs could use
`scripts/link-local-packages.sh` to link preinstalled packages; no longer needed.)

Map data: `data/natural-earth/ne-110m.json` and `ne-50m.json` are committed, so nothing is downloaded at run time.
`node scripts/fetch-natural-earth.mjs` re-downloads Natural Earth and regenerates them and `data/datasets.json`.

TypeScript runs directly under Node's type stripping: imports carry `.ts` extensions, type-only imports use
`import type`, and enums or constructor parameter properties are not allowed.

Terminology: the interface calls them **maps** (DECISIONS D24); the code and older notes say map space or world.

## Code map

| Folder | Role | Key facts |
| --- | --- | --- |
| `src/core-time/` | Instants and calendars | An instant is (whole days since 1970, milliseconds in the day): exact to the millisecond across ±24 trillion years. Proleptic Gregorian calendar with astronomical years (year 0 = 1 BCE). |
| `src/geo-kernel/` | The parcel map on a sphere | One planar subdivision per world: fixed-point vertices (1e-7 degree), exact orientation predicates, snapping and noding, parcel lineage (a split parcel becomes the parent of its pieces, which inherit its history), point location, validated vertex moves. Poles and the 180° line need no special cases. |
| `src/world-model/` | Tables and the in-memory world | Every row type, the diff format (`before`/`after` per row) used for saving and undo, and transactions. |
| `src/temporal-engine/` | Reconstructs history | Compiles events into per-parcel timelines; answers "who holds this place at time t" exactly, including mid-transition; detects simultaneous, overlapping, stale and broken changes. Caches are rebuilt from the tables and never saved. |
| `src/domain/commands.ts` | Every user action | Each command returns its row diffs, which become one undo step. |
| `src/desktop/` | Desktop app | Electron main process: hosts the data service in-process and opens the interface in its own window. |
| `src/server/` | Local data service | SQLite project file (WAL, full sync, integrity check on open), journal for undo and redo, versions, rolling backups, export writer, HTTP bound to this computer only. |
| `src/render-engine/` | Drawing the map | Camera and projections (d3-geo), the map renderer (fills, borders, labels, transitions), the Earth basemap (`basemap.ts`: decoding, choice of detail), stroke processing for the freehand brush. |
| `src/render-engine/plane.ts` | Sheets (D49) | The projections' own formulas; rings with ranked points; a `Sheet` holds shapes projected once for a window around the view and places them on any view inside it by one transform. |
| `src/render-engine/parcel-geometry.ts` | Parcel outlines | Each boundary cycle as longitude/latitude with point importance shared between neighbours; `dissolve` joins an owner's parcels into one outline. |
| `src/render-engine/blocks.ts` | Blocks (D50) | `BlockPath`: shapes held in a tree of square blocks, so drawing part of the view only walks the points there. No path is closed with `closePath` (D64). |
| `src/render-engine/map-renderer.ts` | The frame | `render` draws a frame; `layered` keeps the base map and the territories as pictures: kept, patched after an edit (D54), renewed where a change animates (D58), moved with the view with room around the frame (`slide`, D62), shown at another size while zooming (`zoomTogether`, D63). `verify` works snapshots out both ways (D57). |
| `src/render-engine/kept.ts` | Caches by weight (D59) | A cache limited by how much its entries hold, not by how many there are. |
| `src/temporal-engine/engine.ts` | History, kept up to date (D55) | `follow` applies the changes made since the last question instead of compiling everything; states of all parcels are derived from the state before; `Engine.verify` compares with a fresh compile. |
| `src/ui/view-settings.ts`, `components/Settings.tsx` | Working-view settings (D53) | Presets and single options, kept in the browser, applied by `store.setViewSettings` and `MapView`; never read by exports. |
| `bench/` | Measuring | Benchmark projects, frame-time and edit benchmarks, script profiles and browser traces, opening, and the stress run (see the commands above). |
| `data/` | Shipped map data | Natural Earth basemap files and `datasets.json` (source, version, licence, credit of every dataset); copied to `dist/ui/data/` by the build. |
| `src/presentation/` | Shots and export | Shot settings (time remap, camera keys, overlays) and the export driver that renders frames off screen at the exact output size. |
| `src/export/` | Files on disk | PNG encoder, export folders, `manifest.json`, `COMPOSITING_GUIDE.txt`. |
| `src/ui/` | The interface | React. `store.ts` holds the session state and saves every command; components for the map, timeline, panels, dialogs and presentation mode. |
| `src/domain/countries.ts` | Today's countries | Decoding `countries-50m.json`; colour groups. The command is `addCountries` in commands.ts. |
| `src/export/tiff.ts` | TIFF files (D109) | 8-bit RGBA with straight alpha in strips, uncompressed or Deflate; encoded in the browser during exports (`export-driver.ts` runExport), written by `writer.ts` writeEncodedTiff. |
| `src/space/` | Space maps (D110, D111) | `catalogue.ts` the nearby stars (`data/stars/nearby-50ly.json`, made by `scripts/fetch-stars.mjs` from HYG v4.1), their colours and kinds; `space-view.ts` the camera circling a point; `space-renderer.ts` the drawing (far stars, rings, stars, drop lines, realms, lanes, names); `realms.ts` who holds which star and which lanes are open at a moment; `solar.ts` the planets' orbits and where they are on a date; `invented.ts` invented stars from a seed; `scene.ts` what a space map shows at a moment. Shown by `ui/components/SpaceView.tsx`, a star's panel `Stars.tsx`; held stars are changes of kind `system` (`commands.ts` holdStars, compiled by the engine's `systemsAt`). |
| `src/presentation/looks.ts` | Looks for shots (D108) | The presets and their colours, the grade, darker edges and paper laid over a finished frame (`finishLook`), and what the renderer is given (`export-driver.ts` lookStyles). |
| `src/presentation/events-box.ts` | Current events box | Which events show at a frame (with fades) and how the box is drawn. |
| `src/render-engine/label-style.ts`, `assets.ts` | Looks | Label styles (general, per country); pictures and videos (loaded once; exports preload pictures and seek videos per frame on their own elements). |
| `src/server/assets.ts` | Project files | Uploaded pictures and videos in the project's `assets` folder, named by content, served with byte ranges. Border drafts are `drafts.json` in the project folder. |
| `data/flags/` | Flags | 237 SVG flags (flag-icons, MIT): 197 nations and 40 territories, and `index.json`. |
| `src/render-engine/label-place.ts` | Label places | Where a country's label has the most room (stretched pole of inaccessibility in the projection's plane), line breaking for long names (D31). |
| `src/domain/history-view.ts` | Changes over time | Periods (day, month, year, several years) and a country's gains, losses and changes in one (D36); shown by `ui/components/CountryHistory.tsx`. |
| `src/domain/search.ts`, `data-export.ts`, `ui/components/Search.tsx`, `Pictures.tsx` | Search, data export, pictures (D73) | Search over names, former names and notes; the map at a date as GeoJSON and the record as CSV (written by the data service's `data-export` route); pictures with notes (`commands.ts` setPictures). |
| `src/domain/regions.ts`, `ui/components/Regions.tsx`, `scripts/fetch-regions.mjs` | Region picker (D78) | Regions of today by level, found by a point or a box; the Regions tool's bar and its "Give" question; the converter of Natural Earth's states and provinces. |
| `ui/components/SplitMerge.tsx` (and `commands.ts` splitTerritory, mergeTerritory) | Split and merge (D76) | The Split tool's question, the "Merge into one" dialog, and the choice of when a change holds that both use. |
| `src/world-model/world-settings.ts` (`show`, `shown`, `minLakeKm2`), `ui/components/ShowDialog.tsx` | What is shown (D84) | Each map's list of what it shows while working and in exports and its smallest lake; the "What is shown" dialog. Lakes are judged whole in `basemap.ts` (`lakeSizes`). |
| `commands.ts` (isLocked, setLocked, withoutLocked) | Locked countries (D87) | A lock in the country's style; territory edits leave out what locked countries hold at the edit's moment and refuse to change them otherwise; the store names what was left out. |
| `ui/record-length.ts`, `ui/components/RecordLength.tsx` (and `commands.ts` setEffectLength, chainRecorded) | How long changes take (D86) | The recording bar's choice (kept on this computer) and the transition it gives; the length of each change in an event's panel. The engine's `transitionEnd` gives a change's end. |
| `src/render-engine/icons.ts`, `ui/components/CharacterIcons.tsx` | Character icons (D85) | The icon set (shapes on a 64 by 64 grid, how each turns), drawing an icon; a character's icon setting (`CharacterIcon` in its style) and its section of the panel. Drawn by `MapRenderer.drawCharacterIcon`, facing `CharacterAt.ahead`. |
| `ui/components/DatePicker.tsx`, `src/core-time/steps.ts` | Dates (D80) | The calendar of a date field; stepping a date by days, months and years. |
| `src/render-engine/fill-clusters.ts` | Pictures over countries in pieces (D82) | Which pieces share a copy of a picture; how a picture is fitted. |
| `src/domain/event-types.ts`, `ui/components/EventTypes.tsx` | Event types (D75) | A type's colour, usual way of spreading and usual length, kept in the `fields` of its row; the "Event types" dialog, the type chooser and its colour square. |
| `src/domain/relations.ts`, `ui/components/Relations.tsx` | Relationships (D72) | Kinds and how each reads from either side; periods are changes of kind `relate` (`commands.ts` relate, endRelation, resumeRelation), compiled by the engine (`relationHolds`, `relationPeriods`). |
| `src/render-engine/routes.ts` | Routes (D106) | A line as a campaign arrow (smoothed, tapered body, head at its end) and marks flowing along a line; drawn by `MapRenderer.drawFeatureShape` and `drawFlow` with the shot's clock. |
| `src/render-engine/feature-style.ts` | Features (D71) | Areas, lines and points: their looks (kind defaults, layer, own). Shapes are changes of kind `shape` (`commands.ts` createFeature, reshapeFeature, endFeature), compiled by the engine (`featuresAt`, `featureHistory`), drawn in the `features` pass (`MapRenderer.drawFeatures`, `featureAt` for the pointer). |
| Characters | Points over time | Placements are effects of kind `place` (`commands.ts` placeCharacter, characterLeaves); the engine compiles them into tracks (`charactersAt`, `characterTrack`); drawn in the `characters` pass; panel in `ui/components/Characters.tsx` (D35). |
| `test/`, `e2e/` | Tests | See "Tests" below. |

How an edit flows: a command changes the in-memory world and returns diffs → the interface redraws at once → the diffs
are sent to the data service, which checks them against the stored rows and writes them in one transaction (or refuses
if the project changed underneath) → the journal entry is the undo step.

## Roadmap position

The approved roadmap has 14 stages (0–13). Where each stands (brought up to date 18 November 2026):

| Stage | Status | Done | Still to do |
| --- | --- | --- | --- |
| 0 Groundwork | Mostly done | Sphere-safe kernel, two-part time, SQLite storage, transparent PNG export, pannable/zoomable/rotatable map, Natural Earth basemap, Electron shell, Windows installer built automatically, reference-image render tests (`e2e/render-compare`) | Installer test on the user's PC |
| 1 Project, storage, world model | Done | Projects, schema with upgrades (format 5; every upgrade tested), undo journal, autosave, versions, backups with restore, crash safety, multiple maps, entities with names, colours, notes; event groups (D8); groups of countries; outliner and inspector | Automatic groups (by world, by country) if wanted |
| 2 Parcel map and territory editing | Done | Production kernel (faces rebuilt around an edit), territory brush, precise shape tool, border pen with drafts, border points (move, add, remove), border eraser, split along a line and merge (D76), region picker of today's countries and states (D78), snapping, smoothing, irregularity, political fills, derived borders, labels, coastline clipping, today's countries in one step, flat maps | Sub-national boundaries as permanent parcel edges if wanted (the region picker puts them in where used, D78) |
| 3 Time and event engine | Done | Instants, Gregorian calendar, events, effects with intention, compiler followed change by change, any-date reconstruction, zoomable timeline, edit prompt, record mode, History Health, precedence and overlap rules, alternative versions, names over time, changes over time, comparing two dates, event types as templates, dated border-point moves (D77) | Fictional calendars (Stage 13) |
| 4 Layers, entities, lore | Done | Territory layers; area, line and point layers with lifespans and dated shapes, their tool, list and panel (D71); dated relationships (D72); search, GeoJSON and CSV export, notes with pictures (D73); cities with lifespans, characters, alternative versions of events | Layer families across maps |
| 5 First shots and export | Mostly done | Shots, time remap, still camera, date, title and current-events overlays, PNG sequences with passes and transparency up to 8K at every listed frame rate, preview, manifest, compositing guide, deterministic output | Multi-key camera, styles, version-pinned shots, the Premiere checklist on the user's PC |
| 6 Transitions | Mostly done | Advancing front, expansion and fade; borders and labels follow the animation; shot-level transition settings; animated areas, lines and points (D79); lengths of each change (D86); expansions from several starting points, for pincers and encirclement (D91); events taking their own time on screen, out of sync with the clock (D92). Keyframed fronts: a front placed at dates is recorded as changes that each spread "until the next one" as an advancing front (D86) | Arrival-time fields that follow terrain (fronts slowed by mountains and water), with Stage 8 |
| 7 Military and movement | Mostly done | Occupied territory drawn with stripes, crossed stripes or dots over the political map (D88); front lines between countries at war (D89); units of a country with trails or arrows of advance (D90); contested areas in both claimants' stripes (D93); characters with icons that face the way they travel (D85) | Bases and supply lines as their own kinds, if wanted (units that stay put and lines with arrows cover them today) |
| 8 Terrain and fictional worlds | Done | Earth's elevation with the sea floor and the ice sheets (D94); terrain colours and relief drawn by the graphics card, over the countries too, in the working view and exports (D95); sea level over time, with coasts, land and territory following it (D96); generated planets (D97); sculpting with twelve brushes, in the base world or dated (D98); rivers on the Earth and on planets (D99); the satellite look, with Earth's land cover and planets' biomes (D100); finer heights close in, downloaded as needed (D101) | Land cover finer than 10 km; terrain-aware drawing (Stage 12) |
| 9 Environment and fields | Done | Conditions: field layers of radiation, fire, smoke, floods, destruction and heat, their sources rising, lasting and fading, circles and plumes, drawn by the graphics card (D102); fires, lava and floods spreading over the terrain (D103); disasters from templates in one click (D104); heatmaps from points, three thousand strikes at 4K (D105) | Raster and numerical layers from files; arrival-time fronts slowed by terrain |
| 10 Presentation polish | Mostly done | Routes: campaign arrows and lines that flow (D106); text boxes and callouts (D107); looks for shots (D108); TIFF sequences (D109) | SVG (left for later, D109); camera paths dropped (the camera stays still, D34) |
| 11 Space maps | In progress | The 982 stars within 50 light-years in three dimensions, with their names, kinds and systems (D110); stars held by countries and factions over time, drawn as realms (D111); lanes between stars, expeditions and fleets (D112); the solar system on any date (D113); invented star maps, stars found by search (D114) | Moons, the Milky Way and galaxies |
| 12–13 | Not started | | Smart brushes, branches and calendars |

## Tests

All pass as of 18 November 2026 (328 unit and randomised tests in 62 files, 23 + 52 + 6 + 5 interface steps). The
interface tests run with the verify mode on (D57): everything the app works out from what was there before is also
worked out afresh, and any difference stops the test.
`sh scripts/check-all.sh` runs everything and prints ALL CHECKS PASSED only when every check passed.

| Suite | Count | What it proves |
| --- | --- | --- |
| `test/core-time.test.ts` | 8 | Known Gregorian dates; calendar round trips across trillions of years; exact arithmetic; parsing and formatting |
| `test/geo-kernel.test.ts` | 13 | Predicates; parcels across the poles and the 180° line; nested islands; snapping; randomised point location against d3; rollback; vertex edits never break validity; a parcel's area summed on plain numbers against the earlier formula and d3 |
| `test/geo-kernel.stress.ts` | CLI | 12 seeds × 50 random rings with full validation after each (0 refusals) |
| `test/temporal-engine.test.ts` | 18 | Editing events never changes earlier history; compiled timelines equal a naive replay; simultaneous and overlapping events; stale intentions; broken references; corrections; variants; undo; when the last change began (comparing dates) |
| `test/event-types.test.ts` | 3 | Event types made, copied, renamed, recoloured, given a way of spreading and a usual length (days, months to the end of a shorter month, years, before the year 1); deleted (their events become plain events), undone, reloaded |
| `test/fill-clusters.test.ts` | 4 | Pictures over countries in several pieces (D82): boxes and gaps across the 180th meridian; today's France (6 copies), Spain (2), Russia (1, placed by its mainland), the USA (3), archipelagos as one; the rules to choose from; the fits (cover, fill, contain, stretch) |
| `test/split-merge.test.ts` | 5 | A line across a country: the part clicked to a new country from a date (verify mode), to an existing one in a new event (moved with it), as a correction of the starting map; refused when the line stops inside (and taken back), on the sea, or to its own country; merging into one of them or a new country in an event; one undo step each; a border point moved from a date (either way, in an event, verify mode), junctions and moves across a third country refused; border points shown only on borders at the date (D81) |
| `test/regions.test.ts` | 2 | Today's 4,596 states and provinces found by a point (Berlin, an enclave of Brandenburg; New York; Fiji by the 180th meridian; the sea); anchors inside their regions; today's countries the same way; Brandenburg and Berlin given to two owners meet exactly (areas within 0.2%, no unowned sample along their border) |
| `test/scenarios.test.ts` | 9 | A region's history (secession, partition, insertion, deletion, moving events); order independence; simultaneous and overlapping events with durations; seconds and millennia apart; advancing fronts from minutes to years; occupation on its own layer; edits never corrupt unrelated data; formation, fragmentation, collapse |
| `test/geometry-worlds.test.ts` | 7 | Degenerate and self-crossing outlines refused cleanly; poles, the 180° line, more than a hemisphere, 20-metre shapes; splitting and merging; 1 cm precision after reopening; independent worlds of different sizes; undo per world |
| `test/storage.test.ts` | 8 | Reopening; the snapshot the database writes as text against the row-by-row one; undo and redo across reopening; atomic saves; process killed mid-save; versions and backups; PNG round trip; export folders |
| `test/recovery.test.ts` | 7 | Three kinds of file damage refused then recovered; damaged backups skipped; no usable backup; malformed rows; 120-step undo/redo compared state by state; old uncompressed history |
| `test/split-identity.test.ts` | 7 | The split-identity optimisation leaves history identical (6 random histories, with and without) and stops coastline relabelling |
| `test/stroke.test.ts` | 7 | Freehand outlines: closed, open, figure-eight, tiny, orientation, reproducible irregularity |
| `test/camera.test.ts` | 8 | Screen/map round trips in every projection, rotation and zoom 0–14; zoom keeps the cursor point fixed; city-level precision; panning across 180°; a view that holds its middle meridian (Equal Earth, Natural Earth): the camera stays in the middle, every place moves by exactly the pixels dragged |
| `test/kernel-incremental.test.ts` | 8 | The kept half-edge structure equals a full rebuild after every kind of edit, undo and redo (4 seeds x 70 steps); nearly overlapping borders; outlines kept under firm snapping, valid with no crossing borders after each (3 seeds x 60) |
| `test/countries.test.ts` | 4 | Today's countries: holes, overseas parts, across 180°, all 242 at once as an event (about 5 s), one undo; land added into the user's own country |
| `test/label-style.test.ts` | 3 | Label styles: layering, clamping, text, commands with undo |
| `test/fills.test.ts` | 3 | Video timing; fill commands with undo; the 197 flags and their credit |
| `test/events-box.test.ts` | 2 | Current events: started and not ended, lingering, alternatives, groups, fades, limits |
| `test/sequence.test.ts` | 7 | Screen seconds through even and eased pacing; transition settings and styles; the still camera and its reset; moving texts and the events box; export choices and sizes; an event's own time on screen, out of sync with the clock |
| `test/workflow.test.ts` | 4 | Groups of countries (made, renamed, moved in and out, deleted keeping members); labels and pictures of many at once; many events and countries deleted at once; one undo each |
| `test/names.test.ts` | 1 | Names over time: before and after, renamed again at the same moment, in an event, from the beginning, reload, deleted with the thing, undo |
| `test/flat-maps.test.ts` | 3 | Flat maps: plan view, the width on screen, exact screen conversions, straight borders, panning stops at the edge; true to scale within 1%; labels |
| `test/label-place.test.ts` | 8 | Labels: every large country of today's 242 gets a place inside it in four projections; 24 countries labelled near their middle; across 180° and around the pole; lines for long names; all 242 placed quickly; the part on screen when zoomed in; the gridded distance to an outline; searches cut short (no place acceptable, too small) find the same place |
| `test/land-mask.test.ts` | 1 | "Any land in this box?" against looking at every cell, for 6,000 random boxes (across the 180° line too) |
| `test/kept.test.ts` | 2 | Things kept up to a total weight: what was used longest ago goes first, the newest always stays, the total stays within its limit over 20,000 random steps |
| `test/search-export.test.ts` | 4 | Search (D73): ranking, former names, notes, accents. Data export: the GeoJSON of a map with an enclave and two pieces (areas measured from the file alone equal the owners' land within 1%; holes; features; cities named as at the date); nesting and winding of rings; every CSV (quoting, line breaks, sortable dates, formula text defused) |
| `test/relations.test.ts` | 4 | Relationships (D72): a war begun, ended and begun again (one relationship either way round, read from both sides); kinds that are not mutual; in events (moved with them, undone, reloaded, alternative versions); deleting a party or a relationship; broken references; 150 random edits followed one by one in verify mode |
| `test/features.test.ts` | 10 | Areas, lines and points (D71): each kind checks its shape and cuts no border; dated shapes and lifespans with the three edit choices; in an event (moved with it, undone, reloaded, alternative versions); deleting and broken references; shapes across 180°; looks; 120 random edits followed one by one in verify mode; animated shapes (D79): progress, the shape before, at once without an event or a length, a line cut part way; contested areas (D93) |
| `test/engine-follow.test.ts` | 6 | History followed edit by edit equals a fresh compile after every step of random histories (20 kinds of edit, among them lengths of their own and changes recorded until the next; undo and redo; 5 seeds of 90 steps); checked to catch six planted mistakes |
| `test/characters.test.ts` | 7 | Characters: travelling between places along the shortest path, appearing, leaving the map, moving a placement, in events and from the start, undo, reload, deleted characters reported, across 180°; cities founded, moved at once, abandoned, from the beginning; which way a character faces; its icon setting checked and undone |
| `test/pincers.test.ts` | 1 | An expansion from two ends: the ends change hands first, the middle last, all of it at the end; undone; only an expansion has starting points |
| `test/units.test.ts` | 1 | Units: a character belongs to a country or faction and shows a trail or an arrow; checked, cleared, undone |
| `test/locks.test.ts` | 2 | Locked countries: a stroke across one changes only the land around it and names it; no land given to one; split, merge and annexation refused; unlocked and undone |
| `test/record-lengths.test.ts` | 2 | How long a change takes: its event's length, a date of its own, a time from its own date, at once; recorded until the next change (out of order too), undone together, a length chosen afterwards |
| `test/icons.test.ts` | 2 | The icon set: every shape well formed and on its 64 by 64 grid; unique ids and names, groups, how each turns |
| `test/history-view.test.ts` | 2 | Periods (day, month, year, several years, before year 1), stepping; a country's gains and losses in a period and the changes that made them; lost and won back within a period |
| `test/basemap.test.ts` | 19 | Natural Earth files decode correctly at both scales (land about 29% of the planet, no inside-out polygons, known places on land and at sea across 180° and the poles); dataset record; per-world setting and per-layer clipping setting with undo; culling never drops anything on screen (160 random views); lakes judged whole (less their islands, pieces cut at tile edges together, Lake Victoria the same at both scales); what is shown, while working and in exports apart, with undo |
| `test/kernel-faces.test.ts` | 2 | Faces rebuilt only around an edit equal a full rebuild after every step, on twin random maps (painting, erasing, moving points, undo); `test/kernel-faces.stress.ts` runs it for longer |
| `test/engine-stretch.test.ts` | 2 | States shared between change instants equal states worked out afresh; edits to history are seen at once; edits that do not touch history do not recompile |
| `test/plane.test.ts` | 8 | The projection formulas against d3-geo; a sheet covers exactly what the kernel says each parcel covers, across 180°, at the poles and on flat maps; neighbours simplified alike; dissolved outlines |
| `test/blocks.test.ts` | 3 | A block keeps what matters inside it: the same fill (winding) and the same lines as the whole shape, on random shapes; stored working-view settings are made valid, presets recognised |
| `e2e/render-compare.e2e.ts` | 6 steps | 35 scenes drawn by the renderer and by the old one (`e2e/reference/`) are the same picture (fills strictly, borders by position); a picture carried along as the view moves equals one drawn afresh (eight views, the planet's ends in view and two Equal Earth views holding their meridian among them; whole-pixel moves, then 170 small ones with the room around the frame drawn first; judged by how many pixels differ, how strongly and how densely); after brush strokes inside countries and an undo, the patched picture equals one drawn afresh; every frame of an animated change, renewed only in its own area, equals one drawn afresh, and so does stepping into a change, out of it and from one to another (24 steps, each drawn in part); an 80-frame shot through forty years drawn as an export draws it, each frame from the one before in three passes, equals frames drawn afresh |
| `e2e/vertical-slice.e2e.ts` | 23 steps | The vertical slice in Chrome: projects, drawing, Earth's geography and data sources, border points, versions, events, dates, version restore and undo, full restart, animation, export with data credits, identical re-export, 1080p, coastline clipping |
| `e2e/desktop.e2e.ts` | 5 steps | The Electron app: own window, own data service on this computer only, project written to disk, one copy at a time, close and reopen with contents intact |
| `test/event-groups.test.ts` | 4 | Event group commands with undo (several groups per event, filter rules, deletion keeps events, alternatives keep groups); a version 1 project file upgraded on opening (backup first, content and undo history intact, old backups restorable without rolling the format back); a file from a newer version refused untouched |
| `e2e/workflows.e2e.ts` | 44 steps | Precise shapes; occupation layer (drawn with stripes: both countries' colours in the pixels); hiding layers; alternative versions; annexation; deleting and undoing events; fades; a second world; a camera move at 2.39:1 and 25 fps with frame timing (an event out of sync with the clock animated in its own 0.4 s), history in the pixels and pass stacking checked; layers of lines, points and areas made with "+ Layer", drawn freehand, by a click and click by click, chosen by clicking, restyled (a claim contested with another country), given a new shape from a date, ended and undone; a war added from a country's panel, read from both sides, resumed and ended, drawn as a front line on their border during the war and not in peace; two dates compared across a dragged line and swapped; an event's end shown from its start, chosen on a calendar, the date viewed stepped with arrow keys; an event type made with a colour, a way of spreading and a length, used by a new event and a drawing, renamed, deleted and undone; a country split along a dragged line (the part clicked named by its side), a point of the new border moved from a date, today's states chosen by clicks and a box and given to a new country, a line in an event drawing itself (half drawn half way through, then set to appear at once), and the two merged into a new country in a new event, undone and redone; search (a country, an event, a point), a picture kept with a country's notes, the data exported as GeoJSON and CSV and read back; square size, Natural Earth projection, 23.976 fps, transparency; the preview of that shot dragged with the mouse (carried while its meridian is held, laid out afresh at rest); names, lakes and rivers hidden while working but kept in the presentation, lakes from about 1,000 km², undone; a character's icon (a ship facing the way it sails and flipped on the way back, an airliner turned, on a disc, three times the size); the character as a unit of a country, in its colour, with an arrow of advance while it travels; changes recorded into an event each spreading until the next (half faded in half way), the last given two years of its own and made an expansion from two points, the second clicked on the map; a country locked, drawn over and kept, unlocked, all the others locked at once; a radiation layer of conditions, a source placed with a click and a plume carried east, there while they last, hidden while working, undone; a fire spreading over the West Siberian Plain day by day; a meteor impact placed with one click, its crater and blast, undone in one step; a heatmap from the battles, and three thousand strikes drawn in a 4K export frame and the working view |

Checked by hand: 4K and 8K exports; the unzipped package starts and works; requests from other hosts are refused.

## Performance after the second optimisation stage (measured 17 November 2026, `bench/render.bench.ts`)

Chrome in the development container, **drawing in software (no graphics card)**, map area 1360 x 843. Times are
milliseconds per frame, the whole cost of a step until the page is idle again (median of 40 steps). "Before" is the
build before this stage (commit 4db4bb8, Windows run 37), measured with the same tool on the same projects straight
before "now" (the container's speed drifts by a tenth or two over a day, so the two columns belong together). A
real computer with a graphics card should be faster, a screen with more pixels slower; Settings shows the time on
the user's machine.

Benchmark projects (`bench/make-fixtures.ts`): **Earth 242**: today's 242 countries with 1:10m coasts, 30 events;
**Heavy**: 128,000 border segments, 11,000 parcels, 500 events, about 12 events crossed per step of 25 years;
**Random 1000**: 1,000 overlapping random territories, 24,500 parcels, 1,000 events, changes animating at almost
every date.

| Step | Earth 242 before | now | Heavy before | now | Random 1000 before | now |
| --- | --- | --- | --- | --- | --- | --- |
| A click that changes nothing on the map | 17 | 14 | 26 | 15 | 26 | 12 |
| Choosing a country | 16 | 14 | 23 | 21 | 32 | 17 |
| Moving the map, whole world | 20 | 8.5 | 26 | 8.8 | 26 | 18 |
| Moving the map, a region (zoom 3.5) | 22 | 7.3 | 34 | 7.3 | 29 | 5.1 |
| Moving the map, close in (zoom 7) | 16 | 4.9 | 15 | 5.2 | 20 | 5.1 |
| Moving the map, closer (zoom 13) | 32 | 5.1 | 14 | 5.2 | 22 | 5 |
| Moving the map, very close in (zoom 19) | 24 | 4.8 | 15 | 5.7 | 22 | 4.9 |
| Zooming (each step) | 38 | 20 | 55 | 25 | 32 | 22 |
| Moving the map in Equal Earth, whole world | 168 | 11 | 209 | 10 | 244 | 5.8 |
| Moving the map in Equal Earth, a region | 190 | 7.2 | 183 | 6.3 | 219 | 5.1 |
| Dragging the timeline, a year a frame | 9.2 | 7.1 | 33 | 13 | 42 | 27 |
| Dragging the timeline, a month a frame, close in on a region | 7.4 | 7.3 | 10 | 7.6 | 38 | 14 |
| Dragging the timeline, 25 years a frame (a dozen events crossed in each) | 8.9 | 8.3 | 196 | 89 | 244 | 151 |
| Stepping day by day | 8.8 | 7.9 | 12 | 9.5 | 42 | 37 |
| A brush stroke (the kernel, history and the redraw) | 72 | 29 | 85 | 37 | 188 | 120 |
| Playing a shot, still camera | 8.9 | 8.8 | 102 | 84 | 136 | 117 |
| Playing a shot, moving camera | 61 | 33 | 136 | 94 | 112 | 110 |
| Export, 1080p, per frame | 100 | 87 | 264 | 127 | 252 | 171 |
| Export, 4K, per frame | 241 | 206 | 545 | 269 | 483 | 305 |
| Export, 1080p, eight layers of each frame | 215 | 182 | 502 | 300 | 458 | 298 |
| Opening the project | 2.9 s | 1.9 s | 5.1 s | 2.7 s | 5.9 s | 3.5 s |

**A computer four times slower** (`bench/stress.ts --throttle 4`, 150 random steps, the heavy project; milliseconds
for the whole action, before and now, measured one after the other):

| Action | Balanced before | now | Fastest before | now |
| --- | --- | --- | --- | --- |
| A frame, median over the session | 132 | 56 | 92 | 46 |
| A brush stroke | 344 | 159 | 352 | 146 |
| Undo | 312 | 182 | 299 | 172 |
| A border point moved | 229 | 90 | 256 | 96 |
| Moving the map (ten frames) | 1,484 | 562 | 844 | 345 |
| Zooming (eight frames) | 769 | 448 | 544 | 381 |
| Dragging the timeline (twelve frames) | 1,794 | 922 | 1,993 | 904 |
| A jump in time | 498 | 339 | 455 | 355 |
| The whole session of 150 steps | 113 s | 62 s | 96 s | 56 s |

**Stress runs** (`bench/stress.ts`, verify mode on, the map compared with a fresh drawing every ten steps): thirteen
sessions of 160 to 300 random steps on the three projects, among them three on a screen twice as dense, one that
starts in Equal Earth, one of timeline drags and jumps only and one of zooming and moving only; and 150 steps on a
computer four times slower in both presets. No difference found, no error, and memory level after the first hundred
steps (about 200 MB on Earth 242, 270–310 MB on Heavy, 400 MB on Random 1000). One session did report a difference
(0.17% of pixels along every coast, on the dense screen): the check was comparing two levels of coast detail, both
within the tolerance (D69); with the fresh picture's geometry prepared for the same zoom the pictures are the same.

What still takes time, in order of what it would give:

1. **Changes of territory over large parts of the map in one frame**: dragging the timeline across a dozen events a
   frame, and playing a shot that does (Heavy and Random 1000: 85–150 ms a frame). Half of what is left is filling
   the changed territory again (a graphics card takes most of that); the rest is joining each changed owner's
   parcels into one outline, and finding the place for the name of every country whose land changed (a quarter of
   a frame of such a shot).
2. **Shots in Equal Earth or Natural Earth whose camera moves east or west, while they play**: every shape changes
   with the middle meridian, so each frame prepares the map again (130–210 ms a frame on these projects), as their
   export does by design. Framing such a shot by hand no longer costs this (D67: 5–11 ms a frame, with the map
   straightening a little when it comes to rest).
3. **Zooming without a graphics card**: showing the kept picture at another size is the browser's dearest copy
   (about 15 ms a frame at this size), and every three quarters of a level the picture is drawn whole (50–130 ms on
   the heavy project). Geometry is no longer prepared again in the middle of zooming in (D70).
4. **A world view with a thousand names on screen** (Random 1000: 18 ms a frame while moving): the names are placed
   and drawn again in every frame.
5. **Opening**: about half is now the kernel preparing its map (the order of borders around every point, areas),
   the rest the first picture.
6. Exports with a moving camera draw every frame afresh by design; encoding a frame (about 110 ms of processor time
   at 1080p) is what an export of a simple map waits for, on as many processors as the computer has.

### The first optimisation stage, for the record (measured earlier on 17 November)

Before that stage the map of today's 242 countries took 249 ms for a frame that changed nothing, 325–3,100 ms a
frame to move, 224 ms to step through time, 0.7 s for a brush stroke and 730 ms for an exported 1080p frame. The
table as measured then (the benchmark projects were rebuilt since, so its last three columns are not to be compared
with the table above):

| Step | Earth 242 before | Earth 242 now | Heavy now | Random 1000 now |
| --- | --- | --- | --- | --- |
| A click that changes nothing on the map | 249 | 17 (the map itself 3) | 18 | 18 |
| Moving the map, whole world | 325 | 20 | 22 | 22 |
| Moving the map, a region (zoom 3.5) | 517 | 20 | 36 | 24 |
| Moving the map, close in (zoom 13) | 522 | 31 | 16 | 14 |
| Moving the map, very close in (zoom 19) | 3,107 | 32 | 14 | 15 |
| Zooming (each wheel step) | not measured | 35 | 53 | 31 |
| Scrubbing through time | 224 | 7 | 166 | 218 |
| Scrubbing between events (nothing changes hands) | not measured | 8 | 9 | 38 |
| A brush stroke (the kernel, history and the redraw) | 693 | 40 | 71 | 151 |
| Playing a shot, still camera | 212 | 7 | 78 | 97 |
| Playing a shot, moving camera | 1,120 | 52 | 127 | 103 |
| Export, 1080p, per frame | 730 | 92 | 248 | 216 |
| Export, 4K, per frame | 2,288 | 203 | 493 | 438 |
| Export, 1080p, eight layers of each frame | 3,935 | 192 | 426 | 409 |
| Opening the project | 3.2 s | 3.1 s | 5.0 s | 6.3 s |

The earlier figures below are from before this stage (16 November, `test/perf.bench.ts`: kernel, saving, file size).

## Performance (measured 16 November 2026, development container, `test/perf.bench.ts`)

Random overlapping territories, each with its own dated event; 40 countries.

| Territories | Parcels | Border segments | Stroke | Save | Recompile after an edit | File |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 263 | 8,223 | 23 ms | 2 ms | 1 ms | 1.9 MB |
| 300 | 2,160 | 28,322 | 86 ms | 4 ms | 7 ms | 6.7 MB |
| 1,000 | 24,504 | 130,367 | about 0.4 s (1.75 s before the engine redesign); the first edit after opening about 1.3 s | 11 ms | about 50 ms | 35 MB |

Adding all 242 of today's countries (98,000 points) takes about 5 s.

Before this stage the same 300-territory project took 135 ms per stroke and 124 ms per save, and its file was 232 MB;
recompiling the 1,000-territory history took about 800 ms after every edit.

(Since then: face assembly works only around an edit, D48, and rendering is covered by the table above.)

## Known bugs and limitations

1. **Not yet run on the user's PC.** The tests run on a Windows machine in GitHub Actions; the installer and the
   launcher have not yet been tried by the user.
2. **Coastline detail.** The finest basemap detail is 1:10m (about 200 m); street-level coasts (OpenStreetMap) are not
   included. Areas in the inspector include parts clipped away at the coast.
3. **Large maps** (done in the optimisation stage, see Performance): what still takes time is listed there.
4. **Two animations meeting.** Where two simultaneous animated changes touch, their shared border is drawn throughout instead of following each front.
5. **Animation taking over another animation.** When a change starts while an earlier one is still animating the same area, the earlier one is shown at its starting state.
6. **Event groups are made by hand** (D8). Automatic groups, such as "every event that changes this world", are not
   built; tell me if they would help.
7. **A control or occupation layer looks like a second fill** over the political layer; hatching and outline styles are needed.
8. **New layers and alternative versions are named in the browser's own small prompt box**, which is plain but works.
9. **View memory is per browser** and is lost if the app's port changes.
10. **(Fixed 17 November 2026) Outlines under firm snapping.** Thought to be a face-assembly fault; it was two others
   (D39): `netPath` kept cancelled back-and-forth steps (the far side of a border could count as inside), and firm
   snapping could leave new borders crossing old ones (silently). Both fixed; an outline that cannot be joined
   cleanly is retried with gentler snapping, and only refused if even the finest fails.
11. **Uploaded pictures and videos, and border drafts, are not in automatic backups** (which copy the project file
   only). Copying the whole project folder keeps them.
12. **Characters have one look** (a dot in their colour and their name); no pictures or icons yet, and shots show where
   they are, not the trail they took. Placements made inside an event are removed from the character's panel.
13. **"Changes over time" reads one layer** (the one being drawn on) and compares the start and the end of the period.
14. **The export size is an estimate** from one frame of each chosen layer, drawn small and worked up (D69; checked
   to be within a factor of 2.5 of a real export; usually much closer).
15. **A shot in Equal Earth or Natural Earth, while its camera is framed by hand**, keeps the middle meridian it had
   and straightens a little when the pointer rests or lets go (D67): what is shown at rest is what is exported.
16. **(Fixed 18 November 2026) Flat maps after reopening a project.** A project opened again rebuilt the parcel
   maps of round maps only, so working on a flat (city) map after restarting the app failed with "No parcel map for
   map space…". Every map's parcel map is now rebuilt (`flat-maps` test: a flat map and what was drawn on it, after
   reopening).

## Defects found and fixed in the testing stage (0.2.0)

| Defect | Severity | Fix |
| --- | --- | --- |
| An outline enclosing no area, folding back or crossing itself could repaint the whole world | Data | Out-and-back segments no longer seed the fill; every paint is checked against the area its outline encloses and refused cleanly otherwise |
| Territory commands accepted a layer from another world, or a missing event or owner | Data | Validated before anything is written |
| History Health's problem list could be read out of date | History | Always recompiled before it is read |
| Opening a damaged project showed nothing; no way back from inside the app | Recovery | Plain message and recovery from the newest healthy backup; damaged files kept |
| Separate export passes did not stack back into the full picture with several layers | Export | One drawing order everywhere: all fills, all borders, labels |
| Wheel zoom jumped away from the cursor (up to half the planet at world scale) | Navigation | Correction pan direction fixed, iterated to 0.01 px |
| Project files grew by about 1 MB per stroke on large maps (every coastline relabelled) | Storage | Split-identity optimisation (history proved identical), compressed undo history |
| Saves slowed to over 100 ms | Storage | As above |
| Recompiling history took about 0.8 s after every edit on large projects | Performance | Cached parcel family tree; overlap checks indexed by land |
| Background and grid passes reconstructed territory they never draw | Export speed | Skipped |
| Kernel face changes did not advance its revision counter | Latent | Fixed (caches rely on it) |

## Session log

| Date | Work | Commits |
| --- | --- | --- |
| 15–16 Nov 2026 | Stage work from an empty folder: time system and kernel; world model, engine and commands; data service; interface; end-to-end fixes; documentation (0.1.0) | `2a564fc` → `0966b07` |
| 16 Nov 2026 | Testing and refinement: scenario, geometry, world, recovery, camera and A/B tests; second interface test; benchmark; 11 defects fixed; performance work (0.2.0) | `6a3c64a` → `343d84c` |
| 16 Nov 2026 (3rd) | The user's first feedback round (14 items) and the engine redesign; two kernel defects fixed | `aca87e0` → `db6423b` |
| 17 Nov 2026 | The user's second feedback round (12 items): labels, add into a country, characters, corrections from the date drawn, changes over time, still camera, advancing front, draggable texts, graphic as the box, export choices and size | `6525557` → `83c103a` |
| 17 Nov 2026 (4th) | Second optimisation stage: history, snapshots, borders and names brought up to date from what was there; animated changes redrawn only in their own area, and stepping into, out of and between them too; exports drawn frame from frame; kept pictures with room around the frame, holding the repeating map, one picture while zooming; Equal Earth and Natural Earth keep their meridian while moved; Chrome's canvas copies and closePath avoided; the database writes the snapshot; weight-limited caches; a verify mode and a random stress run; six defects fixed (D55–D70) | `ef62f20` → `ea7df4a` and the commit after it |
| 17 Nov 2026 (3rd) | Optimisation stage: kernel faces rebuilt around an edit, engine states per stretch, the renderer rewritten on sheets and blocks, carried pictures, live and full interface updates, browser-encoded exports, patched redraws after edits, the Settings button; benchmark projects and tools; four defects fixed (D48–D54) | after `c9bdc89` |
| 17 Nov 2026 (2nd) | Firm-snapping kernel defects (D39), cities (D40), trails; the third feedback round: grey borders and "+ Layer" fixed, choosing several, right-click menus, groups, bulk delete, cities under countries, labels apart, border eraser, flat maps (D41–D44) | `ed163e3` → latest |
| 16 Nov 2026 (2nd) | Package installs work; Natural Earth basemap (land, lakes, coastlines, present-day borders guide), land export pass, data sources dialog and export credits; coastline clipping with land-aware labels; real React types (D4 reversed); desktop app, Windows installer and Windows test run (D2 reversed); Windows fix; event groups and the first file-format upgrade | `071deac` → `9004a90` |

## Next priorities (18 November 2026, Stages 8 and 9 done)

1. The user tries the latest installer (Stages 8 and 9: terrain, rivers, the satellite look, close-up heights,
   conditions, disasters, heatmaps) and reports back; the next stages wait for the go-ahead.
2. Arrival-time fields for fronts (slowed by mountains and water), now that terrain is there.
3. Space maps (still wanted, D38).

(D1, reversing to the deck.gl renderer, is moved to when terrain and fields arrive (Stages 8 and 9), which need the
graphics card: for territories, features and names the Canvas renderer is now fast enough (D48–D70).)

## Next priorities (after the second feedback round)

1. The user tries the second round (installer from the latest "Windows build and tests" run) and reports back. Space
   maps are still wanted (D38); maps of cities are not.
2. Characters: icons or pictures for markers, characters following events automatically.
3. Make face assembly incremental too (the first edit after opening a large map; Known bug 10 is fixed, D39). (Done in the optimisation stage.)
4. Reverse D1 (deck.gl renderer).
5. Space maps (still wanted, D38).

## Earlier priorities (first feedback round)

1. The user installs the desktop app from the GitHub Actions artifact (or runs `Start Map Maker.bat`) and reports
   what happens.
2. Examine face assembly under firm snapping (Known bugs 10); then make face assembly incremental too.
3. Reverse D1 (deck.gl renderer).
4. Finish Stage 2: split and merge tools, region picker, sub-national boundaries.
5. Finish Stage 3: custom event types, date comparison, dated border-point moves.
6. Stage 4: line, point and area layers, layer styles (hatching, outlines), relationships, lifespans.
