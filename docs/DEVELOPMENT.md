# Map Maker: development record

The running record of where the software stands. Read this first at the start of every development session.
Companion files: [REQUIREMENTS.md](REQUIREMENTS.md) (checklist against the master specification) and
[DECISIONS.md](DECISIONS.md) (architectural decisions and every deviation from the approved architecture).

The approved architecture is the Claude Doc "Map Maker — Technical Architecture & Development Plan"
(https://claude.ai/artifact/2JShAV3AWt6iECtNgBTsJN). All twelve of its decisions were approved on 15 November 2026.

## Status at a glance (20 November 2026, Stages 2, 3, 4, 6, 8 to 14 done; Stage 7 mostly done)

- **Maps of space** (D215–D217): the view in three dimensions always level, the middle button moving it, ⌂ back to the
  start; a star found by name; the solar row's sizes and spacing on sliders with Fit screen; the star looks in three
  kinds (Basic, Charts, Photographic) with new charts and photographic looks, the Sun seen as a star.
- **No system title bar in the desktop app** (D214): Map Maker's top bar is the window's title bar, the window's
  buttons drawn over its right end.
- **Tidy** (D213): `Panels.tsx` broken up into the shared inputs, the bars, the tools, the lists and Properties; the
  windows' names typed; the colours used in several places named in one place in `styles.css`.
- **Present and Export** (D212): the shot's settings in tabs (All, Shot, Camera and timing, Look, Graphics and text,
  Sound, Output); the shots as clips one after another under the preview, chosen and scrubbed there.
- **Events within events on the timeline** (D211): a battle inside its war is drawn within the war's bar, not on a
  lane of its own.
- **A change selected** (D210): one change of an event, chosen from the event's list or its tick in the timeline,
  has its own Properties (animation, length, starting points, border shifts in place); the event's list is short.
- **Timeline menus and drags, settings in place** (D209): right-click menus on the timeline and its track heads;
  events dragged onto another group's track; tracks reordered by dragging their heads; the map's settings windows
  also as folded groups in its Properties.
- **The solar system true to scale and as photographed by default** (D208): the Sun and planets at their true
  sizes, growing as they are closed in on; side by side as a poster (the Sun's edge at the left, the dwarf planets
  below).
- **More from first use, 22 November** (D204 to D207): the split's spurious refusals fixed (a country split
  before is split again; a line a little short reaches the edge); an event can rename a country; the territory
  brush, precise shape and border pen stacked on the tool strip; guides of today's borders and of states and
  provinces in the View menu; a reset-to-default button beside adjustable values.
- **Corrections from first use, 22 November** (D203): a thin top bar, history playing a day a second (down to
  real time), Space applying the drawing prompt, no Alt+wheel turning, the date's year in place, layer rows chosen
  and let go by the whole row.
- **Interface overhaul under way, 22 November** (D196, the plan of eight stages is in that record): stage 1
  done, the frame. Five **workspaces** in a bar under the top bar (Map, History, World, Present, Export:
  arrangements of the same panels; Present and Export are the presentation mode), panels that **resize** by their
  edges and **fold away** (kept per workspace on this computer; Reset), a **status bar** (the tool's hint,
  History Health), and "This map" (the map's setting-up) at the right in the World workspace. Stage 2 done
  (D197): a **menu bar** (File, Edit, View, Map, History, Window, Help) drawn from **one list of commands**
  that the keyboard runs too, with Help › Keyboard shortcuts read from it; the top bar's buttons are in the
  menus. Stage 3 done (D198): the tools are an **icon strip down the left edge** with a key each, their options in a
  **bar of their own** above the map. Stage 4 done (D199): the lists at the left are **tabs** (Maps, Layers, Countries,
  Places, Areas, Events, All), each workspace with its own, and a **filter by name**. Stage 5, first part, done (D200): the
  right panel is **Properties in groups that fold** (remembered per kind of thing), and **a layer is selected**
  by its name and has its options there, no longer in the list. Stage 6 done (D201): **the timeline is
  events first**: a track for each group of events with a head that folds it, events run together into counted
  blocks when zoomed far out, a strip below for changes and branches, and a head with play, the date, Find,
  Snap and zoom; events are dragged to move and retime them. With nothing selected, Properties shows **the map itself**
  and its setting-up, which left the list of maps (D202). **Next: the settings dialogs as groups in Properties
  and a change of an event selected (the rest of stage 5), the timeline's follow-ups listed in D201, then
  stage 7 (Present and Export).**
- **Generated border shifts, 21 November** (D195): for a change drawn in an event (land one country gains),
  "Generate border shifts…" writes the shifts in between as real dated changes, a step every so many days to
  years: the gainer holds more at every step from its own border, the other side retakes land here and there,
  all of it at the end; made again, another version, removed, undone in one step.
- **Relief from the heights alone, 21 November** (D194): nothing is made up below the heights' own detail any
  more (D141 and D146 withdrawn); close in the ground is the smooth surface through the heights with its exact
  slope, drawn as it is; relief fades where one cell of the heights fills the view; a generated planet's land cover
  changes by degrees with its warmth and moisture instead of in flat patches.
- **Galaxies as painted pictures, 21 November** (D193): the Milky Way and galaxies of one's own painted by the program
  (bar, arms, dust lanes, pink star-forming clouds, single stars) instead of a haze of points; a quick draft while
  working, "Bake the galaxy" for full detail kept as one picture on this computer; exports always baked; drawn by the
  graphics card as one plane (in pieces without it), about twice as fast to move as before even with no card.
- **The solar system side by side as chosen, 21 November** (D192): sizes true, compressed, equal or as before; spacing
  even, true or compressed; all, no or chosen moons ("Sizes and moons…" over the row).
- **The planets as photographed, 21 November** (D191): a Photographic look for solar system maps, the Sun, planets
  and Moon wrapped in Solar System Scope's pictures (CC BY 4.0, credited), lit from the Sun, Saturn in its rings.
- **A still events box and even pacing, 21 November** (D190): "Keep its size and place" holds the events box still
  however many events it lists; new shots pace history evenly (the camera still eases).
- **Several countries chosen on the map, 21 November** (D189): Ctrl+click adds or removes one, Shift+drag a box
  round them, Ctrl+Shift+drag over them.
- **Today's cities fixed, 21 November** (D188): cities of the same name (two Portlands) no longer moved onto each
  other when added again, nor a city of one's own taken for today's; "What is shown" offers the cities its rules ask for.
- **"Colour countries by closeness" taken out, 21 November** (D187), as asked: dialog, renderer, legend and data.
- **Looks of countries, VI, 21 November** (D186): one light for the map shared by shadows and bevels; countries as
  raised 3D slabs, as tall as a statistic if wanted ("Population of {country}"); shadows and glows of coasts no longer
  cut away with the sea. The last of the six steps (colour grading left out, as asked).
- **Looks of countries, V, 21 November** (D185): effects' settings that change between two dates of history (eased)
  or pulse and flicker on screen, a light sweep, motion blur in exports (4 to 16 pictures a frame), and looks kept
  under names, given to many countries at once and shared between projects in a file.
- **Looks of countries, IV, 21 November** (D184): a style for a shot's events box, text boxes, date and title (panel
  shapes, gradients, frosted glass, grain, shadows, glows, accent bars; text shadows, gradients, spacing, capitals),
  new ways of coming in and going, lines one after another, and five templates.
- **Looks of countries, III, 21 November** (D183): border styles for a layer (between countries, and against
  nobody): dashes, double lines, casings, ticks, hand-drawn, soft, glowing and marching borders; and special borders
  between two named countries, from either one's panel.
- **Looks of countries, II, 21 November** (D182): inner shadows, outer and inner glows, bevels, gradients, patterns
  (stripes, dots, grids, waves…) and textures (paper, parchment, canvas, metal…) in a country's stack of effects.
- **Looks of countries, I, 21 November** (D181): each country (or a whole layer) has a look: an elevation, a fill
  strength and a stack of effects, as a photo editor's layer styles; drop shadows that fall from higher countries
  onto lower ones, strokes inside, on or outside the edge, and blend modes for the layer. The first of six steps.
- **Five large example projects, V: the Galactic Ages, 20 November** (D180): twelve million years on four maps (the
  Earth, the Solar System, the near stars, the Milky Way), 116 events, eleven shots; the galaxy's settlement worked out
  as a race of colony ships along the arms. Building it fixed space shots losing their camera's point, crowded star
  names and a squared galaxy glow, made giving thousands of stars and adding today's countries to an empty map fast
  (forty seconds to four), and added quintillions to statistics.
- **Five large example projects, IV: Orrun, a world of one's own, 20 November** (D179): a generated planet cut into
  provinces of its own, its own calendar of three ages, 122 events, a branch where the decisive battle is lost, nine
  shots. Building it added provinces for generated planets (borders shared point for point), names that stand on a
  planet's land, a blank map that becomes a planet, fantasy icons, and fixed the example kit's recording into a branch.
- **Five large example projects, III: the End of Empires, 1945 to 1999, 20 November** (D178): the whole world in
  half a century, 244 events, ten shots: every colony to independence with the names countries had then, the wars
  that moved borders, leaders on their journeys. Building it improved how names are placed: an empire is named on its
  piece in view (the British Empire over India), names keep clear of a shot's texts and stay inside the frame, and
  fixed titles are no longer spaced out like a changing date.
- **Five large example projects, II: the Mongol Empire, 1206 to 1405, 20 November** (D177): a continent conquered and
  divided, 117 events, nine shots. Building it found and fixed two faults in how land is given from outlines: land
  carved out of a country by provinces running onto its frontier lost the country's history, and where two
  datasets' outlines run along each other a province could take land far beyond its outline.
- **Five large example projects, I: the Fall of Constantinople, 1453, 20 November** (D176): a medieval city close
  up, 136 events (every day of the siege's cannon fire, the fall hour by hour), ten shots, in the Julian calendar;
  under Examples in the Projects dialog. Building it fixed and added: coasts drawn by the finer heights close in
  (the Golden Horn as water), finer heights and photographs loading after choosing a shot, shapes and missiles
  appearing over spans of their own, trails that can start with the shot, names that keep clear of each other, of the water and
  of other territories, an events box that hides while empty, five-digit years grouped.
- **Two ready-made maps, 20 November** (D175): "New map" makes the Middle East today or Armenia and its neighbours
  as photographed from space at the finest detail, with today's borders, the built-up areas of cities, today's
  cities and capitals (Armenia's provinces too) and a 4K shot of each, ready to export.
- **Countries coloured by closeness, 20 November** (D174): taken out again on 21 November (D187).
- **Today's cities and capitals, 20 November** (D173): 7,289 places from Natural Earth, added under Cities
  ("Add today's cities…") or with today's countries; "What is shown" chooses which a map shows, by share of the
  country's people, size, capitals and economic centres, or only the cities ticked.
- **Steadier dates and keyboard stepping, 20 November** (D172): the date at the top no longer jumps while history
  plays; the calendar's arrows fit inside it; left and right arrows step the date viewed by a day (Ctrl: a week,
  Ctrl+Shift: a month, Ctrl+Shift+Alt: a year).
- **A project from an outline: the "Greater Armenia" example, 20 November** (D171): a future history from the user's
  outline, 2039 to 2178, built by a script through the app's own commands into a finished project (82 events, the
  Week War province by province, salvos of missiles, the exchange, the aftermath, nine shots); in the Projects
  dialog under Examples, "Build and open". For it the software gained statistics that count in shots' texts
  ("{GDP}", "Statistics…" in a map's options), a missile look for lines with salvos flown along great circles, and
  regions given only from the owners named (no slivers at coasts and borders).
- **Stage 15.8, the sea's level through a history, 20 November** (D170): a history now begins from plates already
  moving as they will (they run 200 Myr first; before, its first 200 Myr's seas stood 300 to 750 m below the
  present's while made-up plates settled); plates fuse as well as split (small ones captured by a neighbour for good
  beyond twice the planet's plates; twelve became up to fifty before); collisions keep their crust (orogens widen; 2.5
  km³ a year was thrown away and continents thinned); old sea floor founders at every reconsideration. Over five
  Earth-like planets the sea's level spans 290 to 425 m (650 to 850; the Earth's about 370); the deep sea's peak at 4
  to 4.5 km (3 to 3.5; the Earth's 4 to 5). A history at preview 6.9 s (4.8), at the standard level 31 s (25).
- **Stage 15.7, the quick generator's drawing tools, 20 November** (D169): with the Terrain tool, an outline drawn
  becomes land (rising inland, a shelf round it) or sea (deepening, low shores round it), its coast ragged at the
  brush's size; a river drawn from its source falls all the way to its mouth, cut into the land so the map's water
  follows it, and is shown as a river; biomes painted over the satellite look of generated and simulated planets.
  Each a stroke like the others: in the base world or from a date, undone one at a time, in exports too. A generated
  planet's land can also take its colours from the simulated planets' climate, water and biome models, worked out on
  its own heights.
- **Stage 15.6, climate changes quicker and the climate settled, 20 November** (D168): the energy balance starts from
  the year's balance worked out directly and extrapolates its slow settling, so it ends within 0.2 K of sixty years in
  3 to 7 years whatever the change (it stopped by luck after 4 years on the Earth-like planet, 1 to 3 K off, and ran
  15 to 40 years after most changes); the rain's months are shared among the workers. A change of the air: 0.5 s for
  its climate at the preview level once the workers are warm (1.05 to 1.4 s before); the real Earth's stations as
  before (3.4 K), the simulated Earth-like planet's tropics 1.6 K warmer (nearer the Earth's).
- **Stage 15.5, earlier moments in their own colours, 20 November** (D167): a simulated planet's earlier moments
  show their own biomes on its map (in the satellite look, blended between its pictures, in exports too) and in the
  Planet Studio's biome, temperature, rain and seen-from-space layers: each picture's climate is worked out from the
  climate the history had then, when it is first wanted (0.2 to 0.5 s a picture in a worker); a picture of today
  matches the full climate, water and life stages on 80 to 86 % of the land (no lakes or wetlands at earlier moments).
