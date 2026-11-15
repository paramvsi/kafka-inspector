// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

test('one real button per option, aria-pressed follows the selection, onChange reports it', () => {
  const onChange = vi.fn();
  const { getByRole } = render(
    <SegmentedControl
      label="Time range"
      options={['15m', '1h', '24h', '7d']}
      defaultValue="1h"
      onChange={onChange}
    />,
  );
  expect(getByRole('group', { name: 'Time range' })).toBeTruthy();
  expect(getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(getByRole('button', { name: '24h' }));

  expect(onChange).toHaveBeenCalledWith('24h');
  expect(getByRole('button', { name: '24h' }).getAttribute('aria-pressed')).toBe('true');
  expect(getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('false');
});
