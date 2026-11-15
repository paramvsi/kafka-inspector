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

function segments(path: string): string[] {
  return path
    .replace(/^\$\.?/, '')
    .replace(/\[\*\]/g, '.*')
    .split('.')
    .filter(Boolean);
}

export interface MaskResult {
  value: unknown;
  applied: Array<{ path: string; rule: string }>;
}

export function applyMasks(value: unknown, topic: string, rules: MaskRule[]): MaskResult {
  const applied: MaskResult['applied'] = [];
  if (value === null || typeof value !== 'object') return { value, applied };
  const copy = structuredClone(value) as Record<string, unknown>;
  for (const rule of rules) {
    if (!topicMatches(rule.topics, topic)) continue;
    const segs = segments(rule.path);
    const walk = (node: unknown, i: number, at: string) => {
      if (node === null || typeof node !== 'object') return;
      const key = segs[i]!;
      const keys = key === '*' ? Object.keys(node) : [key];
      for (const k of keys) {
        const obj = node as Record<string, unknown>;
        if (!(k in obj)) continue;
        const here = Array.isArray(node) ? `${at}[${k}]` : `${at}.${k}`;
        if (i === segs.length - 1) {
          if (obj[k] === null || obj[k] === undefined) continue;
          if (rule.action === 'remove') Reflect.deleteProperty(obj, k);
          else obj[k] = rule.action === 'replace' ? (rule.replacement ?? '') : MASKED;
          applied.push({ path: here, rule: rule.name });
        } else walk(obj[k], i + 1, here);
      }
    };
    walk(copy, 0, '$');
  }
  return { value: copy, applied };
}

export const DEFAULT_MASKS: MaskRule[] = [
  {
    id: 'm-emails',
    name: 'emails on orders.*',
    topics: 'orders.*',
    path: '$.email',
    action: 'mask',
  },
];
