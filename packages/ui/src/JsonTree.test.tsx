// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react';
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
