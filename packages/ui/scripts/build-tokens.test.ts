import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { buildTokens } from './build-tokens.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const generated = buildTokens(JSON.parse(read('../tokens/tokens.json')));

test('committed tokens.css is up to date with tokens.json (run `pnpm tokens`)', () => {
  expect(read('../tokens/tokens.css')).toBe(generated);
});
