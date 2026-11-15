import type { InputHTMLAttributes } from 'react';
import { cx } from './cx';
import { SearchIcon } from './icons';

export interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Shortcut chip text; null hides it. */
  shortcut?: string | null;
  label?: string;
}

export function SearchInput({
  shortcut = '⌘K',
  label = 'Search',
  className,
  ...rest
}: SearchInputProps) {
  return (
    <label
      className={cx(
        'flex h-[34px] w-[280px] items-center gap-2 rounded-md border border-line bg-surface px-[10px] text-ink-muted',
        'transition-colors duration-instant ease-standard focus-within:border-copper',
        className,
      )}
    >
      <SearchIcon />
      <input
        type="search"
        aria-label={label}
        placeholder="Search topics, groups, offsets"
        className="min-w-0 flex-1 border-none bg-transparent font-sans text-[12px] text-ink placeholder:text-ink-muted"
        {...rest}
      />
      {shortcut !== null && (
        <span
          aria-hidden="true"
          className="rounded-sm border border-line-strong px-[5px] py-px font-mono text-[10px] leading-[14px] text-ink-muted"
        >
          {shortcut}
        </span>
      )}
    </label>
  );
}
