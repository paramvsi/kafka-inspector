// Message decoding (ARCHITECTURE "Serdes"). Runs in the browser in both modes. Never throws into the UI:
// failures come back as values with an annotated hex dump (F-46).
import type { SchemaVersion } from '../types';
import { AvroType, namedTypes } from './avro';

export type DecodeAs =
  | 'auto'
  | 'json'
  | 'text'
  | 'hex'
  | 'base64'
  | 'avro'
  | 'json-schema'
  | 'int32'
  | 'int64'
  | 'double'
  | 'uuid';
export const DECODE_OPTIONS: Array<{ value: DecodeAs; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'avro', label: 'Avro (registry)' },
  { value: 'json-schema', label: 'JSON Schema (registry)' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
  { value: 'int32', label: 'Int32' },
  { value: 'int64', label: 'Int64' },
  { value: 'double', label: 'Double' },
  { value: 'uuid', label: 'UUID' },
];

export interface Annotation {
  start: number;
  end: number;
  label: string;
}

export interface Decoded {
  ok: true;
  format: 'avro' | 'json-schema' | 'json' | 'text' | 'hex' | 'base64' | 'number' | 'uuid' | 'null';
  value: unknown;
  /** single-line preview */
  text: string;
  schema?: { id: number; subject: string; version: number };
}

export interface DecodeFailure {
  ok: false;
  reason: string;
  detail: string;
  /** what the decoder tried, e.g. "Avro" */
  tried: string;
  hex: string;
  annotations: Annotation[];
  schemaId?: number;
  /** the registry schema that was found but didn't decode the bytes (absent when the id is unknown) */
  schema?: { id: number; subject: string; version: number };
}

export type DecodeResult = Decoded | DecodeFailure;
export type SchemaLookup = (id: number) => Promise<SchemaVersion | undefined>;

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Caches registry lookups by id. A miss (unknown id, or the registry failing) is remembered for 30 s, so a
 * poison message doesn't hit the registry per row, yet a transient error doesn't stick until reload.
 */
const MISS_TTL_MS = 30_000;

export function cachedLookup(
  fetchById: (id: number) => Promise<SchemaVersion>,
  now: () => number = Date.now,
): SchemaLookup {
  const cache = new Map<number, { p: Promise<SchemaVersion | undefined>; missAt?: number }>();
  return (id) => {
    const hit = cache.get(id);
    if (hit && (hit.missAt === undefined || now() - hit.missAt < MISS_TTL_MS)) return hit.p;
    const entry: { p: Promise<SchemaVersion | undefined>; missAt?: number } = {
      p: fetchById(id).catch(() => {
        entry.missAt = now();
        return undefined;
      }),
    };
    cache.set(id, entry);
    return entry.p;
  };
}

export const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// numbers via String: JSON.stringify would show NaN / Infinity (valid doubles) as "null"
const preview = (v: unknown) =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v);
const ok = (format: Decoded['format'], value: unknown, schema?: Decoded['schema']): Decoded => ({
  ok: true,
  format,
  value,
  text: preview(value),
  schema,
});

function fail(
  bytes: Uint8Array,
  tried: string,
  reason: string,
  detail: string,
  extra: Partial<DecodeFailure> = {},
): DecodeFailure {
  return { ok: false, tried, reason, detail, hex: toHex(bytes), annotations: [], ...extra };
}

function isPrintable(s: string): boolean {
  let bad = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffd) bad++;
  }
  return bad === 0;
}

