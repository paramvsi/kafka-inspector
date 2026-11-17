import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { buildTokens } from './build-tokens.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const generated = buildTokens(JSON.parse(read('../tokens/tokens.json')));

test('committed tokens.css is up to date with tokens.json (run `pnpm tokens`)', () => {
  expect(read('../tokens/tokens.css')).toBe(generated);
});

test('chart series colours reach 3:1 against the card surface in both themes (WCAG 1.4.11)', () => {
  const css = read('../tokens/tokens.css');
  const theme = (sel: string) => {
    const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    return (name: string) =>
      /#[0-9a-f]{6}/i.exec(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)![1]!)![0];
  };
  const lum = (h: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) =>
    (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const sel of [':root, [data-theme="dark"]', '[data-theme="light"]']) {
    const t = theme(sel);
    for (const s of ['chart-1', 'chart-2', 'chart-3'])
      expect({ sel, s, ok: ratio(t(s), t('surface')) >= 3 }).toEqual({ sel, s, ok: true });
  }
});
