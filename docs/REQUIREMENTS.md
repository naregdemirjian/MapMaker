# Map Maker: requirements checklist

Every major requirement from the master specification and the user's later answers, with its implementation and test
status. Last updated: 18 November 2026 (Stage 4; see DEVELOPMENT.md).

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
| Map styles and geographical detail | Partial | `basemap`, `label-style`, `fills`, `terrain`, `terrain-look`, `rivers`, `biomes`, `detail`, `terrain-tiles-server`, `e2e/vertical-slice`, `e2e/workflows` | Land, lakes, rivers (D99) and coastlines on Earth (1:110m, 1:50m, 1:10m close up). Terrain on Earth maps (D94, D95): land coloured by height and the sea by depth, relief shading, relief of the sea floor and over the countries, two palettes, and a satellite look with the land coloured by Natural Earth's land cover (D100); Earth's heights at about 10 km, and close in finer ones (to about 40 m) downloaded as needed and kept on the computer (D101); the land cover at about 10 km. Country labels styled for all and per country; countries filled with a colour, a picture (flags of 197 nations included) or a video. Shots can be drawn in their own look (D108): Classic, Parchment, Atlas, Night, Blueprint, Minimal or Wartime map, each colour changeable, with a colour grade, darker edges and paper grain. Per-layer opacity and border width set in the Layers section (the drawing layer) |
| Earth basemap with real data (coastlines, borders) | Tested | `basemap` (decoding, land share, places on land and sea across 180° and the poles, randomised culling), `e2e/vertical-slice` steps 3 and 13 | Natural Earth v5.1.2: land, lakes, coastlines, and present-day borders as a dashed drawing guide (never exported). Per-world switch, undoable. 1:10m (city-scale coasts) not yet included |
| Existing administrative boundaries | Tested | `countries`, `regions`, `e2e/vertical-slice` step 'Add today's countries', `e2e/workflows` 'Region picker' | Today's 242 countries (1:50m) in one step; today's 4,596 states and provinces (Natural Earth admin-1, 1:10m) and today's countries picked on the map with the Regions tool (D78). geoBoundaries and GADM (finer, other licences) are not included |
| Coastline clipping (paint loosely over the sea) | Tested | `e2e/vertical-slice` step 16 (grid of points inside two countries: sea shows the ocean, land keeps the colour, labels on land, undo), `basemap` | At drawing time, per layer ("Territory ends at the coast", on by default). Lakes stay water. Areas in the inspector still include the sea; coastlines do not yet change over time (Stage 8) |
| Custom boundaries that follow no real division | Tested | `scenarios`, `geometry-worlds`, `e2e/*` | |
| Freehand drawing (territory brush) | Tested | `stroke`, `e2e/*` | Smoothing, irregularity, detail |
| Precise point-by-point shapes | Tested | `e2e/workflows` step 1 | |
| Vertex editing: move | Tested | `geo-kernel`, `e2e/vertical-slice` step 5 | Moves that would cross a border are refused |
| Vertex editing: add and remove | Needs testing | `geo-kernel` | Kernel tested; the interface gestures (double-click a border, Delete) are not driven by an automated test |
| Splitting and merging regions | Tested | `split-merge` (3 tests), `geometry-worlds`, `scenarios`, `e2e/workflows` 'Split and merge' | D76. The Split tool cuts a country along a drawn line; "Merge into one" joins chosen countries; the brush and the border pen also split and merge |
| Invalid or complex geometry handled safely | Tested | `geometry-worlds`, `geo-kernel.stress` | Fixed in 0.2.0: an outline enclosing no area or folding back could repaint the whole world |
| Geometry stored precisely | Tested | `geometry-worlds` (1e-7°, about 1 cm; exact after reopening) | |
| Shapes across the poles, the 180° line, larger than a hemisphere, metres across | Tested | `geometry-worlds`, `geo-kernel` | |
| Overlapping geographical entities | Partial | `scenarios`, `features`, `e2e/workflows` | Territories overlap freely across layers. Within one territory layer each place has one owner at a time (by design). Areas, lines and points on feature layers overlap freely (D71) |
| Geography-aware and terrain-aware drawing | Tested | `smart-brush` (synthetic terrains with known best paths), `follow-land`, `e2e/workflows` 'Smart brushes' (real data: a stroke beside the Rhine onto the river's course; the Pyrenees' crest) | D148. The geography-aware brush: a stroke pulled to rivers, coasts and lakes, ridges and valleys, the map's borders, today's borders and the lines on its layers, by weights, shown adjusted beside the stroke before it is used; pins. Forest edges and roads from data not offered (none bundled) |
| Strategic and military drawing assistance | Tested | `smart-brush` (far banks either side; a town and a pass pulled onto your side), `e2e/workflows` 'Smart brushes' (a town pulled onto your side; the sides swapped) | D148. The strategic brush: rivers to their far bank, ridges to the crest, rough ground as a buffer; towns, the points placed on the map and mountain passes pulled onto your side, each as strongly as set |
| Geographical modification (coasts, rivers, terrain changing over time) | Partial | `sea-level`, `sculpt`, `rivers`, `paleo`, `e2e/workflows`, `e2e/render-compare` | The Earth through geological time (D134): its land, sea floor and coasts as they were from 540 million years ago to today (PALEOMAP), moving between moments 5 million years apart along the plates' motion (D135), with the seas of the last glacial cycle; dates that far back written and read as how long ago. Sea level over time (D96): the sea higher or lower than today's at chosen dates, steady between them, with an end-of-the-ice-age preset; the coasts follow the terrain, and so do land and territory that end at the coast. The terrain sculpted with twelve brushes, in the base world or from a date on (D98). Rivers (D99): Natural Earth's on the Earth, which stay where they are today; a planet's worked out from its heights, following sculpting. Rivers changing course over time: not yet |

