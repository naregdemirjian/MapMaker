# Map Maker: decisions and deviations

Architectural decisions taken during development, and every place where the software differs from the approved
architecture, with the reason and the way back. Newest first within each section.

## Deviations from the approved architecture

The approved development set-up assumed a session that can install packages and a private GitHub repository. The
first development session had neither: package installs were switched off and no repository was connected. D1–D4 follow
from that. Each is confined to one layer of the system, so returning to the approved form does not touch the world
model, the history engine, the parcel kernel, storage or the export writer.

### D1. Canvas 2D map renderer instead of deck.gl (interim)

- **Why.** deck.gl was not installed and could not be downloaded.
- **What was built.** `src/render-engine/map-renderer.ts` draws with the browser's 2D canvas, using the same inputs the
  deck.gl renderer will use: the world, the engine, a time and a camera.
- **Consequences.** Correct and deterministic output, including 8K frames. The cost is speed with very dense data
  (detailed terrain, thousands of features), which the planned WebGL renderer handles better. Not yet measured, because
  no large data exists yet.
- **Way back.** Replace this one module once packages can be installed.

### D2. Local service and browser instead of an Electron app (interim)

- **Why.** Electron was not installed and could not be downloaded.
- **What was built.** The data service (`dist/server.mjs`) runs with Node.js and serves the interface to the browser,
  on this computer only. `Start Map Maker.bat` starts it and opens the browser. This service is the same component that
  Electron's main process would host.
- **Consequences.** The user installs Node.js once instead of running a Map Maker installer, and the app opens in a
  browser tab instead of its own window. Closing the black console window quits the app; the interface then pauses
  editing and says so.
- **Way back.** Wrap the same service and interface in Electron and build a Windows installer.

### D3. Node's built-in SQLite instead of better-sqlite3

- **Why.** better-sqlite3 was not available; Node 22.13 and later include SQLite.
- **Consequences.** The same SQLite file format and features (write-ahead log, full sync, VACUUM INTO). Requires
  Node.js 22.13 or newer. This may simply be kept.

### D4. Minimal React type declarations (interim)

- **Why.** React's type package was missing.
- **Consequences.** The interface code (`src/ui/`) gets weaker type checking than the rest. The core modules are fully
  checked.
- **Way back.** Install `@types/react` and remove `types/react-shim.d.ts`.

### D5. Tests use Node's own test runner instead of Vitest and fast-check

- **Why.** Neither was available. The randomised tests use a seeded generator written for this project.
- **Consequences.** None for the user; the property tests run on every `npm test`.

### D6. Interface tests drive Chrome with Playwright, not Playwright for Electron

Follows from D2. The test drives the real interface exactly as a person would.

## Decisions taken during development

### D7. Territory layers are painted opaque off screen, then laid onto the map once

Neighbouring parcels drawn separately at partial opacity leave hairline seams where the ocean shows through. Painting
each territory layer fully opaque into a scratch buffer and compositing it once at the layer's opacity removes the
seams, and makes fades between two owners mix colours correctly.

### D8. Entities and events belong to the project; maps, layers and territorial history belong to each world

One empire or one war can then span several worlds, which interstellar territory (Stage 11) needs. Each world still has
its own map, layers and territorial history. Open point: the outliner and timeline currently list every event in the
project. The proposal is to give each event a home world and show a world's own events by default, with a "show all
worlds" switch.

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
