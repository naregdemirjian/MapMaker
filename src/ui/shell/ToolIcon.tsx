// The tools' icons (D198): plain line drawings, coloured as the text around them.
import type { Tool } from '../store.ts';

export const TOOL_ICONS: Record<Tool, string> = {
  select: '<path d="M5 3l12 9-6 1-3 6z"/>',
  lasso: '<path d="M4 20c3 0 4-2 4-4l9-11 3 3-11 9c-2 0-3 1-5 3z"/>',
  polygon: '<path d="M5 6l9-2 6 8-7 8-8-4z"/><circle cx="5" cy="6" r="1.4"/><circle cx="14" cy="4" r="1.4"/><circle cx="20" cy="12" r="1.4"/><circle cx="13" cy="20" r="1.4"/><circle cx="5" cy="16" r="1.4"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16zM14 7l3 3"/>',
  vertex: '<path d="M5 18L11 6l8 9"/><circle cx="5" cy="18" r="1.8"/><circle cx="11" cy="6" r="1.8"/><circle cx="19" cy="15" r="1.8"/>',
  split: '<path d="M6 4h12v16H6z"/><path d="M3 15L21 8" stroke-dasharray="3 2.5"/>',
  regions: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  reach: '<path d="M7 3v18" stroke-dasharray="2.5 2.5"/><path d="M3 12h15M14 8l4 4-4 4"/>',
  erase: '<path d="M4 16l9-9 6 6-6 6H8zM9 11l5 5M11 20h9"/>',
  feature: '<path d="M4 17c4-10 8 3 15-9"/><path d="M15 7l4 1-1 4"/><circle cx="6" cy="7" r="1.8"/>',
  place: '<path d="M12 21s6-6 6-11a6 6 0 10-12 0c0 5 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
  sculpt: '<path d="M3 19l6-10 4 6 3-4 5 8z"/>',
  disaster: '<path d="M13 3L6 13h5l-1 8 8-11h-5z"/>',
  field: '<path d="M12 4c3 4 5 6 5 10a5 5 0 01-10 0c0-2 1-3 2-5 1 2 2 2 2 2 0-3 0-5 1-7z"/>',
  lanes: '<circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M7 16l10-8"/>',
  systems: '<path d="M12 4l2 5 5 1-4 3 1 6-4-3-4 3 1-6-4-3 5-1z"/>',
  'draw-pen': '<path d="M12 3l5.5 8.5L12 21l-5.5-9.5z"/><circle cx="12" cy="11.5" r="1.6"/><path d="M12 3v7"/>',
  shape: '<rect x="3.5" y="4" width="10" height="8" rx="0.5"/><ellipse cx="15" cy="15" rx="5.5" ry="4.5"/>',
};

// (One object per icon, kept: given a new one at every drawing, React would put the icon's drawing in again,
// and a click whose press landed on the old drawing would be lost.)
const HTML = Object.fromEntries(Object.entries(TOOL_ICONS).map(([id, html]) => [id, { __html: html }])) as Record<Tool, { __html: string }>;

export function ToolIcon({ id, size = 18 }: { id: Tool; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" dangerouslySetInnerHTML={HTML[id]} />;
}
