'use client';
import type { ConnectionState } from '@ki/core';
import { Button } from '@ki/ui';
import { useEffect, useState } from 'react';

/** Disconnected banner (01c): what failed, reconnect countdown, attempt count, Retry and Edit connection. */
export function DisconnectedBanner({
  cluster,
  connection,
}: {
  cluster: string;
  connection: ConnectionState;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = connection.nextAt ? Math.max(0, Math.ceil((connection.nextAt - now) / 1000)) : 0;
  const since = connection.since ? new Date(connection.since).toTimeString().slice(0, 8) : '—';
  return (
    // only the heading is a live region: the countdown below changes every second and must not be re-announced
    <div className="ki-reveal">
      <div className="min-h-0 overflow-hidden">
        <div className="flex items-center gap-4 rounded-lg border border-crit bg-crit-soft px-4 py-3">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="shrink-0 text-crit"
          >
            <path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2-1.5M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-11.3-3.7M12 20h.01" />
          </svg>
          <div className="min-w-0 grow">
            <div role="alert" className="text-[13px] font-semibold text-crit-text">
              Lost connection to {cluster}
            </div>
            <div className="text-[12px] text-ink">
              No response since {since}.{' '}
              {left > 0 ? `Reconnecting in ${left} s` : 'Reconnecting now'} · attempt{' '}
              {connection.attempt ?? 1} of {connection.maxAttempts ?? 10}.
            </div>
          </div>
          <a
            href="/app/clusters/"
            className="text-[13px] font-semibold text-ink underline-offset-2 hover:underline"
          >
            Edit connection
          </a>
          <Button onClick={() => location.reload()}>Retry now</Button>
        </div>
      </div>
    </div>
  );
}
