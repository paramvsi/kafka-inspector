// User regexes run on the demo's worker thread, which can't be interrupted: the agent's 50 ms match budget
// (SafeRegex.java) isn't possible here, so the shapes that backtrack exponentially are refused up front.
// ponytail: catches nested quantifiers like (a+)+, (\w*)* and ((a)+b)+ — the classic cases — not every slow
// pattern: overlapping alternation such as (a|aa)+ still gets through (needs a step budget to catch).
function nested(source: string): boolean {
  // escapes and classes are single atoms, and an exact {n} on an atom doesn't multiply paths; on a group it repeats
  // the group like + does, so (.*a){12} counts as (.*a)+
  let s = source
    .replace(/\\./g, 'e')
    .replace(/\[[^\]]*\]/g, 'e')
    .replace(/\)\{\d+\}/g, ')+')
    .replace(/\{\d+\}/g, '');
  for (;;) {
    if (/\([^()]*[+*}][^()]*\)\s*(?:[+*]|\{\d+,\d*\})/.test(s)) return true;
    // collapse innermost groups to one atom, quantified if anything inside or on it repeats
    const t = s.replace(
      /\(([^()]*)\)(\s*(?:[+*?]|\{\d+,?\d*\}))?/g,
      (_, body: string, q?: string) => (/[+*}]/.test(body) || (q && /[+*,]/.test(q)) ? 'e+' : 'e'),
    );
    if (t === s) return false;
    s = t;
  }
}

/** Same limits and messages as the agent's SafeRegex.compile. */
export function safeRegex(source: string, flags = ''): RegExp {
  if (source.length > 200) throw new Error('Regular expressions are limited to 200 characters.');
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
  } catch {
    throw new Error(`Invalid regular expression: ${source}`);
  }
  if (nested(source))
    throw new Error('That regular expression takes too long to match. Simplify it.');
  return re;
}
