import { expect, test } from 'vitest';
import { shareUrl } from './url';

test('a copied link names its cluster, keeping the page and its other parameters', () => {
  expect(shareUrl('https://ki.example/app/topics/orders/?tab=messages', 'prod-us-2')).toBe(
    'https://ki.example/app/topics/orders/?tab=messages&c=prod-us-2',
  );
  // already there (opened from a ?c= link): replaced, not doubled
  expect(shareUrl('https://ki.example/app/groups/billing/?c=old', 'prod-us-2')).toBe(
    'https://ki.example/app/groups/billing/?c=prod-us-2',
  );
});
