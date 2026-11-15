import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      className={cx('min-w-0 rounded-lg border border-line bg-surface', padded && 'p-4', className)}
      {...rest}
    >
      {(title || actions) && (
        <header className={cx('mb-3 flex items-center gap-3', !padded && 'px-4 pt-4')}>
          {title && <h2 className="section-title m-0">{title}</h2>}
          <div className="grow" />
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
