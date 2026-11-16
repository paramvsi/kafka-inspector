// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HexDump } from './Code';

test('the hex dump is a named region and annotated bytes name their range, not only a colour', () => {
  const r = render(
    <HexDump
      lines={[{ offset: 0, bytes: [0, 0, 0, 0, 112], ascii: '....p' }]}
      annotations={[
        { start: 0, end: 1, label: 'magic byte' },
        { start: 1, end: 5, label: 'schema id' },
      ]}
    />,
  );
  expect(r.getByRole('region', { name: 'Hex dump' })).toBeTruthy();
  expect(r.getAllByTitle('schema id')).toHaveLength(4);
});
