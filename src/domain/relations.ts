// Kinds of relationship between entities (Stage 4, D72): what each means and how it reads from either
// side. A relationship holds over periods given by dated changes (temporal-engine RelateIntent).

export type RelationKind = 'war' | 'alliance' | 'part' | 'vassal' | 'member' | 'leads' | 'successor' | 'travels';

export interface RelationKindInfo {
  id: RelationKind;
  /** The same both ways (at war, allied). */
  mutual: boolean;
  /** How it reads from the first party, and from the second ("A is part of B" / "B has as a part A"). */
  fromA: string;
  fromB: string;
  /** In a sentence with both: "A is at war with B". */
  sentence: string;
  /** What it is used for (shown when choosing). */
  hint: string;
}

export const RELATION_KINDS: RelationKindInfo[] = [
  { id: 'war', mutual: true, fromA: 'at war with', fromB: 'at war with', sentence: 'is at war with', hint: 'Hostility between two countries or factions (front lines will follow it, Stage 7).' },
  { id: 'alliance', mutual: true, fromA: 'allied with', fromB: 'allied with', sentence: 'is allied with', hint: 'An alliance, a treaty of friendship, a union of crowns.' },
  { id: 'part', mutual: false, fromA: 'part of', fromB: 'has as a part', sentence: 'is part of', hint: 'A province, a member state, a part of a larger whole.' },
  { id: 'vassal', mutual: false, fromA: 'vassal of', fromB: 'overlord of', sentence: 'is a vassal of', hint: 'A vassal, a client state, a protectorate, a puppet.' },
  { id: 'member', mutual: false, fromA: 'member of', fromB: 'has as a member', sentence: 'is a member of', hint: 'A character in a faction, an army, a dynasty.' },
  { id: 'leads', mutual: false, fromA: 'leads', fromB: 'led by', sentence: 'leads', hint: 'A ruler, a commander, the head of a faction.' },
  { id: 'successor', mutual: false, fromA: 'successor of', fromB: 'succeeded by', sentence: 'is the successor of', hint: 'Lineage when states merge, split or are renamed.' },
  { id: 'travels', mutual: false, fromA: 'travels with', fromB: 'accompanied by', sentence: 'travels with', hint: 'A character attached to an army, a ship, a caravan.' },
];

export const relationKind = (id: string): RelationKindInfo | undefined => RELATION_KINDS.find((k) => k.id === id);
export const isRelationKind = (id: string): id is RelationKind => RELATION_KINDS.some((k) => k.id === id);

/** How a relationship reads from one of its parties: the words, and the other party. */
export function relationFrom(r: { kind: string; a: string; b: string }, entity: string): { words: string; other: string } {
  const k = relationKind(r.kind);
  if (r.a === entity) return { words: k?.fromA ?? r.kind, other: r.b };
  return { words: k?.fromB ?? r.kind, other: r.a };
}
