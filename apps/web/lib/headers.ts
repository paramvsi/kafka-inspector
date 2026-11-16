/** Kafka allows a header key more than once: keep every value, not just the last. */
export function joinHeaders(
  headers: Array<{ key: string; value: Uint8Array }>,
  decode: (b: Uint8Array) => string,
): Record<string, string> {
  // no prototype: a header named "toString" or "__proto__" is just a header
  const out: Record<string, string> = Object.create(null);
  for (const h of headers) {
    const v = decode(h.value);
    out[h.key] = Object.hasOwn(out, h.key) ? `${out[h.key]}, ${v}` : v;
  }
  return out;
}
