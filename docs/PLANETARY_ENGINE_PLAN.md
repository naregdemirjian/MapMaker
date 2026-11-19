# Planetary evolution engine: technical assessment and implementation plan

19 November 2026. Stage 14 of Map Maker (the approved roadmap ended at Stage 13). This document is the plan asked
for before any code: what exists, what must change, which scientific models to use and why, how the parts fit,
how it will be made fast, how it will be tested, and the order of work. Progress against it is recorded at the
end (section 14) and in DECISIONS (from D152).

## Contents

1. Summary
2. What exists today (assessment)
3. Principles
4. Architecture
5. Data structures
6. Scientific models and algorithms, subsystem by subsystem
7. Rendering
8. Interface and user experience
9. Performance strategy
10. Integration with the existing application
11. Testing and validation
12. Staged roadmap (two sessions)
13. Risks, limitations and honest boundaries
14. Progress record

---

## 1. Summary

Two ways to make a world:

- **Mode A, classic generation** (exists, D97/D98): a seed and a few sliders make continents; the user then shapes
  everything by hand. It stays, and gains direct tools (draw coasts, paint biomes, edit rivers).
- **Mode B, simulated planets** (new, the flagship): the user describes a star, an orbit, a planet, its interior,
  air and water, and a geological history; the engine simulates plate tectonics, crust and mountain building,
  erosion and sedimentation, climate, oceans, rivers, lakes, ice and biomes over geological time, on one shared
  planetary state. The map is the present-day result, the history can be scrubbed, and every feature has a cause
  the user can inspect.

The central technical decisions:

1. **A planetary engine as its own layer** (`src/planet/`), pure TypeScript over typed arrays, independent of the
   interface, running in **Web Workers** (none exist today) and in Node for tests.
2. **A geodesic (icosahedral) mesh** for simulation, nested at several resolutions (about 41 000 to 2.6 million
   cells), with finite-volume operators. The existing longitude/latitude grid is kept for rendering: simulation
   results are rasterised onto it, so the renderer, the map and every tool that uses terrain keep working.
3. **Plates as rigid caps moving by Euler rotations, crust held in each plate's own frame** (after Cortial et al.
   2019), with geophysical rules for what happens where plates meet: ridges with age-dependent depth, subduction
   with trenches and arcs at a slab-dependent distance, collisions that thicken crust, rifting by stretching,
   hotspot chains, Airy isostasy with regional (flexural) compensation.
4. **Landscape evolution by the stream-power law** solved with Braun and Willett's O(n) implicit method, with
   hillslope diffusion and sediment routing, coupled to tectonic uplift and to precipitation.
5. **A reduced-complexity climate system**: orbital insolation (any tilt, eccentricity, day length, tidal locking,
   more than one star), a seasonal two-dimensional energy-balance model with greenhouse, albedo and heat-transport
   scaling for other planets, a diagnosed general circulation (Held and Hou), moisture transport with orographic
   precipitation (Smith and Barstad), wind-driven ocean gyres (Stommel and Munk) feeding heat back.
6. **Hydrology and ice**: Budyko runoff, Fill-Spill-Merge lakes and closed basins, rivers by discharge, ice sheets
   by degree-day mass balance and the shallow-ice approximation, sea level from conserved water volume.
7. **Biomes** from Köppen-Geiger and Whittaker classifications of the simulated climate, plus user-defined biome
   rules for fictional worlds.
8. **A history of checkpoints**: the simulation stores its state every few million years; any moment between is
   reconstructed from the plates' rotations and the stored crust, not blended between pictures. The map's time
   axis reaches back through the planet's history (as the Earth's geological maps do today, D134/D135).
9. **A Planet Studio**: a workspace for configuring, simulating, inspecting and then editing a planet, in plain
   language with diagrams, presets and live previews; heavy work runs in the background with progressive results.
10. **Every product carries its provenance**: physically based, empirical, simplified, artistic or overridden.

The work is split into two sessions (section 12): the engine core and the solid planet first (mesh, physics,
tectonics, landscape evolution, the studio's first half), then the fluid planet and life (climate, oceans, water,
ice, biomes, editing, validation).

---

## 2. What exists today (assessment)

### 2.1 Terrain data and rendering

- `terrain/grid.ts`: an `ElevationGrid` is a longitude/latitude (equirectangular) grid of Int16 heights in whole
  steps of metres; generated planets are 2048 × 1024 cells (about 20 km on an Earth-sized planet); the Earth is
  4096 × 2048 (about 10 km), stored compressed (MMT1, a LOCO-I predictor and zlib).
- `render-engine/terrain-gl.ts` (D95): a WebGL2 shader reads the grid as a half-float texture with mipmaps and
  colours it per pixel by palette, relief shading, land-sea mask, land cover (a colour texture, D100), sea level of
  the moment (D96), sculpting overrides (D98), fine made-up detail close in (D141) and the photographed Earth
  (D138). It works for every projection, the globe (D127) and exports.
- The map's terrain comes from `store.terrainOf(space, t)`: the Earth's grid, a generated planet's grid, or the
  Earth's paleogeography at the time shown (D134), where heights between two maps move with the crust (D135, a
  motion field per interval) rather than fade.

### 2.2 Generated planets (Mode A today)

- `terrain/planet.ts` (D97): continents are low-frequency simplex noise; "plates" are random points on the sphere
  whose Voronoi edges, bent by noise, add mountain belts on land and ridges at sea; finer and ridged noise add
  texture; the sea level is set by a histogram so the sea covers the share asked for; heights are scaled to metres;
  ice thickens land towards the poles; a barren moon gets craters; a gas giant gets bands.
