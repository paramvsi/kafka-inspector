import type { GroupSummary, KafkaClient, SubjectSummary, TopicSummary } from '@ki/core';

export interface PaletteData {
  topics: TopicSummary[];
  groups: GroupSummary[];
  subjects: SubjectSummary[];
  /** topics or groups couldn't be read (agent down, a call failed) */
  failed: boolean;
}

/** What the command palette searches; each list stands alone, so one failing call doesn't empty the others. */
export async function loadPaletteData(
  client: KafkaClient,
  clusterId: string,
): Promise<PaletteData> {
  let failed = false;
  const or = <T>(p: Promise<T>, empty: T, counts = true) =>
    p.catch(() => {
      if (counts) failed = true;
      return empty;
    });
  const [t, g, s] = await Promise.all([
    or(client.listTopics(clusterId, { size: 500, sort: 'name' }), {
      items: [] as TopicSummary[],
      total: 0,
      page: 1,
      size: 0,
    }),
    or(client.listGroups(clusterId), [] as GroupSummary[]),
    or(client.listSubjects(clusterId), [] as SubjectSummary[], false), // no registry is normal, not a failure
  ]);
  return { topics: t.items, groups: g, subjects: s, failed };
}
