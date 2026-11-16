import type { ConfigEntry } from '@ki/core';

/** Only a topic-level value is a topic override; a broker-wide value (dynamic or static) applies to every topic. */
export const sourceLabel = (
  c: Pick<ConfigEntry, 'source' | 'isDefault'>,
): 'override' | 'broker' | 'default' =>
  c.source === 'dynamic-topic'
    ? 'override'
    : c.source === 'dynamic-broker' || c.source === 'static-broker'
      ? 'broker'
      : c.isDefault
        ? 'default'
        : 'override'; // 'unknown' source but not default: say what we know
