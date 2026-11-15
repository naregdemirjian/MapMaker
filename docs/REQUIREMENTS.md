# Map Maker: requirements checklist

Every requirement from the master specification and the user's later answers, with its current state. Grouped by the
specification's topics. "Stage" is the stage of the approved roadmap where the requirement is built.

Status: **Done** = works in the interface and is tested · **Partial** = some of it works (the gap is stated) ·
**Not started** · **Interim** = works, but not yet in the approved form (see DECISIONS.md).

Last updated: 16 November 2026 (version 0.1.0).

## Platform, projects and saving

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Single user, local, no accounts, cloud or collaboration | Done | 0 | The service accepts connections from this computer only |
| Runs on the user's Windows 10 PC (32 GB RAM, 200 GB free) | Interim | 0 | Local service + browser, started with `Start Map Maker.bat`; Electron installer pending (D2); not yet run on Windows |
| Simple interface for a software novice; no terminal or git needed | Partial | 0 | One double-click to start; needs Node.js installed once |
| Create, open and switch projects | Done | 1 | |
| Autosave of every change | Done | 1 | Each action is saved as one atomic step |
| Undo and redo, kept across sessions | Done | 1 | |
| Named versions, restorable | Done | 1 | Restoring is itself undoable |
| Automatic backups, restorable | Done | 1 | Hourly while working and on opening; 24 newest, daily for 30 days, weekly for a year |
| Crash recovery: a crash never corrupts the project | Done | 1 | Tested by killing the process mid-save |
| Integrity check on opening | Done | 1 | |
| Schema migrations for future versions | Partial | 1 | Mechanism in place; only version 1 exists, so no migration tests yet |
| Reopening returns to the same view and date | Done | 1 | Remembered per project by the browser |

## Worlds and bodies

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Several independent worlds per project, each with its own map, layers and territorial history | Done | 1 | Entities and events are shared by the project (D8) |
| Nothing hardcoded to Earth | Done | 1 | Earth is an ordinary world with a radius; presets for the Moon, Mars, Mercury, Venus, Ganymede, Titan |
| Earth follows real history up to today; appearance does not change by date | Not started | 8 | Needs the Earth data wizard |
| Moon, planets and moons of the solar system with real surface data | Partial | 8, 11 | Blank spheres with correct radii; surface data not started |
| Solar system map | Not started | 11 | |
| Known exoplanets and systems, unknown looks chosen by the user | Not started | 11 | |
| Nearby stars map, 50 light-years | Not started | 11 | Radius confirmed by the user |
| Milky Way map and other galaxies | Not started | 11 | |
| Flat maps only | Done | 0 | |
| Fictional worlds created in the app; import is minor | Partial | 8 | Blank worlds can be created; planet generator and sculpting not started |

## Map and navigation

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Interactive map: pan, zoom, rotate | Done | 0 | |
| Equirectangular default; Equal Earth, Natural Earth, Mercator | Partial | 0, 10 | Choosable per shot; no projection choice in world-building mode yet |
| Automatic regional projection for zoomed-in shots | Not started | 10 | |
| Grid and scale bar | Done | 0 | |
| Earth basemap (coastlines, borders) | Not started | 0 | Natural Earth data could not be downloaded in this session |
| Terrain, imagery, city-level detail (no buildings) | Not started | 8 | |

## Drawing and editing geography

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Genuine sphere-safe geometry with valid shapes | Done | 0, 2 | Randomised tests across poles and the 180° line |
| Freehand drawing | Done | 2 | Territory brush with smoothing, irregularity and detail |
| Precise point-by-point shapes | Done | 2 | |
| Vertex editing: move, add, remove | Done | 2 | Moves that would cross a border are refused |
| Snapping to existing borders | Done | 2 | |
| Polygon splitting and merging | Partial | 2 | Drawing splits and merges territory; no dedicated split or merge tools |
| Border pen (draw a line that becomes a border) | Not started | 2 | The geometry operation exists; no tool yet |
| Region picker, administrative boundaries, coastline clipping | Not started | 2 | Needs basemap data |
| Natural boundary assistance, terrain-aware brush | Not started | 12 | Needs terrain data; will not be claimed until tested on real data |
| Strategic and military drawing assistance | Not started | 12 | |

