// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Sparkline } from './Sparkline';
import { StatusBadge } from './StatusBadge';

test('a status outside the known set still shows a word (never colour alone)', () => {
  const { container } = render(<StatusBadge status={'rebalancing' as never} />);
  expect(container.textContent?.trim()).not.toBe('');
});

test('one non-finite point in a sparkline is skipped, not a NaN line', () => {
  const { container } = render(<Sparkline points={[1, 2, NaN, 4, Infinity, 3]} />);
  const pts = container.querySelector('polyline')?.getAttribute('points') ?? '';
  expect(pts).not.toContain('NaN');
  expect(pts.trim().split(/\s+/)).toHaveLength(4);
});
