# Map Maker: development record

The running record of where the software stands. Read this first at the start of every development session.
Companion files: [REQUIREMENTS.md](REQUIREMENTS.md) (checklist against the master specification) and
[DECISIONS.md](DECISIONS.md) (architectural decisions and every deviation from the approved architecture).

The approved architecture is the Claude Doc "Map Maker — Technical Architecture & Development Plan"
(https://claude.ai/artifact/2JShAV3AWt6iECtNgBTsJN). All twelve of its decisions were approved on 15 November 2026.

## Status at a glance (16 November 2026, version 0.1.0)

- **Working foundation reached.** The early vertical slice works end to end in the real interface and is covered by an
  automated 15-step browser test: create a project, draw countries, edit a border, save versions, record a dated event,
  move through time, close everything and reopen, animate the change, export image sequences.
- **Roadmap position.** Most of Stages 1 and 3 are done; Stage 0 and Stage 2 are partly done; parts of Stages 4, 5 and 6
  were built early because the vertical slice needed them. See "Roadmap position" below.
- **Biggest open issue.** This session could not install packages and had no GitHub repository, which the approved
  development set-up assumes. Four interim substitutions follow from that (DECISIONS.md, D1–D4). None changes the world
  model, the history engine or the storage format.

## How to run it

On the user's Windows PC: install Node.js LTS (22.13 or newer) once, then double-click `Start Map Maker.bat`.
The browser opens on the app. Projects are stored in `Documents\Map Maker Projects\<name>.mapmaker\`.

For development (Linux or Windows, Node 22.18 or newer):

| Command | What it does |
| --- | --- |
| `node scripts/build.mjs` | Builds `dist/server.mjs` (the data service) and `dist/ui/` (the interface) |
| `node --disable-warning=ExperimentalWarning dist/server.mjs --port 4317 --projects <folder> [--open]` | Runs the app |
| `npm test` | 47 unit and randomised tests (time, kernel, engine, storage, strokes) |
| `node --disable-warning=ExperimentalWarning test/geo-kernel.stress.ts <seeds> <rings>` | Long randomised kernel run |
| `node --disable-warning=ExperimentalWarning e2e/vertical-slice.e2e.ts` | The 15-step interface test in Chrome (build first); screenshots in `e2e/output/` |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | Type check (must report nothing) |

Offline sessions without package installs: run `scripts/link-local-packages.sh` to link the preinstalled packages into
`node_modules/`. With package installs available, `npm install` replaces this.

TypeScript runs directly under Node's type stripping: imports carry `.ts` extensions, type-only imports use
`import type`, and enums or constructor parameter properties are not allowed.

## Code map

| Folder | Role | Key facts |
| --- | --- | --- |
| `src/core-time/` | Instants and calendars | An instant is (whole days since 1970, milliseconds in the day): exact to the millisecond across ±24 trillion years. Proleptic Gregorian calendar with astronomical years (year 0 = 1 BCE). |
| `src/geo-kernel/` | The parcel map on a sphere | One planar subdivision per world: fixed-point vertices (1e-7 degree), exact orientation predicates, snapping and noding, parcel lineage (a split parcel becomes the parent of its pieces, which inherit its history), point location, validated vertex moves. Poles and the 180° line need no special cases. |
| `src/world-model/` | Tables and the in-memory world | Every row type, the diff format (`before`/`after` per row) used for saving and undo, and transactions. |
| `src/temporal-engine/` | Reconstructs history | Compiles events into per-parcel timelines; answers "who holds this place at time t" exactly, including mid-transition; detects simultaneous, overlapping, stale and broken changes. Caches are rebuilt from the tables and never saved. |
| `src/domain/commands.ts` | Every user action | Each command returns its row diffs, which become one undo step. |
| `src/server/` | Local data service | SQLite project file (WAL, full sync, integrity check on open), journal for undo and redo, versions, rolling backups, export writer, HTTP bound to this computer only. |
| `src/render-engine/` | Drawing the map | Camera and projections (d3-geo), the map renderer (fills, borders, labels, transitions), stroke processing for the freehand brush. |
| `src/presentation/` | Shots and export | Shot settings (time remap, camera keys, overlays) and the export driver that renders frames off screen at the exact output size. |
| `src/export/` | Files on disk | PNG encoder, export folders, `manifest.json`, `COMPOSITING_GUIDE.txt`. |
| `src/ui/` | The interface | React. `store.ts` holds the session state and saves every command; components for the map, timeline, panels, dialogs and presentation mode. |
| `test/`, `e2e/` | Tests | See "Tests" below. |

How an edit flows: a command changes the in-memory world and returns diffs → the interface redraws at once → the diffs
are sent to the data service, which checks them against the stored rows and writes them in one transaction (or refuses
if the project changed underneath) → the journal entry is the undo step.

## Roadmap position

The approved roadmap has 14 stages (0–13). Where each stands:

| Stage | Status | Done | Still to do |
| --- | --- | --- | --- |
| 0 Groundwork | Partly done | Sphere-safe kernel, two-part time, SQLite storage, transparent PNG export, pannable/zoomable/rotatable map | Electron shell and Windows installer; Natural Earth basemap; reference-image render tests |
| 1 Project, storage, world model | Mostly done | Projects, schema, undo journal, autosave, versions, backups with restore, crash safety, multiple worlds, entities with names, colours, notes; outliner and inspector | Migration tests (only schema version 1 exists); per-world event filtering (see DECISIONS.md D8) |
| 2 Parcel map and territory editing | Partly done | Production kernel, territory brush, precise shape tool, border-point editing, snapping, smoothing, irregularity, political fills, derived borders, labels | Border pen, explicit split and merge tools, administrative boundaries, region picker, coastline clipping (all need the basemap data) |
| 3 Time and event engine | Mostly done | Instants, Gregorian calendar, events, effects with intention, compiler, any-date reconstruction, zoomable timeline, edit prompt, record mode, History Health with keep and re-apply, precedence and overlap rules | Custom event types (interface), date comparison, dated border-point moves |
| 4 Layers, entities, lore | Started | Unlimited custom layers (territory kind), alternative versions of events | Area, line and point layers; relationships; lifespans; cities; search; GeoJSON and CSV export |
| 5 First shots and export | Mostly done | Shots, time remap, start and end camera, date and title overlays, PNG sequences with passes and transparency at any resolution up to 8K and every listed frame rate, preview, manifest, compositing guide, deterministic output | Multi-key camera, styles, version-pinned shots, the Premiere checklist on the user's PC |
| 6 Transitions | Started | Advancing front and fade; borders and labels follow the animation | Arrival-time fields, front keyframes, more styles, the approved per-event "out of sync" override |
| 7–13 | Not started | | Military and movement, terrain, environment, presentation polish, space maps (nearby stars to 50 light-years), smart brushes, branches and calendars |

## Tests

| Suite | Count | What it proves | Last result |
| --- | --- | --- | --- |
| `test/core-time.test.ts` | 8 | Known Gregorian dates; calendar round trips across trillions of years; exact arithmetic and millisecond precision far apart; storage of open-ended dates; parsing and formatting human dates | Pass |
| `test/geo-kernel.test.ts` | 12 | Orientation and crossing predicates; parcels across the poles and the 180° line; nested islands; snapping; randomised point location against d3; rollback; vertex edits never break validity | Pass |
| `test/geo-kernel.stress.ts` | CLI | 12 seeds × 50 random rings with full validation after each | Pass, 0 refusals |
| `test/temporal-engine.test.ts` | 14 | Inserting, deleting or moving events never changes earlier history; compiled timelines equal a naive replay; same timestamp gives the same state after reload; simultaneous and overlapping events; stale intentions; broken references; corrections; variants; undo; dates a trillion years apart | Pass |
| `test/storage.test.ts` | 6 | Reopening keeps everything; undo and redo across reopening; atomic saves; killing the process mid-save never corrupts; versions and backups restore as undoable steps; PNG round trip | Pass |
| `test/stroke.test.ts` | 7 | Freehand outlines: closed, open, figure-eight, tiny, orientation, reproducible irregularity | Pass |
| `e2e/vertical-slice.e2e.ts` | 15 steps | The vertical slice through the real interface in Chrome, including a full stop and restart of the service, identical pixels on re-export, and 1080p output | Pass |

Also checked by hand in this session: 4K (3840 × 2160) and 8K (7680 × 4320) exports complete and look correct; the
built app runs from a folder containing only `dist/`; requests from other hosts are refused.

## Known bugs and limitations

1. **Not yet run on Windows.** The launcher, Windows paths and Explorer integration are untested until the user tries them.
2. **No basemap.** Worlds are blank spheres with a grid. Earth's coastlines need the Natural Earth data, which this session could not download.
3. **8K export speed.** About 6–9 seconds per 8K frame per pass in the development environment (4K: about 1–2 seconds). Workable for final renders; to be measured on the user's PC.
4. **Two animations meeting.** Where two simultaneous animated changes touch, their shared border is drawn throughout instead of following each front.
5. **Animation taking over another animation.** When a change starts while an earlier one is still animating the same area, the earlier one is shown at its starting state.
6. **Events are listed for all worlds.** The outliner and timeline show every event in the project, whichever world it affects (D8).
7. **View memory is per browser.** The remembered view and date are stored by the browser and are lost if the app's port changes.
8. **Interface type checking is loose.** React's type declarations were unavailable, so the interface code is checked against a minimal stand-in (D4).

## Session log

| Date | Work | Commits |
| --- | --- | --- |
| 15–16 Nov 2026 | Stage work from an empty folder: time system and kernel; world model, engine and commands; data service; interface; end-to-end fixes (closed freehand outlines collapsing, borders and labels during transitions, seam-free territory fills, view memory, safe handling of failed saves, backup restore, unique export folders, Windows launcher); documentation | `2a564fc` → latest |

## Next priorities

1. The user runs `Start Map Maker.bat` on Windows and reports what happens (acceptance check of this stage).
2. Restore the approved development set-up: a session that can install packages and a private GitHub repository.
   Then move to Electron with a Windows installer and to the deck.gl renderer (D1, D2), and add the Natural Earth basemap.
3. Finish Stage 2: border pen, split and merge, region picker, administrative boundaries, coastline clipping.
4. Finish Stage 3: custom event types, date comparison, dated border-point moves, per-world event lists.
5. Stage 4: area, line and point layers, relationships, lifespans.
