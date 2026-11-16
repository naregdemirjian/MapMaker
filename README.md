# Map Maker

Bespoke software for one independent feature film: a historical world-building database for its universe, and a tool
that turns that history into animated maps exported as image sequences for Premiere Pro. Single user, works offline,
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

- Create projects and worlds (Earth, the Moon, planets or your own), countries and factions.
- Draw territory freehand or point by point, and correct borders by dragging their points.
- Record history as dated events; move through time and see the map exactly as it was on any date, from millennia down
  to milliseconds.
- Animate changes (an advancing front or a fade) over the length of an event.
- Make shots and export PNG image sequences with transparency, in separate layers for Premiere, at HD, 4K, 8K or any
  size and frame rate.
- Earth's real geography (Natural Earth land, lakes and coastlines); countries can be painted loosely over the sea and
  end at the coast; today's borders can be shown as a drawing guide.
- Undo and redo, named versions, automatic backups, and recovery of a damaged project from its latest healthy backup.

Not there yet: terrain, rivers and cities, military fronts, routes, environmental events, space maps and more.
See `docs/REQUIREMENTS.md`.

## For development

See `docs/DEVELOPMENT.md` (status, how to build and test, code map), `docs/REQUIREMENTS.md` (checklist against the
master specification) and `docs/DECISIONS.md` (decisions and deviations from the approved architecture).