- **Stage 15.4, the deep sea floor, mountains and lakes, 20 November** (D166): old sea floor founders as on the
  Earth (its mean age 47 to 67 Myr; 118 before), so the deep sea is no longer too deep and more subduction raises more
  ranges (0.35 to 1 % of the surface above 2 km at preview; about 1 % of rock on the Earth); straits narrower than a
  cell join deep basins to the sea (the Black and Red Seas); hollows' outlets are cut as rivers cut them, so river
  basins no longer become huge lakes (the real Earth's fresh lakes 51,800 km³; 294,700 before; 91,000 measured).
- **Stage 15.3, the climate's accuracy, 19 November** (D165): the energy balance carries the sea's heat (and none
  across the Southern Ocean's channel), the winds carry the air's heat along the parallels, each cell's land has its
  own temperature, ice sheets keep their snow, the sea is cloudier than the land; rain recalibrated (evaporation by the
  air's dryness, storms' and the tropics' rates apart, the rain belt drawn by moist coasts and high ground). On the
  real Earth's heights: stations within 3.4 K (5.4 before), Antarctica's plateau as cold as measured, the land's rain
  at 30-55° N 540 mm (275; measured about 550), dry climates 30 % of the land (42; measured 30), runoff as measured.
- **Stage 15.2, edits' consequences in numbers and values set by hand, 19 November** (D164): each waiting edit
  shows estimates from the engine's own rules (a crater's size under the planet's gravity, a hotspot's chain from
  its plate's speed, the land a higher sea floods); after the re-run, what each edit made is measured against the
  history before it; edits are made on the crust clicked, followed back with its plate to when they begin; the
  star's light and temperature, the year and the mass can be set by hand beside the values the physics gives.
- **Stage 15.1, edits gathered and re-run together, 19 November** (D163): in the Planet Studio's Edit step any
  number of edits wait in a list with what follows from each, until one "Re-run the history" works them all out; the
  history goes on from its checkpoint before the earliest edit (an edit 30 Ma in 0.4 s instead of 3.8 s at preview),
  arriving at exactly what a run from the beginning makes.
- **Stage 14.11, validation and performance, 19 November** (D162): the Earth-like validation report
  (`docs/PLANET_VALIDATION.md`), benchmarks of every stage with the plan's budgets, the climate a third faster, and the
  model card below. Stage 14, the planetary evolution engine, is complete.
- **Stage 14.10, Planet Studio II and editing, 19 November** (D161): click a place to learn why it is as it is;
  edits placed as geological events with what follows; the history keeps its climate so air and orbit changes update
  today at once; the edited crust shown apart; before and after side by side.
- **Stage 14.9, biomes, 19 November** (D160): Köppen-Geiger climates and biomes from the simulated climate and
  water, the planet's own biomes, plants coloured after the star's light; simulated maps' satellite look.
- **Stage 14.8, water and ice, 19 November** (D159): runoff, lakes filling to their balance (closed salt lakes where
  evaporation takes all), rivers, floodplains, wetlands and deltas; ice sheets grown in the climate; the sea's level
  in every picture of a history from the ocean's conserved water, with past climates every 50 Myr setting erosion's
  rain and the ice on land; the climate revisited (warm dry continents, plateaus, the subtropical highs' moist flanks,
  monsoon winds, storms carrying vapour poleward).
- **Stage 14.7, the climate II, 19 November** (D158): winds from each planet's own circulation cells, monsoons,
  rain carried by the winds and raised by mountains (rain shadows), the sea's warm and cold currents; on the real
  Earth the deserts, rainforests, monsoon and rain shadows come out where they are.
- **Stage 14.6, the climate I, 19 November** (D157): a seasonal energy-balance model gives every simulated planet
  its temperatures through the year (any orbit, tilt, tidal locking, air and water), calibrated on the real Earth
  (288.9 K, warm tropics, cold poles, wide continental seasons), shown in the Planet Studio.
- **Stage 14.5, the Planet Studio, 19 November** (D156): New map › "A simulated planet" opens a workspace over the
  window: presets, plain sliders step by step (star and orbit, planet, interior and plates, air and water, history
  and its events), what follows from them worked out and explained as they move (with the orbit over the habitable
  zone), the history simulated in workers and explored layer by layer through time; "Use this planet" makes a map
  whose land and sea follow the simulated history on its timeline. Session 1 of the planetary engine is complete.
- **Stage 14.4, landscape evolution, 19 November** (D155): rivers cut into rising land (the stream-power law,
  solved implicitly), hillslopes creep, sediment fills basins, settles on plains and builds deltas and shelves,
  every cubic kilometre accounted for; the crust rebounds as it is worn down. Coupled into the history every 5
  million years: mountains and the valleys in them grow together and wear down slowly.
- **Stage 14.3, continents over time, 19 November** (D154): continents collide and weld along sutures, keeping
  their crust's volume as mountains; continents rift, thin and open new oceans; plates split and new subduction
  zones start, so the sea floor is renewed as on Earth; plumes leave chains of islands (and, on a stagnant lid,
  shields as tall as gravity allows); timeline events gather and break up supercontinents, open rifts, lay flood
  basalts, strike impact basins; any moment of a history is rebuilt exactly from the checkpoint before it.
- **Stage 14.2, plate tectonics, 19 November** (D153): plates carrying their crust in their own frames; ridges
  where plates part (sea floor ageing and deepening away from them), trenches where ocean goes down, arcs above
  the slabs growing continents, collisions thickening crust up to what gravity allows; heights by isostasy; plate
  motions from slab pull and ridge push. A 500-million-year history of an Earth-like planet runs in 1.7 s at the
  preview level, with Earth-like depths and heights; pictures of heights, plates and crust through it.
- **Stage 14.1, the planetary engine's foundations, 19 November** (D152): `src/planet/`, the engine's own layer,
  running in workers, in the interface and in Node. A planet's definition with eleven presets and what follows
  from it (gravity, year, days, sunlight, temperature with a calibrated greenhouse, habitable zone, tidal locking,
  circulation cells, interior heat and regime: Earth, Mars and Venus come out right from their settings); the
  nested icosahedral mesh with its operators, transfer between levels and pictures; sunlight over the year at every
  cell; stages keyed by what they read, cached, run in parts in a pool of workers (the same bytes from any number);
  the MMS1 file format. Nothing new is visible yet: the Planet Studio comes with 14.5.
- **Stage 14 planned, 19 November**: a planetary evolution engine (simulated planets: plates, crust, erosion,
  climate, oceans, water, ice and biomes over geological time, in a Planet Studio). The assessment of what exists
  and the plan, with its models, architecture, interface, performance, validation and stages, are in
  `docs/PLANETARY_ENGINE_PLAN.md`.
- **Stage 13, refinements, 19 November** (D151): History Health › Upkeep tidies a map's unused borders (those no
  change tells apart, left by deleted or drawn-over changes), history unchanged; a shot can have a sound track to
  time it to, heard while it plays (its clock moving the frames), its waveform under the frames, copied beside
  every export. The GPU projection method was not built (measured: not where the time goes); the reference
  renderer is the one the render tests compare with.
- **Stage 13, branches, 19 November**: alternative timelines (D150). A branch splits from the main timeline (or
  another branch) at the date viewed: everything before it is shared, live, and it has its own events after it.
  Switched from the title bar; everything listed follows the timeline viewed; Compare can set another timeline
  beside the one viewed, side by side or across a line; a shot shows the timeline chosen in its settings.
- **Stage 13, calendars, 19 November**: each map can count its time in a calendar of its own (D149): its months
  and leap years, the day its year 1 began, the hours in its day, its week and its eras, started from the Julian,
  the French Republican, a thirteen-month calendar or an invented world's, and changed in every part. On that map
  every date is written, typed, stepped and chosen in it: the timeline, the date fields and their calendar, the
  panels, and the date, events box and SVG frames of its shots. Nothing stored changes; one step undoes it.
- **Stage 12, smart brushes, 19 November**: the geography-aware brush and the strategic brush of the approved plan
  (D148). With "Adjust the lines I draw" on, a line drawn with the brush, the border pen, the Split tool or the
  features tool is shown adjusted beside the stroke: pulled to rivers, coasts and lakes, ridges and valleys, the
  map's borders, today's borders and the lines on its layers, as strongly as each weight says, through any points
  pinned; the strategic brush keeps rivers on your side, follows crests, and pulls towns, your points and mountain
  passes onto your side. Weights move the line live; "Use this line" goes on as the tool always does.
- **Improvement pass, 19 November**: transitions overhauled: fronts travel through the land from the border they
  start at, round bays and across to islands (D136), in looks chosen from a list with a live preview, each part
  adjustable, any event with a look of its own (D137). The satellite look of the Earth is the planet as
  photographed, sharp to the scale of a city: the whole planet bundled, close in downloaded as needed and kept on
  the computer (D138); below the heights' own detail the ground is the smooth surface through the heights, shaded by
  its own slope and nothing else (D194, which withdrew the ground and coasts made up by the graphics card, D141
  and D146). Fronts can mind the land: slower over mountains and water, round a range and up a
  valley (the Overland look, or a slider in any look; D142). The speed readout in Settings also tells the frames
  a second the screen is getting, and the longest wait between two (D143). A fault found by eye and fixed: under
  a long straight border (which bows on the map) a strip of the old owner's colour stayed behind a front (D144);
  and on planets a front's line and glow ran on over the sea (D145). A Windows run then caught a third: a
  dissolve's pace depended on the luck of its pattern, and now it is even (D147).
  Large-scale runs with the new transitions: a frame with a hundred changes under way
  five times faster, only the strip a front has crossed drawn again, two faults of partly drawn frames found and
  fixed (D139, D140); the measurements are under "Performance, 19 November".

- **Stage 9 done** (environment and fields): Conditions, a new kind of layer: radiation, fire, smoke and ash,
  floods, destruction or heat, from sources placed with a click that rise, last and fade by themselves, round or
  carried downwind as plumes, drawn by the graphics card (D102); wildfires, lava and floods spreading over the
  real terrain (D103); disasters placed with one click from templates (D104); heatmaps worked out from points,
  and three thousand strikes drawn at 4K in about half a second (D105).

- **Stage 8 done** (terrain and fictional worlds): Earth's heights and depths ship with the app, the ice of
  Greenland and Antarctica included (D94); maps of the Earth can show terrain, drawn by the graphics card: the land
  coloured by height and the sea by depth, relief shading, the relief of the sea floor and relief over the countries,
  in two palettes, while working and in exports (D95); the sea can stand higher or lower than today's at chosen
  dates, the coasts, the land and territory that ends at the coast following it (D96); new maps can be generated
  planets, from a preset, a seed and a few sliders, with their own coasts (D97); the terrain can be sculpted with
  twelve brushes, in the base world or from a date on (D98); rivers are drawn, Natural Earth's on the Earth and worked
  out from the heights on planets (D99); a satellite look colours the land by its cover, Natural Earth's on the
  Earth and biomes worked out from climate on planets (D100); close in on the Earth, finer heights are downloaded
  as needed and kept on the computer (D101). Stage 8 is done; next, Stage 9.
- **Stages 6 and 7 mostly done**: events can take their own time on screen in presentations, out of sync with the
  clock (D92); an expansion can spread from several starting points at once, for pincers and encirclement (D91);
  each change in an event can have its own length, and recording can chain changes into a moving front (D86).
  Stage 7 (military and movement): a territory layer of occupation or control can be drawn with
  stripes, crossed stripes or dots in each owner's colour, the political map showing through (D88); countries at
  war get a front line with teeth along their shared border while the war lasts (D89); characters can be units of
  a country, in its colour, with a trail or an arrow of advance (D90); an area can be contested between two
  countries, striped in both colours (D93).
- **Fifth feedback round done** (REQUIREMENTS.md, "The user's fifth feedback round"; D80–D87). Done: the brush
  gives land to the country selected; an event's end starts at its start, and dates are chosen on a calendar or
  stepped with the arrow keys (D80); border points only where borders are (D81); flags fit every country, with pieces
  far apart given their own copy and a choice of rule for one's own countries, and today's territories (Greenland
  among them) can be added (D82); territory reaches the detailed coastline (D83); **Show…** in the top bar chooses
  what the map shows while working and in exports, and the smallest lake shown (D84); characters can be shown by
  one of 46 icons (ships, aircraft, land forces, military signs, people and places) or a picture of one's own,
  facing the way they travel (D85); each change in an event can take its own time, and while recording each change
  happens at once, spreads until the next one recorded, until the event ends, or over a set time (D86); countries
  and groups can be locked so their land and borders stay as they are (D87).
- **Animated areas, lines and points** (Stage 6, D79): in an event with a length, a line draws itself (its arrowhead
  travelling), an area grows from its middle, a shape fades in; a new shape fades the old one out.
- **Stage 2 (parcel map and territory editing) done**: the **Regions** tool (D78) picks today's states and provinces
  (4,596, Natural Earth admin-1) or today's countries on the map, by clicks or a box, and gives them to an existing or
  new country, from the date viewed, as a correction or in an event.
- **Stage 3 (time and events) done**: dated border-point moves (D77): a border point dragged can be moved from the
  date viewed on (the sliver between changes hands then) instead of for all time.
- **Split and merge** (Stage 2, D76): the **Split** tool draws a line across a country and gives the part clicked to a
  new or existing country; "Merge into one…" on the menu of chosen countries joins their land into one of them or a
  new country. Both from the date viewed, as a correction, or in an event; one undo step.
- **Event types** (Stage 3, D75): "Event types…" makes, copies, renames, recolours and deletes types; a type gives
  its events a colour on the timeline and in the lists, a usual way for their territory to spread and a usual length.
- **Comparing two dates** (Stage 3, D74): "Compare" in the date bar shows another date to the right of a line
  across the map, dragged sideways; it starts as the day before the last change, "⇄" swaps the dates.

- **Stage 4 (layers, entities and lore) done** (D71–D73). Areas, lines and points (D71): "+ Layer" makes a layer of
  territory, areas, lines or points; the **Areas, lines & points** tool draws claims and zones, front lines (with
  teeth), roads and arrows, battles and other sites, freehand or click by click; each exists from a date (or always,
  or with an event), can take a new shape from a later date and can end; they overlap freely and never change who
  holds the land; they have their own look, list, panel and export pass. **Relationships** (D72): at war, allied,
  part of, vassal of, member of, leads, successor of, travels with; each holds over periods begun and ended at dates
  or by events, shown from either side in the panel of every country, character and city. **Search** in the top bar
  (Ctrl+F): names, former names, notes; a result is chosen and the date and view brought to it. **Export data**:
  the map at a date as GeoJSON (for QGIS and the like) and events, countries, relationships and features as CSV.
  **Pictures** kept with the notes of anything. Project file format 6.

- **Second optimisation stage done** (the user's request to keep optimising the whole workflow and to stress test it
  for massive projects on a slower computer; D55–D70; REQUIREMENTS.md, "The user's second optimisation request").
  Against the build before it, on the same benchmark projects: moving the map 14–34 ms a frame to 5–9 ms (18 ms
  where a thousand names are on screen; 170–240 ms to 5–11 ms in Equal Earth); zooming about half; a brush stroke 72–85 ms to 29–37 ms (188 to 120 ms on
  the 24,500-parcel map); dragging the timeline a year a frame 33 to 13 ms on the heavy project; exported frames of
  the heavy project in half the time (1080p 264 to 127 ms, 4K 545 to 269 ms); opening 2.9–5.9 s to 1.9–3.5 s;
  memory level in long sessions. On a computer made four times slower, a session of 150 random steps on the heavy
  project takes 62 s instead of 113 s: a stroke 344 to 159 ms, moving the map 148 to 56 ms a frame, dragging the
  timeline 150 to 77 ms a frame. How: history, snapshots, borders and names are brought up to date from what was
  there before instead of worked out again (D55, D56, D60); kept pictures have room around the frame, hold the
  repeating map and are shown as one picture while zooming (D62, D63, D70); a picture changes from one frame to the
  next only where land changed hands or a change is under way, in the working view and in exports alike (D58, D68);
  the browser's hidden costs with canvases and paths are avoided (D61, D64); the database writes the snapshot when a
  project opens (D66); Equal Earth and Natural Earth keep their middle meridian while the map is moved (D67). A
  verify mode and a random stress run check all of it (D57). **Six defects found and fixed on the way**: borders
  between countries could vanish after drawing inside a country (D56); moving east or west with the planet's ends
  in view showed a wrong picture (D62); the sharp redraw could fall in the middle of a slow movement and draw
  everything twice (D65); problems in History Health could be listed in a different order after an edit than after
  reopening (D55); memory grew in long sessions on large maps (D59); the estimated size of a 4K export was half too
  high and that of a preview less than half of the truth (D69). Three failures of the Windows run were the tests'
  own (a window's size, a limit missed by a hair, a screenshot the browser could not give at once).

- **Optimisation stage done** (the user's request to optimise everything before adding more detail; D48–D54, and the
  table in REQUIREMENTS.md, "The user's optimisation request"). On the map of today's 242 countries with detailed
  coasts: a frame that changes nothing went from 249 ms to 11 ms, moving the map from 325–3,100 ms to about 20 ms,
  scrubbing time from 224 ms to 8 ms, a brush stroke from 0.7 s to about 40 ms, an exported 1080p frame from 730 ms
  to about 90 ms. How: faces rebuilt only around an edit; history states shared between changes; shapes projected once onto
  "sheets" and drawn by one transform; shapes cut into blocks so only the part being drawn is walked; the picture
  carried along while the view moves; after an edit only the changed area drawn again; panels that follow the view
  only when it pauses; frames encoded by the browser and unchanged frames copied. A **Settings** button (top right) holds the working view's speed options; exports
  never depend on them (D48–D54). Four defects found on the way are fixed: a quick drag of a city or border point could be
  ignored (it counted mouse movements, not distance); a video fill could miss its first exported frame; the map was
  drawn a frame late; a change made in the instant an undo was arriving could spoil the map in memory.

- **Fourth round done** (D45–D47): the events box shows an event again at each of its dated changes; Ctrl+Z/Ctrl+Y with
  the border pen touch the draft only; city and character markers and names scale with the zoom (sizes adjustable);
  names over time for countries, cities and characters. Commercial sale was considered and dropped by the user.

- **Third feedback round done** (REQUIREMENTS.md, "The user's third feedback round"; D41–D44): deleted countries no
  longer leave grey land and borders; "+ Layer" works in the desktop app; Ctrl/Shift to choose several, right-click
  menus, groups of countries that fold away, many events or countries deleted at once (one undo); cities listed under
  their country; labels and city names move apart or the less important is hidden; a border eraser; flat maps (a city,
  a region) at no performance cost. Project file format 4.
- **Also done since the second round:** firm-snapping defects in the kernel fixed (D39); cities (D40); characters'
  routes in shots.

- **The user's second feedback round is done** (fourth session, 17 November; every item with its evidence is in
  REQUIREMENTS.md, "The user's second feedback round"; decisions D31–D38): labels placed where each country has room,
  every large country labelled (one label per country, long names on two or three lines); today's countries can be
  added into a country of your own; **characters** are points that travel between dated places (their own tool, panel and
  export layer); **"Correct this period"** applies from the date drawn without an event; **"Changes over time"** shows a
  country's gains and losses in a day, month, year or several years; shots have a **still camera** with "Reset camera";
  the **advancing front** grows out of the existing border (the old one is now "Expansion"; the wipe is gone); texts and
  the events box are **dragged** on the preview; a graphic can **be** the events box; export chooses only **"All"** at
  first and shows an **estimated size**. Maps of cities are dropped (D38).
- **Checks run in their own checkout.** `checkwt` style: each commit is checked in a separate git worktree, so editing
  can carry on while the interface tests run (a test script edited mid-run once made a check meaningless).

- **The user's first feedback round is done** (third session, 16 November; every item with its evidence is in
  REQUIREMENTS.md, "The user's first feedback round"): zoom-proof brush strokes; 1:10m coasts; "maps", not "worlds";
  today's 242 countries added in one step; label styles for all countries and per country; picture, flag and video
  fills; outlines that cross themselves painted as drawn; the border pen with drafts kept across sessions; the
  'left_face' crash fixed; correction preselected and Enter to apply; right-click deselects; several border changes
  in one event; a current-events box for shots; shot transitions (as recorded, every change, or none; style, timing,
  easing, front line); the shot panel in groups with a chosen export folder, 'Export' and 'All'.
- **Engine redesign (approved by the user) done in three steps** (D26): strokes on the 24,500-parcel benchmark map
  went from 1.75 s to about 0.4 s. Two kernel defects were found along the way and fixed: nearly overlapping borders
  (real data) could recurse without end, and with firm snapping two separated regions could carry one face label
  (now guarded; the face assembly itself should still be examined, see Known bugs).

- **Earth basemap done (second session, 16 November).** Natural Earth land, lakes and coastlines are drawn under the
  territories, with present-day borders as an optional drawing guide; a "Data sources and credits" dialog; exports carry
  the credit lines. Package installs and downloads now work in development sessions, and the code is on GitHub
  (`naregdemirjian/MapMaker`), so D1–D4 can now be reversed.
- **Testing and refinement stage done.** 84 automated tests and two interface tests (24 steps in Chrome) pass. The stage
  found and fixed 11 defects, including two that could damage history or geometry (an outline enclosing no area could
  repaint the whole world; territory commands accepted a layer from another world) and one that made separate export
  passes disagree with the full picture.
- **Performance.** Project files are about 30 times smaller and saves 30 times faster than in 0.1.0; recompiling history
  after an edit is 16 times faster. On very large maps (tens of thousands of parcels) drawing and rendering are still
  slow: see "Performance" below.
- **Roadmap position.** Stages 1 and 3 mostly done; 0 and 2 partly done; parts of 4, 5 and 6 built early. Stages 7–13
  (military, terrain, environment, heatmaps, space maps…) not started. `REQUIREMENTS.md` classifies every requirement.
- **Desktop app and Windows installer (D2 reversed).** Electron shell hosting the same service; NSIS installer built
  and every test run on Windows by GitHub Actions ("Windows build and tests"). The first Windows run found one real
  Windows bug (a damaged file left open, blocking recovery), now fixed; since then everything passes on Windows.
- **Event groups (D8).** Groups made on the timeline; an event can be in several; the timeline and events list show
  the chosen groups. First project-file upgrade (format 1 to 2), with a backup before upgrading.
- **Coastline clipping done.** Territory painted loosely over the sea ends at the coast (per-layer switch), lakes stay
  water, labels stay on land.
- **Biggest open issues.** (1) D1 (Canvas renderer instead of deck.gl) still to reverse; D2 and D4 are reversed.
  (2) Space maps are still to build (D38). The firm-snapping defects are fixed (D39).

## How to run it

On the user's Windows PC: install `Map Maker Setup <version>.exe`, downloaded from the latest "Windows build and tests"
run on GitHub (Actions tab, Artifacts). Or, without installing: install Node.js LTS (22.13 or newer) once, then
double-click `Start Map Maker.bat`; the browser opens on the app. Either way projects are stored in
`Documents\Map Maker Projects\<name>.mapmaker\`.

For development (Linux or Windows, Node 22.18 or newer):

| Command | What it does |
| --- | --- |
| `node scripts/build.mjs` | Builds `dist/server.mjs` (the data service), `dist/desktop/main.mjs` (the desktop app) and `dist/ui/` (the interface) |
| `npx electron .` (Linux without a screen: `xvfb-run -a npx electron --no-sandbox .`) | Runs the desktop app (build first) |
| `npm run dist:win` | Builds the Windows installer into `release/` (on Windows; on Linux it needs Wine) |
| `xvfb-run -a node --disable-warning=ExperimentalWarning e2e/desktop.e2e.ts` | The 5-step desktop app test (build first) |
| `node --disable-warning=ExperimentalWarning dist/server.mjs --port 4317 --projects <folder> [--open]` | Runs the app |
| `sh scripts/check-all.sh` | Every check: type check, unit tests, build, the four interface tests |
| `npm test` | 235 unit, randomised and scenario tests |
| `node --disable-warning=ExperimentalWarning e2e/render-compare.e2e.ts` | The renderer against the old one kept in `e2e/reference/` (35 scenes); carried, patched and animated pictures against fresh ones (build first; `VERBOSE=1` lists every case) |
| `node --disable-warning=ExperimentalWarning bench/make-fixtures.ts <folder> [massive]` | Makes the benchmark projects: "Bench Earth 242", "Bench Heavy", "Bench Random 1000" (minutes); with `massive`, one with 3,000 border changes as well. The benchmarks and tools below work on throwaway copies of them |
| `node --disable-warning=ExperimentalWarning bench/render.bench.ts <folder> ["<project>"...] [--only a,b] [--label x] [--out file]` | Frame times in Chrome for each scenario (idle, pans at five zooms, zoom, scrub, stroke, play, exports); build first |
| `node --disable-warning=ExperimentalWarning bench/edit.bench.ts <folder>` | Kernel and engine times for edits, without a browser |
| `node --disable-warning=ExperimentalWarning bench/import.bench.ts [maps] [km]` | Importing borders (D120): today's 242 countries, then maps of later years with the same borders drawn again up to `km` apart and countries joined; times, parcels and who holds a few capitals |
| `node --disable-warning=ExperimentalWarning bench/profile.ts <folder> "<project>" <scenario> out.cpuprofile`, then `node bench/top.mjs out.cpuprofile` | Where the script's time goes in one scenario (idle, select, panWorld, panRegion, panDeep, zoomIn, zoomOut, scrub, scrubSmall, stroke, play, playMoving) |
| the same with an output name ending in `.trace.json`, then `node bench/trace.mjs out.trace.json 25` | What the browser does around the script (painting canvases, layers, presenting), per thread: what a script profile does not show (D61) |
| `node --disable-warning=ExperimentalWarning bench/open.ts <folder> "<project>" out.cpuprofile` | How long opening a project takes, and a profile of it |
| `node --disable-warning=ExperimentalWarning bench/stress.ts <folder> "<project>" [--steps 400] [--seed 1] [--throttle 4] [--scale 2] [--preset fastest\|best] [--no-verify]` | A long random session in the real interface with every result checked against one worked out afresh and the map compared with a fresh drawing (D57); `--throttle` makes the computer that many times slower, `--scale` the screen that many times denser. Reports frame times, time per kind of action and memory |
| `MAPMAKER_E2E_VIEWPORT=1500x900 node ... e2e/vertical-slice.e2e.ts` (or `workflows`) | The interface tests in a window of another size (no step may depend on where things fall on screen) |
| `node --disable-warning=ExperimentalWarning test/geo-kernel.stress.ts <seeds> <rings>` | Long randomised kernel run |
| `node --disable-warning=ExperimentalWarning e2e/vertical-slice.e2e.ts` | The 23-step interface test in Chrome (build first); screenshots in `e2e/output/` |
| `node --disable-warning=ExperimentalWarning e2e/workflows.e2e.ts` | The workflow and export-inspection test; screenshots in `e2e/output/workflows/` |
| `node --disable-warning=ExperimentalWarning test/perf.bench.ts 100 300 1000 [--keep <folder>]` | Performance benchmark (minutes at 1000) |
| `node node_modules/typescript/bin/tsc -p tsconfig.json` | Type check (must report nothing) |

Run `npm install` once per fresh checkout. (Offline sessions without package installs could use
`scripts/link-local-packages.sh` to link preinstalled packages; no longer needed.)

Map data: `data/natural-earth/ne-110m.json` and `ne-50m.json` are committed, so nothing is downloaded at run time.
`node scripts/fetch-natural-earth.mjs` re-downloads Natural Earth and regenerates them and `data/datasets.json`.
The Earth through geological time (D134): `data/paleo/paleodem-1deg.bin` is made from the PALEOMAP PaleoDEMs'
one-degree NetCDF files (https://doi.org/10.5281/zenodo.5460860) by `python3 scripts/paleodem-extract.py <folder>
<cells.i16>` (needs h5py and numpy), the crust's motion between them (D135) by `python3 scripts/paleo-motion.py
<rotation file> <plate polygons> <cells.i16>.json <motion.i8>` (needs pygplates; the PALEOMAP plate model v19o_r1c from
https://doi.org/10.5281/zenodo.7994000), and then `node scripts/pack-paleodem.ts <cells.i16> data/paleo/paleodem-1deg.bin <motion.i8>`.

TypeScript runs directly under Node's type stripping: imports carry `.ts` extensions, type-only imports use
`import type`, and enums or constructor parameter properties are not allowed.

Terminology: the interface calls them **maps** (DECISIONS D24); the code and older notes say map space or world.

## Code map

| Folder | Role | Key facts |
| --- | --- | --- |
| `src/core-time/` | Instants and calendars | An instant is (whole days since 1970, milliseconds in the day): exact to the millisecond across ±24 trillion years. Proleptic Gregorian calendar with astronomical years (year 0 = 1 BCE); calendars of one's own from a definition (`custom-calendar.ts`, D149). |
| `src/geo-kernel/` | The parcel map on a sphere | One planar subdivision per world: fixed-point vertices (1e-7 degree), exact orientation predicates, snapping and noding, parcel lineage (a split parcel becomes the parent of its pieces, which inherit its history), point location, validated vertex moves. Poles and the 180° line need no special cases. |
| `src/world-model/` | Tables and the in-memory world | Every row type, the diff format (`before`/`after` per row) used for saving and undo, and transactions. |
| `src/temporal-engine/` | Reconstructs history | Compiles events into per-parcel timelines; answers "who holds this place at time t" exactly, including mid-transition; detects simultaneous, overlapping, stale and broken changes. Caches are rebuilt from the tables and never saved. |
| `src/domain/commands.ts` | Every user action | Each command returns its row diffs, which become one undo step. |
| `src/desktop/` | Desktop app | Electron main process: hosts the data service in-process and opens the interface in its own window. |
| `src/server/` | Local data service | SQLite project file (WAL, full sync, integrity check on open), journal for undo and redo, versions, rolling backups, export writer, HTTP bound to this computer only. |
| `src/render-engine/` | Drawing the map | Camera and projections (d3-geo), the map renderer (fills, borders, labels, transitions), the Earth basemap (`basemap.ts`: decoding, choice of detail), stroke processing for the freehand brush. |
| `src/render-engine/plane.ts` | Sheets (D49) | The projections' own formulas; rings with ranked points; a `Sheet` holds shapes projected once for a window around the view and places them on any view inside it by one transform. |
| `src/render-engine/parcel-geometry.ts` | Parcel outlines | Each boundary cycle as longitude/latitude with point importance shared between neighbours; `dissolve` joins an owner's parcels into one outline. |
| `src/render-engine/blocks.ts` | Blocks (D50) | `BlockPath`: shapes held in a tree of square blocks, so drawing part of the view only walks the points there. No path is closed with `closePath` (D64). |
| `src/render-engine/country-look.ts`, `textures.ts`, `border-look.ts`, `presentation/graphic-style.ts`, `ui/components/LookEditor.tsx`, `BorderEditor.tsx`, `GraphicStyleEditor.tsx` | Looks of countries, borders and a shot's graphics (D181 to D186) | A country's or layer's look: elevation, fill strength, blend mode and a stack of effects, each kind described once (`EFFECTS`: name, settings, defaults), checked and merged; changes through history and pulses on screen (`effectAt`), kept looks (`lookPresetsOf`); the map's light (`litBy`) and slabs' heights (`slabHeight`); motion blur of exports in `presentation/motion-blur.ts`; pattern and texture tiles; drawn by `map-renderer.ts` (`castShadow`, `insideEffect`, `innerShadow`, `strokeCountry`); edited in the country's panel and under the layer. |
| `src/render-engine/map-renderer.ts` | The frame | `render` draws a frame; `layered` keeps the base map and the territories as pictures: kept, patched after an edit (D54), renewed where a change animates (D58), moved with the view with room around the frame (`slide`, D62), shown at another size while zooming (`zoomTogether`, D63). `verify` works snapshots out both ways (D57). |
| `src/render-engine/smart-brush.ts`, `follow-land.ts`, `follow-targets.ts`, `ui/smart-input.ts`, `ui/smart-settings.ts`, `ui/components/SmartBrush.tsx` | Smart brushes (D148) | The corridor, its cost map and the cheapest path through pins; the exact course along line features; the lines near a stroke (rivers, coasts, today's borders, the map's own borders and layer lines at the date), the heights, towns and points gathered for it; the settings, the adjust panel. |
| `src/ui/guides.ts`, `shell/Reset.tsx` | Guides and reset buttons (D206, D207) | `drawStateGuides` (states and provinces over the working map, simplified by zoom, culled to the view); `ResetButton`, `RangeReset` (back to the default). |
| `src/ui/tools.ts`, `shell/ToolIcon.tsx` | The tools (D198) | `TOOLS` (name, hint, key, group), `toolsFor` (the tools a map has), `toolForKey`; the icons. The strip and the options bar themselves are `ToolStrip` and `ToolOptions` in `shell/Tools.tsx`. |
| `src/ui/commands.ts`, `shell/MenuBar.tsx`, `shell/shortcuts.ts` | Commands and the menu bar (D197) | `COMMANDS` (id, name, shortcut, enabled, checked, run), `MENUS` (which command in which menu), `menuItems`, `commandForKey`; the menu bar and the list of shortcuts drawn from them; `matches` (a key press against a written shortcut). A new command is one entry in `COMMANDS` and its id in a menu. |
| `src/ui/timeline-layout.ts` | The timeline's tracks (D201) | `layoutTrack` (a track's events in lanes: named, bare, or run together into blocks), `layoutTracks` (tracks one under another, folded ones as marks), `barAt`, `snap`. Pure; drawn and driven by `components/Timeline.tsx` (head, track heads, canvas, dragging). |
| `src/ui/inputs.tsx` | Inputs shared by every panel (D213) | `fmt` (a date as the map viewed writes it), `DateField` (typed, chosen on a calendar, stepped with the arrow keys; steady while history plays), `yearSizer`, `NumberField` (saved on Enter or leaving it; a button back to its default). |
| `src/ui/shell/Bars.tsx`, `shell/Tools.tsx` | The bars and the tools (D213, from `Panels.tsx`) | `TopBar` (menu bar, project name), `MapChooser`, `DateBar` (the date viewed with its steps and comparing), `Toasts`; `ToolStrip`, `ToolOptions` and the options of each tool (pen, sculpting, biomes). |
| `src/ui/panels/Lists.tsx`, `panels/Properties.tsx` | The lists and Properties (D213, from `Panels.tsx`) | `Outliner` (the tabbed lists at the left, their filter, rows kept fast with thousands); `Inspector` (Properties: `MapPanel` with nothing selected, `EntityPanel`, `EventPanel`, `LayerPanel`, `PointPanel`, the change's `ChangePanel`, the star's `StarPanel`), `QuickStart`. |
| `src/ui/components/ChangePanel.tsx` | A change selected (D210) | `ChangePanel`: one change of an event in Properties (Change, Animation, Border shifts groups); `describeEffect`, `setChangeAnimation`, `changesOf`, `changeTime`, `changesAt` (the timeline's strip of changes clicked). |
| `src/ui/shell/Group.tsx` | Properties' groups (D200) | `PropGroup`: a group that folds, remembered by `prop:<id>` in `store.collapsed`. The panels using it (`EntityPanel`, `EventPanel`, `LayerPanel`) are in `panels/Properties.tsx`. |
| `src/ui/shell/layout.ts`, `Shell.tsx` | The interface's frame (D196) | Workspaces (which there are, which work on shots), each one's layout (panel sizes, panels folded away; cleaned when read, kept in `mapmaker.layouts`), the workspace bar (with search, undo, redo and the folding buttons), the edges panels are resized by, the status bar. `store.workspaceNow()`, `setWorkspace`, `setLayout`, `togglePanel`. Also the lists' tabs (D199): `LIST_TABS`, each workspace's tab (`store.listTabs`, `listTabNow`, `setListTab`), `nameMatches` for the filter (`store.listFilter`). |
| `src/domain/border-shifts.ts`, `ui/components/BorderShifts.tsx` (and `commands.ts` generateBorderShifts, removeBorderShifts, borderShiftsOf, generatedShifts) | Generated border shifts (D195) | The land the gainer holds at each step of a change's shifts (its front field moved by chance that changes step by step; more land at every step; specks removed); the command that cuts each step's border into the parcels and writes the steps as dated changes, following the change's pieces by where they lie; the dialog on a change in the event's panel. |
| `src/render-engine/front-field.ts`, `front-source.ts`, `front-terrain.ts`, `ui/components/TransitionLook.tsx` | Transitions (D136, D137, D142) | A change's field of arrival times through its land and where its front starts; the land reached and the front's own lines at a moment. Looks (`presentation/sequence.ts` TRANSITION_LOOKS) drawn by `map-renderer.ts` (softEdge, drawWake, the front line); the Look list, live preview and Adjust controls of the shot editor. |
| `src/terrain/photo.ts`, `photo-cache.ts`, `scripts/fetch-earth-photo.mjs` | The Earth as photographed (D138) | Which picture tiles a view needs and where their picture lies; the bundled picture of the whole planet, tiles fetched through the data service (`http.ts` photoTile) and laid into a region's picture; drawn by `terrain-gl.ts` (u_world, u_photo). |
| `src/render-engine/kept.ts` | Caches by weight (D59) | A cache limited by how much its entries hold, not by how many there are. |
| `src/temporal-engine/engine.ts` | History, kept up to date (D55) | `follow` applies the changes made since the last question instead of compiling everything; states of all parcels are derived from the state before; `Engine.verify` compares with a fresh compile. |
| `src/ui/view-settings.ts`, `components/Settings.tsx` | Working-view settings (D53) | Presets and single options, kept in the browser, applied by `store.setViewSettings` and `MapView`; never read by exports. |
| `bench/` | Measuring | Benchmark projects, frame-time and edit benchmarks, script profiles and browser traces, opening, and the stress run (see the commands above). |
| `data/` | Shipped map data | Natural Earth basemap files and `datasets.json` (source, version, licence, credit of every dataset); copied to `dist/ui/data/` by the build. |
| `ui/components/Presentation.tsx` | Present and Export workspaces (D212) | `ShotsPanel` (the list of shots), `ShotEditor` (the shot's settings in groups; tabs `SHOT_TABS` in Present, the export groups alone in Export), `ShotTimeline` (transport, frame slider, `ShotClips`: every shot as a clip, chosen and scrubbed there; the sound's waveform). |
| `src/presentation/` | Shots and export | Shot settings (time remap, camera keys, overlays) and the export driver that renders frames off screen at the exact output size. |
| `src/export/` | Files on disk | PNG encoder, export folders, `manifest.json`, `COMPOSITING_GUIDE.txt`. |
| `src/ui/` | The interface | React. `store.ts` holds the session state and saves every command; components for the map, timeline, panels, dialogs and presentation mode. |
| `src/examples/`, `server/http.ts` (examples) | Example projects (D171, D176 to D180) | Each built by a script through the commands into the projects folder when chosen in the Projects dialog; `kit.ts` the builder and its helpers (events, changes, features, characters, statistics, shots, branches); `provinces.ts` provinces for a generated planet; `settle.ts` a galaxy's settlement as a race of colony ships; `greater-armenia*.ts`, `constantinople.ts`, `mongols.ts`, `empires.ts`, `fantasy.ts`, `galactic.ts` the projects. |
| `src/presentation/statistics.ts`, `ui/components/StatisticsDialog.tsx` | Statistics (D171) | Numbers kept with a map over time, filled into shots' texts as "{name}" by `overlaysAt`. |
| `src/domain/geojson-import.ts`, `ui/components/ImportBorders.tsx` | Importing borders (D120) | GeoJSON maps read into countries by a name property (colours too), years from file names; `commands.ts` importTerritories puts a map's countries on a layer at its date, one undo step a file. |
| `src/ui/components/Timeline.tsx` | The timeline | Dates, events and the playhead; `useHistoryPlayer` plays history in the working view (D119): years a second, looping, Space. |
| `src/domain/countries.ts` | Today's countries | Decoding `countries-50m.json`; colour groups. The command is `addCountries` in commands.ts. |
| `src/export/svg-pen.ts` | The SVG pen (D115) | Drawn on as a 2D canvas is, writes SVG: paths, styles, gradients, patterns, clips, text where the canvas puts it, pictures; `withSvgPaths` lets the map's own drawing code run into it. |
| `src/presentation/svg-frame.ts` | SVG frames (D115) | One frame of a shot as an SVG file: pictures of the sea, land and conditions from the renderer; territories and borders from the parcels' outlines, masked at the coast by `MapRenderer.svgMasks`; features, cities, names, characters, stars and texts through the pen. |
| `src/export/mp4-mux.ts`, `webm-mux.ts`, `video-codecs.ts`; `presentation/video-encoder.ts` | Videos (D121) | The MP4 and WebM writers (frames in, bytes out at their places), codec levels and bit rates; the browser's encoder (WebCodecs) and the upload of the file as it is made. `export-driver.ts` exportVideo draws the frames; `writer.ts` writeVideoBytes fills the file. |
| `src/export/tiff.ts` | TIFF files (D109) | 8-bit RGBA with straight alpha in strips, uncompressed or Deflate; encoded in the browser during exports (`export-driver.ts` runExport), written by `writer.ts` writeEncodedTiff. |
| `src/space/` | Space maps (D110–D114, D116–D118, D191 to D193) | `galaxy-picture.ts` the painter of a galaxy's picture from its model (D193: bulge, bar, arms, dust, glowing gas, clouds, stars; in bands, the same bytes anywhere); `galaxy-pictures.ts` the pictures made and kept: the rough one, the draft, the bake in workers with its progress, kept in IndexedDB, what a picture depends on; `galaxy-gl.ts` the picture laid on the galactic plane by the graphics card; `ui/galaxy-workers.ts` the pool the rows are painted in (the task `galaxyRows` of `planet/worker/tasks.ts`); `planet-photos.ts` the Sun, planets and Moon as photographed (D191, pictures in `data/solar-textures`); `solar.ts` `SolarRow` the side-by-side row as chosen (D192); `catalogue.ts` the nearby stars (`data/stars/nearby-50ly.json`, made by `scripts/fetch-stars.mjs` from HYG v4.1), their colours and kinds; `space-view.ts` the camera circling a point; `space-renderer.ts` the drawing (far stars, rings, stars, drop lines, realms, lanes, names); `realms.ts` who holds which star and which lanes are open at a moment; `solar.ts` the planets' orbits and where they are on a date, and their large moons; `invented.ts` invented stars from a seed; `galaxy.ts` the Milky Way and galaxies of one's own: arms, places, star systems and their glow (D116); `exoplanets.ts` the known planets of the nearby stars (`data/stars/exoplanets-50ly.json`, made by `scripts/fetch-exoplanets.mjs`, D118); `scene.ts` what a space map shows at a moment. Shown by `ui/components/SpaceView.tsx`, a star's panel `Stars.tsx`; held stars are changes of kind `system` (`commands.ts` holdStars, compiled by the engine's `systemsAt`). |
| `src/presentation/looks.ts` | Looks for shots (D108) | The presets and their colours, the grade, darker edges and paper laid over a finished frame (`finishLook`), and what the renderer is given (`export-driver.ts` lookStyles). |
| `src/presentation/events-box.ts` | Current events box | Which events show at a frame (with fades) and how the box is drawn. |
| `src/render-engine/label-style.ts`, `assets.ts` | Looks | Label styles (general, per country); pictures and videos (loaded once; exports preload pictures and seek videos per frame on their own elements). |
| `src/server/assets.ts` | Project files | Uploaded pictures and videos in the project's `assets` folder, named by content, served with byte ranges. Border drafts are `drafts.json` in the project folder. |
| `data/flags/` | Flags | 237 SVG flags (flag-icons, MIT): 197 nations and 40 territories, and `index.json`. |
| `src/render-engine/label-place.ts` | Label places | Where a country's label has the most room (stretched pole of inaccessibility in the projection's plane), line breaking for long names (D31). |
| `src/domain/history-view.ts` | Changes over time | Periods (day, month, year, several years) and a country's gains, losses and changes in one (D36); shown by `ui/components/CountryHistory.tsx`. |
| `src/domain/search.ts`, `data-export.ts`, `ui/components/Search.tsx`, `Pictures.tsx` | Search, data export, pictures (D73) | Search over names, former names and notes; the map at a date as GeoJSON and the record as CSV (written by the data service's `data-export` route); pictures with notes (`commands.ts` setPictures). |
| `src/domain/regions.ts`, `ui/components/Regions.tsx`, `scripts/fetch-regions.mjs` | Region picker (D78) | Regions of today by level, found by a point or a box; the Regions tool's bar and its "Give" question; the converter of Natural Earth's states and provinces. |
| `ui/components/SplitMerge.tsx` (and `commands.ts` splitTerritory, mergeTerritory) | Split and merge (D76) | The Split tool's question, the "Merge into one" dialog, and the choice of when a change holds that both use. |
| `src/world-model/world-settings.ts` (`show`, `shown`, `minLakeKm2`), `ui/components/ShowDialog.tsx` | What is shown (D84) | Each map's list of what it shows while working and in exports and its smallest lake; the "What is shown" dialog. Lakes are judged whole in `basemap.ts` (`lakeSizes`). |
| `commands.ts` (isLocked, setLocked, withoutLocked) | Locked countries (D87) | A lock in the country's style; territory edits leave out what locked countries hold at the edit's moment and refuse to change them otherwise; the store names what was left out. |
| `ui/record-length.ts`, `ui/components/RecordLength.tsx` (and `commands.ts` setEffectLength, chainRecorded) | How long changes take (D86) | The recording bar's choice (kept on this computer) and the transition it gives; the length of each change in an event's panel. The engine's `transitionEnd` gives a change's end. |
| `src/render-engine/icons.ts`, `ui/components/CharacterIcons.tsx` | Character icons (D85) | The icon set (shapes on a 64 by 64 grid, how each turns), drawing an icon; a character's icon setting (`CharacterIcon` in its style) and its section of the panel. Drawn by `MapRenderer.drawCharacterIcon`, facing `CharacterAt.ahead`. |
| `ui/components/DatePicker.tsx`, `src/core-time/steps.ts` | Dates (D80) | The calendar of a date field; stepping a date by days, months and years. |
| `src/geo-kernel/arrangement.ts` mergeUnreferenced, `ui/audio-track.ts` | Upkeep and sound (D151) | Parcels made whole where nothing tells their pieces apart; a shot's sound track played in step with the frames, its waveform. |
| `src/temporal-engine/branches.ts`, `ui/components/Branches.tsx`, `ui/components/CompareBar.tsx`, `ui/events-here.ts` | Branches (D150) | What a branch includes of each timeline above it (the cuts), which timeline an edit at a date belongs to, the tree of branches. The engine compiles one timeline (`new Engine(world, branch)`, the store keeping one per timeline looked at: `engineFor`); commands put new events and changes where their date belongs. The title-bar switcher and the Branches dialog; the comparison bar; the events of the timeline viewed. |
| `src/core-time/custom-calendar.ts`, `ui/calendar-now.ts`, `ui/components/CalendarDialog.tsx` | A map's calendar (D149) | Calendars from a definition (months, leap rule, epoch, day length, week, eras) and their templates; the calendar of the map being viewed, used by every date written, typed and chosen; the dialog that makes one. |
| `src/render-engine/fill-clusters.ts` | Pictures over countries in pieces (D82) | Which pieces share a copy of a picture; how a picture is fitted. |
| `src/domain/event-types.ts`, `ui/components/EventTypes.tsx` | Event types (D75) | A type's colour, usual way of spreading and usual length, kept in the `fields` of its row; the "Event types" dialog, the type chooser and its colour square. |
| `src/domain/relations.ts`, `ui/components/Relations.tsx` | Relationships (D72) | Kinds and how each reads from either side; periods are changes of kind `relate` (`commands.ts` relate, endRelation, resumeRelation), compiled by the engine (`relationHolds`, `relationPeriods`). |
| `src/render-engine/globe-gl.ts` | The globe (D127) | The flat picture of the part in view laid onto a lit sphere by a fragment shader (mipmaps, anisotropic filtering, the air's glow); `globeInView` finds the longitudes and latitudes a globe shows. `MapRenderer.renderGlobe` draws the flat picture with a renderer of its own and the names upright over the sphere. |
| `src/render-engine/routes.ts` | Routes (D106) | A line as a campaign arrow (smoothed, tapered body, head at its end) and marks flowing along a line; drawn by `MapRenderer.drawFeatureShape` and `drawFlow` with the shot's clock. |
| `src/render-engine/feature-style.ts` | Features (D71) | Areas, lines and points: their looks (kind defaults, layer, own). Shapes are changes of kind `shape` (`commands.ts` createFeature, reshapeFeature, endFeature), compiled by the engine (`featuresAt`, `featureHistory`), drawn in the `features` pass (`MapRenderer.drawFeatures`, `featureAt` for the pointer). |
| Characters | Points over time | Placements are effects of kind `place` (`commands.ts` placeCharacter, characterLeaves); the engine compiles them into tracks (`charactersAt`, `characterTrack`); drawn in the `characters` pass; panel in `ui/components/Characters.tsx` (D35). |
| `src/planet/` | The planetary engine (D152) | No DOM: runs in workers, the interface and Node. `model/` the definition, presets and derived physics; `mesh/` the nested icosahedral mesh, its operators, transfer between levels and pictures; `climate/insolation.ts` sunlight, `climate/ebm.ts` the seasonal energy balance (D157), `climate/hydroclimate.ts` winds, rain and currents (D158), `climate/paleo.ts` a moment's climate in a history (D159), `climate/currents.ts` the sea's currents and the heat they carry (D165); `water/` runoff, lakes and rivers (`hydrology.ts`), ice sheets (`ice.ts`), the sea's level from its volume (`sealevel.ts`) (D159); `life/biomes.ts` Köppen-Geiger, biomes, plants under other stars (D160); `explain.ts` why a place is as it is (D161); `consequences.ts` edits' consequences estimated and measured, `reconstruct.ts` crust followed with its plate (D164); `tectonics/` plates and their crust (`plates.ts`, `state.ts`), a step (`step.ts`), heights (`isostasy.ts`), the history and checkpoints (`history.ts`, D153), packed checkpoints to go on from after edits (`resume.ts`, D163), motions, splits and the Wilson cycle (`reorganise.ts`), timeline events (`events.ts`, D154), erosion on the crust (`erode.ts`, D155); `surface/` drainage and the landscape step (D155); `state/` the MMS1 format, content keys, the fields; `pipeline/` stages keyed by what they read and the scheduler with its cache; `worker/` the pool, protocol and the worker's entry (built to `dist/ui/planet-worker.js`). `ui/planet-engine.ts` is the interface's pipeline and a simulated planet's terrain through its history; `ui/components/PlanetStudio.tsx` and `ui/planet-colors.ts` the Planet Studio (D156). The plan: `docs/PLANETARY_ENGINE_PLAN.md`. |
| `test/`, `e2e/` | Tests | See "Tests" below. |

How an edit flows: a command changes the in-memory world and returns diffs → the interface redraws at once → the diffs
are sent to the data service, which checks them against the stored rows and writes them in one transaction (or refuses
if the project changed underneath) → the journal entry is the undo step.

## Roadmap position

The approved roadmap has 14 stages (0–13). Where each stands (brought up to date 18 November 2026):

| Stage | Status | Done | Still to do |
| --- | --- | --- | --- |
| 0 Groundwork | Mostly done | Sphere-safe kernel, two-part time, SQLite storage, transparent PNG export, pannable/zoomable/rotatable map, Natural Earth basemap, Electron shell, Windows installer built automatically, reference-image render tests (`e2e/render-compare`) | Installer test on the user's PC |
| 1 Project, storage, world model | Done | Projects, schema with upgrades (format 7; every upgrade tested), undo journal, autosave, versions, backups with restore, crash safety, multiple maps, entities with names, colours, notes; event groups (D8); groups of countries; outliner and inspector | Automatic groups (by world, by country) if wanted |
| 2 Parcel map and territory editing | Done | Production kernel (faces rebuilt around an edit), territory brush, precise shape tool, border pen with drafts, border points (move, add, remove), border eraser, split along a line and merge (D76), region picker of today's countries and states (D78), snapping, smoothing, irregularity, political fills, derived borders, labels, coastline clipping, today's countries in one step, flat maps | Sub-national boundaries as permanent parcel edges if wanted (the region picker puts them in where used, D78) |
| 3 Time and event engine | Done | Instants, Gregorian calendar and calendars of one's own (D149), events, effects with intention, compiler followed change by change, any-date reconstruction, zoomable timeline, edit prompt, record mode, History Health, precedence and overlap rules, alternative versions, names over time, changes over time, comparing two dates, event types as templates, dated border-point moves (D77) | |
| 4 Layers, entities, lore | Done | Territory layers; area, line and point layers with lifespans and dated shapes, their tool, list and panel (D71); dated relationships (D72); search, GeoJSON and CSV export, notes with pictures (D73); cities with lifespans, characters, alternative versions of events | Layer families across maps |
| 5 First shots and export | Mostly done | Shots, time remap, still camera, date, title and current-events overlays, PNG sequences with passes and transparency up to 8K at every listed frame rate, preview, manifest, compositing guide, deterministic output | Multi-key camera, styles, version-pinned shots, the Premiere checklist on the user's PC |
| 6 Transitions | Done | Advancing front, expansion and fade; borders and labels follow the animation; shot-level transition settings; animated areas, lines and points (D79); lengths of each change (D86); expansions from several starting points, for pincers and encirclement (D91); events taking their own time on screen, out of sync with the clock (D92). Keyframed fronts: a front placed at dates is recorded as changes that each spread "until the next one" as an advancing front (D86). Fronts as fields of arrival times through the land (D136), in looks (D137), slowed by mountains and water where a look says so (D142) | Rivers, roads and passes for fronts that mind the land |
| 7 Military and movement | Mostly done | Occupied territory drawn with stripes, crossed stripes or dots over the political map (D88); front lines between countries at war (D89); units of a country with trails or arrows of advance (D90); contested areas in both claimants' stripes (D93); characters with icons that face the way they travel (D85) | Bases and supply lines as their own kinds, if wanted (units that stay put and lines with arrows cover them today) |
| 8 Terrain and fictional worlds | Done | Earth's elevation with the sea floor and the ice sheets (D94); terrain colours and relief drawn by the graphics card, over the countries too, in the working view and exports (D95); sea level over time, with coasts, land and territory following it (D96); generated planets (D97); sculpting with twelve brushes, in the base world or dated (D98); rivers on the Earth and on planets (D99); the satellite look, with Earth's land cover and planets' biomes (D100); finer heights close in, downloaded as needed (D101) | Land cover finer than 10 km; terrain-aware drawing (Stage 12) |
| 9 Environment and fields | Done | Conditions: field layers of radiation, fire, smoke, floods, destruction and heat, their sources rising, lasting and fading, circles and plumes, drawn by the graphics card (D102); fires, lava and floods spreading over the terrain (D103); disasters from templates in one click (D104); heatmaps from points, three thousand strikes at 4K (D105) | Raster and numerical layers from files; arrival-time fronts slowed by terrain |
| 10 Presentation polish | Done | Routes: campaign arrows and lines that flow (D106); text boxes and callouts (D107); looks for shots (D108); TIFF sequences (D109); SVG frames (D115) | Camera paths dropped (the camera stays still, D34) |
| 11 Space maps | Done | The 982 stars within 50 light-years in three dimensions, with their names, kinds and systems (D110); stars held by countries and factions over time, drawn as realms (D111); lanes between stars, expeditions and fleets (D112); the solar system on any date (D113); invented star maps, stars found by search (D114); the Milky Way and galaxies of one's own (D116); the large moons on the solar system map (D117); planets of other stars (D118) | Asteroids and comets; planets of stars too faint for the star catalogues |
| Improvement pass | In progress | History played in the working view (D119); borders imported from GeoJSON maps of their years, following the borders already there (D120), or from a dataset dating each shape (D123); videos, MP4 and WebM (D121); a shot of the whole history in one click (D122); layers' opacity and border width; each layer as its own export pass (D124); names placed quickly while a shot plays (D125); borders while fronts move and where two changes meet (D126); a globe that turns, for shots (D127); a change over before its land changes hands again (D128); a date that stays still as it changes (D129); how the stars look (D130); star maps as flat charts (D131); realms across the stars as territories with fronts (D132); the solar system side by side (D133); the Earth through geological time (D134), its continents sliding between its maps (D135); fronts that follow the land (D136), and looks for them: soft, glowing, ragged, in patches, an event's own (D137); the Earth as photographed, sharp to city scale (D138); fronts at scale, a hundred changes under way at once (D139); only the strip a front has crossed drawn again, and two faults of partial redraws fixed (D140); fine ground close in, made up below the heights' own detail (D141) | Faster shot playback through many changes |
| 12 Smart brushes | Done | The geography-aware brush and the strategic brush, with feature weights and live preview, in the brush, the border pen, the Split tool and the features tool (D148) | Forest edges, roads and railways from data |
| 14 Planetary evolution engine | Done | The technical assessment and plan: `docs/PLANETARY_ENGINE_PLAN.md` (19 November 2026); 14.1 foundations (D152); 14.2 plate tectonics (D153); 14.3 continents over time (D154); 14.4 landscape evolution (D155); 14.5 the Planet Studio (D156); 14.6 the climate I (D157); 14.7 the climate II (D158); 14.8 water and ice (D159); 14.9 biomes (D160); 14.10 Studio II and editing (D161); 14.11 validation and performance (D162) | Done |
| 15 Planetary engine refinements | In progress | 15.1 edits gathered and re-run together, from the checkpoint before the earliest (D163); 15.2 consequences in numbers, edits on the crust clicked, values set by hand (D164); 15.3 the climate's accuracy (D165); 15.4 the deep sea floor, mountains and lakes (D166); 15.5 earlier moments by their own biomes (D167); 15.6 climate changes quicker, the climate settled (D168); 15.7 the quick generator's drawing tools and colours from the climate models (D169); 15.8 the sea's level through a history within the Earth's range (D170) | The standard level's excess new sea floor; old floor in welded groups |
| 13 Branches, calendars and refinement | Done | Each map in a calendar of its own (D149); branches, alternative timelines, compared side by side, in shots (D150); tidying unused borders, a shot's sound track (D151) | Sound mixed into exported videos; projection on the graphics card (D151) |

## Tests

All pass as of 20 November 2026 (526 unit and randomised tests in 104 files, 26 + 71 + 14 + 8 interface steps). The
interface tests run with the verify mode on (D57): everything the app works out from what was there before is also
worked out afresh, and any difference stops the test.
`sh scripts/check-all.sh` runs everything and prints ALL CHECKS PASSED only when every check passed.

| Suite | Count | What it proves |
| --- | --- | --- |
| `test/planet-physics.test.ts` | 6 | The planetary engine's definitions and physics (D152): every preset valid and what it says; Earth, Mars and Venus from their settings (gravity, years, days, sunlight, albedo, temperatures); Kepler, the Moon's and Mars's masses from their sizes, the Sun and red dwarfs, the faint young Sun, the habitable zone, early heat, tidal locking; each setting moving the results the right way; overrides and notes; stored definitions read back |
| `test/planet-mesh.test.ts` | 5 | The icosahedral mesh (D152): cells, faces, Euler's formula, areas summing to 4π, neighbours mutual and counter-clockwise, levels nesting; point location against brute force; the Laplacian and gradient against spherical harmonics level by level; conservative transport and diffusion; prolongation and restriction; pictures of fields and their round trip |
| `test/planet-insolation.test.ts` | 3 | Sunlight (D152): Earth's against Berger's values, solstices and polar night; perihelion and the equinox; global means for five presets; a tidally locked planet's dark side; more tilt, sunnier poles |
| `test/shortcuts.test.ts` | 1 | A key press matched with a shortcut as menus write it (D197): Ctrl or Command, Shift only where written, Alt, named keys, signs |
| `test/timeline-layout.test.ts` | 5 | The timeline's tracks (D201): lanes with names and no overlaps; names dropped, then events run together into counted blocks; tracks one under another with folded ones as marks, bars found by place; snapping to the nearest value within reach; an event inside a longer one of its track drawn within it, found by a click, counted in a block (D211) |
| `test/layout.test.ts` | 4 | Workspaces' layouts (D196): stored layouts made valid; an edge dragged resizes its panel within limits; a folded panel takes no room; shots belong to Present and Export; the lists' tabs made valid when read, a filter matching every word in any order (D199) |
| `test/border-shifts.test.ts` | 3 | Generated border shifts (D195): the steps (more land at every step from the gainer's border; land given back only with push-back; the same number the same shifts; the steps' dates; at most 60); in history (a step a month as real changes, more every month, land retaken, nobody else's touched, all at the end, the change at the end date and the event lasting until then, followed change by change, undone in one step); made again, without push-back, by weeks and days, removed, and refused (an end not after the change, too many steps, a generated step, land to nobody, a locked country) |
| `test/terrain-look.test.ts`, `test/biomes.test.ts` (D194) | 2, 1 | Relief from the heights alone: the smooth ground between cells (a cell's own height at its centre, a plane exactly, no crease from cell to cell, closer to the land than straight lines, no rim at a cliff, round the 180th meridian); relief as drawn (the ground's own slopes close in, more from afar, fading from 32 to 160 pixels a cell; the made-up ground's option gone); the colour of a climate (each biome's own inside it, half way at a border, no step anywhere) |
| `test/region-maps.test.ts` | 2 | Ready-made maps (D175): the Middle East and Armenia's, their countries where they are, their cities, urban areas, provinces, satellite look and 4K shot |
| `test/galaxy-picture.test.ts` | 5 | Galaxies as pictures (D193): the Milky Way painted (white-hot middle, yellow round it, bluer arms, dark beyond the disc); the same picture every time, in any bands, from the workers' task, small and large; galaxies of one's own by seed and shape, with a bar or none; what a picture depends on (shape, not star systems or baking; painted-only arms place no systems; nothing begun where nothing can be drawn); the map's baked setting kept, undone, refused on other maps |
| `test/planet-photos.test.ts` | 3 | The planets as photographed (D191): a picture wrapped on a sphere (middle, west, north, clear outside, turned); rings from their strip; picture sizes a fifth apart; every picture shipped with its licence and credited; the look kept |
| `test/places.test.ts` | 4 | Today's cities (D173): capitals, shares, ranks and world cities from the data; which cities each filter keeps; added as cities that remember them, the map's filter stored; cities of the same name told apart by region or by where they stand (D188) |
| `test/arrow-step.test.ts` | 1 | The arrow keys' steps of the date viewed (D172): a day, a week, a month, a year; Cmd as Ctrl |
| `test/statistics.test.ts` | 3 | Statistics (D171): values between dates by a steady share, amount or at once; written as money, people, numbers and shares (up to quintillions and sextillions, D180), and read back from words; a map's statistics filling "{name}" in a shot's texts as history goes |
| `test/missiles.test.ts` | 3 | Missile salvos (D171): flights along great circles over one event, in flight half way, gone on arrival; strikes where they land and none where one was shot down; each missile arriving at its own moment and a point fading in over its own span (D176) |
| `test/look-light.test.ts` | 3 | The map's light and slabs (D186): effects set to the map's light take its angle and the others keep theirs (stored ones keep their own); a slab as tall as a statistic's share of the highest of its kind, each country its own, flat without one; the light kept with the map and undone |
| `test/look-motion.test.ts` | 6 | Looks that move (D185): a setting between two dates (linear, smooth, two in a row), pulses and flickers kept in range, changes as stored checked, the light sweep's crossing and pause, motion blur's moments and its average with transparency, kept looks replaced by name, given to two countries in one undo step, read from files |
| `test/graphic-style.test.ts` | 3 | The look of a shot's graphics (D184): styles checked and kept in range, every template whole; lines coming in one after another; every way of coming in and going in place when done and away when not begun; text boxes keeping the new ways |
| `test/border-look.test.ts` | 4 | Border styles (D183): checked and kept in range; a layer's pairs of two different countries kept once either way round; dash patterns growing with the line; plain styles changing nothing; marching borders found; kept and undone in one step, special borders only between countries that exist |
| `test/country-look.test.ts` | 6 | Looks of countries (D181, D182): effects checked and kept in range, unknown ones dropped, every kind's defaults kept as they are; a country's own look over its layer's, plain looks changing nothing; shadows cast away from the light, outer glows cast as shadows; looks of countries and layers kept and undone in one step; textures greys about the middle, the same every time |
| `test/example-galactic.test.ts` | 1 | The Galactic Ages example (D180): four maps (the Earth, the Solar System, the near stars, the Milky Way); no conflicts; over a hundred events; planets, stars and systems held by the realms the story gives them (Mars, Rhea, Alpha Centauri, Vega, Sirius, the Orion Nebula, Sagittarius A*, Betelgeuse, the Large Magellanic Cloud); how much of the galaxy is held and by how many; lanes open and closed at the Severing; wars of the Core and of the Tide; the Earth's countries, the Charter and the sea in the rift; statistics in quintillions; shots on every map |
| `test/settle.test.ts` | 4 | A galaxy's settlement as a race (D180): the heap's order; arrivals after the wait and the voyage; the first to arrive keeps a system; systems not allowed, taken, or reached after the end left alone; on the Milky Way the same every time, each system settled from one of its own lineage |
| `test/example-orrun.test.ts` | 1 | The Orrun example (D179): one map, a generated planet with the Reckoning of Orrun (its eras); no conflicts in either timeline; over a hundred events; realms where the story puts them in the main history and in the branch where the Ashfields are lost; the neck sunk from 600; nine shots, one of the branch; statistics |
| `test/provinces.test.ts` | 1 | Provinces of a generated planet (D179): the same every time; every piece of border walked once each way by the two provinces beside it; land points each in one province (only the smallest islands in none); smoothed, hardly a right-angled corner left |
| `test/example-empires.test.ts` | 1 | The End of Empires example (D178): no conflicts, over two hundred events; some seventy places checked at their dates across Asia, the Middle East, Africa, Europe and the Americas (colonies under their empires and then their own states with the names of the time; Korea at the 38th parallel and at the armistice line; Goa, Aden, the Golan, Sinai, Gaza, Crimea, the Saar, Zanzibar, West New Guinea, the Sahara and its wall, Biafra, Katanga, the Ogaden, Kuwait, the Falklands, Hong Kong and Macau); ten shots; statistics (UN members, new states) |
| `test/example-mongols.test.ts` | 1 | The Mongol example (D177): no conflicts, over a hundred events; Samarkand Khwarazm's, the Mongols', Chagatai's at the split (nothing spilled to another khanate), Timur's; Kiev, Hungary occupied and given up, Baghdad, Syria before and after Ain Jalut and under Ghazan, the Song, the Yuan, the Ming; nine shots; statistics |
| `test/example-constantinople.test.ts` | 1 | The Constantinople example (D176): no conflicts, over a hundred events, the Julian calendar; the city held until dawn on 29 May, taken quarter by quarter, the Cretans' towers last; Galata, Selymbria, the Morea and Trebizond when the sources say; the chain; shots in flight a few hours each; ten shots; statistics |
| `test/example-greater-armenia.test.ts` | 1 | The Greater Armenia example (D171) built into a projects folder: no conflicts; Turkey and Azerbaijan gone without a sliver; the empire of 2175, the governments gone after the exchange, the fragments and the faction after; nine shots, statistics, the salvos |
| `test/planet-consequences.test.ts` | 3 | Edits' consequences (D164): estimates by the history's own rules (a crater under two gravities, a flood basalt's volume, a hotspot's chain from its plate's speed, a higher sea's flooding); a re-run measured around each edit and over the planet (an ice age colder while it lasted); crust followed back with its plate and a crater made there landing where it was clicked |
| `test/planet-resume.test.ts` | 2 | A history going on from a checkpoint (D163): edits added late, taken away, starting on a checkpoint, an ice age changing past climates: the same bytes as a run from the beginning (the pictures' rotations and climates too), faster; another setting changed starts again |
| `test/planet-past.test.ts` | 4 | Earlier moments' own climate and life (D167): a picture of today against the full climate, water and life stages (the same biome on most land besides lakes and wetlands, temperatures and rain close); an ice age colder with more ice and tundra in its pictures; an earlier picture's land seen from space with the planet's own biomes; a map's cover blended between pictures, the nearer standing in |
| `test/planet-explain.test.ts` | 3 | Why is this here, and edits (D161): a placed hotspot's crust marked as edited and explained; the circulation named; the history keeping its climate |
| `test/planet-biomes.test.ts` | 3 | Biomes (D160): Köppen-Geiger for fifteen reference stations; biomes by warmth and dryness, refined; the planet's own; plants under other stars; the Earth-like validation |
| `test/planet-water.test.ts` | 6 | Water on the land (D159): Fill-Spill-Merge conserving water through filling, spilling, merging and overflowing; steady lakes, closed and open; every drop drains downhill to the sea, a closed lake or a basin; sea level exact, flooding monotonic; the real Earth's water budget; a deep basin behind a low sill joins the sea, a shallow one stays land, a hollow's outlet cut (D166) |
| `test/planet-ice.test.ts` | 4 | Ice and the sea's level (D159): degree days and the year's balance; a dome against Vialov's profile, ice conserved; snow outlasting the summer on Greenland and East Antarctica, not on Siberia or Canada; a history's sea level and an ice age |
| `test/planet-hydroclimate.test.ts` | 3 | Winds, rain and currents (D158): on the real Earth deserts dry, rainforests wet, the monsoon, rain shadows, dry subtropics, cold and warm currents; a ridge across the westerlies, the belts' winds, a tidally locked planet, no rain without water; the sea's heat summing to zero, Europe milder than eastern Canada, Antarctica's plateau cold, dry climates and mid-latitude rain near the Earth's (D165) |
| `test/planet-climate.test.ts` | 4 | The climate (D157): the real Earth's mean, balance, zones, seasons and ice; each setting moving it the right way; a tidally locked planet, Venus, a frozen world; settled (D168): a doubled carbon dioxide, a tidally locked world and a hothouse within 0.2 K of sixty years in a few |
| `test/planet-sim-map.test.ts` | 1 | Maps of simulated planets (D156): the planet's radius, its definition kept, geological time; changed and undone; refusals with reasons |
| `test/planet-landscape.test.ts` | 4 | Landscape evolution (D155): drainage reaching the sea, never uphill on the filled surface; the exact steady state of the stream-power law (slope ∝ area^-½); rock removed equal to sediment laid down, creep conserving, pits filling, rain and the threshold; a history with erosion (high ground lower, Earth-like rates, sediment beside the land) |
| `test/planet-continents.test.ts` | 7 | Continents over time (D154): colliding continents thicken to gravity's limit, keep their volume and weld; a continent rifts, thins and opens an ocean; a plume's chain ages away from it at the plate's speed; a Mars-like shield; flood basalts, impact basins, volcanic periods; a supercontinent gathered and broken up by events; any moment rebuilt from a checkpoint exactly |
| `test/planet-tectonics.test.ts` | 8 | Plate tectonics (D153): the relations (age-depth, Airy, gravity's limit, sea level, quaternions); two plates parting make a ridge (rate, both sides, age with distance, depth with age); ocean under a continent makes a trench and an arc, the continent kept; old ocean under young makes an island arc; a transform makes nothing; continents colliding keep their crust and sediment, the orogen widening (D170); small plates captured for good beyond twice the planet's plates, never broken off, an episodic planet's rhythm at negative times (D170); a 500-million-year Earth-like history (every cell held, crust balanced, continents kept, Earth-like heights, young sea floor at its first moment, the sea's level within 450 m, the same bytes); a stagnant lid; the stage and its layers |
| `test/planet-pipeline.test.ts` | 6 | The engine's machinery (D152): SHA-256 against Node's, canonical keys; MMS1 files of every type, quantised, damaged; stage keys following what each stage reads; the cache; real worker threads: one and four workers and this thread giving the same bytes, progress, errors, cancelling; the climate's months shared among one, three or seven workers, the same bytes (D168); a generated planet's own heights given to the climate, water and life stages, no history made (D169) |
| `test/core-time.test.ts` | 8 | Known Gregorian dates; calendar round trips across trillions of years; exact arithmetic; parsing and formatting |
| `test/custom-calendar.test.ts` | 7 | Calendars of one's own (D149): the Julian, French Republican and thirteen-month calendars against known dates; one made like the Gregorian agreeing with it over trillions of years; eras, years before them, a day of 30 hours, a six-day week; definitions refused with reasons; a map given a calendar and undone |
| `test/tidy.test.ts` | 2 | Tidying unused borders (D151): history the same in the main timeline and a branch at a grid of places and dates, parcels referred to by a branch or an inactive version kept, undo, random histories followed against a fresh compile |
| `test/branches.test.ts` | 5 | Branches (D150): what each timeline holds before and after its split, early history fixed once for both, edits put where their date belongs, recordings refused with the reason, the moment of the split, branches of branches, alternative versions, deleting and undoing, saving, and random edits followed change by change against a fresh compile |
| `test/smart-brush.test.ts` | 7 | Smart brushes (D148) on synthetic terrains with known best paths: a river followed, a meander by weight, a crest and a valley, pins, a lake shore all round, far banks, towns and passes onto your side, fast enough for live sliders |
| `test/follow-land.test.ts` | 4 | The exact course taken along line features: a river's stretch within the tolerance, its bends, out and back along it, a shore that is a loop all the way round, the nearer of two lines |
| `test/geo-kernel.test.ts` | 13 | Predicates; parcels across the poles and the 180° line; nested islands; snapping; randomised point location against d3; rollback; vertex edits never break validity; a parcel's area summed on plain numbers against the earlier formula and d3 |
| `test/geo-kernel.stress.ts` | CLI | 12 seeds × 50 random rings with full validation after each (0 refusals) |
| `test/temporal-engine.test.ts` | 18 | Editing events never changes earlier history; compiled timelines equal a naive replay; simultaneous and overlapping events; stale intentions; broken references; corrections; variants; undo; when the last change began (comparing dates) |
| `test/event-types.test.ts` | 3 | Event types made, copied, renamed, recoloured, given a way of spreading and a usual length (days, months to the end of a shorter month, years, before the year 1); deleted (their events become plain events), undone, reloaded |
| `test/fill-clusters.test.ts` | 4 | Pictures over countries in several pieces (D82): boxes and gaps across the 180th meridian; today's France (6 copies), Spain (2), Russia (1, placed by its mainland), the USA (3), archipelagos as one; the rules to choose from; the fits (cover, fill, contain, stretch) |
| `test/split-merge.test.ts` | 7 | A line across a country: the part clicked to a new country from a date (verify mode), to an existing one in a new event (moved with it), as a correction of the starting map; refused when the line stops inside (and taken back), on the sea, or to its own country; merging into one of them or a new country in an event; one undo step each; a border point moved from a date (either way, in an event, verify mode), junctions and moves across a third country refused; border points shown only on borders at the date (D81); a line a little short carried on to the edge, and a country split twice at two dates (D204) |
| `test/regions.test.ts` | 4 | Today's 4,596 states and provinces found by a point (Berlin, an enclave of Brandenburg; New York; Fiji by the 180th meridian; the sea); anchors inside their regions; today's countries the same way; Brandenburg and Berlin given to two owners meet exactly (areas within 0.2%, no unowned sample along their border); provinces running onto a country's frontier keep its history, and none takes land beyond its outline (D177) |
| `test/scenarios.test.ts` | 9 | A region's history (secession, partition, insertion, deletion, moving events); order independence; simultaneous and overlapping events with durations; seconds and millennia apart; advancing fronts from minutes to years; occupation on its own layer; edits never corrupt unrelated data; formation, fragmentation, collapse |
| `test/geometry-worlds.test.ts` | 7 | Degenerate and self-crossing outlines refused cleanly; poles, the 180° line, more than a hemisphere, 20-metre shapes; splitting and merging; 1 cm precision after reopening; independent worlds of different sizes; undo per world |
| `test/storage.test.ts` | 9 | Reopening; the snapshot the database writes as text against the row-by-row one; undo and redo across reopening; atomic saves; process killed mid-save; versions and backups; PNG round trip; a shot's sound track copied beside its export (D151); export folders |
| `test/recovery.test.ts` | 7 | Three kinds of file damage refused then recovered; damaged backups skipped; no usable backup; malformed rows; 120-step undo/redo compared state by state; old uncompressed history |
| `test/split-identity.test.ts` | 7 | The split-identity optimisation leaves history identical (6 random histories, with and without) and stops coastline relabelling |
| `test/stroke.test.ts` | 7 | Freehand outlines: closed, open, figure-eight, tiny, orientation, reproducible irregularity |
| `test/camera.test.ts` | 8 | Screen/map round trips in every projection, rotation and zoom 0–14; zoom keeps the cursor point fixed; city-level precision; panning across 180°; a view that holds its middle meridian (Equal Earth, Natural Earth): the camera stays in the middle, every place moves by exactly the pixels dragged |
| `test/kernel-incremental.test.ts` | 8 | The kept half-edge structure equals a full rebuild after every kind of edit, undo and redo (4 seeds x 70 steps); nearly overlapping borders; outlines kept under firm snapping, valid with no crossing borders after each (3 seeds x 60) |
| `test/countries.test.ts` | 4 | Today's countries: holes, overseas parts, across 180°, all 242 at once as an event (about 5 s), one undo; land added into the user's own country |
| `test/label-style.test.ts` | 3 | Label styles: layering, clamping, text, commands with undo |
| `test/fills.test.ts` | 3 | Video timing; fill commands with undo; the 197 flags and their credit |
| `test/events-box.test.ts` | 4 | Current events: started and not ended, lingering, alternatives, groups, fades, limits; hidden while empty when asked (D176); kept still (D190): the same box with none, one or many events |
| `test/photo.test.ts` | 5 | The Earth as photographed (D138): the tiles' layout; which tiles a view needs at each zoom, never more than allowed, across the 180th meridian and at the poles; where their picture lies and when it covers a view; the bundled picture and its record |
| `test/front-source.test.ts` | 3 | Where a front starts (D136): the border shared with the new owner's land, found from the change's own edges exactly as from every edge of the map; the side facing its nearest land; the middle; the outer edges of land given up; an expansion's points; a dissolve |
| `test/front-field.test.ts` | 12 | Fronts that follow the land (D136): a U taken from the tip of one arm, a straight border, the land reached as closed lines, islands, pincers, the middle, across the sea, across the 180th meridian, speed; the front's own lines across the land only, never along a narrow gap or round an island not yet reached; where the land reached between two moments lies (D137); a coarser field of the same change gives the same ragged front (D139); the strip of blocks a front crosses between two moments (D140) |
| `test/paleo.test.ts` | 7 | The Earth through geological time (D134): maps packed and read back, blended between moments; the real PALEOMAP maps (today about 30% land; 250 million years ago one land, Pangaea); the glacial sea; deep-time dates written and read; the map made and undone. Continents sliding (D135): a block half way along its motion and whole; India moving steadily north between 50 and 45 million years ago |
| `test/sky-look.test.ts` | 11 | Looks of star maps (D130): made whole and within bounds, every preset its own, looks by chance, colourings, kept and undone; the flat chart (D131): straight down, turned and moved; territories (D132): a lone star's disc, merging, borders half way and pushed back, changing hands, painting, speed; every look of a kind, several of each, the Sun as a star (D217) |
| `test/sequence.test.ts` | 15 | Screen seconds through even and eased pacing; transition settings and styles; transition looks and an event's own look (D137); the still camera and its reset; moving texts and the events box; export choices and sizes; each layer on its own; an event's own time on screen, out of sync with the clock; a turning globe; a steady date; a shot's first moment, where its trails can start (D176); a space shot's camera keeping the point it turns round between keys (D180); a new shot paces history evenly, its camera eases (D190) |
| `test/workflow.test.ts` | 4 | Groups of countries (made, renamed, moved in and out, deleted keeping members); labels and pictures of many at once; many events and countries deleted at once; one undo each |
| `test/names.test.ts` | 1 | Names over time: before and after, renamed again at the same moment, in an event, from the beginning, reload, deleted with the thing, undo |
| `test/flat-maps.test.ts` | 3 | Flat maps: plan view, the width on screen, exact screen conversions, straight borders, panning stops at the edge; true to scale within 1%; labels |
| `test/label-place.test.ts` | 8 | Labels: every large country of today's 242 gets a place inside it in four projections; 24 countries labelled near their middle; across 180° and around the pole; lines for long names; all 242 placed quickly; the part on screen when zoomed in; the gridded distance to an outline; searches cut short (no place acceptable, too small) find the same place |
| `test/land-mask.test.ts` | 1 | "Any land in this box?" against looking at every cell, for 6,000 random boxes (across the 180° line too) |
| `test/kept.test.ts` | 2 | Things kept up to a total weight: what was used longest ago goes first, the newest always stays, the total stays within its limit over 20,000 random steps |
| `test/search-export.test.ts` | 4 | Search (D73): ranking, former names, notes, accents. Data export: the GeoJSON of a map with an enclave and two pieces (areas measured from the file alone equal the owners' land within 1%; holes; features; cities named as at the date); nesting and winding of rings; every CSV (quoting, line breaks, sortable dates, formula text defused) |
| `test/relations.test.ts` | 4 | Relationships (D72): a war begun, ended and begun again (one relationship either way round, read from both sides); kinds that are not mutual; in events (moved with them, undone, reloaded, alternative versions); deleting a party or a relationship; broken references; 150 random edits followed one by one in verify mode |
| `test/features.test.ts` | 10 | Areas, lines and points (D71): each kind checks its shape and cuts no border; dated shapes and lifespans with the three edit choices; in an event (moved with it, undone, reloaded, alternative versions); deleting and broken references; shapes across 180°; looks; 120 random edits followed one by one in verify mode; animated shapes (D79): progress, the shape before, at once without an event or a length, a line cut part way; contested areas (D93) |
| `test/engine-follow.test.ts` | 6 | History followed edit by edit equals a fresh compile after every step of random histories (20 kinds of edit, among them lengths of their own and changes recorded until the next; undo and redo; 5 seeds of 90 steps); checked to catch six planted mistakes |
| `test/characters.test.ts` | 7 | Characters: travelling between places along the shortest path, appearing, leaving the map, moving a placement, in events and from the start, undo, reload, deleted characters reported, across 180°; cities founded, moved at once, abandoned, from the beginning; which way a character faces; its icon setting checked and undone |
| `test/pincers.test.ts` | 1 | An expansion from two ends: the ends change hands first, the middle last, all of it at the end; undone; only an expansion has starting points |
| `test/units.test.ts` | 1 | Units: a character belongs to a country or faction and shows a trail or an arrow; checked, cleared, undone |
| `test/locks.test.ts` | 2 | Locked countries: a stroke across one changes only the land around it and names it; no land given to one; split, merge and annexation refused; unlocked and undone |
| `test/record-lengths.test.ts` | 2 | How long a change takes: its event's length, a date of its own, a time from its own date, at once; recorded until the next change (out of order too), undone together, a length chosen afterwards |
| `test/icons.test.ts` | 2 | The icon set: every shape well formed and on its 64 by 64 grid; unique ids and names, groups, how each turns |
| `test/history-view.test.ts` | 2 | Periods (day, month, year, several years, before year 1), stepping; a country's gains and losses in a period and the changes that made them; lost and won back within a period |
| `test/basemap.test.ts` | 19 | Natural Earth files decode correctly at both scales (land about 29% of the planet, no inside-out polygons, known places on land and at sea across 180° and the poles); dataset record; per-world setting and per-layer clipping setting with undo; culling never drops anything on screen (160 random views); lakes judged whole (less their islands, pieces cut at tile edges together, Lake Victoria the same at both scales); what is shown, while working and in exports apart, with undo |
| `test/kernel-faces.test.ts` | 2 | Faces rebuilt only around an edit equal a full rebuild after every step, on twin random maps (painting, erasing, moving points, undo); `test/kernel-faces.stress.ts` runs it for longer |
| `test/engine-stretch.test.ts` | 2 | States shared between change instants equal states worked out afresh; edits to history are seen at once; edits that do not touch history do not recompile |
| `test/plane.test.ts` | 8 | The projection formulas against d3-geo; a sheet covers exactly what the kernel says each parcel covers, across 180°, at the poles and on flat maps; neighbours simplified alike; dissolved outlines |
| `test/blocks.test.ts` | 3 | A block keeps what matters inside it: the same fill (winding) and the same lines as the whole shape, on random shapes; stored working-view settings are made valid, presets recognised |
| `e2e/render-compare.e2e.ts` | 14 steps | 35 scenes drawn by the renderer and by the old one (`e2e/reference/`) are the same picture (fills strictly, borders by position); a picture carried along as the view moves equals one drawn afresh (eight views, the planet's ends in view and two Equal Earth views holding their meridian among them; whole-pixel moves, then 170 small ones with the room around the frame drawn first; judged by how many pixels differ, how strongly and how densely); after brush strokes inside countries and an undo, the patched picture equals one drawn afresh; every frame of an animated change, renewed only in its own area (the strip its front has crossed, D140; in the plain look and an intense one), equals one drawn afresh, and so does stepping into a change, out of it and from one to another (24 steps, each drawn in part); an 80-frame shot through forty years drawn as an export draws it, each frame from the one before in three passes, equals frames drawn afresh; borders while fronts move (D126): inside the land a front from a zigzag border has reached, only the front itself, none of the old border and no seam; two changes meeting share a border only where a front has come; the globe (D127): places where the flat map has them, lit, nothing beyond its edge or from its far side, a pole and 180° without a seam, the flat picture kept while it turns and the whole frame between changes; in a shot animating every change, one whose land changes hands again soon after is over by then (D128); looks (D137): a soft edge running ahead of the front, a glow just behind it, the line in the owner's colour across the land only, a dissolve in patches, an event's own look; relief from the heights alone (D194): a plain flat to the pixel close in, a hill shaded with no crease along the cells, a straight coast straight and an island's on its circle, the same every time, relief gone where one cell fills the view |
| `e2e/vertical-slice.e2e.ts` | 23 steps | The vertical slice in Chrome: projects, drawing, Earth's geography and data sources, border points, versions, events, dates, version restore and undo, full restart, animation, export with data credits, identical re-export, 1080p, coastline clipping |
| `e2e/desktop.e2e.ts` | 8 steps | The Electron app: own window, own data service on this computer only, project written to disk, videos encoded by the app itself (MP4 and WebM) and played back, the globe drawn on the graphics card, the planetary engine's workers, one copy at a time, close and reopen with contents intact |
| `test/event-groups.test.ts` | 6 | Event group commands with undo (several groups per event, filter rules, deletion keeps events, alternatives keep groups); a new group after the last even with groups deleted, groups reordered and an event moved between groups (D209); a version 1 project file upgraded on opening (backup first, content and undo history intact, old backups restorable without rolling the format back); a file from a newer version refused untouched |
| `e2e/workflows.e2e.ts` | 83 steps | Precise shapes; occupation layer (drawn with stripes: both countries' colours in the pixels); hiding layers; alternative versions; annexation; deleting and undoing events; fades; a second world; a camera move at 2.39:1 and 25 fps with frame timing (an event out of sync with the clock animated in its own 0.4 s), history in the pixels and pass stacking checked; layers of lines, points and areas made with "+ Layer", drawn freehand, by a click and click by click, chosen by clicking, restyled (a claim contested with another country), given a new shape from a date, ended and undone; a war added from a country's panel, read from both sides, resumed and ended, drawn as a front line on their border during the war and not in peace; two dates compared across a dragged line and swapped; an event's end shown from its start, chosen on a calendar, the date viewed stepped with arrow keys; an event type made with a colour, a way of spreading and a length, used by a new event and a drawing, renamed, deleted and undone; a country split along a dragged line (the part clicked named by its side), a point of the new border moved from a date, today's states chosen by clicks and a box and given to a new country, a line in an event drawing itself (half drawn half way through, then set to appear at once), and the two merged into a new country in a new event, undone and redone; search (a country, an event, a point), a picture kept with a country's notes, the data exported as GeoJSON and CSV and read back; square size, Natural Earth projection, 23.976 fps, transparency; the preview of that shot dragged with the mouse (carried while its meridian is held, laid out afresh at rest); names, lakes and rivers hidden while working but kept in the presentation, lakes from about 1,000 km², undone; a character's icon (a ship facing the way it sails and flipped on the way back, an airliner turned, on a disc, three times the size); the character as a unit of a country, in its colour, with an arrow of advance while it travels; changes recorded into an event each spreading until the next (half faded in half way), the last given two years of its own and made an expansion from two points, the second clicked on the map, all in the change's Properties, and another change chosen by its tick in the timeline (D210); a country locked, drawn over and kept, unlocked, all the others locked at once; a radiation layer of conditions, a source placed with a click and a plume carried east, there while they last, hidden while working, undone; a fire spreading over the West Siberian Plain day by day; a meteor impact placed with one click, its crater and blast, undone in one step; a heatmap from the battles, and three thousand strikes drawn in a 4K export frame and the working view; routes with campaign arrows and flowing lines; text boxes and callouts; looks; a shot played; TIFF sequences; SVG frames; a star map with a realm, a lane and planets; the solar system and its moons, side by side with a planet's holder over it; an invented star map; the Milky Way and a galaxy of one's own, its picture as a draft, baked at full detail, kept, and drawn without the graphics card (D193); border shifts generated for a change in its Properties (D210), checked in history and on the map, another version, removed, undone (D195); history played in the working view; borders imported from GeoJSON maps of two years, and from a dataset dating each shape; a shot as MP4 and WebM videos, played back by the browser against the PNG frames; each layer exported on its own; a shot on the globe, turned by dragging its preview, set turning on its own, exported as frames and an SVG frame; a star map's looks: a preset from its picture, any part changed, a look by chance undone, the map as a flat chart moved and turned, two realms' border and a front when they go to war, stars twinkling in a still shot, an SVG frame of it; the Earth through geological time: Pangaea 250 million years ago drawn and named, dates as how long ago, more land in the last ice age, frames of three moments each its own; transition looks (D137): Blitz chosen with its preview playing, a slider making the look the shot's own, the glow in the owner's colour, an event's own look; smart brushes (D148): a stroke beside the Rhine drawn onto a river's own course, a weight moved live, a pin, the land held up to the river; the pen on the Pyrenees' crest; a town pulled onto your side, the sides swapped; a map's own calendar (D149): a template and an era of its own, dates written, typed, stepped and chosen in it, a shot's preview written in it, the Gregorian again; branches (D150): a branch from the date viewed keeping what the main timeline loses, its own event listed in it alone, switched from the title bar, compared side by side, a shot of it, deleted and undone; upkeep and sound (D151): a deleted event's borders tidied away with history unchanged, undone; a shot's sound track, its waveform, a preview exported with the track beside it; the planetary engine (D152): a picture of a planet's sunlight made in workers from the interface, the same bytes from one worker and three, reused for a change it does not read; plate tectonics (D153): a planet's history in a worker, its heights now and 100 million years ago, its plates and crust; the Planet Studio (D156): a simulated planet from New map, a preset, a slider and what follows, its history simulated and explored, a place explained, a year set by hand beside Kepler's (D164), two edits gathered with their estimated consequences and worked out by one re-run that goes on from the history's checkpoint before them (D163), what they made measured (D164), the edited crust and the history before them side by side, used for a map whose land and sea follow it through time; workspaces (D196: each arranges the panels for its work, History with a tall timeline, World with the map's setting-up at the right, Export in the presentation mode; an edge dragged resizes a panel, folded panels give their room to the map, the layout is kept on this computer, the status bar gives the tool's hint); the menu bar (D197: each menu under its name, opening as the pointer passes; no command in two menus; shortcuts and greyed commands shown; a ticked command folds the timeline away and back; Alt+number for workspaces, comma and full stop from change to change, Ctrl+E; the shortcuts list); the tool strip (D198: a narrow column of named icons, a key for each tool, the options bar naming the tool and holding its options, the map keeping its size whichever tool, no tool keys while typing); the lists by tabs (D199: All shows every list, a tab one; a filter by name over countries and events, emptied by Esc; each workspace keeps its tab, kept on this computer); Properties (D200: a country's and an event's groups, a group folded stays folded for the next country, a layer shown in Properties by its name with the options that lay in the list, its being shown changed there and undone, a layer of points with its name alone); the timeline (D201: its head's controls; a group's track with its two events, folded to marks and opened; the strip of changes and branches; zoom by the buttons and Fit; Find and Snap; a bar clicked chooses its event, dragged moves it by the time dragged over, undone); the tool stack (D205), guides (D206), a reset button (D207), Space applying the drawing prompt and the layer rows (D203); an event renaming a country (D204); the shot's settings in tabs in Present (only the export's in Export) and the shots as clips, chosen and scrubbed there (D212); space views level, the middle button moving them, ⌂ home, a star found (D215); the solar row's sliders and Fit screen (D216); looks by kind, the Sun as a star (D217) |

Checked by hand: 4K and 8K exports; the unzipped package starts and works; requests from other hosts are refused.

## The planetary engine's model card (Stage 14.11, D162)

What each model of the planetary engine is, what it rests on, what it was calibrated on, and where it is wrong (the
Earth-like validation in numbers: `docs/PLANET_VALIDATION.md`, made by `bench/planet.bench.ts --validate`). Physically
based: from conservation laws and physical relations, with measured constants; empirical: relations fitted to
observations; diagnostic: worked out from other fields, not evolved.

| Model (code; record) | Kind | Calibrated on | Holds for | Known errors |
| --- | --- | --- | --- | --- |
| Star, orbit and planet (`model/physics.ts`; D152) | Physically based: main-sequence relations, Kepler, a grey greenhouse | The Sun, the Earth, Mars and Venus | Main-sequence stars 0.08 to 20 suns; rocky planets | One grey atmosphere; the habitable zone's edges approximate |
| Sunlight (`climate/insolation.ts`; D152) | Physically based (Berger) | Exact | Any orbit, tilt, tidal locking, two stars | None known |
| Plate tectonics (`tectonics/`; D153, D154, D166, D170) | Kinematic with physically motivated driving (slab pull, ridge push); GDH1 age-depth; Airy isostasy; plates run 200 Myr before a history begins | The Earth's plate speeds, crust, age-depth relation, sea floor ages and its sea's level over 500 Myr | Moving plates, a stagnant lid, plates in bursts, qualitatively | No mantle convection; at preview 2.3 % of the surface above 2 km on the validation's planet (about 1 % of rock on the Earth); the standard level makes two to four times the Earth's new sea floor; 4 to 8 % of the floor older than 180 Myr; continents thin slowly; volcanic islands narrower than a cell; histories sensitive to small changes (D164) |
| Landscape (`surface/`; D155) | Physically based laws, calibrated constants: stream power solved implicitly, creep, conserved sediment | An Earth-like rate of wearing down | Steps of millions of years on cells of 100 km and more | No glaciers carving; local rather than flexural rebound |
| Temperature (`climate/ebm.ts`, `climate/currents.ts`; D157, D159, D165, D168) | A seasonal energy balance (physically based) with the sea's heat transport, the winds' along the parallels, each cell's land on its own, kept snow on ice sheets; two calibrated corrections for the surface's own balance; started from the year's balance and run until settled (D168) | The Earth's zonal means, 22 stations, Antarctica's plateau; sixty-year runs | Planets with air, any orbit and rotation | 3.4 K root-mean-square error at stations (5.4 before D165); within 0.2 K of its own settled state; winds only along the parallels, so east coasts' winters too mild (Chicago's January +5 °C against −5) and western Europe's summers too cool (Paris's July 16 °C against 21) |
| Winds, rain, currents (`climate/hydroclimate.ts`; D158, D159, D165) | Diagnosed winds, physically motivated moisture transport with empirical rates, evaporation by the air's humidity deficit | The Earth's deserts, rainforests, monsoons, rain shadows, currents; 22 stations, the land's rain at 30-55° N, the share of dry climates | Earth-like circulations, slow and fast rotators, tidal locking qualitatively | The deep tropics too wet (Singapore 4,250 mm against 2,300) and the planet's mean high (1,300 mm against 1,000); northern India's monsoon too dry (Delhi 80 mm against 800); a city in a mostly-sea climate cell takes the sea's rain (Cairo 290 mm against 25); narrow ranges' rain shadows weak |
| Water (`water/hydrology.ts`; D159, D166) | Physically based routing (Priority-Flood, Fill-Spill-Merge) with empirical evaporation (Hargreaves, Budyko-Fu); straits and outlets narrower than a cell | The Earth's water budget and lakes | Any land, with or without sea | Runoff as measured (38,600 km³ a year against 40,000); on the Earth's land fresh lakes 51,800 km³ and salt 7,700 against 91,000 and 85,000: the deep lakes narrower than a cell, the Caspian joining the sea, plateau basins keeping shallow lakes |
| Ice (`water/ice.ts`; D159) | Physically based flow (shallow ice, Glen's law) with empirical melt (degree days) | Vialov's profile; Greenland and Antarctica's balance | Ice sheets on land on coarse cells | Domes 18 % thick against the analytical profile at 480 km cells; ice ages grow less ice at coasts than before D165 (land's own, warmer summers) |
| The sea's level (`water/sealevel.ts`; D159) | Physically based: conserved water over the heights | Exact | Every picture of a history | The history's own steps keep the set share of sea (only the pictures follow the volume) |
| Past climates (`climate/paleo.ts`; D159, D167) | The same models, coarse and quick | As above; a picture of today against the full stages | Erosion's rain and the ice on land over a history; each picture's biomes, temperatures and rain | Every 50 Myr for the history; a picture's own on demand, the same biome as the full stages on 80 to 86 % of the land (no lakes or wetlands); ice from a volume-area scaling, not the flow |
| Biomes (`life/biomes.ts`; D160) | Empirical classifications (Köppen-Geiger by Peel et al.; Whittaker by aridity) | Fifteen reference stations; the Earth's belts | Any climate the engine makes | Inherit the climate's errors: on the Earth's land A 20, B 30, C 14, D 18, E 18 % against 19, 30, 13, 25, 12 (B 42 % before D165) |
| Explanations (`explain.ts`; D161) | Diagnostic: words from the fields | — | Today's planet | The circulation named by rules of thumb (latitude, upwind ground) |

## The planetary engine's performance (Stage 14.11, `bench/planet.bench.ts`)

One thread, the development container, the Earth-like preset over 500 Myr (D162):

| Level | History | Sunlight | Climate (temperatures + rain) | Water and ice | Biomes | Cover (1024 × 512) | An edit of the air | An earlier moment (D167) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 (preview, 240 km cells) | 6.9 to 7 s (4.8 to 5.5 before D170's 200 Myr spin-up) | 0.01 s | 0.6 to 1.1 s (0.3 to 0.7 + 0.35 to 0.4) | 0.13 to 0.28 s | 0.02 s | 0.15 to 0.18 s | 1.1 s (2.35 before D168) | 0.3 s |
| 6 (standard, 110 km) | 31 s (23 to 25 before D170) | 0.01 s | 0.6 s (0.3 + 0.3) | 0.29 s | 0.04 s | 0.16 s | 0.84 s (2.2 before D168) | 0.25 s |

Budgets (plan 8.4): history settings at preview in a few seconds (met); simulating at standard under a minute (met);
climate settings within 0.5 s: in the interface the climate's months are shared among the workers (D168), so a change
of the air reaches its temperature and rain pictures in 0.5 to 0.55 s at the preview level with three workers in this
container once they are warm (0.8 to 1 s for the first changes; 1.05 to 1.4 s before D168), and its land seen from
space 0.2 to 0.3 s later (its water and biomes after it). Where the time goes:
the history's tectonic steps 60 % of it at preview and 80 % at the standard level (two-sevenths of them the 200 Myr
the plates run before its first moment, D170), its past climates a quarter at preview. An earlier moment's biomes and picture
(its climate worked out, then drawn at 1024 × 512) are made in a worker when first shown, the pictures of a history
shared among the workers.

## Performance, 19 November 2026 (`bench/render.bench.ts`; large-scale runs with the new transitions)

The benchmark projects rebuilt (`bench/make-fixtures.ts`: Earth 242 with 1,623 parcels, Heavy with 500 border changes
and 10,845 parcels, Random 1000 with 24,504 parcels), Chrome in software (no graphics card, four shared processors),
1920 by 1080. Milliseconds a frame (median; the slowest tenth in brackets). 60 frames a second is 16.7 ms.

| Step | Earth 242 | Heavy | Random 1000 |
| --- | --- | --- | --- |
| A click that changes nothing | 17 (23) | 17 (26) | 14 (15) |
| Choosing a country | 17 (22) | 22 (29) | 21 (25) |
| Moving the whole world | 10 (13) | 11 (14) | 20 (23) |
| Zooming | 17 (97) | 22 (99) | 18 (96) |
| Moving a region | 9.2 (16) | 8.4 (12) | 6.5 (8) |
| Moving close in | 7.2 (9) | 6.6 (9) | 6.7 (14) |
| Moving very close in | 6.6 (8) | 6.7 (11) | 6.4 (9) |
| Dragging the timeline, 25 years a frame | 10 (12) | 109 (137) | 193 (229) |
| Dragging the timeline, a year a frame | 9.0 (10) | 16 (51) | 39 (99) |
| Dragging the timeline, a month a frame, close in | 8.3 (10) | 8.4 (19) | 16 (20) |
| A brush stroke | 31 (70) | 45 (55) | 126 (143) |
| Playing a shot, still camera | 10 (15) | 93 (119) | 157 (250) |
| Playing a shot, moving camera | 62 (91) | 246 (318) | 252 (345) |
| Export, 1080p, PNG | 116 | 159 | 225 |
| Export, 1080p, MP4 (H.264) | 42 | 91 | 115 |

Moving the map, zooming and stepping the date a year at a time are within a frame or two on every project; a zoom
step in ten redraws the picture at the new size (about 100 ms). What is slow is what redraws the whole map of a heavy
project at once: dragging the timeline 25 years a frame, playing through its changes, the moving camera.

**Branches and tidying (D150, D151), on the heavy project** (500 events, 10,845 parcels, 127,282 border sections;
Node in the development container). Making a branch at its middle year: 3 ms; compiling the branch's history: 22 ms
(the main timeline's: 29 ms); an event of the shared history moved: each timeline follows it change by change in
about 1 ms. With a tenth of the events (50) deleted, tidying took 135 ms and made 474 parcels whole, taking away
597 border sections and 353 points; the parcel map stays valid.

**Every change animated (D136, D137), measured for the first time.** The heavy project's thousand years played in
ten seconds has about a hundred changes under way in every frame, covering the whole view:

| Shot | Before | After (D139) |
| --- | --- | --- |
| Heavy, every change animated, clean look | 2,855 (3,826) | 585 (721) |
| Heavy, every change animated, Blitz look | 3,420 (4,896) | 815 (1,166) |
| Random 1000, every change animated, clean look | 386 (573) | 314 (434) |
| Random 1000, every change animated, Blitz look | 451 (918) | 328 (532) |

At the pace of a film (the heavy project's thousand years in 100 seconds: eleven changes under way at once, five
starting each second) a frame takes 62 ms in the clean look and 84 ms in Blitz; in 30 seconds (36 under way) 299 ms.
Where the rest goes (a profile at the film's pace): the changes themselves are now a few milliseconds; two thirds
is the browser painting again every country and border that reaches into the rectangles round the changes, which
on this project is half the frame. On a computer with a graphics card the browser paints several times faster than
here. Since then only the strip each front has crossed since the frame before is drawn again (D140): 7% of the
frame instead of half at the film's pace, 56 ms a frame in software (the time left is in handing whole pictures to the
canvas, which a graphics card does not pay).

**Stress sessions on the build with D136 to D144** (`bench/stress.ts`: random work in the real interface with the
app's verify mode on, so everything worked out from what was there before is also worked out afresh, and every
tenth step the picture on screen is compared with one drawn afresh). None failed; no picture differed.

| Session | Steps | Pictures compared | Frame, median (slowest tenth) | Memory, start to end |
| --- | --- | --- | --- | --- |
| Earth 242 | 300 | 30, none differ | 16.7 (51) ms | 232 to 222 MB |
| Heavy (11,028 parcels, 507 events) | 300 | 30, none differ | 23.7 (177) ms | 288 to 339 MB |
| Random 1000 (25,098 parcels, 1,009 events) | 300 | 30, none differ | 25.8 (276) ms | 365 to 404 MB |
| Earth 242, a computer four times slower | 250 | 25, none differ | 47 (314) ms | 139 to 222 MB |
| Earth 242, twice the pixels, Equal Earth | 250 | 25, none differ | 22.7 (142) ms | 211 to 245 MB |

(The sessions draw, undo, move events and step through time: memory on the two large projects grows with the
strokes made, about 0.15 MB a step; on Earth 242 it does not grow.) The animated shots measured again
on this build: Heavy 625 ms (clean) and 826 ms (Blitz), Random 1000 330 and 320 ms: as after D139, within the
machine's noise, so minding the land (D142) and the bowed borders (D144) cost nothing where they are not used.
The frames a second on a real computer can be read in Settings (D143).

The slowest single frames of those sessions are zoom steps (on the computer four times slower, one of five seconds).
A profile of eighty zoom steps alone: 30% is the browser drawing kept pictures at their new size, 22% its other own
work, 6% collecting memory, 4% finding where names sit (`signedDistance`); nothing else of the app's own is above
1%. Nothing there to make faster in the app's code: a zoom step's cost is the browser's painting, done by the
graphics card where there is one.

## Performance in the improvement pass (measured 18 November 2026, `bench/render.bench.ts`)

The benchmark projects rebuilt with `bench/make-fixtures.ts` (Earth 242 and Heavy), Chrome in software, as below.
Milliseconds a frame (median; the slowest tenth in brackets). "Before": the build with Stages 8–11 and the import
work (commit ac7bfd8); "after": names placed quickly while a shot plays (D125).

| Step | Earth 242 before | after | Heavy before | after |
| --- | --- | --- | --- | --- |
| Playing a shot, still camera | 9.9 (12.6) | 10.1 (13.9) | 85.5 (162) | 81.9 (125) |
| Playing a shot, moving camera | 56 (84) | 62 (93) | 259 (324) | 268 (339) |
| Dragging the timeline, 25 years a frame | 14.5 | 13.9 | 119 (240) | 107 (197) |
| Dragging the timeline, a year a frame | 8.9 | 9.0 | 13.6 | 15.0 |
| Export, 1080p, PNG | 90 | 89 | 141 | 139 |
| Export, 1080p, MP4 (H.264) | 38 | 38 | 74 | 73 |
| Export, 1080p, WebM (VP9) | 39 | 53 | 90 | 77 |
| Export, 4K, MP4 (H.264) | 101 | 158 | 192 | 163 |

Exports are drawn the same way in both builds: their two columns show how much the encoders' speed varies from run to
run in this container (software encoders sharing four processors). A video frame costs about half a PNG frame at
1080p (no PNG to encode; the encoder works beside the drawing). Against the
second optimisation stage the moving camera on the heavy project is slower (94 then, 259 now): the projects were
rebuilt and Stages 8–11 draw more (terrain and land masks), and a moving camera redraws everything each frame; the
user's shots keep the camera still (D34). Where the time goes in the heavy project's still shot (a profile): a
quarter in laying whole pictures on each other (each territory layer painted in a buffer, trimmed to the land, laid
on at its opacity; the coast's band and the borders the same), a third in the browser's own drawing, a sixth in
placing names. The next step for frames that cross many changes at once.

## Performance after the second optimisation stage (measured 17 November 2026, `bench/render.bench.ts`)

Chrome in the development container, **drawing in software (no graphics card)**, map area 1360 x 843. Times are
milliseconds per frame, the whole cost of a step until the page is idle again (median of 40 steps). "Before" is the
build before this stage (commit 4db4bb8, Windows run 37), measured with the same tool on the same projects straight
before "now" (the container's speed drifts by a tenth or two over a day, so the two columns belong together). A
real computer with a graphics card should be faster, a screen with more pixels slower; Settings shows the time on
the user's machine.

Benchmark projects (`bench/make-fixtures.ts`): **Earth 242**: today's 242 countries with 1:10m coasts, 30 events;
**Heavy**: 128,000 border segments, 11,000 parcels, 500 events, about 12 events crossed per step of 25 years;
**Random 1000**: 1,000 overlapping random territories, 24,500 parcels, 1,000 events, changes animating at almost
every date.

| Step | Earth 242 before | now | Heavy before | now | Random 1000 before | now |
| --- | --- | --- | --- | --- | --- | --- |
| A click that changes nothing on the map | 17 | 14 | 26 | 15 | 26 | 12 |
| Choosing a country | 16 | 14 | 23 | 21 | 32 | 17 |
| Moving the map, whole world | 20 | 8.5 | 26 | 8.8 | 26 | 18 |
| Moving the map, a region (zoom 3.5) | 22 | 7.3 | 34 | 7.3 | 29 | 5.1 |
| Moving the map, close in (zoom 7) | 16 | 4.9 | 15 | 5.2 | 20 | 5.1 |
| Moving the map, closer (zoom 13) | 32 | 5.1 | 14 | 5.2 | 22 | 5 |
| Moving the map, very close in (zoom 19) | 24 | 4.8 | 15 | 5.7 | 22 | 4.9 |
| Zooming (each step) | 38 | 20 | 55 | 25 | 32 | 22 |
| Moving the map in Equal Earth, whole world | 168 | 11 | 209 | 10 | 244 | 5.8 |
| Moving the map in Equal Earth, a region | 190 | 7.2 | 183 | 6.3 | 219 | 5.1 |
| Dragging the timeline, a year a frame | 9.2 | 7.1 | 33 | 13 | 42 | 27 |
| Dragging the timeline, a month a frame, close in on a region | 7.4 | 7.3 | 10 | 7.6 | 38 | 14 |
| Dragging the timeline, 25 years a frame (a dozen events crossed in each) | 8.9 | 8.3 | 196 | 89 | 244 | 151 |
| Stepping day by day | 8.8 | 7.9 | 12 | 9.5 | 42 | 37 |
| A brush stroke (the kernel, history and the redraw) | 72 | 29 | 85 | 37 | 188 | 120 |
| Playing a shot, still camera | 8.9 | 8.8 | 102 | 84 | 136 | 117 |
| Playing a shot, moving camera | 61 | 33 | 136 | 94 | 112 | 110 |
| Export, 1080p, per frame | 100 | 87 | 264 | 127 | 252 | 171 |
| Export, 4K, per frame | 241 | 206 | 545 | 269 | 483 | 305 |
| Export, 1080p, eight layers of each frame | 215 | 182 | 502 | 300 | 458 | 298 |
| Opening the project | 2.9 s | 1.9 s | 5.1 s | 2.7 s | 5.9 s | 3.5 s |

**A computer four times slower** (`bench/stress.ts --throttle 4`, 150 random steps, the heavy project; milliseconds
for the whole action, before and now, measured one after the other):

| Action | Balanced before | now | Fastest before | now |
| --- | --- | --- | --- | --- |
| A frame, median over the session | 132 | 56 | 92 | 46 |
| A brush stroke | 344 | 159 | 352 | 146 |
| Undo | 312 | 182 | 299 | 172 |
| A border point moved | 229 | 90 | 256 | 96 |
| Moving the map (ten frames) | 1,484 | 562 | 844 | 345 |
| Zooming (eight frames) | 769 | 448 | 544 | 381 |
| Dragging the timeline (twelve frames) | 1,794 | 922 | 1,993 | 904 |
| A jump in time | 498 | 339 | 455 | 355 |
| The whole session of 150 steps | 113 s | 62 s | 96 s | 56 s |

**Stress runs** (`bench/stress.ts`, verify mode on, the map compared with a fresh drawing every ten steps): thirteen
sessions of 160 to 300 random steps on the three projects, among them three on a screen twice as dense, one that
starts in Equal Earth, one of timeline drags and jumps only and one of zooming and moving only; and 150 steps on a
computer four times slower in both presets. No difference found, no error, and memory level after the first hundred
steps (about 200 MB on Earth 242, 270–310 MB on Heavy, 400 MB on Random 1000). One session did report a difference
(0.17% of pixels along every coast, on the dense screen): the check was comparing two levels of coast detail, both
within the tolerance (D69); with the fresh picture's geometry prepared for the same zoom the pictures are the same.

What still takes time, in order of what it would give:

1. **Changes of territory over large parts of the map in one frame**: dragging the timeline across a dozen events a
   frame, and playing a shot that does (Heavy and Random 1000: 85–150 ms a frame). Half of what is left is filling
   the changed territory again (a graphics card takes most of that); the rest is joining each changed owner's
   parcels into one outline, and finding the place for the name of every country whose land changed (a quarter of
   a frame of such a shot).
2. **Shots in Equal Earth or Natural Earth whose camera moves east or west, while they play**: every shape changes
   with the middle meridian, so each frame prepares the map again (130–210 ms a frame on these projects), as their
   export does by design. Framing such a shot by hand no longer costs this (D67: 5–11 ms a frame, with the map
   straightening a little when it comes to rest).
3. **Zooming without a graphics card**: showing the kept picture at another size is the browser's dearest copy
   (about 15 ms a frame at this size), and every three quarters of a level the picture is drawn whole (50–130 ms on
   the heavy project). Geometry is no longer prepared again in the middle of zooming in (D70).
4. **A world view with a thousand names on screen** (Random 1000: 18 ms a frame while moving): the names are placed
   and drawn again in every frame.
5. **Opening**: about half is now the kernel preparing its map (the order of borders around every point, areas),
   the rest the first picture.
6. Exports with a moving camera draw every frame afresh by design; encoding a frame (about 110 ms of processor time
   at 1080p) is what an export of a simple map waits for, on as many processors as the computer has.

### The first optimisation stage, for the record (measured earlier on 17 November)

Before that stage the map of today's 242 countries took 249 ms for a frame that changed nothing, 325–3,100 ms a
frame to move, 224 ms to step through time, 0.7 s for a brush stroke and 730 ms for an exported 1080p frame. The
table as measured then (the benchmark projects were rebuilt since, so its last three columns are not to be compared
with the table above):

| Step | Earth 242 before | Earth 242 now | Heavy now | Random 1000 now |
| --- | --- | --- | --- | --- |
| A click that changes nothing on the map | 249 | 17 (the map itself 3) | 18 | 18 |
| Moving the map, whole world | 325 | 20 | 22 | 22 |
| Moving the map, a region (zoom 3.5) | 517 | 20 | 36 | 24 |
| Moving the map, close in (zoom 13) | 522 | 31 | 16 | 14 |
| Moving the map, very close in (zoom 19) | 3,107 | 32 | 14 | 15 |
| Zooming (each wheel step) | not measured | 35 | 53 | 31 |
| Scrubbing through time | 224 | 7 | 166 | 218 |
| Scrubbing between events (nothing changes hands) | not measured | 8 | 9 | 38 |
| A brush stroke (the kernel, history and the redraw) | 693 | 40 | 71 | 151 |
| Playing a shot, still camera | 212 | 7 | 78 | 97 |
| Playing a shot, moving camera | 1,120 | 52 | 127 | 103 |
| Export, 1080p, per frame | 730 | 92 | 248 | 216 |
| Export, 4K, per frame | 2,288 | 203 | 493 | 438 |
| Export, 1080p, eight layers of each frame | 3,935 | 192 | 426 | 409 |
| Opening the project | 3.2 s | 3.1 s | 5.0 s | 6.3 s |

The earlier figures below are from before this stage (16 November, `test/perf.bench.ts`: kernel, saving, file size).

## Performance (measured 16 November 2026, development container, `test/perf.bench.ts`)

Random overlapping territories, each with its own dated event; 40 countries.

| Territories | Parcels | Border segments | Stroke | Save | Recompile after an edit | File |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 263 | 8,223 | 23 ms | 2 ms | 1 ms | 1.9 MB |
| 300 | 2,160 | 28,322 | 86 ms | 4 ms | 7 ms | 6.7 MB |
| 1,000 | 24,504 | 130,367 | about 0.4 s (1.75 s before the engine redesign); the first edit after opening about 1.3 s | 11 ms | about 50 ms | 35 MB |

Adding all 242 of today's countries (98,000 points) takes about 5 s.

Before this stage the same 300-territory project took 135 ms per stroke and 124 ms per save, and its file was 232 MB;
recompiling the 1,000-territory history took about 800 ms after every edit.

(Since then: face assembly works only around an edit, D48, and rendering is covered by the table above.)

## Known bugs and limitations

1. **Not yet run on the user's PC.** The tests run on a Windows machine in GitHub Actions; the installer and the
   launcher have not yet been tried by the user.
2. **Coastline detail.** The finest basemap detail is 1:10m (about 200 m); street-level coasts (OpenStreetMap) are not
   included. With the terrain on and its finer heights, close in (a city) the heights draw the coast to about 30 m
   (D176); offline, or where a height tile is missing, Natural Earth's coastline is used. Areas in the inspector
   include parts clipped away at the coast.
3. **Large maps** (done in the optimisation stage, see Performance): what still takes time is listed there.
4. **(Fixed 18 November 2026) Two animations meeting.** Where two simultaneous animated changes touch, their
   shared border is now shown only where the fronts make the owners on its two sides differ (D126); it was drawn
   throughout. In the same fix, borders inside an advancing front from a border are no longer a mesh of lines.
5. **Animation taking over another animation.** When a change starts while an earlier one is still animating the
   same area, the earlier one is shown at its end. (In shots that animate every change, such as "+ Whole history",
   a change now ends before its land changes hands again, D128; this remains for changes recorded with animations
   of their own that overlap.)
6. **Event groups are made by hand** (D8). Automatic groups, such as "every event that changes this world", are not
   built; tell me if they would help.
7. **(Fixed) A control or occupation layer can be drawn hatched** (stripes, crosses or dots in its owners' colours,
   D88) instead of as a second fill over the political layer.
8. **(Fixed) New layers and alternative versions are named in the app's own dialog** (the desktop app has no browser
   prompt); deleting still asks with the system's own small confirmation box.
9. **View memory is per browser** and is lost if the app's port changes.
10. **(Fixed 17 November 2026) Outlines under firm snapping.** Thought to be a face-assembly fault; it was two others
   (D39): `netPath` kept cancelled back-and-forth steps (the far side of a border could count as inside), and firm
   snapping could leave new borders crossing old ones (silently). Both fixed; an outline that cannot be joined
   cleanly is retried with gentler snapping, and only refused if even the finest fails.
11. **Backups hold the project file.** Uploaded pictures and videos are kept in the project folder's `assets`,
   named by their content and never deleted, so a backup restored in its folder has every picture it used; a
   backup file copied elsewhere on its own does not carry them (copy the whole project folder). Border drafts
   (unfinished border-pen lines, `drafts.json`) are working notes and are not in backups.
12. **(Mostly fixed) Characters' looks**: icons (a ship, an airliner and others, turned the way they travel) or
   pictures, units in their country's colour with arrows of advance, and trails in shots. Placements made inside an
   event are removed from the character's panel.
13. **"Changes over time" reads one layer** (the one being drawn on) and compares the start and the end of the period.
14. **The export size is an estimate** from one frame of each chosen layer, drawn small and worked up (D69; checked
   to be within a factor of 2.5 of a real export; usually much closer).
15. **A shot in Equal Earth or Natural Earth, while its camera is framed by hand**, keeps the middle meridian it had
   and straightens a little when the pointer rests or lets go (D67): what is shown at rest is what is exported.
16. **(Fixed 18 November 2026) Flat maps after reopening a project.** A project opened again rebuilt the parcel
   maps of round maps only, so working on a flat (city) map after restarting the app failed with "No parcel map for
   map space…". Every map's parcel map is now rebuilt (`flat-maps` test: a flat map and what was drawn on it, after
   reopening).

## Defects found and fixed in the testing stage (0.2.0)

| Defect | Severity | Fix |
| --- | --- | --- |
| An outline enclosing no area, folding back or crossing itself could repaint the whole world | Data | Out-and-back segments no longer seed the fill; every paint is checked against the area its outline encloses and refused cleanly otherwise |
| Territory commands accepted a layer from another world, or a missing event or owner | Data | Validated before anything is written |
| History Health's problem list could be read out of date | History | Always recompiled before it is read |
| Opening a damaged project showed nothing; no way back from inside the app | Recovery | Plain message and recovery from the newest healthy backup; damaged files kept |
| Separate export passes did not stack back into the full picture with several layers | Export | One drawing order everywhere: all fills, all borders, labels |
| Wheel zoom jumped away from the cursor (up to half the planet at world scale) | Navigation | Correction pan direction fixed, iterated to 0.01 px |
| Project files grew by about 1 MB per stroke on large maps (every coastline relabelled) | Storage | Split-identity optimisation (history proved identical), compressed undo history |
| Saves slowed to over 100 ms | Storage | As above |
| Recompiling history took about 0.8 s after every edit on large projects | Performance | Cached parcel family tree; overlap checks indexed by land |
| Background and grid passes reconstructed territory they never draw | Export speed | Skipped |
| Kernel face changes did not advance its revision counter | Latent | Fixed (caches rely on it) |

## Session log

| Date | Work | Commits |
| --- | --- | --- |
| 15–16 Nov 2026 | Stage work from an empty folder: time system and kernel; world model, engine and commands; data service; interface; end-to-end fixes; documentation (0.1.0) | `2a564fc` → `0966b07` |
| 16 Nov 2026 | Testing and refinement: scenario, geometry, world, recovery, camera and A/B tests; second interface test; benchmark; 11 defects fixed; performance work (0.2.0) | `6a3c64a` → `343d84c` |
| 16 Nov 2026 (3rd) | The user's first feedback round (14 items) and the engine redesign; two kernel defects fixed | `aca87e0` → `db6423b` |
| 17 Nov 2026 | The user's second feedback round (12 items): labels, add into a country, characters, corrections from the date drawn, changes over time, still camera, advancing front, draggable texts, graphic as the box, export choices and size | `6525557` → `83c103a` |
| 17 Nov 2026 (4th) | Second optimisation stage: history, snapshots, borders and names brought up to date from what was there; animated changes redrawn only in their own area, and stepping into, out of and between them too; exports drawn frame from frame; kept pictures with room around the frame, holding the repeating map, one picture while zooming; Equal Earth and Natural Earth keep their meridian while moved; Chrome's canvas copies and closePath avoided; the database writes the snapshot; weight-limited caches; a verify mode and a random stress run; six defects fixed (D55–D70) | `ef62f20` → `ea7df4a` and the commit after it |
| 17 Nov 2026 (3rd) | Optimisation stage: kernel faces rebuilt around an edit, engine states per stretch, the renderer rewritten on sheets and blocks, carried pictures, live and full interface updates, browser-encoded exports, patched redraws after edits, the Settings button; benchmark projects and tools; four defects fixed (D48–D54) | after `c9bdc89` |
| 17 Nov 2026 (2nd) | Firm-snapping kernel defects (D39), cities (D40), trails; the third feedback round: grey borders and "+ Layer" fixed, choosing several, right-click menus, groups, bulk delete, cities under countries, labels apart, border eraser, flat maps (D41–D44) | `ed163e3` → latest |
| 16 Nov 2026 (2nd) | Package installs work; Natural Earth basemap (land, lakes, coastlines, present-day borders guide), land export pass, data sources dialog and export credits; coastline clipping with land-aware labels; real React types (D4 reversed); desktop app, Windows installer and Windows test run (D2 reversed); Windows fix; event groups and the first file-format upgrade | `071deac` → `9004a90` |

## Next priorities (18 November 2026, Stages 10 and 11 done; improvement pass)

1. The user tries the latest installer: Stages 8 to 11 and the improvement pass (history played in the working view,
   videos, borders imported from files, a shot of the whole history, layers' opacity and border width, each layer as
   its own pass, the globe that turns, the advancing front and two changes meeting drawn right) and reports back;
   Stage 12 waits for the go-ahead.
2. The improvement pass goes on: playing shots and dragging the timeline through many changes on large projects
   (the slowest steps measured; GPU compositing is the next big step, D125); two recorded animations overlapping on
   the same land (known limitation 5).
3. The globe in the working view, if wanted (the drawing tools work in a flat map's terms), and a choice of light
   and air for it.

## Next priorities (18 November 2026, Stages 8 and 9 done)

1. The user tries the latest installer (Stages 8 and 9: terrain, rivers, the satellite look, close-up heights,
   conditions, disasters, heatmaps) and reports back; the next stages wait for the go-ahead.
2. Arrival-time fields for fronts (slowed by mountains and water), now that terrain is there.
3. Space maps (still wanted, D38).

(D1, reversing to the deck.gl renderer, is moved to when terrain and fields arrive (Stages 8 and 9), which need the
graphics card: for territories, features and names the Canvas renderer is now fast enough (D48–D70).)

## Next priorities (after the second feedback round)

1. The user tries the second round (installer from the latest "Windows build and tests" run) and reports back. Space
   maps are still wanted (D38); maps of cities are not.
2. Characters: icons or pictures for markers, characters following events automatically.
3. Make face assembly incremental too (the first edit after opening a large map; Known bug 10 is fixed, D39). (Done in the optimisation stage.)
4. Reverse D1 (deck.gl renderer).
5. Space maps (still wanted, D38).

## Earlier priorities (first feedback round)

1. The user installs the desktop app from the GitHub Actions artifact (or runs `Start Map Maker.bat`) and reports
   what happens.
2. Examine face assembly under firm snapping (Known bugs 10); then make face assembly incremental too.
3. Reverse D1 (deck.gl renderer).
4. Finish Stage 2: split and merge tools, region picker, sub-national boundaries.
5. Finish Stage 3: custom event types, date comparison, dated border-point moves.
6. Stage 4: line, point and area layers, layer styles (hatching, outlines), relationships, lifespans.
