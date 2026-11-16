'use client';
import { useEffect } from 'react';
import { useLocal } from './local';

/** Saved connections in the demo (F-95). Never stores passwords (rule 6). */
export interface SavedCluster {
  id: string;
  name: string;
  color: 'chart-1' | 'chart-2' | 'chart-3';
  mode: 'local-agent' | 'simulated';
  url?: string;
  seed?: string;
  readOnly: boolean;
}

/** Drops a user name/password from a URL saved before that was refused, so it is neither shown nor kept. */
const clean = (c: SavedCluster): SavedCluster =>
  c.url && /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*@/i.test(c.url)
    ? { ...c, url: c.url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#\s]*@/i, '$1') }
    : c;

export function useSavedClusters() {
  const [saved, setSaved] = useLocal<SavedCluster[]>('ki-saved-clusters', []);
  const list = saved.map(clean);
  const dirty = list.some((c, i) => c !== saved[i]);
  useEffect(() => {
    if (dirty) setSaved(saved.map(clean)); // rewrite the stored copy too
  }, [dirty]);
  return [list, setSaved] as const;
}
