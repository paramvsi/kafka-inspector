'use client';
import { useToast } from '@ki/ui';
import { useCallback } from 'react';

/** Runs a call; a failure becomes a "Couldn't …" toast instead of an unhandled rejection. Resolves to success. */
export function useAttempt() {
  const toast = useToast();
  return useCallback(
    (what: string, p: Promise<unknown>, hint?: string) =>
      p.then(
        () => true,
        (e: Error) => {
          toast({
            tone: 'crit',
            title: `Couldn't ${what}`,
            body: hint ? `${e.message} ${hint}` : e.message,
          });
          return false;
        },
      ),
    [toast],
  );
}
