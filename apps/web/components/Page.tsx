'use client';
import type { KafkaClient } from '@ki/core';
import { Button, Tooltip, type ButtonProps } from '@ki/ui';
import type { ReactNode } from 'react';
import { useApp } from '../lib/app';
import { useKafka } from '../lib/kafka';
import { READ_ONLY_HINT } from '../lib/status';

export function PageHeader({
  title,
  mono,
  badges,
  subtitle,
  actions,
}: {
  title: ReactNode;
  mono?: boolean;
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 grow">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            className={mono ? 'm-0 font-mono text-[24px] font-medium leading-8' : 'page-title m-0'}
          >
            {title}
          </h1>
          {badges}
        </div>
        {subtitle && <p className="m-0 mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Writes are available only when the client has them and the cluster isn't read-only (rule 5, F-90). */
export function useWrites(): NonNullable<KafkaClient['writes']> | null {
  const { client, info } = useKafka();
  const { preview } = useApp();
  if (info.readOnly || !info.capabilities.writes || !client.writes || preview === 'readonly')
    return null;
  return client.writes;
}

export function useReadOnly(): boolean {
  return useWrites() === null;
}

/** A write action: disabled with the read-only hint when writes aren't available. */
export function WriteButton(props: ButtonProps) {
  const readOnly = useReadOnly();
  if (!readOnly) return <Button {...props} />;
  return (
    <Tooltip content={READ_ONLY_HINT} side="bottom">
      <Button {...props} disabled aria-disabled="true" onClick={undefined} />
    </Tooltip>
  );
}
