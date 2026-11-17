// Minimal Avro binary codec (spec 1.11 "Binary Encoding"): null, boolean, int, long, float, double, bytes,
// string, record, enum, array, map, union, fixed, plus named-type references. Longs are JS numbers
// (exact to 2^53, which covers offsets and epoch millis). Used by the simulator (encode) and the
// browser decoder; tests cross-check it against avsc.

// Parsed Avro schema JSON is walked structurally; a loose type keeps that readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AvroSchema = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;

const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: true });

export class AvroError extends Error {}

/** Registers every named type under its bare and full name (Avro spec "Names"); shared with schema-compat. */
export function collectNamed(s: AvroSchema, named: Map<string, AvroSchema>, ns?: string): void {
  if (typeof s === 'string' || s == null) return; // == null: a field without a type is undefined
  if (Array.isArray(s)) return s.forEach((x) => collectNamed(x, named, ns));
  let space = ns;
  if (['record', 'enum', 'fixed', 'error'].includes(s.type) && s.name) {
    // as in schema-compat's collect: a dotted name carries its own namespace, which its nested types inherit
    const name = String(s.name);
    space = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : (s.namespace ?? ns);
    const bare = name.slice(name.lastIndexOf('.') + 1);
    named.set(bare, s);
    if (space) named.set(`${space}.${bare}`, s);
  } else if (s.namespace) space = s.namespace;
  for (const f of s.fields ?? []) collectNamed(f.type, named, space);
  if (s.items) collectNamed(s.items, named, space);
  if (s.values) collectNamed(s.values, named, space);
  if (typeof s.type === 'object') collectNamed(s.type, named, space);
}

const PRIMITIVES = new Set([
  'null',
  'boolean',
  'int',
  'long',
  'float',
  'double',
  'bytes',
  'string',
]);

/** A copy of `s` whose bare references name their type in full: the spec resolves a bare name in the
 *  enclosing namespace first, so two namespaces may each have an `Item` */
