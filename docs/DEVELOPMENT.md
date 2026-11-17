# Map Maker: development record

The running record of where the software stands. Read this first at the start of every development session.
Companion files: [REQUIREMENTS.md](REQUIREMENTS.md) (checklist against the master specification) and
[DECISIONS.md](DECISIONS.md) (architectural decisions and every deviation from the approved architecture).

The approved architecture is the Claude Doc "Map Maker — Technical Architecture & Development Plan"
(https://claude.ai/artifact/2JShAV3AWt6iECtNgBTsJN). All twelve of its decisions were approved on 15 November 2026.

## Status at a glance (17 November 2026, after the second optimisation stage)

- **Second optimisation stage done** (the user's request to keep optimising the whole workflow and to stress test it
  for massive projects on a slower computer; D55–D67; REQUIREMENTS.md, "The user's second optimisation request").
  Against the build before it, on the same benchmark projects: moving the map 16–39 ms a frame to 5–10 ms; zooming
  about half; a brush stroke 65–75 ms to about 33 ms (193 to 123 ms on the 24,500-parcel map); dragging the timeline
  a year a frame 29 to 10 ms on the heavy project; exports a fifth to a quarter faster; opening 3.2–5.6 s to
  2.0–3.7 s; memory level in long sessions. On a computer made four times slower, the heavy project: moving the map
  146 to 71 ms a frame, a stroke 227 to 155 ms. How: history, snapshots, borders and names are brought up to date
  from what was there before instead of worked out again (D55, D56, D60); kept pictures have room around the frame,
  hold the repeating map and are shown as one picture while zooming (D62, D63); the browser's hidden costs with
  canvases and paths are avoided (D61, D64); the database writes the snapshot when a project opens (D66); a shot
  in Equal Earth or Natural Earth is framed at 6–12 ms a frame instead of 130–210 (D67). A verify
  mode and a random stress run check all of it (D57). **Six defects found and fixed on the way**: borders between
  countries could vanish after drawing inside a country (D56); moving east or west with the planet's ends in view
  showed a wrong picture (D62); the sharp redraw could fall in the middle of a slow movement and draw everything
  twice (D65); problems in History Health could be listed in a different order after an edit than after reopening
  (D55); memory grew in long sessions on large maps (D59); two interface-test steps depended on the size of the
  window and failed on Windows (the software itself was right).

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
| `npm test` | 202 unit, randomised and scenario tests |
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
| `node --disable-warning=ExperimentalWarning e2e/workflows.e2e.ts` | The 22-step workflow and export-inspection test; screenshots in `e2e/output/workflows/` |
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
| `src/presentation/events-box.ts` | Current events box | Which events show at a frame (with fades) and how the box is drawn. |
| `src/render-engine/label-style.ts`, `assets.ts` | Looks | Label styles (general, per country); pictures and videos (loaded once; exports preload pictures and seek videos per frame on their own elements). |
| `src/server/assets.ts` | Project files | Uploaded pictures and videos in the project's `assets` folder, named by content, served with byte ranges. Border drafts are `drafts.json` in the project folder. |
| `data/flags/` | Flags | 197 SVG flags (flag-icons, MIT) and `index.json`. |
| `src/render-engine/label-place.ts` | Label places | Where a country's label has the most room (stretched pole of inaccessibility in the projection's plane), line breaking for long names (D31). |
| `src/domain/history-view.ts` | Changes over time | Periods (day, month, year, several years) and a country's gains, losses and changes in one (D36); shown by `ui/components/CountryHistory.tsx`. |
| Characters | Points over time | Placements are effects of kind `place` (`commands.ts` placeCharacter, characterLeaves); the engine compiles them into tracks (`charactersAt`, `characterTrack`); drawn in the `characters` pass; panel in `ui/components/Characters.tsx` (D35). |
| `test/`, `e2e/` | Tests | See "Tests" below. |

