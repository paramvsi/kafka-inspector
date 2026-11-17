/** After a control removes or disables itself, keep keyboard focus nearby instead of letting it fall to <body>
 * (WCAG 2.4.3): focus the fallback — the list it lived in — or the page's <main>. */
export function keepFocus(fallback?: HTMLElement | null): void {
  requestAnimationFrame(() => {
    const a = document.activeElement;
    // focus left inside a closed <dialog> (still in the DOM) is lost too: the browser drops it to <body> next
    const lost =
      !a ||
      a === document.body ||
      !a.isConnected ||
      (a as HTMLButtonElement).disabled ||
      !!a.closest('dialog:not([open])');
    if (!lost) return;
    (fallback ?? document.getElementById('main'))?.focus({ preventScroll: true });
  });
}
