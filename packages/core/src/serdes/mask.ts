import { parseJson, toBase64, toHex } from './decode';
// Data masking (F-47): applied after decoding, on JSON paths. A display feature, not a security control.
export interface MaskRule {
  id: string;
  name: string;
  /** topic glob: "orders.*", "payments", "*" */
  topics: string;
  /** "$.email", "$.card.number", "$.items[*].sku" */
  path: string;
  action: 'remove' | 'replace' | 'mask';
  replacement?: string;
}

export const MASKED = '•••• masked';

export function topicMatches(glob: string, topic: string): boolean {
  const re = new RegExp(
    `^${glob
      .split('*')
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  // "orders.*" should also match "orders" itself (the rule names a topic family)
  return re.test(topic) || (glob.endsWith('.*') && topic === glob.slice(0, -2));
}

/** "$.a.b", "$.items[*].sku", "$.items[0]", "$['a.b']" → segments; null when the path can't be read. */
function segments(path: string): string[] | null {
  const rest = path.trim().replace(/^\$/, '');
  const re = /\.([^.[\]]+)|\[(\d+|\*)\]|\[(['"])(.+?)\3\]/gy;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  let at = 0;
  // a bare first key ("email") is accepted as "$.email"
  const lead = /^[^.[\]]+/.exec(rest);
  if (lead) {
    out.push(lead[0]);
    at = lead[0].length;
  }
  re.lastIndex = at;
  while (at < rest.length && (m = re.exec(rest))) {
    out.push(m[1] ?? m[2] ?? m[4]!);
    at = re.lastIndex;
  }
  return at === rest.length && out.length ? out : null;
}

export interface MaskResult {
  value: unknown;
  applied: Array<{ path: string; rule: string }>;
}

export function applyMasks(value: unknown, topic: string, rules: MaskRule[]): MaskResult {
  const applied: MaskResult['applied'] = [];
  // "Show as text" of a JSON body: mask the parsed JSON and give the text back, so text views don't leak
  if (typeof value === 'string' && rules.some((r) => topicMatches(r.topics, topic))) {
    let parsed: unknown;
    try {
      parsed = parseJson(value); // ponytail: a big integer comes back quoted, digits exact (JSON.rawJSON would keep it bare)
    } catch {
      return { value, applied };
    }
    if (parsed !== null && typeof parsed === 'object') {
      const r = applyMasks(parsed, topic, rules);
      if (r.applied.length) return { value: JSON.stringify(r.value), applied: r.applied };
      // nothing masked: the original text, unless it names a masked field — JSON.parse keeps only the last of a
      // repeated key, so {"email":"a@b","email":null} parsed as null and the text still holds a@b
      const named = rules.some((rule) => {
        if (!topicMatches(rule.topics, topic)) return false;
        const last = segments(rule.path)?.at(-1);
        return last === undefined || last === '*' || value.includes(JSON.stringify(last));
      });
      return { value: named ? JSON.stringify(r.value) : value, applied };
    }
  }
  if (value === null || typeof value !== 'object') return { value, applied };
  const copy = structuredClone(value) as Record<string, unknown>;
  for (const rule of rules) {
    if (!topicMatches(rule.topics, topic)) continue;
    const segs = segments(rule.path);
    if (!segs) continue; // invalid paths are rejected when the rule is added (isValidMaskPath)
    const walk = (node: unknown, i: number, at: string) => {
      if (node === null || typeof node !== 'object') return;
      const key = segs[i]!;
      const keys = key === '*' ? Object.keys(node) : [key];
      const removed: number[] = [];
      for (const k of keys) {
        const obj = node as Record<string, unknown>;
        // own data only: never inherited names, and arrays only by index (`length` is an own property)
        if (!Object.hasOwn(obj, k) || (Array.isArray(node) && !/^\d+$/.test(k))) continue;
        const here = Array.isArray(node) ? `${at}[${k}]` : `${at}.${k}`;
        if (i === segs.length - 1) {
          if (obj[k] === null || obj[k] === undefined) continue;
          if (rule.action === 'remove') {
            if (Array.isArray(node)) removed.push(Number(k));
            else Reflect.deleteProperty(obj, k);
          } else obj[k] = rule.action === 'replace' ? (rule.replacement ?? '') : MASKED;
          applied.push({ path: here, rule: rule.name });
        } else walk(obj[k], i + 1, here);
      }
      // arrays close up instead of keeping holes (which would show as null)
      for (const n of removed.sort((a, b) => b - a)) (node as unknown[]).splice(n, 1);
    };
    walk(copy, 0, '$');
  }
  return { value: copy, applied };
}

export const isValidMaskPath = (path: string) => segments(path) !== null;

export const DEFAULT_MASKS: MaskRule[] = [
  {
    id: 'm-emails',
    name: 'emails on orders.*',
    topics: 'orders.*',
    path: '$.email',
    action: 'mask',
  },
];

/**
 * A hex/base64 view of a JSON body would show masked fields as bytes: mask the JSON and re-encode it.
 * Returns undefined when nothing applies (not JSON, or no rule for this topic).
 */
export function maskEncodedJson(
  bytes: Uint8Array,
  format: 'hex' | 'base64',
  topic: string,
  rules: MaskRule[],
): MaskResult | undefined {
  const r = applyMasks(new TextDecoder().decode(bytes), topic, rules);
  if (!r.applied.length) return undefined;
  const out = new TextEncoder().encode(r.value as string);
  return { value: format === 'hex' ? toHex(out) : toBase64(out), applied: r.applied };
}
