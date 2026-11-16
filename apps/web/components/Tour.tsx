'use client';
// Guided tour (F-102): one incident end to end — stalled → open group → reset +1 → recovered.
// Spotlight moves between targets on --dur-slow (MOTION.md "Signature moments"). Skippable, resumable.
import type { GroupSummary } from '@ki/core';
import { Button, useToast } from '@ki/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKafka, useStream } from '../lib/kafka';

const KEY = 'ki-tour-step';
const EVENT = 'ki-tour';

export function startTour(step = 1) {
  try {
    localStorage.setItem(KEY, String(step));
  } catch {
    /* not persisted */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: step }));
}

interface Step {
  path: string;
  target: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    path: '/app/',
    target: '[data-tour="attention"]',
    title: '1 of 5 · Something is stuck',
    body: 'fraud-scorer is Stalled: a poison message on payments partition 7 can’t be deserialized, so the group keeps committing the same offset.',
  },
  {
    path: '/app/groups/view/?id=fraud-scorer',
    target: '[data-tour="stalled"]',
    title: '2 of 5 · Find the partition',
    body: 'Partition 7 commits the same offset every second while the end offset grows. The forecast says it won’t catch up.',
  },
  {
    path: '/app/groups/view/?id=fraud-scorer',
    target: '[data-tour="reset"]',
    title: '3 of 5 · Skip the bad message',
    body: 'Reset offsets moves where the group resumes reading. Nothing is deleted from the topic.',
  },
  {
    path: '/app/groups/view/?id=fraud-scorer&reset=1',
    target: '[data-tour="apply"]',
    title: '4 of 5 · Shift by +1',
    body: 'The dry run shows one message skipped on partition 7. Apply it (or let the tour do it).',
  },
  {
    path: '/app/groups/view/?id=fraud-scorer',
    target: '[data-tour="status"]',
    title: '5 of 5 · Recovered',
    body: 'Members rejoin and the status returns to Healthy. The stalled alert resolves; lag alerts clear as the backlog drains.',
  },
];

export function GuidedTour() {
  const router = useRouter();
  const { client, clusterId } = useKafka();
  const groups = useStream<GroupSummary[]>('lag');
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    try {
      const s = Number(localStorage.getItem(KEY) ?? 0);
      if (s > 0) setStep(s);
    } catch {
      /* no storage */
    }
    const on = (e: Event) => setStep((e as CustomEvent<number>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  const go = (n: number) => {
    const next = n > STEPS.length || n < 1 ? 0 : n;
    try {
      if (next) localStorage.setItem(KEY, String(next));
      else localStorage.removeItem(KEY);
    } catch {
      /* not persisted */
    }
    setStep(next);
    if (next) router.push(STEPS[next - 1]!.path);
  };

  useEffect(() => {
    // exact page match: every app page starts with "/app/", so a prefix test kept step 1 off the Overview
    if (step && location.pathname !== STEPS[step - 1]!.path.split('?')[0]!)
      router.push(STEPS[step - 1]!.path);
  }, [step, router]);

  // Track the target element
  useLayoutEffect(() => {
    if (!step) return;
    let raf = 0;
    const find = () => {
      const el = document.querySelector(STEPS[step - 1]!.target);
      if (el) {
        const reduce =
          document.documentElement.dataset.motion === 'reduced' ||
          (!document.documentElement.dataset.motion &&
            matchMedia('(prefers-reduced-motion: reduce)').matches);
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight)
          el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        setRect(el.getBoundingClientRect());
      } else setRect(null);
      raf = window.setTimeout(find, 300);
    };
    find();
    return () => clearTimeout(raf);
  }, [step]);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && go(0);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!step) return null;
  const s = STEPS[step - 1]!;
  const fraud = groups?.find((g) => g.groupId === 'fraud-scorer');
  const pad = 8;
  const card = rect
    ? {
        top:
          rect.bottom + pad + 12 > innerHeight - 200
            ? Math.max(16, rect.top - 200)
            : rect.bottom + pad + 12,
        left: Math.min(innerWidth - 380, Math.max(16, rect.left)),
      }
    : { top: 120, left: innerWidth / 2 - 180 };

  const primary = () =>
    run().catch((e: Error) =>
      toast({ tone: 'crit', title: "That step didn't work", body: e.message }),
    );
  // steps 1–3 need a stalled fraud-scorer; after a reload (incidents aren't stored) it may be healthy again
  const needsPoison = step >= 1 && step <= 3 && fraud && fraud.status !== 'stalled';
  const run = async () => {
    if (needsPoison) {
      await client.chaos?.run({ kind: 'poison-message' });
      return;
    }
    // apply only while it's still stuck: a second click, or a fix already applied by hand, must not skip a good message
    if (step === 4 && client.writes && fraud?.status === 'stalled') {
      await client.writes.resetOffsets(
        clusterId,
        {
          groupId: 'fraud-scorer',
          topic: 'payments',
          partitions: [7],
          strategy: { kind: 'shift', by: 1 },
        },
        false,
      );
    }
    go(step + 1);
  };
  const primaryLabel = needsPoison
    ? 'Trigger a poison message'
    : step === 4
      ? fraud?.status === 'stalled'
        ? 'Apply for me'
        : 'Next'
      : step === 5
        ? 'Finish'
        : 'Next';

  // A modal <dialog> makes everything outside it inert: render inside the open dialog so the tour stays usable.
  const host =
    typeof document !== 'undefined'
      ? document.querySelector<HTMLDialogElement>('dialog[open]')
      : null;
  const ui = (
    <>
      {rect && (
        <div
          aria-hidden="true"
          className="ki-spotlight pointer-events-none fixed left-0 top-0 z-40 rounded-lg border-2 border-copper"
          style={{
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            transform: `translate(${rect.left - pad}px, ${rect.top - pad}px)`,
            boxShadow: '0 0 0 9999px color-mix(in srgb, var(--bg-sidebar) 55%, transparent)',
          }}
        />
      )}
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="ki-tour-title"
        className="ki-fade-in fixed z-50 w-[360px] rounded-lg border border-line bg-surface p-4 [box-shadow:var(--shadow-popover)]"
        style={card}
      >
        <h2 id="ki-tour-title" className="m-0 text-[13px] font-semibold">
          {s.title}
        </h2>
        <p className="m-0 mt-2 text-[13px] text-ink-muted">
          {step === 5 && fraud
            ? `${s.body} Now: ${fraud.status === 'healthy' ? 'Healthy' : fraud.status}, lag ${fraud.totalLag.toLocaleString('en-US')}.`
            : s.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => go(0)}>
            Skip tour
          </Button>
          <div className="grow" />
          {step > 1 && (
            <Button size="sm" onClick={() => go(step - 1)}>
              Back
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={primary} autoFocus>
            {primaryLabel}
          </Button>
        </div>
      </section>
    </>
  );
  return host ? createPortal(ui, host) : ui;
}