- Settings: preset, seed, sea share, continents, mountains, roughness, ice. Deterministic, so only settings are
  stored; heights are rebuilt on opening (about 2 s, on the interface's thread, a few rows at a time).
- There is no plate model (the "plates" do not move or interact), no time evolution, no physical parameters
  (radius is used only for distances; there is no star, orbit, rotation, gravity or atmosphere).

### 2.3 Water, climate and life today

- `terrain/rivers.ts` (D99): priority flood from the coast, D8 receivers on the latitude/longitude grid, flow
  accumulation of uniform rain weighted by cell area, rivers traced where flow passes a threshold. Every river
  reaches the sea (depressions are filled, never lakes).
- `terrain/biomes.ts` (D100): warmth from latitude (a fixed quadratic) and height (6.5 °C per km); moisture from
  fixed latitude rain belts and an advection of moisture along fixed wind directions by latitude with rain shadows;
  a preset adds a fixed warmth and wetness offset; ten Earth biomes and their colours.
- `terrain/sea-level.ts` (D96): sea level over time as user-set points. `terrain/sculpt.ts` (D98): dated or
  permanent brush stamps changing heights. `domain/fields` (D102/D103): fires, floods and lava spreading over
  terrain.

### 2.4 Infrastructure

- Storage: SQLite rows with an undo journal; map settings as JSON; binary files as content-hashed assets.
- Time: instants exact across ±24 trillion years; deep-time maps show dates as "how long ago".
- Build: esbuild, one browser bundle, the server and the Electron main process. No worker entry points.
- Compute: everything runs on the interface's thread. No Web Workers, no WebAssembly, no WebGPU. The server is a
  local Node process (Electron or `node dist/server.mjs`) that could also compute (worker_threads), and it serves
  the interface itself, so cross-origin isolation headers (needed for SharedArrayBuffer) can be added.

### 2.5 What this means for the new engine

| Need | Today | Change required |
| --- | --- | --- |
| Simulation grid without pole singularities, nested resolutions, local refinement | lat/lon raster only | New geodesic mesh layer; rasteriser to the existing grid |
| Long computations without freezing the interface | main thread only | Worker pool, message protocol, cancellation, progress |
| Planetary physics (star, orbit, rotation, gravity, atmosphere) | none | New planet definition with derived quantities |
| Moving, interacting plates; crust with age and thickness | Voronoi edges in noise | New tectonics subsystem |
| Elevation from processes | noise | Isostasy + tectonic uplift + erosion and deposition |
| Climate from physics | latitude heuristics | Insolation, energy balance, circulation, moisture, oceans |
| Rivers from rain; lakes and closed basins | uniform rain, no lakes | Runoff, Fill-Spill-Merge, discharge-based networks |
| Time-varying terrain for a made planet | only the Earth's paleo maps | Checkpointed histories feeding `terrainOf(space, t)` |
| Storing large results | settings only | Versioned binary products as project assets |

Nothing in the existing renderer, parcel kernel, temporal engine or tools has to be rewritten: the engine delivers
the same products they already consume (an `ElevationGrid` per moment, a land cover texture, river lines, a sea
level), at higher fidelity.

---

## 3. Principles

1. **One planetary state, many processes.** Subsystems read and write named fields of a shared state through
   declared interfaces; none generates features of its own in isolation. Mountains exist because crust thickened;
   rain falls because air rose; rivers run where the water goes.
2. **Causality is inspectable.** Every product can say where it came from (which process, which event, which
   parameter), and every override is marked as such.
3. **Honest models.** Each calculation is labelled: physically based (from conservation laws or established
   physics), empirical (a measured relation, e.g. ocean depth against crust age), simplified (a reduced model with
   stated assumptions), artistic (variation for looks, e.g. noise below the simulated resolution), or user
   override. Nothing is called a simulation that is not one.
4. **Deterministic.** The same definition, seed and engine version give the same planet, bit for bit, whatever the
   number of workers. Products can therefore be rebuilt if missing, and cached by a hash of their inputs.
5. **Progressive, never inconsistent.** Fast previews use the same models at lower resolution or shorter horizons;
   the final product refines, it does not replace with something else. Staleness is visible, never silent.
6. **Creative freedom.** Users can override anything; overrides are kept, explained and reversible.
7. **No Earth hard-coding.** Constants (gravity, densities, lapse rate, rotation, insolation, water inventory)
   come from the definition; Earth is a preset, not an assumption.
8. **Extensible.** Each subsystem sits behind an interface so a better model (a 3D mantle model, a full general
   circulation model) can replace a reduced one later without changing its neighbours.

---

## 4. Architecture

### 4.1 Layers and modules

```
src/planet/                      the engine (no DOM, no React; runs in workers and in Node)
  model/      definition.ts      what the user sets (versioned JSON schema), validation, presets
              physics.ts         derived quantities (gravity, insolation, equilibrium temperature, scale height, ...)
              units.ts           units and conversions; constants
  mesh/       icosphere.ts       nested icosahedral mesh: cells, neighbours, areas, dual edges, point location
              operators.ts       gradient, divergence, Laplacian, upwind advection on the mesh
              transfer.ts        restriction and prolongation between levels; rasterisation to lon/lat grids
  state/      fields.ts          the planetary state: named typed-array fields with units and provenance
              history.ts         checkpoints, reconstruction at any time, compaction
              codec.ts           binary format (MMS1) for products and checkpoints
  tectonics/  plates.ts          plates, Euler rotations, kinematic history, driving-force heuristics
              crust.ts           crust in plate frames: type, thickness, age, density, sediment, history tags
              boundaries.ts      boundary detection and classification (divergent, convergent, transform)
              processes.ts       ridges, subduction, arcs, collisions, accretion, rifting, hotspots, LIPs
              isostasy.ts        Airy and flexural compensation; thermal subsidence; elevation from crust
  surface/    drainage.ts        receivers, stacks, depressions (priority flood) on the mesh
              erosion.ts         stream-power incision (implicit O(n)), hillslope diffusion, glacial erosion
              sediment.ts        sediment routing and deposition (deltas, shelves, basins)
  climate/    insolation.ts      orbital geometry, seasons, tidal locking, several stars
              ebm.ts             seasonal 2D energy balance (greenhouse, albedo, heat capacity, transport)
              circulation.ts     Hadley/Ferrel/polar cells, winds, ITCZ, monsoons, tidally locked flow
              moisture.ts        evaporation, advection, condensation, orographic precipitation
              ocean.ts           wind-driven gyres (barotropic vorticity), ocean heat transport, upwelling
  hydro/      runoff.ts          evapotranspiration (Budyko) and runoff
              lakes.ts           Fill-Spill-Merge: lakes, closed basins, overflow
              rivers.ts          discharge, networks, orders, deltas, floodplains, wetlands
              ice.ts             mass balance (degree days), shallow-ice flow, isostatic load
              sealevel.ts        sea level from water volume, ice volume and basin volume
  biomes/     classify.ts        Köppen-Geiger, Whittaker, alpine, wetland, ice; custom biome rules
              palettes.ts        colours seen from space (Earth-like and fictional vegetation)
  pipeline/   stages.ts          the stage graph: inputs, outputs, resolution, cost, invalidation
              scheduler.ts       runs stages in workers, progress, cancellation, checkpoints, caching
              products.ts        what the map consumes: rasters per moment, cover, rivers, sea level
  worker/     entry.ts           the worker's entry point (built separately by esbuild)
              pool.ts            the pool, message protocol, transfer of typed arrays
src/ui/planet-studio/            the Planet Studio (React)
```

### 4.2 Data flow

```
PlanetDefinition (map settings, small JSON; undoable)
   │  + Timeline events + Edits
   ▼
Pipeline (workers) ──► History: checkpoints of the PlanetState every Δt (assets, compressed)
   │                        └─► any moment t: plates rotated exactly, crust and surface from the nearest
   │                            checkpoint advanced deterministically
   └─► Present products (assets): elevation raster(s), sea level, land cover, climate fields (monthly
       temperature and precipitation), runoff, rivers, lakes, ice, biomes, provenance
   ▼
Map (terrainOf / coverOf / rivers / sea level, per moment) ─► renderer, tools, exports  (unchanged consumers)
Planet Studio ─► previews, layers, explanations, editing
```

### 4.3 The time loop and coupling

The history is integrated from the planet's start to the present with a variable step (coarser when nothing fast
happens, finer near events and towards the present). Each step:

1. **Kinematics**: plates rotate by their Euler vectors for the step; events may change poles, split or merge
   plates (reorganisations, rifts, sutures).
2. **Crust interactions**: assemble the global surface (which plate covers each cell), classify boundaries, apply
   ridge accretion, subduction and consumption, arc magmatism, collision and thickening, accretion of terranes,
   rift stretching, hotspot and large-igneous-province volcanism.
3. **Isostasy**: elevation of every cell from its crust (thickness, density, temperature, sediment and ice loads),
   compensated regionally (flexure).
4. **Surface processes** (every step or every few): drainage, stream-power incision with precipitation-weighted
   discharge, hillslope diffusion, glacial erosion where ice lies, sediment routing and deposition; eroded and
   deposited thickness goes back into the crust, so the crust rebounds isostatically.
5. **Climate and water** (every few million years during the history; fully at the present): insolation for the
   epoch (the star brightens with age), energy balance, circulation, precipitation, ocean heat transport, ice
   sheets, sea level. Precipitation feeds erosion; ice feeds glacial erosion and loading; sea level feeds coastal
   processes and the land-sea mask.
6. **Checkpoint** every Δt_ckpt (about 5 to 20 million years, finer near the present).

The present-day climate, water and biome products are then computed at the final resolution (section 9.3).

### 4.4 Stages and incremental recalculation

The pipeline is a graph of stages, each declaring the definition fields and upstream products it depends on and
the products it makes. Each product is keyed by a hash of its inputs and the engine version, so:

- moving a climate slider (tilt, greenhouse, distance) re-runs only the present climate, water and biome stages
  (seconds) and marks the history's climate coupling as stale, with a clear "re-run history with this climate"
  action (because erosion over time depended on the old climate);
- editing an event at 300 million years ago re-runs from the checkpoint before it, not from the beginning;
- an edit at the present (a new volcanic island) re-runs its local consequences (section 8.6).

### 4.5 Workers and determinism

- A pool of `hardwareConcurrency - 1` workers (at least one). The scheduler owns the state; workers run kernels on
  partitions of the mesh (contiguous cell ranges in a locality-preserving order) and return typed arrays by
  transfer (zero copy). Kernels are pure functions with deterministic reductions (fixed partition boundaries and a
  fixed order of combination), so results do not depend on the number of workers.
- Long runs report progress and partial previews (the latest checkpoint) and can be cancelled.
- The same engine runs in Node for unit tests and benchmarks, and could run in the local server for very large
  planets (worker_threads) without changes.

---

## 5. Data structures

### 5.1 The planet definition (stored in the map's settings, `sim`)

```ts
interface PlanetDefinition {
  version: 1;
  seed: number;
  star: { stars: StarSpec[]; arrangement: 'single' | 'circumbinary' | 'distant-companion' };
  orbit: { semiMajorAu: number; eccentricity: number; periodDays?: number /* derived unless overridden */ };
  body: { radiusKm: number; massEarths?: number; obliquityDeg: number; dayHours: number; tidallyLocked?: boolean };
  interior: { heatProduction: number /* × Earth's */; coreFraction: number; mantleViscosity?: number /* advanced, × Earth's */;
              crustStrength?: number /* advanced */; regime: 'mobile-lid' | 'stagnant-lid' | 'episodic' | 'auto' };
  tectonics: { plates: number; activity: number; continentalFraction: number; hotspots: HotspotSpec[]; overrides: PlateOverride[] };
  atmosphere: { pressureBar: number; composition: { co2: number; h2o: 'auto' | number; ch4: number; n2: number; o2: number }; clouds: number };
  water: { oceanFraction: number /* of the present surface */ | null; inventoryKm3?: number; salinity?: number };
  history: { ageGyr: number; events: GeoEvent[] };
  life: { biomeSet: 'earth' | 'custom'; biomes?: CustomBiome[]; vegetationPalette: 'earth' | 'red-dwarf' | 'custom' };
  simulation: { quality: 'preview' | 'standard' | 'high'; finalRaster: 2048 | 4096 | 8192 };
  edits: PlanetEdit[];            // post-simulation edits with their explanations (section 8.6)
  overrides: Override[];          // values or regions the user fixed by hand
}
```

