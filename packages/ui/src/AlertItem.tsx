import type { ReactNode } from 'react';
import { cx } from './cx';

const DOT = { crit: 'bg-crit', warn: 'bg-warn', info: 'bg-copper' };
const WORD = { crit: 'Critical', warn: 'Warning', info: 'Info' };

export function AlertItem({
  severity,
  title,
  detail,
  time,
  href,
  linkAs: Link = 'a',
  className,
}: {
  severity: 'crit' | 'warn' | 'info';
  title: ReactNode;
  detail?: ReactNode;
  time?: ReactNode;
  href?: string;
  linkAs?: React.ComponentType<{ href: string; className?: string; children: ReactNode }> | 'a';
  className?: string;
}) {
  const body = (
    <>
      <span
        role="img"
        aria-label={WORD[severity]}
        className={cx('mt-[6px] size-2 shrink-0 rounded-full', DOT[severity])}
      />
      <div className="min-w-0 grow">
        <div className="font-semibold text-ink">{title}</div>
        {detail && <div className="mt-[2px] text-[12px] leading-4 text-ink-muted">{detail}</div>}
      </div>
      {time && (
        <span className="whitespace-nowrap font-mono text-[10px] text-ink-muted">{time}</span>
      )}
    </>
  );
  const cls = cx(
    'ki-insert flex gap-[10px] border-b border-line-subtle py-3 text-[13px] no-underline last:border-b-0',
    className,
  );
  return href ? (
    <Link href={href} className={cx(cls, 'hover:[&_.font-semibold]:text-copper')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
