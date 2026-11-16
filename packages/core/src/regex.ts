// User regexes run on the demo's worker thread, which can't be interrupted: the agent's 50 ms match budget
// (SafeRegex.java) isn't possible here, so the shapes that backtrack exponentially are refused up front.
// ponytail: catches nested quantifiers like (a+)+ and (\w*)* — the classic cases — not every slow pattern.
const NESTED = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,\d*\})/;

/** Same limits and messages as the agent's SafeRegex.compile. */
export function safeRegex(source: string, flags = ''): RegExp {
  if (source.length > 200) throw new Error('Regular expressions are limited to 200 characters.');
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
  } catch {
    throw new Error(`Invalid regular expression: ${source}`);
  }
  if (NESTED.test(source))
    throw new Error('That regular expression takes too long to match. Simplify it.');
  return re;
}