Derived values (gravity, insolation, year length, equilibrium temperature, scale height, Hadley extent, heat flow
...) are computed by `physics.ts`, shown to the user, and overridable where that makes sense; an override is
stored explicitly so the relationship stays visible ("year length set by hand: 400 days; Kepler would give 365").

### 5.2 The geodesic mesh

- Level L of a subdivided icosahedron has 10·4^L + 2 cells (the dual Voronoi cells of its vertices: 12 pentagons,
  the rest hexagons). L5: 10 242 cells (about 220 km on Earth), L6: 40 962 (110 km), L7: 163 842 (55 km), L8:
  655 362 (28 km), L9: 2 621 442 (14 km).
- Stored as typed arrays: unit position (Float64 ×3), latitude and longitude, cell area (the spherical Voronoi area,
  summing to 4π), neighbours in CSR form (offsets + indices, 5 or 6 each, ordered around the cell), and per edge the
  great-circle distance between centres and the length of the shared Voronoi edge (for finite-volume operators).
- Nesting: the vertices of level L are vertices of level L+1, so restriction (fine to coarse: area-weighted mean
  over the coarse cell's footprint) and prolongation (coarse to fine: barycentric interpolation in the coarse
  triangle) are exact and cheap.
- Point location: descend from the icosahedron's 20 faces through the subdivision (four children per triangle),
  O(L) per point, exact; returns the triangle and barycentric weights (for interpolation) or the nearest cell.
- Ordering: cells numbered along a space-filling curve per icosahedron face for memory locality and contiguous
  worker partitions.

### 5.3 The planetary state (fields)

All fields are typed arrays on one mesh level, with a declared unit and a provenance code:

| Group | Fields |
| --- | --- |
| Plates | `plate` (Uint16, the plate covering the cell), plate table (Euler vector, rotation history, age, kind) |
| Crust | `crustType` (Uint8: oceanic, continental, arc, plateau, rift, ...), `thickness` (km), `density`, `age` (Myr since formation), `orogenyAge`, `sediment` (km), `tags` (bit flags: suture, ophiolite, LIP, hotspot track) |
| Surface | `elevation` (m above the datum), `bedrock`, `iceThickness`, `lakeLevel`, `receiver` (Int32), `discharge`, `erosionRate`, `depositionRate` |
| Climate | `tMonthly` (12 × Float32), `pMonthly` (12 × Float32), `evaporation`, `windU/V` (seasonal), `sst`, `currentU/V`, `snowFraction` |
| Water and life | `runoff`, `lakeId`, `riverOrder`, `wetland`, `biome` (Uint8), `koppen` (Uint8) |
| Provenance | `provenance` (Uint8 bits per field group: simulated, edited by explanation, overridden by hand) |

Plates keep their crust in **their own frame** (5.4), so the global fields above are assembled views at a moment.

### 5.4 Plates and crust (the Lagrangian part)

- Each plate has a rotation history: piecewise-constant angular velocity vectors (Euler poles and rates) per
  interval, composed as quaternions into a finite rotation R_p(t) from its reference frame to the present one.
- The plate's crust is stored on a copy of the mesh **in the plate's reference frame**: a membership bitmap and the
  crust fields. Moving a plate changes only its rotation; crust data are never resampled while they ride along, so
  they do not smear over time. The global view at time t is assembled by, for every global cell, rotating its
  position into the frames of the candidate plates (those whose bounding cap contains it; the previous owner and
  its neighbours' owners are tried first) and reading membership.
- New crust (at ridges, from arcs and hotspots) is written into the plate's frame at the corresponding cell;
  consumed crust (subducted) is removed from it; transferred crust (accreted terranes, sutured continents) moves
  from one plate's frame to the other's.
- This is the approach of Cortial et al. (2019), adapted to a nested icosahedral mesh with exact point location.

### 5.5 History and checkpoints

- A checkpoint holds the plate table and rotations, each plate's crust in its frame (quantised: thickness in
  0.1 km, age in 0.1 Myr, elevation in metres), the surface fields that cannot be recomputed exactly from the crust
  (sediment, ice), and the climate summary of the epoch. Compressed with the same LOCO-I/zlib approach as terrain
  files (MMT1), about 0.5 to 1 MB per checkpoint at L7.
- **Any moment between two checkpoints is reconstructed, not interpolated between pictures**: plate positions are
  exact (rotations), crust ages advance, ridges keep accreting at their rates, and the surface is taken from the
  earlier checkpoint's surface carried by the plates, with isostasy recomputed. Re-running exactly from the
  earlier checkpoint is available when full fidelity is wanted (an export of an intermediate moment).
- For the map's time axis the history also yields what the Earth's geological maps already use (D134/D135): an
  elevation raster per checkpoint and the crust's motion between them, so the existing time-scrubbing renderer
  shows simulated planets without new rendering code.

### 5.6 Products and storage

- `MMS1` binary container: a header (engine version, definition hash, mesh level, field list with units and
  quantisation) followed by compressed field planes. Used for checkpoints, present-day fields and rasters.
- Stored as project assets (content-hashed files beside the project), referenced from the map's `sim.results`
  with the definition hash. Missing or stale products are rebuilt from the definition (deterministic).
- Present-day rasters for the map: elevation (Int16 at the chosen final size), land cover colours, river lines
  (as the planet rivers are today), lakes, ice mask, sea level; climate fields at mesh resolution for the studio.

---

## 6. Scientific models and algorithms

For each subsystem: the model chosen, why, its honesty label, and what it leaves out.

### 6.1 Star, orbit and planet physics (physically based)

- **Mass and radius**: if only one is given, the other follows a rocky mass-radius relation (Zeng, Sasselov and
  Jacobsen 2016: roughly R ∝ M^0.27 for Earth-like composition, with core fraction shifting it). Surface gravity
  g = GM/R²; escape velocity; mean density.
- **Stars**: main-sequence relations by spectral class or mass (luminosity roughly ∝ M^3.5 to M^4, effective
  temperature and colour from tables); luminosity grows with stellar age (Gough 1981: L(t) = L₀ / (1 + 0.4(1 −
  t/t₀)) for Sun-like stars), so a planet's early history sees a fainter star. Several stars: insolation summed per
  star with their geometry; circumbinary orbits average the pair's light over the binary period; a distant
  companion adds a small, slowly varying term.
- **Orbit**: Kepler's third law gives the year from the semi-major axis and masses; eccentricity makes insolation
  vary with distance over the year (1/r²) and sets which season falls at perihelion.
- **Insolation and seasons**: daily-mean insolation at every latitude and day from the declination and hour angle
  (Berger 1978), for the planet's tilt and year; polar days and nights emerge. Tidally locked worlds: insolation
  by angle from the substellar point, permanent night side. The equilibrium temperature T_eq = [S(1−A)/(4σ)]^¼
  (or the dayside form for locked worlds) is shown as a first readout.
- **Atmosphere**: column mass p/g, scale height H = RT/(μg), heat capacity of the air column, dry adiabatic lapse
  rate g/c_p (higher gravity: steeper), moist lapse rate from Clausius-Clapeyron. Greenhouse effect as a grey
  atmosphere with an optical depth from the composition (CO₂, H₂O feedback through temperature, CH₄, and pressure
  broadening), T_s ≈ T_e(1 + ¾τ)^¼, calibrated so the Earth preset gives its observed mean (about 288 K).
- **Tidal locking**: the despinning timescale (Gladman et al. 1996) is estimated from distance, masses and rigidity
  so the studio can suggest that a close-in planet around a red dwarf is probably locked.