How an edit flows: a command changes the in-memory world and returns diffs → the interface redraws at once → the diffs
are sent to the data service, which checks them against the stored rows and writes them in one transaction (or refuses
if the project changed underneath) → the journal entry is the undo step.

## Roadmap position

The approved roadmap has 14 stages (0–13). Where each stands:

| Stage | Status | Done | Still to do |
| --- | --- | --- | --- |
| 0 Groundwork | Mostly done | Sphere-safe kernel, two-part time, SQLite storage, transparent PNG export, pannable/zoomable/rotatable map, Natural Earth basemap, Electron shell, Windows installer built automatically | Installer test on the user's PC; reference-image render tests |
| 1 Project, storage, world model | Mostly done | Projects, schema with upgrades (version 2; upgrade from 1 tested), undo journal, autosave, versions, backups with restore, crash safety, multiple worlds, entities with names, colours, notes; event groups with a timeline filter (D8); outliner and inspector | Automatic groups (by world, by country) if wanted |
| 2 Parcel map and territory editing | Partly done | Production kernel, territory brush, precise shape tool, border-point editing, snapping, smoothing, irregularity, political fills, derived borders, labels, present-day borders as a guide | Border pen, explicit split and merge tools, administrative boundaries as parcel edges, region picker, coastline clipping |
| 3 Time and event engine | Mostly done | Instants, Gregorian calendar, events, effects with intention, compiler, any-date reconstruction, zoomable timeline, edit prompt, record mode, History Health with keep and re-apply, precedence and overlap rules | Custom event types (interface), date comparison, dated border-point moves |
| 4 Layers, entities, lore | Started | Unlimited custom layers (territory kind), alternative versions of events | Area, line and point layers; relationships; lifespans; cities; search; GeoJSON and CSV export |
| 5 First shots and export | Mostly done | Shots, time remap, start and end camera, date and title overlays, PNG sequences with passes and transparency at any resolution up to 8K and every listed frame rate, preview, manifest, compositing guide, deterministic output | Multi-key camera, styles, version-pinned shots, the Premiere checklist on the user's PC |
| 6 Transitions | Started | Advancing front and fade; borders and labels follow the animation | Arrival-time fields, front keyframes, more styles, the approved per-event "out of sync" override |
| 7–13 | Not started | | Military and movement, terrain, environment, presentation polish, space maps (nearby stars to 50 light-years), smart brushes, branches and calendars |

## Tests

All pass as of 17 November 2026 (202 unit and randomised tests in 31 files, 23 + 22 + 5 + 5 interface steps). The
interface tests run with the verify mode on (D57): everything the app works out from what was there before is also
worked out afresh, and any difference stops the test.
`sh scripts/check-all.sh` runs everything and prints ALL CHECKS PASSED only when every check passed.

