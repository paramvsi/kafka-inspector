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
