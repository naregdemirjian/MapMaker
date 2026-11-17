# Map Maker: development record

The running record of where the software stands. Read this first at the start of every development session.
Companion files: [REQUIREMENTS.md](REQUIREMENTS.md) (checklist against the master specification) and
[DECISIONS.md](DECISIONS.md) (architectural decisions and every deviation from the approved architecture).

The approved architecture is the Claude Doc "Map Maker — Technical Architecture & Development Plan"
(https://claude.ai/artifact/2JShAV3AWt6iECtNgBTsJN). All twelve of its decisions were approved on 15 November 2026.

## Status at a glance (17 November 2026, after the user's second feedback round)

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
| `sh scripts/check-all.sh` | Every check: type check, unit tests, build, the three interface tests |
| `npm test` | 150 unit, randomised and scenario tests |
| `node --disable-warning=ExperimentalWarning test/geo-kernel.stress.ts <seeds> <rings>` | Long randomised kernel run |
| `node --disable-warning=ExperimentalWarning e2e/vertical-slice.e2e.ts` | The 17-step interface test in Chrome (build first); screenshots in `e2e/output/` |
| `node --disable-warning=ExperimentalWarning e2e/workflows.e2e.ts` | The 10-step workflow and export-inspection test; screenshots in `e2e/output/workflows/` |
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
| `src/render-engine/` | Drawing the map | Camera and projections (d3-geo), the map renderer (fills, borders, labels, transitions), the Earth basemap (`basemap.ts`: decoding, choice of detail, culling to the view), stroke processing for the freehand brush. |
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

All pass as of 17 November 2026 (150 unit and randomised tests in 21 files, 22 + 17 + 5 interface steps).
`sh scripts/check-all.sh` runs everything and prints ALL CHECKS PASSED only when every check passed.

| Suite | Count | What it proves |
| --- | --- | --- |
| `test/core-time.test.ts` | 8 | Known Gregorian dates; calendar round trips across trillions of years; exact arithmetic; parsing and formatting |
| `test/geo-kernel.test.ts` | 12 | Predicates; parcels across the poles and the 180° line; nested islands; snapping; randomised point location against d3; rollback; vertex edits never break validity |
| `test/geo-kernel.stress.ts` | CLI | 12 seeds × 50 random rings with full validation after each (0 refusals) |
| `test/temporal-engine.test.ts` | 16 | Editing events never changes earlier history; compiled timelines equal a naive replay; simultaneous and overlapping events; stale intentions; broken references; corrections; variants; undo |
| `test/scenarios.test.ts` | 9 | A region's history (secession, partition, insertion, deletion, moving events); order independence; simultaneous and overlapping events with durations; seconds and millennia apart; advancing fronts from minutes to years; occupation on its own layer; edits never corrupt unrelated data; formation, fragmentation, collapse |
| `test/geometry-worlds.test.ts` | 7 | Degenerate and self-crossing outlines refused cleanly; poles, the 180° line, more than a hemisphere, 20-metre shapes; splitting and merging; 1 cm precision after reopening; independent worlds of different sizes; undo per world |
| `test/storage.test.ts` | 6 | Reopening; undo and redo across reopening; atomic saves; process killed mid-save; versions and backups; PNG round trip |
| `test/recovery.test.ts` | 7 | Three kinds of file damage refused then recovered; damaged backups skipped; no usable backup; malformed rows; 120-step undo/redo compared state by state; old uncompressed history |
| `test/split-identity.test.ts` | 7 | The split-identity optimisation leaves history identical (6 random histories, with and without) and stops coastline relabelling |
| `test/stroke.test.ts` | 7 | Freehand outlines: closed, open, figure-eight, tiny, orientation, reproducible irregularity |
| `test/camera.test.ts` | 7 | Screen/map round trips in every projection, rotation and zoom 0–14; zoom keeps the cursor point fixed; city-level precision; panning across 180° |
| `test/kernel-incremental.test.ts` | 8 | The kept half-edge structure equals a full rebuild after every kind of edit, undo and redo (4 seeds x 70 steps); nearly overlapping borders; outlines kept under firm snapping, valid with no crossing borders after each (3 seeds x 60) |
| `test/countries.test.ts` | 4 | Today's countries: holes, overseas parts, across 180°, all 242 at once as an event (about 5 s), one undo; land added into the user's own country |
| `test/label-style.test.ts` | 3 | Label styles: layering, clamping, text, commands with undo |
| `test/fills.test.ts` | 3 | Video timing; fill commands with undo; the 197 flags and their credit |
| `test/events-box.test.ts` | 2 | Current events: started and not ended, lingering, alternatives, groups, fades, limits |
| `test/sequence.test.ts` | 6 | Screen seconds through even and eased pacing; transition settings and styles; the still camera and its reset; moving texts and the events box; export choices and sizes |
| `test/label-place.test.ts` | 6 | Labels: every large country of today's 242 gets a place inside it in four projections; 24 countries labelled near their middle; across 180° and around the pole; lines for long names; all 242 placed quickly; the part on screen when zoomed in |
| `test/characters.test.ts` | 4 | Characters: travelling between places along the shortest path, appearing, leaving the map, moving a placement, in events and from the start, undo, reload, deleted characters reported, across 180° |
| `test/history-view.test.ts` | 2 | Periods (day, month, year, several years, before year 1), stepping; a country's gains and losses in a period and the changes that made them; lost and won back within a period |
| `test/basemap.test.ts` | 16 | Natural Earth files decode correctly at both scales (land about 29% of the planet, no inside-out polygons, known places on land and at sea across 180° and the poles); dataset record; per-world setting and per-layer clipping setting with undo; culling never drops anything on screen (160 random views) |
| `e2e/vertical-slice.e2e.ts` | 17 steps | The vertical slice in Chrome: projects, drawing, Earth's geography and data sources, border points, versions, events, dates, version restore and undo, full restart, animation, export with data credits, identical re-export, 1080p, coastline clipping |
| `e2e/desktop.e2e.ts` | 5 steps | The Electron app: own window, own data service on this computer only, project written to disk, one copy at a time, close and reopen with contents intact |
| `test/event-groups.test.ts` | 4 | Event group commands with undo (several groups per event, filter rules, deletion keeps events, alternatives keep groups); a version 1 project file upgraded on opening (backup first, content and undo history intact, old backups restorable without rolling the format back); a file from a newer version refused untouched |
| `e2e/workflows.e2e.ts` | 10 steps | Precise shapes; occupation layer; hiding layers; alternative versions; annexation; deleting and undoing events; fades; a second world; a camera move at 2.39:1 and 25 fps with frame timing, history in the pixels and pass stacking checked; square size, Natural Earth projection, 23.976 fps, transparency |

Checked by hand: 4K and 8K exports; the unzipped package starts and works; requests from other hosts are refused.

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

Rendering the 1,000-territory map in Chrome: about 210 ms per 1080p frame during a shot (about 5 frames a second when
scrubbing); 4K about 330 ms. Opening it: about 4 s. 8K export: about 6–9 s per frame per pass.

Remaining bottlenecks:
1. **Face assembly is still global** (components and containment are recomputed on each edit; half-edges and cycle
   measurements are now kept, D26). It is about 0.1 s per edit on the benchmark map.
2. **Canvas 2D rendering** of tens of thousands of parcels. The approved WebGL renderer (deck.gl, D1) is the fix.

## Known bugs and limitations

1. **Not yet run on the user's PC.** The tests run on a Windows machine in GitHub Actions; the installer and the
   launcher have not yet been tried by the user.
2. **Coastline detail.** The finest basemap detail is 1:10m (about 200 m); street-level coasts (OpenStreetMap) are not
   included. Areas in the inspector include parts clipped away at the coast.
3. **Large maps are slow to edit and render** (see Performance).
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
| 17 Nov 2026 | The user's second feedback round (12 items): labels, add into a country, characters, corrections from the date drawn, changes over time, still camera, advancing front, draggable texts, graphic as the box, export choices and size | `6525557` → latest |
| 16 Nov 2026 (2nd) | Package installs work; Natural Earth basemap (land, lakes, coastlines, present-day borders guide), land export pass, data sources dialog and export credits; coastline clipping with land-aware labels; real React types (D4 reversed); desktop app, Windows installer and Windows test run (D2 reversed); Windows fix; event groups and the first file-format upgrade | `071deac` → `9004a90` |

## Next priorities (after the second feedback round)

1. The user tries the second round (installer from the latest "Windows build and tests" run) and reports back. Space
   maps are still wanted (D38); maps of cities are not.
2. Characters: icons or pictures for markers, a visible trail in shots, characters following events automatically.
3. Make face assembly incremental too (Known bug 10 is fixed, D39).
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
