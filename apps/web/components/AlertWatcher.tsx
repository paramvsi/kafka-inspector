'use client';
// Alert delivery (F-82): toast in the app and, for rules that ask for it, a browser notification.
import type { AlertEvent, AlertRule } from '@ki/core';
import { useToast } from '@ki/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useKafka, useStream } from '../lib/kafka';

export function AlertWatcher() {
  const firing = useStream<AlertEvent[]>('alerts');
  const { client } = useKafka();
  const toast = useToast();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  const rules = useRef<AlertRule[]>([]);
  useEffect(() => {
    client
      .listAlertRules()
      .then((r) => (rules.current = r))
      .catch(() => undefined);
  }, [client]);
  useEffect(() => {
    if (!firing) return;
    // the first batch is what was already firing when the page opened: don't toast it
    if (seen.current === null) {
      seen.current = new Set(firing.map((a) => a.id));
      return;
    }
    for (const a of firing) {
      if (seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      if (a.mutedUntil && Date.parse(a.mutedUntil) > Date.now()) continue;
      const rule = rules.current.find((r) => r.id === a.ruleId);
      if (!rule || rule.channels.includes('in-app')) {
        toast({
          tone: a.severity === 'crit' ? 'crit' : a.severity === 'warn' ? 'warn' : 'info',
          title: `Alert: ${a.title}`,
          body: a.evidence,
          action: { label: 'Open', onClick: () => router.push(a.href) },
        });
      }
      if (
        rule?.channels.includes('browser') &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible'
      ) {
        new Notification(`Kafka Inspector · ${a.title}`, { body: a.evidence, tag: a.id });
      }
    }
  }, [firing, toast, router]);
  return null;
}

/** Topbar bell: firing count, links to Alerts. */
export function Bell() {
  const firing = useStream<AlertEvent[]>('alerts');
  const n = (firing ?? []).filter(
    (a) => !a.acknowledged && !(a.mutedUntil && Date.parse(a.mutedUntil) > Date.now()),
  ).length;
  return (
    <a
      href="/app/alerts/"
      aria-label={n ? `Alerts, ${n} firing` : 'Alerts, none firing'}
      className="relative flex size-control-md items-center justify-center rounded-md text-ink-muted no-underline transition-colors duration-instant ease-standard hover:bg-surface-hover hover:text-ink"
    >
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 && (
        <span
          key={n}
          className="ki-fade-in absolute right-[2px] top-[2px] min-w-4 rounded-sm bg-crit-soft px-1 text-center font-mono text-[10px] leading-4 text-crit-text"
        >
          {n}
        </span>
      )}
    </a>
  );
}