/** Avro logical types → display values (timestamp-millis → ISO, bytes → base64), through unions, maps and named types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = any;
/** Exported for tests. */
export function logicalDisplay(schema: AnySchema, v: unknown): unknown {
  // the decoder's own name rules: a bare reference resolves in its enclosing namespace first
  const { root, named } = namedTypes(schema);
  const resolve = (s: AnySchema): AnySchema =>
    typeof s === 'string' && named.has(s) ? named.get(s) : s;
  // the union branch the decoder took, recovered from the value's runtime type
  const branch = (u: AnySchema[], x: unknown): AnySchema => {
    const kind = (b: AnySchema): string => {
      const r = resolve(b);
      return typeof r === 'string' ? r : typeof r.type === 'string' ? r.type : kind(r.type);
    };
    return (
      pickRecord(u, x) ??
      u.find((b) => {
        const k = kind(b);
        if (x instanceof Uint8Array) return k === 'bytes' || k === 'fixed';
        if (Array.isArray(x)) return k === 'array';
        if (typeof x === 'number') return ['int', 'long', 'float', 'double'].includes(k);
        if (typeof x === 'string') return k === 'string' || k === 'enum' || k === 'long';
        if (typeof x === 'boolean') return k === 'boolean';
        return k === 'record' || k === 'error' || k === 'map';
      })
    );
  };
  // several record branches: the one whose field names are the value's keys (the first match lost RecB's fields)
  const pickRecord = (u: AnySchema[], x: unknown): AnySchema | undefined => {
    if (!x || typeof x !== 'object' || Array.isArray(x) || x instanceof Uint8Array)
      return undefined;
    const keys = Object.keys(x).sort().join('|');
    return u.find((b) => {
      const r = resolve(b);
      return (
        r &&
        typeof r === 'object' &&
        Array.isArray(r.fields) &&
        (r.fields as Array<{ name: string }>)
          .map((f) => f.name)
          .sort()
          .join('|') === keys
      );
    });
  };
  const walk = (schema: AnySchema, x: AnySchema): unknown => {
    if (x === null || x === undefined) return x;
    const s = resolve(schema);
    if (Array.isArray(s)) {
      const b = branch(s, x);
      return b === undefined ? x : walk(b, x);
    }
    if (s && typeof s === 'object') {
      // beyond ±8.64e15 ms a Date is invalid: show the number rather than fail the whole record
      if (s.logicalType === 'timestamp-millis' && typeof x === 'number')
        return Number.isNaN(new Date(x).getTime())
          ? x
          : new Date(x).toISOString().replace('.000Z', 'Z');
      if (s.type === 'record' || s.type === 'error')
        return Object.fromEntries(
          s.fields.map((f: { name: string; type: unknown }) => [f.name, walk(f.type, x[f.name])]),
        );
      if (s.type === 'array') return x.map((y: unknown) => walk(s.items, y));
      if (s.type === 'map')
        return Object.fromEntries(
          Object.entries(x as Record<string, unknown>).map(([k, y]) => [k, walk(s.values, y)]),
        );
      if (typeof s.type === 'object') return walk(s.type, x);
    }
    if (x instanceof Uint8Array) return toBase64(x);
    return x;
  };
  return walk(root, v);
}

async function viaRegistry(
  bytes: Uint8Array,
  lookup: SchemaLookup,
  expect?: 'AVRO' | 'JSON',
): Promise<DecodeResult> {
  const id = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(1, false);
  const annotations: Annotation[] = [
    { start: 0, end: 1, label: 'magic byte' },
    { start: 1, end: 5, label: `schema id (${id})` },
  ];
  const tried = expect === 'JSON' ? 'JSON Schema' : 'Avro';
  const schema = await lookup(id);
  if (!schema) {
    return fail(
      bytes,
      tried,
      `Couldn't decode the value as ${tried}`,
      `The message says schema id ${id}, but the registry has no schema with that id. It may have been deleted, or the producer used a different registry.`,
      { annotations, schemaId: id },
    );
  }
  const meta = { id, subject: schema.subject, version: schema.version };
  const payload = bytes.subarray(5);
  if (schema.type === 'AVRO') {
    try {
      const type = AvroType.parse(schema.schema);
      return ok('avro', logicalDisplay(type.schema, type.decode(payload)), meta);
    } catch (e) {
      return fail(
        bytes,
        'Avro',
        "Couldn't decode the value as Avro",
        `${schema.subject} v${schema.version} (id ${id}) doesn't match the bytes: ${(e as Error).message}.`,
        { annotations, schemaId: id, schema: meta },
      );
    }
  }
  if (schema.type === 'JSON') {
    try {
      return ok('json-schema', parseJson(utf8.decode(payload)), meta);
    } catch {
      return fail(
        bytes,
        'JSON Schema',
        "Couldn't decode the value as JSON",
        `The payload after the 5-byte header is not valid JSON (schema ${schema.subject} v${schema.version}).`,
        { annotations, schemaId: id, schema: meta },
      );
    }
  }
  return fail(
    bytes,
    'Protobuf',
    'Protobuf decoding is not supported yet',
    'Protobuf arrives in v2. Use Hex or Base64 to inspect the bytes.',
    { annotations, schemaId: id, schema: meta },
  );
}

