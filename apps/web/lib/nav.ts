import type { NavSection } from '@ki/ui';

export type Mode = 'demo' | 'self';

const DEMO_ONLY = new Set(['chaos', 'selfhost']);

const SECTIONS: NavSection[] = [
  {
    title: 'Monitor',
    items: [
      { key: 'overview', label: 'Overview', href: '/app/' },
      { key: 'brokers', label: 'Brokers', href: '/app/brokers/' },
      { key: 'topics', label: 'Topics', href: '/app/topics/' },
      { key: 'groups', label: 'Consumer groups', href: '/app/groups/' },
    ],
  },
  {
    title: 'Data',
    items: [
      { key: 'schemas', label: 'Schemas', href: '/app/schemas/' },
      { key: 'topology', label: 'Topology', href: '/app/topology/' },
    ],
  },
  {
    title: 'Operate',
    items: [
      { key: 'alerts', label: 'Alerts', href: '/app/alerts/' },
      { key: 'chaos', label: 'Chaos panel', href: '/app/chaos/' },
      { key: 'clusters', label: 'Clusters', href: '/app/clusters/' },
      { key: 'selfhost', label: 'Run on your Kafka', href: '/app/self-host/' },
    ],
  },
];

/** Sidebar sections for a mode (F-01: Chaos panel and Run on your Kafka are demo only). */
type Counts = { brokers: number; topics: number; groups: number; alerts: number };

/** Sidebar sections for a mode (F-01: Chaos panel and Run on your Kafka are demo only), with live counts. */
export const navFor = (mode: Mode, counts?: Counts): NavSection[] =>
  SECTIONS.map((s) => ({
    ...s,
    items: s.items
      .filter((i) => mode === 'demo' || !DEMO_ONLY.has(i.key))
      .map((i) => {
        if (!counts) return i;
        if (i.key === 'brokers') return { ...i, count: counts.brokers };
        if (i.key === 'topics') return { ...i, count: counts.topics };
        if (i.key === 'groups') return { ...i, count: counts.groups };
        if (i.key === 'alerts' && counts.alerts > 0)
          return { ...i, count: counts.alerts, countTone: 'crit' as const };
        return i;
      }),
  }));

// Breadcrumb copy follows the Topbar references (e.g. "Run on your own Kafka").
const CRUMBS: Record<string, { active?: string; crumb: string; parent?: string }> = {
  '/app/': { active: 'overview', crumb: 'Overview' },
  '/app/brokers/': { active: 'brokers', crumb: 'Brokers' },
  '/app/topics/': { active: 'topics', crumb: 'Topics' },
  '/app/topics/view/': { active: 'topics', parent: 'Topics', crumb: 'Topic' },
  '/app/groups/': { active: 'groups', crumb: 'Consumer groups' },
  '/app/groups/view/': { active: 'groups', parent: 'Consumer groups', crumb: 'Consumer group' },
  '/app/schemas/': { active: 'schemas', crumb: 'Schemas' },
  '/app/topology/': { active: 'topology', crumb: 'Topology' },
  '/app/alerts/': { active: 'alerts', crumb: 'Alerts' },
  '/app/chaos/': { active: 'chaos', crumb: 'Chaos panel' },
  '/app/clusters/': { active: 'clusters', crumb: 'Clusters' },
  '/app/self-host/': { active: 'selfhost', crumb: 'Run on your own Kafka' },
};

/** Location for a pathname; tolerates a missing trailing slash (dev server) and unknown paths. */
export function locate(pathname: string): { active?: string; crumb: string; parent?: string } {
  const key = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return CRUMBS[key] ?? { crumb: 'Not found' };
}
