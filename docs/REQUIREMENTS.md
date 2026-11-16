# Map Maker: requirements checklist

Every major requirement from the master specification and the user's later answers, with its implementation and test
status. Last updated: 16 November 2026 (version 0.2.0 plus the Earth basemap, second session of 16 November).

**Status** (the user's classification):
**Tested** = fully implemented and tested ·
**Needs testing** = implemented but not adequately tested ·
**Partial** = some of it exists, important parts are missing ·
**Not implemented** ·
**Blocked** = technically limited at present (reason and proposal given).

**Evidence** names the automated tests (`test/…` unit and randomised tests, `e2e/…` interface tests driven in Chrome).
"Stage" is the stage of the approved roadmap where the missing part is due.

## Platform and storage

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Single user, local, offline, no accounts or cloud | Tested | `e2e/*` | The data service only accepts connections from this computer |
| Runs on the user's Windows 10 PC | Needs testing | none on Windows | Built and tested on Linux in Chrome. Interim form: local service + browser (DECISIONS D2). Not yet run on Windows |
| Projects: create, open, switch | Tested | `storage`, `e2e/vertical-slice` | |
| Autosave of every change as one atomic step | Tested | `storage`, `recovery` | |
| Survives closing and restarting the app | Tested | `e2e/vertical-slice` step 10 (service stopped and restarted) | |
| Undo and redo, kept across sessions | Tested | `recovery` (120 random steps, state compared at every step), `e2e/*` | |
| Named versions, restorable (restoring is undoable) | Tested | `storage`, `e2e/vertical-slice` step 9 | |
| Automatic backups, restorable | Tested | `storage`, `e2e/vertical-slice` | Hourly while working and on opening; 24 newest, daily for 30 days, weekly for a year |
| Crash safety: a crash mid-save never corrupts | Tested | `storage` (process killed during saves, repeatedly) | |
| Damaged project files detected, never used silently | Tested | `recovery` (damaged page, destroyed header, truncation) | New in 0.2.0 |
| Recovery of a damaged project from its newest healthy backup | Tested | `recovery` (also skips damaged backups) | New in 0.2.0; offered by the interface when a project will not open. Its interface path is not driven by an automated test |
| Malformed data inside a project reported, never crashes | Tested | `recovery` | Reported in History Health as broken references |
| Schema migrations for future versions | Partial | none | Mechanism in place; only schema version 1 exists |
| Reopening returns to the same view and date | Tested | `e2e/vertical-slice` step 10 | Remembered by the browser per project |

## Map, geography and coordinates

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Interactive map: pan, zoom, rotate | Tested | `camera`, `e2e/vertical-slice` step 2 | Fixed in 0.2.0: wheel zoom jumped away from the cursor |
| Coordinate handling, any projection, zoom 0 to city level | Tested | `camera` (round trips to 0.001 px; sub-metre at zoom 16) | |
| Map styles and geographical detail | Partial | `basemap` | One style. Land, lakes and coastlines on Earth (1:110m and 1:50m). Per-layer opacity and border width are stored but have no editor. No terrain, rivers or cities (Stages 8, 10) |
| Earth basemap with real data (coastlines, borders) | Tested | `basemap` (decoding, land share, places on land and sea across 180° and the poles, randomised culling), `e2e/vertical-slice` steps 3 and 13 | Natural Earth v5.1.2: land, lakes, coastlines, and present-day borders as a dashed drawing guide (never exported). Per-world switch, undoable. 1:10m (city-scale coasts) not yet included |
| Existing administrative boundaries | Partial | | Present-day country borders are shown as a guide only. Loading them as parcel edges (region picker) is still to do (Stage 2) |
| Coastline clipping (paint loosely over the sea) | Tested | `e2e/vertical-slice` step 16 (grid of points inside two countries: sea shows the ocean, land keeps the colour, labels on land, undo), `basemap` | At drawing time, per layer ("Territory ends at the coast", on by default). Lakes stay water. Areas in the inspector still include the sea; coastlines do not yet change over time (Stage 8) |
| Custom boundaries that follow no real division | Tested | `scenarios`, `geometry-worlds`, `e2e/*` | |
| Freehand drawing (territory brush) | Tested | `stroke`, `e2e/*` | Smoothing, irregularity, detail |
| Precise point-by-point shapes | Tested | `e2e/workflows` step 1 | |
| Vertex editing: move | Tested | `geo-kernel`, `e2e/vertical-slice` step 5 | Moves that would cross a border are refused |
| Vertex editing: add and remove | Needs testing | `geo-kernel` | Kernel tested; the interface gestures (double-click a border, Delete) are not driven by an automated test |
| Splitting and merging regions | Partial | `geometry-worlds`, `scenarios` | Drawing splits and merges territory correctly (borders appear and vanish, history keeps the pieces). No dedicated split or merge tools, no border pen (Stage 2) |
| Invalid or complex geometry handled safely | Tested | `geometry-worlds`, `geo-kernel.stress` | Fixed in 0.2.0: an outline enclosing no area or folding back could repaint the whole world |
| Geometry stored precisely | Tested | `geometry-worlds` (1e-7°, about 1 cm; exact after reopening) | |
| Shapes across the poles, the 180° line, larger than a hemisphere, metres across | Tested | `geometry-worlds`, `geo-kernel` | |
| Overlapping geographical entities | Partial | `scenarios`, `e2e/workflows` | Territories overlap freely across layers. Within one territory layer each place has one owner at a time (by design). Overlapping areas, lines and points of other kinds await those layer kinds (Stage 4) |
| Geography-aware and terrain-aware drawing | Not implemented | | Needs terrain data; will not be claimed until tested on real data (Stage 12) |
| Strategic and military drawing assistance | Not implemented | | Stage 12 |
| Geographical modification (coasts, rivers, terrain changing over time) | Not implemented | | Stage 8 |

## Worlds

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Several independent worlds with their own maps, layers and territorial history | Tested | `geometry-worlds`, `e2e/workflows` step 6 | |
| Fictional planet with custom geography, no real data needed | Partial | `geometry-worlds`, `e2e/workflows` | Territories can be drawn on a blank world of any radius. Terrain and planet generation not implemented (Stage 8) |
| No Earth-specific assumptions | Tested | `geometry-worlds` (areas follow each world's radius) | |
| Custom projections | Partial | `camera`, `e2e/workflows` step 8 | Four projections for shots. The world-building view has no projection choice; flat (non-spherical) coordinate systems are not implemented |
| Separate timelines per world | Partial | `geometry-worlds` | Territorial history is per world. Events and entities are shared by the project (DECISIONS D8); the event list shows every world's events (decision pending with the user) |
| Moon, planets, solar system, exoplanets, nearby stars (50 light-years), Milky Way, galaxies | Not implemented | | Blank spheres with correct radii only (Stages 8, 11) |

## Time and history

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Time from milliseconds to millennia, unlimited range | Tested | `core-time`, `scenarios` | Exact over ±24 trillion years |
| Gregorian dates, BCE, flexible entry | Tested | `core-time` | |
| Event creation and editing | Tested | `scenarios`, `e2e/*` | |
| Events genuinely change the world model | Tested | `temporal-engine`, `scenarios` | |
| Reconstruction at any date, from data only | Tested | `temporal-engine` (equals a naive replay), `scenarios` (same result in any entry order) | No images are stored; caches are rebuilt from the tables |
| Earlier states unchanged when later events are edited | Tested | `temporal-engine`, `scenarios` | |
| Editing one event never corrupts unrelated data | Tested | `scenarios` | |
| Inserting, deleting and moving events | Tested | `scenarios`, `e2e/workflows` step 4 | |
| Simultaneous events | Tested | `scenarios` | Precedence decides; unresolved clashes are reported until a winner is set |
| Overlapping events: never silently overwritten | Tested | `scenarios`, `e2e/workflows` | Reported in History Health; the later-starting change takes over (approved default). Fixed in 0.2.0: the report could be out of date |
| Event durations respected | Tested | `scenarios` | |
| Changes seconds apart and millennia apart | Tested | `scenarios` | |
| The edit prompt: new change, correct this period, correct for all time (border shapes) | Tested | `e2e/vertical-slice` | |
| Dated moves of border points | Not implemented | | Border points correct for all time; dated changes use the territory brush (Stage 3) |
| Broken dependencies flagged with "leave or auto-adapt" | Tested | `temporal-engine`, `recovery` | |
| Alternative versions of an event | Tested | `temporal-engine`, `e2e/workflows` step 3 | |
| Full alternative timelines | Not implemented | | Stage 13 |
| Custom event types; date comparison; fictional calendars | Not implemented | | Stages 3, 13 |
| Timeline navigation (zoom, scrub, next/previous change) | Tested | `e2e/vertical-slice` step 8 | |
| Timeline playback in world-building mode | Not implemented | | Playback exists for shots |

## Layers, entities and relationships

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Unlimited custom layers, created, shown and hidden, historically changed | Tested | `scenarios`, `e2e/workflows` step 2 | Territory layers only |
| Polygon (territory) layers | Tested | as above | |
| Line, point, route, heatmap and raster/numerical layers | Not implemented | | Stages 4, 7, 9 |
| Layer styling | Partial | | Opacity and border width per layer, no editor; no hatching or outline styles (a control layer currently looks like a second fill) |
| Exporting layers independently | Partial | `e2e/workflows` | Passes are separated by kind (fills, borders, labels…) across visible layers; a single layer is exported by hiding the others |
| Countries and factions | Tested | `e2e/*` | |
| Characters, cities, units as entities | Partial | | Can be created and described; no place on the map yet (Stages 4, 7) |
| Relationships (part of, at war with, successor of…) | Not implemented | | Stage 4. Annexation (an intention tied to two countries) exists and is tested |

## Military, characters and movement

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Occupied territory independent of political borders | Partial | `scenarios`, `e2e/workflows` step 2 | Recorded on a separate territory layer ("Military control"); tested to leave ownership untouched |
| Frontlines (several, advancing and retreating) | Partial | | The border between controllers on a control layer is a frontline and animates with an advancing front. No dedicated frontline lines, arrows or contested zones (Stage 7) |
| Contested areas, troop routes, bases, units | Not implemented | | Stage 7 |
| Character locations, movements, journeys | Not implemented | | Stage 7 |
| Civilian migration and other custom routes | Not implemented | | Stage 7 |

## Environment and heatmaps

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Disasters: explosions, destruction zones, radiation, flooding, wildfire | Not implemented | | Stage 9 |
| Expanding zones, intensity, duration | Not implemented | | Stage 9 (an expanding area can be imitated today with a territory layer and an advancing front, without intensity) |
| Permanent versus temporary change kept separate | Not implemented | | The architecture separates them (terrain effects vs condition fields); nothing built yet |
| Heatmaps | Not implemented | | Stage 9 |

## Animation and presentation

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| World-building and presentation modes on one world model | Tested | `e2e/*` | Shots never change history |
| Gradual territorial expansion (advancing front) | Tested | `scenarios`, `e2e/vertical-slice` step 11 | Borders and labels follow the front |
| Rapid occupation (instant change) | Tested | `scenarios` | |
| Fades | Tested | `scenarios`, `e2e/workflows` step 5 | |
| Fragmentation and collapse | Needs testing | `scenarios` (history), | The history is tested; their animation uses the same fade and front, without a dedicated test |
| Encirclement | Not implemented | | Needs front keyframes (Stage 6) |
| Animation length independent of historical length | Tested | `e2e/workflows` (40 years in one second), `scenarios` (a 20-minute event) | |
| Per-event "out of sync with the clock" override | Not implemented | | Approved; Stage 6 |
| Camera movement | Partial | `e2e/workflows` step 7 | Start and end views with easing, checked frame by frame in the export. No multi-key camera or flights |
| Text overlays | Partial | `e2e/workflows` step 7 | Date and title. No free text boxes or animated text |
| Shot playback | Needs testing | | Play button works by hand; not driven by an automated test |
| Spreading phenomena, animated routes, environmental effects, heatmap changes | Not implemented | | Stages 7, 9 |

## Export

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Rendered from project data, never screenshots | Tested | `e2e/*` | Frames are drawn off screen at the exact output size |
| PNG frames and sequences | Tested | `e2e/*` | |
| Transparent backgrounds | Tested | `e2e/*` | |
| Separate layer passes that stack back into the full picture | Tested | `e2e/workflows` step 7 | Fixed in 0.2.0: with several layers the passes did not match. Now max 2.6 of 255 levels apart |
| 1080p, 4K, 8K, custom sizes | Tested | `e2e/*`; 4K and 8K checked by hand | |
| Aspect ratios (16:9, 2.39:1, square, any) | Tested | `e2e/workflows` | |
| Frame rates including 23.976 and 25 | Tested | `e2e/workflows` | |
| Consistent frame timing | Tested | `e2e/workflows` (evenly spaced to the millisecond) | |
| Historical date ranges | Tested | `e2e/workflows` (pixels show the right owner at the first and last frames) | |
| Low-resolution previews | Tested | `e2e/*` | |
| Repeatable output | Tested | `e2e/vertical-slice` step 13 (identical checksums after reloading) | |
| Suitable for Premiere Pro | Needs testing | compositing maths checked | Not yet imported into Premiere on the user's PC; `COMPOSITING_GUIDE.txt` explains the steps |
| TIFF sequences | Not implemented | | Stage 10 |
| SVG | Not implemented | | Stage 10 |
| Selected geographical regions | Partial | | By framing the camera; no crop tool |
| Dataset credits travel with exports | Tested | `e2e/vertical-slice` step 13 | `manifest.json` (`dataCredits`) and `COMPOSITING_GUIDE.txt`; all datasets listed with licences under Worlds > Data sources and credits |
| Land as its own export pass | Tested | `e2e/*` (passes still stack into the full picture) | Empty for worlds without Earth's geography |
| Shots pinned to a saved version | Not implemented | | The manifest records the project's save point |
