'use client';
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

export const useSavedClusters = () => useLocal<SavedCluster[]>('ki-saved-clusters', []);
