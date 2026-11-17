// Persistence for the demo's user changes (ARCHITECTURE "Storage"). The simulator replays the action log
// during back-fill, so a reload shows the same topics, produced messages and offset resets.
import type { AlertRule, SimSettings } from '@ki/core';

export interface Action {
  t: number;
  kind:
    | 'create-topic'
    | 'delete-topic'
    | 'update-config'
    | 'produce'
    | 'reset-offsets'
    | 'delete-group'
    | 'poison-fixed'
    | 'alert-ack';
  payload: unknown;
}

export interface Saved {
  actions: Action[];
  settings?: SimSettings;
  rules?: AlertRule[];
}

export interface Store {
  load(): Promise<Saved>;
  append(a: Action): Promise<void>;
  saveSettings(s: SimSettings): Promise<void>;
  saveRules(r: AlertRule[]): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryStore implements Store {
  saved: Saved = { actions: [] };
  async load() {
    return structuredClone(this.saved);
  }
  async append(a: Action) {
    this.saved.actions.push(structuredClone(a));
  }
  async saveSettings(s: SimSettings) {
    this.saved.settings = { ...s };
  }
  async saveRules(r: AlertRule[]) {
    this.saved.rules = structuredClone(r);
  }
  async clear() {
    this.saved = { actions: [] };
  }
}
