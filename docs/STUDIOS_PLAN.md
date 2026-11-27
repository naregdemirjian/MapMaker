# The five studios: plan of the interface (from 27 November 2026)

Agreed with the user on the canvas "Map Maker: the five studios (plan)"
(https://claude.ai/artifact/A84BzhzZxjAGQCF1tZ6vix) and in conversation on 26 and 27 November 2026. Interface and
experience only: no new map features while this is built.

## What was decided

- **Five studios**, each its own piece of software (tools, panels, menus): **Map Studio** (the ground: maps of every
  kind and their setting-up), **History** (who holds what, when: countries, borders, places, areas, conditions and
  disasters), **Timeline** (events in order: tracks, a table), **Looks** (designing one thing in depth) and
  **Presentation** (shots, then the export, as two pages). Shared by all: the project, the map viewed, the date, what
  is selected, the Looks and Effects panels, search, undo.
- **Every panel docks like Premiere's**: dragged by its tab into another group (tabbed), to an edge of one (split),
  or out (floating); groups resized by their edges; closed, and opened again from the Window menu. **Reset
  workspace** puts the page's panels back; **Save workspace** keeps the page's layout as its own (Reset then returns
  to it; "Original layout" to the first one).
- **Looks panel**: the fundamentals of the thing selected, and the effects on it; the only place looks are set.
  Fundamentals: country (colour, fill, opacity, border, label); city or person (marker, size, label); border (width,
  colour, line style); graphic (background, text, corner shape). "Design" (a button and a key) opens it.
- **Effects panel**: every effect the software has, in folders (countries, borders, labels, graphics, transitions,
  saved by you); dragged onto a thing on the map or into its Looks. More effects are added over time.
- **Properties**: what a thing is (name, kind, territory over time, relationships, notes); nothing about looks.
- **Groups**: a group has Looks of its own and acts like an adjustment layer: its effects and a member's own effects
  apply at the same time; a member's own fundamentals win part by part. Clicking one thing changes only that thing.
- **Presentation**: the Looks and Effects panels docked beside the shot; a change applies everywhere unless switched
  to "this shot only"; every option of the Looks panel can be keyframed, each keyframed option a track of the shot.
- **Looks studio**: a large stage (the thing alone or on the map, at several zooms), the thing's parts top to bottom,
  every part editable; tools to design by hand (pen and shapes, text, brush last), each drawing fixed to the land or
  a pattern following the country; a stack of effects saved as a new effect.
- **Map Studio**: a gallery of kinds of map; a new project starts with no map. Terrain, rivers, coasts, lakes and
  biomes leave History.
- **Parked**: maps that change in events, Earth and Moon, major cities, the city maker, craters from strikes.

## Stages (each: tests, full check, decision record, docs, commit, push, Windows run green)

1. **The frame (S1), done (D234)**: studios bar; the docking engine (layout model, tabs, splits, floating, resizing, closing and
   opening, save and reset per page, kept on this computer); today's contents placed in the studios (World becomes
   Map Studio, Map becomes History, History becomes Timeline, Present and Export the two pages of Presentation; the
   Looks studio with the lists and Properties until its own panels exist); the lists as panels of their own.
2. **Map Studio (S2), done (D235)**: the map gallery (no default map); Map Studio's tools (terrain and water) and the map's
   setting-up there only; History keeps drawing, places, conditions and disasters.
3. **Looks panel (S3), done (D236)**: fundamentals by kind of thing; Design opens it; looks leave Properties.
4. **Effects panel (S4), done (D238, D237)**: every effect in folders, dragged onto things or into Looks; group looks
   as adjustment layers.
5. **Looks in Presentation (S5)**: docked in Shots; everywhere or this shot only (D239); keyframes on any option, as
   tracks (D240). Done.
6. **Timeline studio (S6)**: its own panels (groups, types, branches, statistics) and a small map following the date
   (D241); the table of events (D242); planned events, Draw in History, a shot of an event (D243); History's compact
   time bar (D244); several events at once: chosen, moved, stretched, Move everything after, a shot of them (D245);
   the map's calendar (D246); the outline of events (D247). Done.
7. **Looks studio (S7)**: the parts, as drawn (D248); the stage (D249); saving a stack as an effect.
8. **Designing by hand (S8)**: pen and shapes, text; then the brush.
