/** After a control removes or disables itself, keep keyboard focus nearby instead of letting it fall to <body>
 * (WCAG 2.4.3): focus the fallback — the list it lived in — or the page's <main>. */
export function keepFocus(fallback?: HTMLElement | null): void {
  requestAnimationFrame(() => {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && !(a as HTMLButtonElement).disabled) return;
    (fallback ?? document.getElementById('main'))?.focus({ preventScroll: true });
  });
}
