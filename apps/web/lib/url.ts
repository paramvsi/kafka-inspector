'use client';
// Every view, tab, filter and selection lives in the URL (F-04).
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = useCallback((k: string) => params.get(k) ?? undefined, [params]);
  const set = useCallback(
    (
      patch: Record<string, string | number | undefined | null | false>,
      mode: 'replace' | 'push' = 'replace',
    ) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '' || v === false) next.delete(k);
        else next.set(k, String(v));
      }
      const qs = next.toString();
      router[mode](`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [params, router, pathname],
  );
  /** href for the same page with a patch applied (for links and tabs). */
  const hrefWith = useCallback(
    (patch: Record<string, string | number | undefined | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      const qs = next.toString();
      return `${pathname}${qs ? `?${qs}` : ''}`;
    },
    [params, pathname],
  );
  return { params, get, set, hrefWith };
}

/**
 * A text input bound to one URL param. The input keeps its own text, so fast typing never loses characters
 * while the router applies the URL asynchronously; a URL change it didn't make (back, a link) replaces the text.
 */
export function useUrlText(key: string, extra?: Record<string, undefined>) {
  const url = useUrl();
  const fromUrl = url.get(key) ?? '';
  const [text, setText] = useState(fromUrl);
  // every value this input wrote: the router can deliver them late and out of order, so only a value we
  // never wrote (back, a link, Reset) replaces the text
  const wrote = useRef(new Set([fromUrl]));
  const latest = useRef(fromUrl);
  useEffect(() => {
    if (fromUrl === latest.current)
      wrote.current = new Set([fromUrl]); // caught up: forget older writes
    else if (wrote.current.has(fromUrl))
      return; // an older write of ours arriving late
    else {
      wrote.current = new Set([fromUrl]);
      latest.current = fromUrl;
      setText(fromUrl);
    }
  }, [fromUrl]);
  const onChange = (v: string) => {
    setText(v);
    latest.current = v;
    wrote.current.add(v);
    url.set({ [key]: v, ...extra });
  };
  return [text, onChange] as const;
}

/** A URL value from a fixed set, or the fallback: a hand-edited or stale link never reaches the views as junk. */
export const pick = <T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T => (allowed.includes(v as T) ? (v as T) : fallback);
