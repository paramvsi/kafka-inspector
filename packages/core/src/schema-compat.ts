// Schema compatibility and field diff (F-88, F-89). Avro follows the spec's schema-resolution rules;
// JSON Schema uses a pragmatic subset (required properties and property types).
import type { CompatibilityResult, SubjectSummary } from './types';

// Parsed Avro schema JSON: deliberately loose (any) — it is walked structurally and checked at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Avro = any;
type Named = Map<string, Avro>;

const PROMOTIONS: Record<string, string[]> = {
  int: ['long', 'float', 'double'],
  long: ['float', 'double'],
  float: ['double'],
  string: ['bytes'],
  bytes: ['string'],
};

function typeName(s: Avro, named: Named): string {
  if (typeof s === 'string') return named.has(s) ? typeName(named.get(s)!, named) : s;
  if (Array.isArray(s)) return 'union';
  if (typeof s.type === 'string' && ['record', 'enum', 'array', 'map', 'fixed'].includes(s.type))
    return s.type;
  return typeName(s.type as Avro, named);
}

/** Registers named types under their bare and full names; nested types inherit the namespace (spec "Names"). */
function collect(s: Avro, named: Named, ns = ''): void {
  if (typeof s === 'string') return;
  if (Array.isArray(s)) return s.forEach((x) => collect(x, named, ns));
  let inner = ns;
  if (typeof s.name === 'string' && ['record', 'error', 'enum', 'fixed'].includes(String(s.type))) {
    const space = s.name.includes('.')
      ? s.name.slice(0, s.name.lastIndexOf('.'))
      : typeof s.namespace === 'string'
        ? s.namespace
        : ns;
    const bare = s.name.slice(s.name.lastIndexOf('.') + 1);
    named.set(bare, s);
    if (space) named.set(`${space}.${bare}`, s);
    inner = space;
  }
  if (Array.isArray(s.fields))
    (s.fields as Array<{ type: Avro }>).forEach((f) => collect(f.type, named, inner));
  if (s.items) collect(s.items as Avro, named, inner);
  if (s.values) collect(s.values as Avro, named, inner);
  if (typeof s.type !== 'string') collect(s.type as Avro, named, inner);
}

const resolve = (s: Avro, named: Named): Avro =>
  typeof s === 'string' && named.has(s) ? named.get(s)! : s;
const describe = (s: Avro, named: Named): string => {
  const t = typeName(s, named);
  if (t === 'union')
    return (resolve(s, named) as Avro[]).map((x) => describe(x, named)).join(' | ');
  if (t === 'array')
    return `array<${describe((resolve(s, named) as { items: Avro }).items, named)}>`;
  return t;
};

const ids = new WeakMap<object, number>();
let nextId = 0;
const seenId = (o: object): number => {
  if (!ids.has(o)) ids.set(o, ++nextId);
  return ids.get(o)!;
};

/** Can data written with `writer` be read with `reader`? Problems are appended to `out`. */
function canRead(
  reader: Avro,
  writer: Avro,
  rn: Named,
  wn: Named,
  path: string,
  out: string[],
  seen = new Set<Avro>(),
): boolean {
  const r = resolve(reader, rn),
    w = resolve(writer, wn);
  // recursive types (e.g. a linked-list Node): a pair already on the stack is assumed fine
  const pair = typeof r === 'object' && typeof w === 'object' ? `${seenId(r)}|${seenId(w)}` : '';
  if (pair && seen.has(pair)) return true;
  if (!pair) return check(r, w, rn, wn, path, out, seen);
  seen.add(pair);
  try {
    return check(r, w, rn, wn, path, out, seen);
  } finally {
    seen.delete(pair);
  }
}

function check(
  r: Avro,
  w: Avro,
  rn: Named,
  wn: Named,
  path: string,
  out: string[],
  seen: Set<Avro>,
): boolean {
  const rt = typeName(r, rn),
    wt = typeName(w, wn);
  if (wt === 'union') return (w as Avro[]).every((b) => canRead(r, b, rn, wn, path, out, seen));
  if (rt === 'union') {
    if ((r as Avro[]).some((b) => canRead(b, w, rn, wn, path, [], seen))) return true;
    out.push(`${path}: ${describe(w, wn)} is not in the reader's union ${describe(r, rn)}`);
    return false;
  }
  if (rt !== wt && !(PROMOTIONS[wt] ?? []).includes(rt)) {
    out.push(`${path}: ${wt} can't be read as ${rt}`);
    return false;
  }
  if (rt === 'record') {
    const rf =
      (r as { fields: Array<{ name: string; type: Avro; default?: unknown }> }).fields ?? [];
    const wf = (w as { fields: Array<{ name: string; type: Avro }> }).fields ?? [];
    let ok = true;
    for (const f of rf) {
      const g = wf.find((x) => x.name === f.name);
      if (g)
        ok = canRead(f.type, g.type, rn, wn, path ? `${path}.${f.name}` : f.name, out, seen) && ok;
      else if (!('default' in f)) {
        out.push(
          `${path ? `${path}.` : ''}${f.name} is missing in the writer's schema and has no default`,
        );
        ok = false;
      }
    }
    return ok;
  }
  if (rt === 'enum') {
    const rs = (r as { symbols: string[]; default?: string }).symbols;
    const missing = (w as { symbols: string[] }).symbols.filter((x) => !rs.includes(x));
    if (missing.length && !(r as { default?: string }).default) {
      out.push(`${path}: enum symbols ${missing.join(', ')} are unknown to the reader`);
      return false;
    }
  }
  if (rt === 'fixed' && (r as { size: number }).size !== (w as { size: number }).size) {
    out.push(
      `${path}: fixed size ${(w as { size: number }).size} can't be read as size ${(r as { size: number }).size}`,
    );
    return false;
  }
  if (rt === 'array')
    return canRead(
      (r as { items: Avro }).items,
      (w as { items: Avro }).items,
      rn,
      wn,
      `${path}[]`,
      out,
      seen,
    );
  if (rt === 'map')
    return canRead(
      (r as { values: Avro }).values,
      (w as { values: Avro }).values,
      rn,
      wn,
      `${path}{}`,
      out,
      seen,
    );
  return true;
}

