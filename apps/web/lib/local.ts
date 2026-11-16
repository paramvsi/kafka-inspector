'use client';
// Per-viewer conveniences in localStorage (starred topics, masking rules, saved filters in demo). Always try/catch.
// Every hook instance for a key stays in sync: in this tab via an event, in other tabs via `storage`.
import { useCallback, useEffect, useRef, useState } from 'react';

const EVENT = 'ki-local';

const sameShape = (a: unknown, b: unknown) =>
  Array.isArray(b)
    ? Array.isArray(a)
    : b === null || (typeof a === typeof b && a !== null && !Array.isArray(a));

export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  const init = useRef(initial);
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return setV(init.current); // removed here or in another tab
        const parsed: unknown = JSON.parse(raw);
        // a value of another shape (hand-edited, an older version) is ignored, never trusted
        setV(sameShape(parsed, init.current) ? (parsed as T) : init.current);
      } catch {
        setV(init.current); // unparseable or storage blocked
      }
    };
    read();
    const onLocal = (e: Event) => (e as CustomEvent<string>).detail === key && read();
    const onStorage = (e: StorageEvent) => (e.key === key || e.key === null) && read(); // null: cleared
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
