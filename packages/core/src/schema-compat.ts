// Schema compatibility and field diff (F-88, F-89). Avro follows the spec's schema-resolution rules;
// JSON Schema uses a pragmatic subset (required properties and property types).
import { namedTypes } from './serdes/avro';
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
  if (s === null || typeof s !== 'object') return 'unknown'; // a field without a type: say so, don't crash the page
  if (typeof s.type === 'string' && ['record', 'enum', 'array', 'map', 'fixed'].includes(s.type))
    return s.type;
  return typeName(s.type as Avro, named);
}

const resolve = (s: Avro, named: Named): Avro =>
  typeof s === 'string' && named.has(s) ? named.get(s)! : s;
const describe = (s: Avro, named: Named): string => {
  const t = typeName(s, named);
  if (t === 'union')
    return (resolve(s, named) as Avro[]).map((x) => describe(x, named)).join(' | ');
  if (t === 'array')
    return `array<${describe((resolve(s, named) as { items: Avro }).items, named)}>`;
  if (t === 'map') return `map<${describe((resolve(s, named) as { values: Avro }).values, named)}>`;
  // a named type shows its name: swapping one record or enum for another isn't "same"
  const r = resolve(s, named);
  if (typeof r === 'object' && r !== null && !Array.isArray(r) && typeof r.name === 'string')
    return `${t} ${r.name.slice(r.name.lastIndexOf('.') + 1)}`;
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
  // named types must match by unqualified name, or a reader alias (spec "Schema Resolution")
  if (['record', 'error', 'enum', 'fixed'].includes(rt)) {
    const bare = (n: unknown) => String(n ?? '').slice(String(n ?? '').lastIndexOf('.') + 1);
    const rName = bare((r as { name?: string }).name),
      wName = bare((w as { name?: string }).name);
    const aliases = ((r as { aliases?: string[] }).aliases ?? []).map(bare);
    if (rName && wName && rName !== wName && !aliases.includes(wName)) {
      out.push(`${path || 'record'}: ${wName} can't be read as ${rName} (names differ, no alias)`);
      return false;
    }
  }
  if (rt === 'record') {
    const rf =
      (r as { fields: Array<{ name: string; type: Avro; default?: unknown; aliases?: string[] }> })
        .fields ?? [];
    const wf = (w as { fields: Array<{ name: string; type: Avro }> }).fields ?? [];
    let ok = true;
    for (const f of rf) {
      // a reader field also matches the writer field named by one of its aliases (Avro resolution)
      const g =
        wf.find((x) => x.name === f.name) ?? wf.find((x) => f.aliases?.includes(x.name) ?? false);
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

/** JSON Schema `type` as a comparable string: ["string","null"] and ["null","string"] are the same type. */
const jtype = (t: unknown): string =>
  t === undefined ? 'any' : Array.isArray(t) ? [...t].sort().join(' | ') : String(t);

/** Does a reader with JSON Schema `type` r accept every value a writer with `type` w allows? (no type = any) */
function accepts(r: unknown, w: unknown): boolean {
  if (r === undefined) return true;
  if (w === undefined) return false;
  const rs = new Set((Array.isArray(r) ? r : [r]).map(String));
  return (Array.isArray(w) ? w : [w]).every(
    (t) => rs.has(String(t)) || (t === 'integer' && rs.has('number')),
  );
}

const NOT_JSON = 'The candidate schema is not valid JSON.';

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
    return { compatible: false, messages: [NOT_JSON] };
  }
  const shape = (x: unknown) =>
    typeof x === 'string' ||
    (Array.isArray(x) && x.length > 0) ||
    (!!x && typeof x === 'object' && !Array.isArray(x));
  if (!shape(n))
    return {
      compatible: false,
      messages: ['An Avro schema must be a JSON object, a type name or a non-empty union array.'],
    };
  // the decoder's name rules: a bare reference resolves in its enclosing namespace first
  const ot = namedTypes(o),
    nt = namedTypes(n);
  o = ot.root;
  n = nt.root;
  const on: Named = ot.named,
    nn: Named = nt.named;
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

type JsonSchema = {
  properties?: Record<string, { type?: string }>;
  required?: string[];
  additionalProperties?: unknown;
};

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
    return { compatible: false, messages: [NOT_JSON] };
  }
  if (
    !o ||
    typeof o !== 'object' ||
    Array.isArray(o) ||
    !n ||
    typeof n !== 'object' ||
    Array.isArray(n)
  )
    return { compatible: false, messages: ['A JSON Schema must be a JSON object.'] };
  const messages: string[] = [];
  const backward = mode.startsWith('BACKWARD') || mode.startsWith('FULL');
  const forward = mode.startsWith('FORWARD') || mode.startsWith('FULL');
  const op = o.properties ?? {},
    np = n.properties ?? {};
  // by direction, as Confluent: widening (integer → number, adding a type) breaks only forward, narrowing only backward
  for (const [k, v] of Object.entries(np)) {
    if (!op[k] || jtype(op[k].type) === jtype(v.type)) continue;
    const change = `${k} changed type from ${jtype(op[k].type)} to ${jtype(v.type)}`;
    if (backward && !accepts(v.type, op[k].type))
      messages.push(`Backward: ${change}, so new consumers reject some old messages.`);
    if (forward && !accepts(op[k].type, v.type))
      messages.push(`Forward: ${change}, so old consumers reject some new messages.`);
  }
  // a closed content model (additionalProperties: false) rejects any property it doesn't list
  if (forward && o.additionalProperties === false)
    for (const k of Object.keys(np))
      if (!op[k])
        messages.push(
          `Forward: ${k} was added, but old consumers reject properties they don't list.`,
        );
  if (backward && n.additionalProperties === false)
    for (const k of Object.keys(op))
      if (!np[k])
        messages.push(
          `Backward: ${k} was removed, but new consumers reject it in old messages that still carry it.`,
        );
  if (backward)
    for (const r of n.required ?? [])
      if (!(o.required ?? []).includes(r))
        messages.push(
          `Backward: ${r} is newly required, so old messages without it fail validation.`,
        );
  if (forward)
    for (const r of o.required ?? [])
      if (!np[r]) messages.push(`Forward: ${r} was removed but old consumers require it.`);
      else if (!(n.required ?? []).includes(r))
        messages.push(`Forward: ${r} is no longer required, but old consumers still require it.`);
  const compatible = mode === 'NONE' || messages.length === 0;
  // say what "compatible" covers: nested objects, items, enums, $ref and oneOf aren't compared
  if (compatible)
    messages.push('Checked top-level properties, their types and required fields only.');
  return { compatible, messages };
}