function avroCheck(
  oldSchema: string,
  newSchema: string,
  mode: SubjectSummary['compatibility'],
): CompatibilityResult {
  let o: Avro, n: Avro;
  try {
    o = JSON.parse(oldSchema);
    n = JSON.parse(newSchema);
  } catch {
    return { compatible: false, messages: ['The candidate schema is not valid JSON.'] };
  }
  const on: Named = new Map(),
    nn: Named = new Map();
  collect(o, on);
  collect(n, nn);
  const messages: string[] = [];
  const backward = mode.startsWith('BACKWARD') || mode.startsWith('FULL');
  const forward = mode.startsWith('FORWARD') || mode.startsWith('FULL');
  let ok = true;
  if (backward) {
    const out: string[] = [];
    if (!canRead(n, o, nn, on, '', out)) ok = false;
    messages.push(...out.map((m) => `Backward: new consumers can't read old messages — ${m}.`));
  }
  if (forward) {
    const out: string[] = [];
    if (!canRead(o, n, on, nn, '', out)) ok = false;
    messages.push(...out.map((m) => `Forward: old consumers can't read new messages — ${m}.`));
  }
  return { compatible: ok, messages };
}

type JsonSchema = { properties?: Record<string, { type?: string }>; required?: string[] };

function jsonCheck(
  oldSchema: string,
  newSchema: string,
  mode: SubjectSummary['compatibility'],
): CompatibilityResult {
  let o: JsonSchema, n: JsonSchema;
  try {
    o = JSON.parse(oldSchema);
    n = JSON.parse(newSchema);
  } catch {
    return { compatible: false, messages: ['The candidate schema is not valid JSON.'] };
  }
  const messages: string[] = [];
  const backward = mode.startsWith('BACKWARD') || mode.startsWith('FULL');
  const forward = mode.startsWith('FORWARD') || mode.startsWith('FULL');
  const op = o.properties ?? {},
    np = n.properties ?? {};
  for (const [k, v] of Object.entries(np)) {
    if (op[k] && op[k].type !== v.type)
      messages.push(`${k} changed type from ${op[k].type} to ${v.type}.`);
  }
  if (backward)
    for (const r of n.required ?? [])
      if (!(o.required ?? []).includes(r))
        messages.push(
          `Backward: ${r} is newly required, so old messages without it fail validation.`,
        );
  if (forward)
    for (const r of o.required ?? [])
      if (!np[r]) messages.push(`Forward: ${r} was removed but old consumers require it.`);
  return { compatible: mode === 'NONE' || messages.length === 0, messages };
}

export function checkCompatibility(
  type: 'AVRO' | 'JSON' | 'PROTOBUF',
  oldSchema: string,
  newSchema: string,
  mode: SubjectSummary['compatibility'],
): CompatibilityResult {
  if (mode === 'NONE')
    return {
      compatible: true,
      messages: ['Compatibility is NONE for this subject; any schema is accepted.'],
    };
  if (type === 'AVRO') return avroCheck(oldSchema, newSchema, mode);
  if (type === 'JSON') return jsonCheck(oldSchema, newSchema, mode);
  return { compatible: false, messages: ['Protobuf compatibility checks are planned for v2.'] };
}

export interface FieldChange {
  field: string;
  change: 'added' | 'removed' | 'changed' | 'same';
  from?: string;
  to?: string;
  hasDefault?: boolean;
}

/** Top-level field diff between two versions (Avro record fields or JSON Schema properties). */
export function diffFields(
  type: 'AVRO' | 'JSON' | 'PROTOBUF',
  oldSchema: string,
  newSchema: string,
): FieldChange[] {
  const fields = (s: string): Array<{ name: string; type: string; hasDefault: boolean }> => {
    const j = JSON.parse(s);
    if (type === 'AVRO') {
      const named: Named = new Map();
      collect(j, named);
      return ((j.fields ?? []) as Array<{ name: string; type: Avro; default?: unknown }>).map(
        (f) => ({ name: f.name, type: describe(f.type, named), hasDefault: 'default' in f }),
      );
    }
    return Object.entries((j.properties ?? {}) as Record<string, { type?: string }>).map(
      ([name, v]) => ({
        name,
        type: v.type ?? 'any',
        hasDefault: !(j.required ?? []).includes(name),
      }),
    );
  };
  const a = fields(oldSchema),
    b = fields(newSchema);
  const out: FieldChange[] = [];
  for (const f of b) {
    const g = a.find((x) => x.name === f.name);
    if (!g) out.push({ field: f.name, change: 'added', to: f.type, hasDefault: f.hasDefault });
    else
      out.push({
        field: f.name,
        change: g.type === f.type ? 'same' : 'changed',
        from: g.type,
        to: f.type,
        hasDefault: f.hasDefault,
      });
  }
  for (const g of a)
    if (!b.some((f) => f.name === g.name))
      out.push({ field: g.name, change: 'removed', from: g.type, hasDefault: g.hasDefault });
  return out;
}
