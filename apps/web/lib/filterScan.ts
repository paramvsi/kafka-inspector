/**
 * One filter run over a batch, inside the worker's time budget. A message the expression throws on (value.a.b with
 * no a) is skipped and counted, not a failed run: the matches still show, with the first reason.
 */
export function scan<M extends { offset: number }>(
  fn: (m: M) => unknown,
  messages: M[],
  budgetMs: number,
) {
  const start = performance.now();
  const matches: number[] = [];
  let scanned = 0;
  let skipped = 0;
  let skipError: string | undefined;
  for (let i = 0; i < messages.length; i++) {
    if (performance.now() - start > budgetMs) break;
    scanned++;
    try {
      if (fn(messages[i]!)) matches.push(i);
    } catch (err) {
      skipped++;
      skipError ??= `Offset ${messages[i]!.offset}: ${(err as Error).message}`;
    }
  }
  return { matches, scanned, timedOut: scanned < messages.length, skipped, skipError };
}
