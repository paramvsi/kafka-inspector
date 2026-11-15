'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import type { LinkLike } from './NavItem';

export interface TabItem {
  key: string;
  label: ReactNode;
  href: string;
}

/** Link tabs (each tab is a deep link). The active indicator slides with transform only (MOTION.md). */
export function Tabs({
  items,
  active,
  label,
  linkAs: Link = 'a',
}: {
  items: TabItem[];
  active: string;
  label: string;
  linkAs?: LinkLike | 'a';
}) {
  const ref = useRef<HTMLElement>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    document.fonts?.ready.then(measure);
  }, [active, items.length]);
  return (
    <nav ref={ref} aria-label={label} className="relative flex gap-6 border-b border-line">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? 'page' : undefined}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 border-transparent pb-2 text-[13px] text-ink-muted no-underline transition-colors duration-fast ease-standard hover:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink',
            !box && 'aria-[current=page]:border-copper',
          )}
        >
          {t.label}
        </Link>
      ))}
      {box && (
        <span
          aria-hidden="true"
          className="absolute bottom-[-1px] left-0 h-[2px] w-px origin-left bg-copper transition-transform duration-fast ease-standard motion-off:transition-none"
          style={{ transform: `translateX(${box.x}px) scaleX(${box.w})` }}
        />
      )}
    </nav>
  );
}
