// @vitest-environment happy-dom
import { fireEvent, render, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { JsonTree } from './Code';

test('large arrays render 200 items until asked; toggles name their key; inert keys are not buttons', () => {
  const big = { items: Array.from({ length: 5000 }, (_, i) => i) };
  const { getByRole, queryAllByText, queryByRole } = render(<JsonTree value={big} />);
  expect(getByRole('button', { name: 'Collapse "items"' }).getAttribute('aria-expanded')).toBe(
    'true',
  );
  expect(queryAllByText(/^\d+:$/).length).toBe(200);
  fireEvent.click(getByRole('button', { name: 'Show all 5,000 items' }));
  expect(queryAllByText(/^\d+:$/).length).toBe(5000);
  expect(queryByRole('button', { name: /^Copy path/ })).toBeNull();
});

test('a huge array reveals 5,000 more per click, never all 100,000 at once', () => {
  const big = { items: Array.from({ length: 100_000 }, (_, i) => i) };
  const { container } = render(<JsonTree value={big} />);
  const t = within(container); // only this render: the test above leaves its tree mounted
  fireEvent.click(t.getByRole('button', { name: /^Show (all|5,000 more)/ }));
  expect(t.queryAllByText(/^\d+:$/).length).toBe(5200);
});

test('a top-level array of many objects opens closed: 200 rows, not every field of every object', () => {
  const rec = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, i]));
  const { container } = render(
    <JsonTree value={Array.from({ length: 200 }, () => ({ ...rec }))} />,
  );
  const t = within(container);
  expect(t.queryAllByText(/^"f\d+":$/).length).toBe(0); // was 200 × 30 = 6,000 field rows on open
  expect(t.queryAllByText(/^\d+:$/).length).toBe(200);
  // a small one still opens two levels, as before
  const small = render(<JsonTree value={[{ a: 1, b: 2 }]} />);
  expect(within(small.container).queryAllByText(/^"[ab]":$/).length).toBe(2);
});
