import { expect, test } from 'vitest';
import { locate, navFor } from './nav';

const keys = (mode: 'demo' | 'self') => navFor(mode).flatMap((s) => s.items.map((i) => i.key));

test('demo shows Chaos panel and Run on your Kafka; self-hosted hides them', () => {
  expect(keys('demo')).toEqual([
    'overview',
    'brokers',
    'topics',
    'groups',
    'schemas',
    'topology',
    'alerts',
    'chaos',
    'clusters',
    'selfhost',
  ]);
  expect(keys('self')).toEqual([
    'overview',
    'brokers',
    'topics',
    'groups',
    'schemas',
    'topology',
    'alerts',
    'clusters',
  ]);
});

test('detail routes keep their section active and show it as the parent crumb', () => {
  expect(locate('/app/topics/view/')).toEqual({
    active: 'topics',
    parent: 'Topics',
    crumb: 'Topic',
  });
  expect(locate('/app/groups/view')).toEqual({
    active: 'groups',
    parent: 'Consumer groups',
    crumb: 'Consumer group',
  });
});

test('unknown paths do not mark any nav item active', () => {
  expect(locate('/app/nope/')).toEqual({ crumb: 'Not found' });
});
