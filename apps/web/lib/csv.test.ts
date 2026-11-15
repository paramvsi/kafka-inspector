import { expect, test } from 'vitest';
import { csvCell } from './csv';

test('quotes per RFC 4180 and neutralises formulas', () => {
  expect(csvCell({ a: 'x"y' })).toBe('"{""a"":""x\\""y""}"');
  expect(csvCell('plain')).toBe('plain');
  expect(csvCell('a,b')).toBe('"a,b"');
  expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
  expect(csvCell(-5)).toBe("'-5");
  expect(csvCell(null)).toBe('');
});
