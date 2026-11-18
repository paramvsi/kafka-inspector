/** After a control removes or disables itself, keep keyboard focus nearby instead of letting it fall to <body>
 * (WCAG 2.4.3): focus the fallback — the list it lived in — or the page's <main>. With `watchMs`, keep checking
 * each frame for that long: focus that a closing dialog hands back to a row the next render removes is lost
 * later than one frame, at a time that depends on load. */
export function keepFocus(fallback?: HTMLElement | null, watchMs = 0): void {
  const until = performance.now() + watchMs;
  const check = () => {
    const a = document.activeElement;
    // focus left inside a closed <dialog> (still in the DOM) is lost too: the browser drops it to <body> next
    const lost =
      !a ||
      a === document.body ||
      !a.isConnected ||
      (a as HTMLButtonElement).disabled ||
      !!a.closest('dialog:not([open])');
    if (lost) (fallback ?? document.getElementById('main'))?.focus({ preventScroll: true });
    else if (performance.now() < until) requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
