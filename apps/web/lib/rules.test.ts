import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

// CLAUDE.md rules 1 and 2, as a scan: UI code talks only to KafkaClient, and colours come from tokens
const root = join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory()
      ? files(p)
      : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)
        ? [p]
        : [];
  });
const ui = [
  ...files(join(root, 'app')),
  ...files(join(root, 'components')),
  ...files(join(root, '../../packages/ui/src')),
];

test('UI code never fetches, opens a WebSocket or imports the simulator directly (rule 1)', () => {
  const bad = ui.filter((f) =>
    /\bfetch\(|new WebSocket\(|from '@ki\/simulator'|from '\.\.\/.*simulator/.test(
      readFileSync(f, 'utf8'),
    ),
  );
  expect(bad.map((f) => f.slice(root.length))).toEqual([]);
});

test('UI code uses design tokens, never hex colours (rule 2)', () => {
  const hex = /(?<![\w&-])#[0-9a-fA-F]{3,8}\b(?![\w-])/;
  const bad = ui.filter((f) =>
    hex.test(readFileSync(f, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')),
  );
  expect(bad.map((f) => f.slice(root.length))).toEqual([]);
});
