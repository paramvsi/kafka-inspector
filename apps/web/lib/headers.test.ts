import { expect, test } from 'vitest';
import { joinHeaders } from './headers';

const enc = new TextEncoder();
const td = new TextDecoder();

test('a header named like an object built-in reads as its own value; repeated keys join', () => {
  const h = joinHeaders(
    [
      { key: 'toString', value: enc.encode('x') },
      { key: 'region', value: enc.encode('eu') },
      { key: 'region', value: enc.encode('us') },
    ],
    (b) => td.decode(b),
  );
  expect(h.toString).toBe('x');
  expect(h.region).toBe('eu, us');
});
