// The planetary state's fields (Stage 14, D152): every quantity the engine keeps per cell, with its unit, its
// storage (type and, for checkpoints and products, how finely it is kept) and what it means. Stages add their
// fields here as they arrive; the codec (codec.ts) stores any of them.
import type { FieldArray, FieldOut, FieldType } from './codec.ts';

export interface FieldSpec {
  type: FieldType;
  unit: string;
  /** Values per cell (12 for monthly fields). */
  perCell?: number;
  /** How finely the field is kept in files (see codec.ts); lossless when absent. */
  quantum?: number;
  about: string;
}

export const FIELDS = {
  insolation: { type: 'f32', unit: 'W/m²', quantum: 0.01, about: 'Sunlight at the top of the air, averaged over the year and over the planet\'s turning.' },
  insolationMonthly: { type: 'f32', unit: 'W/m²', perCell: 12, quantum: 0.01, about: 'Sunlight at the top of the air in each twelfth of the year (from Earth\'s 1 January on Earth-like orbits).' },
} satisfies Record<string, FieldSpec>;

export type FieldName = keyof typeof FIELDS;

/** A field as the codec writes it, by its specification. */
export function fieldOut(name: FieldName, data: FieldArray): FieldOut {
  const spec: FieldSpec = FIELDS[name];
  return { name, data, unit: spec.unit, ...(spec.quantum !== undefined ? { quantum: spec.quantum } : {}) };
}
