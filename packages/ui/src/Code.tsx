'use client';
import { useState, type ReactNode } from 'react';
import { cx } from './cx';

/** Copy button: icon swaps to a check for 1.2 s with a cross-fade (MOTION.md "Copy actions"). */
export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string | (() => string);
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
      className={cx(
        'inline-flex h-control-sm cursor-pointer items-center gap-[6px] rounded-md border border-line bg-surface px-3 text-[12px] font-semibold text-ink transition-colors duration-instant ease-standard hover:bg-surface-hover',
        className,
      )}
    >
      <span aria-hidden="true" className="relative inline-block w-3 text-center">
        <span
          className={cx(
            'absolute inset-0 transition-opacity duration-fast',
            done ? 'opacity-0' : 'opacity-100',
          )}
        >
          ⧉
        </span>
        <span
          className={cx(
            'text-ok transition-opacity duration-fast',
            done ? 'opacity-100' : 'opacity-0',
          )}
        >
          ✓
        </span>
      </span>
      <span aria-live="polite">{done ? 'Copied' : label}</span>
    </button>
  );
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Collapsible JSON tree. Chevron rotates on --dur-instant; children appear instantly (big trees). */
export function JsonTree({
  value,
  onCopyPath,
  masked,
}: {
  value: unknown;
  onCopyPath?: (path: string) => void;
  masked?: Set<string>;
}) {
  return (
    // not role="tree": that promises arrow-key navigation; this is nested content with real toggle buttons
    <div className="font-mono text-[12px] leading-[20px]">
      <Node k={null} v={value as Json} path="$" depth={0} onCopyPath={onCopyPath} masked={masked} />
    </div>
  );
}

// a 100k-item array must not mount 100k rows at once
const MAX_CHILDREN = 200;

function Node({
  k,
  v,
  path,
  depth,
  onCopyPath,
  masked,
}: {
  k: string | null;
  v: Json;
  path: string;
  depth: number;
  onCopyPath?: (p: string) => void;
  masked?: Set<string>;
}) {
  const [open, setOpen] = useState(depth < 2);
  const [all, setAll] = useState(false);
  const label = k === null ? '' : /^\d+$/.test(k) ? k : `"${k}"`;
  // a control only when it does something
  const key =
    k !== null &&
    (onCopyPath ? (
      <button
        type="button"
        onClick={() => onCopyPath(path)}
        title={`Copy path ${path}`}
        aria-label={`Copy path ${path}`}
        className="cursor-pointer border-none bg-transparent p-0 font-mono text-[12px] text-ink-muted hover:text-ink"
      >
        {label}:
      </button>
    ) : (
      <span className="text-ink-muted">{label}:</span>
    ));
  if (v !== null && typeof v === 'object') {
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v);
    const [o, c] = Array.isArray(v) ? ['[', ']'] : ['{', '}'];
    return (
      <div style={{ paddingLeft: depth ? 16 : 0 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${k === null ? 'value' : label}`}
          className="mr-1 inline-flex size-4 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-ink-muted"
        >
          <span
            aria-hidden="true"
            className={cx(
              'inline-block transition-transform duration-instant ease-standard motion-off:transition-none',
              open && 'rotate-90',
            )}
          >
            ›
          </span>
        </button>
        {key} <span className="text-ink-muted">{o}</span>
        {!open && (
          <span className="text-ink-muted">
            {' '}
            {entries.length} {Array.isArray(v) ? 'items' : 'keys'} {c}
          </span>
        )}
        {open && (
          <>
            <div>
              {(all ? entries : entries.slice(0, MAX_CHILDREN)).map(([ck, cv]) => (
                <Node
                  key={ck}
                  k={ck}
                  v={cv}
                  path={Array.isArray(v) ? `${path}[${ck}]` : `${path}.${ck}`}
                  depth={depth + 1}
                  onCopyPath={onCopyPath}
                  masked={masked}
                />
              ))}
              {!all && entries.length > MAX_CHILDREN && (
                <button
                  type="button"
                  onClick={() => setAll(true)}
                  style={{ paddingLeft: 36 }}
                  className="cursor-pointer border-none bg-transparent p-0 font-sans text-[12px] text-copper underline"
                >
                  Show all {entries.length.toLocaleString('en-US')}{' '}
                  {Array.isArray(v) ? 'items' : 'keys'}
                </button>
              )}
            </div>
            <span className="text-ink-muted" style={{ paddingLeft: 20 }}>
              {c}
            </span>
          </>
        )}
      </div>
    );
  }
  const isMasked = masked?.has(path);
  return (
    <div style={{ paddingLeft: depth ? 36 : 20 }}>
      {key} <Scalar v={v} />
      {isMasked && <span className="ml-2 font-sans text-[11px] text-ink-muted">masked</span>}
    </div>
  );
}

function Scalar({ v }: { v: Json }) {
  // rule 4: status colours mean status only, so syntax uses ink / copper / muted
  if (typeof v === 'string') return <span className="break-all text-ink">&quot;{v}&quot;</span>;
  if (typeof v === 'number') return <span className="text-copper">{v}</span>;
  return <span className="italic text-ink-muted">{String(v)}</span>;
}

export interface HexAnnotation {
  start: number;
  end: number;
  label: string;
}

/** Annotated hex dump (F-46): highlighted ranges with a legend. */
export function HexDump({
  lines,
  annotations = [],
  caption,
}: {
  lines: Array<{ offset: number; bytes: number[]; ascii: string }>;
  annotations?: HexAnnotation[];
  caption?: ReactNode;
}) {
  const tone = [
    'bg-copper-soft text-copper',
    'bg-surface-hover text-ink underline decoration-copper underline-offset-2',
    'bg-surface-hover text-ink',
  ];
  const toneOf = (i: number) => annotations.findIndex((a) => i >= a.start && i < a.end);
  return (
    <figure className="m-0">
      {caption && <figcaption className="mb-2 text-[12px] text-ink-muted">{caption}</figcaption>}
      <div
        tabIndex={0}
        className="overflow-x-auto rounded-md border border-line bg-surface-sunken p-3 font-mono text-[11px] leading-[18px]"
      >
        {lines.map((l) => (
          <div key={l.offset} className="flex gap-4 whitespace-pre">
            <span className="text-ink-subtle">{l.offset.toString(16).padStart(4, '0')}</span>
            <span>
              {l.bytes.map((b, j) => {
                const a = toneOf(l.offset + j);
                return (
                  <span key={j} className={cx(a >= 0 && tone[a % tone.length], 'px-[1px]')}>
                    {b.toString(16).padStart(2, '0')}
                    {j === 7 ? '  ' : ' '}
                  </span>
                );
              })}
            </span>
            <span className="text-ink-muted">{l.ascii}</span>
          </div>
        ))}
      </div>
      {annotations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-ink-muted">
          {annotations.map((a, i) => (
            <span key={a.label} className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className={cx('inline-block size-[10px] rounded-[2px]', tone[i % tone.length])}
              />
              {a.label}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
