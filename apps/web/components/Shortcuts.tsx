'use client';
import { Dialog, Kbd } from '@ki/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const GO: Record<string, [string, string]> = {
  o: ['/app/', 'Overview'],
  b: ['/app/brokers/', 'Brokers'],
  t: ['/app/topics/', 'Topics'],
  g: ['/app/groups/', 'Consumer groups'],
  s: ['/app/schemas/', 'Schemas'],
  p: ['/app/topology/', 'Topology'],
  a: ['/app/alerts/', 'Alerts'],
};

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Global keyboard shortcuts (F-06): ⌘K palette, / filter, g + key to navigate, ? for this sheet. */
export function useShortcuts(openPalette: () => void) {
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
        return;
      }
      if (
        typing(e.target) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        document.querySelector('dialog[open]')
      )
        return;
      if (e.key === '/') {
        const f = document.querySelector<HTMLInputElement>('main input[type="search"]');
        if (f) {
          e.preventDefault();
          f.focus();
        }
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setSheet(true);
        return;
      }
      // second key of a "g x" sequence first, so "g g" works
      if (g && Date.now() - g < 1000 && GO[e.key]) {
        e.preventDefault();
        g = 0;
        router.push(GO[e.key]![0]);
        return;
      }
      g = e.key === 'g' ? Date.now() : 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, openPalette]);
  return { sheet, closeSheet: () => setSheet(false) };
}

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const row = (keys: string[], what: string) => (
    <div key={what} className="contents">
      <dt className="flex gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </dt>
      <dd className="m-0 text-[13px]">{what}</dd>
    </div>
  );
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" className="w-[440px]">
      <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3">
        {row(['⌘', 'K'], 'Command palette (Ctrl K on Windows and Linux)')}
        {row(['/'], 'Focus the page filter')}
        {Object.entries(GO).map(([k, [, name]]) => row(['g', k], `Go to ${name}`))}
        {row(['?'], 'Show this sheet')}
        {row(['Esc'], 'Close a dialog, drawer or the palette')}
      </dl>
    </Dialog>
  );
}