- **Interior**: radiogenic heat from U, Th and K with their half-lives, scaled by the user's heat production, plus
  secular cooling, gives heat flow over time; with planet size and water it informs the default tectonic regime
  and vigour. Whether larger rocky planets have more or fewer plate tectonics is debated (Valencia, O'Connell and
  Sasselov 2007; O'Neill and Lenardic 2007): the engine offers the regime as a choice with an "auto" default
  explained as such, rather than asserting an answer.

### 6.2 Tectonics (simplified kinematic-geodynamic model; empirical relations where measured)

**Initial state.** A primordial basaltic crust over the whole planet; continental nuclei (cratons) seeded to the
user's continental fraction, growing over time by arc magmatism and accretion (continental growth curves after
Hawkesworth and Kemp 2006). Plates are seeded with a size distribution like Earth's (a few large, many small;
Bird 2003) and grown by a weighted flood fill on the mesh with irregular, noise-guided boundaries. Presets and the
timeline can instead begin from a supercontinent.

**Kinematics.** Each plate rotates about an Euler pole (v = ω × r). Speeds follow driving-force heuristics: plates
with long subducting edges move faster (slab pull dominates; Forsyth and Uyeda 1975), continental plates slower
(keel drag), overall vigour scaled by heat flow and the "tectonic activity" setting. Reorganisations happen at
user events and when collisions lock boundaries (Euler vectors recomputed from the new forces); supercontinent
assembly and break-up follow from these rules and the timeline.

**Boundaries.** Where neighbouring cells belong to different plates, the relative velocity across the boundary is
split into normal (convergence or divergence) and tangential (transform) parts; boundary segments are classified
and given rates. Triple junctions are detected.

**Divergence.** Gaps open between diverging plates and fill with new oceanic crust (thickness about 7 km, age 0)
on both flanks. Ocean depth follows crust age: depth ≈ 2.5 km + 0.35 km·√(age/Myr) for young crust (half-space
cooling; Parsons and Sclater 1977) flattening towards about 5.7 km for old crust (plate model, GDH1; Stein and
Stein 1992). Mid-ocean ridges, the age stripes of the sea floor and the deepening away from ridges emerge.
Continental divergence first stretches the crust (stretching factor β, thinning and subsidence by McKenzie 1978):
rift valleys form; when the crust is thin enough it breaks and a new ocean opens with passive margins that then
subside thermally.

**Convergence.**
- *Oceanic under continental*: the oceanic plate subducts (density by age decides which oceanic plate goes down
  where two meet: the older). A trench forms at the boundary; a volcanic arc forms on the overriding plate where the
  slab reaches about 100 km depth (distance ≈ 100 km / tan(dip), dip from the slab's age and convergence rate);
  arc magmatism adds continental crust and uplifts a cordillera (Andean type) with a rate that grows with
  convergence. Steep, old slabs roll back and can open back-arc basins.
- *Oceanic under oceanic*: island arcs.
- *Continent against continent*: continental crust is too buoyant to subduct; when continents meet after an ocean
  closes, convergence goes into crustal thickening (towards about 60 to 70 km, as under Tibet), building orogens
  and plateaus; convergence slows; the plates eventually suture into one. Thickening is limited by gravity
  (stronger gravity, lower mountains: the maximum relief a crust can hold scales about as 1/g).
- *Terranes*: island arcs, oceanic plateaus and continental fragments reaching a trench are scraped off and
  accreted to the overriding plate (with their history tags), so continents grow at their edges.

**Transform boundaries.** Strike-slip faults; little relief, local pull-apart basins and push-up ridges at bends.

**Hotspots.** Plumes fixed in the mantle frame (or drifting slowly) build volcanoes on whatever plate passes over:
on oceanic crust, chains of islands and seamounts ageing away from the plume, sinking as their crust ages (atolls
and guyots); on continents, volcanic provinces. Large igneous provinces are timeline events that add plateaus and
flood basalts.

**Impacts and early bombardment.** Large impacts are timeline events (a basin with a raised rim and ejecta, the
crater shape already used for barren moons, scaled by energy and gravity); an early bombardment can be switched on
for young planets. Active plates and erosion erase old craters over time, so heavily cratered surfaces survive only
where the lid is stagnant and the climate dry, as on Mars.

**Stagnant-lid and episodic regimes.** Without moving plates, volcanism builds large shield volcanoes and lava
plains on a single lid (Mars, Venus-like); episodic regimes alternate quiet lids with global resurfacing events.

**Elevation from the crust (isostasy).** Airy isostasy gives each column's height from its crust thickness and
density over the mantle (elevation contrast ≈ thickness × (ρ_m − ρ_c)/ρ_m), plus thermal buoyancy (hot young
orogens and ridges stand higher), minus sediment, ice and water loads. Compensation is regional, not per cell: the
load is smoothed by a flexural kernel whose width follows the lithosphere's elastic thickness (Turcotte and
Schubert 2014), giving foreland basins beside mountains and flexural bulges.

**What it leaves out.** No three-dimensional mantle convection: plate motions are kinematic, driven by stated
heuristics rather than solved forces. No explicit slab geometry beyond its dip. Sub-cell structures (individual
faults, folds) are below the simulated resolution.

### 6.3 Landscape evolution (physically based process laws, calibrated constants)

- **Drainage** on the mesh: each cell drains to its steepest-descent neighbour; depressions are handled by priority
  flood (Barnes, Lehman and Mulla 2014) with lakes kept as lakes when the water balance says so (6.6).
- **Fluvial incision**: the stream-power law E = K·Q^m·S^n with discharge Q from precipitation (so wetter climates
  erode faster), solved implicitly in O(n) along the drainage tree (Braun and Willett 2013); stable at the large
  geological steps the history needs. This is what geomorphologists and recent terrain-generation research
  (Cordonnier et al. 2016) use to grow river networks and ranges together with uplift.
- **Hillslopes**: linear diffusion of elevation (soil creep and landslides on average).
- **Sediment**: eroded volume is routed downstream; it deposits where the flow can no longer carry it (lakes, closed
  basins, deltas where rivers reach the sea, continental shelves) with a transport-limited model (ξ-q, Davy and
  Lague 2009) and marine diffusion on shelves. Continental shelves emerge from sediment and sea level history.
- **Glacial erosion**: where ice sheets lie, erosion scaled by ice sliding (from 6.6), carving deeper valleys and
  fjords at the coast.
- **Coasts**: erosion near sea level by wave base (simplified).
- **Isostatic rebound**: eroded and deposited thickness changes the crust, so the land rises as it erodes.
- **What it leaves out.** Individual landslides, karst, aeolian landforms; at mesh resolutions above about 10 km,
  valleys are averaged, so the final map adds artistic detail below the simulated resolution (as today, D141),
  labelled as such.

### 6.4 Climate (reduced-complexity; physically based energy balance, empirical parameters)

- **Energy balance**: a seasonal two-dimensional energy-balance model on the mesh (after North 1975; North, Cahalan
  and Coakley 1981): C·∂T/∂t = S(1 − α) − OLR(T, greenhouse) + ∇·(D∇T) + ocean heat convergence, with heat capacity
  of land, ocean mixed layer and sea ice, albedo from ice, snow, ocean, land cover and clouds (the ice-albedo
  feedback gives ice ages and snowball states), and an outgoing longwave linearised around the grey-atmosphere
  solution. Months are stepped until the seasonal cycle repeats.
- **Heat transport on other planets**: D scales with atmospheric mass and heat capacity and inversely with rotation
  (Williams and Kasting 1997; Kaspi and Showman 2015), so slow rotators have weak temperature contrasts and fast
  rotators strong ones; thick atmospheres even out climates; tidally locked worlds transport heat from day to night
  with an efficiency that depends on pressure (Koll and Abbot 2016).
- **Elevation**: temperature falls with height by the lapse rate of the planet (dry or moist; set by gravity and
  composition).
- **Circulation** (diagnosed, not solved): the width of the Hadley cells from the Held and Hou (1980) scaling with
  rotation rate, radius, gravity and temperature contrast; the number of cells and the latitudes of the surface wind
  belts (trade winds, westerlies, polar easterlies) and of the subtropical highs (dry) and rising zones (wet) follow.
  The intertropical convergence zone follows the thermal equator through the seasons and over continents
  (monsoons emerge from land-sea contrast). Slow rotators get one global cell; tidally locked worlds get flow
  converging at the substellar point.
- **Moisture and precipitation**: evaporation from the sea (Clausius-Clapeyron with temperature and wind) and from
  land (limited by soil water), moisture carried along the winds (upwind semi-Lagrangian advection on the mesh),
  condensing where air rises: convergence zones, fronts in the westerlies, and up mountains. Orographic precipitation
  and rain shadows follow the linear theory of Smith and Barstad (2004) (upslope condensation with delays for
  cloud and fall-out time scales), applied along the wind on the mesh. Dry zones emerge under subsiding air, in
  rain shadows, in continental interiors far from moisture, and beside cold currents.
