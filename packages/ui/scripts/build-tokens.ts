// Generates tokens/tokens.css from tokens/tokens.json (run: pnpm tokens).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Themed = { name: string; value: { dark: string; light: string } };
type Plain = { name: string; value: string };
type Style = {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
};
type Tokens = {
  color: { tokens: Themed[] };
  shadow: { tokens: Themed[] };
  spacing: { tokens: Plain[] };
  radius: { tokens: Plain[] };
  size: { tokens: Plain[] };
  type: {
    families: Record<'sans' | 'mono', string>;
    groups: { family: 'sans' | 'mono'; styles: Style[] }[];
  };
  motion: {
    duration: Record<string, string>;
    easing: Record<string, string>;
    distance: Record<string, string>;
    reduced: { overrides: Record<string, string> };
  };
};

const decl =
  (indent: string) =>
  ([k, v]: [string, string]) =>
    `${indent}--${k}: ${v};`;

export function buildTokens(t: Tokens): string {
  const themed = [...t.color.tokens, ...t.shadow.tokens];
  const theme = (mode: 'dark' | 'light') => themed.map((x) => `  --${x.name}: ${x.value[mode]};`);
  const plain = [...t.spacing.tokens, ...t.radius.tokens, ...t.size.tokens].map(
    (x) => `  --${x.name}: ${x.value};`,
  );
  const styles = t.type.groups.flatMap((g) =>
    g.styles.map(
      (s) =>
        `.${s.name} { font-family: var(--font-${g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ''} }`,
    ),
  );
  // Duration keys map to CSS names: flash → --flash-dur, pulse-period → --pulse-period, others → --dur-*.
  const durName = (k: string) =>
    k === 'flash' ? 'flash-dur' : k === 'pulse-period' ? k : `dur-${k}`;
  const motion: [string, string][] = [
    ...Object.entries(t.motion.duration)
      .filter(([k]) => k !== 'flash' && k !== 'pulse-period')
      .map(([k, v]): [string, string] => [durName(k), v]),
    ['flash-dur', t.motion.duration['flash'] ?? ''],
    ['pulse-period', t.motion.duration['pulse-period'] ?? ''],
    ...Object.entries(t.motion.easing).map(([k, v]): [string, string] => [`ease-${k}`, v]),
    ...Object.entries(t.motion.distance).map(([k, v]): [string, string] => [`move-${k}`, v]),
  ];
  const reduced = Object.entries(t.motion.reduced.overrides);

  return [
    '/* Copper Oxide — generated from tokens.json */',
    ':root, [data-theme="dark"] {',
    ...theme('dark'),
    '}',
    '[data-theme="light"] {',
    ...theme('light'),
    '}',
    ':root {',
    ...plain,
    `  --font-sans: ${t.type.families.sans};`,
    `  --font-mono: ${t.type.families.mono};`,
    '}',
    ...styles,
    '',
    '/* Motion — see docs/MOTION.md */',
    ':root {',
    ...motion.map(decl('  ')),
    '}',
    '[data-motion="reduced"] {',
    ...reduced.map(decl('  ')),
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root:not([data-motion="full"]) {',
    ...reduced.map(decl('    ')),
    '  }',
    '}',
    '',
  ].join('\n');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = new URL('../tokens/', import.meta.url);
  const tokens = JSON.parse(readFileSync(new URL('tokens.json', dir), 'utf8')) as Tokens;
  writeFileSync(new URL('tokens.css', dir), buildTokens(tokens));
  process.stdout.write('tokens.css written\n');
}
