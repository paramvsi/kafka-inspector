import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center gap-4 px-4">
      <h1 className="m-0 text-[24px] font-semibold">Page not found</h1>
      <p className="m-0 text-[14px] text-ink-muted">
        This address isn&apos;t part of Kafka Inspector. Check the link, or start from the overview.
      </p>
      <p className="m-0 flex gap-4 text-[14px]">
        <Link href="/app/" className="text-copper">
          Open the overview
        </Link>
        <Link href="/" className="text-copper">
          Home
        </Link>
      </p>
    </main>
  );
}
