'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Native <dialog>: focus trap, Esc and top layer for free. Enter/exit are CSS transitions with
 * @starting-style (globals.css .ki-dialog / .ki-drawer), so closing mid-animation just reverses.
 */
function useNativeDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // React doesn't render `autofocus`; honour data-autofocus instead of focusing the close button.
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const cancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const click = (e: MouseEvent) => {
      if (e.target === d) onClose(); // backdrop
    };
    d.addEventListener('cancel', cancel);
    d.addEventListener('click', click);
    return () => {
      d.removeEventListener('cancel', cancel);
      d.removeEventListener('click', click);
    };
  }, [onClose]);
  return ref;
}

/**
 * Content stays mounted while the exit transition runs (otherwise the panel fades out empty), then unmounts so
 * the next open starts fresh. transitionend ends it; the timer covers reduced motion, where no transition runs.
 */
function useMountedWhileClosing(open: boolean, ref: React.RefObject<HTMLDialogElement | null>) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) return setMounted(true);
    const d = ref.current;
    const done = () => setMounted(false);
    const onEnd = (e: TransitionEvent) => e.target === d && done(); // not a child's transition
    const t = setTimeout(done, 400);
    d?.addEventListener('transitionend', onEnd);
    return () => {
      clearTimeout(t);
      d?.removeEventListener('transitionend', onEnd);
    };
  }, [open, ref]);
  return open || mounted;
}

const CloseButton = ({ onClose }: { onClose: () => void }) => (
  <button
    type="button"
    onClick={onClose}
    aria-label="Close"
    className="flex size-control-sm cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-[18px] text-ink-muted hover:bg-surface-hover hover:text-ink"
  >
    ×
  </button>
);

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: OverlayProps) {
  const ref = useNativeDialog(open, onClose);
  const show = useMountedWhileClosing(open, ref);
  const id = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      className={cx(
        'ki-dialog m-auto max-w-[calc(100vw-32px)] rounded-lg border border-line bg-surface p-0 text-ink',
        // cx only joins classes: a caller's width wouldn't reliably beat a default one, so the default is
        // left out when the caller gives a width (w-[440px] used to lose to w-[560px])
        /(^|\s)w-/.test(className ?? '') ? undefined : 'w-[560px]',
        className,
      )}
    >
      {show && (
        <div className="flex max-h-[calc(100vh-64px)] flex-col">
          <header className="flex items-start gap-3 border-b border-line-subtle px-5 py-4">
            <div className="grow">
              <h2 id={`${id}-t`} className="section-title m-0">
                {title}
              </h2>
              {description && <p className="m-0 mt-1 text-[13px] text-ink-muted">{description}</p>}
            </div>
            <CloseButton onClose={onClose} />
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: OverlayProps) {
  const ref = useNativeDialog(open, onClose);
  const show = useMountedWhileClosing(open, ref);
  const id = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      className={cx(
        'ki-drawer m-0 ml-auto h-screen max-h-screen w-[480px] max-w-[100vw] border-0 border-l border-line bg-surface p-0 text-ink',
        className,
      )}
    >
      {show && (
        <div className="flex h-full flex-col">
          <header className="flex items-start gap-3 border-b border-line-subtle px-5 py-4">
            <div className="min-w-0 grow">
              <h2 id={`${id}-t`} className="section-title m-0 truncate">
                {title}
              </h2>
              {description && <div className="mt-1 text-[13px] text-ink-muted">{description}</div>}
            </div>
            <CloseButton onClose={onClose} />
          </header>
          <div className="min-h-0 grow overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex flex-wrap items-center gap-2 border-t border-line-subtle px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
