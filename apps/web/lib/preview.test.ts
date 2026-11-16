import { expect, test } from 'vitest';
import { previewLabel } from './preview';

test('no preview support is said, not shown as 0; errors are said', () => {
  expect(previewLabel(null, undefined)).toBe("Preview isn't available on this cluster");
  expect(previewLabel(undefined, new Error('x'))).toMatch(/Couldn't run the preview/);
  expect(previewLabel(undefined, undefined)).toBe('…');
  expect(previewLabel({ firings: 1 }, undefined)).toBe('Would have fired 1 time');
});