## Countries, entities, layers

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Countries and factions with names, colours, notes | Done | 1 | |
| Characters, settlements, units as entities | Partial | 1, 4, 7 | They can be created and described; no map presence yet |
| Custom entity and event types | Not started | 3, 4 | Built-in types only |
| Relationships (part of, at war with, successor of) | Not started | 4 | |
| Unlimited custom layers | Partial | 4 | Unlimited territory layers; area, line, point and field layers not started |
| Layer visibility and choosing the layer to draw on | Done | 4 | |
| Layer styling | Partial | 4, 10 | Stored per layer; no style editor yet |
| Geographical features (rivers, mountains, cities) | Not started | 4, 8 | |
| No arbitrary limits on layers, entities, territories, overlaps | Done | 1 | None imposed; very large projects not yet benchmarked |

## Time and history

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Time from millennia to milliseconds; infinite range | Done | 3 | Exact over ±24 trillion years |
| Gregorian calendar with BCE dates and flexible entry | Done | 3 | "14 May 1203", "500 BCE", "c. 3000 BCE", "2241-03-02T04:05" |
| Fictional calendars | Not started | 13 | |
| Events with dates, durations, types, descriptions | Done | 3 | |
| Events genuinely change world state | Done | 3 | |
| Reconstruction of the world at any date | Done | 3 | |
| Editing an event updates later history, never earlier or unrelated history | Done | 3 | Randomised tests against a full replay |
| Same date always gives the same state | Done | 3 | Also after reload |
| Simultaneous events, ordered by precedence and flagged | Done | 3 | |
| Overlapping events: later-starting takes over, flagged | Done | 3 | Approved default rule |
| The app asks what an edit means: new change, correct this period, correct for all time (border shapes) | Done | 3 | "New change" says how long it lasts; record mode skips the question |
| Broken dependencies flagged with "leave or auto-adapt" | Done | 3 | History Health: keep as stored or re-apply the intention |
| Dated moves of border points (new change or correct period) | Not started | 3 | Border points correct for all time; dated border changes use the territory brush |
| Historical timeline, zoomable, with markers and next/previous change | Done | 3 | |
| Date comparison | Not started | 3 | |
| Alternative versions of an event for story planning | Done | 4 | |
| Full alternative timelines with side-by-side comparison | Not started | 13 | |
| Entity lifespans, renames, successions | Not started | 4 | |
| Permanent and temporary environmental change kept separate | Not started | 9 | Architecture separates them |

## Military, characters and movement

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Military control separate from ownership; occupied and contested areas | Not started | 7 | |
| Frontlines (derived and manual) | Not started | 7 | |
| Units, installations, arrows | Not started | 7 | |
| Character routes and journeys | Not started | 7 | |
| Migration flows | Not started | 7 | |

## Environment and heatmaps

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Heatmaps and field layers | Not started | 9 | |
| Disasters, drawn with or without assistance | Not started | 9 | |
| Very large numbers of events (for example a nuclear war) | Not started | 9 | |

## Presentation and animation

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Separate world-building and presentation modes on one world model | Done | 5 | Shots never change history |
| Shots covering a historical date range | Done | 5 | |
| Animation length independent of historical duration | Done | 5 | |
| Per-event "out of sync with the clock" override (approved) | Not started | 6 | |
| Camera keyframes | Partial | 5, 10 | Start and end view with easing; no multi-key camera or flights |
| Text overlays | Partial | 5, 10 | Date and title; no free text boxes or animation |
| Territorial transitions | Done | 6 | Advancing front and fade; borders and labels follow |
| Timeline playback | Partial | 5 | Shot playback; no playback in world-building mode |
| Labels | Partial | 2, 10 | Automatic, collision-avoiding; no label editor |
| Map styles and presets | Not started | 10 | |

## Export

| Requirement | Status | Stage | Notes |
| --- | --- | --- | --- |
| Rendered from project data, never screenshots of the interface | Done | 5 | Frames are drawn off screen at the exact output size |
| PNG sequences | Done | 5 | |
| Transparent backgrounds | Done | 5 | |
| Separate layer passes for Premiere Pro, with a compositing guide | Done | 5 | Background, fills, borders, labels, overlays, beauty |
| 1080p, 4K, 8K and custom resolutions and aspect ratios | Done | 5 | 4K and 8K checked; about 6–9 s per 8K frame in development |
| Custom frame rates including 23.976 | Done | 5 | |
| Identical output when re-exported | Done | 5 | Checksums compared in the interface test |
| Historical date ranges | Done | 5 | |
| Quarter-size preview export | Done | 5 | |
| TIFF sequences | Not started | 10 | |
| SVG where suitable | Not started | 10 | |
| Selected geographical regions | Partial | 5 | By framing the camera; no region-crop tool |
| Shots pinned to a saved version | Not started | 5 | The manifest records the project's save point |
