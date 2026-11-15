import type * as React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface StatusBadgeProps {
  status?: 'healthy' | 'warn' | 'stalled' | 'stopped' | 'neutral';
  dot?: boolean;
  children?: React.ReactNode;
}
export declare function StatusBadge(props: StatusBadgeProps): React.ReactElement;

export interface KpiCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaTone?: 'ok' | 'warn' | 'crit' | 'neutral';
  spark?: number[];
  sparkTone?: SparklineProps['tone'];
}
export declare function KpiCard(props: KpiCardProps): React.ReactElement;

export interface SparklineProps {
  points: number[];
  tone?: 'ok' | 'warn' | 'crit' | 'chart-1' | 'chart-2' | 'muted';
  width?: number;
  height?: number;
  /** Accessible name; omit when the trend is decorative. */
  label?: string;
}
export declare function Sparkline(props: SparklineProps): React.ReactElement | null;

export interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Shortcut chip text; null hides it. Default "⌘K". */
  shortcut?: string | null;
  label?: string;
  width?: number | string;
}
export declare function SearchInput(props: SearchInputProps): React.ReactElement;

export interface SegmentedControlProps {
  options: Array<string | { value: string; label?: string }>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  label?: string;
}
export declare function SegmentedControl(props: SegmentedControlProps): React.ReactElement;

export interface NavItemProps {
  label: React.ReactNode;
  href?: string;
  count?: React.ReactNode;
  countTone?: 'default' | 'crit';
  active?: boolean;
}
export declare function NavItem(props: NavItemProps): React.ReactElement;

export interface AlertItemProps {
  severity?: 'crit' | 'warn' | 'info';
  title: React.ReactNode;
  detail?: React.ReactNode;
  time?: React.ReactNode;
}
export declare function AlertItem(props: AlertItemProps): React.ReactElement;

export interface DataTableColumn {
  key: string;
  label: React.ReactNode;
  kind?: 'id' | 'num' | 'dim';
}
export interface DataTableProps {
  columns: DataTableColumn[];
  rows: Array<Record<string, React.ReactNode>>;
  rowKey?: string;
  caption?: string;
}
export declare function DataTable(props: DataTableProps): React.ReactElement;

declare global {
  interface Window {
    CopperOxide: {
      Button: typeof Button; StatusBadge: typeof StatusBadge; KpiCard: typeof KpiCard;
      Sparkline: typeof Sparkline; SearchInput: typeof SearchInput; SegmentedControl: typeof SegmentedControl;
      NavItem: typeof NavItem; AlertItem: typeof AlertItem; DataTable: typeof DataTable;
    };
  }
}
