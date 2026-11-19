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
