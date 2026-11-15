'use client';
import {
  applyMasks,
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

const lookups = new WeakMap<object, SchemaLookup>();

/** Registry lookups by id, cached per client (ARCHITECTURE: schemas are fetched by id and cached). */
export function useSchemaLookup(): SchemaLookup {
  const { client, clusterId } = useKafka();
  return useMemo(() => {
    if (!lookups.has(client))
      lookups.set(
        client,
        cachedLookup((id) => client.getSchemaById(clusterId, id)),
      );
    return lookups.get(client)!;
  }, [client, clusterId]);
}

export function useMaskRules(): [MaskRule[], (r: MaskRule[]) => void] {
  return useLocal<MaskRule[]>('ki-mask-rules', DEFAULT_MASKS);
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

export async function decodeMessage(
  m: RawMessage,
  valueAs: DecodeAs,
  keyAs: DecodeAs,
  lookup: SchemaLookup,
  rules: MaskRule[],
): Promise<DecodedMessage> {
  const [key, value] = await Promise.all([
    decode(m.key, keyAs, lookup),
    decode(m.value, valueAs, lookup),
  ]);
  const masked = value.ok
    ? applyMasks(value.value, m.topic, rules)
    : { value: undefined, applied: [] };
  const headers: Record<string, string> = {};
  for (const h of m.headers) headers[h.key] = td.decode(h.value);
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
