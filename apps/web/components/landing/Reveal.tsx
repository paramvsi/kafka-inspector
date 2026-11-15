'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/** Reveals once when scrolled into view (fade + 12 px rise on --dur-slow); never re-animates (MOTION.md "Landing"). */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    el.dataset.reveal = 'pending';
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.reveal = 'shown';
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`ki-reveal-once ${className ?? ''}`}>
      {children}
    </div>
  );
}
