// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { CopyButton } from './Code';

test('the copy result is a live region beside the button, not inside its name', () => {
  const { container, getByRole } = render(<CopyButton text="x" label="Copy JSON" />);
  // inside a button it joins the name ("Copied Copied") and isn't announced: buttons flatten their children
  expect(container.querySelector('button [role="status"]')).toBeNull();
  expect(getByRole('status').closest('button')).toBeNull();
  expect(getByRole('button').textContent).toBe('⧉✓Copy JSON');
});
