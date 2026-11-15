import Link from 'next/link';

// ponytail: placeholder landing — the real page (Landing.dc.html, F-110) is phase 5.
export default function Landing() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="page-title">Kafka Inspector</h1>
      <p className="body text-ink-muted">A real-time UI for Apache Kafka.</p>
      <Link className="body text-copper underline" href="/app/">
        Open live demo
      </Link>
    </main>
  );
}
