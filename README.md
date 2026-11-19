# Map Maker

Bespoke software for one independent feature film: a historical world-building database for its universe, and a tool
that turns that history into animated maps exported as image sequences for Premiere Pro, or as videos. Single user, works offline,
no accounts.

## Installing Map Maker on Windows (the desktop app)

1. On GitHub, open the **Actions** tab, click the latest successful **Windows build and tests** run, and download
   **Map Maker installer (Windows)** under Artifacts. Unzip it to get `Map Maker Setup <version>.exe`.
2. Run it. Windows may say "Windows protected your PC" because the installer is not signed with a paid certificate:
   click **More info**, then **Run anyway**.
3. Start Map Maker from the Start menu or the desktop shortcut. It opens in its own window; close the window to quit.

No Node.js is needed for the desktop app. The older way below still works.

## Starting Map Maker on Windows without installing (browser version)

1. Install Node.js once: download the version marked **LTS** from https://nodejs.org and run the installer with its
   normal options. If you skip this, the next step opens that page for you.
2. Double-click **Start Map Maker**. A black window opens and your browser shows Map Maker.
3. Keep the black window open while you work. Close it to quit Map Maker.

Everything is saved as you work. Projects are kept in `Documents\Map Maker Projects`; each project is one folder ending
in `.mapmaker`, holding the project file, versions, backups and exports. To keep a copy somewhere safe, copy that folder
while Map Maker is closed. Don't keep projects inside OneDrive or Dropbox while Map Maker is running.

## What it can do now (version 0.2.0 and later)

- Create projects and maps (Earth, the Moon, planets or your own), countries and factions, and characters.
- Draw territory freehand, point by point or with the border pen, and correct borders by dragging their points.
- Add today's countries (all 242, or by continent or name), as countries of their own or into a country of yours.
- Record history as dated events, or change the map from a date on without an event; move through time and see the
  map exactly as it was on any date, from millennia down to milliseconds. See what a country gained and lost in any
  day, month, year or span of years.
- Characters are points that travel between their places over time (with their routes in shots, if you like); cities
  are founded, moved and abandoned at dates.
- Animate changes (an advancing front from the border, an expansion or a fade); style labels, fill countries with
  colours, flags, pictures or videos; add a current-events box to shots.
- Make shots and export PNG or TIFF image sequences with transparency, in separate layers for Premiere (by kind, or
  each layer on its own), at HD, 4K, 8K or any size and frame rate; or one MP4 (H.264) or WebM (VP9) video to play
  and share; or a single frame as an editable SVG file. "+ Whole history" makes a timelapse of everything in one click.
- Shots in their own look (Parchment, Atlas, Night, Blueprint, Minimal, Wartime…), with text boxes and callouts,
  campaign arrows and routes that flow; on a flat map or on a globe that turns, lit, with the air's glow round it.
- Play history in the working view, from a month to a thousand years a second.
- Import borders from GeoJSON files: one map for each year, or a dataset that dates each shape (such as CShapes); the
  same border drawn again in another file follows the one already on the map.
- Earth's real geography (Natural Earth land, lakes, rivers and coastlines, terrain with relief, the sea floor, a
  satellite look, finer heights downloaded close in); planets of your own from a seed; sculpting the terrain.
- Countries can be painted loosely over the sea and end at the coast; today's borders can be shown as a drawing guide.
- Wars with front lines, areas, lines and points (claims, roads, battles), relationships between countries.
- Conditions over the map: radiation, fire, smoke, floods, destruction and heatmaps, spreading over the terrain;
  disasters (strikes, earthquakes, eruptions, impacts) in one click.
- The Earth through geological time: its continents, seas and mountains as they were from 540 million years ago to
  today (the PALEOMAP maps of C. R. Scotese and N. Wright), changing steadily between them, with the seas of the last
  ice age; dates that far back written as how long ago they were ("250 million years ago").
- Space maps: the stars within 50 light-years with their known planets, the solar system on any date, the Milky Way,
  invented stars and galaxies; star systems held by countries and factions, drawn as territories with borders and
  fronts where realms at war meet, and lanes between them. How the stars look is yours to choose: colours, shapes,
  glows, spikes, nebulae, twinkling, fifteen presets and looks made up by chance; seen in three dimensions or as a
  flat chart with squares or numbered hexes. The solar system can also be laid out side by side: the planets in a
  row, their moons below, who holds each over it and since when.
- Undo and redo, named versions, automatic backups, and recovery of a damaged project from its latest healthy backup.
- Built to stay fast on large projects: moving the map, scrubbing time, drawing and exporting all keep their speed with
  hundreds of countries and detailed coasts. **Settings** (top right) trades sharpness for speed on slower computers;
  it only affects the screen while you work, never an export.

What is planned next, and what each part has been tested with: see `docs/REQUIREMENTS.md` and `docs/DEVELOPMENT.md`.

## For development

See `docs/DEVELOPMENT.md` (status, how to build and test, code map), `docs/REQUIREMENTS.md` (checklist against the
master specification) and `docs/DECISIONS.md` (decisions and deviations from the approved architecture).