export function checkCompatibility(
  type: 'AVRO' | 'JSON' | 'PROTOBUF',
  oldSchema: string,
  newSchema: string,
  mode: SubjectSummary['compatibility'],
): CompatibilityResult {
  if (mode === 'NONE') {
    // NONE accepts any valid schema, but the registry still refuses one it can't parse
    if (type !== 'PROTOBUF')
      try {
        JSON.parse(newSchema);
      } catch {
        return { compatible: false, messages: [NOT_JSON] };
      }
    return {
      compatible: true,
      messages: ['Compatibility is NONE for this subject; any schema is accepted.'],
    };
  }
  if (type === 'AVRO') {
    try {
      return avroCheck(oldSchema, newSchema, mode);
    } catch (e) {
      // a shape the checker doesn't expect is an invalid schema, not a crash message
      return {
        compatible: false,
        messages: [`The candidate isn't a valid Avro schema (${(e as Error).message}).`],
      };
    }
  }
  if (type === 'JSON') return jsonCheck(oldSchema, newSchema, mode);
  return {
    compatible: false,
    checked: false,
    messages: ['Not checked: Protobuf compatibility checks are planned for v2.'],
  };
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
  if (type === 'PROTOBUF') return []; // .proto source: no field diff in v1
  const fields = (s: string): Array<{ name: string; type: string; hasDefault: boolean }> => {
    let j;
    try {
      j = JSON.parse(s) ?? {};
    } catch {
      return []; // a version that isn't valid JSON can't be diffed (and mustn't crash the page)
    }
    if (type === 'AVRO') {
      const { root, named } = namedTypes(j);
      j = root;
      return ((j.fields ?? []) as Array<{ name: string; type: Avro; default?: unknown }>).map(
        (f) => ({ name: f.name, type: describe(f.type, named), hasDefault: 'default' in f }),
      );
    }
    return Object.entries((j.properties ?? {}) as Record<string, { type?: unknown }>).map(
      ([name, v]) => ({
        name,
        type: jtype(v.type),
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
