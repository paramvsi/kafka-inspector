/** The rule preview line: a number only when the cluster can replay history; never a made-up 0. */
export function previewLabel(data: { firings: number } | null | undefined, error: unknown): string {
  if (error) return "Couldn't run the preview. Change a field to try again.";
  if (data === null) return "Preview isn't available on this cluster";
  if (!data) return '…';
  return `Would have fired ${data.firings} time${data.firings === 1 ? '' : 's'}`;
}
