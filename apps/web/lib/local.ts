'use client';
// Per-viewer conveniences in localStorage (starred topics, masking rules, saved filters in demo). Always try/catch.
// Every hook instance for a key stays in sync: in this tab via an event, in other tabs via `storage`.
import { useCallback, useEffect, useState } from 'react';

const EVENT = 'ki-local';

export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) setV(JSON.parse(raw) as T);
      } catch {
        /* storage blocked */
      }
    };
    read();
    const onLocal = (e: Event) => (e as CustomEvent<string>).detail === key && read();
    const onStorage = (e: StorageEvent) => e.key === key && read();
    window.addEventListener(EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
      } catch {
        /* not persisted */
      }
    },
    [key],
  );
  return [v, set];
}
