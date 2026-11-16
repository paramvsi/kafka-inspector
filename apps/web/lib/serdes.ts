'use client';
import {
  applyMasks,
  topicMatches,
  maskEncodedJson,
  cachedLookup,
  decode,
  DEFAULT_MASKS,
  type DecodeAs,
  type DecodeResult,
  type MaskRule,
  type RawMessage,
  type SchemaLookup,
} from '@ki/core';
import { useMemo } from 'react';
import { useKafka } from './kafka';
import { useLocal } from './local';
import { validMaskRules } from './maskRules';
import { joinHeaders } from './headers';

const lookups = new WeakMap<object, SchemaLookup>();

/**
 * Registry lookups by id, cached per client (ARCHITECTURE: schemas are fetched by id and cached).
 * Undefined when this cluster has no Schema Registry: a leading 0x00 is then plain data.
 */
export function useSchemaLookup(): SchemaLookup | undefined {
  const { client, clusterId, info } = useKafka();
  const hasRegistry =
    info.clusters.find((c) => c.id === clusterId)?.schemaRegistry ??
    info.capabilities.schemaRegistry;
  return useMemo(() => {
    if (!hasRegistry) return undefined;
    if (!lookups.has(client))
      lookups.set(
        client,
        cachedLookup((id) => client.getSchemaById(clusterId, id)),
      );
    return lookups.get(client)!;
  }, [client, clusterId, hasRegistry]);
}

export function useMaskRules(): [MaskRule[], (r: MaskRule[]) => void] {
  const [stored, set] = useLocal<MaskRule[]>('ki-mask-rules', DEFAULT_MASKS);
  // ponytail: a dropped malformed rule leaves its field unmasked; it also disappears from the rules list, so it's visible
  const rules = useMemo(() => validMaskRules(stored), [stored]);
  return [rules, set];
}

export interface DecodedMessage {
  raw: RawMessage;
  id: string;
  key: DecodeResult;
  value: DecodeResult;
  /** value after masking (objects) */
  shown: unknown;
  masked: Array<{ path: string; rule: string }>;
  headers: Record<string, string>;
}

const td = new TextDecoder();
export const msgId = (m: RawMessage) => `${m.topic}:${m.partition}:${m.offset}`;

/** Raw bytes of a non-JSON body can't be masked field by field: on a topic a rule covers, don't show them. */
function rawHidden(topic: string, rules: MaskRule[]) {
  const r = rules.find((x) => topicMatches(x.topics, topic));
  return r
    ? {
        value: `Raw bytes hidden: masking rule “${r.name}” applies to this topic. Pick a decoder to see the masked value.`,
        applied: [] as ReturnType<typeof applyMasks>['applied'],
      }
    : undefined;
}

export async function decodeMessage(
  m: RawMessage,
  valueAs: DecodeAs,
  keyAs: DecodeAs,
  lookup: SchemaLookup | undefined,
  rules: MaskRule[],
): Promise<DecodedMessage> {
  const [key, value] = await Promise.all([
    decode(m.key, keyAs, lookup),
    decode(m.value, valueAs, lookup),
  ]);
  let masked = value.ok
    ? applyMasks(value.value, m.topic, rules)
    : { value: undefined, applied: [] as ReturnType<typeof applyMasks>['applied'] };
  // A hex/base64 view of a JSON body would show masked fields as bytes: mask the JSON, then re-encode it.
  // (A body that fails to decode keeps its raw hex — needed to diagnose it; see DECISIONS.)
  if (value.ok && (value.format === 'hex' || value.format === 'base64') && m.value)
    masked =
      maskEncodedJson(m.value, value.format, m.topic, rules) ?? rawHidden(m.topic, rules) ?? masked;
  const headers = joinHeaders(m.headers, (b) => td.decode(b));
  return {
    raw: m,
    id: msgId(m),
    key,
    value,
    shown: value.ok ? masked.value : undefined,
    masked: masked.applied,
    headers,
  };
}

/** A decoded key as text: an object key (Avro record, JSON) shows its preview, not "[object Object]". */
export const keyText = (k: { value: unknown; text: string }): string =>
  k.value !== null && typeof k.value === 'object' && !(k.value instanceof Uint8Array)
    ? k.text
    : String(k.value);
