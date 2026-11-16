// @vitest-environment happy-dom
import { render, within } from '@testing-library/react';
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

test('a short last row keeps the text column in line with full rows', () => {
  const full = Array.from({ length: 16 }, (_, i) => i);
  const r = render(
    <HexDump
      lines={[
        { offset: 0, bytes: full, ascii: '................' },
        { offset: 16, bytes: [1, 2, 3, 4, 5], ascii: '.....' },
      ]}
      annotations={[]}
    />,
  );
  const rows = [...within(r.container).getByRole('region', { name: 'Hex dump' }).children]; // this render only
  const hex = rows.map((row) => row.children[1]!.textContent!.length);
  expect(hex[1]).toBe(hex[0]);
});
