import type { RawMessage } from '@ki/core';
import type { DecodedMessage } from './serdes';

/** One RFC 4180 cell. Text that a spreadsheet would run as a formula (= + - @, tab, CR) gets a leading '. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // formulas come from text; a number like -5 stays a number
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * The file body for an export of the rows on screen. Each key and value carries the format it was decoded as, so
 * hex or base64 bytes never pass for text. Rows not decoded yet (live tail, a mask change) are left out and counted.
 */
export function exportBody(
  rows: RawMessage[],
  get: (m: RawMessage) => DecodedMessage | undefined,
  kind: 'json' | 'csv',
) {
  const items = rows.flatMap((m) => {
    const d = get(m);
    if (!d) return [];
    return [
      {
        topic: m.topic,
        partition: m.partition,
        offset: m.offset,
        timestamp: m.timestamp,
        key: d.key.ok ? d.key.value : null,
        keyFormat: d.key.ok ? d.key.format : 'error',
        value: d.value.ok ? d.shown : { decodeError: d.value.reason },
        valueFormat: d.value.ok ? d.value.format : 'error',
        headers: d.headers,
      },
    ];
  });
  const body =
    kind === 'json'
      ? JSON.stringify(items, null, 2)
      : [
          'topic,partition,offset,timestamp,key,key_format,value,value_format',
          ...items.map((i) =>
            [
              i.topic,
              i.partition,
              i.offset,
              i.timestamp,
              i.key,
              i.keyFormat,
              i.value,
              i.valueFormat,
            ]
              .map(csvCell)
              .join(','),
          ),
        ].join('\n');
  return { body, skipped: rows.length - items.length };
}