- **Oceans**: wind-driven circulation from the winds' stress curl, solved per ocean basin as a barotropic vorticity
  problem with western intensification (Stommel 1948; Munk 1950) on the mesh (iterative solver with the nested
  levels as multigrid); warm western boundary currents and cold eastern ones with upwelling; their heat transport
  feeds the energy balance (warm coasts, cold-current deserts and fog coasts). The deep overturning circulation is
  parameterised as extra meridional heat transport scaled by ocean extent.
- **Through history**: the energy balance is solved every few million years at a coarse level with the epoch's
  geography, star brightness and greenhouse, giving ice ages, desert belts shifting with continents, and the
  precipitation that drives erosion.
- **What it leaves out.** No general circulation model: no weather, storms, explicit clouds or atmospheric chemistry.
  Winds are diagnosed by latitude bands and thermal contrasts, not solved. This is the established class of
  reduced climate models for paleoclimate and exoplanet studies, with documented limits; it can later be replaced
  by a dynamical core behind the same interface.

### 6.5 Hydrology (physically based water balance; empirical evapotranspiration)

- **Runoff**: precipitation minus actual evapotranspiration, which follows Budyko's curve in Fu's form (Fu 1981;
  Zhang et al. 2004) from precipitation and potential evapotranspiration (temperature-based, Hargreaves and Samani
  1985), monthly.
- **Lakes and closed basins**: runoff is routed through the hierarchy of depressions with Fill-Spill-Merge (Barnes,
  Callaghan and Wickert 2021): a depression fills until it spills into its neighbour or until evaporation from its
  surface balances its inflow, so lakes, inland seas and closed (endorheic) basins emerge where the climate makes
  them, and their levels are known.
- **Rivers**: discharge accumulated along the drainage tree; networks where discharge passes a threshold scaled to
  the map; Strahler orders; deltas where sediment-laden rivers reach shallow, calm seas; floodplains where the
  gradient is low and discharge high; wetlands where the ground is flat, wet and poorly drained.
- **Guarantees**: every river flows downhill on the filled surface and ends in the sea, a lake or a closed basin;
  water volume is conserved.

### 6.6 Ice and sea level (physically based)

- **Ice sheets**: surface mass balance from snowfall (the share of precipitation falling below freezing) minus melt
  by positive degree days (Braithwaite 1995); ice flows by the shallow-ice approximation with Glen's law (n = 3;
  Hutter 1983; Mahaffy 1976) on a coarse level; the ice load depresses the crust; glaciers carve (6.3).
- **Sea level**: the ocean's water volume is conserved. Sea level is the height at which the oceans hold that volume
  over the present hypsometry (found by bisection over the area-height curve), changing with ice volume (glacial
  low stands), with the volume of the ocean basins (young, hot sea floor is shallower, so fast spreading raises sea
  level: tectono-eustasy) and with the user's water inventory. In Mode B the user sets the present ocean share (or a
  water inventory) and the engine derives the volume; flooding follows logically from the level and the terrain.

### 6.7 Biomes (empirical classification of simulated climate)

- **Earth-like worlds**: Köppen-Geiger classes from monthly temperature and precipitation (rules of Peel, Finlayson
  and McMahon 2007), and biomes from the Whittaker diagram (annual temperature and precipitation), refined by
  elevation (alpine zones), hydrology (wetlands, floodplains), ice (ice sheets) and coasts (through the climate
  itself). Colours seen from space extend the existing satellite palette (D100).
- **Fictional worlds**: custom biome sets defined by rules (ranges of annual and seasonal temperature,
  precipitation and its seasonality, elevation, water availability, substrate, latitude or light), evaluated in
  priority order, each with a name and colours; vegetation palettes for other stars (darker, redder or black
  photosynthesis under red dwarfs, after Kiang et al. 2007) as options.
- **Recalculated** whenever the climate or water changes: a new range shifts biomes by its rain shadow; a colder
  current changes a coast; more tilt changes seasonal classes.

### 6.8 Honesty labels (the model card)

| Subsystem | Label |
| --- | --- |
| Orbit, insolation, seasons, gravity, scale height, lapse rate | Physically based |
| Ocean depth by crust age, isostasy, flexure, stretching and thermal subsidence | Physically based with empirical constants |
| Plate motions and driving forces | Simplified (kinematic with heuristics) |
| Boundary processes (arcs, collisions, accretion, hotspots) | Simplified, informed by observed relations |
| Stream-power erosion, diffusion, sediment transport | Physically motivated process laws with calibrated constants |
| Energy balance, greenhouse | Simplified (reduced climate model), calibrated to Earth |
| Circulation cells, winds | Simplified (scaling laws, diagnosed) |
| Moisture transport, orographic precipitation | Simplified (linear theory along diagnosed winds) |
| Ocean gyres | Simplified (barotropic, wind-driven) |
| Runoff (Budyko), Köppen, Whittaker | Empirical |
| Lakes (Fill-Spill-Merge), rivers, sea level, ice flow | Physically based (water and ice conservation) |
| Detail below the simulated resolution | Artistic |
| Anything the user sets by hand | Override |

---

## 7. Rendering

- **The map**: unchanged renderer. Simulated planets deliver an `ElevationGrid` per moment (2048 to 8192 wide; 4096
  by default for standard quality, about 10 km on Earth-size), a land cover colour texture, river lines, lakes, an
  ice mask and the sea level of the moment. Time scrubbing on the map uses the checkpoint rasters and crust motion,
  exactly as the Earth's geological maps do (D134/D135). Close in, the existing artistic detail adds texture below
  the simulated resolution (labelled).
- **The studio's previews**: fields on the mesh are rasterised in a worker (barycentric interpolation per pixel) to
  equirectangular pictures, coloured by layer, shown on the existing globe (D127) and on a flat map; overlays drawn
  with Canvas 2D: plate boundaries coloured by type, plate motion arrows, wind and current streamlines, rivers,
  isotherms, the provenance overlay.
- **Layers**: relief, plates, boundaries, crust age, crust thickness, temperature (annual and by month),
  precipitation, winds, ocean currents, rivers and lakes, ice, Köppen classes, biomes, erosion and deposition, and
  simulated versus edited.
- **Progressive display**: the latest checkpoint or the coarse result shows at once; finer results replace it as
  they arrive (never a different planet, only a sharper one).

---

## 8. Interface and user experience

### 8.1 Entry points