| Suite | Count | What it proves |
| --- | --- | --- |
| `test/core-time.test.ts` | 8 | Known Gregorian dates; calendar round trips across trillions of years; exact arithmetic; parsing and formatting |
| `test/geo-kernel.test.ts` | 13 | Predicates; parcels across the poles and the 180° line; nested islands; snapping; randomised point location against d3; rollback; vertex edits never break validity; a parcel's area summed on plain numbers against the earlier formula and d3 |
| `test/geo-kernel.stress.ts` | CLI | 12 seeds × 50 random rings with full validation after each (0 refusals) |
| `test/temporal-engine.test.ts` | 16 | Editing events never changes earlier history; compiled timelines equal a naive replay; simultaneous and overlapping events; stale intentions; broken references; corrections; variants; undo |
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
| `test/sequence.test.ts` | 6 | Screen seconds through even and eased pacing; transition settings and styles; the still camera and its reset; moving texts and the events box; export choices and sizes |
| `test/workflow.test.ts` | 4 | Groups of countries (made, renamed, moved in and out, deleted keeping members); labels and pictures of many at once; many events and countries deleted at once; one undo each |
| `test/names.test.ts` | 1 | Names over time: before and after, renamed again at the same moment, in an event, from the beginning, reload, deleted with the thing, undo |
| `test/flat-maps.test.ts` | 3 | Flat maps: plan view, the width on screen, exact screen conversions, straight borders, panning stops at the edge; true to scale within 1%; labels |
| `test/label-place.test.ts` | 8 | Labels: every large country of today's 242 gets a place inside it in four projections; 24 countries labelled near their middle; across 180° and around the pole; lines for long names; all 242 placed quickly; the part on screen when zoomed in; the gridded distance to an outline; searches cut short (no place acceptable, too small) find the same place |
| `test/land-mask.test.ts` | 1 | "Any land in this box?" against looking at every cell, for 6,000 random boxes (across the 180° line too) |
| `test/kept.test.ts` | 2 | Things kept up to a total weight: what was used longest ago goes first, the newest always stays, the total stays within its limit over 20,000 random steps |
| `test/engine-follow.test.ts` | 6 | History followed edit by edit equals a fresh compile after every step of random histories (18 kinds of edit, undo and redo; 5 seeds of 90 steps); checked to catch six planted mistakes |
| `test/characters.test.ts` | 5 | Characters: travelling between places along the shortest path, appearing, leaving the map, moving a placement, in events and from the start, undo, reload, deleted characters reported, across 180°; cities founded, moved at once, abandoned, from the beginning |
| `test/history-view.test.ts` | 2 | Periods (day, month, year, several years, before year 1), stepping; a country's gains and losses in a period and the changes that made them; lost and won back within a period |
| `test/basemap.test.ts` | 16 | Natural Earth files decode correctly at both scales (land about 29% of the planet, no inside-out polygons, known places on land and at sea across 180° and the poles); dataset record; per-world setting and per-layer clipping setting with undo; culling never drops anything on screen (160 random views) |
| `test/kernel-faces.test.ts` | 2 | Faces rebuilt only around an edit equal a full rebuild after every step, on twin random maps (painting, erasing, moving points, undo); `test/kernel-faces.stress.ts` runs it for longer |
| `test/engine-stretch.test.ts` | 2 | States shared between change instants equal states worked out afresh; edits to history are seen at once; edits that do not touch history do not recompile |
| `test/plane.test.ts` | 8 | The projection formulas against d3-geo; a sheet covers exactly what the kernel says each parcel covers, across 180°, at the poles and on flat maps; neighbours simplified alike; dissolved outlines |
| `test/blocks.test.ts` | 3 | A block keeps what matters inside it: the same fill (winding) and the same lines as the whole shape, on random shapes; stored working-view settings are made valid, presets recognised |
| `e2e/render-compare.e2e.ts` | 5 steps | 35 scenes drawn by the renderer and by the old one (`e2e/reference/`) are the same picture (fills strictly, borders by position); a picture carried along as the view moves equals one drawn afresh (eight views, the planet's ends in view and two Equal Earth views holding their meridian among them; whole-pixel moves, then 170 small ones with the room around the frame drawn first; judged by how many pixels differ, how strongly and how densely); after brush strokes inside countries and an undo, the patched picture equals one drawn afresh; every frame of an animated change, renewed only in its own area, equals one drawn afresh |
| `e2e/vertical-slice.e2e.ts` | 23 steps | The vertical slice in Chrome: projects, drawing, Earth's geography and data sources, border points, versions, events, dates, version restore and undo, full restart, animation, export with data credits, identical re-export, 1080p, coastline clipping |
| `e2e/desktop.e2e.ts` | 5 steps | The Electron app: own window, own data service on this computer only, project written to disk, one copy at a time, close and reopen with contents intact |
| `test/event-groups.test.ts` | 4 | Event group commands with undo (several groups per event, filter rules, deletion keeps events, alternatives keep groups); a version 1 project file upgraded on opening (backup first, content and undo history intact, old backups restorable without rolling the format back); a file from a newer version refused untouched |
| `e2e/workflows.e2e.ts` | 22 steps | Precise shapes; occupation layer; hiding layers; alternative versions; annexation; deleting and undoing events; fades; a second world; a camera move at 2.39:1 and 25 fps with frame timing, history in the pixels and pass stacking checked; square size, Natural Earth projection, 23.976 fps, transparency; the preview of that shot dragged with the mouse (carried while its meridian is held, laid out afresh at rest) |

Checked by hand: 4K and 8K exports; the unzipped package starts and works; requests from other hosts are refused.

## Performance after the second optimisation stage (measured 17 November 2026, `bench/render.bench.ts`)

Chrome in the development container, **drawing in software (no graphics card)**, map area 1360 x 843. Times are
milliseconds per frame, the whole cost of a step until the page is idle again (median of 40 steps). "Before" is the
build before this stage (commit 4db4bb8, Windows run 37), measured the same day with the same tool on the same
projects. A real computer with a graphics card should be faster, a screen with more pixels slower; Settings shows the
time on the user's machine.

Benchmark projects (`bench/make-fixtures.ts`): **Earth 242**: today's 242 countries with 1:10m coasts, 30 events;
**Heavy**: 128,000 border segments, 11,000 parcels, 500 events, about 12 events crossed per step of 25 years;
**Random 1000**: 1,000 overlapping random territories, 24,500 parcels, 1,000 events, changes animating at almost
every date.

| Step | Earth 242 before | now | Heavy before | now | Random 1000 before | now |
| --- | --- | --- | --- | --- | --- | --- |
| A click that changes nothing on the map | 19 | 14 | 19 | 16 | 21 | 12 |
| Choosing a country | 16 | 17 | 30 | 19 | 30 | 19 |
| Moving the map, whole world | 23 | 9.1 | 24 | 10 | 26 | 25 |
| Moving the map, a region (zoom 3.5) | 23 | 8.9 | 39 | 7.8 | 27 | 5.7 |
| Moving the map, close in (zoom 7) | 16 | 5.9 | 17 | 5.4 | 21 | 5.9 |
| Moving the map, closer (zoom 13) | 24 | 5.9 | 19 | 5.4 | 21 | 5.4 |
| Moving the map, very close in (zoom 19) | 24 | 5.7 | 20 | 5.4 | 19 | 5.7 |
| Zooming (each step) | 39 | 18 | 56 | 28 | 31 | 24 |
| Dragging the timeline, a year a frame | 7.6 | 8.1 | 29 | 9.5 | 43 | 33 |
| Dragging the timeline, a month a frame, close in on a region | 6.1 | 6.8 | 9.6 | 6.2 | 37 | 16 |
| Dragging the timeline, 25 years a frame (a dozen events crossed in each) | 10 | 8.3 | 163 | 102 | 239 | 183 |
| Stepping day by day | 8.7 | 7.4 | 9.1 | 8.8 | 45 | 40 |
| A brush stroke (the kernel, history and the redraw) | 65 | 33 | 75 | 32 | 193 | 123 |
| Playing a shot, still camera | 7.8 | 8.5 | 95 | 82 | 138 | 131 |
| Playing a shot, moving camera | 59 | 30 | 123 | 103 | 115 | 121 |
| Export, 1080p, per frame | 94 | 77 | 245 | 190 | 253 | 196 |
| Export, 4K, per frame | 242 | 209 | 546 | 485 | 530 | 389 |
| Export, 1080p, eight layers of each frame | 256 | 207 | 486 | 443 | 435 | 310 |
| Opening the project | 3.2 s | 2.0 s | 4.7 s | 2.9 s | 5.6 s | 3.7 s |

**A computer four times slower** (`bench/stress.ts --throttle 4`, 150 random steps, the heavy project; milliseconds
for the whole action, before and now):

| Action | Balanced before | now | Fastest before | now |
| --- | --- | --- | --- | --- |
| A frame, median over the session | 110 | 79 | 72 | 66 |
| A brush stroke | 227 | 155 | 172 | 137 |
| Moving the map (ten frames) | 1,463 | 710 | 687 | 469 |
| Zooming (eight frames) | 642 | 450 | 429 | 429 |
| Dragging the timeline (twelve frames) | 1,459 | 1,412 | 1,529 | 1,373 |
| A jump in time | 409 | 389 | 394 | 358 |

**Stress runs** (`bench/stress.ts`, verify mode on, the map compared with a fresh drawing every ten steps): 250 to
300 random steps on each of the three projects, one on a screen twice as dense, and 150 steps each on a computer
four times slower (both presets): no difference found, no error, and memory level after the first hundred steps
(about 200 MB on Earth 242, 310 MB on Heavy, 400 MB on Random 1000).

What still takes time, in order of what it would give:

1. **Changes of territory over large parts of the map in one frame**: dragging the timeline across a dozen events a
   frame, and playing or exporting a shot that does (Heavy and Random 1000: 80–180 ms a frame). What is left is
   filling the changed territory again and joining each changed owner's parcels into one outline; a graphics card
   takes most of the first.
2. **Shots in Equal Earth or Natural Earth whose camera moves east or west, while they play**: every shape changes
   with the middle meridian, so each frame prepares the map again (130–210 ms a frame on these projects), as their
   export does by design. Framing such a shot by hand no longer costs this (D67: 6–12 ms a frame, with the map
   straightening a little when it comes to rest).
3. **Zooming without a graphics card**: showing the kept picture at another size is the browser's dearest copy
   (about 15 ms a frame at this size), and a zoom ends with one full redraw at the new scale.
4. **A world view with a thousand names on screen** (Random 1000: 25 ms a frame while moving): the names are placed
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
14. **The export size is an estimate** from one frame of each chosen layer (checked to be within a factor of four of a
   real export; usually much closer).

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
| 17 Nov 2026 (4th) | Second optimisation stage: history, snapshots, borders and names brought up to date from what was there; animated changes redrawn only in their own area; kept pictures with room around the frame, holding the repeating map, one picture while zooming; Chrome's canvas copies and closePath avoided; the database writes the snapshot; weight-limited caches; a verify mode and a random stress run; six defects fixed (D55–D66) | `ef62f20` → `955a41e` and the documentation commit after it |
| 17 Nov 2026 (3rd) | Optimisation stage: kernel faces rebuilt around an edit, engine states per stretch, the renderer rewritten on sheets and blocks, carried pictures, live and full interface updates, browser-encoded exports, patched redraws after edits, the Settings button; benchmark projects and tools; four defects fixed (D48–D54) | after `c9bdc89` |
| 17 Nov 2026 (2nd) | Firm-snapping kernel defects (D39), cities (D40), trails; the third feedback round: grey borders and "+ Layer" fixed, choosing several, right-click menus, groups, bulk delete, cities under countries, labels apart, border eraser, flat maps (D41–D44) | `ed163e3` → latest |
| 16 Nov 2026 (2nd) | Package installs work; Natural Earth basemap (land, lakes, coastlines, present-day borders guide), land export pass, data sources dialog and export credits; coastline clipping with land-aware labels; real React types (D4 reversed); desktop app, Windows installer and Windows test run (D2 reversed); Windows fix; event groups and the first file-format upgrade | `071deac` → `9004a90` |

## Next priorities (after the second feedback round)

1. The user tries the second round (installer from the latest "Windows build and tests" run) and reports back. Space
   maps are still wanted (D38); maps of cities are not.
2. Characters: icons or pictures for markers, characters following events automatically.
3. Make face assembly incremental too (the first edit after opening a large map; Known bug 10 is fixed, D39).
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
