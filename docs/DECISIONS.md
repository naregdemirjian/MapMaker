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
