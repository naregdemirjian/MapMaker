// The tools (D198): their names, what they do, the key that takes each in hand, and the group it stands in
// on the tool strip. Which of them a map has depends on the map.
import type { Tool } from './store.ts';
import type { World } from '../world-model/world.ts';
import { terrainSourceOf, isSpaceMap } from '../world-model/world-settings.ts';

export interface ToolInfo { id: Tool; key: string; group: 'select' | 'draw' | 'borders' | 'things' | 'land' | 'space'; name: string; hint: string; stack?: string }

/** Tools stacked in one place on the strip (D205): the one last used shows, the others slide out from it. */
export const STACKS: Record<string, Tool[]> = { territory: ['lasso', 'pen', 'polygon'] };
export const stackOf = (id: Tool): string | null => Object.keys(STACKS).find((k) => STACKS[k].includes(id)) ?? null;

export const TOOLS: ToolInfo[] = [
  { id: 'select', key: 'V', group: 'select', name: 'Select', hint: 'Click to inspect a place; drag to move the map; wheel to zoom. Several countries: Ctrl+click adds or removes one, Shift+drag a box round them, Ctrl+Shift+drag over them.' },
  { id: 'lasso', key: 'B', group: 'draw', name: 'Territory brush', hint: 'Draw around an area freehand. It is given to the owner chosen on the right.' },
  { id: 'polygon', key: 'G', group: 'draw', name: 'Precise shape', hint: 'Click for a corner, press and drag for a curve; click the line to add a point; drag points and handles to reshape (Alt: one handle alone). Click the first point, double-click or Enter to finish; Esc to cancel.' },
  { id: 'pen', key: 'P', group: 'draw', name: 'Border pen', hint: 'Draw a border at your own pace, in curves (click for a corner, drag for a curve, click the line to add a point) or freehand; pan and zoom, carry on later. Enter finishes; Backspace takes back the last point. Drafts are kept with the project.' },
  { id: 'vertex', key: 'A', group: 'borders', name: 'Border points', hint: 'Drag a border point to correct the border shape for all time. Double-click a border to add a point; Delete removes the point under the cursor.' },
  { id: 'split', key: 'K', group: 'borders', name: 'Split', hint: 'Draw a line right across a country, then click the part that changes hands: it goes to a new country or another one, from the date viewed, as a correction or in an event. Esc starts the line again.' },
  { id: 'regions', key: 'R', group: 'borders', name: 'Regions', hint: 'Choose today\'s states and provinces, or today\'s countries, on the map (a click toggles one, a box takes all inside it), then give them to a country, from the date viewed, as a correction or in an event.' },
  { id: 'reach', key: 'M', group: 'borders', name: 'Advance & buffer zone', hint: 'Advance: the country chosen takes the land of the neighbour you click within a distance of their border, by travel through the land (slower over mountains and water). Buffer zone: click beside a border; the land within the distance either side goes to nobody or the owner chosen. Zones of control: click a country; its land is divided among its cities by travel. From the date viewed, as a correction or in an event.' },
  { id: 'erase', key: 'E', group: 'borders', name: 'Border eraser', hint: 'Drag across borders to erase them: the country where you start takes the land across each border you cross, from the date viewed (or in the event being recorded). Start outside any country to clear land.' },
  { id: 'feature', key: 'L', group: 'things', name: 'Areas, lines & points', hint: 'Draw on a layer of areas, lines or points: claims and zones, front lines, roads and arrows, battles and sites. They overlap freely and never change who holds the land.' },
  { id: 'place', key: 'C', group: 'things', name: 'Characters & cities', hint: 'Click the map to put the chosen character or city there from the date being viewed (a point, no borders). With Select, drag one to move it.' },
  { id: 'sculpt', key: 'T', group: 'land', name: 'Terrain', hint: 'Sculpt the terrain: raise and lower ground, draw mountain ranges and valleys, make craters and islands, paint land and sea, smooth, flatten, roughen or erode. A stroke changes the base world or holds from the date viewed.' },
  { id: 'disaster', key: 'D', group: 'land', name: 'Disasters', hint: 'Nuclear strikes, earthquakes, eruptions, floods, wildfires, meteor impacts and droughts: choose one and its size, then click the map. It is placed as an event from the date viewed, its conditions rising and fading by themselves (an impact leaves its crater in the terrain); one undo takes it all back.' },
  { id: 'field', key: 'F', group: 'land', name: 'Conditions', hint: 'Radiation, fire, smoke and ash, floods, destruction and heatmaps: click the map to place a source on a field layer from the date viewed (or in the event being recorded). It rises, lasts and fades by itself.' },
  { id: 'lanes', key: 'N', group: 'space', name: 'Lanes', hint: 'On a star map: click a star, then another: a lane between them (a route, a jump lane, a supply line) from the date viewed, belonging to the country or faction chosen. Recorded into an event with a length, it grows from the first star to the second over the event: an expedition or a fleet on its way.' },
  { id: 'systems', key: 'S', group: 'space', name: 'Star systems', hint: 'On a star map: click a star to give it to the country or faction chosen, from the date viewed (or in the event being recorded); hold Ctrl and drag a box to give every star in it. Their realm glows around the stars they hold.' },
];

/** The tools that work on a space map (D110); the others draw on the surface of a world. */
export const SPACE_TOOLS: string[] = ['select', 'systems', 'lanes'];

/** The tools a map has, in the order of the strip. */
export function toolsFor(w: World, spaceId: string): ToolInfo[] {
  const sp = w.get('map_space', spaceId), space = isSpaceMap(sp);
  return TOOLS.filter((t) => (t.id !== 'sculpt' || terrainSourceOf(sp)) && ((t.id !== 'field' && t.id !== 'disaster') || sp?.kind === 'sphere')
    && (!space || SPACE_TOOLS.includes(t.id)) && ((t.id !== 'systems' && t.id !== 'lanes') || space));
}

/** The tool a plain key takes in hand on a map, if it has one for it. */
export function toolForKey(key: string, w: World, spaceId: string): ToolInfo | null {
  return toolsFor(w, spaceId).find((t) => t.key.toLowerCase() === key.toLowerCase()) ?? null;
}
