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
a redraw. Exports are not touched by any of this: they carry nothing from frame to frame, and are cut by the outline
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
real export (it must be within a factor of four; it is usually much closer).

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
