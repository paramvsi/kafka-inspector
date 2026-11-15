// Rules 2 and 11 (CLAUDE.md): no hex colours, literal durations or easings outside the tokens.
// ponytail: regex scan, not an AST — good enough for source files; add a stylelint/eslint rule if it gets noisy.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['apps', 'packages'];
const skipDirs = new Set([
  'node_modules',
  '.next',
  'out',
  'coverage',
  'test-results',
  'playwright-report',
  'tokens',
  'agent',
]);
const exts = /\.(tsx?|css|m?js)$/;
const checks = [
  { name: 'hex colour', re: /#[0-9a-fA-F]{3,8}\b(?![\w-])/g },
  { name: 'literal duration', re: /(?<![\w-])\d+(\.\d+)?ms\b/g },
  { name: 'literal easing', re: /cubic-bezier\(/g },
];

const files = [];
const walk = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!skipDirs.has(e)) walk(p);
    } else if (exts.test(e)) files.push(p);
  }
};
roots.forEach(walk);

const hits = [];
for (const f of files) {
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (line.includes('literal-ok')) return; // escape hatch; must carry a reason
      for (const { name, re } of checks) {
        for (const m of line.matchAll(re))
          hits.push(`${relative('.', f)}:${i + 1}  ${name}: ${m[0]}`);
      }
    });
}
if (hits.length) {
  console.error(
    `check-literals: ${hits.length} literal(s) outside the tokens — use CSS variables:\n` +
      hits.join('\n'),
  );
  process.exit(1);
}
process.stdout.write(`check-literals: ${files.length} files clean\n`);
