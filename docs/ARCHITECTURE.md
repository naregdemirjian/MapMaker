<!-- Exported on 17 November 2026 from the approved Claude Doc "Map Maker — Technical Architecture & Development Plan" (https://claude.ai/artifact/2JShAV3AWt6iECtNgBTsJN). This is the approved design: follow it. Three diagrams were not exportable. -->

# Map Maker — Technical Architecture & Development Plan

Nov 15, 2026 · @Nareg · Draft for your review — no implementation until you approve

## Summary

Build Map Maker as a Windows desktop app around one project database. That database is the only source of truth: every map, animation and export is computed from it for a chosen moment.

The key choices:

- **One source of truth.** A SQLite database inside your project folder holds worlds, entities, layers, events and shots. Caches and snapshots exist only for speed and can always be thrown away and rebuilt.
- **Events store both outcome and intention.** Each event records what it changes ("from 14 May 1203, these areas belong to Kingdom A") and what you meant ("annex Kingdom B"). If an earlier edit makes the stored outcome out of date, the app flags it and lets you keep it or re-apply the intention.
- **A parcel map for territory.** Each world has one shared map of parcels: the smallest pieces created by every border ever drawn. Ownership, military control and similar layers are values per parcel over time. The borders at any date are simply the edges between parcels with different values, so scrubbing time never rebuilds geometry.
- **Arrival-time fields for gradual change.** A conquest, a spreading ideology or a flood stores, for each point, the moment it changes. Any frame shows everything that has changed by then, and the frontier is the edge of that area.
- **A custom map engine built on deck.gl.** It is needed for flat maps of whole planets including the poles, for space maps, for time-driven animation and for exact frame export.
- **Deterministic offline export.** PNG or TIFF sequences, one pass per layer group, with a written compositing guide for Premiere.
- **No terminal for you.** I write the code in a repository; each milestone arrives as a normal Windows installer.

This is a large build: 14 stages, several with genuinely hard custom algorithms (see *Technical risks*). The **minimum viable foundation** is reached at the end of Stage 3: from then on you can record and preserve real history of your universe.

To review: the decisions that need your approval are collected in the last section. Comment on any passage and I'll revise.

## What your answers changed

Your twelve answers removed the globe, the paleo-geography and the political hierarchy, and added in-app planet creation and space maps.

| # | Your answer | What it means in the design |
| --- | --- | --- |
| 1 | Ask each time what a map edit means | Every edit made outside an open event shows a three-way choice: *new change from this date*, *correct this period* or *correct for all time*. A "record into event" mode lets you make many edits for one event without being asked again, because opening the event already answered the question. |
| 2 | Flag broken links, offer keep or adapt | Each effect stores its intention plus a fingerprint of the history it was worked out from. When that history changes, it appears in a History Health panel with **Keep as is** and **Re-apply intention** buttons. Nothing is fixed silently. |
| 3 | Infinite time; Earth's look doesn't change by date | Time is stored as whole days plus milliseconds, which covers about ±24 trillion years at millisecond precision. Earth's base geography is fixed; it changes only through events you create. |
| 4 | Alternatives are a later extra, useful for story planning | The database supports branches from day one. **Event variants** (two versions of one event, flip which is active) arrive in Stage 4; full branching timelines in Stage 13. |
| 5 | Solar system, known exoplanets, nearby stars, Milky Way, other galaxies | Every map is a *map space*: either a sphere (planets, moons) or a flat plane (solar system, stars, galaxies). Real data is used where it exists; unknown planets get generated surfaces. |
| 6 | Create terrain in the app; importing is minor | A full terrain module (planet generator, sculpting, rivers, biomes) is planned. Earth data arrives through a built-in setup wizard, not manual imports. Importing files stays a small side tool. |
| 7 | City-level detail, no buildings; real history until today | Earth gets global terrain and imagery, plus roads, railways, rivers and cities for regions you choose. Present-day real borders form the "today" state. Real historical borders can be added later from an open dataset. |
| 8 | Flat map only | No globe or 3D. You choose a projection per view, including a regional mode so zoomed-in shots near the poles aren't stretched. Rotation is 2D. |
| 9 | Phenomena with or without help | Every phenomenon tool has *Assisted* and *By hand* modes that produce the same kind of data, so you can start assisted and refine by hand. |
| 10 | Keep politics simple | No required hierarchy. An optional "part of" link (province of, member of) exists only for grouping colours and labels. |
| 11 | Ryzen 7 3700X, Radeon RX 6800, new to software | A Windows installer, no terminal, plain-language interface. The RX 6800's 16 GB of video memory is enough for 8K frames. I still need your RAM size and free disk space. |
| 12 | Not commercially distributed | Non-commercial datasets (GADM boundaries, EOxCloudless imagery) are allowed. Every dataset's licence is recorded, so it can be swapped if your plans change. |

## Architecture overview

Data flows one way. Edits go down into the project database as atomic commands. Maps come back up through the temporal engine and one shared renderer, in both modes.

&#91;embedded content: architecture · storage, engine, renderer, two modes, export\]

Edits travel down into the database as commands. Maps travel back up through the temporal engine to the one renderer both modes share, and on to export.

### Processes inside the app

| Process | Job |
| --- | --- |
| Main process | Windows, menus, file dialogs, crash reporting |
| Data service | The only thing that writes to the database: transactions, undo journal, versions, backups, dataset packs, the bundled GDAL tools used by the Earth setup wizard |
| Interface process | React interface, an in-memory copy of the world, the temporal engine, the map engine (WebGL2) |
| Worker pool | Heavy jobs kept off the interface: geometry operations, terrain and field computation, tile decoding, projection, image encoding |

### How the systems talk

Every user action is a *command*. Commands never draw anything themselves:

```ts
// You paint territory for Kingdom A at 14 May 1203 and choose "new change from this date".
const cmd = assignTerritory({
  space: 'earth', layer: 'political', area: brushStrokePolygon,
  value: 'ent:kingdom-a', mode: 'new-change', at: Instant.parse('1203-05-14')
});
const diff = await domain.plan(cmd);   // geometry + effects worked out in workers
await storage.commit(diff);            // one atomic database transaction + one undo entry
engine.invalidate(diff.touchedKeys);   // only the affected property timelines recompile
view.requestFrame();                   // the map redraws from the new state
```

Four rules keep this reliable:

1. Only commands change data. Each is one transaction plus one journal entry, so it can be undone and cannot half-happen.
2. The engine recompiles only what a command touched.
3. The renderer draws from engine state, never from the database directly.
4. Presentation mode reads the same engine. Its own data (camera, timing, overlays) lives in sequences and never alters history.

### Where each component from your brief lives

| Component | Module | Responsibility | Talks to |
| --- | --- | --- | --- |
| Interactive map and rendering | render-engine | Projections, layer renderers, styles, offscreen frames | temporal-engine, presentation, export |
| Geographical data model | geo-kernel, world-model | Map spaces, parcel map, features, coordinates | storage, tools, temporal-engine |
| Political and territorial entities | world-model | Entities, lifespans, relations, partition layers | temporal-engine, inspector |
| Custom layers | layers | Layer kinds, visibility, export passes | render-engine, export |
| Historical events | events | Event types, effects, intention and result | temporal-engine, tools, storage |
| Timeline and time | core-time, timeline UI | Instants, calendars, zoomable timeline | everything dated |
| Reconstruction at any date | temporal-engine | Effects to timelines to state at time t | render-engine, presentation |
| Geographical and environmental change | terrain, fields | Terrain stack, permanent changes, temporary conditions | temporal-engine, render-engine |
| Military and frontlines | military | Control layer, hostility, fronts, units, arrows | temporal-engine, render-engine |
| Characters and routes | movement | Tracks, routes, orbits | temporal-engine, render-engine |
| Heatmaps and numerical data | fields | Generators, painted rasters, colour ramps | render-engine, export |
| Animation and presentation | presentation | Sequences, time remap, transition styles | temporal-engine, render-engine |
| Camera and keyframes | presentation (camera) | Keyframes, easing, camera paths | render-engine |
| Text overlays and labels | labels, overlays | Placement, stabilisation, data-bound text | render-engine |
| Image and frame export | export | Jobs, passes, encoding, manifests | render-engine, storage |
| Project storage | storage | Schema, migrations, dataset packs | data service |
| Undo, redo, version history | storage (journal) | Reversible commands, checkpoints, backups | every command |

## Technology stack

Recommended: Electron + TypeScript + React for the app, deck.gl with custom layers for the map, SQLite for storage, and a custom geometry kernel for borders. Each choice below was compared against the alternatives.

### Map renderer

The renderer decision matters most, because the requirements rule out the usual web-map choice.

| Option | Whole planet flat, poles included | Space maps | Changes every frame | Exact frame export | Labels out of the box | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| MapLibre GL JS | No: Web Mercator or globe only; other projections are still a [roadmap item](https://maplibre.org/roadmap/maplibre-gl-js/non-mercator-projection) | Only by faking coordinates | Possible, but data re-tiles in the background | Possible with care | Excellent | Rejected: projection lock-in |
| OpenLayers | Yes, any projection | Yes | Slower: mostly Canvas 2D drawing | Yes | Good | Runner-up |
| **deck.gl + custom layers** | **Yes: we supply projected coordinates** | **Yes** | **Built for GPU data updates and time filtering** | **Yes: we control the render loop** | Basic; we add more | **Chosen** |
| Fully custom WebGL/WebGPU | Yes | Yes | Yes | Yes | None | Too much re-invention |
| Godot game engine | Yes | Yes | Yes | Yes | Fair | Weak for data-heavy interfaces; no GIS ecosystem |

deck.gl is actively developed: [version 9.3 shipped in April 2026](https://deck.gl/docs/whats-new), and WebGPU support is an early preview. We use its stable WebGL2 path now, with the option of WebGPU later.

The trade-off: MapLibre's polished automatic street-map labels are lost. For a film this matters less, because labels are art-directed rather than dense. Our label system is designed for that (see *Presentation and animation*).

### Other choices

| Area | Options compared | Choice | Why |
| --- | --- | --- | --- |
| Desktop shell | Electron, Tauri, native Qt | **Electron** | Ships its own fixed copy of Chromium, so rendering is identical every run. Tauri uses Windows' WebView2, which updates on its own and could change exported frames between Windows updates. |
| Storage | SQLite, DuckDB, PostgreSQL, plain GeoJSON files | **SQLite** | One file, crash-safe transactions, no server, decades of reliability, readable by many tools. DuckDB is for analysis, not editing; PostgreSQL needs a server; GeoJSON can't hold large rasters or guarantee consistency. |
| Border geometry | Turf.js, JSTS/GEOS, Clipper2, S2, custom kernel | **Custom kernel + Clipper2** | No library offers shared borders, sphere-safe maths and parcel lineage together. Turf.js works on a flat plane and assumes Earth's radius. Clipper2 is used for brush shapes. |
| Projections | proj4, d3-geo | **d3-geo + d3-geo-projection** | Treats shapes as spherical: cuts at the map edge, handles poles and resamples curves correctly. Has every projection we need. |
| Raster processing | GDAL, own code | **Both** | GDAL (bundled, invisible to you) reads and reprojects datasets in the setup wizard; our own code handles terrain editing and composition. |
| Heavy computation | TypeScript, Rust compiled to WebAssembly, GPU | **All three** | Start in TypeScript; move measured hot spots to Rust/WebAssembly; per-pixel work on the GPU. |
| Image encoding | Browser canvas, sharp (libvips) | **sharp** | Fast PNG and 16-bit TIFF encoding with correct alpha handling. |
| Interface | React, Svelte, Vue | **React + TypeScript** | Mature, well-typed, the largest ecosystem of components I can build on reliably. |
| Tests | — | **Vitest, fast-check, Playwright, pixel comparison** | Unit tests, randomised property tests for geometry and history, interface tests, image comparison for renders. |

### Reused versus custom-built

Reused (established libraries): deck.gl and luma.gl, d3-geo, Clipper2, earcut (triangulation), polylabel (label positions), flatbush and rbush (spatial indexes), SQLite via better-sqlite3, GDAL, sharp, React, zod (data validation).

Custom-built (nothing suitable exists):

- the temporal engine (events, effects, timelines, conflict checks)
- the sphere-safe parcel map kernel
- editing tools and the smart brushes
- the planet generator and terrain sculpting
- arrival-time fields and transition rendering
- sequences, time remap and camera system
- label placement and stabilisation
- raster reprojection shaders and the export orchestrator
- calendars

## World model and data architecture

The whole universe lives in one database built from nine concepts. Every spatial thing belongs to exactly one map space; entities belong to the universe and can act in several spaces.

| Concept | What it is | Examples |
| --- | --- | --- |
| Map space | A flat map with its own coordinates: a **sphere** (longitude/latitude, any radius) or a **plane** (x/y in km, AU, light-years or parsecs) | Earth, the Moon, a fictional planet; the Sol system; nearby stars; the Milky Way |
| Entity | Anything with an identity | A country, faction, character, army, city, ship, planet |
| Layer | A typed container of spatial data in one map space | Political ownership, military control, radiation |
| Parcel map | The shared pieces of a space, cut by every border ever drawn | Earth's parcels |
| Event | A dated package of changes, with description and participants | The Fall of the Northern March |
| Effect | One concrete change inside an event | "These parcels belong to Kingdom A from 14 May 1203" |
| Property | One value of one thing, with its full history | owner of parcel 3.2; name of Kingdom A; position of a character |
| Style | How a layer looks, kept apart from the data | Detailed political, satellite-look |
| Sequence | A presentation recipe for one shot | Shot 12: the invasion of the south |

### Five spatial representations that coexist

A layer chooses one representation, and several can overlap in the same map space. Nothing forces them into one geometry type.

1. **Partition**: one value per parcel, no overlaps inside the layer; borders are derived. Political ownership, military control, an exclusive religion.
2. **Features**: independent points, lines and polygons with lifespans and dated shapes; overlap freely. Claims, influence zones, cities, rivers, roads, canals, arrows, manual frontlines.
3. **Fields**: a continuous value over space, from raster tiles, formulas or point densities. Heatmaps, radiation, population density, temperature.
4. **Terrain stack**: elevation, land cover and sea level for a sphere, plus dated permanent changes. Physical geography.
5. **Tracks**: where a moving entity is over time. Characters, armies, ships, migrations.

### How the parcel map works

The parcel map is what makes territory reliable across time. Every border you ever draw permanently cuts the parcels it crosses. A cut is invisible at any date where both sides have the same value.

Example: in 1000, Kingdom A owns parcels 1 to 4. In 1200 you draw a new border through parcel 3, so it splits into 3.1 and 3.2. An effect at 1200 says *owner of 3.2 = Kingdom B*. Viewing 1100 is unchanged, because 3.1 and 3.2 both still belong to A there.

This gives three guarantees:

- Neighbouring countries can never have gaps or overlaps inside one layer; moving a shared border moves both sides.
- The past is never rewritten by a new border: splitting a parcel doesn't change any earlier value, because children inherit their parent's history.
- The map at a date needs no geometry work: each parcel's colour is looked up, and borders are the edges whose two sides differ.

The parcel map is shared by all partition layers in a space. Military control can therefore start exactly on the political borders and diverge from there.

### Relationships

Relationships are typed links between entities. They have start and end dates set by events, just like other properties.

| Relationship | Meaning | Used for |
| --- | --- | --- |
| part of | province of, vassal of, member of an alliance (optional) | grouping colours and labels |
| at war with | hostility between two entities | deciding where frontlines appear |
| member of / leads | a character in a faction or army | inspector, queries |
| successor of | lineage when states merge, split or rename | legends, history view |
| participant in | an entity's role in an event | timelines, search |
| travels with | a character attached to an army or ship | movement |

One event can have many effects, each on a different layer, entity or space. That is how a single invasion changes control, ownership, a city's status and a character's position together.

### Schema excerpt

Real tables will have more columns; this shows the shape.

```sql
CREATE TABLE map_space (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sphere','plane')),
  body_id TEXT REFERENCES entity(id),     -- the planet or moon it maps (spheres)
  radius_m REAL,                          -- any value; nothing defaults to Earth
  unit TEXT,                              -- planes: 'km','AU','ly','pc','kpc','Mly'
  parent_space_id TEXT REFERENCES map_space(id),
  settings TEXT NOT NULL DEFAULT '{}'     -- projection defaults etc. (JSON)
) STRICT;

CREATE TABLE entity (
  id TEXT PRIMARY KEY,
  type_id TEXT NOT NULL REFERENCES entity_type(id),   -- your own types allowed
  branch_id TEXT NOT NULL DEFAULT 'main' REFERENCES branch(id),
  name TEXT NOT NULL                       -- later names are dated properties
) STRICT;

CREATE TABLE event (
  id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES event_type(id),
  branch_id TEXT NOT NULL DEFAULT 'main', variant_group TEXT, variant_active INTEGER,
  name TEXT NOT NULL,
  start_day INTEGER NOT NULL, start_ms INTEGER NOT NULL,
  end_day INTEGER, end_ms INTEGER,         -- NULL = instantaneous
  date_precision TEXT NOT NULL DEFAULT 'exact',  -- 'year', 'century', 'circa'...
  precedence INTEGER NOT NULL DEFAULT 0,   -- order for simultaneous events
  description TEXT, fields TEXT NOT NULL DEFAULT '{}', presentation TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE TABLE effect (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,                      -- 'assign','create','end','rename','move','terrain','field'...
  space_id TEXT REFERENCES map_space(id), layer_id TEXT REFERENCES layer(id),
  intent TEXT NOT NULL,                    -- what you meant, e.g. {"op":"annex","from":"B","to":"A"}
  resolution BLOB,                         -- what it concretely changes (parcel set, values)
  basis_hash TEXT,                         -- fingerprint of the history the resolution came from
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','stale','broken','kept'))
) STRICT;

CREATE TABLE parcel (
  id INTEGER PRIMARY KEY, space_id TEXT NOT NULL REFERENCES map_space(id),
  parent_id INTEGER REFERENCES parcel(id), -- split lineage: children inherit history
  is_leaf INTEGER NOT NULL
) STRICT;

CREATE TABLE edge (
  id INTEGER PRIMARY KEY, space_id TEXT NOT NULL,
  left_parcel INTEGER, right_parcel INTEGER,
  coords BLOB NOT NULL                     -- fixed-point vertices, shared by both sides
) STRICT;
```

Other tables: entity\_type, event\_type, event\_participant, relation, layer, feature, feature\_version, field, raster\_tile, style, sequence, journal, version, dataset.

### An event as stored

```json
{
  "id": "evt_0412", "type": "conquest", "name": "Fall of the Northern March",
  "start": "1203-05-14T06:00", "end": "1203-05-17T18:00",
  "participants": [
    {"entity": "ent_kingdom_a", "role": "attacker"},
    {"entity": "ent_kingdom_b", "role": "defender"},
    {"entity": "chr_aldric", "role": "commander"}
  ],
  "effects": [
    {"kind": "assign", "layer": "military_control",
     "intent": {"op": "take_area", "area": "drawn:poly_88", "to": "ent_kingdom_a"},
     "transition": {"style": "advancing_front", "origins": ["pt_ford"], "terrain_weight": 0.6, "seed": 41}},
    {"kind": "assign", "layer": "political", "at": "1203-06-01",
     "intent": {"op": "transfer", "from": "ent_kingdom_b", "to": "ent_kingdom_a", "area": "same_as:0"}},
    {"kind": "set_attribute", "subject": "city_varn", "attribute": "status", "value": "ruined"}
  ]
}
```

Note the event's own dates (three and a half days) say nothing about how long its animation lasts. That is decided per shot, in presentation mode.

## Time and historical event engine

Recommended: a hybrid. Events are the authoritative record. A compiler turns them into a time index of every property, and the world at any moment is read from that index. The index and any snapshots are disposable caches, rebuilt from the events whenever needed.

&#91;embedded content: event engine · edit, record, compile, check\]

Only the highlighted box, events and effects, is kept as the record. Timelines and world states are rebuilt from it, and conflicts come back to you instead of being fixed silently.

### Approaches compared

| Approach | How it works | Strengths | Weaknesses |
| --- | --- | --- | --- |
| Pure event sourcing | Replay every event from the beginning up to the date you want | Events naturally change state; full history kept | Slow for distant dates without checkpoints; replays can fail after earlier edits; order of simultaneous events is fragile |
| Temporal database | Each fact row has a valid-from and valid-to date | Very fast lookups at any date | Events become loose groups of rows; meaning and intention are lost; inserting a past change means manually cutting intervals |
| Versioned snapshots | Store the whole world after each change | Simple to view a date | Huge storage; editing the past means fixing every later snapshot; snapshots become the record, which you ruled out |
| **Hybrid (recommended)** | Events hold declared effects plus intention; a compiler derives per-property timelines; snapshots are optional caches | Fast lookup at any date; past insertions affect only what they touch; intention allows staleness checks | More engineering: compiler, dependency tracking, conflict detection |

### Representing time

```ts
// One absolute time axis for the whole universe.
type Instant = { day: number; ms: number };
// day: whole days from 1 January 1970 (negative = earlier), always a safe integer
// ms:  milliseconds into that day, 0 to 86,399,999
// Range: about ±24 trillion years at millisecond precision. +/- Infinity mean "forever".
```

- A single number would not do: a standard 64-bit floating-point millisecond count is only exact for about ±285,000 years. Two whole numbers keep exact arithmetic at any distance.
- Days are a uniform 86,400 seconds; leap seconds are ignored.
- **Calendars** translate instants to and from readable dates. Gregorian comes first (with BCE/CE); fictional calendars with their own day length, months and year zero come later. Each world can have its own.
- **Uncertain dates** store an exact instant for the maths plus a precision label, so the timeline can say "c. 3000 BCE".
- Events can last a millisecond or ten thousand years; there is no fixed step anywhere.

### How events change the world

The world is a set of **properties**, each keyed by *(map space, layer, subject, attribute)*. Examples: owner of parcel 3.2; the name of Kingdom A; elevation in a terrain tile; the position of a character.

Effects write **assignments** to properties: "from this instant, this value". A property's value at time *t* is the latest assignment at or before *t*. That single rule gives the behaviour you asked for:

- **Inserting an event** adds assignments only to the properties it touches. Each lasts until the next existing assignment to the same property.
- **Earlier history and unrelated properties** are untouched by construction; no recalculation can alter them.
- **Later states update automatically**, because anything that reads those properties reads the new value.

Effect kinds include *assign* (territory, attributes, relations), *create* and *end* (entity lifespans), *rename*, *move* (tracks), *terrain* (permanent physical change) and *field* (temporary condition). A custom event type is a template combining these.

An assignment can carry a **transition**: during the event's duration, the change spreads according to an arrival-time field instead of happening at once. The middle of an event is therefore a real historical state. Scrubbing to day two of a three-day conquest shows partial control in both modes.

```ts
function valueAt(key: PropertyKey, t: Instant): Value {
  const timeline = timelines.get(key);           // sorted assignments, built from effects
  const a = timeline.latestAtOrBefore(t);        // binary search; ties use precedence, then order
  if (a?.transition && t < a.transition.end) {
    return inTransition(timeline.before(a), a.value, a.transition, t);  // partly changed
  }
  return a ? a.value : timeline.baseValue;
}
// Parcels also check their ancestors, so a split parcel inherits its parent's history.
```

### Reconstructing any date

The *world state at t* is a set of arrays: a value per parcel per partition layer, the active features, active fields and entity positions. It is computed, never stored as the record.

- **Jumping** to a distant date costs a binary search per property in view, not a replay from the beginning.
- **Scrubbing** uses a sorted index of every change point: moving from *t1* to *t2* applies only the changes in between, forwards or backwards.
- **Recently viewed dates** are cached and evicted freely.

### Editing history

When you edit the map with no event open, the app asks what the edit means (your answer 1):

1. **New change from 14 May 1203.** Creates an event, or adds to one you pick. The prompt shows how long it lasts: "until 1290, when the Treaty of Varn changes it".
2. **Correct this period (1150–1290).** Edits the effect that produced what you see, without creating new history.
3. **Correct for all time** (border shapes only). Moves the underlying border wherever it is used, for mistakes in the geometry itself.

In **record mode** you open an event first and every edit goes into it, with no prompt.

### Conflicts and consistency

The compiler checks consistency after every change and lists problems in a **History Health** panel. It never resolves them silently (your answer 2).

| Problem | Example | Your options |
| --- | --- | --- |
| Stale intention | "Annex Kingdom B" was worked out when B held 12 parcels; an earlier edit gave B 15 | Keep as stored, or re-apply the intention |
| Broken reference | An effect involves an entity that no longer exists at that date | Keep, re-target, or remove the effect |
| Simultaneous change | Two events set the same property at the same instant | Set which wins by dragging their order |
| Overlapping transitions | Two conquests claim the same parcels over overlapping days | Default: the later-starting one takes over from its start; change it if you prefer |

Staleness detection works by fingerprint. When an effect is resolved, it records a hash of exactly the history it read (for an annexation: B's parcels just before the date). On recompile, a different hash marks it stale. Batch buttons ("keep all", "re-apply all") handle large edits.

### Alternative timelines

Both mechanisms just choose which events the compiler includes.

- **Event variants (Stage 4).** One event with two or more versions, one active. Flip between them to compare story options, then lock one in.
- **Branches (Stage 13).** A branch splits from the main timeline at a date. It inherits all earlier events live, so fixing early history fixes both, and it holds its own later events. You switch branches from the title bar and can compare two side by side.

Every entity and event carries a branch identifier from day one, so adding branches later needs no data migration.

## Geography and GIS

Nothing in the geography assumes Earth. Every map space is either a sphere of any radius or a flat plane in units you choose, and Earth is just one sphere that happens to have real data.

### Coordinates

- **Sphere spaces** (planets, moons, fictional worlds) use longitude and latitude on a sphere of that body's radius. Real bodies follow the standard IAU planetocentric convention. Distances and areas are computed in angles times the radius, so there are no Earth constants anywhere.
- **Vertices are stored as fixed-point numbers** at one ten-millionth of a degree. That is about 1.1 cm on Earth and 3 mm on the Moon, and it makes geometry calculations repeatable.
- **Plane spaces** (solar system, stars, galaxies) use x/y in their own units. Stars keep their true 3D positions; the map shows them projected onto a chosen plane, with height shown as a stalk or label. Territories in star maps are drawn in that plane: a deliberate 2D simplification.
- **Local flat maps** (a habitat interior, a city plan) are simply plane spaces in metres. You asked to keep this simple, so they come later if wanted.

### Projections (flat maps only)

| Projection | Best for |
| --- | --- |
| Equirectangular | Whole planets including the poles; default for fictional worlds; matches terrain storage exactly |
| Equal Earth, Robinson, Miller | Attractive whole-world overviews |
| Mercator | Regional Earth views where shapes must look familiar |
| Regional (automatic) | A conformal projection centred on the view, so a zoom into Scandinavia isn't stretched to twice its width |

Vector data is projected with d3-geo, which handles the map edge, the poles and curved edges correctly. Raster data (terrain, imagery, heatmaps) is reprojected on the GPU: each output pixel works out which longitude and latitude it shows and samples the source there.

A shot can change projection mid-move, for example from Equal Earth on the whole world to the regional projection on a city. Exports compute this exactly per frame; the live preview uses lower detail. A faster GPU method is a later optimisation.

### The geometry kernel

The kernel maintains each space's parcel map as a **planar subdivision**: vertices, shared edges and the faces between them. It is the most important custom code in the project.

- On spheres, all calculations use 3D unit vectors rather than longitude/latitude. The 180° line and the poles are therefore ordinary places, with no special cases to get wrong.
- New lines are inserted with **snap rounding**: intersections are rounded to the fixed-point grid, and lines that nearly touch existing borders snap onto them. This prevents slivers.
- Operations: insert a line, split, assign, dissolve (outline of all parcels with one value), point lookup, overlay of two polygons for feature layers, simplification, smoothing, measurement.
- Simplification for zoomed-out views runs **per shared edge**, so both neighbours simplify identically and no gaps appear.
- A plane version of the same kernel serves the space maps.
- Spatial indexes (R-trees in memory and in SQLite) find what's in view quickly.

### Terrain and rasters

- **Storage:** tile pyramids on a longitude/latitude grid, 512 × 512 pixels per tile. Elevation is 32-bit floating point; land cover is one byte per pixel; tiles are compressed with zstd.
- **Terrain stack:** base elevation, plus dated permanent changes (craters, canals, new land), plus a sea level that can change over time. Tiles are composed on demand and cached.
- **Derived layers** (rebuildable caches): land and water mask, coastlines, hillshade, slope, rivers, ridgelines, biomes.
- **Coastlines clip territory:** countries can be painted loosely over the sea. They are clipped to the land as it exists at each date, so a sea-level change reshapes countries automatically.
- **Rendering modes:** flat colour, elevation tint, hillshade, satellite-look (generated from biomes, texture and shading) and real imagery where it exists.
- **Earth detail:** global terrain at about 450 m resolution including the sea floor. Copernicus 30 m terrain is added for regions you choose for city-scale shots.

### Datasets and licences

Your film is non-commercial, so non-commercial datasets are allowed. Each dataset's source, version, licence and credit line are recorded inside the app.

| Dataset | Used for | Licence |
| --- | --- | --- |
| Natural Earth | World-scale coastlines, rivers, lakes, countries, places | Public domain |
| geoBoundaries | Administrative regions (default) | CC BY 4.0 |
| GADM | Finer administrative levels where needed | Non-commercial use only: fine for you |
| OpenStreetMap (regional extracts) | Roads, railways, cities, rivers for chosen regions | ODbL: credit "© OpenStreetMap contributors" |
| [GEBCO 2025 grid](https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use) | Global land and sea-floor terrain at 15 arc-seconds | Public domain; acknowledgement requested |
| Copernicus DEM GLO-30 | 30 m regional terrain | Free with attribution (confirm when added) |
| ESA WorldCover | 10 m land cover: forests, farmland, built-up areas | CC BY 4.0 (confirm when added) |
| NASA Blue Marble | Global satellite-style imagery at about 500 m | NASA imagery, free with credit (confirm when added) |
| EOxCloudless (Sentinel-2) | 10 m regional imagery | Non-commercial under CC BY-NC-SA 4.0: fine for you; offline terms to confirm |
| USGS / NASA planetary data | Terrain and imagery of the Moon, Mars, Mercury and others | Generally public domain (confirm per product) |
| [HYG database v4.2](https://www.astronexus.com/hyg/964) | About 120,000 stars with positions and names | CC BY-SA 4.0 |
| NASA Exoplanet Archive | Known exoplanets and their stars | Free; acknowledgement requested (confirm when added) |
| JPL approximate orbital elements | Planet positions over time | Public (confirm when added) |
| Milky Way model | Built in the app from published spiral-arm parameters | No dataset needed |

**How Earth data arrives.** On first run, a setup wizard downloads and prepares a global Earth pack using bundled GDAL. You only click through it. *Add detail for a region* lets you draw a box; the app then fetches that region's roads, railways, cities, 30 m terrain and imagery. Internet is needed only during these downloads.

**Credits.** Every export records which datasets were visible in it, and a credits report produces the attribution text for your end credits.

### Fictional worlds without any dataset

A *New world* wizard asks for the body type and size, generates terrain (see *Drawing and terrain tools*), and derives rivers, coastlines and biomes from it. Nothing external is required, and nothing Earth-like is assumed: no continents, oceans or borders unless you make them.

### Space maps

- **Solar system** (plane in AU): bodies are positioned by their orbits at the current date, real ones from JPL elements and fictional ones from yours. Scale modes are true, logarithmic and schematic, because at true scale the inner planets are invisible.
- **Nearby stars** (plane in light-years): stars from HYG within a radius you choose. Optional proper motion moves stars over very long time spans. Each star links to its own system map; known exoplanets come from the NASA archive, and unknown surfaces are generated.
- **Milky Way** (plane in thousands of light-years): a generated spiral galaxy following the known arm structure, with the Sun marked.
- **Other galaxies** (plane in millions of light-years): positions from a published catalogue of nearby galaxies, with generated appearances by galaxy type.
- **Territory works everywhere.** The same parcel map runs in plane spaces, so interstellar empires get borders exactly as countries do. A later generator can draw "influence" borders around claimed stars.

## Drawing and terrain tools

Every drawing tool follows the same five steps. Draw a candidate shape, optionally let a smart brush adjust it, preview it, answer the "what does this edit mean" prompt, and commit it to the parcel map. Nothing is final until you commit, and everything is undoable afterwards.

### Core tools (Stage 2)

| Tool | What it does | Settings |
| --- | --- | --- |
| Territory brush | Paints an area for an owner, like MapChart but continuous. The brush's swept shape becomes new parcels. | Size (screen pixels or km), edge smoothness, irregularity, precision |
| Border pen | Draws a dividing line, freehand or click by click; then you click the side that changes hands | Smoothing, irregularity, snapping |
| Vertex editor | Move, add or delete vertices; drag a whole section; shared borders move on both sides | Snap tolerance, show vertices at any zoom |
| Split and merge | Split: draw across a region. Merge: give both parts the same owner and the border disappears by itself | — |
| Region picker | Click, box or lasso existing administrative regions and assign them | Admin level to pick from |

- **Irregularity** adds controlled roughness: fractal displacement with amplitude, scale and a stored random seed. The result is saved as actual geometry, so it never shifts between sessions or renders.
- **Smoothing** uses curve fitting with adjustable tension, and **precision** sets how densely vertices are kept.
- Nothing forces borders smooth or geometric.
- Snapping to existing borders and vertices is on by default, with the tolerance in screen pixels so it feels the same at every zoom.

### Geography-aware brush (Stage 12)

Think of Photoshop's Magnetic Lasso, but attracted to rivers and ridges instead of image edges. You sketch roughly; the line is pulled towards nearby features as strongly as you set.

1. A corridor is built around your stroke, as wide as the search radius you set.
2. A **cost map** is computed inside it. Being near an attractive feature makes a spot cheap; straying from your stroke makes it expensive.
3. The cheapest path from the start to the end of your stroke is found, passing through any points you pinned.
4. Stretches that run alongside a feature are replaced by that feature's exact geometry: the river centreline, or its left or right bank.
5. You see your stroke as a ghost and the adjusted line solid, and adjust the sliders live before committing.

```ts
function costAt(p: Point): number {
  let cost = 1 + settings.stayClose * distanceToStroke(p) ** 2;   // keeps your intent
  for (const f of settings.features) {                            // rivers, coast, ridges, roads...
    cost -= f.weight * Math.exp(-(distanceTo(f.kind, p, editDate) / f.reach) ** 2);
  }
  return Math.max(cost, 0.05);
}
// The path minimising total cost becomes the proposed border.
```

Features available to attract: rivers and canals, coastlines and lakes, ridgelines and valleys (derived from terrain), forest edges (land cover), roads and railways, towns, and existing borders. Features with lifespans are read **at the date you're editing**, so a 1500 border never follows a 1900 railway.

### Strategic brush (Stage 12)

The same machinery with a military cost model, plus one extra input: you mark which side is yours.

- Rivers attract the line to their far bank; ridges attract it to the crest.
- Mountain passes, bridges and crossings within reach are pulled onto your side.
- Towns near the line are pulled inside your side, with a weight you set.
- Forests and rough ground act as buffers; objectives and installations you have placed can be included.

It only proposes. You can drag any segment back, set any weight to zero, or turn it off mid-stroke.

### Terrain tools (Stage 8)

- **Planet generator:** presets (Earth-like, desert, ocean, ice, volcanic, barren moon, gas giant bands) and sliders (seed, sea coverage, number and size of continents, mountain strength, roughness, ice caps). It uses 3D noise sampled over the sphere, so there are no seams at the poles or the 180° line. Simple tectonic plates place mountain ranges plausibly.
- **Sculpting brushes:** raise, lower, smooth, flatten, roughen, mountain range along a stroke, valley or canyon, crater, island, paint land or sea, local erosion.
- **Rivers:** generated from the terrain, with a slider for how many, plus hand-drawn rivers that carve their own valley.
- **Biomes:** worked out from elevation, latitude and distance to the sea, then repainted by hand where you like.
- **Base world or history?** By default, terrain tools shape the base world. Switch on *as a historical change* and the stroke becomes a dated permanent change instead, such as a crater from a year-2300 impact.

## Layer system

A layer is one kind of data with its own style, its own history and its own export pass. There is no limit on the number of layers, and no layer is forced to share another's structure.

| Layer kind | Data | Overlap | Typical uses | Drawn by |
| --- | --- | --- | --- | --- |
| Partition | One value per parcel | None inside the layer; any across layers | Political ownership, military control, exclusive religion | Parcel fills plus derived borders |
| Area features | Polygons with lifespans | Free | Claims, influence zones, environmental areas, custom regions | Polygon renderer |
| Line features | Polylines | Free | Manual frontlines, rivers, roads, canals, decorative borders | Path renderer with styles (dashes, teeth, glow) |
| Point features | Points with icons | Free | Cities, bases, battles, installations | Icon and text renderer |
| Tracks and routes | Timed paths and moving entities | Free | Characters, troops, migration, trade, ships | Animated trail renderer |
| Fields | Raster tiles, formulas or point densities | Free | Heatmaps, radiation, population, temperature | Field shader with colour ramp |
| Terrain | Elevation, land cover, sea level | One per sphere | Physical geography | Terrain shader |
| Annotations | World-anchored labels and notes | Free | Map labels, sea and range names | Label renderer |

A layer record looks like this:

```json
{
  "id": "lyr_ember_cult", "space": "earth", "kind": "area_features",
  "name": "Cult of the Ember", "value": {"type": "number", "range": [0, 1], "meaning": "influence"},
  "style": "sty_ember_glow", "group": "Influence", "exportPass": "influence",
  "visibleByDefault": true
}
```

### What each layer can do independently

- **Overlap:** layers stack in an ordered list. Each has a blend mode (normal, multiply, screen, add) and an opacity.
- **Style:** rules read the layer's values. For example, fill with the owner's colour as it is at that date, hatch occupied parcels, or set line width by importance. Rules can depend on zoom. Styles are stored separately, so switching style never touches data.
- **Animate:** a layer's changes come from its own effects and transitions. Presentation mode can additionally fade, reveal or re-colour any layer per shot.
- **Change over time:** everything in a layer is dated. A layer can also have its own visibility window, for example a pandemic layer that only exists from 2241 to 2249.
- **Show and hide:** per view in world-building, and with keyframable opacity per shot in presentation.
- **Export separately:** each layer maps to an export pass. Several layers can share a pass (all borders together), or each can have its own.

Layers belong to one map space. A *layer family* links same-named layers across spaces (one faction's influence on Earth and on Mars), so they share a style and a legend entry.

## Environmental change and phenomena

Two separate mechanisms keep permanent and temporary change apart. A **physical modification** changes the terrain from a date until another event changes it again. A **condition** is a field that rises, persists and fades without touching the terrain. The rule of thumb: anything that recovers is a condition; anything that stays is a modification.

|  | Physical modification | Condition |
| --- | --- | --- |
| Examples | Crater, canal, new or drained lake, island, land bridge, uplifted mountains, terraforming, sea-level change, permanent forest loss | Flood waters, fire, blast damage, radiation, contamination, ash fall, drought, a spreading desert before it settles |
| Stored as | Dated terrain changes (painted or formula stamps) and hydrology features | Field layers with a lifecycle |
| Affects | Coastlines, rivers, shading, land/water mask, and so the clipping of territories | Only what is drawn on top; terrain is untouched |
| Example result | A meteor crater stays on every later map | A flood covers the plain for three weeks, then recedes; the coastline never moved |

### How changing areas and intensities are represented

Every condition's value at a point and time is *shape × lifecycle*:

- **Shape** is where it is: a circle distorted by noise, an elongated plume along a wind direction, a spread across terrain (arrival-time field), a density from points, or a painted raster.
- **Lifecycle** is how strong it is over time: onset, peak, decay (with a half-life where that fits) and recovery.

Formula shapes are evaluated on the GPU at render time. They need no stored raster, work at any resolution, and give identical results each time. Painted shapes are stored as raster keyframes and blended between keyframes.

### Disaster templates

Each template is an event type you can copy and change. Each offers **Assisted** (formulas with sliders) and **By hand** (paint the extent at chosen moments) modes, and an assisted result can be converted to hand-editable data (your answer 9).

| Template | What it creates |
| --- | --- |
| Nuclear detonation | Small crater (modification); blast front expanding over seconds, then lasting damage that recovers over decades; fire zone; fallout plume along a wind direction with radiation decay. Radii set directly or from presets. |
| Earthquake | Shaking-intensity rings from the epicentre, distorted by noise; damage; optional ground offset along a fault line (modification) |
| Volcano | Lava spreading downhill over terrain; ash-fall plume; optional new land (modification) |
| Flood | Water filling land below a chosen level within an area, using real elevation; then receding |
| Wildfire | Spread weighted by vegetation and wind; burn scar recovering over years |
| Meteor impact | Crater (modification); blast and ejecta; optional tsunami along coasts |
| Sea-level change | A sea-level curve over time, global or regional (modification) |
| Desertification, deforestation | Land-cover change spreading over years; permanent once complete (modification) |
| Custom | Combine any shapes, lifecycles and modifications |

### Very large events

A global nuclear war may involve thousands of strikes. Each strike is a small formula drawn as one GPU instance into a combined intensity image, and the colour ramp is applied once at the end. Nothing huge is stored, so rendering cost grows with screen size rather than with how many strikes there are.

## Military, characters and movement

Legal ownership and military control are two separate partition layers on the same parcel map. Every military concept is derived from the gap between them or built on top of them.

### Territory in war

| Concept | How it is represented | How it looks |
| --- | --- | --- |
| Occupied territory | Control differs from ownership on a parcel | Owner's colour hatched with the occupier's |
| Contested territory | A special control value: "contested between A and B" | Stripes or a soft pulse |
| Hostility | An "at war with" relationship between two entities, with dates | Decides which meeting points become frontlines |
| Frontlines | Derived wherever hostile controllers meet; during an offensive, the frontier of its arrival-time field | Styled lines: solid, toothed, glowing |
| Multiple fronts | Automatic: every place where hostile pairs meet is a separate front | Each styled by the pair of sides |
| Manual fronts | Line features you draw and keyframe, for a stylised front | Overrides the derived line where present |

### Offensives and retreats

An offensive is a transition effect on the control layer. Choose how it moves:

- **Advancing front:** spreads from one or more origins or along an axis, optionally slowed by mountains, rivers and forests.
- **Encirclement:** several fronts converge; the pocket shows as contested until a surrender event.
- **Rapid occupation:** a fast, nearly uniform spread.
- **Retreat:** the same mechanisms in reverse.
- **Front keyframes:** draw where the front was on day 1, day 3 and day 5. The days in between are computed by blending the distance to each drawn line, which gives a smooth, faithful morph.

### Units, positions and arrows

- **Military positions and installations:** point features with lifespans and symbols, such as bases, forts, airfields, depots, objectives and defensive lines.
- **Units:** entities with a track, a symbol (your own icon set, or NATO-style if you want it) and an allegiance. Units can be grouped into larger formations.
- **Arrows:** line features with arrow styles (tapered, curved, split heads) tied to a time window. They draw themselves on as the historical moment progresses, and can be generated automatically from an offensive's axis.

### Characters and every other movement

One movement system serves characters, armies, migration, exploration, trade and transport. A track is a sequence of segments:

```ts
type TrackSegment =
  | { kind: 'stay';     at: Place;          from: Instant; to: Instant }
  | { kind: 'travel';   route: RouteRef;    from: Instant; to: Instant; pacing: 'even' | 'eased' | Keyframes }
  | { kind: 'with';     entity: EntityRef;  from: Instant; to: Instant }   // rides with an army or ship
  | { kind: 'transfer'; toSpace: SpaceRef;  from: Instant; to: Instant }   // leaves for another world
  | { kind: 'unknown';                      from: Instant; to: Instant };  // whereabouts not known
```

- The position at any time comes from the active segment, interpolated by distance along the route (true distance on a sphere).
- **Routes** are reusable features (a trade road, a sea lane) with waypoints, optional times per waypoint, direction, speed and style.
- **Large movements** such as migrations can be drawn as flow arrows whose width shows volume, or as a spreading field.
- **Records:** each segment can link to events, notes and sources, and the inspector shows a character's full itinerary.
- **Between worlds:** solar-system routes are anchored to the bodies' positions at departure and arrival, which move with their orbits. This arrives with the space maps in Stage 11.

## Presentation and animation

A shot (a *sequence*) is a recipe that points at the world; it never copies it. Every frame is computed from four things: the project, the sequence, the frame number and the time remap that links screen time to historical time.

### What a sequence holds

- the map space, and which branch or variants to show
- a style preset and which layers are visible
- the **time remap** curve
- the camera track
- overlay tracks (titles, dates, captions)
- per-shot style changes (keyframed opacity, colours, label tweaks)
- export settings

### Time remap: historical time versus screen time

The time remap is a curve from frame number to historical instant, with keyframes that can hold, run linearly or ease. For example: frames 0–120 (five seconds at 24 fps) show 14 May 06:00 to 17 May 18:00, three and a half days of history. Arithmetic is exact at any scale: *start + fraction × span*, in the two-part time format.

The event's historical duration is fixed by history. Its on-screen duration is whatever part of the curve covers it, so a three-day conquest can take five seconds in one shot and forty in another.

**Per-event override.** By default every transition follows the shot's curve, so animations always agree with the on-screen date. Optionally, one transition can be told "play over 3 seconds starting at frame 48" regardless of the curve. The app marks such a transition as *out of sync with the clock*, because the displayed date and the animation may then disagree. (Approval item.)

### How a frame is computed

```ts
function evaluateFrame(seq: Sequence, frame: number): FrameSpec {
  const screenTime = frame / seq.fps;
  const t = seq.timeRemap.instantAt(screenTime);              // historical instant
  return {
    state:    engine.stateAt(seq.space, seq.branch, t),       // parcels, features, fields, tracks at t
    camera:   seq.camera.at(screenTime),                      // centre, zoom, rotation, projection
    overlays: seq.overlays.map(o => o.at(screenTime, t)),     // e.g. the date text, bound to t
    style:    seq.style.at(screenTime),
    labels:   labels.place(seq, t, screenTime)                // depends only on these inputs
  };
}
// A frame is a pure function of (project version, sequence, frame number): render it twice, get it twice.
```

### Transitions

The engine supplies the facts (which point changed when); presentation decides the look.

| Transition | Look |
| --- | --- |
| Gradual expansion | Ownership fills in smoothly from origins |
| Advancing front | A highlighted frontier line with fill following behind; glow width and colour adjustable |
| Rapid occupation | Fast fill with a short flash on newly taken ground |
| Encirclement | Converging fronts; the pocket turns contested, then flips |
| Fragmentation | Pieces split off with staggered timing and a slight drift |
| Collapse | Pieces fade, desaturate or crumble in a seeded order |
| Infiltration and influence | Patchy, noise-modulated spread for disease, religion, ideology, contamination |
| Custom | Any combination of the parameters above |

All randomness uses stored seeds, so a transition looks identical every time it renders.

### Camera

- **Keyframes:** centre, zoom, rotation and projection, each with easing curves you can shape. Zoom interpolates on a logarithmic scale so it feels steady.
- **Smooth flights:** "zoom out, travel, zoom in" paths calculated for a natural feel over long distances. Example: whole world, to Europe, to one city.
- **Fit to region** and **follow an entity** keyframes resolve to exact positions at render time.
- **Saved positions** form a library you can reuse across shots; safe-area and aspect guides show in the viewport.
- Motion blur for fast moves comes later (Stage 10).

### Labels

- **Classes:** countries, cities, rivers, seas, mountain ranges and custom labels, each with zoom ranges and a priority.
- **Placement:** area labels sit at the most interior point of the shape; river labels follow the line. Collisions are resolved by priority, deterministically.
- **Stabilisation:** a country label's position is averaged over a fixed time window around the current instant. This stops the jitter you'd get from a shape changing every frame, and it is still a pure function of time.
- **Overrides:** move, rotate or resize any label per shot, with keyframes.
- **Fonts:** bundled open-licence fonts, plus any font you add, including fictional scripts.

### Text overlays

- Text, image or shape items, anchored to the screen or to a map position (they move with the camera).
- Font, size, colour, background box, border and shadow.
- Timing by in and out frames, or bound to an event's window through the time remap.
- Animation presets (fade, slide, type-on, scale) plus keyframes.
- **Data binding:** `{event.name}`, `{date:"d MMMM yyyy"}`, `{event.casualties | count-up}`. A casualty counter ticks up as the event plays.
- Overlays are drawn with full typography into the same frame pipeline, so they export exactly as previewed.
- **Legends** are generated from the visible layers and can be edited.

### Playback and shots across maps

- Preview plays in real time at reduced resolution. A heavy shot is rendered into a preview cache in the background and played from there.
- Shots that travel between map spaces (galaxy, to the Sol system, to Earth) use transition clips: cut, dissolve or a scale-matched zoom-through (Stage 11).

## Export pipeline

Exports render frame by frame offscreen, never by recording the screen. Each frame is rendered once per pass with identical inputs and written as numbered PNG or TIFF files, together with a manifest and a compositing guide.

### Steps of an export job

1. **Define the job:** sequence, frames (or a historical date range, converted through the time remap), resolution, frame rate (including 23.976), aspect ratio, framing or region crop, passes, format, bit depth and transparency.
2. **Pin the version:** the job records the project's exact version, so edits you make while it renders can't leak into it.
3. **For each frame:** evaluate the frame, wait until every tile, texture and font it needs is loaded, then render each pass offscreen at full size. Very large frames render in tiles if they exceed GPU limits. Pixels are read back and encoded on worker threads, producing files like `Shot012_borders_000123.png`.
4. **Write the manifest:** settings, project version, app version, datasets visible, a checksum per frame, and the compositing guide.

### One look at every resolution

Layouts are defined in *design pixels* at 1920 × 1080. 4K renders at twice that scale and 8K at four times, so line widths, labels and overlays keep their proportions. A quarter-size preview therefore looks exactly like the final, only softer. An optional *extra detail* switch uses finer source data at high resolutions without changing any sizes.

### Deterministic output

- No randomness without a stored seed, and no use of the clock.
- No animation the engine doesn't control: nothing fades in on its own.
- A strict "frame ready" barrier before any pixels are read.
- Label placement depends only on the frame's inputs, never on the previous frame.
- Version-pinned jobs, with checksums recorded per frame.

**The honest limit:** on your PC, with the same app version and graphics driver, the same frame is bit-identical every time. A different GPU or a driver update can change pixels by tiny, invisible amounts, because GPUs differ slightly in floating-point maths. The app version is recorded with every render. An optional slower *reference renderer* (software rendering, identical on any machine) is possible later if this ever matters.

### Passes and compositing in Premiere

| Pass | Contains | Premiere blend mode |
| --- | --- | --- |
| Background | Ocean or space colour, or nothing | Normal (bottom track) |
| Terrain | Elevation colours, satellite-look or imagery | Normal |
| Hillshade (optional) | Shading only, separated so you can adjust it | Multiply |
| Fills | Territory colours | Normal at your chosen opacity |
| Borders and fronts | Political borders, frontlines | Normal |
| Fields | Heatmaps, radiation, destruction | Normal, or Screen/Add for glow |
| Routes and units | Tracks, arrows, symbols | Normal |
| Labels | All map labels | Normal |
| Overlays | Titles, dates, event text | Normal (top track) |
| Beauty | Everything combined | Reference only, for checking |

The app writes the compositing guide as a short text file: track order from bottom to top, blend mode and opacity per pass. To bring a pass into Premiere, import the first frame with the image-sequence option ticked, set the frame rate under Interpret Footage, and stack the passes as the guide says. An automated test checks that the passes recombine to match the beauty pass.

### Transparency and formats

- **PNG** (default): 8 or 16 bits per channel, with straight (unpremultiplied) alpha, which Premiere reads correctly by default.
- **TIFF:** 16 bits per channel, with the alpha type tagged in the file.
- **SVG:** for vector-only passes (borders, routes, labels), mainly for stills you might refine in Illustrator.
- **ProRes 4444 with alpha** (optional, later): one movie file per pass instead of thousands of images, via bundled FFmpeg.
- Internally, frames render into 16-bit floating-point buffers, which avoids banding and keeps soft transparent edges clean.

### Speed, size and preview

An 8K frame is 33 million pixels: about 133 MB per pass before compression. Map graphics compress well, but encoding an 8K PNG takes roughly half a second to two seconds per pass on one CPU core. A 10-second shot at 24 fps with six passes is 1,440 files. Encoding runs across your 16 threads, and Stage 5 measures real timings on your machine.

Before a full render you can export a **low-resolution preview** of the same job (for example 960 × 540) and a contact sheet of thumbnails.

## Interface design

One window, one map, two modes switched from the top bar. Both modes show the same world at the same date, so switching never loses your place.

```
+-----------------------------------------------------------------------------+
| [World | Present]   Milky Way > Sol > Earth    < 14 May 1203, 06:00 >  Find  |
+--------------+-----------------------------------------------+--------------+
| OUTLINER     |                                               | INSPECTOR    |
|  Maps        |                                               |  selected    |
|  Entities    |                     MAP                       |  thing:      |
|  Layers      |                                               |  properties, |
|  Events      |                                               |  history,    |
|  Shots       |                                               |  notes       |
+--------------+-----------------------------------------------+--------------+
| TIMELINE: zoom from millennia to milliseconds, event lanes, playhead        |
+-----------------------------------------------------------------------------+
```

- **Top bar:** mode switch, where you are (galaxy, system, world), the current date with calendar entry, search, undo and redo, *Save version*, and a History Health indicator showing open conflicts.
- **Outliner:** maps, entities by type, layers (eye icon, opacity, order), events and shots.
- **Inspector:** everything about the selected thing. Its properties *at the current date*, a mini-timeline of its history, related events, notes and images.

### World-building mode

- **Tool bar:** select, pan, territory brush, border pen, vertex editor, region picker, feature tools (city, route, point, line, area), terrain tools, field paint, smart brushes.
- **Event bar:** "New event" and record mode. While an event is open, a banner shows its name and dates, and the map can show *before* and *after*.
- **Timeline:** lanes per entity or event type; lifespans of the selected entity; markers for film scenes and the film's own time span; jump to any date.
- **Compare:** pick two dates and view them side by side or with a swipe line.

### Presentation mode

- **Shot list** on the left, replacing the outliner.
- **Viewport** with frame and safe-area guides at the shot's aspect ratio.
- **Sequence timeline** in frames and seconds, with tracks for the time remap curve (screen time against historical date), camera, layer visibility and style, overlays, and later an audio reference.
- **Export panel** with presets such as *Premiere 4K PNG passes*.

### Three everyday workflows

1. **Draw the starting world:** create entities, pick a date, use the territory brush or region picker, and answer "new change from this date".
2. **Record a war:** New event → type *War* → dates and sides → record mode → draw the offensive and its fronts → close the event. Scrub to check it, and fix anything flagged in History Health.
3. **Make a shot:** New shot → pick a date range → shape the time remap → set camera keyframes → add a date overlay → preview → export passes.

### Keeping it simple

- Plain-language labels and prompts, never GIS jargon.
- Presets and guided wizards: new world, new event, first export.
- A *Basics / Advanced* switch on busy panels, so precision is available without being in the way.
- Hover help everywhere, and every action undoable.
- No setting has to be understood before you can start.
- No accounts, sharing or cloud features.

## Storage, persistence and integrity

Every action is saved the moment you make it, inside a crash-safe database transaction, so there is never unsaved work. **Save** means "create a named restore point".

### The project folder

```
My Film.mapmaker\            one folder; the app shows it as one project
  project.db                 SQLite: worlds, entities, layers, events, shots, undo journal
  project.db-wal             the database's write-ahead log (normal; part of the database)
  tiles\                     your painted and sculpted raster tiles, stored by content hash
  media\                     flags, portraits, reference images, fonts
  backups\                   rolling backups (or a folder you choose on another drive)
```

- **Shared Earth data packs** live in the app's data folder, not in each project. They are read-only and referenced by name and version. They are not backed up, because they can be downloaded again. *Make portable copy* bundles them in when you need to move everything.
- **Content-addressed tiles** mean a raster tile is stored once, under the hash of its contents. Version history and backups therefore share unchanged tiles instead of copying gigabytes.

### Saving, undo and history

| Feature | How it works |
| --- | --- |
| Autosave | Every command commits one transaction immediately |
| Undo and redo | Each command stores its reversible changes in a journal inside the database. Undo survives restarting the app, and has no arbitrary limit; very old steps are compacted into checkpoints. |
| Version history | Automatic checkpoints (for example every 15 minutes of activity and before big operations) plus named versions you create. Restoring a version adds a new step; it never destroys anything. Old versions can be opened read-only beside the current one. |
| Backups | Rolling copies made with SQLite's consistent backup method: hourly while you work (keep 24), daily (keep 30), weekly (keep 52), all adjustable. A second drive is recommended. One-click restore. |
| Crash recovery | The database guarantees the last completed action survives a crash or power cut. Long operations are all-or-nothing or resumable. On start-up the app checks the database and restores your window layout. |

### Protecting the historical record

- **Database rules:** strict column types, foreign keys and checks reject impossible data, such as an event that ends before it starts.
- **Tested migrations:** when a new app version changes the database layout, it backs up first, then upgrades with code that is tested against real older projects.
- **Health checks:** orphaned records, invalid intervals and broken references appear in a *Project Health* view. History conflicts appear in History Health. Neither is ever auto-fixed.
- **Tile checksums** catch silent disk corruption.
- **One writer:** only the data service writes to the database, so two parts of the app can never fight over it.
- **Cloud-sync warning:** a live database inside a Dropbox or OneDrive folder can be corrupted by syncing. The app warns you if you open a project from one. Backups can safely go there.

### Portability and openness

- Copy the folder to move a project; open it on any Windows PC with the app installed.
- Export to open formats at any time: GeoPackage (the map at a date, which opens in QGIS), GeoJSON, CSV of events and entities, and a full JSON dump with a documented schema. Your data is never locked in.
- Everything except dataset downloads works fully offline.

## Performance and scalability

The design scales by doing work in proportion to what is on screen and what changed, never in proportion to the whole universe. There are no hard limits; budgets adapt to your RAM and video memory.

| Concern | Technique |
| --- | --- |
| Many events and effects | Per-property timelines with binary search; compressed parcel sets; only touched timelines recompile |
| Jumping to any date | No replay from the beginning: a lookup per property in view; recently viewed dates cached |
| Smooth scrubbing | A sorted index of every change point; moving between two dates applies only the changes in between |
| Many parcels and borders | Spatial tiles and R-tree indexes; triangulation done once per detail level; scrubbing updates only colours and border visibility on the GPU |
| Complex geometry | Per-edge simplification for each zoom level (gap-free); compact fixed-point storage |
| Many overlapping layers | Each layer culled by view and date; GPU-side filtering of features by time range |
| High-resolution rasters | Tile pyramids, composed on demand; memory and GPU caches with least-recently-used eviction; zstd compression |
| Large heatmaps | Formula fields evaluated on the GPU as instances; no stored global rasters |
| Labels | Spatial-grid collision checks per frame; stabilised positions |
| Long timelines | Coarse zoom levels show event density instead of thousands of individual bars |
| 8K rendering | Offscreen rendering, tiled when needed; parallel encoding on all CPU threads |
| Heavy computations | Worker threads; Rust/WebAssembly for measured hot spots; cancellable jobs with progress bars |

**How it's verified:** a synthetic stress project is generated automatically and timed on every build. As starting targets: one million parcels, 100,000 events and 10,000 entities, with scrubbing staying interactive and an 8K frame rendering in seconds, not minutes. Slowdowns are caught before they reach you.

## How development and delivery work for you

You never touch code, a terminal or git. I write and test the code; you install builds and try them.

1. **Code lives in a private GitHub repository.** You need a free GitHub account, so the repository can be yours. GitHub holds only the code: your project files never leave your PC, and the app never needs GitHub to run.
2. **Automated builds** produce a Windows installer for every milestone. You download it from a link and double-click it. One-click updates from inside the app can be added later.
3. **Every stage ends with:** plain-language release notes, a sample project, and an acceptance checklist of 10–20 minutes of things to try.
4. **Reporting problems:** describe it in your own words, with a screenshot if possible. A *Copy diagnostics* button gathers logs for me, but never your project data unless you choose to include it.
5. **Your part:** testing builds, making the decisions in the last section, and giving me film material (place names, factions, timeline notes) when we reach those stages.

One practical blocker: this chat's environment can't install software packages, so development needs a setup that can. Either we work in Claude Code connected to the GitHub repository, or you enable package installs in your network settings (a new chat picks that up).

## Development roadmap

Fourteen stages, each ending in an installable app that works. The minimum viable foundation, real history recorded and preserved, is reached at the end of Stage 3. First real footage in Premiere comes at the end of Stage 5.

&#91;embedded content: roadmap · 14 stages in 4 phases, 2 gates\]

The two gates mark when the app becomes genuinely useful: recording history after Stage 3, and producing footage after Stage 5.

### Why this order differs from your suggestion

- **Storage before editing.** From the first real stage, everything you create is kept safely, so nothing is a throwaway demo.
- **Timeline and reconstruction merged.** They are one engine; splitting them would mean building it twice.
- **Export moved early, to Stage 5.** Export is a central purpose and a high risk. Proving the Premiere pipeline (transparency, determinism, 8K speed) before polishing animation avoids late surprises.
- **Terrain before smart brushes.** The brushes need rivers, ridges and roads to follow, which come from the terrain and data stages.
- **Space maps after the core.** They reuse the parcel map, tracks and rendering, so they are cheaper once those exist.

Effort sizes are relative (M, L, XL), not calendar promises. Pace depends on how often we work and how quickly testing feedback comes back.

### Stage 0: Groundwork and risk checks (M)

- **Builds:** the repository and automated Windows installer builds; the app shell; a pannable, zoomable, rotatable Earth map (Natural Earth, equirectangular); working prototypes of the sphere-safe parcel kernel, the two-part time type, SQLite storage and transparent PNG frame export.
- **You can:** install the app, explore a world map, and drop a test PNG with transparency into Premiere.
- **Depends on:** nothing.
- **Tested by:** randomised kernel tests (including borders across the poles and the 180° line), time arithmetic tests, a reference-image render test, an installer test on Windows.
- **Deferred:** everything else. This stage exists to prove the four riskiest foundations first.

### Stage 1: Project, storage and world model (L)

- **Builds:** create and open projects; database schema and migrations; undo journal; autosave; named versions; rolling backups; crash recovery; map spaces (Earth plus a blank fictional world); entity types and entities with names, colours and notes; outliner and inspector.
- **You can:** start your real project, and create countries, factions, characters and cities with descriptions. Close, reopen, undo and restore backups.
- **Depends on:** Stage 0.
- **Tested by:** forced-crash tests (killing the app mid-write must leave the project intact), migration tests, undo/redo round-trip tests, backup-restore tests.
- **Deferred:** map editing and time.

### Stage 2: Parcel map and territory editing (XL)

- **Builds:** the production parcel kernel; territory brush, border pen, vertex editor, split and merge, snapping, smoothing and irregularity; administrative boundaries loaded as parcel edges; region picker; political fills, derived borders and simple country labels; coastline clipping.
- **You can:** draw a precise political map for one moment, using real boundaries, freehand, or both.
- **Depends on:** Stages 0 and 1.
- **Tested by:** heavy randomised kernel testing; checks that partitions never have gaps or overlaps; reference images; a timing benchmark with detailed global admin boundaries.
- **Deferred:** time (edits apply to the base state), smart brushes, other layer kinds.

### Stage 3: Time and event engine (XL) — minimum viable foundation

- **Builds:** instants and the Gregorian calendar; events and custom event types; effects with intention and result; the compiler and property timelines; the world at any date; the zoomable timeline; the edit prompt with three choices; record mode; History Health with keep and re-apply; precedence and overlap rules; date comparison.
- **You can:** record real history. Create, split, merge and re-border countries across centuries; scrub to any date; insert a past event and watch later history update; resolve flagged conflicts.
- **Depends on:** Stages 1 and 2.
- **Tested by:** randomised engine tests proving that inserting or removing an event never changes anything before its date or any untouched property; the compiled index always equals a naive full replay; conflict detection tests; tests at dates a trillion years apart; interface tests of the prompt.
- **Deferred:** animated transitions (changes are instant for now), variants, other layer kinds.

### Stage 4: Layers, entities and lore (M)

- **Builds:** layer manager with partition, area, line and point layers; custom layers; feature lifespans and dated shapes; relationships (part of, at war with, successor of); cities with lifespans; rich notes and images; search; event variants; export to GeoJSON and CSV.
- **You can:** build religions, influence zones, claims and infrastructure; write lore; keep two versions of an undecided event and flip between them.
- **Depends on:** Stage 3.
- **Tested by:** layer independence tests, variant compile tests, search tests.
- **Deferred:** fields and tracks.

### Stage 5: First shots and export (L)

- **Builds:** basic presentation mode: sequences, time remap, camera keyframes with easing, title and date overlays, simple and detailed political styles. Export of PNG sequences with passes and transparency, at every resolution up to 8K and every frame rate including 23.976; low-resolution preview; manifest and compositing guide; version-pinned shots.
- **You can:** make real test shots of history changing and composite them in Premiere.
- **Depends on:** Stage 3 (Stage 4 is optional).
- **Tested by:** render-twice checksum comparisons; passes recombined against the beauty pass; a Premiere checklist you run; 8K timing on your PC.
- **Deferred:** animated transitions, advanced camera, animated overlays.

### Stage 6: Transitions and animation (L)

- **Builds:** transition effects; arrival-time fields; front keyframes; all the transition styles; per-event animation settings; label stabilisation; the per-event override if you approve it.
- **You can:** animate conquests and spreading influence that match the recorded history exactly.
- **Depends on:** Stages 3 and 5.
- **Tested by:** field checks (arrival times only move forwards; the end state equals the event's result); world-building and presentation agree mid-transition; reference animations.
- **Deferred:** terrain-weighted speeds arrive with terrain in Stage 8.

### Stage 7: Military, characters and movement (L)

- **Builds:** military control layer, occupied and contested display, hostility, derived and manual frontlines, units and symbols, installations, self-drawing arrows, routes, character tracks, migration flows.
- **You can:** stage wars with occupation and fronts, follow characters' journeys, and animate troop movements.
- **Depends on:** Stages 4 and 6.
- **Tested by:** ownership-versus-control rules, track interpolation tests, frontline derivation tests.
- **Deferred:** travel between worlds (Stage 11).

### Stage 8: Terrain and fictional worlds (XL)

- **Builds:** raster tile store; Earth setup wizard (global terrain, land cover, imagery) and regional detail downloads (roads, railways, cities, 30 m terrain, 10 m imagery); planet generator; sculpting; rivers and biomes; elevation tint, hillshade, satellite-look and imagery rendering; real Moon and Mars data; dated permanent terrain changes.
- **You can:** create fictional planets in the app; see realistic Earth terrain; use terrain and real roads as features.
- **Depends on:** Stages 2 and 3.
- **Tested by:** generator reproducibility from a seed; rivers always flow downhill to a sea or basin; tile composition tests; performance with regional 30 m data.
- **Deferred:** smart brushes (Stage 12).

### Stage 9: Environment and fields (L)

- **Builds:** field layers (formulas, painted keyframes, point density) with colour ramps; conditions with lifecycles; all disaster templates; assisted and by-hand modes; GPU accumulation for thousands of events.
- **You can:** animate a nuclear war's destruction and fallout across continents, plus floods, fires, quakes and more.
- **Depends on:** Stages 6 and 8.
- **Tested by:** field reproducibility; a stress test of thousands of simultaneous strikes at 4K; lifecycle curve tests.

### Stage 10: Presentation polish (L)

- **Builds:** smooth camera flights, follow and fit keyframes; animated, data-bound overlays; legends; a label editor and curved labels; a style editor and presets, including era styles; projection choice and projection changes within a shot; 16-bit TIFF; SVG for vector passes; optional ProRes 4444; motion blur.
- **Depends on:** Stages 5 to 9.
- **Tested by:** reference images and a visual review checklist.

### Stage 11: Space maps (L)

- **Builds:** the solar system with orbits and scale modes; nearby stars; exoplanets with generated surfaces; the Milky Way; nearby galaxies; links between maps; interstellar territory; travel between worlds; shots that move between maps.
- **Depends on:** Stages 4, 7 and 8.
- **Tested by:** orbital positions against published reference values; catalogue import checks.

### Stage 12: Smart brushes (L)

- **Builds:** the geography-aware brush and the strategic brush, with feature weights and live preview.
- **Depends on:** Stages 2 and 8 (features), and Stage 7 (military objects for the strategic brush).
- **Tested by:** synthetic terrains with known best paths, plus your own acceptance testing.

### Stage 13: Branches, calendars and refinement (M–L)

- **Builds:** full alternative timelines with side-by-side comparison; fictional calendars per world; the faster GPU projection method; optional reference renderer; audio reference track; optimisation; long-term maintenance tools such as tidying unused parcel edges.
- **Depends on:** all earlier stages.

## Testing strategy

The two places where bugs would hurt most, the geometry kernel and the temporal engine, get randomised property tests that check rules over millions of generated cases rather than a handful of examples. Every build runs the automated tests before an installer is produced.

| Level | What it checks | Tools | When |
| --- | --- | --- | --- |
| Unit tests | Individual functions: time arithmetic, calendars, projections, style rules | Vitest | Every build |
| Property tests: kernel | Random borders, including near-duplicates, poles and the 180° line. No gaps, no overlaps, no self-crossing; areas add up; splitting never changes any earlier value | fast-check | Every build; long overnight runs |
| Property tests: engine | Random event sets. Inserting or removing an event never changes anything before it or any untouched property; compiled timelines equal a naive full replay; undo restores exactly | fast-check | Every build |
| Persistence tests | Forced crashes during writes; migrations on stored sample projects of every older version; backup and restore round trips | Vitest + scripted crashes | Every build |
| Render tests | Reference images compared pixel by pixel, using software rendering in the build system so results are identical; passes recombine to the beauty pass; render twice, identical checksums | Playwright + pixel comparison | Every build |
| Interface tests | Real clicks through key workflows: draw territory, create an event, answer the prompt, export a shot | Playwright for Electron | Every build |
| Performance tests | The synthetic stress project: scrubbing speed, compile time, 8K frame time, memory | Benchmark suite | Every build, with alerts on slowdowns |
| Acceptance tests | Your checklist per stage, on your own PC and in Premiere | You | End of each stage |

When you report a bug, I first add a test that reproduces it, so the same bug cannot quietly return.

## Technical risks and hard problems

Three requirements are genuinely hard and carry the most risk: the sphere-safe parcel kernel, the temporal engine's consistency guarantees, and the smart brushes. None of them is dropped; each has a mitigation and, where needed, an honest compromise.

| Risk | Why it is hard | What it needs | Mitigation | Compromise, if any | Rating |
| --- | --- | --- | --- | --- | --- |
| Parcel kernel on a sphere | Robust geometry is notoriously fragile: near-touching lines, rounding, degenerate cases | Custom algorithm, long testing | Fixed-point grid, snap rounding, 3D vector maths, proven in Stage 0 and fuzzed constantly | Fallback is a flat-plane kernel with special pole handling: workable but less clean | High |
| Reconstruction and consistency after edits | Every edit must update later history yet never disturb earlier or unrelated history | Custom engine, dependency tracking | Hybrid design that guarantees this by construction; randomised tests against full replay | None expected | High |
| Simultaneous and overlapping events | Two changes to the same place at the same time need a rule people find natural | Clear rules and an interface for them | Precedence order, visible conflicts, default rules you approve | A rule may sometimes surprise you; you override it | Medium |
| Parcel fragmentation over years | Many nearly identical borders create tiny slivers | Maintenance tooling | Snapping on by default; a tidy-up tool (Stage 13) | — | Medium |
| Geography-aware and strategic brushes | Research-level problem; quality depends on feature data | Custom algorithms, tuning | Proven path-finding technique; scheduled late, when data exists | They propose borders and may need adjusting, never a guarantee | High |
| Actual geographical modification | Terrain, rivers and coastlines must stay consistent at every date | Compute, caching | Tiles composed per set of active changes; rivers recomputed only in the affected basin | Updating rivers after a big change may take seconds | Medium |
| Planet generator quality | Plausible, beautiful planets are as much art as code | Iteration with you | Presets, seeds, sculpting tools to fix anything | Some planets will need hand finishing | Medium |
| Large-scale heatmaps | Global, high-resolution fields could be huge | GPU computation | Formula fields on the GPU; painted fields streamed as tiles | Very detailed hand-painted global fields are slower to edit | Medium |
| Deterministic high-resolution export | Data loads in the background; GPUs differ slightly | A strict render barrier | Frames as pure functions; version pins; checksums | Bit-identical on your PC and driver; tiny invisible differences across machines | Medium |
| Labels on animated shapes | Shapes change every frame, so labels jitter | Custom placement | Time-window stabilisation; keyframable overrides | The best shots may need a few manual label tweaks | Low |
| Projection changes mid-shot | Re-projecting everything per frame costs CPU time | Compute | Exact in exports; lower detail in live preview; GPU path later | Preview of those shots is less detailed | Low |
| Earth data volume | Regional detail runs to tens of gigabytes | Disk space, download time | You choose regions; packs shared across projects | No global street-level detail by default | Low |
| Licence and offline terms | A few sources' offline terms still need confirming | Checking before use | Licences recorded per dataset; alternatives listed | One imagery source might need replacing | Low |
| Testing on your GPU | My build environment has no AMD GPU | Your acceptance checks | Software-rendered reference tests; a diagnostics button | Driver-specific bugs surface only on your PC | Medium |
| Overall scope | 14 stages is a long build | Sustained effort | Useful foundation at Stage 3 and footage at Stage 5; re-plan after every stage | Later stages may be reprioritised for the film's needs | Medium |

## Decisions needing your approval

Twelve decisions. Tick the ones you approve and comment on any you want changed; I won't start Stage 0 until they're settled.

- [x] **Core architecture.** One project database as the only source of truth; events storing outcome plus intention; a shared parcel map for territory; caches never authoritative.
- [x] **Technology stack.** Electron, TypeScript and React; deck.gl with custom layers instead of MapLibre; SQLite; a custom sphere-safe geometry kernel.
- [x] **Platform and machine.** I'm assuming Windows 10 or 11. Please also tell me your RAM and free disk space, which set the cache budgets and how much Earth detail is comfortable.
- [x] **Roadmap order.** 14 stages, the minimum viable foundation at Stage 3 and first footage at Stage 5, with export moved early.
- [x] **The edit prompt.** Three choices (new change from this date, correct this period, correct for all time), plus record mode to skip the prompt while an event is open.
- [x] **Overlapping conquests.** Default rule: the later-starting event takes over the shared area from its start, flagged in History Health.
- [x] **Per-event animation override.** Include the option to play one transition over a set number of seconds, marked "out of sync with the clock"? Or always follow the shot's time remap?
- [x] **Projections.** Equirectangular as the default for fictional worlds, Equal Earth for world overviews, and the automatic regional projection for zoomed-in shots.
- [x] **Datasets.** The list in *Geography and GIS*, including the non-commercial GADM and EOxCloudless, since your film is non-commercial.
- [x] **Development set-up.** A free GitHub account with a private repository; installers delivered per milestone; development run in an environment that can install packages.
- [x] **Nearby-stars radius.** How far out the star map should reach: about 50 light-years, about 100 light-years, or further?
- [x] **Start.** Approval to begin Stage 0: groundwork and risk checks.

## Sources

- [MapLibre GL JS roadmap: non-Mercator projection](https://maplibre.org/roadmap/maplibre-gl-js/non-mercator-projection)
- [deck.gl: What's new](https://deck.gl/docs/whats-new)
- [GEBCO grid terms of use](https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use)
- [HYG database](https://www.astronexus.com/hyg/964)
- [GADM licence](https://gadm.org/license.html)
- [EOxCloudless licence summary](https://cloudless.eox.at/documentation/license)
- [geoBoundaries overview (Atlas)](https://atlas.co/data-sources/geo-boundaries/)

Licences marked "confirm when added" in the datasets table will be checked against the provider's page before that dataset is used.
