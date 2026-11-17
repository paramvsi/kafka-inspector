import type { FieldChange } from '@ki/core';
import type { Field } from './schemaFields';

type Row = { left?: Field; right?: Field; kind: FieldChange['change'] };

/**
 * Rows for the side-by-side diff, in the older version's order. Every field of the newer version appears exactly
 * once: one that moved earlier isn't repeated, and one that only the newer version has (an added field, or a
 * source line past the older one's end — Protobuf has no field diff) shows as added.
 */
export function align(a: Field[], b: Field[], changes: FieldChange[]): Row[] {
  const kind = (n: string) => changes.find((c) => c.field === n)?.change ?? 'same';
  const inA = new Set(a.map((f) => f.name));
  const shown = new Set<number>();
  const rows: Row[] = [];
  const rightOnly = (k: number) => {
    shown.add(k);
    rows.push({ right: b[k], kind: inA.has(b[k]!.name) ? kind(b[k]!.name) : 'added' });
  };
  for (const f of a) {
    const at = b.findIndex((x) => x.name === f.name);
    if (kind(f.name) === 'removed' || at < 0) {
      rows.push({ left: f, kind: 'removed' });
      continue;
    }
    for (let k = 0; k < at; k++) if (!shown.has(k) && !inA.has(b[k]!.name)) rightOnly(k);
    shown.add(at);
    rows.push({ left: f, right: b[at], kind: kind(f.name) });
  }
  for (let k = 0; k < b.length; k++) if (!shown.has(k)) rightOnly(k);
  return rows;
}
