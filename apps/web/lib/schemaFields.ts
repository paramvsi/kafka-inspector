import type { SchemaVersion } from '@ki/core';

export type Field = { name: string; line: string };

export function fieldsOf(v: SchemaVersion): Field[] {
  // Protobuf sources aren't JSON (and the compat check says "not checked"): no field table, not a crash
  if (v.type === 'PROTOBUF')
    return v.schema.split('\n').map((line, i) => ({ name: String(i + 1), line }));
  let j: Record<string, unknown> | null;
  try {
    j = JSON.parse(v.schema);
  } catch {
    return [{ name: '(source)', line: v.schema }];
  }
  if (!j || typeof j !== 'object') return [{ name: '(type)', line: v.schema }];
  if (v.type === 'AVRO') {
    if (!j.fields) return [{ name: '(type)', line: JSON.stringify(j) }];
    return (j.fields as Array<Record<string, unknown>>).map((f) => {
      const t =
        typeof f.type === 'object' && !Array.isArray(f.type)
          ? JSON.stringify({ type: (f.type as { type: string }).type, '…': '' }).replace(
              ',"…":""',
              ',…',
            )
          : JSON.stringify(f.type);
      return {
        name: String(f.name),
        line: `{ "name": "${f.name}", "type": ${t}${'default' in f ? `, "default": ${JSON.stringify(f.default)}` : ''} }`,
      };
    });
  }
  return Object.entries((j.properties ?? {}) as Record<string, unknown>).map(([k, p]) => ({
    name: k,
    line: `"${k}": ${JSON.stringify(p)}${((j.required ?? []) as string[]).includes(k) ? '  required' : ''}`,
  }));
}