export function qualify(s: AvroSchema, named: Map<string, AvroSchema>, ns?: string): AvroSchema {
  if (typeof s === 'string')
    return !PRIMITIVES.has(s) && !s.includes('.') && ns && named.has(`${ns}.${s}`)
      ? `${ns}.${s}`
      : s;
  if (s == null || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map((x) => qualify(x, named, ns));
  let space = ns;
  if (['record', 'enum', 'fixed', 'error'].includes(s.type) && s.name) {
    const name = String(s.name); // the same namespace rules as collectNamed
    space = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : (s.namespace ?? ns);
  } else if (s.namespace) space = s.namespace;
  const out = { ...s };
  if (s.fields)
    out.fields = s.fields.map((f: AvroSchema) => ({ ...f, type: qualify(f.type, named, space) }));
  if ('items' in s) out.items = qualify(s.items, named, space);
  if ('values' in s) out.values = qualify(s.values, named, space);
  if (typeof s.type === 'object') out.type = qualify(s.type, named, space);
  return out;
}

/** The schema with bare references qualified, and its name table built from that copy. */
export function namedTypes(schema: AvroSchema): {
  root: AvroSchema;
  named: Map<string, AvroSchema>;
} {
  const seen = new Map<string, AvroSchema>();
  collectNamed(schema, seen);
  const root = qualify(schema, seen);
  const named = new Map<string, AvroSchema>();
  collectNamed(root, named); // names point at the qualified copies
  return { root, named };
}

export class AvroType {
  private named: Map<string, AvroSchema>;
  private root: AvroSchema;
  constructor(readonly schema: AvroSchema) {
    ({ root: this.root, named: this.named } = namedTypes(schema));
  }

  static parse(json: string): AvroType {
    return new AvroType(JSON.parse(json));
  }

  /** Spec: bytes/fixed defaults are JSON strings of code points 0–255; a union default is for its first branch. */
  private defaultOf(type: AvroSchema, d: unknown): unknown {
    const t = this.resolve(type);
    const first = Array.isArray(t) ? this.resolve(t[0]) : t;
    const kind = typeof first === 'string' ? first : first?.type;
    if (typeof d === 'string' && (kind === 'bytes' || kind === 'fixed'))
      return Uint8Array.from(d, (c) => c.charCodeAt(0) & 0xff);
    return d;
  }

  private resolve(s: AvroSchema): AvroSchema {
    if (typeof s === 'string' && this.named.has(s)) return this.named.get(s);
    if (s && typeof s === 'object' && !Array.isArray(s) && typeof s.type === 'object')
      return this.resolve(s.type);
    if (
      s &&
      typeof s === 'object' &&
      !Array.isArray(s) &&
      typeof s.type === 'string' &&
      !['record', 'enum', 'fixed', 'array', 'map', 'error'].includes(s.type)
    )
      return s.type;
    return s;
  }

  // ─── encode ───
  encode(value: Value): Uint8Array {
    const out: number[] = [];
    this.write(this.root, value, out);
    return Uint8Array.from(out);
  }

  private write(schema: AvroSchema, v: Value, out: number[]): void {
    const s = this.resolve(schema);
    if (Array.isArray(s)) {
      const i = s.findIndex((b) => this.matches(b, v));
      if (i < 0) throw new AvroError(`value does not match union ${JSON.stringify(s)}`);
      writeLong(i, out);
      return this.write(s[i], v, out);
    }
    if (typeof s === 'string') {
      switch (s) {
        case 'null':
          return;
        case 'boolean':
          if (typeof v !== 'boolean') throw new AvroError(`invalid boolean: ${JSON.stringify(v)}`);
          out.push(v ? 1 : 0);
          return;
        case 'int':
        case 'long':
          if (!(s === 'int' ? isInt(v) : isLong(v))) throw new AvroError(`invalid ${s}: ${v}`);
          return writeLong(v, out);
        case 'float':
        case 'double':
          if (typeof v !== 'number') throw new AvroError(`invalid ${s}: ${JSON.stringify(v)}`);
          return pushBytes(out, numBytes(s === 'float' ? 4 : 8, v));
        case 'string': {
          if (typeof v !== 'string') throw new AvroError(`invalid string: ${JSON.stringify(v)}`);
          const b = te.encode(v);
          writeLong(b.length, out);
          return pushBytes(out, b);
        }
        case 'bytes':
          if (!(v instanceof Uint8Array)) throw new AvroError('invalid bytes');
          writeLong(v.length, out);
          return pushBytes(out, v);
        default:
          throw new AvroError(`unknown type ${s}`);
      }
    }
    switch (s.type) {
      case 'record':
      case 'error':
        // say which field: otherwise the user reads "invalid string: undefined" or a TypeError on null
        if (v === null || typeof v !== 'object' || Array.isArray(v))
          throw new AvroError(
            `Expected an object with the fields of ${s.name}, not ${v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v}.`,
          );
        for (const f of s.fields) {
          // a field that accepts null is written as null when left out (as before); only required ones are missing
          if (v[f.name] === undefined && !('default' in f) && !this.acceptsNull(f.type))
            throw new AvroError(
              `Field "${f.name}" is missing. Add it, or give it a default in the schema.`,
            );
        }
        for (const f of s.fields)
          this.write(
            f.type,
            v[f.name] === undefined ? this.defaultOf(f.type, f.default) : v[f.name],
            out,
          );
        return;
      case 'enum': {
        const i = s.symbols.indexOf(v);
        if (i < 0) throw new AvroError(`invalid enum symbol ${v}`);
        return writeLong(i, out);
      }
      case 'fixed':
        if (!(v instanceof Uint8Array) || v.length !== s.size)
          throw new AvroError(`invalid fixed ${s.name}: expected ${s.size} bytes`);
        return pushBytes(out, v);
      case 'array':
        if (v.length) {
          writeLong(v.length, out);
          for (const x of v) this.write(s.items, x, out);
        }
        out.push(0);
        return;
      case 'map': {
        const entries = Object.entries(v);
        if (entries.length) {
          writeLong(entries.length, out);
          for (const [k, x] of entries) {
            this.write('string', k, out);
            this.write(s.values, x, out);
          }
        }
        out.push(0);
        return;
      }
    }
    throw new AvroError(`unsupported schema ${JSON.stringify(s)}`);
  }

  /** null itself, or a union with a null branch */
  private acceptsNull(schema: AvroSchema): boolean {
    const s = this.resolve(schema);
    return Array.isArray(s) ? s.some((b) => this.matches(b, null)) : this.matches(s, null);
  }

  private matches(schema: AvroSchema, v: Value): boolean {
    const s = this.resolve(schema);
    if (typeof s === 'string') {
      switch (s) {
        case 'null':
          return v === null || v === undefined;
        case 'boolean':
          return typeof v === 'boolean';
        case 'int':
          return isInt(v);
        case 'long':
          return isLong(v);
        case 'float':
        case 'double':
          return typeof v === 'number';
        case 'string':
          return typeof v === 'string';
        case 'bytes':
          return v instanceof Uint8Array;
      }
      return false;
    }
    if (s.type === 'array') return Array.isArray(v);
    if (s.type === 'enum') return s.symbols.includes(v);
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  // ─── decode ───
  /** Decodes one value; throws AvroError on truncated or malformed input. `strict` requires every byte consumed. */
  decode(bytes: Uint8Array, strict = true): Value {
    const r = {
      b: bytes,
      p: 0,
      dv: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    };
    const v = this.read(this.root, r);
    if (strict && r.p !== bytes.length)
      throw new AvroError(`${bytes.length - r.p} trailing bytes after the value`);
    return v;
  }

  private read(schema: AvroSchema, r: Reader): Value {
    const s = this.resolve(schema);
    if (Array.isArray(s)) {
      const i = readLen(r);
      if (i < 0 || i >= s.length) throw new AvroError(`union branch ${i} out of range`);
      return this.read(s[i], r);
    }
    if (typeof s === 'string') {
      switch (s) {
        case 'null':
          return null;
        case 'boolean':
          need(r, 1);
          return r.b[r.p++] !== 0;
        case 'int':
        case 'long':
          return readLong(r);
        case 'float':
          need(r, 4);
          r.p += 4;
          return shortFloat32(r.dv.getFloat32(r.p - 4, true));
        case 'double':
          need(r, 8);
          r.p += 8;
          return r.dv.getFloat64(r.p - 8, true);
        case 'string': {
          const n = readLen(r);
          if (n < 0) throw new AvroError('negative string length');
          need(r, n);
          r.p += n;
          try {
            return td.decode(r.b.subarray(r.p - n, r.p));
          } catch {
            throw new AvroError('string is not valid UTF-8');
          }
        }
        case 'bytes': {
          const n = readLen(r);
          if (n < 0) throw new AvroError('negative bytes length');
          need(r, n);
          r.p += n;
          return r.b.slice(r.p - n, r.p);
        }
      }
      throw new AvroError(`unknown type ${s}`);
    }
    switch (s.type) {
      case 'record':
      case 'error': {
        const o: Record<string, Value> = {};
        for (const f of s.fields) o[f.name] = this.read(f.type, r);
        return o;
      }
      case 'enum': {
        const i = readLen(r);
        if (i < 0 || i >= s.symbols.length) throw new AvroError(`enum index ${i} out of range`);
        return s.symbols[i];
      }
      case 'fixed':
        need(r, s.size);
        r.p += s.size;
        return r.b.slice(r.p - s.size, r.p);
      case 'array': {
        const a: Value[] = [];
        for (let n = readBlock(r); n !== 0; n = readBlock(r))
          for (let i = 0; i < n; i++) a.push(this.read(s.items, r));
        return a;
      }
      case 'map': {
        const m: Record<string, Value> = Object.create(null); // a "__proto__" key is data, not a prototype
        for (let n = readBlock(r); n !== 0; n = readBlock(r))
          for (let i = 0; i < n; i++) {
            const k = this.read('string', r);
            m[k] = this.read(s.values, r);
          }
        return m;
      }
    }
    throw new AvroError(`unsupported schema ${JSON.stringify(s)}`);
  }
}

interface Reader {
  b: Uint8Array;
  p: number;
  dv: DataView;
  /** array/map items read so far: zero-width items (null, empty records) must not repeat without bound */
  items?: number;
}

/** float32 read as the shortest decimal that is the same float32 (0.1, not 0.10000000149011612). */
function shortFloat32(f: number): number {
  if (!Number.isFinite(f)) return f;
  for (let p = 6; p <= 9; p++) {
    const x = Number(f.toPrecision(p));
    if (Math.fround(x) === f) return x;
  }
  return f;
}

function need(r: Reader, n: number): void {
  if (r.p + n > r.b.length)
    throw new AvroError(`unexpected end of data: needed ${n} more bytes at position ${r.p}`);
}

const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;

/** int32 only: a real Avro writer refuses 3000000000 for an int. */
function isInt(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= -2147483648 && (v as number) <= 2147483647;
}

/** A long is a safe integer, or (beyond 2^53) its exact decimal string as decoded. */
function isLong(v: unknown): v is number | string {
  if (typeof v === 'number') return Number.isSafeInteger(v);
  if (typeof v !== 'string' || !/^-?\d+$/.test(v)) return false;
  // only the form the decoder produces: beyond 2^53. "42" is a string, so ["int","string"] keeps it one
  const b = BigInt(v);
  const safe = BigInt(Number.MAX_SAFE_INTEGER);
  return (b > safe || b < -safe) && b >= LONG_MIN && b <= LONG_MAX;
}

/** zig-zag varint, exact for the whole 64-bit range */
function writeLong(n: number | string, out: number[]): void {
  const v = BigInt(n);
  let z = BigInt.asUintN(64, (v << 1n) ^ (v >> 63n));
  while (z >= 0x80n) {
    out.push(Number(z & 0x7fn) | 0x80);
    z >>= 7n;
  }
  out.push(Number(z));
}

/** Exact 64-bit read: a number when safe, else the decimal string (never a silently rounded number). */
function readLong(r: Reader): number | string {
  const start = r.p;
  let b: number;
  do {
    need(r, 1);
    b = r.b[r.p++]!;
    if (r.p - start > 10) throw new AvroError('varint too long');
  } while (b & 0x80);
  if (r.p - start <= 7) {
    // ≤ 49 bits: plain arithmetic is exact
    let z = 0;
    for (let i = r.p - 1; i >= start; i--) z = z * 0x80 + (r.b[i]! & 0x7f);
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }
  let z = 0n;
  for (let i = r.p - 1; i >= start; i--) z = (z << 7n) | BigInt(r.b[i]! & 0x7f);
  z = BigInt.asUintN(64, z);
  const v = (z >> 1n) ^ -(z & 1n);
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(v)
    : v.toString();
}

/** Lengths, counts and indexes must be safe integers. */
function readLen(r: Reader): number {
  const n = readLong(r);
  if (typeof n !== 'number') throw new AvroError(`length ${n} is out of range`);
  return n;
}

function readBlock(r: Reader): number {
  let n = readLen(r);
  if (n < 0) {
    readLen(r); // block size in bytes
    n = -n;
  }
  // every item but null takes ≥ 1 byte: a count far beyond the data is corrupt, not a long array
  if (n > r.b.length - r.p + 65_536) throw new AvroError(`block of ${n} items exceeds the data`);
  r.items = (r.items ?? 0) + n;
  if (r.items > r.b.length + 65_536) throw new AvroError(`${r.items} items exceed the data`);
  return n;
}

function numBytes(n: 4 | 8, v: number): Uint8Array {
  const b = new Uint8Array(n);
  const dv = new DataView(b.buffer);
  if (n === 4) dv.setFloat32(0, v, true);
  else dv.setFloat64(0, v, true);
  return b;
}

function pushBytes(out: number[], b: Uint8Array): void {
  for (let i = 0; i < b.length; i++) out.push(b[i]!);
}

// ─── helpers for producing from the UI ───

/** Display JSON → encodable value: ISO strings become epoch millis for timestamp-millis fields. */
export function fromDisplay(schema: AvroSchema, v: Value): Value {
  if (v === null || v === undefined) return v;
  if (Array.isArray(schema)) {
    if (v === null) return null;
    const branch = schema.find((b: AvroSchema) => b !== 'null');
    return fromDisplay(branch, v);
  }
  if (schema && typeof schema === 'object') {
    if (schema.logicalType === 'timestamp-millis' && typeof v === 'string') {
      const t = Date.parse(v);
      if (Number.isNaN(t)) throw new AvroError(`"${v}" is not a valid timestamp`);
      return t;
    }
    if (schema.type === 'record')
      return Object.fromEntries(
        schema.fields.map((f: { name: string; type: AvroSchema }) => [
          f.name,
          fromDisplay(f.type, v[f.name]),
        ]),
      );
    if (schema.type === 'array') return (v as Value[]).map((x) => fromDisplay(schema.items, x));
    if (typeof schema.type === 'object') return fromDisplay(schema.type, v);
  }
  return v;
}

/** Random but valid value for a schema ("Generate from schema"). Uses field names for realistic strings. */
export function randomValue(schema: AvroSchema, rnd: () => number = Math.random, name = ''): Value {
  if (Array.isArray(schema))
    return rnd() < 0.2 && schema.includes('null')
      ? null
      : randomValue(
          schema.find((b: AvroSchema) => b !== 'null'),
          rnd,
          name,
        );
  if (typeof schema === 'object' && schema !== null) {
    if (schema.logicalType === 'timestamp-millis')
      return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    switch (schema.type) {
      case 'record':
        return Object.fromEntries(
          schema.fields.map((f: { name: string; type: AvroSchema }) => [
            f.name,
            randomValue(f.type, rnd, f.name),
          ]),
        );
      case 'enum':
        return schema.symbols[Math.floor(rnd() * schema.symbols.length)];
      case 'array':
        return Array.from({ length: 1 + Math.floor(rnd() * 2) }, () =>
          randomValue(schema.items, rnd, name),
        );
      case 'map':
        return { a: randomValue(schema.values, rnd, name) };
      default:
        return randomValue(schema.type, rnd, name);
    }
  }
  const id = () =>
    Math.floor(rnd() * 0xfffff)
      .toString(16)
      .padStart(5, '0');
  switch (schema) {
    case 'string': {
      const n = name.toLowerCase();
      if (n.endsWith('id')) return `${n.replace(/id$/, '').slice(0, 3) || 'id'}_${id()}`;
      if (n.includes('email')) return `test.user${Math.floor(rnd() * 900 + 100)}@example.com`;
      if (n.includes('currency')) return ['EUR', 'AED', 'GBP', 'USD'][Math.floor(rnd() * 4)];
      if (n.includes('status')) return ['PAID', 'PENDING', 'SHIPPED'][Math.floor(rnd() * 3)];
      if (n.includes('sku')) return `SKU-${String(Math.floor(rnd() * 9999)).padStart(4, '0')}`;
      if (n.includes('at') || n.includes('time')) return new Date().toISOString();
      return `${n || 'value'}-${id()}`;
    }
    case 'int':
      return 1 + Math.floor(rnd() * 5);
    case 'long':
      return Math.floor(rnd() * 1e6);
    case 'float':
    case 'double':
      return Math.round(rnd() * 200000) / 100;
    case 'boolean':
      return rnd() < 0.5;
    case 'null':
      return null;
    default:
      return null;
  }
}
