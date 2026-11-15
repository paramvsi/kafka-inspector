// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Select } from './Form';
import { Tooltip } from './Feedback';

test('Select links its error; with hideLabel the error still shows', () => {
  const opts = [{ value: 'a', label: 'A' }];
  const { getByRole, getByText, rerender } = render(
    <Select label="Cluster" error="Pick a cluster" options={opts} />,
  );
  const s = getByRole('combobox');
  expect(s.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(s.getAttribute('aria-describedby')!)?.textContent).toBe(
    'Pick a cluster',
  );
  rerender(<Select label="Cluster" hideLabel error="Pick a cluster" options={opts} />);
  expect(getByText('Pick a cluster')).toBeTruthy();
});

test('Tooltip keeps the control’s own description', () => {
  const { getByRole } = render(
    <Tooltip content="tip">
      <button type="button" aria-describedby="own">
        x
      </button>
    </Tooltip>,
  );
  expect(getByRole('button').getAttribute('aria-describedby')).toMatch(/^own \S+$/);
});
