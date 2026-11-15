/** One RFC 4180 cell. Text that a spreadsheet would run as a formula (= + - @, tab, CR) gets a leading '. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // formulas come from text; a number like -5 stays a number
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replaceAll('"', '""')}"` : s;
}