/** `lookup` is undefined when the cluster has no Schema Registry. */
/**
 * JSON.parse, but an integer JSON can't hold exactly (a 64-bit id such as 12345678901234567890) keeps its original
 * digits as a string instead of silently becoming 12345678901234567000. Uses the parser's source text where the
 * runtime offers it (V8 11.4+); elsewhere it's plain JSON.parse.
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text, function (_k, v, ctx?: { source?: string }) {
    if (
      typeof v === 'number' &&
      ctx?.source &&
      /^-?\d+$/.test(ctx.source) &&
      !Number.isSafeInteger(v)
    )
      return ctx.source;
    return v;
  } as (this: unknown, k: string, v: unknown) => unknown);
}

export async function decode(
  bytes: Uint8Array | null,
  as: DecodeAs,
  lookup: SchemaLookup | undefined,
): Promise<DecodeResult> {
  if (bytes === null) return ok('null', null);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (as) {
    case 'hex':
      return ok('hex', toHex(bytes));
    case 'base64':
      return ok('base64', toBase64(bytes));
    case 'int32':
      return bytes.length === 4
        ? ok('number', dv.getInt32(0, false))
        : fail(
            bytes,
            'Int32',
            "Couldn't decode as Int32",
            `Int32 needs exactly 4 bytes; this has ${bytes.length}.`,
          );
    case 'int64':
      return bytes.length === 8
        ? ok('number', dv.getBigInt64(0, false).toString())
        : fail(
            bytes,
            'Int64',
            "Couldn't decode as Int64",
            `Int64 needs exactly 8 bytes; this has ${bytes.length}.`,
          );
    case 'double':
      return bytes.length === 8
        ? ok('number', dv.getFloat64(0, false))
        : fail(
            bytes,
            'Double',
            "Couldn't decode as Double",
            `Double needs exactly 8 bytes; this has ${bytes.length}.`,
          );
    case 'uuid': {
      if (bytes.length === 16) {
        const h = toHex(bytes).replaceAll(' ', '');
        return ok(
          'uuid',
          `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
        );
      }
      try {
        const s = utf8.decode(bytes);
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))
          return ok('uuid', s.toLowerCase());
      } catch {
        /* fall through */
      }
      return fail(
        bytes,
        'UUID',
        "Couldn't decode as UUID",
        'A UUID is 16 bytes or a 36-character string.',
      );
    }
    case 'avro':
    case 'json-schema':
      if (bytes.length < 5 || bytes[0] !== 0) {
        return fail(
          bytes,
          as === 'avro' ? 'Avro' : 'JSON Schema',
          'No Schema Registry header',
          'Registry-encoded messages start with byte 0x00 followed by a 4-byte schema id. This one does not.',
          { annotations: [{ start: 0, end: 1, label: 'expected 0x00' }] },
        );
      }
      if (!lookup)
        return fail(
          bytes,
          as === 'avro' ? 'Avro' : 'JSON Schema',
          'No Schema Registry configured',
          'This cluster has no Schema Registry, so registry-encoded values can’t be decoded. Configure KI_CLUSTERS_n_SCHEMA_REGISTRY, or pick another format.',
        );
      return viaRegistry(bytes, lookup, as === 'avro' ? 'AVRO' : 'JSON');
    case 'json':
      try {
        return ok('json', parseJson(utf8.decode(bytes)));
      } catch {
        return fail(
          bytes,
          'JSON',
          "Couldn't decode as JSON",
          'The bytes are not valid UTF-8 JSON.',
        );
      }
    case 'text':
      try {
        return ok('text', utf8.decode(bytes));
      } catch {
        return fail(bytes, 'Text', "Couldn't decode as text", 'The bytes are not valid UTF-8.');
      }
    case 'auto': {
      // a leading 0x00 is a registry frame only if the registry knows the id; otherwise it's just data
      // (e.g. an int64 key 00 00 … 05). Choosing Avro explicitly still explains the unknown id.
      if (lookup && bytes.length >= 5 && bytes[0] === 0) {
        const r = await viaRegistry(bytes, lookup);
        if (r.ok || r.schema) return r;
      }
      let s: string;
      try {
        s = utf8.decode(bytes);
      } catch {
        return ok('hex', toHex(bytes));
      }
      const t = s.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try {
          return ok('json', parseJson(t));
        } catch {
          /* not JSON; maybe text */
        }
      }
      return isPrintable(s) ? ok('text', s) : ok('hex', toHex(bytes));
    }
  }
}

export interface HexLine {
  offset: number;
  bytes: number[];
  ascii: string;
}

/** 16 bytes per line with printable ASCII alongside. */
export function hexDump(bytes: Uint8Array, perLine = 16): HexLine[] {
  const lines: HexLine[] = [];
  for (let i = 0; i < bytes.length; i += perLine) {
    const chunk = Array.from(bytes.subarray(i, i + perLine));
    lines.push({
      offset: i,
      bytes: chunk,
      ascii: chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join(''),
    });
  }
  return lines;
}
