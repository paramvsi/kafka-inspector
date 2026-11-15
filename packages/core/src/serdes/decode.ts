// Message decoding (ARCHITECTURE "Serdes"). Runs in the browser in both modes. Never throws into the UI:
// failures come back as values with an annotated hex dump (F-46).
import type { SchemaVersion } from '../types';
import { AvroType } from './avro';

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
}

export type DecodeResult = Decoded | DecodeFailure;
export type SchemaLookup = (id: number) => Promise<SchemaVersion | undefined>;

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Caches registry lookups by id. A miss (unknown id, or the registry failing) is remembered for 30 s, so a
 * poison message doesn't hit the registry per row, yet a transient error doesn't stick until reload.
 */
export function cachedLookup(
  fetchById: (id: number) => Promise<SchemaVersion>,
  now: () => number = Date.now,
  missTtlMs = 30_000,
): SchemaLookup {
  const cache = new Map<number, { p: Promise<SchemaVersion | undefined>; missAt?: number }>();
  return (id) => {
    const hit = cache.get(id);
    if (hit && (hit.missAt === undefined || now() - hit.missAt < missTtlMs)) return hit.p;
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

const preview = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
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

/** Avro logical types → display values (timestamp-millis → ISO). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logical(schema: any, v: any): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(schema)) return v; // union branch already resolved; logical types inside unions are rare here
  if (schema && typeof schema === 'object') {
    if (schema.logicalType === 'timestamp-millis' && typeof v === 'number')
      return new Date(v).toISOString().replace('.000Z', 'Z');
    if (schema.type === 'record')
      return Object.fromEntries(
        schema.fields.map((f: { name: string; type: unknown }) => [
          f.name,
          logical(f.type, v[f.name]),
        ]),
      );
    if (schema.type === 'array') return v.map((x: unknown) => logical(schema.items, x));
    if (typeof schema.type === 'object') return logical(schema.type, v);
  }
  if (v instanceof Uint8Array) return toBase64(v);
  return v;
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
      return ok('avro', logical(type.schema, type.decode(payload)), meta);
    } catch (e) {
      return fail(
        bytes,
        'Avro',
        "Couldn't decode the value as Avro",
        `${schema.subject} v${schema.version} (id ${id}) doesn't match the bytes: ${(e as Error).message}.`,
        { annotations, schemaId: id },
      );
    }
  }
  if (schema.type === 'JSON') {
    try {
      return ok('json-schema', JSON.parse(utf8.decode(payload)), meta);
    } catch {
      return fail(
        bytes,
        'JSON Schema',
        "Couldn't decode the value as JSON",
        `The payload after the 5-byte header is not valid JSON (schema ${schema.subject} v${schema.version}).`,
        { annotations, schemaId: id },
      );
    }
  }
  return fail(
    bytes,
    'Protobuf',
    'Protobuf decoding is not supported yet',
    'Protobuf arrives in v2. Use Hex or Base64 to inspect the bytes.',
    { annotations, schemaId: id },
  );
}

export async function decode(
  bytes: Uint8Array | null,
  as: DecodeAs,
  lookup: SchemaLookup,
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
      return viaRegistry(bytes, lookup, as === 'avro' ? 'AVRO' : 'JSON');
    case 'json':
      try {
        return ok('json', JSON.parse(utf8.decode(bytes)));
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
      if (bytes.length >= 5 && bytes[0] === 0) return viaRegistry(bytes, lookup);
      let s: string;
      try {
        s = utf8.decode(bytes);
      } catch {
        return ok('hex', toHex(bytes));
      }
      const t = s.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try {
          return ok('json', JSON.parse(t));
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