- "New map" offers **Quick planet** (Mode A, today's generator, with new direct tools) and **Simulated planet**
  (Mode B, the Planet Studio). An existing simulated map has "Open in Planet Studio"; a Mode A planet can be kept as
  it is or used as a starting sketch (its land becomes the target continental layout of a simulation).

### 8.2 The Planet Studio

A workspace over the whole window:

- **Left: steps** — 1 Star and orbit · 2 Planet · 3 Interior and plates · 4 Air and water · 5 History · 6 Life and
  biomes · 7 Simulate and explore · 8 Edit. Each step has a few plain controls, then "More settings" for the rest.
- **Centre: the planet**, turning globe or flat map, with the layer switcher and the timeline under it.
- **Right: what it means** — readouts and short explanations that follow the control being moved, e.g. "More tilt:
  stronger seasons; the poles get summer sun, the tropics a cooler season; ice caps may shrink or wander", and the
  derived values ("Year: 412 days", "Gravity: 1.3 g, mountains lower", "Sunlight: 0.8 × Earth's", "Expected average
  temperature: 4 °C").
- **Bottom: the geological timeline** — lanes of events (supercontinents, rifts, collisions, volcanic periods,
  hotspots, impacts, greenhouse changes, ice ages, sea level), drag to move or stretch them, a scrubber with play,
  and markers for checkpoints. Environmental events (a large igneous province's greenhouse pulse, an impact winter)
  act through the same climate and surface models; biological evolution itself is outside this engine (biomes
  follow conditions; there is no evolution of species).

### 8.3 Controls that mean something

- Every slider changes the calculation; no decorative controls. Each shows its consequence (a short sentence and,
  where possible, a small diagram: the orbit with the habitable zone; the tilt with the seasons; a cut through the
  interior; the circulation cells, redrawn as rotation changes; the plate boundaries' kinds).
- Derived values are shown with their reason and can be overridden ("set by hand" badge, with the derived value
  beside it).
- Presets (scientifically coherent starting points, not looks): Earth-like; Ancient supercontinent; Young volcanic
  world; Highly tectonic; Geologically dead; Frozen; Desert; Ocean world; Tidally locked (red dwarf); High-gravity
  super-Earth; plus Mars-like and Venus-like stagnant lids.
- Before-and-after comparisons (side by side, as in D150's comparison) for any parameter change.

### 8.4 Responsiveness

| User action | Feedback | Time target |
| --- | --- | --- |
| Moving any slider | Derived readouts and diagrams | instant (< 16 ms) |
| Climate, water or life settings | Present climate, water and biomes recomputed at preview level | < 0.5 s |
| Plate or history settings | Tectonic preview over the history at L6, progressive | a few seconds |
| "Simulate" | Full history at L7 and present at the final level, in the background, with progress and the latest state shown | under a minute for standard quality on a 4-core computer (to be measured) |
| An edit after simulation | Local recalculation of consequences | seconds |

### 8.5 Exploring

Scrub the history and watch continents drift, collide and break, mountains rise and wear down, oceans open and
close, island chains grow, ice advance and retreat, deserts and rivers move. Click anywhere for a **"why is this
here?"** card: the crust's age and origin, the boundary or event that made it, the climate in numbers and in words
("in the rain shadow of the Varn range; subtropical high"), the biome's rule, and whether anything was edited.

### 8.6 Editing after simulation

Edits keep the science underneath, with an explanation chosen by the user or proposed by the engine:

| Edit | Explanations offered | What runs |
| --- | --- | --- |
| Add a continent or extend one | a new plate; an old continental fragment; a volcanic plateau (LIP); an island arc accreted to a continent; land exposed by a lower sea; assisted (engine picks the most plausible) | the corresponding tectonic process inserted at a chosen time, re-simulated from the checkpoint before it, or a present-day load and isostasy for "exposed" |
| Mountain range | collision; subduction cordillera; uplift override | crustal thickening at the line, or an override, then erosion, climate, water |
| Volcanic island or chain | hotspot (with a track); arc | volcanism at the place over time |
| Inland sea | rift; subsiding basin; flooded by sea level | stretching, subsidence or sea level |
| Change sea level, ocean depth | water volume; basin volume | sea level and flooding, coasts, climate |
| Rivers | follow the terrain (recompute); fixed course (override) | drainage with constraints |
| Raise or lower ground (sculpt brushes, D98) | override | marked as override; consequences offered |

After every edit a **consequences report** lists what would change (rainfall in the lee, rivers re-routed, biomes
shifted, coasts flooded, currents changed), from a quick estimate, and the user chooses **automatic** (recompute
everything affected), **selective** (pick the systems) or **manual** (keep everything else as it is). The
provenance overlay shows simulated, edited-with-explanation and overridden areas in distinct colours.

### 8.7 Mode A, improved

The classic generator gets direct tools: draw a coastline (the land and sea change, the rest follows), paint
biomes, draw or move rivers, and optionally "explain this map" later. Mode A maps can still use the climate and
biome model of Mode B for their colours, without any geological history.

---

## 9. Performance strategy

### 9.1 Where the time goes (estimates to be verified in the first stage's benchmarks)

| Work | Size | Cost per step (one thread, estimate) | Plan |
| --- | --- | --- | --- |
| Assemble the global surface from plates | L7: 164 k cells × ~2-3 plates tried | 20-40 ms | coherence (try last owner first), bounding caps, workers |
| Boundary processes | boundary cells only (~5-10 %) | 5-10 ms | |
| Isostasy with flexure | L7, separable kernel or multigrid | 5-15 ms | every few steps |
| Stream-power erosion (Braun-Willett) | L7, O(n) | 5-10 ms | |
| Energy balance, seasonal | L6, 12 months × iterations | 50-200 ms | every 5-10 Myr during history; L7/L8 at the present |
| Precipitation and oceans | L6-L7 | 100-300 ms | idem |
| Final products | L8 or raster 4096 × 2048 | 2-10 s | once, in workers |

A standard history (4.5 billion years) with variable steps (coarse early, about 1 to 2 million years over the last
500 million) is about 1 000 to 2 000 steps: one to two minutes on one thread, so the work is split across workers
and the preview runs at L6 (four times less).

### 9.2 Techniques

- **Workers** (section 4.5) for everything heavy; zero-copy transfers; partitions along the mesh's space-filling
  order; deterministic reductions.
- **SharedArrayBuffer** when the page is cross-origin isolated (the local server and Electron can send the COOP and
  COEP headers): workers then share the fields without copying. Planned as an optimisation once profiling shows
  copying matters; transfers work without it.
- **O(n) or O(n log n) algorithms only**: implicit stream power, priority flood, Fill-Spill-Merge, multigrid on the
  nested mesh for the energy balance, ocean vorticity and flexure.
- **Multi-resolution with consistency**: previews and history at coarse levels, the present at fine levels; the
  fine level starts from the coarse result prolonged (never a different random draw), and only processes that need
  detail (drainage, erosion, orographic rain) are refined, so coarse and fine agree where they overlap.
- **Caching and incremental recalculation** by stage hashes (4.4); checkpoints let any edit restart from the
  nearest earlier state; local edits recompute a region with a margin.
- **Memory**: about 20 MB for an L7 state; compressed checkpoints (about 0.5 to 1 MB each); final rasters as
  today. Large intermediate arrays are pooled and reused, not reallocated per step.
- **GPU**: WebGL2 stays for display. WebGPU compute is evaluated (available in Chromium and Electron, not
  guaranteed on every machine or in the headless test browser): the CPU kernels are the reference, and GPU kernels
  can be added later for the energy balance, advection and erosion behind a capability check, with results compared
  against the CPU path in tests.
- **WebAssembly**: not now (no toolchain in the project; typed-array JavaScript is within a small factor for these
  loops). Revisit with profiling.

### 9.3 Resolution plan

| Use | Mesh | Raster |
| --- | --- | --- |
| Interactive preview (sliders) | L5-L6 | 512-1024 wide |
| History | L6 (preview) or L7 (standard, high) | checkpoints at 1024-2048 wide for the map's time axis |
| Present-day final | L8 (standard) or L9 (high) for drainage, erosion, orographic rain | 4096 (standard) or 8192 (high) wide |
| Local edits | the edited region at the final level, with a margin | the region |

---

## 10. Integration with the existing application

- **Map settings**: a new terrain source `sim` beside `earth`, `planet` (Mode A) and `paleo`; `sim` holds the
  definition and references to results (assets with their definition hash and engine version). Changing the
  definition is a command (undoable); results are derived files.
- **`terrainOf(space, t)`**, `coverOf`, rivers and sea level: for `sim` maps they return the products at the moment
  (present or historical), so the renderer, coast clipping, fields spreading over terrain (D103), fronts minding
  the land (D142), smart brushes (D148, which read heights and rivers), close-up detail (D141), exports and SVG
  frames all work unchanged.
- **Time**: the planet's present is a date of the map's calendar (D149); its history lies before, shown as "how
  long ago" as on the Earth's geological maps; political history continues on the present-day geography (or on any
  past geography, as for the Earth today).
- **Radius and units**: the map's radius is the planet's; distances and areas everywhere use it.
- **Mode A**: unchanged storage (`planet`), plus the new direct tools; climate and biomes can optionally use the new
  models.
- **Build**: a second browser entry (the worker) in `scripts/build.mjs`; the server serves it; optional COOP and
  COEP headers.
- **Tests**: new unit tests run in Node at small levels; the interface tests drive the studio at preview quality
  so they stay fast on the Windows runner.

---

## 11. Testing and validation

### 11.1 Unit and property tests (per subsystem, in Node)

- Mesh: cell counts per level; areas sum to 4π; neighbour symmetry; Euler characteristic; point location exact
  against brute force; restriction and prolongation preserve integrals and constants; rasterisation round trips.
- Physics: Earth, Mars and Venus derived values (gravity, year, equilibrium temperature) against known values;
  Kepler; insolation against Berger's tables (annual mean at the equator and poles, polar day and night).
- Tectonics, on synthetic configurations: two plates diverging make a ridge and sea floor whose age grows with
  distance and whose depth follows the age-depth relation; ocean under continent makes a trench and an arc at the
  expected distance; continent against continent thickens crust without subduction; ocean against ocean makes an
  island arc; transform boundaries change no thickness; a hotspot under a moving plate leaves an age-progressive
  chain; total plate area always equals the planet's area; crust created at ridges balances crust consumed at
  trenches (within the change in continental area).
- Isostasy: elevation from thickness and density against the analytical Airy solution; flexure against the
  analytical line-load profile.
- Erosion: at steady state, uplift equals erosion and slope follows the analytical slope-area relation of the
  stream-power law; sediment volume is conserved (eroded = deposited + exported).
- Climate: the Earth preset's global mean temperature (288 ± 2 K) and pole-to-equator contrast; sensitivities have
  the right sign and rough size (more greenhouse warmer; farther colder; more tilt, larger seasonal range at high
  latitudes; slower rotation, smaller contrast; Hadley edge moves poleward as rotation slows, per Held and Hou);
  energy is balanced at the steady seasonal cycle.
- Water: every land cell drains to the sea, a lake or a closed basin; no step uphill on the filled surface; water
  volume conserved through Fill-Spill-Merge; raising sea level floods monotonically (every cell flooded at a lower
  level stays flooded at a higher one); sea level conserves volume.
- Biomes: Köppen classes for reference climate records (tropical rainforest, desert, Mediterranean, tundra ...).
- Determinism: the same definition gives identical bytes with one and with four workers.

### 11.2 Earth-like validation (statistical, honest)

For the Earth-like preset, compare with the real Earth, as distributions not maps: land share; hypsometry (two
peaks, about +0.8 km and −4 km); the share of land above 2 km; the age-depth relation of the sea floor; zonal
mean temperature by latitude; subtropical desert belts near 15 to 35°; rainforest near the equator; boreal forest
and tundra at high latitudes; rain shadows behind ranges; western boundary currents warmer than eastern; river
basin size distribution (Hack's law exponent near 0.5 to 0.6). Results are reported in DEVELOPMENT with the
numbers, including where the model differs.

### 11.3 Interface tests

The studio flow in Chromium at preview quality: a preset, a short simulation, scrubbing the history, layers,
"why is this here?", using the planet for a map (terrain, biomes and rivers on the map), an edit with a
consequences report and a selective recalculation, undo.

### 11.4 Performance benchmarks

`bench/planet.bench.ts`: the steps of 9.1 at each level, a standard full run, and a local edit, with budgets
recorded in DEVELOPMENT.

---

## 12. Staged roadmap (two sessions)

Each stage ends with its tests, the full check, its decision record, a commit and a push.

### Session 1: the engine core and the solid planet

- **14.1 Foundations.** Planet definition (schema, validation, presets) and derived physics; the nested icosahedral
  mesh with operators, transfer between levels and rasterisation; the worker entry, pool and protocol (build entry,
  cancellation, progress); the pipeline skeleton with stage hashes and the MMS1 codec. *Done when*: mesh and physics
  tests pass; a trivial stage runs in workers from the interface and returns a raster; determinism test passes.
- **14.2 Tectonics I: plates and crust.** Plate seeding and growth, Euler kinematics with rotation histories, crust
  in plate frames, assembling the global surface, boundary classification, ridge accretion with age-depth, subduction
  with trenches and arcs, isostatic elevation. *Done when*: the synthetic boundary tests and conservation tests pass
  and a 500-million-year preview history runs.
- **14.3 Tectonics II: continents over time.** Collisions and orogeny with gravity-limited thickening, sutures,
  terrane accretion, rifting by stretching and break-up with thermal subsidence, hotspots and their tracks, large
  igneous provinces, stagnant-lid and episodic regimes, plate reorganisations, the supercontinent cycle, timeline
  events driving them, checkpoints and reconstruction at any moment. *Done when*: collision, rift and hotspot tests
  pass; a supercontinent assembles and breaks up in a test history; reconstruction between checkpoints matches a
  re-run.
- **14.4 Landscape evolution.** Drainage on the mesh, implicit stream-power incision with flexural isostatic
  rebound, hillslope diffusion, sediment routing to deltas, shelves and basins, coupling into the history. *Done
  when*: steady-state slope-area and sediment conservation tests pass; mountains and valleys emerge together.
- **14.5 Planet Studio I.** The workspace with steps 1 to 5 and 7 (star, orbit, planet, interior and plates, air
  and water basics, history timeline, simulate and explore with tectonic and relief layers), presets with
  explanations and diagrams, progressive simulation in workers, scrubbing the history, "use this planet" making a
  `sim` map whose terrain follows the history on the map's time axis. *Done when*: the interface test of the flow
  passes and the map shows the simulated planet through time.

### Session 2: the fluid planet, life and editing

- **14.6 Climate I: radiation and temperature.** Insolation for any orbit and tilt, tidal locking and several stars;
  the seasonal energy-balance model with greenhouse, albedo, heat capacities and transport scaled for the planet;
  lapse rates; the faint young star. *Done when*: the Earth calibration and the sensitivity tests pass.
- **14.7 Climate II: winds, rain and oceans.** Circulation cells and winds, seasonal convergence zones and monsoons,
  evaporation, moisture transport and orographic precipitation, wind-driven gyres and ocean heat transport, cold
  currents. *Done when*: the Earth-like statistics place deserts, rainforests and rain shadows where they belong.
- **14.8 Water and ice.** Runoff, Fill-Spill-Merge lakes and closed basins, rivers by discharge, deltas, floodplains
  and wetlands, ice sheets, sea level from volumes; paleoclimate coupled into erosion through the history. *Done
  when*: the drainage, conservation and flooding tests pass.
- **14.9 Biomes.** Köppen-Geiger and Whittaker classes with alpine, wetland and ice zones, custom biome rules and
  vegetation palettes, the satellite look fed by them, recalculated on any change. *Done when*: the classification
  tests and the Earth-like validation pass.
- **14.10 Planet Studio II and editing.** Climate, water and biome layers and steps 4 to 6 in full, "why is this
  here?", side-by-side comparisons, editing with geological explanations, consequences reports, automatic, selective
  and manual recalculation, the provenance overlay; Mode A's direct tools. *Done when*: the editing interface test
  passes.
- **14.11 Validation and performance.** The Earth-like validation report, benchmarks with budgets, profiling and
  optimisation (shared memory, GPU kernels if they pay), the model card in DEVELOPMENT, the decision records.

**Stage 15: refinements asked for after Stage 14** (19 November 2026: what was missing or weak, and the
inaccuracies the validation found).

- **15.1 Edits gathered, one re-run.** Any number of edits wait in a list; one button re-runs the history with all
  of them, going on from the checkpoint before the earliest. *Done when*: the resumed history equals a full run byte
  for byte.
- **15.2 Estimated consequences and overrides.** Each edit's report gives numbers (heights, areas, rain, sea level)
  estimated before the re-run and measured after it; derived values (the star's light, the year, the mass, the
  regime) can be set by hand.
- **15.3 Climate accuracy.** Mid-latitude rain, the share of dry climates, Europe's warmth, Antarctica's cold and
  the deserts' dry edges against the Earth's measurements.
- **15.4 Lakes, mountains and the deep sea.** Lake volumes, the share of high ground at preview and the depth of
  the ocean floor against the Earth's.
- **15.5 Past moments by biome.** A history's past moments coloured by their own climates' biomes, in the studio
  and on simulated maps.
- **15.6 Climate changes under half a second.**
- **15.7 The quick generator's drawing tools.** Coastlines, biomes and rivers drawn by hand; the generator's
  colours from the climate and biome models.

---

## 13. Risks, limitations and honest boundaries

- **No full geodynamics or general circulation.** Plate motions are kinematic with physically motivated driving;
  the climate is a reduced model with diagnosed winds. These are deliberate, documented choices of the established
  reduced-complexity class, with interfaces that allow better models later. Claims in the interface will say
  "simulated with simplified models", never "accurate".
- **Resolution.** Processes are resolved to tens of kilometres; finer detail is artistic and labelled.
- **Time compression.** Geological processes act in steps of about a million years; events shorter than a step
  (an eruption, a flood) are not resolved by the history (the app's existing fields and disasters cover them).
- **Exotic planets.** Extrapolation beyond Earth-like conditions (very thick atmospheres, extreme rotation, tidal
  locking, super-Earth interiors) carries more uncertainty; where science is unsettled (plate tectonics on
  super-Earths), the user chooses and the studio says so.
- **Performance on slow computers.** Standard quality may take minutes on two cores; previews stay interactive and
  quality can be lowered.
- **Determinism across platforms.** Identical results are guaranteed for the same engine version in the same
  JavaScript engine; across browsers and processors, floating-point differences can change details, so results are
  stored as assets rather than rebuilt on every opening.
- **Scale of work.** This is the largest feature of the application. If a stage proves larger than planned, it is
  split rather than thinned, and this document records what is done and what remains.

## 14. Progress record

| Stage | Status | Notes |
| --- | --- | --- |
| 14.1 Foundations | Done (19 November 2026, D152) | Definition, presets and derived physics; nested icosahedral mesh, operators, transfer, pictures; sunlight; MMS1; stage keys, cache, workers. Operators first-order on the unoptimised mesh (D152) |
| 14.2 Tectonics I | Done (19 November 2026, D153) | Plates with crust in their frames, real-motion ridges and trenches, arcs, boundaries, isostasy, slab-pull motions, welding; a 500 Myr history at L5 in 1.7 s. Old sea floor that never meets a trench survives: subduction initiation and plate splitting in 14.3 |
| 14.3 Tectonics II | Done (19 November 2026, D154) | Volume-keeping collisions and rifts, sutures and accretion, the Wilson cycle and plate splitting, subduction initiation, plumes and their chains, timeline events, checkpoints with exact reconstruction on the 5 Myr grid |
| 14.4 Landscape evolution | Done (19 November 2026, D155) | Priority-Flood drainage, implicit stream power with a threshold slope and local isostatic rebound, creep, conservative sediment to basins, plains, deltas and shelves, coupled every 5 Myr; rain belts by latitude until the climate is coupled (14.8); flexural (regional) rebound left for finer levels |
| 14.5 Planet Studio I | Done (19 November 2026, D156) | The studio's steps, presets, readouts and orbit diagram, simulation in workers, layers through time; `sim` maps whose land and sea follow the history. Session 1 complete |
| 14.6 Climate I | Done (19 November 2026, D157) | Seasonal energy balance on the level-4 mesh: Earth 288.9 K, tropics 28.6 °C, Arctic −17 °C; continental winters too mild and deserts too cool (diffusive transport), for 14.7's winds and oceans |
| 14.7 Climate II | Done (19 November 2026, D158) | Winds from the circulation cells, monsoons by longitude, moisture carried downwind and raised by mountains, gyres' warm and cold currents; deserts, rainforests, the monsoon and rain shadows where they belong on the real Earth |
| 14.8 Water and ice | Done (19 November 2026, D159) | Hargreaves and Budyko runoff; a hierarchy of depressions with steady lakes (closed where evaporation takes all), Fill-Spill-Merge conserving volumes; rivers, floodplains, wetlands, deltas; degree-day and shallow-ice sheets; sea level from the conserved water per picture; past climates every 50 Myr set erosion's rain and the ice on land. The climate revisited: dry continental ground and plateaus, the subtropical highs' flanks, monsoon westerlies, eddy moisture transport |
| 14.9 Biomes | Done (19 November 2026, D160) | Köppen-Geiger by Peel et al.'s rules with summer from each place's sunlight; Whittaker biomes by temperature and the aridity index, refined by water, ice and height; custom biome rules by priority; plant colours under other stars; a cover for the satellite look of simulated maps; the Earth-like validation (desert belts, equatorial forest, boreal and tundra) |
| 14.10 Planet Studio II and editing | Done (19 November 2026, D161) | Eight steps; "why is this here?" cards from the crust, boundaries, circulation, water and biome; edits as geological events at a clicked place with a consequences report; automatic or manual recalculation, selective by the history keeping its climate; the provenance layer; before and after side by side. Not done: re-running from the checkpoint before an edit, estimated consequences, overrides of derived values, Mode A's drawing tools |
| 14.11 Validation and performance | Done (19 November 2026, D162) | `docs/PLANET_VALIDATION.md` (the Earth-like validation, made by `bench/planet.bench.ts --validate`); benchmarks by stage and level with the plan's budgets (met but for climate changes, about 1 s against 0.5); the climate 34 % faster; the model card in DEVELOPMENT; starting sea floor ages scaled with plate speed |
| 15.1 Edits gathered, one re-run | Done (19 November 2026, D163) | A list of waiting edits with what follows from each and one re-run; histories keep packed checkpoints every 50 Myr (4.7 MB at preview) and go on from the last before the earliest change, byte for byte as a full run; an edit 30 Ma in 0.4 s against 3.8 s |
| 15.2 Estimated consequences and overrides | Done (19 November 2026, D164) | Estimates by the history's own rules under each waiting edit; what the re-run made measured around each edit and over the planet; edits made on the crust clicked, followed with its plate (rotations kept with each picture); the star's light and temperature, the year and the mass set by hand. Found: islands narrower than preview cells (for 15.4); histories sensitive to small changes (about one in ten tips into another course), reported |

## References

- Barnes, R., Callaghan, K. L., Wickert, A. D. (2021). Computing water flow through complex landscapes, Part 3:
  Fill-Spill-Merge. Earth Surface Dynamics 9.
- Barnes, R., Lehman, C., Mulla, D. (2014). Priority-flood: an optimal depression-filling and watershed-labeling
  algorithm for digital elevation models. Computers & Geosciences 62.
- Berger, A. (1978). Long-term variations of daily insolation and Quaternary climatic changes. J. Atmos. Sci. 35.
- Bird, P. (2003). An updated digital model of plate boundaries. Geochem. Geophys. Geosyst. 4.
- Braithwaite, R. J. (1995). Positive degree-day factors for ablation on the Greenland ice sheet. J. Glaciol. 41.
- Braun, J., Willett, S. D. (2013). A very efficient O(n), implicit and parallel method to solve the stream power
  equation. Geomorphology 180-181.
- Cordonnier, G., et al. (2016). Large scale terrain generation from tectonic uplift and fluvial erosion. Computer
  Graphics Forum 35(2).
- Cortial, Y., Peytavie, A., Galin, É., Guérin, É. (2019). Procedural tectonic planets. Computer Graphics Forum 38(2).
- Davy, P., Lague, D. (2009). Fluvial erosion/transport equation of landscape evolution models revisited. JGR 114.
- Forsyth, D., Uyeda, S. (1975). On the relative importance of the driving forces of plate motion. Geophys. J. R.
  Astron. Soc. 43.
- Fu, B. P. (1981); Zhang, L., et al. (2004). Budyko-type relations for actual evapotranspiration.
- Gladman, B., et al. (1996). Synchronous locking of tidally evolving satellites. Icarus 122.
- Gough, D. O. (1981). Solar interior structure and luminosity variations. Solar Physics 74.
- Hargreaves, G. H., Samani, Z. A. (1985). Reference crop evapotranspiration from temperature. Applied Engineering in
  Agriculture 1.
- Hawkesworth, C. J., Kemp, A. I. S. (2006). Evolution of the continental crust. Nature 443.
- Heikes, R., Randall, D. A. (1995). Numerical integration of the shallow-water equations on a twisted icosahedral
  grid. Monthly Weather Review 123.
- Held, I. M., Hou, A. Y. (1980). Nonlinear axially symmetric circulations in a nearly inviscid atmosphere.
  J. Atmos. Sci. 37.
- Hutter, K. (1983). Theoretical Glaciology. Mahaffy, M. W. (1976). A three-dimensional numerical model of ice
  sheets. JGR 81.
- Kaspi, Y., Showman, A. P. (2015). Atmospheric dynamics of terrestrial exoplanets over a wide range of orbital and
  atmospheric parameters. ApJ 804.
- Kiang, N. Y., et al. (2007). Spectral signatures of photosynthesis. Astrobiology 7.
- Koll, D. D. B., Abbot, D. S. (2016). Temperature structure and atmospheric circulation of dry tidally locked
  rocky exoplanets. ApJ 825.
- Kopparapu, R. K., et al. (2013). Habitable zones around main-sequence stars: new estimates. ApJ 765.
- McKenzie, D. (1978). Some remarks on the development of sedimentary basins. EPSL 40.
- Munk, W. H. (1950). On the wind-driven ocean circulation. J. Meteorol. 7.
- North, G. R. (1975). Theory of energy-balance climate models. J. Atmos. Sci. 32. North, G. R., Cahalan, R. F.,
  Coakley, J. A. (1981). Energy balance climate models. Rev. Geophys. 19.
- O'Neill, C., Lenardic, A. (2007). Geological consequences of super-sized Earths. GRL 34.
- Parsons, B., Sclater, J. G. (1977). An analysis of the variation of ocean floor bathymetry and heat flow with age.
  JGR 82.
- Peel, M. C., Finlayson, B. L., McMahon, T. A. (2007). Updated world map of the Köppen-Geiger climate
  classification. HESS 11.
- Pierrehumbert, R. T. (2010). Principles of Planetary Climate. Cambridge University Press.
- Smith, R. B., Barstad, I. (2004). A linear theory of orographic precipitation. J. Atmos. Sci. 61.
- Stein, C. A., Stein, S. (1992). A model for the global variation in oceanic depth and heat flow with lithospheric
  age. Nature 359.
- Stommel, H. (1948). The westward intensification of wind-driven ocean currents. Trans. AGU 29.
- Turcotte, D. L., Schubert, G. (2014). Geodynamics, 3rd ed. Cambridge University Press.
- Valencia, D., O'Connell, R. J., Sasselov, D. (2007). Inevitability of plate tectonics on super-Earths. ApJL 670.
- Whittaker, R. H. (1975). Communities and Ecosystems, 2nd ed.
- Williams, D. M., Kasting, J. F. (1997). Habitable planets with high obliquities. Icarus 129.
- Zeng, L., Sasselov, D. D., Jacobsen, S. B. (2016). Mass-radius relation for rocky planets based on PREM. ApJ 819.
