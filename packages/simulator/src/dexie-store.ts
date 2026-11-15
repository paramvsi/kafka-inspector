// IndexedDB (Dexie) store used by the worker. Actions older than 24 h are pruned on load.
import Dexie, { type Table } from 'dexie';
import type { AlertRule, SimSettings } from '@ki/core';
import type { Action, Saved, Store } from './store';

class Db extends Dexie {
  actions!: Table<Action & { id?: number }, number>;
  kv!: Table<{ k: string; v: unknown }, string>;
  constructor() {
    super('kafka-inspector-demo');
    this.version(1).stores({ actions: '++id, t', kv: 'k' });
  }
}

export class DexieStore implements Store {
  private db = new Db();
  async load(): Promise<Saved> {
    try {
      await this.db.actions
        .where('t')
        .below(Date.now() - 24 * 3600e3)
        .delete();
      const actions = await this.db.actions.orderBy('t').toArray();
      const settings = (await this.db.kv.get('settings'))?.v as SimSettings | undefined;
      const rules = (await this.db.kv.get('rules'))?.v as AlertRule[] | undefined;
      return { actions, settings, rules };
    } catch {
      return { actions: [] }; // IndexedDB blocked: run without persistence
    }
  }
  async append(a: Action) {
    await this.db.actions.add(a).catch(() => undefined);
  }
  async saveSettings(s: SimSettings) {
    await this.db.kv.put({ k: 'settings', v: s }).catch(() => undefined);
  }
  async saveRules(r: AlertRule[]) {
    await this.db.kv.put({ k: 'rules', v: r }).catch(() => undefined);
  }
  async clear() {
    await Promise.all([this.db.actions.clear(), this.db.kv.clear()]).catch(() => undefined);
  }
}
