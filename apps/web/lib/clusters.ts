'use client';
import { useEffect } from 'react';
import { useLocal } from './local';
import { USERINFO, withoutUserinfo } from './selfhost';

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
  c.url && USERINFO.test(c.url) ? { ...c, url: withoutUserinfo(c.url) } : c;

export function useSavedClusters() {
  const [saved, setSaved] = useLocal<SavedCluster[]>('ki-saved-clusters', []);
  // a hand-edited or older entry ([null], {"id":"x"}) is dropped, never trusted: one bad item mustn't break every page
  const valid = saved.filter(
    (c): c is SavedCluster =>
      !!c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string',
  );
  const list = valid.map(clean);
  const dirty = valid.length !== saved.length || list.some((c, i) => c !== valid[i]);
  useEffect(() => {
    if (dirty) setSaved(list); // rewrite the stored copy too
  }, [dirty]);
  return [list, setSaved] as const;
}
