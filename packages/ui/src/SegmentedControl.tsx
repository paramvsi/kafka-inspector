'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { cx } from './cx';

export interface SegmentedControlProps {
  options: Array<string | { value: string; label?: string }>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label: string;
}

export function SegmentedControl({
  options,
  value,
  defaultValue,
  onChange,
  label,
}: SegmentedControlProps) {
  const opts = options.map((o) =>
    typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value },
  );
  const [own, setOwn] = useState(defaultValue ?? opts[0]?.value);
  const current = value ?? own;
  const ref = useRef<HTMLDivElement>(null);
  // Indicator box, measured after mount. Until then the pressed button paints its own fill (no flash before hydration).
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    document.fonts?.ready.then(measure); // font swap changes option widths
  }, [current]);

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className="relative inline-flex overflow-hidden rounded-md border border-line bg-surface"
    >
      {box && (
        // Slides with transform only (MOTION.md): a 1px bar scaled to the option width.
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-px origin-left bg-line transition-transform duration-fast ease-standard light:bg-ink motion-off:transition-none"
          style={{ transform: `translateX(${box.x}px) scaleX(${box.w})` }}
        />
      )}
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === current}
          onClick={() => {
            setOwn(o.value);
            onChange?.(o.value);
          }}
          className={cx(
            'relative h-8 cursor-pointer border-none bg-transparent px-[10px] font-mono text-[11px] text-ink-muted transition-colors duration-fast ease-standard',
            'aria-pressed:text-ink light:aria-pressed:text-bg',
            !box && 'aria-pressed:bg-line light:aria-pressed:bg-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
