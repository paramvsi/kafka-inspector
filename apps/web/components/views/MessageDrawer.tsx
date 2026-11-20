'use client';
import type { MsgRef } from '../../lib/msgParam';
import { formatInt, formatTimestamp, hexDump, type DecodeAs, type RawMessage } from '@ki/core';
import { Button, CopyButton, Drawer, HexDump, JsonTree, Tooltip } from '@ki/ui';
import { useEffect, useState } from 'react';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import {
  decodeMessage,
  useMaskRules,
  useSchemaLookup,
  type DecodedMessage,
  keyText,
} from '../../lib/serdes';
import { useUrl } from '../../lib/url';
import { useReadOnly } from '../Page';
import { applyMasks, decode as decodeBytes, shownName } from '@ki/core';

export function MessageDrawer({
  topic,
  raw,
  msgRef,
  valueAs,
  keyAs,
  onClose,
}: {
  topic: string;
  raw?: RawMessage;
  msgRef?: MsgRef;
  valueAs: DecodeAs;
  keyAs: DecodeAs;
  onClose: () => void;
}) {
  const url = useUrl();
  const { client, clusterId } = useKafka();
  const lookup = useSchemaLookup();
  const [rules] = useMaskRules();
  const readOnly = useReadOnly();
  const p = msgRef?.partition,
    o = msgRef?.offset;
  const fetched = useKafkaQuery(
    ['message', topic, p, o],
    (c, id) => c.browse(id, { topic, partition: p!, from: 'offset', offset: o!, limit: 1 }),
    false,
    !!msgRef && !raw, // nothing selected (or already in hand): no request with NaN offsets
  );
  const m = raw ?? fetched.data?.messages.find((x) => x.offset === o && x.partition === p);
  const [d, setD] = useState<DecodedMessage>();
  const [alt, setAlt] = useState<{ label: string; value: unknown } | null>(null);
  const topicInfo = useKafkaQuery(['topic', topic], (c, id) => c.getTopic(id, topic), false);

  useEffect(() => {
    setAlt(null);
    if (!m) return setD(undefined);
    let alive = true;
    decodeMessage(m, valueAs, keyAs, lookup, rules).then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, [m, valueAs, keyAs, lookup, rules]);

  const tryLatest = async () => {
    const subject = topicInfo.data?.schema?.valueSubject;
    if (!subject || !m?.value) return;
    if (m.value.length < 5) {
      setAlt({
        label: `Decoded with latest ${subject}`,
        value: 'Too short to carry a schema id (under 5 bytes).',
      });
      return;
    }
    try {
      const latest = await client.getSchema(clusterId, subject, 'latest');
      const bytes = new Uint8Array(m.value);
      new DataView(bytes.buffer).setInt32(1, latest.id, false);
      const r = await decodeBytes(bytes, 'auto', async (id) =>
        id === latest.id ? latest : undefined,
      );
      setAlt({
        label: `Decoded with latest ${subject} (v${latest.version}, id ${latest.id})`,
        value: r.ok ? applyMasks(r.value, m.topic, rules).value : `Still failed: ${r.detail}`, // masks apply here too
      });
    } catch (e) {
      setAlt({
        label: `Decoded with latest ${subject}`,
        value: `Couldn't fetch the schema: ${(e as Error).message} Close and reopen the message to try again.`,
      });
    }
  };

  // a hex or text view copies what it shows, not a JSON-quoted string
  const asText = typeof d?.shown === 'string';
  const json = d?.value.ok ? (asText ? (d.shown as string) : JSON.stringify(d.shown, null, 2)) : '';
  return (
    <Drawer
      open={!!msgRef}
      onClose={onClose}
      title="Message"
      description={
        m ? (
          <span className="font-mono">
            {topic} · partition {m.partition} · offset {formatInt(m.offset)}
          </span>
        ) : fetched.isLoading || fetched.isPlaceholderData ? (
          'Loading…'
        ) : (
          <span className="font-mono">
            {topic} · partition {p} · offset {formatInt(Number(o))}
          </span>
        )
      }
      footer={
        d && (
          <>
            {d.value.ok && <CopyButton text={json} label={asText ? 'Copy value' : 'Copy JSON'} />}
            {readOnly ? (
              <Tooltip content="Read-only in this version. Writes to real clusters arrive in v2.">
                <Button size="sm" disabled>
                  Reprocess to topic
                </Button>
              </Tooltip>
            ) : (
              <Button
                size="sm"
                onClick={() => url.set({ produce: 1, reprocess: `${topic}:${p}:${o}` })}
              >
                Reprocess to topic
              </Button>
            )}
            <Tooltip content="Tracing a key across topics arrives in v2.">
              <Button size="sm" variant="ghost" disabled>
                Trace key
              </Button>
            </Tooltip>
          </>
        )
      }
    >
      {!m && (
        <p className="text-[13px] text-ink-muted">
          {fetched.isLoading || fetched.isPlaceholderData
            ? 'Loading message…'
            : fetched.error
              ? `Couldn't load the message: ${(fetched.error as Error).message} Close the drawer and try again.`
              : `No message at offset ${formatInt(Number(o))} on partition ${p}: it's past the end of the partition or no longer retained.`}
        </p>
      )}
      {m && d && (
        <div className="flex flex-col gap-4">
          <dl className="m-0 grid grid-cols-[100px_1fr] gap-y-2 text-[13px]">
            <Row k="Partition">
              <span className="font-mono">
                {m.partition} · offset {formatInt(m.offset)}
              </span>
            </Row>
            <Row k="Timestamp">
              {/* local time like the table; the exact UTC value alongside */}
              <span className="font-mono">
                {formatTimestamp(m.timestamp)}
                <span className="ml-2 text-ink-muted">{m.timestamp}</span>
              </span>
            </Row>
            <Row k="Key">
              <span className="font-mono break-all">
                {d.key.ok
                  ? d.key.value === null
                    ? 'null'
                    : shownName(keyText(d.key))
                  : 'undecodable'}
              </span>
            </Row>
            <Row k="Schema">
              <span className="font-mono">
                {d.value.ok && d.value.schema
                  ? `${d.value.schema.subject} v${d.value.schema.version} · id ${d.value.schema.id}`
                  : !d.value.ok && d.value.schema
                    ? `${d.value.schema.subject} v${d.value.schema.version} · id ${d.value.schema.id} (doesn't match the bytes)`
                    : !d.value.ok && d.value.schemaId
                      ? `id ${d.value.schemaId} (not in registry)`
                      : `none · ${d.value.ok ? d.value.format : 'unknown'}`}
              </span>
            </Row>
            <Row k="Headers">
              <span className="font-mono break-all">
                {Object.entries(d.headers)
                  .map(([k, v]) => shownName(`${k}=${v}`))
                  .join(' · ') || '—'}
              </span>
            </Row>
            <Row k="Size">
              <span className="font-mono tabular-nums">{formatInt(m.sizeBytes)} B</span>
            </Row>
          </dl>
          {d.value.ok ? (
            <>
              <div className="rounded-md border border-line bg-surface-sunken p-3">
                {typeof d.shown === 'object' && d.shown !== null ? (
                  <JsonTree
                    value={d.shown}
                    show={shownName}
                    masked={new Set(d.masked.map((x) => x.path))}
                    onCopyPath={(path) =>
                      navigator.clipboard?.writeText(path).catch(() => undefined)
                    }
                  />
                ) : (
                  <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[12px]">
                    {String(d.shown)}
                  </pre>
                )}
              </div>
              {d.masked.length > 0 && (
                <p className="m-0 text-[12px] text-ink-muted">
                  {d.masked.length} field{d.masked.length > 1 ? 's' : ''} masked by the rule
                  {new Set(d.masked.map((x) => x.rule)).size > 1 ? 's' : ''}{' '}
                  {[...new Set(d.masked.map((x) => `“${x.rule}”`))].join(', ')}. Masking is a
                  display feature, not a security control.
                </p>
              )}
            </>
          ) : (
            <>
              <div role="alert" className="rounded-md border border-crit-soft bg-crit-soft p-3">
                <div className="font-semibold text-crit-text">{d.value.reason}</div>
                <p className="m-0 mt-1 text-[13px] text-ink">{d.value.detail}</p>
              </div>
              <HexDump
                caption={`Raw value · ${m.value?.length ?? 0} bytes`}
                lines={hexDump(m.value ?? new Uint8Array()).slice(0, 16)}
                annotations={d.value.annotations}
              />
              <div>
                <div className="mb-2 text-[12px] font-medium text-ink-muted">Try another way</div>
                <div className="flex flex-wrap gap-2">
                  {topicInfo.data?.schema?.valueSubject && d.value.schemaId !== undefined && (
                    <Button size="sm" onClick={tryLatest}>
                      Decode with latest {topicInfo.data.schema.valueSubject}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => url.set({ dv: 'text' })}>
                    Show as text
                  </Button>
                  <Button size="sm" onClick={() => url.set({ dv: 'hex' })}>
                    Show as hex
                  </Button>
                  <CopyButton text={d.value.hex} label="Copy hex" />
                </div>
                {alt && (
                  <div className="mt-3 rounded-md border border-line bg-surface-sunken p-3">
                    <div className="mb-2 text-[12px] text-ink-muted">{alt.label}</div>
                    {typeof alt.value === 'object' ? (
                      <JsonTree value={alt.value} show={shownName} />
                    ) : (
                      <p className="m-0 text-[13px]">{String(alt.value)}</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <>
    <dt className="text-ink-muted">{k}</dt>
    <dd className="m-0">{children}</dd>
  </>
);