## Worlds

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Several independent worlds with their own maps, layers and territorial history | Tested | `geometry-worlds`, `e2e/workflows` step 6 | |
| Fictional planet with custom geography, no real data needed | Partial | `geometry-worlds`, `planet`, `sculpt`, `rivers`, `biomes`, `e2e/workflows` | Territories can be drawn on a blank world of any radius, or on a generated planet (D97): seven presets, a seed and sliders (sea, continents, mountains, roughness, ice caps), its own coasts, colours and relief; territory ends at its coast; its terrain sculpted by hand (D98); rivers worked out from its heights, running downhill to the sea (D99); biomes from its climate (warmth by latitude and height, rain belts, winds, rain shadows) in the satellite look (D100) |
| No Earth-specific assumptions | Tested | `geometry-worlds` (areas follow each world's radius) | |
| Custom projections | Partial | `camera`, `e2e/workflows` step 8 | Four projections for shots, and the globe (below). The world-building view has no projection choice; flat (non-spherical) coordinate systems are not implemented |
| A globe that turns, for shots (orthographic) | Tested | `sequence` (turning on its own at the speed set), `e2e/render-compare` (places where the flat map has them, lit, within 1.3 levels; nothing beyond its edge; only near-side names; a pole and 180° without a seam; the flat picture kept while it turns), `e2e/workflows` (chosen, dragged to turn, set turning, exported as frames and an SVG frame) | D127. Drawn from a flat picture of the part in view laid on a lit sphere on the graphics card; names upright over it. The working view stays flat |
| Separate timelines per world | Tested | `geometry-worlds`, `event-groups`, `e2e/workflows` step 7 | Territorial history is per world. Events belong to the project and are grouped by the user (D8): the timeline shows the chosen groups; an event can be in several |
| Moon, planets, solar system, exoplanets, nearby stars (50 light-years), Milky Way, galaxies | Tested | `space`, `solar`, `invented`, `galaxy`, `exoplanets`, `e2e/workflows` 'A star map', 'The solar system', 'An invented star map', 'The Milky Way', 'How the stars look' | Star maps of the 982 stars within 50 light-years (HYG v4.1) in three dimensions, with their names, kinds and systems (D110); stars held by countries and factions over time, drawn as realms (D111); lanes between stars, growing over an event for expeditions and fleets (D112); the solar system with the planets where they are on any date (D113); invented star maps for settings of one's own, stars found by search (D114); the Milky Way with its arms, 33 places and star systems to hold, and galaxies of one's own (D116); the large moons round their planets on the solar system map (D117); the known planets of the nearby stars (D118); how the stars look, every part of it, with presets and looks by chance (D130); the map as a flat chart (D131); realms as territories with borders and fronts, won star by star in shots (D132); the solar system side by side, its holders over its planets (D133); shots and exports. Moons and planets as worlds: blank or generated round maps (Stage 8) |

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
| Dated moves of border points | Tested | `split-merge` (dated moves), `e2e/workflows` 'Split and merge' | D77. A point on a border between two countries; junctions use the territory brush |
| Broken dependencies flagged with "leave or auto-adapt" | Tested | `temporal-engine`, `recovery` | |
| Alternative versions of an event | Tested | `temporal-engine`, `e2e/workflows` step 3 | |
| Full alternative timelines | Tested | `branches` (what each timeline holds, edits by date, refusals, nesting, deleting, random edits followed against a fresh compile), `e2e/workflows` 'Branches' | D150: branches split at a date from the main timeline or another branch, share everything before it live, have their own events after; switched from the title bar; compared with another timeline side by side or across a line; shots of a branch |
| Comparing two dates (a line across the map, dragged) | Tested | `temporal-engine` (when the last change began), `e2e/workflows` 'Compare two dates' (both sides by their colours, the line dragged both ways, the dates swapped) | D74 |
| Custom event types (templates: colour, way of spreading, usual length) | Tested | `event-types` (3 tests), `e2e/workflows` 'Event types' | D75. Type-specific fields wait for a use |
| Tidying unused parcel edges (long-term upkeep) | Tested | `tidy` (history unchanged in every timeline and version, undo, random histories), `e2e/workflows` 'Upkeep and sound' | D151: History Health › Upkeep › Tidy this map |
| Audio reference track for shots | Tested | `storage` (the copy beside exports, manifest, guide), `e2e/workflows` 'Upkeep and sound' (waveform, offset, export) | D151: heard while the shot plays (its clock moving the frames), waveform under the frames, copied beside every export; not mixed into videos |
| Fictional calendars | Tested | `custom-calendar` (templates against known dates, round trips, eras, day lengths, weeks, refusals, a map given one), `e2e/workflows` 'A map's own calendar' | D149: per map; months, leap rules, epoch, hours in a day, week, eras or a year zero; Julian, French Republican, thirteen months and an invented world's calendar as templates; dates written, typed, stepped and chosen in it everywhere |
| Timeline navigation (zoom, scrub, next/previous change) | Tested | `e2e/vertical-slice` step 8 | |
| Timeline playback in world-building mode | Tested | `e2e/workflows` 'Playing history' | D119. Play and pause (Space), a month to a thousand years a second, going round at the end |

## Layers, entities and relationships

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Unlimited custom layers, created, shown and hidden, historically changed | Tested | `scenarios`, `e2e/workflows` step 2 | Territory layers only |
| Polygon (territory) layers | Tested | as above | |
| Line, point, route, heatmap and raster/numerical layers | Partial | `features` | Area, line and point layers with lifespans and dated shapes (D71): claims, zones, roads, front lines with teeth, arrows, battles and other symbols; their own export pass. Drawn with their own tool, chosen on the map, listed and styled in their own panel (`e2e/workflows` 'Areas, lines and points'). Heatmaps: conditions layers, from points too (D102, D105). Routes: lines with flowing marks and campaign arrows (D106). Raster/numerical layers: later stages |
| Layer styling | Partial | `features`, `e2e/workflows` | Territory layers: opacity and border width, no editor. Areas, lines and points: colour (or their country's), fill opacity, hatching (diagonal, crossed, dotted), line width and dashes, front-line teeth, arrowheads, point symbols and sizes, names on the map; per layer and per feature (D71). Hatching for occupied territory on territory layers is still to come |
| Exporting layers independently | Tested | `sequence`, `e2e/workflows` 'Each layer on its own' | Passes by kind (fills, borders, labels…) across visible layers, and each layer on its own (D124): a territory layer's fills and borders, a layer of areas, lines and points, a layer of conditions |
| Countries and factions | Tested | `e2e/*` | |
| Characters, cities, units as entities | Partial | `characters`, `e2e/workflows` 'A character', 'A city' | Characters travel between dated places; cities are founded (at a date or from the beginning), moved at once and abandoned; both have their own export layers. Units have no place on the map yet (Stage 7); city renames over time not yet |
| Relationships (part of, at war with, successor of…) | Tested | `relations`, `e2e/workflows` 'Relationships' | At war, allied, part of, vassal of, member of, leads, successor of, travels with; each holds over periods begun and ended at dates or by events, read from either side (D72). Annexation (an intention tied to two countries) is separate and tested. Their use on the map (front lines from wars) is Stage 7 |
| Lore: notes with pictures | Tested | `e2e/workflows` 'Search, pictures…' | Notes on every country, faction, character, city, area, line and point, descriptions on events; pictures kept with any of them (thumbnails, opened large) in the project's pictures folder (D73) |
| Search | Tested | `search-export`, `e2e/workflows` 'Search, pictures…' | Names, every name something went by, notes and descriptions; accents and case ignored; going to a result chooses it and brings the date and the view to it; Ctrl+F (D73) |

## Military, characters and movement

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Occupied territory independent of political borders | Tested | `scenarios`, `e2e/workflows` step 2 (the occupation drawn with stripes: the occupier's colour and the owner's both in the pixels) | Recorded on a separate territory layer ("Military control"); tested to leave ownership untouched. The layer can be drawn with stripes, crossed stripes or dots in each owner's colour, the map showing through (D88) |
| Frontlines (several, advancing and retreating) | Tested | `e2e/workflows` 'Relationships' (a front line on the border of two countries at war in 1855, none in peace in 1865, in the pixels) | Any number of wars, each a front line along the shared border on a chosen layer while the war holds, with teeth toward either side or none, in a colour of one's own (D89); on a control layer it moves with control, animated by the advancing front. Arrows and contested zones: Stage 7 |
| Contested areas, troop routes, bases, units | Tested | `units`, `e2e/workflows` 'A unit' (in its country's colour; an arrow of advance while it travels, none when it stands) | Units are characters belonging to a country, drawn in its colour, with an icon (tank, army, warship…) and a trail or an arrow of advance (D90); bases are units that stay put (fort, naval base icons). Contested areas: an area of a claim or zone contested with another country, in stripes of both colours (D93; `features`, `e2e/workflows` 'Areas, lines and points') |
| Character locations, movements, journeys | Tested | `characters`, `units`, `e2e/workflows` 'A character', 'A unit' | Characters are points placed at dated places, travelling between them over time (D35); their trails shown in shots, icons turned the way they travel (a ship, an airliner); units the same in their country's colour with arrows of advance (D90) |
| Civilian migration and other custom routes | Tested | `routes`, `e2e/workflows` 'Routes' | D106. Any line can have dashes, chevrons or dots flowing along it the way it was drawn as a shot plays (migrations, supply lines, trade), or be drawn as a broad campaign arrow that grows along its path as its event goes on |

## Environment and heatmaps

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Disasters: explosions, destruction zones, radiation, flooding, wildfire | Partial | `fields`, `spread`, `e2e/workflows` | Conditions (D102): radiation, fire, smoke and ash, flood, destruction, from sources placed with a click, round with uneven edges or carried downwind as plumes, rising, lasting and fading; wildfires, lava and floods spreading over the real terrain (D103); disasters placed with one click from templates sized by yield, magnitude, explosivity, depth or size: nuclear strikes, earthquakes, eruptions, floods, wildfires, meteor impacts (with their crater), droughts (D104) |
| Expanding zones, intensity, duration | Tested | `fields`, `e2e/workflows` | A source's edge grows to its size over days; its strength rises, lasts and halves every so many days until it fades (D102) |
| Permanent versus temporary change kept separate | Tested | `fields`, `sculpt`, `sea-level` | Temporary conditions are field layers that fade by themselves (D102); permanent changes are the terrain's: sculpting (D98) and the sea level (D96). A meteor impact makes both at once: its conditions fade, its crater stays (D104) |
| Heatmaps | Tested | `fields`, `e2e/workflows` | A Heatmap kind of conditions layer, its sources placed by hand (D102) or worked out from a layer of points that change over time, each point a soft spot of a chosen size, the colours full where a chosen number overlap (D105); three thousand strikes drawn at 4K in about half a second |

## Animation and presentation

| Requirement | Status | Evidence | Notes |
| --- | --- | --- | --- |
| World-building and presentation modes on one world model | Tested | `e2e/*` | Shots never change history |
| Gradual territorial expansion (advancing front) | Tested | `scenarios`, `e2e/vertical-slice` step 11 | Borders and labels follow the front |
| Rapid occupation (instant change) | Tested | `scenarios` | |
| Fades | Tested | `scenarios`, `e2e/workflows` step 5 | |
| Fragmentation and collapse | Needs testing | `scenarios` (history), | The history is tested; their animation uses the same fade and front, without a dedicated test |
| Encirclement | Tested | `pincers` (two ends change hands first, the middle last, everything at the end; undone; only an expansion has starting points), `engine-follow` (expansions from several points among the random edits), `e2e/workflows` 'Recording into an event' (a second starting point clicked on the map, then taken away) | An expansion from several starting points at once (D91). Keyframed fronts: Stage 6 |
| Animation length independent of historical length | Tested | `e2e/workflows` (40 years in one second), `scenarios` (a 20-minute event) | |
| Per-event "out of sync with the clock" override | Tested | `sequence` (its own seconds whatever the pace, timed by events or seconds; stored, checked, cleared, undone), `e2e/workflows` 'A shot framed in the preview' (the union of 1900 set to 0.4 s in its panel: half way 5 frames on, over 11 frames on, against the same frames following the clock) | D92. In any shot that animates; recorded animations keep their style |
| Camera movement | Partial | `e2e/workflows` step 7 | Start and end views with easing, checked frame by frame in the export. No multi-key camera or flights |
| Text overlays | Tested | `e2e/workflows`, `events-box`, `text-boxes` | Date, title, a fully styleable 'current events' box (with a graphic of the user's own), and any number of text boxes and callouts (D107): styled, wrapped, timed by the shot's seconds or by history's dates, coming in and going (fade, rise, pop, typed out, sink), pointing at places |
| Shot playback | Tested | `e2e/workflows` 'Playing a shot' | Play runs through the frames at the shot's pace and stops on the last; played again from the start; paused where it is; the frame slider |
| Spreading phenomena, animated routes, environmental effects, heatmap changes | Tested | `fields`, `spread`, `disasters`, `routes`, `e2e/workflows` | Conditions that rise, last and fade, plumes carried by the wind, fires, lava and floods spreading over the terrain, heatmaps following points over time (D102–D105). Animated routes: lines with marks flowing along them and campaign arrows growing along their path (D106) |

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
| TIFF sequences | Tested | `tiff`, `e2e/workflows` 'TIFF sequences' | D109. Uncompressed or ZIP, 8-bit with straight alpha; chosen per shot |
| Video files (MP4, WebM) | Tested | `video-mux`, `e2e/workflows` 'Videos', `e2e/desktop` | D121. A shot as one MP4 (H.264) or WebM (VP9) file, encoded by the computer itself; exact frame rates (23.976 as 24000/1001); best, good or small; whole picture, no transparency |
| SVG | Tested | `svg-pen`, `svg-frame`, `e2e/workflows` 'SVG frames' | D115. One frame of a shot: countries, borders, features, cities, names, characters and texts as shapes and text in named layers; sea, terrain, land and conditions as pictures; within 2% of the PNG frame |
| GeoJSON and CSV export of the data | Tested | `search-export` (polygon areas equal the map's land), `e2e/workflows` | The map at a date as GeoJSON (territories joined owner by owner with holes, areas, lines and points, cities and characters, RFC 7946 winding); events, entities with their other names, relationships by period and features over time as CSV (D73) |
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
| Import a dataset that dates each shape (CShapes and similar) | Tested | `geojson-import`, `e2e/workflows` 'Importing a dataset that dates each shape' | D123. From and to properties found; each shape its country's land between its dates; one undo step |
| A shot of the whole history in one click | Tested | `e2e/workflows` 'Importing borders' | D122. From the first change to the last at an even pace, the year shown, every change animated |
| Import borders from files (maps of several dates) | Tested | `geojson-import`, `e2e/workflows` 'Importing borders' | D120. GeoJSON maps, one per date (years read from the file names): countries go on by name, land a map does not show becomes nobody's; borders drawn again within 5 km follow those already there (no slivers, islands kept whole; 242 countries a map in 1–4 s); one undo step a file |
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
| Animated areas, lines and points: a line draws itself, an area grows, a shape fades in or out | Tested | `features` (progress, the shape before, at once without an event or a length; the line cut part way), `e2e/workflows` 'Animated features' | D79 |
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

## The user's optimisation request (17 November 2026)

"Completely and absolutely optimise everything for performance", before more detail is added to the maps. Measured in
Chrome with software drawing (no graphics card) on the map of today's 242 countries with 1:10m coasts, 1360 x 843;
see DEVELOPMENT.md, "Performance", for the tables and the other benchmark projects.

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Coast detail must not cost frame rate zoomed out, and stay detailed zoomed in | Done | `bench/render.bench.ts` (panWorld 325 ms to 20 ms a frame), `plane` tests | D49: detail chosen per zoom from ranked points; D50: blocks |
| Frame rate fell when zoomed in very far | Fixed | `bench` panDeep 522 ms to 31 ms, panVeryDeep 3.1 s to 32 ms | D49: only what the view shows is prepared |
| Projects with every country were very slow | Done | `bench`: unchanged frame 249 ms to 17 ms, scrubbing 224 ms to 7 ms, a brush stroke 693 ms to 40 ms | D48, D49, D54 |
| Exports heavily optimised | Done | `bench`: 1080p 730 ms to 92 ms a frame, 4K 2.3 s to 203 ms, eight layers of each frame 3.9 s to 192 ms | D52; identical pixels on re-export still checked in `e2e/vertical-slice` |
| Weaker computers | Done | Settings presets; `e2e/workflows` 'Settings' | D53 |
| A Settings button with performance options that never touch the final render or limit what can be made | Done | `e2e/workflows` 'Settings'; `blocks` test (stored settings) | D53 |
| Editing stays rapid on a massive project | Done | `bench` on "Bench Heavy" (128,000 border segments, 11,000 parcels, 500 events) | D48–D51, D54; stepping through time across many events is the slowest thing left (DEVELOPMENT.md) |

## The user's second optimisation request (17 November 2026)

"Continue optimising the whole workflow … try stress testing it a lot … I'm going to be using this software rapidly
all while having massive projects up, and also while using a slower computer." Measured like the first request, on
the same three benchmark projects, against the build before this stage, the two measured one after the other
(DEVELOPMENT.md, "Performance after the second optimisation stage", has every figure).

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Moving and zooming the map on massive projects | Done | `bench/render.bench.ts`: moving 14–34 ms a frame to 5–9 ms, zooming 32–55 ms to 20–25 ms; `e2e/render-compare` (carried pictures equal fresh ones, 170 small moves, the planet's ends in view) | D58, D61–D64, D70 |
| Rapid editing: strokes, undo, choosing, lists | Done | `bench`: a stroke 72–85 ms to 29–37 ms (188 to 120 ms with 24,500 parcels); `engine-follow` (random edits followed one by one equal a full recomputation); `e2e/render-compare` (the patched picture equals a fresh one) | D55, D56, D58 |
| Dragging and stepping the timeline | Done, with a known rest | `bench`: a year a frame 33 to 13 ms on the heavy project, 42 to 27 ms with a thousand territories; a timeline drag through changes under way: 9 in 10 frames under 20 ms (62 ms); `e2e/render-compare` (into, out of and between changes) | D58, D60, D65, D68. A dozen events crossed in one frame still costs 90–150 ms on the largest projects |
| Framing a shot in Equal Earth or Natural Earth | Done | `bench` panWorldEE, panRegionEE: 170–240 ms a frame to 5–11 ms; `camera` test; `e2e/workflows` 'Framing a shot in Natural Earth'; `e2e/render-compare` (held views) | D67. While dragged the map keeps its middle meridian and straightens a little at rest; "While the map moves: drawn again" in Settings keeps every frame exact |
| Playing and exporting | Done | `bench`: exported frames of the heavy project in half the time (1080p 264 to 127 ms, 4K 545 to 269 ms, eight layers 502 to 300 ms), of today's 242 countries a seventh faster; `e2e/render-compare` (an 80-frame shot drawn as an export draws it equals frames drawn afresh); identical re-export still checked | D61, D64, D68. Each exported frame is drawn from the one before where the camera is still: at most 0.012% of a picture's pixels differ from one drawn afresh, by single steps of smoothing on outlines |
| The estimated export size | Done | `e2e/workflows`: the estimate and the preview's figure within a factor of 2.5 of what is written | D69: it was half too high for 4K and less than half of the truth for a preview, and froze the shot editor for half a second |
| Opening a project | Done | `bench/open.ts`: 2.9–5.9 s to 1.9–3.5 s | D66 |
| A slower computer | Done | `bench/stress.ts --throttle 4` on the heavy project: a session of 150 random steps 113 s to 62 s; a stroke 344 to 159 ms, moving the map 148 to 56 ms a frame, dragging the timeline 150 to 77 ms a frame, undo 312 to 182 ms | D65: the sharp redraw waits for the frame, so a slow computer no longer draws twice |
| Long sessions on massive projects | Done | `bench/stress.ts`: memory level after the first hundred steps on all three projects; `kept` test | D59 |
| Stress testing | Done | `bench/stress.ts`: thirteen sessions of 160–300 random steps on the three projects (three at twice the pixel density, one in Equal Earth), and four times slower in both presets; every tenth frame compared with a fresh drawing; the verify mode checks history, snapshots and borders against a full recomputation | D57, D69. Six defects found and fixed (DEVELOPMENT.md, status) |

## The user's fifth feedback round (18 November 2026)

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| The territory brush gives land to the country selected | Tested | `e2e/workflows` 'Region picker' (a country chosen in the list is the brush's owner) | Choosing a country or faction in a list or panel, or a place on the map that a country holds, makes it the brush's owner (a click on the sea leaves the owner as it was) |
| An event's end starts at its start; dates chosen on a calendar with arrows, or typed | Tested | `core-time` (stepping by day, month, year; years typed alone), `e2e/workflows` 'Dates' (the end shown greyed and left alone, the calendar two months on and a year typed, keyboard in the calendar, the date viewed stepped by the arrow keys) | D80 |
| Border points still visible after their borders were erased | Fixed | `split-merge` (an erased border's point hidden, the coast's kept, the old border's points shown before the date) | D81 |
| Flags fit every country (France, Russia, Spain…); pieces far apart get their own copy, clustered islands share one | Tested | `fill-clusters` (today's France, Spain, Russia, the USA, Japan, Indonesia and others; the 180th meridian; the fits) | D82. Checked by eye on all of today's countries at world and continent zoom |
| For one's own countries: one picture over all, one per piece, or a copy beyond a distance (slider) | Tested | `fill-clusters` (the three rules, a distance of 10, 300 and 2,000 km) | D82 |
| Greenland has no flag or country | Fixed | `fills` (40 territories' flags, Greenland's with Denmark), `e2e/vertical-slice` 'Add today's countries' (Greenland listed, left out when asked) | D82. Territories are added as countries of their own by default |
| Borders of countries that do not align with the coasts | Fixed | `e2e/render-compare` (the coastal band against the reference renderer, which follows the same rule); checked by eye on Denmark, Greece, Norway's fjords and Europe; `bench/render.bench.ts` (a stroke's redraw 0.5 ms more) | D83. Today's countries stay at 1:50m (1:10m measured: five times heavier); land along the coast that no country covers takes the look of the country beside it |
| A menu for what is shown while working and in exports; a slider for the smallest lake shown | Tested | `basemap` (a lake less its islands, the pieces of a cut lake counted together, Lake Victoria the same size at both scales, the settings apart and undoable), `e2e/workflows` 'What is shown' (names and lakes hidden while working, kept in the presentation; lakes from about 1,000 km²; undone) | D84. Borders, names, cities, characters, feature layers, lakes, coastlines, grid lines; a shot's own choices still apply |
| Change the icon of characters; a designed set (ships, civilian and military planes, freighters, a lot of military) | Tested | `icons` (every shape well formed and on its grid; ids, names, groups, how each turns), `characters` (which way a character faces while travelling, after arriving, never before; the icon setting checked, cleared, undone), `e2e/workflows` 'A character's icon' (a sailing ship facing east, flipped on the way back west, an airliner's nose to the west, on a disc, 300%, in the list, back to the marker) | D85. 46 icons in five groups; a picture of one's own; plain or on a disc; size; facing the way of travel |
| Recording into an event: how long each change takes; choices such as all at once, or each lasting until the next one recorded | Tested | `record-lengths` (the event's length, a date of its own, a time from its own date; recorded until the next change, out of order too, undone together; a length chosen afterwards), `engine-follow` (lengths and chained recording among the random edits), `e2e/workflows` 'Recording into an event' (three changes each until the next, the middle one half faded in half way, the panel's spans, the last given two years) | D86. At once, until the next change recorded, until the event ends, or over a set time; as an advancing front, an expansion or a fade |
| Lock or disable countries (or groups) that do not change on large projects | Tested | `locks` (a stroke across a locked country changes only the land around it and names it; no land given to one; split, merge and annexation refused; unlocked and undone), `e2e/workflows` 'Locked countries' (locked from its menu, drawn over, kept, shown locked in the brush's list, unlocked from its panel, all the others locked at once, undone) | D87. Measured first: edits on the whole world already cost in proportion to what they touch (27 ms a stroke, 20 ms to redraw), so a lock protects rather than speeds up |

## Transitions overhauled (19 November 2026)

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Borders and the borders round a change worked out so that a transition never gets in the way | Tested | `front-field` (a U taken from the tip of one arm goes down it, round the bottom and up the other, never across the gap; an island reached after the shore facing it; from the middle; from the side facing land across the sea), `e2e/render-compare` (the reference renderer the same; no old border behind the front, no seam, no border where two changes meet before a front gets there) | D136. A front travels through the land itself, from the border with the new owner's land, the side facing it, or the middle; land given up is let go from its outer edges |
| Clean by default; intense when wanted | Tested | `sequence` (every look named and within range; Blitz intense, Minimal without a line), `e2e/render-compare` 'Looks' (a sharp edge against a soft one; a glow behind the front; the line in the owner's colour) | D137. Looks: Clean (the default), Minimal, Soft tide, Ink, Campaign, Blitz, In their colours, Dissolve, Fade |
| Very simple to use | Tested | `e2e/workflows` 'Transition looks' (one list of looks; its live preview plays) | D137. One choice of look, with a short note and a preview of a sample change playing in it |
| Never limiting what can be made | Tested | `e2e/workflows` 'Transition looks' (a slider makes the look the shot's own, the rest kept; the line and glow in the owner's colour; an event's own look), `e2e/render-compare` 'Looks' (an event in the Blitz look glowing behind its front, the other change not) | D137. Ragged edge, soft edge, glow behind the front, the line's colour, width and glow; style, timing and easing; any event a look of its own, here and in every shot |
| The front line never runs along a change's own edges | Tested | `front-field` (the front's own lines across the land, never along a narrow gap or round an island not yet reached), `e2e/render-compare` 'Looks' (no line along the change's edge behind the front) | D137 |
| Fronts slowed by terrain (the item left of the transitions stage) | Tested | `front-field` (a slow band crossed late and gone round), `front-terrain` (plains as ever; flanks, crests and the sea slower, by as much as asked), `sequence` (off unless asked; the Overland look; when the heights are wanted), `e2e/render-compare` 'Fronts that mind the land' (behind over mountains, ahead over the plain; as ever without heights or when not asked) | D142. One slider in Adjust the look, and the Overland look. Rivers, roads and passes do not count yet |
| A transition never leaves anything behind | Tested | `plane` (arcs' latitudes; boxes), `front-source` (the bow of a long border), `e2e/render-compare` 'A long straight border bows' | D144. Found by eye with a front across the Alps: a strip under a long straight border kept the old colour during the change. Fixed |
| A front's line and glow stay on the land, like the territory | Tested | `e2e/render-compare` 'Where the terrain decides the coast' | D145. Found by eye on a generated planet: they ran on over the sea where the terrain decides the coast. Fixed |
| A dissolve at an even pace | Tested | `front-field` (the share taken is the share of the time gone, for every pattern), `e2e/render-compare` 'Looks' | D147. Found by a Windows run: by the luck of its pattern a dissolve could be nine tenths done at half time. Fixed |

## Maps enhanced (19 November 2026)

| Request | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Satellite maps very photorealistic and detailed when zoomed in, still good at the scale of a city | Tested | `photo` (which tiles a view needs, to 10 m a pixel; the bundled picture and its record), `terrain-tiles-server` (picture tiles kept on the computer), `e2e/workflows` 'Terrain' (the planet as photographed, its credit, picture tiles shown close in) | D138. The Earth as photographed (Sentinel-2 cloudless 2016 by EOX, CC BY 4.0): the whole planet bundled; close in, the place's photographs downloaded as needed and kept. Checked by eye on Paris, New York, Tokyo, Cairo and Sydney: streets, rivers, parks and blocks. Generated planets keep their biomes (finer detail for them is next) |
| Enhance all the maps, detailed when zoomed in | Tested | `e2e/workflows` 'Terrain' (fine ground close in: more to see with the bundled heights alone, the same at every visit), `e2e/render-compare` 'Close in, a coast the terrain decides bends' | D141, D146. Below the heights' own detail every terrain look (natural, atlas, satellite, the planets' own) has relief and mottling made up by the graphics card, rougher where the land is steep; generated planets included. Coasts the terrain decides (a planet's; the Earth's at another sea level) bend below the grid's cells instead of running from cell to cell |
| Large-scale and stress tests of the transitions, optimised | Tested | `bench/render.bench.ts` playAllClean, playAllBlitz (new), `front-source`, `front-field`, `e2e/render-compare` 'While a change animates' in an intense look | D139, D140. A hundred changes under way: 2.9 s to 0.59 s a frame (clean), 3.4 s to 0.81 s (Blitz); at a film's pace 56 ms in software, 7% of the frame drawn again. Two faults of partly drawn frames with soft edges found and fixed |
| Everything at a solid 60 frames a second | Partial | DEVELOPMENT.md "Performance, 19 November" | Moving the map, zooming steps and stepping the date are within a frame or two in software on every benchmark project. Playing through a heavy project's changes is not (56 ms a frame at a film's pace, without a graphics card): what is left is the browser's own painting, several times faster on a graphics card; not measurable in the development container. To read it on the computer itself: Settings, "Show how long the map takes to draw, and the frames a second the screen gets" (D143; `frame-meter`, `e2e/workflows` 'Settings') |
