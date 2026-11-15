'use client';
// Per-viewer conveniences in localStorage (starred topics, saved filters in demo). Always try/catch.
import { useCallback, useEffect, useState } from 'react';

export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setV(JSON.parse(raw) as T);
    } catch {
      /* storage blocked */
    }
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* not persisted */
      }
    },
    [key],
  );
  return [v, set];
}
