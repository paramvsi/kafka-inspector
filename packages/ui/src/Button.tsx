import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

const variants = {
  primary: 'bg-copper text-copper-on hover:bg-copper-strong',
  secondary: 'bg-surface text-ink border-line hover:bg-surface-hover',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink',
  danger: 'bg-crit-soft text-crit-text border-crit-soft hover:border-crit',
};
const sizes = {
  sm: 'h-control-sm px-3 text-[12px]',
  md: 'h-control-md px-4 text-[13px]',
  lg: 'h-control-lg px-5 text-[14px]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-sans font-semibold leading-none',
        'transition-[background-color,border-color,color,transform] duration-instant ease-standard active:scale-[0.98] motion-off:active:scale-100',
        'disabled:cursor-not-allowed disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
}
