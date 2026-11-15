'use client';
// Recharts is ~117 kB gzip: load it after first paint (performance budget: ≤ 250 kB initial JS on /app).
import type { TimeSeriesChartProps } from '@ki/ui';
import dynamic from 'next/dynamic';

export const TimeSeriesChart = dynamic<TimeSeriesChartProps>(
  () => import('@ki/ui/chart').then((m) => m.TimeSeriesChart),
  {
    ssr: false,
    loading: () => (
      <div aria-hidden="true" className="ki-skeleton rounded-md" style={{ height: 180 }} />
    ),
  },
);
