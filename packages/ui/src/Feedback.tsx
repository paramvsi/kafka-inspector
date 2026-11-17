'use client';
import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

// ── Tooltip: CSS-only; opens after --dur-slow on hover/focus, closes instantly ──
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
}) {
  const id = useId();
  // WCAG 1.4.13: Esc hides it without moving the pointer or focus; it can show again on the next hover/focus
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (dismissed) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDismissed(true);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissed]);
  // the description belongs on the control itself, so it is read when the control is reached
  // merged, so a control's own hint/error description is kept
  const trigger = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
        'aria-describedby': `${children.props['aria-describedby'] ?? ''} ${id}`.trim(),
      })
    : children;
  return (
    <span
      className="ki-tip relative inline-flex"
      data-dismissed={dismissed || undefined}
      // an Escape pressed elsewhere (closing a dialog) dismissed every tooltip: a new hover or focus shows it again
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
    >
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={cx(
          'ki-tip-body pointer-events-none absolute left-1/2 z-20 w-max max-w-[260px] rounded-md border border-line bg-surface px-2 py-1 text-[12px] font-normal leading-4 text-ink [box-shadow:var(--shadow-popover)]',
          side === 'top' ? 'ki-tip-top bottom-full mb-2' : 'ki-tip-bottom top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}

// ── Banner: info / warn / crit; height reveal on mount (grid rows 0fr→1fr) ──
const BANNER: Record<string, string> = {
  info: 'border-line bg-copper-soft',
  warn: 'border-warn-soft bg-warn-soft',
  crit: 'border-crit-soft bg-crit-soft',
};
const BANNER_DOT: Record<string, string> = { info: 'bg-copper', warn: 'bg-warn', crit: 'bg-crit' };
export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: {
  tone?: 'info' | 'warn' | 'crit';
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('ki-reveal', className)} role={tone === 'crit' ? 'alert' : 'status'}>
      <div className="min-h-0 overflow-hidden">
        <div
          className={cx(
            'flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px]',
            BANNER[tone],
          )}
        >
          <span
            aria-hidden="true"
            className={cx('size-2 shrink-0 rounded-full', BANNER_DOT[tone])}
          />
          <div className="min-w-0 grow">
            <span className="font-semibold">{title}</span>
            {children && <span className="text-ink-muted"> {children}</span>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton: shimmer, static under reduced motion ──
export const Skeleton = ({ className }: { className?: string }) => (
  <span aria-hidden="true" className={cx('ki-skeleton block rounded-sm', className)} />
);

// ── EmptyState ──
export function EmptyState({
  title,
  children,
  actions,
}: {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="section-title">{title}</div>
      {children && <div className="max-w-[440px] text-[13px] text-ink-muted">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded-sm border border-line-strong px-[5px] py-px font-mono text-[10px] leading-[14px] text-ink-muted">
    {children}
  </kbd>
);

// ── Toasts ──
interface ToastItem {
  id: number;
  tone: 'info' | 'ok' | 'warn' | 'crit';
  title: ReactNode;
  body?: ReactNode;
  action?: { label: string; onClick: () => void };
}
const ToastCtx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Array<ToastItem & { leaving?: boolean }>>([]);
  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 160);
  }, []);
  const push = useCallback(
    (t: Omit<ToastItem, 'id'>) =>
      setItems((xs) => {
        // the same message again (e.g. one alert re-firing) refreshes its toast instead of stacking copies
        const same = (x: ToastItem) =>
          !('leaving' in x && x.leaving) &&
          x.tone === t.tone &&
          typeof x.title === 'string' &&
          x.title === t.title &&
          (x.body ?? '') === (t.body ?? '') &&
          typeof (x.body ?? '') === 'string';
        return [...xs.filter((x) => !same(x)).slice(-3), { ...t, id: Date.now() + Math.random() }];
      }),
    [],
  );
  const host = useTopDialog();
  const region = (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2"
    >
      {items.map((t) => (
        <Toast key={t.id} item={t} dismiss={dismiss} />
      ))}
    </div>
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* inside the topmost open modal: outside it, the modal makes the toast inert (an action you can't click) */}
      {host === undefined ? region : createPortal(region, host ?? document.body)}
    </ToastCtx.Provider>
  );
}

/**
 * The most recently opened <dialog> that's still open, or null; undefined before mount (no document when prerendering).
 * Opening order, not DOM order: a drawer opened over another dialog is the top one wherever it sits in the page.
 */
export function useTopDialog(): HTMLElement | null | undefined {
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    const stack: HTMLDialogElement[] = [];
    const update = () => {
      for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
        if (!stack.includes(d)) stack.push(d);
      for (let i = stack.length - 1; i >= 0; i--)
        if (!stack[i]!.hasAttribute('open') || !stack[i]!.isConnected) stack.splice(i, 1);
      setHost(stack.at(-1) ?? null);
    };
    update();
    const o = new MutationObserver(update);
    o.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => o.disconnect();
  }, []);
  return host;
}

const TOAST_DOT = { info: 'bg-copper', ok: 'bg-ok', warn: 'bg-warn', crit: 'bg-crit' };
function Toast({
  item,
  dismiss,
}: {
  item: ToastItem & { leaving?: boolean };
  dismiss: (id: number) => void;
}) {
  // `dismiss` is stable: other toasts arriving don't restart this one's timer.
  // Hover or keyboard focus holds it open (WCAG 2.2.1), and the 6 s restart when the pointer/focus leaves.
  // hover and keyboard focus hold it independently: leaving with the pointer must not drop a focused toast
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const onDismiss = () => dismiss(item.id);
  useEffect(() => {
    // a toast with an action stays until dismissed: it's last in tab order, and 6 s is too short to Tab there
    if (held || item.leaving || item.action) return;
    const t = setTimeout(() => dismiss(item.id), 6000);
    return () => clearTimeout(t);
  }, [held, item.leaving, item.action, item.id, dismiss]);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className={cx(
        'ki-toast pointer-events-auto flex gap-3 rounded-lg border border-line bg-surface p-3 text-[13px] [box-shadow:var(--shadow-popover)]',
        item.leaving && 'ki-toast-leave',
      )}
    >
      <span
        aria-hidden="true"
        className={cx('mt-[6px] size-2 shrink-0 rounded-full', TOAST_DOT[item.tone])}
      />
      <div className="min-w-0 grow">
        {/* long Kafka names have no spaces: they wrap inside the 360 px card instead of running past it */}
        <div className="break-words font-semibold">{item.title}</div>
        {item.body && (
          <div className="mt-[2px] break-words text-[12px] text-ink-muted">{item.body}</div>
        )}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action!.onClick();
              onDismiss();
            }}
            className="mt-2 cursor-pointer border-none bg-transparent p-0 text-[12px] font-semibold text-copper hover:text-copper-strong"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="h-6 cursor-pointer border-none bg-transparent px-1 text-ink-muted hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
