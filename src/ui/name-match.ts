// Filters of lists by name (D199).

/** Whether a name answers what is typed in a list's filter (every word of it, in any order, whatever the case). */
export function nameMatches(name: string, filter: string): boolean {
  const n = name.toLowerCase();
  return filter.toLowerCase().split(/\s+/).filter(Boolean).every((word) => n.includes(word));
}
