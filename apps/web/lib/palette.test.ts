import type { KafkaClient } from '@ki/core';
import { expect, test } from 'vitest';
import { loadPaletteData } from './palette';

test('a failing groups call keeps the topics and says the lists are incomplete', async () => {
  const client = {
    listTopics: async () => ({ items: [{ name: 'orders' }], total: 1, page: 1, size: 500 }),
    listGroups: async () => {
      throw new Error('agent unreachable');
    },
    listSubjects: async () => [],
  } as unknown as KafkaClient;
  const d = await loadPaletteData(client, 'c');
  expect(d.topics.map((t) => t.name)).toEqual(['orders']);
  expect(d.failed).toBe(true);
});
