'use client';
// Alert delivery (F-82): toast in the app and, for rules that ask for it, a browser notification.
import { shownName, type AlertEvent, type AlertRule } from '@ki/core';
import { useToast } from '@ki/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isMuted } from '../lib/baseline';
import { useKafkaQuery, useStream } from '../lib/kafka';

export function AlertWatcher() {
  const firing = useStream<AlertEvent[]>('alerts', { always: true });
  const toast = useToast();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  // same cache as the Alerts page: saving a rule there refreshes the channels used here
  const rulesQuery = useKafkaQuery(['alert-rules'], (c) => c.listAlertRules(), 30_000);
  const rules = useRef<AlertRule[]>([]);
  rules.current = rulesQuery.data ?? rules.current;
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
      if (isMuted(a)) continue;
      const rule = rules.current.find((r) => r.id === a.ruleId);
      if (!rule || rule.channels.includes('in-app')) {
        toast({
          tone: a.severity === 'crit' ? 'crit' : a.severity === 'warn' ? 'warn' : 'info',
          title: `Alert: ${shownName(a.title)}`,
          body: shownName(a.evidence),
          action: { label: 'Open', onClick: () => router.push(a.href) },
        });
      }
      if (
        rule?.channels.includes('browser') &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible'
      ) {
        const n = new Notification(`Kafka Inspector · ${shownName(a.title)}`, {
          body: shownName(a.evidence),
          tag: a.id,
        });
        n.onclick = () => {
          window.focus();
          router.push(a.href);
          n.close();
        };
      }
    }
  }, [firing, toast, router]);
  return null;
}

/** Topbar bell: firing count, links to Alerts. */
export function Bell() {
  const firing = useStream<AlertEvent[]>('alerts', { always: true });
  const n = (firing ?? []).filter((a) => !a.acknowledged && !isMuted(a)).length;
  return (
    <Link
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
    </Link>
  );
}
