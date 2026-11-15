import type { ComponentType, ReactNode } from 'react';
import { cx } from './cx';

export type LinkLike = ComponentType<{
  href: string;
  className?: string;
  'aria-current'?: 'page';
  children: ReactNode;
}>;

export interface NavItemProps {
  label: ReactNode;
  href: string;
  count?: ReactNode;
  countTone?: 'default' | 'crit';
  active?: boolean;
  as?: LinkLike | 'a';
}

export function NavItem({
  label,
  href,
  count,
  countTone = 'default',
  active,
  as: Link = 'a',
}: NavItemProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex items-center gap-[10px] rounded-[6px] py-2 pl-[23px] pr-[10px] text-[13px] text-ink no-underline',
        'transition-colors duration-instant ease-standard hover:bg-surface-hover',
        'aria-[current=page]:bg-surface-hover aria-[current=page]:font-semibold',
        'light:aria-[current=page]:bg-surface light:aria-[current=page]:shadow-[0_0_0_1px_var(--line)]',
        'aria-[current=page]:before:absolute aria-[current=page]:before:left-[10px] aria-[current=page]:before:top-[11px] aria-[current=page]:before:h-[14px] aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-[2px] aria-[current=page]:before:bg-copper',
      )}
    >
      {label}
      {count !== undefined && count !== null && (
        <span
          className={cx(
            'ml-auto font-mono text-[10px] tabular-nums',
            countTone === 'crit'
              ? 'rounded-sm bg-crit-soft px-[6px] py-px text-crit-text'
              : 'text-ink-subtle',
          )}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
