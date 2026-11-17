# Map Maker: requirements checklist

Every major requirement from the master specification and the user's later answers, with its implementation and test
status. Last updated: 17 November 2026 (after the user's second feedback round; see DEVELOPMENT.md).

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
| Runs on the user's Windows 10 PC | Needs testing | every test on Windows (GitHub Actions, Windows Server) | Desktop app with installer (D2 reversed); all unit and interface tests pass on Windows, including the desktop app. Not yet tried on the user's own PC |
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
| Schema migrations for future versions | Tested | `event-groups` | Version 1 files upgrade to version 2 on opening, after a backup; newer files are refused untouched |
| Reopening returns to the same view and date | Tested | `e2e/vertical-slice` step 10 | Remembered by the browser per project |

## Map, geography and coordinates

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Interactive map: pan, zoom, rotate | Tested | `camera`, `e2e/vertical-slice` step 2 | Fixed in 0.2.0: wheel zoom jumped away from the cursor |
| Coordinate handling, any projection, zoom 0 to city level | Tested | `camera` (round trips to 0.001 px; sub-metre at zoom 16) | |
| Map styles and geographical detail | Partial | `basemap`, `label-style`, `fills`, `e2e/vertical-slice` | Land, lakes and coastlines on Earth (1:110m, 1:50m, 1:10m close up). Country labels styled for all and per country; countries filled with a colour, a picture (flags of 197 nations included) or a video. Per-layer opacity and border width have no editor yet. No terrain, rivers or cities (Stages 8, 10) |
| Earth basemap with real data (coastlines, borders) | Tested | `basemap` (decoding, land share, places on land and sea across 180° and the poles, randomised culling), `e2e/vertical-slice` steps 3 and 13 | Natural Earth v5.1.2: land, lakes, coastlines, and present-day borders as a dashed drawing guide (never exported). Per-world switch, undoable. 1:10m (city-scale coasts) not yet included |
| Existing administrative boundaries | Partial | `countries`, `e2e/vertical-slice` step 'Add today's countries' | Today's 242 countries (1:50m) can be added in one step, as the starting map or an event, by search, continent or all. Sub-national boundaries (geoBoundaries/GADM) and a region picker are not built |
| Coastline clipping (paint loosely over the sea) | Tested | `e2e/vertical-slice` step 16 (grid of points inside two countries: sea shows the ocean, land keeps the colour, labels on land, undo), `basemap` | At drawing time, per layer ("Territory ends at the coast", on by default). Lakes stay water. Areas in the inspector still include the sea; coastlines do not yet change over time (Stage 8) |
| Custom boundaries that follow no real division | Tested | `scenarios`, `geometry-worlds`, `e2e/*` | |
| Freehand drawing (territory brush) | Tested | `stroke`, `e2e/*` | Smoothing, irregularity, detail |
| Precise point-by-point shapes | Tested | `e2e/workflows` step 1 | |
| Vertex editing: move | Tested | `geo-kernel`, `e2e/vertical-slice` step 5 | Moves that would cross a border are refused |
| Vertex editing: add and remove | Needs testing | `geo-kernel` | Kernel tested; the interface gestures (double-click a border, Delete) are not driven by an automated test |
| Splitting and merging regions | Partial | `geometry-worlds`, `scenarios`, `e2e/workflows` | Drawing splits and merges territory; the border pen draws borders over many sessions (drafts kept with the project). No dedicated split or merge tools |
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
| Separate timelines per world | Tested | `geometry-worlds`, `event-groups`, `e2e/workflows` step 7 | Territorial history is per world. Events belong to the project and are grouped by the user (D8): the timeline shows the chosen groups; an event can be in several |
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
| Characters, cities, units as entities | Partial | `characters`, `e2e/workflows` 'A character', 'A city' | Characters travel between dated places; cities are founded (at a date or from the beginning), moved at once and abandoned; both have their own export layers. Units have no place on the map yet (Stage 7); city renames over time not yet |
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
| Text overlays | Partial | `e2e/workflows`, `events-box` | Date, title, and a fully styleable 'current events' box (with a graphic of the user's own). No free text boxes or animated text |
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

## The user's first feedback round (16 November 2026)

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Zooming during a brush stroke must not change the territory | Tested | `e2e/workflows` 'Zooming in the middle of a brush stroke' (fails on the old build) | Points are kept as map positions |
| More detailed coasts | Tested | `basemap` (1:10m tiles keep the land area) | Natural Earth 1:10m (about 200 m) when zoomed in; loads in the background |
| Maps, not worlds | Done | interface wording | Maps of cities dropped by the user (17 November, D38) |
| Quickly add today's borders and countries | Tested | `countries`, `e2e/vertical-slice` | 242 countries, by search, continent or all; colours or flags; starting map or event; one undo step |
| Label looks: for all countries, and per country | Tested | `label-style`, `e2e/vertical-slice` 'Label looks' | Font, weight, italic, capitals, spacing, colours, outline, size, opacity; per-country text, hiding, overrides |
| A picture instead of a colour; flags of today's nations; own pictures | Tested | `fills`, `e2e/vertical-slice` 'filled with a flag' | 197 flags (flag-icons, MIT) |
| A video instead of a colour, looping or playing once | Tested | `fills`, `e2e/workflows` 'filled with a video' (green then blue in the export) | Speed and start time too |
| No refusal of outlines that cross or fold back | Tested | `geometry-worlds` (bow tie, twist) | Every area the line goes around is painted |
| Draw a border over a long time, let go, come back later | Tested | `stroke`, `e2e/workflows` 'Border pen' (closes and reopens the app mid-draft) | Drafts kept in the project folder |
| Crash 'reading left_face' when adding to a country | Fixed | `geometry-worlds` regression test | |
| After drawing, 'correct this period' preselected; Enter applies | Tested | `e2e/workflows` 'Drawing flow' | |
| Right-click deselects | Tested | `e2e/workflows` 'Drawing flow' | |
| Several border changes in one event | Tested | `e2e/workflows` 'Drawing flow' | The last event used (or the selected one) is offered |
| Current events box in presentations, fully customisable, own graphic | Tested | `events-box`, `e2e/workflows` 'Current events box' | |
| Transitions in presentations: automatic or instant, as customisable as possible | Tested | `sequence`, `e2e/vertical-slice` 'Shot transitions' | As recorded / every change / none; advancing front, expansion or fade; timing, easing, front line (the wipe was removed in the second round) |
| Export settings in categories; choose the folder; 'Export'; 'All' | Tested | `storage`, `e2e/workflows` (exports into a chosen folder) | Folder picker: Electron's in the app, Windows' own in the browser version |
| Engine redesign (approved) | Tested | `kernel-incremental` (equals a full rebuild after every edit, undo and redo) | Strokes on the 24,500-parcel map 1.75 s -> 0.4 s |

## The user's second feedback round (17 November 2026)

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Labels of all countries placed correctly; every large country labelled, in its centre | Tested | `label-place` (every large country of today's 242, in four projections, inside it; 24 countries near their middle; across 180° and the pole; part on screen), `e2e/vertical-slice` (11 European countries drawn and inside) | D31. Long names on two or three lines; one label per country across layers |
| Add a present-day country's land to a country of your own | Tested | `countries` (Greece and North Macedonia into the user's country), `e2e/vertical-slice` | "Who gets the land" in the dialog; also as an event |
| Characters: points, not countries with borders | Tested | `characters`, `e2e/workflows` 'A character' | D35. Travel between places or appear; leave the map; drag to move; own export layer |
| "Correct this period" starts from the date drawn, without an event | Tested | `temporal-engine` (from its date, earlier untouched, wins at the same moment, reload), `e2e/vertical-slice` (nothing before the date) | D32 |
| View a country's borders by how they changed over time, by day, month, year or several years | Tested | `history-view`, `e2e/workflows` 'Changes over time' (green on the map, the Union listed) | D36. A selection mode in the country's panel |
| Presentation camera: reset for a clear shot; no start and end views | Tested | `sequence`, `e2e/workflows` (reset; still camera: identical backgrounds) | D34 |
| Transitions: no wipe; "Advancing front" from the existing border; the old one renamed "Expansion" | Tested | `sequence`, `e2e/vertical-slice` (the side facing the conqueror changes first, in the pixels) | D33 |
| Events box: wrap the box around the graphic | Tested | `e2e/workflows` (the exported box has the graphic's shape) | Chosen for new graphics |
| Drag the date, title and events box freely | Tested | `sequence`, `e2e/workflows` (follows the pointer; undo) | |
| Export: only "All" chosen at first, at the top, the others explained as separate | Tested | `sequence`, `e2e/workflows`, `e2e/vertical-slice` | D37. The choice is kept with the shot |
| Estimated total export size | Tested | `e2e/workflows` (compared with a real export) | D37 |
| No maps of cities (space maps still wanted) | Superseded | | D38; the third round allowed them at no performance cost (D44) |

## The user's third feedback round (17 November 2026)

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Grey borders left by a deleted country ("Since the starting map") | Fixed | `temporal-engine`, `workflow` | Deleting takes it out of history; older projects: land shown as nobody's, History Health removes them |
| "+ Layer" did nothing | Fixed | `e2e/desktop` (adds a layer), `e2e/workflows` | The desktop app has no browser prompt; the app's own dialog is used (also for group and alternative names) |
| Cities listed with the countries they belong to | Tested | `e2e/workflows` 'Working with many' | Under the country whose land they stand on at the date viewed |
| Group and categorise countries in the list | Tested | `workflow`, `e2e/workflows` | Groups (folders) that fold away; made from a choice by right-click or "New group…" |
| Right-click menus with quick actions; for groups too | Tested | `e2e/workflows` | Hide or show labels, pictures off or on, move to a group, delete; a group's menu does it for all of it |
| Choose several with Ctrl (and Shift) | Tested | `e2e/workflows` | |
| Delete many events quickly | Tested | `workflow` (one undo), `e2e/workflows` (Shift + click three, Delete) | Also countries; Delete key and menus |
| Labels and city names move apart or the less important is hidden | Tested | `e2e/workflows` (nothing drawn overlaps; two cities side by side) | D43. Countries before cities, larger before smaller |
| A tool to erase borders | Tested | `e2e/vertical-slice` 'Border eraser' | D42 |
| City (flat) maps, only with no performance cost | Tested | `flat-maps` (true to scale within 1%, straight borders, labels), `e2e/workflows` 'A flat map' | D44: the same kernel, nothing slower |

## The user's fourth feedback round (17 November 2026)

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| The events box should show an event again each time it gains territory, without several events of the same name | Tested | `events-box` (one event, three advances, shown at each) | D45. Choose the same event when drawing later; the prompt says so |
| Ctrl+Z with the border pen undid project changes | Fixed | `e2e/workflows` 'Border pen' (Ctrl+Z, Ctrl+Y, project untouched) | D45 |
| City and character labels the same size whatever the zoom | Fixed | `e2e/workflows` 'A city' (no name at world zoom, named close up) | D46; sizes in the Label style dialog |
| Next step: names over time | Tested | `names`, `e2e/workflows` 'A city' (renamed in 1620) | D47 |

