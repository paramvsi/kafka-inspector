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
    if (lost) (fallback ?? document.getElementById('main'))?.focus({ preventScroll: true });
  });
}

/** For a dialog whose action removes the control that opened it (deleting a row from its own dialog): closing
 * hands focus back to that control, and the list refresh that removes it can land any time later (seconds under
 * load). So don't wait for the loss: as soon as no dialog is open, move focus to the target or <main>.
 * ponytail: gives up after `maxMs` if a dialog stays open (another one opened meanwhile). */
export function focusAfterClose(target?: HTMLElement | null, maxMs = 5000): void {
  const until = performance.now() + maxMs;
  const check = () => {
    if (!document.querySelector('dialog[open]'))
      (target ?? document.getElementById('main'))?.focus({ preventScroll: true });
    else if (performance.now() < until) requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
