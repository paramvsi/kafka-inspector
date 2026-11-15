'use client';
// ponytail: temporary phase 1 debug page (prompts/02) — deleted in phase 2.
import { formatForecast, formatInt, STATUS_LABEL, type GroupSummary } from '@ki/core';
import { useStream } from '../../../../lib/kafka';

export default function Debug() {
  const groups = useStream<GroupSummary[]>('lag');
  return (
    <>
      <h1 className="page-title">Debug</h1>
      <table className="w-full max-w-3xl text-[13px]">
        <thead>
          <tr className="text-left text-ink-muted">
            <th scope="col">Group</th>
            <th scope="col">State</th>
            <th scope="col" className="text-right">
              Lag
            </th>
            <th scope="col">Status</th>
            <th scope="col">Forecast</th>
          </tr>
        </thead>
        <tbody>
          {(groups ?? []).map((g) => (
            <tr key={g.groupId} data-group={g.groupId}>
              <td className="font-mono">{g.groupId}</td>
              <td>{g.state}</td>
              <td className="text-right font-mono tabular-nums" data-lag>
                {formatInt(g.totalLag)}
              </td>
              <td data-status>{STATUS_LABEL[g.status]}</td>
              <td>{formatForecast(g.forecast)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
