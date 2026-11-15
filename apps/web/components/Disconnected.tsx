'use client';
import { Button } from '@ki/ui';
import { useEffect, useState } from 'react';

/** Disconnected banner (01c): what failed, reconnect countdown, attempt count, Retry and Edit connection. */
export function DisconnectedBanner({
  cluster,
  since = Date.now() - 23_000,
  onRetry,
}: {
  cluster: string;
  since?: number;
  onRetry?: () => void;
}) {
  const [left, setLeft] = useState(5);
  const [attempt, setAttempt] = useState(3);
  useEffect(() => {
    const t = setInterval(() => {
      setLeft((s) => {
        if (s > 1) return s - 1;
        setAttempt((a) => Math.min(10, a + 1));
        return 5;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const at = new Date(since);
  const hhmmss = at.toTimeString().slice(0, 8);
  return (
    <div role="alert" className="ki-reveal">
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
            <div className="text-[13px] font-semibold text-crit-text">
              Lost connection to {cluster}
            </div>
            <div className="text-[12px] text-ink-muted">
              No response from any broker since {hhmmss}. Reconnecting in {left} s · attempt{' '}
              {attempt} of 10.
            </div>
          </div>
          <a
            href="/app/clusters/"
            className="text-[13px] font-semibold text-ink-muted no-underline hover:text-ink"
          >
            Edit connection
          </a>
          <Button onClick={onRetry ?? (() => setLeft(5))}>Retry now</Button>
        </div>
      </div>
    </div>
  );
}
