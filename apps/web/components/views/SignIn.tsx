'use client';
import { Button, TextField } from '@ki/ui';
import { useEffect, useState } from 'react';
import { agentInfo, ApiError, signIn } from '../../lib/client/agent';

/** Sign in (18, F-91): admin + KI_ADMIN_PASSWORD; errors for wrong password, rate limit and an unreachable agent. */
export function SignInView() {
  const [password, setPassword] = useState('');
  // a password typed (or autofilled) before hydration is in the field but not in state: pick it up
  useEffect(() => {
    const typed = document.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    )?.value;
    if (typed) setPassword(typed);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [meta, setMeta] = useState<{ version: string; clusters?: number } | null>(null);
  const [demo, setDemo] = useState(false);
  const [host, setHost] = useState('');
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setHost(location.host); // after mount: the static HTML can't know the host (hydration)
    setExpired(new URLSearchParams(location.search).get('reason') === 'expired');
    if (process.env.NEXT_PUBLIC_KI_MODE === 'demo') return setDemo(true);
    agentInfo()
      .then(setMeta)
      .catch((e: ApiError) =>
        e.status === 404 || e.status === 0 ? setDemo(e.status === 404) : undefined,
      );
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signIn('admin', password);
      const next = new URLSearchParams(location.search).get('next');
      location.assign(
        next && next.startsWith('/app/') && !next.startsWith('/app/sign-in') ? next : '/app/',
      );
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-4 text-ink">
      <div className="w-[380px] max-w-full rounded-lg border border-line bg-surface p-8">
        <div className="flex flex-col items-center text-center">
          <img
            src="/brand/kafka-inspector-icon-dark.png"
            alt=""
            width={48}
            height={48}
            className="light:hidden"
          />
          <img
            src="/brand/kafka-inspector-icon-light.png"
            alt=""
            width={48}
            height={48}
            className="hidden light:block"
          />
          <h1 className="m-0 mt-4 text-[22px] font-semibold">Sign in to Kafka Inspector</h1>
          {expired && !demo && (
            <p role="status" className="m-0 mt-2 text-[13px] font-semibold text-ink">
              Your session ended. Sign in again.
            </p>
          )}
          <p className="m-0 mt-2 text-[13px] text-ink-muted">
            {demo ? (
              <>
                This is the hosted demo: there&apos;s nothing to sign in to.{' '}
                <a className="text-copper underline" href="/app/">
                  Open the demo
                </a>
                .
              </>
            ) : (
              <>
                This instance runs at <code className="font-mono text-[12px] text-ink">{host}</code>
                {meta?.clusters
                  ? ` and connects to ${meta.clusters} cluster${meta.clusters === 1 ? '' : 's'}`
                  : ''}
                .
              </>
            )}
          </p>
        </div>
        {!demo && (
          <form className="mt-6 flex flex-col gap-4" onSubmit={submit}>
            <TextField label="Username" value="admin" readOnly autoComplete="username" />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              data-autofocus
              autoFocus
              required
              error={error}
              hint={
                !error && (
                  <>
                    Set with <code className="font-mono">KI_ADMIN_PASSWORD</code> when the container
                    starts.
                  </>
                )
              }
            />
            <Button type="submit" variant="primary" size="lg" disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}
      </div>
      <footer className="flex gap-4 text-[12px] text-ink-muted">
        <span className="font-mono text-[11px]">
          {meta ? `v${meta.version} · read-only` : 'read-only'}
        </span>
        <a
          className="text-ink-muted underline"
          href="https://github.com/paramvsi/kafka-inspector#self-hosting"
        >
          Documentation
        </a>
        <a className="text-ink-muted underline" href="https://github.com/paramvsi/kafka-inspector">
          GitHub
        </a>
      </footer>
    </main>
  );
}
