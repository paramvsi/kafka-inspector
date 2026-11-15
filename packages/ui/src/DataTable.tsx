import type { ReactNode } from 'react';
import { cx } from './cx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  kind?: 'id' | 'num' | 'dim';
  width?: string;
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  empty?: ReactNode;
  className?: string;
  stale?: boolean;
}

const KIND: Record<string, string> = {
  num: 'text-right font-mono text-[12px] tabular-nums',
  id: 'font-mono text-[12px]',
  dim: 'text-ink-muted',
};

/** Copper Oxide table (co-table look): mono numbers, scope headers, caption for screen readers. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  onSort,
  onRowClick,
  rowClassName,
  footer,
  empty,
  className,
  stale,
}: DataTableProps<T>) {
  return (
    <div
      className={cx('min-w-0 overflow-hidden rounded-lg border border-line bg-surface', className)}
    >
      <div className="overflow-x-auto">
        <table
          className={cx(
            'w-full border-separate border-spacing-0 text-[13px] transition-opacity duration-base ease-standard',
            stale && 'opacity-50',
          )}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const right = c.align === 'right' || c.kind === 'num';
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={
                      active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className={cx(
                      'whitespace-nowrap border-b border-line bg-surface-sunken px-4 py-[10px] text-[12px] font-normal text-ink-muted',
                      right ? 'text-right' : 'text-left',
                    )}
                  >
                    {c.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-ink-muted hover:text-ink"
                      >
                        {c.header}
                        {active && (
                          <span aria-hidden="true">{sort!.dir === 'asc' ? ' ↑' : ' ↓'}</span>
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && empty ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cx(
                    'group transition-colors duration-instant ease-standard [&>td]:hover:bg-surface-hover',
                    onRowClick && 'cursor-pointer',
                    rowClassName?.(r),
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cx(
                        'border-b border-line-subtle px-4 py-[10px] align-middle group-last:border-b-0',
                        c.kind ? KIND[c.kind] : c.align === 'right' && 'text-right',
                      )}
                    >
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer && (
        <div className="border-t border-line-subtle px-4 py-3 text-[13px] text-ink-muted">
          {footer}
        </div>
      )}
    </div>
  );
}
