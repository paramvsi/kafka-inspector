'use client';
// Every view, tab, filter and selection lives in the URL (F-04).
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

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
    (patch: Record<string, string | number | undefined | null>, path = pathname) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      const qs = next.toString();
      return `${path}${qs ? `?${qs}` : ''}`;
    },
    [params, pathname],
  );
  return { params, get, set, hrefWith };
}
